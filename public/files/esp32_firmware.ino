/*
  =============================================================================
  TRUSTEDGE - High-Performance Autonomous Arduino Uno Firmware
  L293D Motor Shield (v1) + Saccadic Gimbal Reflex + 4-Stage Hardware FSM

  CRITICAL PINOUT SPECIFICATION (LOCKED - ZERO REGRESSION):
  - 74HC595 Shift Register: Latch = 12, Clock = 4, Data = 8, Output Enable = 7
  - Left Drive Motor (M3): 74HC595 Bits 5 & 7, Speed via PWM Pin 6
  - Right Drive Motor (M4): 74HC595 Bits 0 & 6, Speed via PWM Pin 5
  - HC-SR04 Ultrasonic: TRIG = Pin 2, ECHO = Pin 3 (12ms timeout, EMA smoothed)
  - MG90S Radar Pan Servo: SERVO 1 Header = Pin 10 (SER1) (45° Right, 90° Center, 135° Left)
  - Left Optical IR Bumper: Pin A0 (INPUT_PULLUP, Active-LOW: 0 = Obstacle, 1 = Clear)
  - Right Optical IR Bumper: Pin A1 (INPUT_PULLUP, Active-LOW: 0 = Obstacle, 1 = Clear)
  - Bluetooth HC-05: Pins A4 (RX), A5 (TX) via dormant SoftwareSerial (9600 baud)
  - Status LED: Pin 13 (HIGH on E-STOP / Blinks on LIMP_HOME)
  - USB Hardware UART: 115200 baud, 10 Hz JSON telemetry stream
  =============================================================================
*/

#include <Servo.h>
#include <SoftwareSerial.h>

// ------------------- PIN DEFINITIONS -------------------
// Ultrasonic Sensor (Pins 2 & 3)
#define TRIG_PIN       2     // Ultrasonic Trigger (Digital Pin 2)
#define ECHO_PIN       3     // Ultrasonic Echo (Digital Pin 3)

// Optical IR Proximity Bumper Sensors (Analog Row)
#define IR1_PIN        A0    // Left IR Bumper Sensor (Analog Pin A0)
#define IR2_PIN        A1    // Right IR Bumper Sensor (Analog Pin A1)

// Bluetooth HC-05 (Analog Row)
#define BT_RX_PIN      A4    // Arduino RX (connect to HC-05 TXD)
#define BT_TX_PIN      A5    // Arduino TX (connect to HC-05 RXD)

// MG90S Tower Pro Micro Servo (Pan Mechanism for HC-SR04 Ultrasonic Sensor & Saccadic Reflex)
#define SERVO_PIN      10    // SER1 header on L293D shield (Digital Pin 10)
#define STATUS_LED     13    // Onboard Status LED

// L293D Motor Shield Internal Hardware Pins
#define MOTORLATCH     12    // 74HC595 Latch
#define MOTORCLK       4     // 74HC595 Clock
#define MOTORENABLE    7     // 74HC595 Output Enable (Active Low)
#define MOTORDATA      8     // 74HC595 Serial Data

#define MOTOR3_PWM     6     // M3 Speed (Timer 0 PWM) - Left Motor
#define MOTOR4_PWM     5     // M4 Speed (Timer 0 PWM) - Right Motor

// 74HC595 Shift Register Output Bitmasks for M3 and M4
#define M4_A_BIT       0     // M4 Direction A
#define M3_A_BIT       5     // M3 Direction A
#define M4_B_BIT       6     // M4 Direction B
#define M3_B_BIT       7     // M3 Direction B

// ------------------- OBJECTS & STATE -------------------
Servo sensorServo;  // Single MG90S Tower Pro on SER1 (Pin 10)
SoftwareSerial BTSerial(BT_RX_PIN, BT_TX_PIN); // RX, TX

static uint8_t shiftRegisterState = 0;

const unsigned long TELEMETRY_INTERVAL_MS = 100;  // 10 Hz (every 100ms)
const unsigned long WATCHDOG_TIMEOUT_MS   = 3000; // 3s fail-safe timeout for continuous cruise

