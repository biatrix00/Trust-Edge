# Product Requirements Document (PRD)
## Project Name: TRUSTEDGE 2.0 (Autonomous Multi-Modal Sensor Integrity & Deterministic Fail-Safe System)
**Document Version:** 2.0.0  
**Classification:** Autonomous Systems Functional Safety (ISO 26262 / MISRA C++ compliant architecture)  
**Status:** Approved for Implementation

---

## 1. Executive Summary & Vision

### 1.1 The Problem
Autonomous ground vehicles (AGVs), delivery rovers, and self-driving platforms rely on sensors (ultrasonic, optical proximity, lidar, radar, cameras) that treat physical input as ground truth. Adversarial attacks—such as acoustic ultrasound spoofing (injecting 40 kHz pulses to create false reflections or blindspots), optical laser blinding, electromagnetic interference (EMI), and sensor replay freezes—exploit this trust. When a sensor is spoofed into reporting "clear" while approaching an obstacle, traditional path planners accelerate into collisions.

### 1.2 The Solution
**TRUSTEDGE 2.0** is a deterministic, cross-modal sensor immune system and fail-safe arbitration controller. It continuously evaluates the integrity of heterogeneous sensor modalities (acoustic sound waves, optical infrared photons, thermal passive infrared, and inertial measurement), computes an explainable **Trust Score (0–100%)**, and enforces deterministic finite state machine (FSM) transitions (`NOMINAL` -> `DEGRADED` -> `LIMP-HOME` -> `SAFE-STOP`) with hardware watchdog isolation.

---

## 2. Key Objectives & Success Metrics

1. **Sub-100ms Reaction Time**: From the moment a spoofed or anomalous frame enters the pipeline, the system must trigger fail-safe state degradation and cut actuator power in $< 100\text{ ms}$ (within a single 10 Hz cycle).
2. **Zero Black-Box Latency / 100% Explainability**: No non-deterministic neural networks in the critical safety path. Every penalty must have a direct physical justification traceable in audit logs.
3. **Hardware Watchdog Guarantee**: If serial, Bluetooth, or laptop host processing halts for $> 1000\text{ ms}$, edge firmware independently forces an immediate hardware motor cut-off (PWM = 0).
4. **Resilient Dual Connectivity**: Direct browser-to-hardware connection via **Web Serial / Web Bluetooth API** as well as headless **Python Bridge Service** over TCP/WebSocket.

---

## 3. System Architecture & Modularity

