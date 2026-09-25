# TRUSTEDGE: Autonomous Sensor Spoofing Detection & Fail-Safe System
### Complete Software Stack, Firmware, Hardware Wiring & "5-Year-Old" Hackathon Guide

---

## 🧸 The 5-Year-Old Explanation: What Does TRUSTEDGE Do?

Imagine you are walking in a dark hallway.
* Your **Ears** (Ultrasonic sensor) listen for sound echoes to tell you how far the wall is.
* Your **Hands** (Infrared sensors) feel directly in front of you.

Now, imagine an evil prankster with a high-tech speaker plays a fake echo that tricks your ears into believing: *"The wall is 20 feet away! Run as fast as you can!"*
If you only listened to your ears, you would sprint straight into a brick wall! 💥

**This is called "Sensor Spoofing"**, and autonomous cars and delivery robots get attacked like this all the time.

**Enter TRUSTEDGE:**
TRUSTEDGE is the robot's smart gut instinct. When your ears say *"Path clear, 150 cm away!"* but your hands say *"Wait, I'm touching a wall right now!"*, TRUSTEDGE immediately catches the lie.
1. It slashes the robot's **Trust Score** from 100% to 15%.
2. It transitions the robot through deterministic safety states (`NOMINAL` ➔ `DEGRADED` ➔ `LIMP-HOME` ➔ `SAFE-STOP`).
3. Within **100 milliseconds**, it cuts motor power to zero and locks the brakes!

---

## 📐 System Architecture

```
+-------------------------------------------------------------+
|                     ESP32 HARDWARE NODE                     |
|  [HC-SR04]  [2x IR Sensors]  [PIR]  [DHT11]  [Servo/Motors] |
|                               |                             |
|          Polls @ 10Hz, formats raw JSON, runs watchdog      |
+------------------------------+------------------------------+
                               |
                   HC-05 Bluetooth Serial (115200 baud)
                               |
                               v
+-------------------------------------------------------------+
|                   PYTHON BRIDGE SERVICE                     |
|              (Auto-reconnect, bidirectional queue)          |
+------------------------------+------------------------------+
                               |
                               v
+-------------------------------------------------------------+
|                 PYTHON TRUST ENGINE & FSM                   |
|  * Rolling 2-second time window (20 samples)                |
|  * Cross-modal agreement checks                             |
|  * Jitter / variance / replay freeze detection              |
|  * Persistence penalty multiplier                           |
|  * Deterministic state transitions (100% -> 0%)             |
|  * WebSocket Server (ws://localhost:8765)                   |
+------------------------------+------------------------------+
                               |
                               v
+-------------------------------------------------------------+
|             SINGLE-FILE STATIC HTML/JS DASHBOARD            |
|  * Trust Score SVG Gauge & Canvas 60fps trendline           |
|  * Real-time multi-sensor telemetry table                   |
|  * Interactive Spoof Injection buttons                      |
|  * Actuator Safe-Stop / Steering command controls           |
+-------------------------------------------------------------+
```

---

## 🔌 Hardware Wiring & Pinout Guide

| Sensor / Actuator | Sensor Pin | ESP32 GPIO Pin | Description / Function |
|---|---|---|---|
| **HC-SR04 Ultrasonic** | VCC | 5V (VIN) | Power |
| | GND | GND | Ground |
| | TRIG | **GPIO 5** | Trigger pulse output |
| | ECHO | **GPIO 18** | Echo pulse input (Use 1kΩ/2kΩ divider if needed) |
| **IR Proximity 1 (Left)** | VCC | 3.3V or 5V | Power |
| | GND | GND | Ground |
| | OUT | **GPIO 19** | Digital output (0 = obstacle, 1 = clear) |
| **IR Proximity 2 (Right)** | VCC | 3.3V or 5V | Power |
| | GND | GND | Ground |
| | OUT | **GPIO 21** | Digital output (0 = obstacle, 1 = clear) |
| **PIR Motion Sensor** | VCC | 5V | Power |
| | GND | GND | Ground |
| | OUT | **GPIO 22** | Digital motion detect |
| **DHT11 Temp/Humidity** | VCC | 3.3V / 5V | Power |
| | GND | GND | Ground |
| | DATA | **GPIO 4** | 1-Wire serial bus |
| **SG90 Micro Servo** | SIG | **GPIO 13** | PWM Angle Control |
| | VCC / GND | 5V / GND | Dedicated 5V rail recommended |
| **Motor Driver (L298N)** | ENA (PWM Left) | **GPIO 25** | Left Motor Speed (PWM) |
| | IN1 (Dir Left) | **GPIO 26** | Left Direction |
| | ENB (PWM Right) | **GPIO 27** | Right Motor Speed (PWM) |
| | IN3 (Dir Right) | **GPIO 14** | Right Direction |
| **HC-05 Bluetooth** | VCC | 5V | Power |
| | GND | GND | Ground |
| | TXD | **ESP32 RX0 (GPIO 3)** | Serial TX to ESP32 RX |
| | RXD | **ESP32 TX0 (GPIO 1)** | Serial RX from ESP32 TX (via divider) |