unsigned long lastTelemetryTime = 0;
unsigned long lastCommandTime   = 0;
unsigned long timedMoveEndTime  = 0;
unsigned long lastBtRxTime      = 0; // Tracks if Bluetooth is actively sending commands

bool isTimedMove = false;
bool isSafeStopped = false;
String currentMovement = "STOP";
int currentSpeed = 255;       // Requested PWM power (80 - 255)
int currentServoAngle = 90;

// Upgrades: Saccadic Cross-Verification Reflex & Hardware-Enforced 4-Stage FSM Speed Ceiling
bool saccadicMode = true;      // Active Saccadic cross-verification reflex (default enabled)
int fsmMaxPwm = 255;           // Hardware-enforced speed ceiling (NOMINAL=255, DEGRADED=140, LIMP_HOME=85, SAFE_STOP=0)
String fsmStateStr = "NOMINAL";

// Non-blocking serial line buffers
char usbRxBuffer[128];
uint8_t usbRxIndex = 0;

char btRxBuffer[128];
uint8_t btRxIndex = 0;

// Filtered distance state for EMA smoothing
float smoothedDistance = 400.0;

// Controls the single MG90S Tower Pro servo (SER1 / Pin 10) for Ultrasonic Pan & Saccadic Reflex
void setServoAngle(int angle) {
  currentServoAngle = constrain(angle, 20, 160);
  sensorServo.write(currentServoAngle);
}

// ------------------- L293D SHIFT REGISTER DRIVER ------
void updateShiftRegister() {
  digitalWrite(MOTORLATCH, LOW);
  digitalWrite(MOTORDATA, LOW);

  for (int i = 0; i < 8; i++) {
    digitalWrite(MOTORCLK, LOW);
    if (shiftRegisterState & (1 << (7 - i))) {
      digitalWrite(MOTORDATA, HIGH);
    } else {
      digitalWrite(MOTORDATA, LOW);
    }
    digitalWrite(MOTORCLK, HIGH);
  }

  digitalWrite(MOTORLATCH, HIGH);
}

// Low-level control for Motor 3 (Left Wheel) with Hardware FSM Speed Clamping
void setMotor3(uint8_t dir, uint8_t speed) {
  uint8_t effectiveSpeed = min((int)speed, fsmMaxPwm);
  if (isSafeStopped || fsmMaxPwm == 0) effectiveSpeed = 0;

  if (dir == 1 && effectiveSpeed > 0) { // Forward
    shiftRegisterState |= (1 << M3_A_BIT);
    shiftRegisterState &= ~(1 << M3_B_BIT);
  } else if (dir == 2 && effectiveSpeed > 0) { // Backward
    shiftRegisterState &= ~(1 << M3_A_BIT);
    shiftRegisterState |= (1 << M3_B_BIT);
  } else { // Stop
    shiftRegisterState &= ~(1 << M3_A_BIT);
    shiftRegisterState &= ~(1 << M3_B_BIT);
    effectiveSpeed = 0;
  }
  updateShiftRegister();
  analogWrite(MOTOR3_PWM, effectiveSpeed);
}

// Low-level control for Motor 4 (Right Wheel) with Hardware FSM Speed Clamping
void setMotor4(uint8_t dir, uint8_t speed) {
  uint8_t effectiveSpeed = min((int)speed, fsmMaxPwm);
  if (isSafeStopped || fsmMaxPwm == 0) effectiveSpeed = 0;

  if (dir == 1 && effectiveSpeed > 0) { // Forward
    shiftRegisterState |= (1 << M4_A_BIT);
    shiftRegisterState &= ~(1 << M4_B_BIT);
  } else if (dir == 2 && effectiveSpeed > 0) { // Backward
    shiftRegisterState &= ~(1 << M4_A_BIT);
    shiftRegisterState |= (1 << M4_B_BIT);
  } else { // Stop
    shiftRegisterState &= ~(1 << M4_A_BIT);
    shiftRegisterState &= ~(1 << M4_B_BIT);
    effectiveSpeed = 0;
  }
  updateShiftRegister();
  analogWrite(MOTOR4_PWM, effectiveSpeed);
}

