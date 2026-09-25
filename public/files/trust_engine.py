#!/usr/bin/env python3
"""
TRUSTEDGE - Sensor Spoofing Detection & Fail-Safe Controller
Component 3: Trust Engine & FSM
Author: TRUSTEDGE Robotics Team
Universal Data Contract:
  Incoming: {"ts": float, "ultrasonic_cm": float, "ir1": int, "ir2": int, "pir": int, "temp_c": float, "humidity_pct": float}
  Outgoing: {"cmd": "safe_stop"} | {"cmd": "servo_angle", "value": int} | {"cmd": "resume"}
"""

import sys
import time
import json
import math
import asyncio
from collections import deque
from dataclasses import dataclass, asdict
from typing import Dict, Any, List, Optional, Tuple

try:
    import websockets
except ImportError:
    websockets = None
    print("[WARN] websockets library not installed. Run: pip install websockets")


# Safety States Enum
STATE_NOMINAL = "NOMINAL"       # 90 - 100%
STATE_DEGRADED = "DEGRADED"     # 65 - 89%
STATE_LIMP_HOME = "LIMP-HOME"   # 30 - 64%
STATE_SAFE_STOP = "SAFE-STOP"   # below 30%


@dataclass
class SensorReading:
    ts: float
    ultrasonic_cm: float
    ir1: int
    ir2: int
    pir: int
    temp_c: float
    humidity_pct: float

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "SensorReading":
        return cls(
            ts=float(data.get("ts", time.time())),
            ultrasonic_cm=float(data.get("ultrasonic_cm", 0.0)),
            ir1=int(data.get("ir1", 0)),
            ir2=int(data.get("ir2", 0)),
            pir=int(data.get("pir", 0)),
            temp_c=float(data.get("temp_c", 25.0)),
            humidity_pct=float(data.get("humidity_pct", 50.0)),
        )


@dataclass
class AnomalyBreakdown:
    cross_modal_penalty: float = 0.0
    jitter_penalty: float = 0.0
    freeze_penalty: float = 0.0
    persistence_multiplier: float = 1.0
    details: List[str] = None

    def __post_init__(self):
        if self.details is None:
            self.details = []