---

## 📋 Universal Data Contract

### 1. Sensor Telemetry (ESP32 ➔ Laptop @ 10Hz, newline-terminated JSON):
```json
{
  "ts": 1732000000.123,
  "ultrasonic_cm": 48.2,
  "ir1": 0,
  "ir2": 0,
  "pir": 0,
  "temp_c": 29.4,
  "humidity_pct": 68.1
}
```
*(ir1, ir2, and pir are 0 for clear and 1 for triggered)*

### 2. Outgoing Commands (Laptop ➔ ESP32, newline-terminated JSON):
```json
{"cmd": "safe_stop"}
{"cmd": "servo_angle", "value": 90}
{"cmd": "resume"}
```

---

## 🚀 How to Build & Run in 4 Steps (The 5-Year-Old Guide)

### Step 1: Test with NO Hardware (Terminal Mocking)
You don't even need the ESP32 plugged in yet!
Open your terminal and run:
```bash
cd trustedge
pip install websockets pyserial

# Run the interactive CLI test
python3 mock_generator.py
```
* Press **`n`** for normal roaming (Score stays ~100%, state is `NOMINAL`).
* Press **`b`** to inject a **Blindspot Attack** (Ultrasonic is spoofed to 135cm while IR is touching an obstacle). Watch the score instantly collapse to `SAFE-STOP`!
* Press **`g`** for **Ghost Wall Attack**.
* Press **`f`** for **Sensor Freeze / Replay Attack**.
* Press **`j`** for **Acoustic Jitter / EMP noise**.

---

### Step 2: Flash the ESP32 Firmware
1. Open the **Arduino IDE**.
2. Go to **Tools ➔ Board ➔ ESP32 Arduino ➔ ESP32 Dev Module**.
3. Open Library Manager (**Sketch ➔ Include Library ➔ Manage Libraries**) and install:
   - `ArduinoJson` (by Benoit Blanchon, v6 or v7)
   - `ESP32Servo` (by Kevin Harrington)
   - `DHT sensor library` (by Adafruit)
4. Open `trustedge/esp32_firmware.ino`.
5. Connect your ESP32 via USB and click **Upload** (arrow icon).
6. Open the Serial Monitor at **115200 baud**. You will immediately see lines of JSON telemetry streaming at 10 times a second!

---

### Step 3: Pair Bluetooth & Start Bridge Service
1. On your laptop, open Bluetooth settings.
2. Search for **HC-05** (default PIN is usually `1234` or `0000`).
3. Pair the device.
   - On **Linux**: Bind the serial port:
     ```bash
     sudo rfcomm bind 0 00:21:13:01:23:45 1
     python3 bridge_service.py --port /dev/rfcomm0
     ```
   - On **macOS**:
     ```bash
     python3 bridge_service.py --port /dev/tty.HC-05-DevB
     ```
   - On **Windows**:
     ```bash
     python3 bridge_service.py --port COM4
     ```
*(Tip: Run `python3 bridge_service.py --list-ports` to auto-detect your port!)*

The Bridge will auto-reconnect if Bluetooth drops and forward telemetry to the Trust Engine and WebSocket server on `ws://localhost:8765`.

---

### Step 4: Open the Live Dashboard
No npm build, no node server needed!
Simply double-click `trustedge/dashboard.html` to open it in **Google Chrome**, **Firefox**, or **Edge**.
* It automatically connects to `ws://localhost:8765`.
* Watch the live gauge, 60fps smoothed canvas graph, and sensor badges.
* Click any of the **"Inject Spoof"** buttons to showcase live defense to judges!

---

## 🏆 Hackathon Judge Presentation Script (30 Seconds to Win)

1. **The Hook:**
   > *"Judges, every autonomous vehicle on the road trusts its sensors blindly. If someone shines a laser at a camera, dampens an acoustic echo, or injects replay frames, existing rovers drive straight into collisions."*
2. **The Demo:**
   > *"Here is TRUSTEDGE running on an ESP32 robot. Our dashboard shows 100% Trust in NOMINAL state. Now watch this—I am going to simulate an acoustic spoof attack where the attacker tricks the ultrasonic sensor into claiming 140 centimeters of empty clearance while a real wall is 5 centimeters away."*
3. **The Climax:**
   > *(Click "Inject Blindspot Attack")*
   > *"Boom! Within 100 milliseconds, our cross-modal arbitration engine detects the contradiction with the infrared proximity array. The Trust Score drops from 100% to 18%, forcing an immediate transition from NOMINAL to SAFE-STOP. Motor PWM is cut to 0. The robot is saved, completely deterministically, without relying on slow or non-deterministic cloud AI!"*