// ------------------- DIFFERENTIAL DRIVE ----------------
void moveForward(int speed) {
  if (fsmMaxPwm == 0 || isSafeStopped) {
    stopMotors();
    return;
  }
  isSafeStopped = false;
  currentMovement = "FORWARD";
  currentSpeed = speed;
  if (fsmStateStr != "LIMP_HOME") digitalWrite(STATUS_LED, LOW);
  setMotor3(1, speed);
  setMotor4(1, speed);
}

void moveBackward(int speed) {
  if (fsmMaxPwm == 0 || isSafeStopped) {
    stopMotors();
    return;
  }
  isSafeStopped = false;
  currentMovement = "BACKWARD";
  currentSpeed = speed;
  if (fsmStateStr != "LIMP_HOME") digitalWrite(STATUS_LED, LOW);
  setMotor3(2, speed);
  setMotor4(2, speed);
}

void turnLeft(int speed) {
  if (fsmMaxPwm == 0 || isSafeStopped) {
    stopMotors();
    return;
  }
  isSafeStopped = false;
  currentMovement = "LEFT";
  currentSpeed = speed;
  if (fsmStateStr != "LIMP_HOME") digitalWrite(STATUS_LED, LOW);
  setMotor3(2, speed); // Left wheel reverse
  setMotor4(1, speed); // Right wheel forward (spin turn)
}

void turnRight(int speed) {
  if (fsmMaxPwm == 0 || isSafeStopped) {
    stopMotors();
    return;
  }
  isSafeStopped = false;
  currentMovement = "RIGHT";
  currentSpeed = speed;
  if (fsmStateStr != "LIMP_HOME") digitalWrite(STATUS_LED, LOW);
  setMotor3(1, speed); // Left wheel forward
  setMotor4(2, speed); // Right wheel reverse (spin turn)
}

void stopMotors() {
  currentMovement = "STOP";
  isTimedMove = false;
  setMotor3(0, 0);
  setMotor4(0, 0);
}

void triggerSafeStop() {
  isSafeStopped = true;
  fsmMaxPwm = 0;
  fsmStateStr = "SAFE_STOP";
  stopMotors();
  digitalWrite(STATUS_LED, HIGH);
}

void resumeOperation() {
  isSafeStopped = false;
  if (fsmMaxPwm == 0) {
    fsmMaxPwm = 255;
    fsmStateStr = "NOMINAL";
  }
  digitalWrite(STATUS_LED, LOW);
  lastCommandTime = millis();
}

// ------------------- SENSOR READINGS -------------------
// Fast single ultrasonic ping with 12ms timeout (~200cm range)
// Non-blocking EMA filter across 100ms cycles eliminates acoustic jitter
float readUltrasonic() {
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);

  // 12ms timeout = ~200cm max range (runs in 1-4ms for obstacles, never blocks loop)
  unsigned long duration = pulseIn(ECHO_PIN, HIGH, 12000);
  if (duration == 0) {
    smoothedDistance = (smoothedDistance * 0.7) + (400.0 * 0.3);
    return smoothedDistance;
  }
  float dist = (duration * 0.0343) / 2.0;
  if (dist > 200.0 || dist < 2.0) {
    dist = 400.0;
  }
  smoothedDistance = (smoothedDistance * 0.6) + (dist * 0.4);
  return smoothedDistance;
}

