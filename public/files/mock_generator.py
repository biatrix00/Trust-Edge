#!/usr/bin/env python3
"""
TRUSTEDGE - Mock Sensor Data Generator
Simulates realistic ESP32 telemetry with interactive attack injections for hardware-free terminal testing.
Data Contract:
  {"ts": float, "ultrasonic_cm": float, "ir1": int, "ir2": int, "pir": int, "temp_c": float, "humidity_pct": float}
"""

import sys
import time
import json
import random
import math
import argparse
from typing import Dict, Any


class MockSensorStream:
    def __init__(self, hz: float = 10.0):
        self.hz = hz
        self.interval = 1.0 / hz
        self.start_time = time.time()
        
        # Internal physical state of simulated rover
        self.distance = 65.0
        self.velocity = -2.5  # moving towards obstacle
        self.temp = 29.2
        self.humidity = 67.5
        
        # Attack mode: 'nominal', 'blindspot', 'ghost_wall', 'freeze', 'jitter'
        self.mode = "nominal"
        self.step_count = 0

    def set_mode(self, mode: str):
        self.mode = mode
        print(f"\n[MOCK] Switched scenario to: >>> {mode.upper()} <<<")

    def generate_next_packet(self) -> Dict[str, Any]:
        self.step_count += 1
        now = time.time()
        
        # 1. Physical Simulation Update
        self.distance += self.velocity * self.interval
        if self.distance < 8.0:
            self.distance = 8.0
            self.velocity = 3.0  # turn around / back up
        elif self.distance > 90.0:
            self.distance = 90.0
            self.velocity = -2.8
            
        # Natural micro-vibrations of real hardware
        natural_noise = random.gauss(0, 0.4)
        true_dist = max(4.0, self.distance + natural_noise)
        
        # Real optical IR sensor triggers when true distance is under ~14cm
        true_ir1 = 1 if true_dist < 14.0 else 0
        true_ir2 = 1 if (true_dist < 11.0 or (true_ir1 == 1 and random.random() > 0.3)) else 0
        pir_state = 1 if (random.random() < 0.05) else 0

        # Ambient drift
        self.temp += random.uniform(-0.02, 0.02)
        self.humidity += random.uniform(-0.05, 0.05)

        # 2. Apply Attack Manipulation based on self.mode
        ultrasonic_val = round(true_dist, 1)
        ir1_val = true_ir1
        ir2_val = true_ir2
        
        if self.mode == "blindspot":
            # Attacker feeds ultrasonic false clear reading (135.0 cm) to trick rover into slamming wall
            ultrasonic_val = round(135.0 + random.uniform(-1.0, 1.0), 1)
            # Physical obstacle is right in front, so optical IR sensors trigger
            ir1_val = 1
            ir2_val = 1
            
        elif self.mode == "ghost_wall":
            # Attacker shoots acoustic pulses making rover think there is an obstacle at 5.2 cm
            ultrasonic_val = round(5.2 + random.uniform(-0.2, 0.2), 1)
            # Optical IR sensors see open space, so they read 0
            ir1_val = 0
            ir2_val = 0
            
        elif self.mode == "freeze":
            # Replay attack: sensor stuck exactly at 44.200 cm with zero natural noise
            ultrasonic_val = 44.2
            self.temp = 29.4
            
        elif self.mode == "jitter":
            # EMP / ultrasonic jamming producing erratic jumps
            jump = random.choice([75.0, -60.0, 95.0, -45.0])
            ultrasonic_val = max(2.0, round(self.distance + jump, 1))

        packet = {
            "ts": round(now, 3),
            "ultrasonic_cm": ultrasonic_val,
            "ir1": ir1_val,
            "ir2": ir2_val,
            "pir": pir_state,
            "temp_c": round(self.temp, 1),
            "humidity_pct": round(self.humidity, 1)
        }
        return packet