class TrustEngine:
    def __init__(self, window_seconds: float = 2.0, expected_hz: float = 10.0):
        self.window_seconds = window_seconds
        self.expected_hz = expected_hz
        self.max_samples = int(window_seconds * expected_hz * 1.5)  # buffer leeway
        self.history: deque = deque(maxlen=self.max_samples)
        
        # State tracking
        self.current_state = STATE_NOMINAL
        self.current_score = 100.0
        self.consecutive_anomalous_frames = 0
        self.state_history: List[Dict[str, Any]] = []
        
        # Spoof injection hook for testing & demonstration
        self.active_spoof: Optional[Dict[str, Any]] = None

    def inject_spoof(self, spoof_type: str, params: Optional[Dict[str, Any]] = None):
        """
        Manually inject synthetic spoofing behavior into incoming readings.
        Types:
          - 'blindspot': Forces ultrasonic to report safe distance (>80cm) even if IR is tripped.
          - 'ghost_wall': Forces ultrasonic to report 5cm wall while IR is 0.
          - 'freeze': Locks ultrasonic and temp at static values (zero variance).
          - 'jitter': Injects violent, implausible jumps (+-90cm).
          - 'clear': Restores normal behavior.
        """
        if spoof_type == "clear":
            self.active_spoof = None
            print("[TRUST_ENGINE] Spoof injection cleared.")
        else:
            self.active_spoof = {"type": spoof_type, "params": params or {}}
            print(f"[TRUST_ENGINE] Injected spoof attack: {spoof_type}")

    def apply_spoof_if_active(self, reading: SensorReading) -> SensorReading:
        if not self.active_spoof:
            return reading
        
        s_type = self.active_spoof.get("type")
        r = SensorReading(**asdict(reading))
        
        if s_type == "blindspot":
            # Spoof ultrasonic to long distance (150cm) to cause forward collision
            r.ultrasonic_cm = 150.0
            # Force at least one IR to be tripped to simulate real obstacle ignored by spoof
            r.ir1 = 1
        elif s_type == "ghost_wall":
            # Ultrasonic falsely claims wall is at 6.0 cm, IR clear
            r.ultrasonic_cm = 6.0
            r.ir1 = 0
            r.ir2 = 0
        elif s_type == "freeze":
            # Freeze values completely
            r.ultrasonic_cm = 42.0
            r.temp_c = 28.0
        elif s_type == "jitter":
            # Violently oscillate reading
            jump = 85.0 if (int(time.time() * 10) % 2 == 0) else -80.0
            r.ultrasonic_cm = max(2.0, r.ultrasonic_cm + jump)
            
        return r

    def evaluate_reading(self, raw_data: Dict[str, Any]) -> Tuple[float, str, AnomalyBreakdown, Optional[str]]:
        """
        Main calculation pipeline.
        Returns: (score, new_state, breakdown, state_change_reason_or_None)
        """
        reading = SensorReading.from_dict(raw_data)
        reading = self.apply_spoof_if_active(reading)
        
        # Enforce rolling window by timestamp
        cutoff_time = reading.ts - self.window_seconds
        while self.history and self.history[0].ts < cutoff_time:
            self.history.popleft()
            
        self.history.append(reading)
        
        breakdown = AnomalyBreakdown()
        
        # 1. CROSS-MODAL AGREEMENT
        # Rule A: Obstacle physical proximity limit for digital IR (~15cm).
        # If either IR is triggered (1), ultrasonic MUST be in close proximity (< 25cm).
        # If ultrasonic claims > 40cm while IR says obstacle is right on top of sensor:
        if (reading.ir1 == 1 or reading.ir2 == 1) and reading.ultrasonic_cm > 35.0:
            severity = min(50.0, (reading.ultrasonic_cm - 35.0) * 0.8)
            breakdown.cross_modal_penalty += 35.0 + severity
            breakdown.details.append(
                f"Cross-modal blindspot: IR triggered (ir1={reading.ir1}, ir2={reading.ir2}) "
                f"but ultrasonic claims clear path ({reading.ultrasonic_cm:.1f}cm)"
            )
            
        # Rule B: Ghost wall attack.
        # If ultrasonic claims an obstacle is under 8cm, but neither IR sensor triggers:
        if reading.ultrasonic_cm < 8.0 and reading.ir1 == 0 and reading.ir2 == 0:
            breakdown.cross_modal_penalty += 30.0
            breakdown.details.append(
                f"Cross-modal ghost obstacle: Ultrasonic reports {reading.ultrasonic_cm:.1f}cm, "
                f"yet both optical IR sensors are clear"
            )

        # 2. JITTER / VARIANCE & IMPLAUSIBLE DYNAMICS
        if len(self.history) >= 2:
            prev = self.history[-2]
            dt = max(0.01, reading.ts - prev.ts)
            # Physical robot velocity threshold: acoustic range cannot shift > 60cm in 100ms (6 m/s)
            delta_dist = abs(reading.ultrasonic_cm - prev.ultrasonic_cm)
            rate_of_change = delta_dist / dt  # cm per second
            
            if rate_of_change > 450.0:  # > 4.5 meters/sec impossible for rover
                breakdown.jitter_penalty += min(40.0, (rate_of_change - 450.0) * 0.1 + 20.0)
                breakdown.details.append(
                    f"Implausible acoustic jitter: jump of {delta_dist:.1f}cm in {dt*1000:.0f}ms ({rate_of_change:.0f} cm/s)"
                )

        # 2B. SENSOR STUCK / FROZEN / REPLAY ATTACK
        # If we have at least 12 samples (~1.2s), check variance.
        if len(self.history) >= 12:
            dist_values = [r.ultrasonic_cm for r in self.history]
            mean_dist = sum(dist_values) / len(dist_values)
            variance = sum((x - mean_dist) ** 2 for x in dist_values) / len(dist_values)
            
            # An operational mobile robot has acoustic noise/vibration floor of at least 0.04 cm^2 variance
            if variance < 0.0001:
                breakdown.freeze_penalty += 35.0
                breakdown.details.append(
                    f"Sensor freeze/replay attack detected: 0.00 variance over {len(self.history)} samples"
                )

        # 3. PERSISTENCE MULTIPLIER
        raw_penalty = breakdown.cross_modal_penalty + breakdown.jitter_penalty + breakdown.freeze_penalty
        
        if raw_penalty > 5.0:
            self.consecutive_anomalous_frames += 1
            # Inconsistency across consecutive cycles is penalized harder than a 1-off blip
            # e.g., frame 1: 1.0x, frame 2: 1.25x, frame 3: 1.5x, frame 4+: 2.0x
            breakdown.persistence_multiplier = min(2.2, 1.0 + (self.consecutive_anomalous_frames - 1) * 0.3)
            breakdown.details.append(
                f"Persistence escalation: {self.consecutive_anomalous_frames} consecutive anomalous cycles (x{breakdown.persistence_multiplier:.2f})"
            )
        else:
            # Gradual trust recovery
            self.consecutive_anomalous_frames = max(0, self.consecutive_anomalous_frames - 1)
            breakdown.persistence_multiplier = 1.0

        total_penalty = raw_penalty * breakdown.persistence_multiplier
        
        # Exponential smoothing for smooth trust transition
        target_score = max(0.0, min(100.0, 100.0 - total_penalty))
        alpha = 0.45 if target_score < self.current_score else 0.20  # Fast drop, measured recovery
        self.current_score = (alpha * target_score) + ((1.0 - alpha) * self.current_score)
        
        # 4. SAFETY STATE DETERMINISTIC MAPPING
        old_state = self.current_state
        new_state = self.score_to_state(self.current_score)
        
        state_change_reason = None
        if new_state != old_state:
            reason = breakdown.details[0] if breakdown.details else f"Score transition to {self.current_score:.1f}%"
            state_change_reason = reason
            self.current_state = new_state
            log_entry = {
                "ts": reading.ts,
                "timestamp_str": time.strftime("%H:%M:%S", time.localtime(reading.ts)),
                "old_state": old_state,
                "new_state": new_state,
                "score": round(self.current_score, 1),
                "reason": reason,
            }
            self.state_history.append(log_entry)
            print(f"[STATE_CHANGE] {old_state} -> {new_state} (Score: {self.current_score:.1f}%) | Reason: {reason}")
            
        return self.current_score, self.current_state, breakdown, state_change_reason

    def score_to_state(self, score: float) -> str:
        if score >= 90.0:
            return STATE_NOMINAL
        elif score >= 65.0:
            return STATE_DEGRADED
        elif score >= 30.0:
            return STATE_LIMP_HOME
        else:
            return STATE_SAFE_STOP

    def get_fsm_command_for_state(self, state: str) -> Optional[Dict[str, Any]]:
        """
        Determines what command must be sent to the ESP32 firmware based on safety state.
        """
        if state == STATE_SAFE_STOP:
            return {"cmd": "safe_stop"}
        elif state == STATE_LIMP_HOME:
            return {"cmd": "servo_angle", "value": 45}  # cautious steering offset
        elif state == STATE_NOMINAL or state == STATE_DEGRADED:
            return {"cmd": "resume"}
        return None