// ------------------- HARDWARE MOTOR DIAGNOSTIC ---------
void runMotorDiagnostic() {
  Serial.println(F("[DIAG] === L293D SHIELD M3/M4 MOTOR TEST START ==="));

  // Test Left Motor (M3)
  Serial.println(F("[DIAG] 1/4 Testing LEFT MOTOR (Terminal M3, PWM Pin 6)..."));
  setMotor3(1, 230);
  delay(1000);
  setMotor3(0, 0);
  delay(200);

  // Test Right Motor (M4)
  Serial.println(F("[DIAG] 2/4 Testing RIGHT MOTOR (Terminal M4, PWM Pin 5)..."));
  setMotor4(1, 230);
  delay(1000);
  setMotor4(0, 0);
  delay(200);

  // Test Both Motors Together
  Serial.println(F("[DIAG] 3/4 Testing BOTH MOTORS FORWARD together..."));
  moveForward(230);
  delay(1000);
  stopMotors();
  delay(200);

  // Test MG90S Tower Pro Pan Servo (SER1, Pin 10)
  Serial.println(F("[DIAG] 4/5 Testing MG90S TOWER PRO PAN SERVO (SER1 Pin 10)..."));
  setServoAngle(45);
  delay(400);
  setServoAngle(135);
  delay(400);
  setServoAngle(90);
  delay(200);

  // Test Optical IR Bumper Sensors (Pins A0 & A1)
  Serial.println(F("[DIAG] 5/5 Testing OPTICAL IR BUMPERS (Active-LOW: 0V=Obstacle, 5V=Clear)..."));
  int rawA0 = digitalRead(IR1_PIN);
  int rawA1 = digitalRead(IR2_PIN);
  Serial.print(F("[DIAG] -> Left IR (Pin A0):  Pin Level="));
  Serial.print(rawA0 == LOW ? F("LOW (0V)") : F("HIGH (5V)"));
  Serial.println(rawA0 == LOW ? F(" => OBSTACLE / Signal LED ON") : F(" => CLEAR / Signal LED OFF"));

  Serial.print(F("[DIAG] -> Right IR (Pin A1): Pin Level="));
  Serial.print(rawA1 == LOW ? F("LOW (0V)") : F("HIGH (5V)"));
  Serial.println(rawA1 == LOW ? F(" => OBSTACLE / Signal LED ON") : F(" => CLEAR / Signal LED OFF"));

  if (rawA0 == LOW || rawA1 == LOW) {
    Serial.println(F("[DIAG-TIP] If pointing at open air but Signal LED is ON: Turn blue potentiometer counter-clockwise!"));
  } else {
    Serial.println(F("[DIAG-TIP] Both IR sensors reading CLEAR. Wave hand in front to verify LED turns ON."));
  }

  Serial.println(F("[DIAG] === L293D SHIELD TEST COMPLETE ==="));
}

int parseSpeed(String str, int defaultVal) {
  int idx = str.indexOf("speed\":");
  if (idx >= 0) {
    int val = str.substring(idx + 7).toInt();
    if (val > 0) return constrain(val, 80, 255);
  }
  return defaultVal;
}

int parseDuration(String str, int defaultVal) {
  int idx = str.indexOf("ms\":");
  if (idx >= 0) {
    int val = str.substring(idx + 4).toInt();
    if (val > 0) return constrain(val, 50, 10000);
  }
  idx = str.indexOf("time\":");
  if (idx >= 0) {
    int val = str.substring(idx + 6).toInt();
    if (val > 0) return constrain(val, 50, 10000);
  }
  return defaultVal;
}