def run_interactive_cli():
    print("=" * 70)
    print("  TRUSTEDGE - Interactive Mock Sensor Stream & FSM Evaluator")
    print("=" * 70)
    print("Commands:")
    print("  [n] Nominal roamer (Healthy)")
    print("  [b] Blindspot Attack (Spoof 135cm while IR is 1)")
    print("  [g] Ghost Wall Attack (Spoof 5cm while IR is 0)")
    print("  [f] Frozen / Replay Attack (0 variance lockup)")
    print("  [j] Jitter / Jammer Attack (Violent spikes)")
    print("  [q] Quit")
    print("=" * 70)

    # Import TrustEngine directly for integrated CLI testing
    try:
        from trust_engine import TrustEngine
        engine = TrustEngine()
        has_engine = True
    except ImportError:
        import sys
        sys.path.append(".")
        from trust_engine import TrustEngine
        engine = TrustEngine()
        has_engine = True

    stream = MockSensorStream(hz=10.0)
    
    # Non-blocking input helper (cross-platform: Windows + POSIX)
    import platform as _plat
    if _plat.system() == "Windows":
        import msvcrt
        def check_key():
            if msvcrt.kbhit():
                ch = msvcrt.getch()
                return ch.decode('utf-8', errors='ignore').strip().lower() or None
            return None
    else:
        import select
        def check_key():
            if sys.stdin in select.select([sys.stdin], [], [], 0)[0]:
                line = sys.stdin.readline().strip().lower()
                return line
            return None

    last_print = 0
    cycle = 0

    try:
        while True:
            t0 = time.time()
            packet = stream.generate_next_packet()
            
            # Evaluate using TrustEngine
            score, state, breakdown, change_reason = engine.evaluate_reading(packet)
            
            # Format terminal output
            cycle += 1
            state_color = {
                "NOMINAL": "\033[92m",    # Green
                "DEGRADED": "\033[93m",   # Yellow
                "LIMP-HOME": "\033[33m",  # Orange
                "SAFE-STOP": "\033[91m",  # Red
            }.get(state, "\033[0m")
            reset_color = "\033[0m"

            # Print every 200ms to avoid overwhelming terminal
            if time.time() - last_print > 0.2:
                last_print = time.time()
                alert_str = ""
                if breakdown.details:
                    alert_str = f" | \033[91mALERT: {breakdown.details[0][:40]}\033[0m"

                print(
                    f"[{time.strftime('%H:%M:%S')}] "
                    f"US: {packet['ultrasonic_cm']:5.1f}cm | "
                    f"IR: [{packet['ir1']},{packet['ir2']}] | "
                    f"Trust: {score:5.1f}% -> "
                    f"{state_color}[{state:^9}]{reset_color}"
                    f"{alert_str}"
                )

            # Check for user keyboard commands
            try:
                cmd = check_key()
                if cmd:
                    if cmd == 'n': stream.set_mode("nominal")
                    elif cmd == 'b': stream.set_mode("blindspot")
                    elif cmd == 'g': stream.set_mode("ghost_wall")
                    elif cmd == 'f': stream.set_mode("freeze")
                    elif cmd == 'j': stream.set_mode("jitter")
                    elif cmd == 'q': break
            except Exception:
                pass

            # Maintain 10 Hz
            elapsed = time.time() - t0
            sleep_time = max(0.001, (1.0 / stream.hz) - elapsed)
            time.sleep(sleep_time)

    except KeyboardInterrupt:
        print("\n[MOCK] Test ended by user.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="TRUSTEDGE Mock Sensor Stream")
    parser.add_argument("--json-only", action="store_true", help="Print newline-terminated JSON for piping")
    parser.add_argument("--mode", default="nominal", choices=["nominal", "blindspot", "ghost_wall", "freeze", "jitter"])
    parser.add_argument("--hz", type=float, default=10.0, help="Publish frequency")
    args = parser.parse_args()

    if args.json_only:
        stream = MockSensorStream(hz=args.hz)
        stream.set_mode(args.mode)
        while True:
            pkt = stream.generate_next_packet()
            print(json.dumps(pkt), flush=True)
            time.sleep(1.0 / args.hz)
    else:
        run_interactive_cli()