# Global server instance for WebSocket & terminal usage
class TrustEngineServer:
    def __init__(self, host: str = "0.0.0.0", port: int = 8765):
        self.host = host
        self.port = port
        self.engine = TrustEngine()
        self.connected_clients = set()
        self.command_callback = None  # To send to Bridge/ESP32
        self.loop = None              # Asyncio event loop

    def set_loop(self, loop):
        self.loop = loop

    def set_command_callback(self, cb):
        self.command_callback = cb

    async def broadcast(self, payload: Dict[str, Any]):
        if not self.connected_clients:
            return
        message = json.dumps(payload)
        to_remove = set()
        for ws in list(self.connected_clients):
            try:
                await ws.send(message)
            except Exception:
                to_remove.add(ws)
        self.connected_clients.difference_update(to_remove)

    async def handle_client(self, websocket, path=None):
        self.connected_clients.add(websocket)
        print(f"[WS] Client connected. Total active: {len(self.connected_clients)}")
        try:
            # Send initial hello & state
            init_msg = {
                "type": "init",
                "state": self.engine.current_state,
                "score": self.engine.current_score,
                "logs": self.engine.state_history[-15:],
            }
            await websocket.send(json.dumps(init_msg))
            
            async for raw in websocket:
                try:
                    data = json.loads(raw)
                    action = data.get("action")
                    if action == "inject_spoof":
                        spoofType = data.get("type", "blindspot")
                        self.engine.inject_spoof(spoofType, data.get("params"))
                        await self.broadcast({"type": "spoof_status", "active": spoofType})
                    elif action == "clear_spoof":
                        self.engine.inject_spoof("clear")
                        await self.broadcast({"type": "spoof_status", "active": None})
                    elif action == "command":
                        cmd = data.get("cmd")
                        if cmd and self.command_callback:
                            self.command_callback(cmd)
                except Exception as e:
                    print(f"[WS_ERR] Failed to process message: {e}")
        except websockets.exceptions.ConnectionClosed:
            pass
        finally:
            self.connected_clients.discard(websocket)
            print(f"[WS] Client disconnected. Total active: {len(self.connected_clients)}")

    def process_incoming_sensor_json(self, raw_line: str) -> Dict[str, Any]:
        """
        Called when a JSON packet arrives from Bridge or Mock.
        """
        try:
            data = json.loads(raw_line.strip())
            # Normalize boot-relative timestamps to Unix epoch.
            # Arduino sends millis()/1000.0 (e.g., ts=4.5) which breaks the
            # rolling window eviction and jitter calculations that expect epoch time.
            if data.get("ts", 0) < 1e9:
                data["ts"] = time.time()
            score, state, breakdown, change_reason = self.engine.evaluate_reading(data)
            
            # Check if an FSM command should be dispatched to ESP32
            cmd = self.engine.get_fsm_command_for_state(state)
            if change_reason and cmd and self.command_callback:
                self.command_callback(cmd)
                
            result = {
                "type": "telemetry",
                "reading": data,
                "score": round(score, 1),
                "state": state,
                "penalties": {
                    "cross_modal": round(breakdown.cross_modal_penalty, 1),
                    "jitter": round(breakdown.jitter_penalty, 1),
                    "freeze": round(breakdown.freeze_penalty, 1),
                    "persistence_mult": round(breakdown.persistence_multiplier, 2),
                },
                "details": breakdown.details,
                "state_changed": change_reason is not None,
                "reason": change_reason,
            }

            # Broadcast to web dashboard via asyncio threadsafe call
            if self.loop and self.loop.is_running() and self.connected_clients:
                asyncio.run_coroutine_threadsafe(self.broadcast(result), self.loop)

            return result
        except Exception as e:
            return {"type": "error", "error": str(e), "raw": raw_line}


def run_standalone():
    """CLI Runner with interactive terminal visualization."""
    print("=" * 70)
    print("  TRUSTEDGE: SENSOR SPOOFING DETECTOR & FAIL-SAFE CONTROLLER")
    print("=" * 70)
    print("Starting Trust Engine in standalone test mode...")
    engine = TrustEngine()

    sample_nominal = {
        "ts": time.time(),
        "ultrasonic_cm": 48.2,
        "ir1": 0,
        "ir2": 0,
        "pir": 0,
        "temp_c": 29.4,
        "humidity_pct": 68.1
    }
    
    score, state, breakdown, reason = engine.evaluate_reading(sample_nominal)
    print(f"Initial Test Reading -> State: {state} | Score: {score:.1f}%")
    print("=" * 70)
    print("Use `mock_generator.py` to pipe live data or start with WebSocket.")


if __name__ == "__main__":
    run_standalone()