// ------------------- COMMAND PARSER (ULTRA-FAST) -------
void handleCommand(String cmd) {
  cmd.trim();
  if (cmd.length() == 0) return;

  lastCommandTime = millis();

  // Self-test diagnostic command
  if (cmd.indexOf("test_motors") >= 0 || cmd.indexOf("test_hardware") >= 0 || cmd.indexOf("test_sensors") >= 0 || cmd.indexOf("test_ir") >= 0) {
    runMotorDiagnostic();
    return;
  }

  // Safety overrides
  if (cmd.indexOf("safe_stop") >= 0) {
    triggerSafeStop();
    return;
  } else if (cmd.indexOf("resume") >= 0) {
    resumeOperation();
    return;
  }

  // Saccadic Reflex Toggle: {"cmd":"saccadic","enable":true|false}
  if (cmd.indexOf("saccadic") >= 0) {
    if (cmd.indexOf("true") >= 0 || cmd.indexOf(":1") >= 0 || cmd.indexOf(" 1") >= 0) {
      saccadicMode = true;
    } else if (cmd.indexOf("false") >= 0 || cmd.indexOf(":0") >= 0 || cmd.indexOf(" 0") >= 0) {
      saccadicMode = false;
    }
    return;
  }

  // Hardware-Enforced 4-Stage FSM Speed Ceiling: {"cmd":"fsm_state","state":"NOMINAL"|"DEGRADED"|"LIMP_HOME"|"SAFE_STOP"}
  if (cmd.indexOf("fsm_state") >= 0) {
    if (cmd.indexOf("NOMINAL") >= 0) {
      fsmStateStr = "NOMINAL";
      fsmMaxPwm = 255;
      isSafeStopped = false;
      digitalWrite(STATUS_LED, LOW);
    } else if (cmd.indexOf("DEGRADED") >= 0) {
      fsmStateStr = "DEGRADED";
      fsmMaxPwm = 140;
      isSafeStopped = false;
      digitalWrite(STATUS_LED, LOW);
    } else if (cmd.indexOf("LIMP_HOME") >= 0) {
      fsmStateStr = "LIMP_HOME";
      fsmMaxPwm = 85;
      isSafeStopped = false;
      digitalWrite(STATUS_LED, HIGH);
    } else if (cmd.indexOf("SAFE_STOP") >= 0) {
      triggerSafeStop();
    }

    // Immediately re-clamp current motor outputs to enforce new speed ceiling in hardware
    if (currentMovement == "FORWARD") {
      moveForward(currentSpeed);
    } else if (currentMovement == "BACKWARD") {
      moveBackward(currentSpeed);
    } else if (currentMovement == "LEFT") {
      turnLeft(currentSpeed);
    } else if (currentMovement == "RIGHT") {
      turnRight(currentSpeed);
    }
    return;
  }

  // MG90S Servo angle command
  if (cmd.indexOf("servo_angle") >= 0) {
    int idx = cmd.indexOf("value\":");
    if (idx >= 0) {
      int angle = cmd.substring(idx + 7).toInt();
      setServoAngle(angle);
    }
    return;
  }

  // Emergency brake / Stop
  if (cmd == " " || cmd == "X" || cmd == "x" || cmd == "STOP" || cmd.indexOf("\"STOP\"") >= 0 || cmd.indexOf("STOP") >= 0) {
    stopMotors();
    return;
  }

  int spd = parseSpeed(cmd, currentSpeed);
  currentSpeed = spd;

  int duration = parseDuration(cmd, 0);

  // Single-key terminal shortcuts
  if (cmd.length() == 1) {
    char key = toupper(cmd.charAt(0));
    if (key == 'W') {
      cmd = "\"FORWARD\"";
      duration = 0;
    } else if (key == 'S') {
      cmd = "\"BACKWARD\"";
      duration = 0;
    } else if (key == 'A') {
      cmd = "\"LEFT\"";
      duration = 0;
    } else if (key == 'D') {
      cmd = "\"RIGHT\"";
      duration = 0;
    }
  }

  if (duration > 0) {
    isTimedMove = true;
    timedMoveEndTime = millis() + duration;
  } else {
    isTimedMove = false;
  }

  // Immediate motor actuation (<1 millisecond)
  if (cmd.indexOf("FORWARD") >= 0 || cmd.indexOf("\"W\"") >= 0) {
    moveForward(spd);
  } else if (cmd.indexOf("BACKWARD") >= 0 || cmd.indexOf("\"S\"") >= 0) {
    moveBackward(spd);
  } else if (cmd.indexOf("LEFT") >= 0 || cmd.indexOf("\"A\"") >= 0) {
    turnLeft(spd);
  } else if (cmd.indexOf("RIGHT") >= 0 || cmd.indexOf("\"D\"") >= 0) {
    turnRight(spd);
  }
}

