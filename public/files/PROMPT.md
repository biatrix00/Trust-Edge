# The Master AI Engineering Prompt for TRUSTEDGE

Use this exact prompt when building this project from scratch with an AI coding agent or engineering copilot.

---

```markdown
You are a Principal Robotics and Autonomous Safety Systems Engineer. Build the complete, production-grade software and firmware stack for "TRUSTEDGE 2.0": an autonomous sensor spoofing detection engine and deterministic fail-safe controller.

### 1. High-Level Mission & Architecture
Autonomous rovers and AGVs blindly trust sensors. When an attacker shoots ultrasonic pulses or shines lasers, sensors report false paths, causing fatal collisions. TRUSTEDGE solves this by cross-arbitrating heterogeneous physical modalities (acoustics vs. optics vs. inertia) to compute a live Trust Score (0–100%) and enforce deterministic safety states.

System Architecture:
[ESP32 Hardware + Sensors] ──(Bluetooth Serial / USB)──> [Python Bridge / Web Serial] ──> [Python Trust Engine & FSM] ──> [Web Ground Station Dashboard]

### 2. Universal Data Contract (Strictly Enforce)
Every component must communicate using newline-terminated JSON:
- Inbound Sensor Readings (10 Hz, 100ms cycle):
  {
    "ts": 1732000000.123,
    "seq": 1024,
    "ultrasonic_cm": 48.2,
    "ir1": 0,
    "ir2": 0,
    "pir": 0,
    "temp_c": 29.4,
    "humidity_pct": 68.1,
    "accel_x": 0.02,
    "accel_y": -0.01,
    "accel_z": 9.81
  }
  *(ir1, ir2, pir are 0 for clear, 1 for triggered)*

- Outbound Actuator Commands:
  {"cmd": "safe_stop"}
  {"cmd": "resume"}
  {"cmd": "motor_pwm", "value": 140}
  {"cmd": "servo_angle", "value": 90}

### 3. Component 1: ESP32 C++ Arduino Firmware (`esp32_firmware.ino`)
- Hardware: ESP32 Dev Module, HC-SR04 Ultrasonic (Trig: 5, Echo: 18), 2x Digital Optical IR (Pins: 19, 21), PIR (Pin: 22), DHT11 (Pin: 4), L298N Motor Driver (PWM ENA/ENB: 25, IN1-IN4: 26, 27, 14, 12), SG90 Servo (Pin: 13), HC-05 Bluetooth Serial (TX2/RX2: 17, 16 @ 115200 baud).
- Implementation rules:
  1. Keep firmware purely reactive—no trust scoring logic on the MCU.
  2. Fixed non-blocking 10 Hz loop using millis() timestamp deltas (never use blocking delay()).
  3. Format sensor readings into the strict Universal JSON Contract and stream over UART/Bluetooth.
  4. CRITICAL HARDWARE WATCHDOG: Maintain `last_command_time = millis()`. If no valid command packet is received for > 1000ms, immediately cut motor PWM to 0 independently.
  5. Parse inbound JSON command lines (`safe_stop`, `resume`, `motor_pwm`, `servo_angle`).

### 4. Component 2: Python Bridge Service (`bridge_service.py`)
- Reads serial stream (HC-05 RFCOMM or USB COM port) using `pyserial`.
- Automatically scans and connects, with a non-blocking auto-reconnect loop on drop.
- Forward valid parsed packets into the Trust Engine via queue.
- Forward outbound actuator commands back through serial without blocking.

### 5. Component 3: Python Trust Engine & FSM (`trust_engine.py`)
- Maintain a rolling FIFO window of the last 20 frames (2.0 seconds at 10 Hz).
- Calculate Trust Score (0–100%) every frame using 4 deterministic mathematical pillars:
  1. Cross-Modal Physical Arbitration:
     - Blindspot: If IR triggers (obstacle < 14cm) but ultrasonic > 35cm, penalize 35.0 + min(20.0, (US - 35) * 0.8).
     - Ghost Wall: If ultrasonic < 8cm but both IRs are 0, penalize 30.0 pts.
  2. Kinematic Jitter Violation: If delta-distance / delta-time > 450 cm/s (kinematic threshold for rover), apply rate penalty.
  3. Replay / Freeze Detection: If variance across >= 12 frames < 0.0001, apply 35 pt freeze penalty.
  4. Persistence Escalation: Multiply penalty by min(2.5, 1.0 + (consecutive_anomalies - 1) * 0.35).
- Apply Asymmetric Exponential Moving Average (EMA):
  - alpha = 0.45 when score is dropping (instant emergency response).
  - alpha = 0.18 when score is recovering (cautious gradual clearing).
- Deterministic FSM:
  - NOMINAL: 90–100% (Motor PWM 160)
  - DEGRADED: 65–89% (Motor PWM 110)
  - LIMP-HOME: 30–64% (Motor PWM 60, steer away from anomaly)
  - SAFE-STOP: < 30% (Motor PWM 0, immediate actuator halt)
  - Hysteresis: Require 3 consecutive cycles above boundary to step up a state.
- Expose WebSocket server on `ws://0.0.0.0:8765` for dashboards. Provide interactive spoof injection methods.

### 6. Component 4: Ground Station Mission Control Dashboard
- Clean, dark-mode, high-density aerospace/robotics UI (Tailwind CSS, React or static HTML5/Canvas).
- Must include:
  1. Real-time radial Trust Gauge (0–100%) with animated SVG glow.
  2. 60 FPS HTML5 Canvas historical trend chart showing score curve against state threshold zones.
  3. Polar field radar visualizer displaying ultrasonic beam cone and IR proximity trigger arcs.
  4. Attack Injection Deck with 1-click test buttons:
     - "Blindspot Attack" (forces acoustic to 140cm while IR is active)
     - "Ghost Wall" (forces acoustic to 4cm while IR is clear)
     - "Replay Freeze" (locks telemetry to exact static floats)
     - "EMP Jitter" (injects 500+ cm/s random acoustic spikes)
  5. Actuator Override Controls: Emergency Stop, Resume, Steering Angles (45°, 90°, 135°).
  6. Real-Time Audit Log: Live terminal stream of all state transitions with exact physical reasons.
  7. Dual Connection Support: Direct WebSocket input (`ws://localhost:8765`) and Web Serial API USB connection directly from browser.
- IMPORTANT: Provide a "Download Files" modal containing all standalone modules (`trust_engine.py`, `bridge_service.py`, `esp32_firmware.ino`, `mock_generator.py`, `dashboard.html`, `README.md`) rather than cluttering the operational UI with raw code.

Implement all 4 components in pristine, production-ready quality. Ensure 100% build compatibility and provide the exact pinout and verification instructions.
```