```
┌────────────────────────────────────────────────────────────────────────┐
│                        LAYER 1: HARDWARE EDGE                          │
│  ESP32 Microcontroller (FreeRTOS Dual-Core)                            │
│  - Core 0: 10 Hz Sensor Acquisition & Independent Watchdog             │
│  - Core 1: Actuator PWM Dispatch (L298N Motors, Steering Servo)        │
│  - Transports: Web Serial (USB) & Bluetooth Serial (HC-05)             │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ Universal JSON Contract
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                        LAYER 2: COMM & BRIDGE                          │
│  - Native Browser Web Serial / Web Bluetooth API (Zero-install driver) │
│  - Python Bridge Service (Headless background service with auto-recon) │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ WebSocket / Event Dispatch
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                    LAYER 3: TRUST ENGINE & FSM                         │
│  - 2.0s (20-sample) FIFO Ring Buffer                                   │
│  - 4-Pillar Cross-Modal Arbitration Engine                             │
│  - Persistence Escalation & Asymmetric Exponential Smoothing           │
│  - Deterministic 4-State Safety Automaton                              │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ Real-Time Telemetry Stream
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                    LAYER 4: MISSION GROUND STATION                     │
│  - Real-Time Trust Index & Vector Radar Visualization                  │
│  - Attack Injection Simulator (Blindspot, Ghost, Freeze, EMP Jitter)   │
│  - Actuator Manual Overrides & Time-Series Flight Recorder             │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Universal Data Contract Specification

### 4.1 Inbound Telemetry Packet (Edge -> Controller, 10 Hz)
Every packet must be valid JSON terminated by `\n`:
```json
{
  "ts": 1732000000.123,
  "seq": 1042,
  "ultrasonic_cm": 42.8,
  "ir1": 0,
  "ir2": 0,
  "pir": 0,
  "temp_c": 28.5,
  "humidity_pct": 64.2,
  "accel_x": 0.02,
  "accel_y": -0.01,
  "accel_z": 9.81
}
```
* Field definitions:
  * `ts`: Unix timestamp in seconds (float, 3 decimal places).
  * `seq`: Monotonically increasing 32-bit packet sequence number (detects dropped packets).
  * `ultrasonic_cm`: Distance reading in cm (float, precision 0.1).
  * `ir1`, `ir2`: Optical proximity triggers ($0 = \text{clear}$, $1 = \text{obstacle} \le 14\text{ cm}$).
  * `pir`: Passive infrared presence ($0 = \text{none}$, $1 = \text{thermal movement}$).
  * `temp_c`, `humidity_pct`: Ambient DHT11 telemetry (for air-density acoustic speed correction).
  * `accel_x, y, z`: IMU 3-axis accelerometer readings (in $m/s^2$).

### 4.2 Outbound Actuator Command (Controller -> Edge)
```json
{"cmd": "safe_stop"}
{"cmd": "resume"}
{"cmd": "motor_pwm", "value": 140}
{"cmd": "servo_angle", "value": 90}
```

---

## 5. Mathematical & Algorithmic Formulation

### 5.1 Pillar 1: Cross-Modal Physical Contradiction
* **Blindspot Attack** (Optical detects obstacle; Acoustic claims clear):
  $$\text{If } (ir_1 == 1 \lor ir_2 == 1) \land d_{\text{US}} > 35.0\text{ cm}:$$
  $$\text{Penalty}_{\text{blindspot}} = 35.0 + \min(20.0, (d_{\text{US}} - 35.0) \times 0.8)$$
* **Ghost Wall Attack** (Acoustic claims collision; Optical proves clear):
  $$\text{If } d_{\text{US}} < 8.0\text{ cm} \land ir_1 == 0 \land ir_2 == 0:$$
  $$\text{Penalty}_{\text{ghost}} = 30.0\text{ pts}$$

### 5.2 Pillar 2: Kinematic Rate of Change & IMU Consistency
* Maximum plausible ground robot delta velocity: $450\text{ cm/s}$ ($4.5\text{ m/s}$).
  $$\Delta d = |d_t - d_{t-1}|, \quad \Delta t = t_t - t_{t-1}$$
  $$\text{Rate} = \frac{\Delta d}{\Delta t}$$
  $$\text{If } \text{Rate} > 450\text{ cm/s}: \quad \text{Penalty}_{\text{jitter}} = 20.0 + \min(25.0, (\text{Rate} - 450) \times 0.1)$$
* **Inertial Validation**: If $\text{Rate} > 150\text{ cm/s}$ but $\sqrt{a_x^2 + a_y^2} < 0.2\text{ m/s}^2$, flag acoustic drift.

### 5.3 Pillar 3: Sensor Replay & Zero-Variance Freeze
* Real-world sensors exhibit analog thermal and physical vibration noise.
  $$\sigma^2 = \frac{1}{N}\sum_{i=1}^{N}(d_i - \bar{d})^2$$
  $$\text{If } N \ge 12 \text{ frames and } \sigma^2 < 0.0001: \quad \text{Penalty}_{\text{freeze}} = 35.0\text{ pts}$$

### 5.4 Pillar 4: Persistence Escalator & Asymmetric EMA
* Transient noise (single dust speck) must not cause an emergency stop. However, consecutive anomalous cycles escalate exponentially:
  $$\text{Multiplier} = \min(2.5, 1.0 + (N_{\text{anomalous\_consecutive}} - 1) \times 0.35)$$
  $$\text{Penalty}_{\text{total}} = \min(100.0, (\text{P}_1 + \text{P}_2 + \text{P}_3) \times \text{Multiplier})$$
* **Asymmetric Exponential Moving Average**:
  $$\text{Target} = \max(0.0, 100.0 - \text{Penalty}_{\text{total}})$$
  $$\text{Score}_t = \begin{cases} 
  0.45 \cdot \text{Target} + 0.55 \cdot \text{Score}_{t-1}, & \text{if } \text{Target} < \text{Score}_{t-1} \text{ (Rapid brake)} \\
  0.18 \cdot \text{Target} + 0.82 \cdot \text{Score}_{t-1}, & \text{if } \text{Target} \ge \text{Score}_{t-1} \text{ (Cautious recovery)}
  \end{cases}$$

---

## 6. Deterministic Finite State Machine (FSM)

```
        Score >= 90% (Hysteresis low: 88%)
  ┌──────────────────────────────────────────────┐
  │                   NOMINAL                    │
  │     Speed: PWM 160 | Steering: Normal        │
  └──────┬────────────────────────────────┬──────┘
         │ Score < 90%                    │ Score < 65%
         ▼                                ▼
  ┌──────────────┐                 ┌──────────────┐
  │   DEGRADED   │ ──────────────> │  LIMP-HOME   │
  │ Speed: 110   │   Score < 65%   │ Speed: 60    │
  └──────┬───────┘                 └──────┬───────┘
         │                                │
         │         Score < 30%            │
         └──────────────┬─────────────────┘
                        ▼
         ┌──────────────────────────────┐
         │          SAFE-STOP           │
         │   PWM: 0 | Hardware Brake    │
         └──────────────────────────────┘
```

* **State Hysteresis**: A minimum of 3 consecutive frames with score above $(Threshold + 3\%)$ is required to step up a state, preventing rapid oscillation ("chattering") at boundary conditions.

---

## 7. Edge Firmware Safety Requirements

1. **Independent Watchdog Timer**: A FreeRTOS timer or `millis()` counter tracks the last valid host packet. If `current_millis - last_rx_millis > 1000`, firmware overrides PWM to 0 immediately.
2. **Fail-Safe Startup**: On boot or brownout reset, motor PWM defaults to 0 and holds until an explicit `resume` or valid command is received.
3. **Non-blocking UART/Bluetooth**: Never call `delay()` inside sensor loops; use timestamp deltas.

---

## 8. User Interface & Ground Station Specifications

1. **Operational Dashboard UI**:
   - Zero-clutter cockpit interface with real-time radial SVG Trust Gauge.
   - Smooth 60 FPS HTML5 Canvas graph tracking rolling score against state thresholds.
   - 2D Polar Field Radar visualizing ultrasonic range arc and digital IR proximity zones.
   - Attack Injector Deck: Instant 1-click injection of Blindspot, Ghost Wall, Replay Freeze, and EMP Jitter.
   - Actuator Control Bar: Immediate Manual E-Stop, Resume, and Steer angles ($45^\circ$, $90^\circ$, $135^\circ$).
   - Real-time Audit Stream: Timestamped, color-coded security transitions with exact physical justifications.
2. **Zero-Setup Connectivity**:
   - Web Serial API button to directly connect USB-attached ESP32 from Chrome.
   - WebSocket URL connector for headless Python Bridge on `ws://localhost:8765`.
   - Standalone offline `dashboard.html` for local air-gapped field deployment.