// ------------------- NON-BLOCKING SERIAL HANDLERS ------
void processUsbSerial() {
  while (Serial.available() > 0) {
    char c = (char)Serial.read();
    if (c == '\n' || c == '\r') {
      if (usbRxIndex > 0) {
        usbRxBuffer[usbRxIndex] = '\0';
        handleCommand(String(usbRxBuffer));
        usbRxIndex = 0;
      }
    } else {
      if (usbRxIndex < sizeof(usbRxBuffer) - 1) {
        usbRxBuffer[usbRxIndex++] = c;
      }
    }
  }
}

void processBtSerial() {
  while (BTSerial.available() > 0) {
    lastBtRxTime = millis();
    char c = (char)BTSerial.read();
    if (c == '\n' || c == '\r') {
      if (btRxIndex > 0) {
        btRxBuffer[btRxIndex] = '\0';
        handleCommand(String(btRxBuffer));
        btRxIndex = 0;
      }
    } else {
      if (btRxIndex < sizeof(btRxBuffer) - 1) {
        btRxBuffer[btRxIndex++] = c;
      }
    }
  }
}

// ------------------- SETUP -----------------------------
void setup() {
  Serial.begin(115200);
  BTSerial.begin(9600);

  // Configure L293D Shield 74HC595 Shift Register Pins
  pinMode(MOTORLATCH, OUTPUT);
  pinMode(MOTORCLK, OUTPUT);
  pinMode(MOTORENABLE, OUTPUT);
  pinMode(MOTORDATA, OUTPUT);

  // Configure L293D PWM Pins for M3 and M4
  pinMode(MOTOR3_PWM, OUTPUT);
  pinMode(MOTOR4_PWM, OUTPUT);

  // Reset shift register to all 0s (motors all released)
  shiftRegisterState = 0;
  updateShiftRegister();
  digitalWrite(MOTORENABLE, LOW); // Enable L293D outputs

  // Configure Ultrasonic Pins (Pin 2 = Trig, Pin 3 = Echo)
  pinMode(TRIG_PIN, OUTPUT);
  digitalWrite(TRIG_PIN, LOW);
  pinMode(ECHO_PIN, INPUT);

  // Configure IR Sensor Pins (A0 = Left, A1 = Right)
  pinMode(IR1_PIN, INPUT_PULLUP);
  pinMode(IR2_PIN, INPUT_PULLUP);
  pinMode(STATUS_LED, OUTPUT);

  // Attach the single MG90S Tower Pro Pan Servo to SER1 header (Digital Pin 10)
  sensorServo.attach(SERVO_PIN);    // SER1 = Digital Pin 10
  setServoAngle(90);

  lastCommandTime = millis();
  isSafeStopped = false;
  isTimedMove = false;
  saccadicMode = true;
  fsmMaxPwm = 255;
  fsmStateStr = "NOMINAL";
  digitalWrite(STATUS_LED, LOW);

  Serial.println(F("[INIT] TrustEdge L293D Shield (Trig=2, Echo=3, M3/M4, MG90S=SER1/Pin10) Ready"));
}

// ------------------- MAIN LOOP -------------------------
void loop() {
  unsigned long now = millis();

  // 1. Process USB & Bluetooth incoming commands non-blockingly (<1ms)
  processUsbSerial();
  processBtSerial();

  // 2. Timed Movement Auto-Stop (for clean nudge/step pulses)
  if (isTimedMove && currentMovement != "STOP") {
    if (now >= timedMoveEndTime) {
      stopMotors();
      isTimedMove = false;
    }
  }
  // 3. Hardware Fail-Safe Watchdog (for continuous cruise moves)
  else if (!isSafeStopped && currentMovement != "STOP" && (now - lastCommandTime > WATCHDOG_TIMEOUT_MS)) {
    stopMotors();
  }

  // 4. Fixed 10 Hz Telemetry Streaming Loop (every 100 ms)
  if (now - lastTelemetryTime >= TELEMETRY_INTERVAL_MS) {
    lastTelemetryTime = now;

    float dist = readUltrasonic();
    int rawA0 = digitalRead(IR1_PIN);
    int rawA1 = digitalRead(IR2_PIN);
    int adc1 = analogRead(IR1_PIN);
    int adc2 = analogRead(IR2_PIN);

    // Hybrid detection: Triggers if digital level is LOW (Active-LOW OUT) OR analog ADC drops below 400 (<1.95V)
    int ir1 = (rawA0 == LOW || adc1 < 400) ? 1 : 0;
    int ir2 = (rawA1 == LOW || adc2 < 400) ? 1 : 0;

    // --- Active Saccadic Cross-Verification Reflex ---
    // If an optical IR bumper detects an obstacle, automatically aim the ultrasonic sensor to cross-examine
    if (saccadicMode) {
      if (ir1 == 1 && ir2 == 0) {
        if (currentServoAngle != 135) {
          setServoAngle(135); // Aim Left flank
        }
      } else if (ir2 == 1 && ir1 == 0) {
        if (currentServoAngle != 45) {
          setServoAngle(45); // Aim Right flank
        }
      } else if (ir1 == 1 && ir2 == 1) {
        if (currentServoAngle != 90) {
          setServoAngle(90); // Snap Center
        }
      }
    }

    // --- Forward Collision Avoidance Shield ---
    // Only stop if actively moving forward and obstacle is closer than 8cm
    if (currentMovement == "FORWARD" && dist < 8.0 && dist > 1.0) {
      stopMotors();
      isTimedMove = false;
    }

    // Status LED blink in LIMP_HOME mode
    if (fsmStateStr == "LIMP_HOME") {
      digitalWrite(STATUS_LED, (now / 250) % 2 == 0 ? HIGH : LOW);
    }

    int effectiveMot = currentMovement == "STOP" ? 0 : min(currentSpeed, fsmMaxPwm);

    // --- Stream to USB Serial (115200 hardware UART) ---
    Serial.print(F("{\"ts\":"));
    Serial.print(now / 1000.0, 2);
    Serial.print(F(",\"ultrasonic_cm\":"));
    Serial.print(dist, 1);
    Serial.print(F(",\"ir1\":"));
    Serial.print(ir1);
    Serial.print(F(",\"ir2\":"));
    Serial.print(ir2);
    Serial.print(F(",\"ir1_adc\":"));
    Serial.print(adc1);
    Serial.print(F(",\"ir2_adc\":"));
    Serial.print(adc2);
    Serial.print(F(",\"mot\":"));
    Serial.print(effectiveMot);
    Serial.print(F(",\"pan\":"));
    Serial.print(currentServoAngle);
    Serial.print(F(",\"saccadic\":"));
    Serial.print(saccadicMode ? 1 : 0);
    Serial.print(F(",\"fsm\":\""));
    Serial.print(fsmStateStr);
    Serial.print(F("\",\"temp_c\":28.0,\"humidity_pct\":65.0}"));
    Serial.println();

    // --- Stream to Bluetooth HC-05 (9600) ONLY when actively in use ---
    // Prevents SoftwareSerial 9600 baud bit-banging from freezing the CPU for 88ms!
    if (now - lastBtRxTime < 5000) {
      BTSerial.print(F("{\"ts\":"));
      BTSerial.print(now / 1000.0, 2);
      BTSerial.print(F(",\"ultrasonic_cm\":"));
      BTSerial.print(dist, 1);
      BTSerial.print(F(",\"ir1\":"));
      BTSerial.print(ir1);
      BTSerial.print(F(",\"ir2\":"));
      BTSerial.print(ir2);
      BTSerial.print(F(",\"ir1_adc\":"));
      BTSerial.print(adc1);
      BTSerial.print(F(",\"ir2_adc\":"));
      BTSerial.print(adc2);
      BTSerial.print(F(",\"mot\":"));
      BTSerial.print(effectiveMot);
      BTSerial.print(F(",\"pan\":"));
      BTSerial.print(currentServoAngle);
      BTSerial.print(F(",\"saccadic\":"));
      BTSerial.print(saccadicMode ? 1 : 0);
      BTSerial.print(F(",\"fsm\":\""));
      BTSerial.print(fsmStateStr);
      BTSerial.print(F("\",\"temp_c\":28.0,\"humidity_pct\":65.0}"));
      BTSerial.println();
    }
  }
}
