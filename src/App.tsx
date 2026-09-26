/**
 * TRUSTEDGE - Autonomous Rover Ground Station & Hardware Cockpit
 * 100% Real Hardware Mode — connects directly to Arduino Uno via COM port (USB / Bluetooth HC-05).
 * 
 * UPGRADED FEATURES (ZERO REGRESSION):
 * - 3-Pillar Mathematical Trust Engine (Cross-Modal Physics, Kinematic Jitter Gate, Replay Freeze Detection)
 * - Persistence Escalator & Asymmetric EMA Smoothing (Fast sub-100ms attack drop, cautious recovery)
 * - 4-Stage Deterministic Safety FSM (NOMINAL, DEGRADED, LIMP_HOME, SAFE_STOP) with Live Hardware Dispatch
 * - Active Saccadic Cross-Verification Reflex (MG90S Servo aims at triggered IR bumper to cross-examine)
 * - Cyber-Physical Attack Injection & Verification Deck (1-Click Spoof injections for live verification)
 * - Real-Time Zero-Latency WASD Drive, Cruise, and Step Modes via Persistent Web Serial Writer
 * - Ultrasonic Radar Arc with live panning and Auto-Sweep
 * - Bracket-Matching Streaming JSON Parser
 */

import React, { useState, useEffect, useRef } from "react";
import {
  Activity,
  Play,
  Zap,
  Download,
  Flame,
  X,
  FileDown,
  Car,
  Usb,
  Bluetooth,
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  Square,
  Terminal,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  Radio,
  Layers,
  HelpCircle,
  Sliders,
  Compass,
  Radar,
  ShieldAlert,
  ShieldCheck,
  Eye
} from "lucide-react";

export type FsmState = "NOMINAL" | "DEGRADED" | "LIMP_HOME" | "SAFE_STOP";
export type SpoofAttackType = "NONE" | "BLINDSPOT" | "GHOST_WALL" | "REPLAY_FREEZE" | "KINEMATIC_JITTER";

interface TelemetryPacket {
  ts: number;
  ultrasonic_cm: number;
  ir1: number;
  ir2: number;
  ir1_adc?: number;
  ir2_adc?: number;
  pir: number;
  temp_c: number;
  humidity_pct: number;
  mot: number;
  pan: number;
  saccadic?: number;
  fsm?: string;
}

interface PenaltiesBreakdown {
  crossModal: number;
  jitter: number;
  freeze: number;
  persistenceMult: number;
  activeReason: string;
}

interface AuditLog {
  id: number;
  time: string;
  state: FsmState;
  text: string;
}

const FILE_DOWNLOADS = [
  { name: "test_suite.py", path: "/files/test_suite.py", label: "Automated Safety Benchmark Suite", type: "Python", size: "7 KB" },
  { name: "PRD.md", path: "/files/PRD.md", label: "Project Requirements Document", type: "Markdown", size: "11 KB" },
  { name: "PROMPT.md", path: "/files/PROMPT.md", label: "Master AI Engineering Guide", type: "Markdown", size: "6 KB" },
  { name: "PROJECT_REPORT.md", path: "/files/PROJECT_REPORT.md", label: "Full Technical Report & Defense Guide", type: "Markdown", size: "14 KB" },
  { name: "trust_engine.py", path: "/files/trust_engine.py", label: "Safety Engine & Decision Rules", type: "Python", size: "11 KB" },
  { name: "mock_generator.py", path: "/files/mock_generator.py", label: "Sensor Stream Generator", type: "Python", size: "6 KB" },
  { name: "bridge_service.py", path: "/files/bridge_service.py", label: "Bluetooth Bridge Service", type: "Python", size: "7 KB" },
  { name: "esp32_firmware.ino", path: "/files/esp32_firmware.ino", label: "Arduino Uno Firmware Sketch", type: "Arduino C++", size: "16 KB" },
  { name: "dashboard.html", path: "/files/dashboard.html", label: "Single-File Static Dashboard", type: "HTML/JS", size: "23 KB" },
  { name: "README.md", path: "/files/README.md", label: "Pinout & Easy Guide", type: "Markdown", size: "9 KB" },
];

export default function App() {
  // Safety FSM State
  const [trustScore, setTrustScore] = useState<number>(100.0);
  const [safetyState, setSafetyState] = useState<FsmState>("NOMINAL");
  const [packetCount, setPacketCount] = useState<number>(0);
  const [packetRateHz, setPacketRateHz] = useState<number>(0);

  // Modals & UI Toggles
  const [showDownloadsModal, setShowDownloadsModal] = useState<boolean>(false);
  const [showWiringModal, setShowWiringModal] = useState<boolean>(false);
  const [pauseMonitor, setPauseMonitor] = useState<boolean>(false);

  // Hardware Connection State
  const [serialBaud, setSerialBaud] = useState<number>(115200);
  const [serialConnected, setSerialConnected] = useState<boolean>(false);
  const [connectionType, setConnectionType] = useState<"bluetooth" | "usb" | null>(null);
  const [portInfo, setPortInfo] = useState<string>("");

  // Raw Serial Lines Log
  const [rawSerialLines, setRawSerialLines] = useState<string[]>([]);
  const [customCommandInput, setCustomCommandInput] = useState<string>("");

  // Rover Drive State
  const [driveDirection, setDriveDirection] = useState<"STOP" | "FORWARD" | "BACKWARD" | "LEFT" | "RIGHT">("STOP");
  const [driveMode, setDriveMode] = useState<"step" | "cruise" | "hold">("hold");
  const [motorPwmSpeed, setMotorPwmSpeed] = useState<number>(255); // 80 - 255 (defaults to 255 for max torque)
  const [isKeyboardDriveActive, setIsKeyboardDriveActive] = useState<boolean>(true);
  const [pressedKey, setPressedKey] = useState<string | null>(null);

  // MG90S Ultrasonic Sensor Servo Pan State
  const [radarPanAngle, setRadarPanAngle] = useState<number>(90); // 90 is center
  const [isAutoScanning, setIsAutoScanning] = useState<boolean>(false);

  // Saccadic Reflex & Cyber-Physical Attack Injection State
  const [isSaccadicEnabled, setIsSaccadicEnabled] = useState<boolean>(true);
  const [spoofAttack, setSpoofAttack] = useState<SpoofAttackType>("NONE");
  const spoofAttackRef = useRef<SpoofAttackType>("NONE");
  spoofAttackRef.current = spoofAttack;
  const jitterToggleRef = useRef<boolean>(false);

  // Web Serial Port & Stream Refs
  const serialPortRef = useRef<any>(null);
  const readerRef = useRef<any>(null);
  const writerRef = useRef<any>(null);
  const keepReadingRef = useRef<boolean>(false);
  const packetCountRef = useRef<number>(0);
  const driveDirectionRef = useRef<string>("STOP");
  driveDirectionRef.current = driveDirection;
  const driveModeRef = useRef<"step" | "cruise" | "hold">("hold");
  driveModeRef.current = driveMode;
  const encoderRef = useRef(new TextEncoder());

  // 3-Pillar Mathematical Trust Engine State Refs
  const telemetryHistoryRef = useRef<Array<{ ts: number; us: number; pan: number; mot: number; ir1: number; ir2: number }>>([]);
  const persistenceCountRef = useRef<number>(0);
  const trustScoreRef = useRef<number>(100.0);
  const lastSentFsmStateRef = useRef<FsmState>("NOMINAL");

  // Live Telemetry (starts at zero — populated strictly by hardware)
  const [telemetry, setTelemetry] = useState<TelemetryPacket>({
    ts: 0,
    ultrasonic_cm: 0,
    ir1: 0,
    ir2: 0,
    pir: 0,
    temp_c: 0,
    humidity_pct: 0,
    mot: 0,
    pan: 90,
    saccadic: 1,
    fsm: "NOMINAL",
  });

  const [isEmergencyBrake, setIsEmergencyBrake] = useState<boolean>(false);

  // Safety breakdown
  const [penalties, setPenalties] = useState<PenaltiesBreakdown>({
    crossModal: 0,
    jitter: 0,
    freeze: 0,
    persistenceMult: 1.0,
    activeReason: "",
  });

  // Activity Log
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([
    { id: 1, time: "Ready", state: "NOMINAL", text: "TrustEdge Hardware Cockpit ready. 3-Pillar Mathematical Trust Engine armed." },
  ]);

  const addLog = (state: FsmState, text: string) => {
    const timeStr = new Date().toLocaleTimeString();
    setAuditLogs((prev) => [{ id: Date.now(), time: timeStr, state, text }, ...prev.slice(0, 40)]);
  };

  // Rolling score history for Canvas Chart
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pendingRawLinesRef = useRef<string[]>([]);
  const hasNewSerialLinesRef = useRef<boolean>(false);
  const animFrameRef = useRef<number | null>(null);

  const scheduleDraw = () => {
    if (animFrameRef.current !== null) return;
    animFrameRef.current = requestAnimationFrame(() => {
      drawChart();
      animFrameRef.current = null;
    });
  };

  // High-performance background timers (Rate calculator & 3 Hz Terminal Flusher)
  useEffect(() => {
    let lastCount = 0;
    const interval = setInterval(() => {
      const current = packetCountRef.current;
      const hz = current - lastCount;
      lastCount = current;
      setPacketRateHz(hz);
      setPacketCount(current);
    }, 1000);

    // Flush serial terminal ONLY when actual new data has arrived (at most 3 Hz)
    const termInterval = setInterval(() => {
      if (hasNewSerialLinesRef.current && !pauseMonitor) {
        hasNewSerialLinesRef.current = false;
        setRawSerialLines([...pendingRawLinesRef.current]);
      }
    }, 300);

    return () => {
      clearInterval(interval);
      clearInterval(termInterval);
      if (animFrameRef.current !== null) {
        cancelAnimationFrame(animFrameRef.current);
      }
    };
  }, [pauseMonitor]);

  // Periodic Watchdog Heartbeat: sends keepalive to Arduino Uno every 500ms when continuous cruise is active
  useEffect(() => {
    if (!serialConnected || isEmergencyBrake) return;
    const timer = setInterval(() => {
      if (driveDirectionRef.current !== "STOP" && driveModeRef.current === "cruise") {
        sendCarCommand({ cmd: "drive", dir: driveDirectionRef.current, speed: motorPwmSpeed }, true);
      }
    }, 500);
    return () => clearInterval(timer);
  }, [serialConnected, isEmergencyBrake, motorPwmSpeed, driveMode]);

  // MG90S Auto-Scan Radar Sweep Routine
  useEffect(() => {
    if (!isAutoScanning || !serialConnected) return;
    const angles = [45, 90, 135, 90];
    let step = 0;
    const sweepInterval = setInterval(() => {
      step = (step + 1) % angles.length;
      const targetAngle = angles[step];
      setRadarPanAngle(targetAngle);
      sendCarCommand({ cmd: "servo_angle", value: targetAngle }, true);
    }, 700);
    return () => clearInterval(sweepInterval);
  }, [isAutoScanning, serialConnected]);

  // Keyboard Driving Listener (W, A, S, D, Arrows, Space)
  useEffect(() => {
    if (!isKeyboardDriveActive || !serialConnected) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      const key = e.key.toUpperCase();

      if (key === "W" || key === "ARROWUP") {
        e.preventDefault();
        setPressedKey("W");
        executeDrive("FORWARD");
      } else if (key === "S" || key === "ARROWDOWN") {
        e.preventDefault();
        setPressedKey("S");
        executeDrive("BACKWARD");
      } else if (key === "A" || key === "ARROWLEFT") {
        e.preventDefault();
        setPressedKey("A");
        executeDrive("LEFT");
      } else if (key === "D" || key === "ARROWRIGHT") {
        e.preventDefault();
        setPressedKey("D");
        executeDrive("RIGHT");
      } else if (key === " " || key === "SPACE") {
        e.preventDefault();
        setPressedKey("SPACE");
        executeDrive("STOP");
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      const key = e.key.toUpperCase();
      if (["W", "S", "A", "D", "ARROWUP", "ARROWDOWN", "ARROWLEFT", "ARROWRIGHT"].includes(key)) {
        setPressedKey(null);
        // Only stop on key release if in Hold-to-drive mode!
        // In Step mode (1.0s pulse) and Cruise mode (continuous), releasing the key does NOT kill movement!
        if (driveModeRef.current === "hold") {
          executeDrive("STOP");
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [isKeyboardDriveActive, serialConnected, motorPwmSpeed, isEmergencyBrake, driveMode]);

  // ============================================================
  // 3-PILLAR MATHEMATICAL TRUST ENGINE & 4-STAGE SAFETY FSM
  // ============================================================
  const evaluateSafety = (dist: number, ir1: number, ir2: number, pan: number, mot: number) => {
    let p1Penalty = 0;
    let p2Penalty = 0;
    let p3Penalty = 0;
    let reasons: string[] = [];

    const history = telemetryHistoryRef.current;
    const prevFrame = history.length > 0 ? history[history.length - 1] : null;

    // -------------------------------------------------------------
    // PILLAR 1: Cross-Modal Physics Arbitration
    // -------------------------------------------------------------
    // A. Blindspot / Absorption Attack: Optical IR sees obstacle (<10cm) but Acoustic reads clear (>35cm)
    if ((ir1 === 1 || ir2 === 1) && dist > 35.0) {
      p1Penalty = 60;
      reasons.push("BLINDSPOT VIOLATION: Optical IR sees obstacle (<10cm) but Acoustic reads clear");
    }
    // B. Ghost Wall Spoof: Acoustic crash reported (<15cm) directly ahead (pan == 90) but Optical IRs are clear
    else if (dist < 15.0 && ir1 === 0 && ir2 === 0 && pan === 90) {
      p1Penalty = 45;
      reasons.push("GHOST WALL SPOOF: Acoustic crash reported (<15cm) but Optical IRs are clear");
    }

    // -------------------------------------------------------------
    // PILLAR 2: Kinematic Velocity / Jitter Gate
    // -------------------------------------------------------------
    // If pan hasn't changed and distance jumps > 75cm within a single 100ms cycle
    if (prevFrame && pan === prevFrame.pan && Math.abs(dist - prevFrame.us) > 75.0) {
      p2Penalty = 35;
      reasons.push("KINEMATIC VIOLATION: Impossible distance jump (>75cm in 100ms)");
    }

    // -------------------------------------------------------------
    // PILLAR 3: Replay / Sensor Freeze Detection
    // -------------------------------------------------------------
    // If rover is actively driving (mot > 0) OR obstacle in close range (< 180cm),
    // real acoustic sensors have natural micro-variance. Identical readings across 10 frames indicate replay or frozen sensor.
    if ((mot > 0 || dist < 180.0) && history.length >= 10) {
      const last10 = history.slice(-10);
      const allIdentical = last10.every((f) => Math.abs(f.us - dist) < 0.001);
      if (allIdentical) {
        p3Penalty = 50;
        reasons.push("SENSOR FREEZE / REPLAY ATTACK: Zero variance across 10 cycles");
      }
    }

    // Update 20-sample rolling FIFO window
    history.push({ ts: Date.now() / 1000, us: dist, pan, mot, ir1, ir2 });
    if (history.length > 20) history.shift();

    // -------------------------------------------------------------
    // PERSISTENCE ESCALATOR & ASYMMETRIC EMA SMOOTHING
    // -------------------------------------------------------------
    const totalRawPenalty = p1Penalty + p2Penalty + p3Penalty;
    if (totalRawPenalty > 0) {
      persistenceCountRef.current = Math.min(5, persistenceCountRef.current + 1);
    } else {
      persistenceCountRef.current = Math.max(0, persistenceCountRef.current - 1);
    }

    const persistenceMult = 1.0 + 0.15 * persistenceCountRef.current;
    const calculatedRawScore = Math.max(0, 100.0 - totalRawPenalty * persistenceMult);

    // Asymmetric EMA: Fast drop on attack (alphaDrop = 0.65) for sub-100ms reaction, cautious recovery (alphaRecover = 0.12)
    const alphaDrop = 0.65;
    const alphaRecover = 0.12;
    const prevScore = trustScoreRef.current;
    let smoothedScore: number;
    if (calculatedRawScore < prevScore) {
      smoothedScore = prevScore * (1 - alphaDrop) + calculatedRawScore * alphaDrop;
    } else {
      smoothedScore = prevScore * (1 - alphaRecover) + calculatedRawScore * alphaRecover;
    }
    smoothedScore = Math.round(smoothedScore * 10) / 10;
    trustScoreRef.current = smoothedScore;
    setTrustScore(smoothedScore);

    setPenalties({
      crossModal: p1Penalty,
      jitter: p2Penalty,
      freeze: p3Penalty,
      persistenceMult: Math.round(persistenceMult * 100) / 100,
      activeReason: reasons.join(" | "),
    });

    // -------------------------------------------------------------
    // 4-STAGE DETERMINISTIC SAFETY FSM WITH LIVE HARDWARE DISPATCH
    // -------------------------------------------------------------
    let nextState: FsmState;
    if (smoothedScore >= 80.0) {
      nextState = "NOMINAL";
    } else if (smoothedScore >= 60.0) {
      nextState = "DEGRADED";
    } else if (smoothedScore >= 40.0) {
      nextState = "LIMP_HOME";
    } else {
      nextState = "SAFE_STOP";
    }

    setSafetyState(nextState);

    // Live Hardware Dispatch on FSM Transition
    if (nextState !== lastSentFsmStateRef.current) {
      lastSentFsmStateRef.current = nextState;
      sendCarCommand({ cmd: "fsm_state", state: nextState });

      if (nextState === "SAFE_STOP") {
        setDriveDirection("STOP");
        sendCarCommand("safe_stop");
        addLog("SAFE_STOP", "FSM STATE: SAFE_STOP (0% PWM Hard Lock). Emergency stop latched!");
      } else if (nextState === "LIMP_HOME") {
        addLog("LIMP_HOME", "FSM STATE: LIMP_HOME (33% Creep Speed). Hardware speed capped at 85 PWM.");
        // Auto-steer away from faulted flank if actively driving forward
        if (driveDirectionRef.current === "FORWARD") {
          if (ir1 === 1 && ir2 === 0) {
            sendCarCommand({ cmd: "drive", dir: "RIGHT", ms: 400, speed: 85 });
            addLog("LIMP_HOME", "AUTO-STEER: Evading left obstacle -> Nudging RIGHT.");
          } else if (ir2 === 1 && ir1 === 0) {
            sendCarCommand({ cmd: "drive", dir: "LEFT", ms: 400, speed: 85 });
            addLog("LIMP_HOME", "AUTO-STEER: Evading right obstacle -> Nudging LEFT.");
          }
        }
      } else if (nextState === "DEGRADED") {
        addLog("DEGRADED", "FSM STATE: DEGRADED (55% Speed Throttle). Hardware speed capped at 140 PWM.");
      } else if (nextState === "NOMINAL") {
        addLog("NOMINAL", "FSM STATE: NOMINAL (100% Authority). All sensors validated.");
      }
    }

    historyRef.current.push(smoothedScore);
    if (historyRef.current.length > 60) historyRef.current.shift();
    scheduleDraw();
  };

  // ============================================================
  // WEB SERIAL API: CONNECT & STREAM REAL HARDWARE
  // ============================================================
  const connectWebSerial = async (baud: number, type: "bluetooth" | "usb") => {
    if (!("serial" in navigator)) {
      alert("Web Serial is supported on Google Chrome, Microsoft Edge, and Opera! Please open this app in Chrome or Edge.");
      return;
    }

    try {
      const port = await (navigator as any).serial.requestPort();
      await port.open({ baudRate: baud });
      serialPortRef.current = port;

      try {
        const info = port.getInfo ? port.getInfo() : {};
        const vidPid = info.usbVendorId ? `VID:0x${info.usbVendorId.toString(16).toUpperCase()} PID:0x${info.usbProductId?.toString(16).toUpperCase()}` : "";
        setPortInfo(vidPid || (type === "bluetooth" ? "Bluetooth Virtual COM" : "USB Serial"));
      } catch (_) {
        setPortInfo(type === "bluetooth" ? "Bluetooth Virtual COM" : "USB Serial");
      }

      setSerialConnected(true);
      setConnectionType(type);
      setSerialBaud(baud);
      keepReadingRef.current = true;

      const connectionLabel = type === "bluetooth" ? `Bluetooth HC-05 @ ${baud} baud` : `USB Serial @ ${baud} baud`;
      addLog("NOMINAL", `Connected to ${connectionLabel}. Streaming hardware data...`);

      // Setup Dedicated High-Speed Writer
      const writer = port.writable.getWriter();
      writerRef.current = writer;

      // Automatically unfreeze, sync FSM state, and center servo on successful connect
      sendCarCommand("resume", true);
      sendCarCommand({ cmd: "fsm_state", state: "NOMINAL" }, true);
      sendCarCommand({ cmd: "servo_angle", value: 90 }, true);

      // Setup Reader
      const reader = port.readable.getReader();
      readerRef.current = reader;
      const decoder = new TextDecoder();

      let buffer = "";

      // Background Stream Consumer with bracket-matching JSON parser
      (async () => {
        try {
          while (keepReadingRef.current) {
            const { value, done } = await reader.read();
            if (done) break;

            if (value) {
              const chunk = decoder.decode(value, { stream: true });
              buffer += chunk;

              if (!pauseMonitor) {
                const combined = chunk.replace(/\r/g, "");
                const newLines = combined.split("\n").filter((l) => l.trim().length > 0);
                if (newLines.length > 0) {
                  pendingRawLinesRef.current = [...pendingRawLinesRef.current, ...newLines].slice(-60);
                  hasNewSerialLinesRef.current = true;
                }
              }

              // Robust Bracket-Matching JSON Extractor
              let startIdx = buffer.indexOf("{");
              while (startIdx !== -1) {
                const endIdx = buffer.indexOf("}", startIdx);
                if (endIdx === -1) break;

                const jsonStr = buffer.slice(startIdx, endIdx + 1);
                try {
                  const data = JSON.parse(jsonStr);

                  const usRaw = Number(data.ultrasonic_cm);
                  let parsedUs = Number.isFinite(usRaw) ? Math.round(usRaw * 10) / 10 : 400.0;
                  let ir1Val = (data.ir1 === 1 || data.ir1 === "1") ? 1 : 0;
                  let ir2Val = (data.ir2 === 1 || data.ir2 === "1") ? 1 : 0;
                  const pirVal = (data.pir === 1 || data.pir === "1") ? 1 : 0;
                  const tempVal = Number.isFinite(Number(data.temp_c)) ? Number(data.temp_c) : 28.0;
                  const humVal = Number.isFinite(Number(data.humidity_pct)) ? Number(data.humidity_pct) : 65.0;

                  packetCountRef.current += 1;

                  const motVal = Number.isFinite(Number(data.mot)) ? Number(data.mot) : 0;
                  const panVal = Number.isFinite(Number(data.pan)) ? Number(data.pan) : 90;
                  const saccadicVal = data.saccadic !== undefined ? Number(data.saccadic) : (isSaccadicEnabled ? 1 : 0);

                  // Sync Saccadic toggle if reported by firmware
                  if (data.saccadic !== undefined && data.saccadic !== (isSaccadicEnabled ? 1 : 0)) {
                    setIsSaccadicEnabled(data.saccadic === 1);
                  }

                  // -------------------------------------------------------------
                  // CYBER-PHYSICAL ATTACK INJECTION (Before Trust Engine)
                  // -------------------------------------------------------------
                  let activeUs = parsedUs;
                  let activeIr1 = ir1Val;
                  let activeIr2 = ir2Val;

                  if (spoofAttackRef.current === "BLINDSPOT") {
                    activeUs = 145.0;
                    activeIr1 = 1;
                  } else if (spoofAttackRef.current === "GHOST_WALL") {
                    activeUs = 5.0;
                    activeIr1 = 0;
                    activeIr2 = 0;
                  } else if (spoofAttackRef.current === "REPLAY_FREEZE") {
                    activeUs = 42.0;
                  } else if (spoofAttackRef.current === "KINEMATIC_JITTER") {
                    jitterToggleRef.current = !jitterToggleRef.current;
                    activeUs = jitterToggleRef.current ? 12.0 : 140.0;
                  }

                  const ir1Adc = Number.isFinite(Number(data.ir1_adc)) ? Number(data.ir1_adc) : undefined;
                  const ir2Adc = Number.isFinite(Number(data.ir2_adc)) ? Number(data.ir2_adc) : undefined;

                  setTelemetry({
                    ts: data.ts ?? Date.now() / 1000,
                    ultrasonic_cm: activeUs,
                    ir1: activeIr1,
                    ir2: activeIr2,
                    ir1_adc: ir1Adc,
                    ir2_adc: ir2Adc,
                    pir: pirVal,
                    temp_c: tempVal,
                    humidity_pct: humVal,
                    mot: motVal,
                    pan: panVal,
                    saccadic: saccadicVal,
                    fsm: data.fsm || safetyState,
                  });

                  evaluateSafety(activeUs, activeIr1, activeIr2, panVal, motVal);

                  buffer = buffer.slice(endIdx + 1);
                  startIdx = buffer.indexOf("{");
                } catch (_) {
                  startIdx = buffer.indexOf("{", startIdx + 1);
                }
              }

              if (buffer.length > 2048) {
                buffer = buffer.slice(-512);
              }
            }
          }
        } catch (err: any) {
          if (keepReadingRef.current) {
            console.error("Serial stream read error:", err);
            addLog("DEGRADED", "Serial stream interrupted. Hardware connection dropped.");
          }
        } finally {
          try {
            reader.releaseLock();
          } catch (_) {}
          readerRef.current = null;
          setSerialConnected(false);
          setConnectionType(null);
        }
      })();

    } catch (err: any) {
      console.error("Failed to open serial port:", err);
      if (err.name !== "NotFoundError") {
        alert(
          "Could not open COM port!\n\n" +
          "1. Make sure Arduino IDE Serial Monitor is CLOSED.\n" +
          "2. Ensure no other terminal/program is using this port.\n" +
          "3. For Bluetooth: Make sure HC-05 is paired in Windows Bluetooth settings (PIN: 1234 or 0000)."
        );
      }
    }
  };

  const disconnectWebSerial = async () => {
    keepReadingRef.current = false;
    try {
      if (writerRef.current) {
        try {
          writerRef.current.releaseLock();
        } catch (_) {}
        writerRef.current = null;
      }
      if (readerRef.current) {
        try {
          await readerRef.current.cancel();
        } catch (_) {}
        try {
          readerRef.current.releaseLock();
        } catch (_) {}
        readerRef.current = null;
      }
      if (serialPortRef.current) {
        try {
          await serialPortRef.current.close();
        } catch (_) {}
        serialPortRef.current = null;
      }
    } catch (e) {
      console.warn("Disconnect error:", e);
    } finally {
      setSerialConnected(false);
      setConnectionType(null);
      setPortInfo("");
      addLog("SAFE_STOP", "Disconnected from Arduino COM port.");
    }
  };

  // ============================================================
  // SEND COMMANDS TO ARDUINO (ZERO-LATENCY DIRECT STREAM)
  // ============================================================
  const sendCarCommand = (cmd: string | Record<string, any>, silent: boolean = false) => {
    if (!writerRef.current) return;

    const cmdObj = typeof cmd === "string" ? { cmd } : cmd;
    const jsonStr = JSON.stringify(cmdObj) + "\n";
    const payload = encoderRef.current.encode(jsonStr);

    writerRef.current.write(payload).catch((err: any) => {
      console.warn("Serial write error:", err);
    });

    if (!silent) {
      addLog("NOMINAL", `Transmitted: ${JSON.stringify(cmdObj)}`);
    }
  };

  // Saccadic Reflex Toggle
  const toggleSaccadic = () => {
    const next = !isSaccadicEnabled;
    setIsSaccadicEnabled(next);
    sendCarCommand({ cmd: "saccadic", enable: next });
    addLog(safetyState, `Saccadic Reflex set to ${next ? "ENABLED" : "DISABLED"}`);
  };

  // ============================================================
  // ROVER MOVEMENT CONTROLLER
  // ============================================================
  const executeDrive = (
    dir: "FORWARD" | "BACKWARD" | "LEFT" | "RIGHT" | "STOP",
    forceMode?: "step" | "cruise" | "hold"
  ) => {
    if (!serialConnected) return;

    if (dir === "STOP") {
      setDriveDirection("STOP");
      sendCarCommand({ cmd: "drive", dir: "STOP" });
      return;
    }

    if (isEmergencyBrake) {
      setIsEmergencyBrake(false);
    }

    setDriveDirection(dir);

    const mode = forceMode || driveModeRef.current;
    if (mode === "step") {
      const ms = (dir === "LEFT" || dir === "RIGHT") ? 500 : 1000;
      sendCarCommand({ cmd: "drive", dir, ms, speed: motorPwmSpeed });
      setTimeout(() => {
        if (driveDirectionRef.current === dir) {
          setDriveDirection("STOP");
        }
      }, ms);
    } else {
      // Direct Real-Time Drive ("hold" or "cruise") - instant actuation
      sendCarCommand({ cmd: "drive", dir, speed: motorPwmSpeed });
    }
  };

  // Ultrasonic Radar Pan Control (MG90S Servo)
  const setSensorPanAngle = (angle: number) => {
    setIsAutoScanning(false);
    setRadarPanAngle(angle);
    sendCarCommand({ cmd: "servo_angle", value: angle });
  };

  // Actuator Safety Overrides
  const handleManualBrake = () => {
    setIsEmergencyBrake(true);
    setDriveDirection("STOP");
    trustScoreRef.current = 0;
    setTrustScore(0);
    setSafetyState("SAFE_STOP");
    lastSentFsmStateRef.current = "SAFE_STOP";
    sendCarCommand({ cmd: "fsm_state", state: "SAFE_STOP" });
    sendCarCommand("safe_stop");
    addLog("SAFE_STOP", "DRIVER TRIGGERED MANUAL EMERGENCY STOP! All power cut in hardware.");
  };

  const handleManualResume = () => {
    setIsEmergencyBrake(false);
    trustScoreRef.current = 100;
    setTrustScore(100);
    setSafetyState("NOMINAL");
    setSpoofAttack("NONE");
    persistenceCountRef.current = 0;
    lastSentFsmStateRef.current = "NOMINAL";
    sendCarCommand({ cmd: "fsm_state", state: "NOMINAL" });
    sendCarCommand("resume");
    addLog("NOMINAL", "Rover resumed. Motors re-armed to 100% NOMINAL.");
  };

  const handleSendCustomCmd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customCommandInput.trim()) return;
    try {
      const parsed = JSON.parse(customCommandInput);
      sendCarCommand(parsed);
    } catch (_) {
      sendCarCommand(customCommandInput.trim());
    }
    setCustomCommandInput("");
  };

  // Draw Rolling Score Chart with 4 FSM Threshold Lines
  const drawChart = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const lines = [
      { val: 80, color: "rgba(16, 185, 129, 0.3)", label: "NOMINAL (80%)" },
      { val: 60, color: "rgba(245, 158, 11, 0.3)", label: "DEGRADED (60%)" },
      { val: 40, color: "rgba(249, 115, 22, 0.3)", label: "LIMP_HOME (40%)" },
    ];

    lines.forEach((l) => {
      const y = h - (l.val / 100) * h;
      ctx.strokeStyle = l.color;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();

      ctx.fillStyle = l.color;
      ctx.font = "10px sans-serif";
      ctx.fillText(l.label, 8, y - 4);
    });
    ctx.setLineDash([]);

    const history = historyRef.current;
    if (history.length < 2) return;

    ctx.beginPath();
    const step = w / (history.length - 1);
    history.forEach((val, i) => {
      const x = i * step;
      const y = h - (val / 100) * (h - 12) - 6;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });

    const currentScore = history[history.length - 1];
    let strokeColor = "#10b981";
    if (currentScore < 40) strokeColor = "#ef4444";
    else if (currentScore < 60) strokeColor = "#f97316";
    else if (currentScore < 80) strokeColor = "#f59e0b";

    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = 3;
    ctx.stroke();
  };

  const getStateInfo = () => {
    switch (safetyState) {
      case "NOMINAL":
        return {
          title: "NOMINAL (100% AUTHORITY)",
          subtitle: "All sensors agree. 100% Max PWM speed authority enabled in hardware.",
          bg: "bg-emerald-500/10",
          border: "border-emerald-500/40",
          text: "text-emerald-400",
          badge: "bg-emerald-950 text-emerald-300 border-emerald-800",
          color: "#10b981",
        };
      case "DEGRADED":
        return {
          title: "DEGRADED (55% THROTTLED)",
          subtitle: "Minor sensor anomaly / jitter detected. Hardware speed capped at 140 PWM.",
          bg: "bg-amber-500/10",
          border: "border-amber-500/40",
          text: "text-amber-400",
          badge: "bg-amber-950 text-amber-300 border-amber-800",
          color: "#f59e0b",
        };
      case "LIMP_HOME":
        return {
          title: "LIMP_HOME (33% CREEP SPEED)",
          subtitle: "Persistent sensor contradiction. Hardware speed capped at 85 PWM. Flank evasion active.",
          bg: "bg-orange-500/10",
          border: "border-orange-500/40",
          text: "text-orange-400",
          badge: "bg-orange-950 text-orange-300 border-orange-800",
          color: "#f97316",
        };
      case "SAFE_STOP":
        return {
          title: "SAFE_STOP (0% HARD LOCK)",
          subtitle: "Critical multi-modal contradiction or proximity crash! Motors cut and latched in hardware.",
          bg: "bg-rose-500/15",
          border: "border-rose-500/50",
          text: "text-rose-400",
          badge: "bg-rose-950 text-rose-300 border-rose-800 animate-pulse",
          color: "#ef4444",
        };
    }
  };

  const currentInfo = getStateInfo();

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col font-sans selection:bg-cyan-500 selection:text-black">
      {/* Top Header Navigation */}
      <header className="border-b border-zinc-800 bg-zinc-900 px-6 py-3.5 flex flex-wrap items-center justify-between gap-4 sticky top-0 z-40 shadow-md">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-cyan-500 text-black shadow-lg shadow-cyan-500/20">
            <Car className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-black tracking-tight text-white">TrustEdge Rover Cockpit</h1>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-cyan-950 text-cyan-400 border border-cyan-800 font-bold uppercase">
                Hardware Autonomous Shield
              </span>
            </div>
            <p className="text-xs text-zinc-400">
              3-Pillar Trust Engine &middot; Active Saccadic Reflex &middot; 4-Stage Hardware FSM &middot; Arduino Uno L293D
            </p>
          </div>
        </div>

        {/* Connection Bar */}
        <div className="flex items-center gap-2">
          {!serialConnected ? (
            <div className="flex items-center gap-2">
              {/* USB 115200 Connect Button */}
              <button
                onClick={() => connectWebSerial(115200, "usb")}
                className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold shadow-md shadow-cyan-600/30 transition cursor-pointer"
              >
                <Usb className="w-4 h-4" />
                <span>Connect USB (115200)</span>
              </button>

              {/* Bluetooth 9600 Connect Button */}
              <button
                onClick={() => connectWebSerial(9600, "bluetooth")}
                className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold shadow-md shadow-indigo-600/30 transition cursor-pointer"
              >
                <Bluetooth className="w-4 h-4" />
                <span>Connect Bluetooth (9600)</span>
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-3 bg-zinc-950/80 px-3.5 py-1.5 rounded-xl border border-zinc-800 text-xs">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
                <span className="font-semibold text-emerald-400 capitalize">
                  {connectionType === "bluetooth" ? "Bluetooth HC-05" : "USB Serial"} @ {serialBaud}
                </span>
                {portInfo && <span className="text-[10px] text-zinc-500 font-mono">({portInfo})</span>}
              </div>

              {/* Live Streaming Rate & Total Packets */}
              <div className="flex items-center gap-2 border-l border-zinc-800 pl-3 font-mono text-[11px] text-zinc-400">
                <span className="text-cyan-400 font-bold">{packetRateHz} Hz</span>
                <span>({packetCount} pkts)</span>
              </div>

              <button
                onClick={disconnectWebSerial}
                className="text-[11px] px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-bold ml-2 transition"
              >
                Disconnect
              </button>
            </div>
          )}

          {/* Wiring Guide Button */}
          <button
            onClick={() => setShowWiringModal(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-800 text-xs font-semibold transition"
          >
            <HelpCircle className="w-4 h-4 text-amber-400" />
            <span>Wiring Guide</span>
          </button>

          {/* Download Files Button */}
          <button
            onClick={() => setShowDownloadsModal(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-800 text-xs font-semibold transition"
          >
            <Download className="w-4 h-4 text-blue-400" />
            <span>Download Files</span>
          </button>
        </div>
      </header>

      {/* Main Ground Station Layout */}
      <main className="flex-1 p-4 md:p-6 max-w-7xl mx-auto w-full grid grid-cols-1 lg:grid-cols-12 gap-6">

        {/* ================= COLUMN 1: ROVER DRIVING COCKPIT & FSM (4 COLS) ================= */}
        <div className="lg:col-span-4 flex flex-col gap-6">

          {/* Differential Drive Wheel Controls */}
          <div className="bg-zinc-900/90 border border-zinc-800 rounded-2xl p-5 shadow-xl flex flex-col gap-3.5">
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-2">
                <Compass className="w-4 h-4 text-cyan-400" />
                <span className="text-xs font-bold uppercase tracking-wider text-zinc-300">Rover Wheel Drive (L298N)</span>
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-[10px] font-mono px-2 py-0.5 rounded font-bold ${
                  telemetry.mot > 0
                    ? "bg-emerald-950 text-emerald-300 border border-emerald-800 animate-pulse"
                    : "bg-zinc-800 text-zinc-400"
                }`}>
                  HW MOT: {telemetry.mot > 0 ? `${telemetry.mot} PWM` : "0 (IDLE)"}
                </span>
                <span className={`text-[10px] font-mono px-2 py-0.5 rounded font-bold ${
                  driveDirection === "STOP"
                    ? "bg-zinc-800 text-zinc-400"
                    : "bg-cyan-950 text-cyan-300 border border-cyan-800"
                }`}>
                  {driveDirection}
                </span>
              </div>
            </div>

            {/* Drive Mode Selector Tabs */}
            <div className="flex bg-zinc-950 p-1 rounded-xl border border-zinc-800 text-[11px] font-bold">
              <button
                onClick={() => setDriveMode("hold")}
                className={`flex-1 py-1.5 rounded-lg transition text-center ${
                  driveMode === "hold"
                    ? "bg-cyan-500 text-black shadow-md shadow-cyan-500/30"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
                title="Instant zero-latency driving: moves while pressing WASD, stops when released"
              >
                ⚡ Real-Time WASD
              </button>
              <button
                onClick={() => setDriveMode("cruise")}
                className={`flex-1 py-1.5 rounded-lg transition text-center ${
                  driveMode === "cruise"
                    ? "bg-cyan-500 text-black shadow-md shadow-cyan-500/30"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
                title="Continuous driving until Space or BRAKE is pressed"
              >
                Cruise
              </button>
              <button
                onClick={() => setDriveMode("step")}
                className={`flex-1 py-1.5 rounded-lg transition text-center ${
                  driveMode === "step"
                    ? "bg-cyan-500 text-black shadow-md shadow-cyan-500/30"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
                title="Each tap drives for 1.0s then stops automatically"
              >
                Step (1.0s)
              </button>
            </div>

            {/* D-Pad Controller */}
            <div className="flex flex-col items-center gap-2 my-1">
              {/* Forward */}
              <button
                onClick={() => driveMode !== "hold" && executeDrive("FORWARD")}
                onMouseDown={() => driveMode === "hold" && executeDrive("FORWARD")}
                onMouseUp={() => driveMode === "hold" && executeDrive("STOP")}
                onTouchStart={() => driveMode === "hold" && executeDrive("FORWARD")}
                onTouchEnd={() => driveMode === "hold" && executeDrive("STOP")}
                disabled={!serialConnected}
                className={`w-32 py-3.5 rounded-xl font-bold text-xs flex flex-col items-center justify-center gap-1 transition ${
                  pressedKey === "W" || driveDirection === "FORWARD"
                    ? "bg-cyan-500 text-black shadow-lg shadow-cyan-500/40"
                    : serialConnected
                    ? "bg-zinc-800 hover:bg-zinc-700 text-zinc-200 cursor-pointer"
                    : "bg-zinc-900 text-zinc-600 cursor-not-allowed"
                }`}
              >
                <ArrowUp className="w-5 h-5" />
                <span>FORWARD (W)</span>
              </button>

              {/* Left / Stop / Right */}
              <div className="flex items-center gap-2 w-full justify-center">
                <button
                  onClick={() => driveMode !== "hold" && executeDrive("LEFT")}
                  onMouseDown={() => driveMode === "hold" && executeDrive("LEFT")}
                  onMouseUp={() => driveMode === "hold" && executeDrive("STOP")}
                  onTouchStart={() => driveMode === "hold" && executeDrive("LEFT")}
                  onTouchEnd={() => driveMode === "hold" && executeDrive("STOP")}
                  disabled={!serialConnected}
                  className={`w-24 py-3.5 rounded-xl font-bold text-xs flex flex-col items-center justify-center gap-1 transition ${
                    pressedKey === "A" || driveDirection === "LEFT"
                      ? "bg-cyan-500 text-black shadow-lg shadow-cyan-500/40"
                    : serialConnected
                    ? "bg-zinc-800 hover:bg-zinc-700 text-zinc-200 cursor-pointer"
                    : "bg-zinc-900 text-zinc-600 cursor-not-allowed"
                  }`}
                >
                  <ArrowLeft className="w-5 h-5" />
                  <span>LEFT (A)</span>
                </button>

                <button
                  onClick={() => executeDrive("STOP")}
                  disabled={!serialConnected}
                  className="w-24 py-3.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-black text-xs flex flex-col items-center justify-center gap-1 shadow-md shadow-rose-900/30 transition cursor-pointer"
                >
                  <Square className="w-5 h-5 fill-white" />
                  <span>BRAKE</span>
                </button>

                <button
                  onClick={() => driveMode !== "hold" && executeDrive("RIGHT")}
                  onMouseDown={() => driveMode === "hold" && executeDrive("RIGHT")}
                  onMouseUp={() => driveMode === "hold" && executeDrive("STOP")}
                  onTouchStart={() => driveMode === "hold" && executeDrive("RIGHT")}
                  onTouchEnd={() => driveMode === "hold" && executeDrive("STOP")}
                  disabled={!serialConnected}
                  className={`w-24 py-3.5 rounded-xl font-bold text-xs flex flex-col items-center justify-center gap-1 transition ${
                    pressedKey === "D" || driveDirection === "RIGHT"
                      ? "bg-cyan-500 text-black shadow-lg shadow-cyan-500/40"
                    : serialConnected
                    ? "bg-zinc-800 hover:bg-zinc-700 text-zinc-200 cursor-pointer"
                    : "bg-zinc-900 text-zinc-600 cursor-not-allowed"
                  }`}
                >
                  <ArrowRight className="w-5 h-5" />
                  <span>RIGHT (D)</span>
                </button>
              </div>

              {/* Backward */}
              <button
                onClick={() => driveMode !== "hold" && executeDrive("BACKWARD")}
                onMouseDown={() => driveMode === "hold" && executeDrive("BACKWARD")}
                onMouseUp={() => driveMode === "hold" && executeDrive("STOP")}
                onTouchStart={() => driveMode === "hold" && executeDrive("BACKWARD")}
                onTouchEnd={() => driveMode === "hold" && executeDrive("STOP")}
                disabled={!serialConnected}
                className={`w-32 py-3.5 rounded-xl font-bold text-xs flex flex-col items-center justify-center gap-1 transition ${
                  pressedKey === "S" || driveDirection === "BACKWARD"
                    ? "bg-cyan-500 text-black shadow-lg shadow-cyan-500/40"
                    : serialConnected
                    ? "bg-zinc-800 hover:bg-zinc-700 text-zinc-200 cursor-pointer"
                    : "bg-zinc-900 text-zinc-600 cursor-not-allowed"
                }`}
              >
                <ArrowDown className="w-5 h-5" />
                <span>BACKWARD (S)</span>
              </button>
            </div>

            {/* Quick 1-Click Action Nudges */}
            <div className="grid grid-cols-4 gap-1.5 pt-2 border-t border-zinc-800">
              <button
                onClick={() => executeDrive("FORWARD", "step")}
                disabled={!serialConnected}
                className="py-1.5 px-1 rounded-lg bg-zinc-800/80 hover:bg-zinc-700 text-zinc-300 text-[10px] font-bold flex flex-col items-center gap-0.5 border border-zinc-700/40 disabled:opacity-40 cursor-pointer"
              >
                <ArrowUp className="w-3.5 h-3.5 text-cyan-400" />
                <span>Nudge 1.0s</span>
              </button>
              <button
                onClick={() => executeDrive("BACKWARD", "step")}
                disabled={!serialConnected}
                className="py-1.5 px-1 rounded-lg bg-zinc-800/80 hover:bg-zinc-700 text-zinc-300 text-[10px] font-bold flex flex-col items-center gap-0.5 border border-zinc-700/40 disabled:opacity-40 cursor-pointer"
              >
                <ArrowDown className="w-3.5 h-3.5 text-cyan-400" />
                <span>Back 1.0s</span>
              </button>
              <button
                onClick={() => executeDrive("LEFT", "step")}
                disabled={!serialConnected}
                className="py-1.5 px-1 rounded-lg bg-zinc-800/80 hover:bg-zinc-700 text-zinc-300 text-[10px] font-bold flex flex-col items-center gap-0.5 border border-zinc-700/40 disabled:opacity-40 cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5 text-cyan-400" />
                <span>Turn 90° L</span>
              </button>
              <button
                onClick={() => executeDrive("RIGHT", "step")}
                disabled={!serialConnected}
                className="py-1.5 px-1 rounded-lg bg-zinc-800/80 hover:bg-zinc-700 text-zinc-300 text-[10px] font-bold flex flex-col items-center gap-0.5 border border-zinc-700/40 disabled:opacity-40 cursor-pointer"
              >
                <ArrowRight className="w-3.5 h-3.5 text-cyan-400" />
                <span>Turn 90° R</span>
              </button>
            </div>

            {/* Motor Speed Power Slider */}
            <div className="space-y-1.5 pt-2 border-t border-zinc-800">
              <div className="flex justify-between text-xs">
                <span className="text-zinc-400">Motor Power (PWM):</span>
                <span className="font-mono font-bold text-cyan-400">{motorPwmSpeed} ({Math.round((motorPwmSpeed / 255) * 100)}%)</span>
              </div>
              <input
                type="range"
                min="100"
                max="255"
                step="5"
                value={motorPwmSpeed}
                onChange={(e) => setMotorPwmSpeed(Number(e.target.value))}
                className="w-full accent-cyan-500 cursor-pointer"
              />
              <div className="flex justify-between text-[10px] text-zinc-500 font-mono">
                <span>Slow (100)</span>
                <span>Normal (200)</span>
                <span>Max (255)</span>
              </div>
            </div>

            {/* Keyboard drive helper tag */}
            <div className="flex items-center justify-between text-[11px] text-zinc-400 pt-1">
              <span>Keyboard Drive:</span>
              <button
                onClick={() => setIsKeyboardDriveActive(!isKeyboardDriveActive)}
                className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                  isKeyboardDriveActive ? "bg-cyan-950 text-cyan-300 border border-cyan-800" : "bg-zinc-800 text-zinc-500"
                }`}
              >
                {isKeyboardDriveActive ? "ENABLED (W/A/S/D / Space)" : "DISABLED"}
              </button>
            </div>
          </div>

          {/* Emergency Brake & Resume Bar */}
          <div className="bg-zinc-900/90 border border-zinc-800 rounded-2xl p-5 shadow-xl flex flex-col gap-3">
            <span className="text-xs font-bold uppercase tracking-wider text-zinc-400">Hardware Fail-Safe Overrides</span>
            
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={handleManualBrake}
                disabled={!serialConnected}
                className={`py-3 px-4 rounded-xl font-bold text-xs text-white shadow-lg flex items-center justify-center gap-2 transition ${
                  serialConnected
                    ? "bg-rose-600 hover:bg-rose-500 shadow-rose-900/30 cursor-pointer"
                    : "bg-zinc-800 text-zinc-500 cursor-not-allowed shadow-none"
                }`}
              >
                <Square className="w-4 h-4 fill-current" />
                <span>E-STOP MOTORS</span>
              </button>
              <button
                onClick={handleManualResume}
                disabled={!serialConnected}
                className={`py-3 px-4 rounded-xl font-bold text-xs text-white shadow-lg flex items-center justify-center gap-2 transition ${
                  serialConnected
                    ? "bg-emerald-600 hover:bg-emerald-500 shadow-emerald-900/30 cursor-pointer"
                    : "bg-zinc-800 text-zinc-500 cursor-not-allowed shadow-none"
                }`}
              >
                <Play className="w-4 h-4 fill-current" />
                <span>RESUME ROVER</span>
              </button>
            </div>

            {/* Hardware Diagnostic Self-Test Button */}
            <button
              onClick={() => {
                sendCarCommand("test_motors");
                addLog("NOMINAL", "Dispatched Hardware Diagnostic (Motors, Servo, IR Bumpers) to Arduino. Check Raw Serial Monitor!");
              }}
              disabled={!serialConnected}
              className={`w-full py-2.5 px-4 rounded-xl font-bold text-xs flex items-center justify-center gap-2 border transition ${
                serialConnected
                  ? "bg-cyan-950/80 hover:bg-cyan-900 border-cyan-700 text-cyan-200 cursor-pointer"
                  : "bg-zinc-900 border-zinc-800 text-zinc-600 cursor-not-allowed"
              }`}
            >
              <RefreshCw className="w-4 h-4 text-cyan-400" />
              <span>Run Hardware Diagnostic (Motors, Servo &amp; IR Bumpers)</span>
            </button>
          </div>

          {/* Big Safety Status Banner (4-Stage Deterministic FSM) */}
          <div className={`p-5 rounded-2xl border ${currentInfo.bg} ${currentInfo.border} shadow-xl flex flex-col gap-3 relative overflow-hidden transition-all duration-300`}>
            <div className="flex justify-between items-center">
              <span className="text-xs font-bold uppercase tracking-wider text-zinc-400">TrustEdge Shield Status</span>
              <span className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full border ${currentInfo.badge}`}>
                {safetyState}
              </span>
            </div>

            <div className="my-0.5">
              <h2 className={`text-xl font-black tracking-tight ${currentInfo.text}`}>
                {currentInfo.title}
              </h2>
              <p className="text-xs text-zinc-300 mt-1 leading-relaxed">
                {serialConnected ? currentInfo.subtitle : "Connect to Arduino COM port to arm safety shield."}
              </p>
            </div>

            <div className="flex items-end justify-between pt-2 border-t border-zinc-800/80">
              <div>
                <span className="text-[11px] text-zinc-400 block">Trust Score</span>
                <span className="text-3xl font-black font-mono" style={{ color: currentInfo.color }}>
                  {serialConnected ? `${Math.round(trustScore)}%` : "—"}
                </span>
              </div>
              <div className="text-right">
                <span className="text-[11px] text-zinc-400 block">Drive State</span>
                <span className="text-xl font-bold font-mono text-zinc-200">
                  {serialConnected ? driveDirection : "OFFLINE"}
                </span>
              </div>
            </div>
          </div>

          {/* 3-Pillar Mathematical Trust Breakdown */}
          <div className="bg-zinc-900/90 border border-zinc-800 rounded-2xl p-5 shadow-xl flex flex-col gap-3">
            <div className="flex justify-between items-center">
              <span className="text-xs font-bold uppercase tracking-wider text-zinc-400">3-Pillar Trust Verification Engine</span>
              <span className="text-[10px] font-mono text-zinc-500">Persistence: {penalties.persistenceMult}x</span>
            </div>

            <div className="grid grid-cols-3 gap-2 text-center">
              <div className={`p-2 rounded-xl border ${penalties.crossModal > 0 ? "bg-rose-950/60 border-rose-700 text-rose-300" : "bg-zinc-950 border-zinc-800 text-zinc-400"}`}>
                <span className="text-[10px] block font-bold mb-0.5">Pillar 1: Physics</span>
                <span className="font-mono text-xs font-black">{penalties.crossModal > 0 ? `-${penalties.crossModal} pts` : "CLEAR"}</span>
              </div>
              <div className={`p-2 rounded-xl border ${penalties.jitter > 0 ? "bg-amber-950/60 border-amber-700 text-amber-300" : "bg-zinc-950 border-zinc-800 text-zinc-400"}`}>
                <span className="text-[10px] block font-bold mb-0.5">Pillar 2: Kinematics</span>
                <span className="font-mono text-xs font-black">{penalties.jitter > 0 ? `-${penalties.jitter} pts` : "CLEAR"}</span>
              </div>
              <div className={`p-2 rounded-xl border ${penalties.freeze > 0 ? "bg-purple-950/60 border-purple-700 text-purple-300" : "bg-zinc-950 border-zinc-800 text-zinc-400"}`}>
                <span className="text-[10px] block font-bold mb-0.5">Pillar 3: Replay</span>
                <span className="font-mono text-xs font-black">{penalties.freeze > 0 ? `-${penalties.freeze} pts` : "CLEAR"}</span>
              </div>
            </div>

            {penalties.activeReason && (
              <div className="p-2.5 rounded-xl bg-rose-950/50 border border-rose-800/80 text-[11px] text-rose-300 font-mono flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                <span>{penalties.activeReason}</span>
              </div>
            )}

            <div className="flex justify-between items-center text-[11px] text-zinc-400 pt-1 border-t border-zinc-800/80">
              <span>Hardware Speed Ceiling:</span>
              <span className={`font-mono font-bold ${safetyState === "NOMINAL" ? "text-emerald-400" : safetyState === "DEGRADED" ? "text-amber-400" : safetyState === "LIMP_HOME" ? "text-orange-400" : "text-rose-400"}`}>
                {safetyState === "NOMINAL" ? "255 PWM (100%)" : safetyState === "DEGRADED" ? "140 PWM (55%)" : safetyState === "LIMP_HOME" ? "85 PWM (33%)" : "0 PWM (LOCKED)"}
              </span>
            </div>
          </div>

        </div>

        {/* ================= COLUMN 2: RADAR, SENSORS & ATTACK DECK (5 COLS) ================= */}
        <div className="lg:col-span-5 flex flex-col gap-6">

          {/* Ultrasonic Radar Visualizer with MG90S Servo Panning */}
          <div className="bg-zinc-900/90 border border-zinc-800 rounded-2xl p-5 shadow-xl flex flex-col gap-3">
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-2">
                <Radar className="w-4 h-4 text-cyan-400" />
                <span className="text-xs font-bold uppercase tracking-wider text-zinc-300">Ultrasonic Radar (MG90S Panning)</span>
              </div>
              <span className="text-xs font-mono text-cyan-300">Sensor Pan: {radarPanAngle}°</span>
            </div>

            {/* Radar Sweep Controls */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => setSensorPanAngle(45)}
                disabled={!serialConnected}
                className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition ${
                  radarPanAngle === 45 ? "bg-cyan-600 text-white" : "bg-zinc-800 hover:bg-zinc-700 text-zinc-300"
                }`}
              >
                Look Right (45°)
              </button>
              <button
                onClick={() => setSensorPanAngle(90)}
                disabled={!serialConnected}
                className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition ${
                  radarPanAngle === 90 ? "bg-cyan-600 text-white" : "bg-zinc-800 hover:bg-zinc-700 text-zinc-300"
                }`}
              >
                Center (90°)
              </button>
              <button
                onClick={() => setSensorPanAngle(135)}
                disabled={!serialConnected}
                className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition ${
                  radarPanAngle === 135 ? "bg-cyan-600 text-white" : "bg-zinc-800 hover:bg-zinc-700 text-zinc-300"
                }`}
              >
                Look Left (135°)
              </button>
              <button
                onClick={() => setIsAutoScanning(!isAutoScanning)}
                disabled={!serialConnected}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                  isAutoScanning ? "bg-amber-600 text-white animate-pulse" : "bg-zinc-800 hover:bg-zinc-700 text-zinc-300"
                }`}
              >
                {isAutoScanning ? "Stop Sweep" : "Auto-Sweep"}
              </button>
            </div>

            {/* Radar Arc Display */}
            <div className="relative h-48 bg-zinc-950 rounded-xl border border-zinc-800 overflow-hidden flex items-end justify-center pb-4">
              <div className="absolute inset-0 bg-[radial-gradient(#1f2937_1px,transparent_1px)] [background-size:16px_16px] opacity-40"></div>
              
              <div className="absolute w-80 h-80 border border-zinc-800/60 rounded-full bottom-[-110px]"></div>
              <div className="absolute w-52 h-52 border border-zinc-800/60 rounded-full bottom-[-70px]"></div>
              <div className="absolute w-32 h-32 border border-zinc-800/60 rounded-full bottom-[-40px]"></div>

              {/* MG90S Ultrasonic Sensor Beam (Rotates to Match Servo Angle) */}
              <div
                className="absolute bottom-6 w-36 h-40 origin-bottom transition-all duration-300"
                style={{
                  transform: `rotate(${radarPanAngle - 90}deg)`,
                  willChange: "transform",
                  background: (telemetry.ir1 || telemetry.ir2)
                    ? "conic-gradient(from 160deg at 50% 100%, transparent, rgba(239, 68, 68, 0.45), transparent 40deg)"
                    : "conic-gradient(from 160deg at 50% 100%, transparent, rgba(6, 182, 212, 0.35), transparent 40deg)"
                }}
              ></div>

              {/* Detected Physical Obstacle Marker */}
              {serialConnected && (
                <div
                  className="absolute transition-all duration-200 flex flex-col items-center"
                  style={{
                    bottom: `${Math.min(145, Math.max(25, telemetry.ultrasonic_cm * 1.35))}px`,
                    transform: `translateX(${(radarPanAngle - 90) * 0.8}px)`
                  }}
                >
                  <div className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
                    telemetry.ultrasonic_cm < 15.0
                      ? "bg-rose-500 text-white shadow-lg shadow-rose-500/50"
                      : telemetry.ultrasonic_cm < 35.0
                      ? "bg-amber-500 text-zinc-950 font-black"
                      : "bg-cyan-600/30 text-cyan-300 border border-cyan-500"
                  }`}>
                    {telemetry.ultrasonic_cm.toFixed(1)} cm
                  </div>
                  <div className={`w-3 h-3 rounded-full mt-0.5 ${telemetry.ultrasonic_cm < 15.0 ? "bg-rose-500 animate-ping" : "bg-cyan-400"}`}></div>
                </div>
              )}

              {/* Rover Icon with MG90S Head */}
              <div className="relative z-10 flex flex-col items-center">
                <div className="flex gap-3 mb-1.5">
                  <span
                    className={`w-3 h-3 rounded-full transition-all duration-150 ${telemetry.ir1 ? "bg-rose-500 ring-4 ring-rose-500/40 animate-pulse" : "bg-zinc-700"}`}
                    title={telemetry.ir1 ? "Left IR: Obstacle (<10cm)" : "Left IR: Clear"}
                  ></span>
                  <span
                    className={`w-3 h-3 rounded-full transition-all duration-150 ${telemetry.ir2 ? "bg-rose-500 ring-4 ring-rose-500/40 animate-pulse" : "bg-zinc-700"}`}
                    title={telemetry.ir2 ? "Right IR: Obstacle (<10cm)" : "Right IR: Clear"}
                  ></span>
                </div>
                <div className={`w-28 h-12 border-2 rounded-lg flex flex-col items-center justify-center font-mono text-[10px] shadow-lg transition-colors ${
                  serialConnected
                    ? "bg-zinc-800 border-cyan-500 text-zinc-200"
                    : "bg-zinc-900 border-zinc-700 text-zinc-500"
                }`}>
                  <span className="font-bold">2WD ROVER</span>
                  <span className={`text-[9px] font-black ${
                    serialConnected
                      ? driveDirection !== "STOP" ? "text-emerald-400" : "text-zinc-400"
                      : "text-zinc-600"
                  }`}>
                    {serialConnected ? driveDirection : "OFFLINE"}
                  </span>
                </div>
              </div>
            </div>

            {/* Hardware Sensor Readings Table */}
            <div className="space-y-2 mt-1">
              <div className="flex items-center justify-between p-3 rounded-xl bg-zinc-950 border border-zinc-800/80">
                <div className="flex items-center gap-2.5">
                  <Activity className="w-4 h-4 text-cyan-400" />
                  <div>
                    <span className="text-xs font-bold text-zinc-200 block">Ultrasonic Distance (HC-SR04 on MG90S)</span>
                    <span className="text-[11px] text-zinc-400">Trig Pin 2 &middot; Echo Pin 3 &middot; Servo SER1 (Pin 10)</span>
                  </div>
                </div>
                <div className="text-right">
                  <span className={`text-base font-bold font-mono ${
                    !serialConnected
                      ? "text-zinc-600"
                      : telemetry.ultrasonic_cm < 15
                      ? "text-rose-400"
                      : telemetry.ultrasonic_cm < 35
                      ? "text-amber-400"
                      : "text-cyan-400"
                  }`}>
                    {serialConnected ? `${telemetry.ultrasonic_cm.toFixed(1)} cm` : "— cm"}
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-between p-3 rounded-xl bg-zinc-950 border border-zinc-800/80">
                <div className="flex items-center gap-2.5">
                  <Zap className="w-4 h-4 text-amber-400" />
                  <div>
                    <span className="text-xs font-bold text-zinc-200 block">Left Optical IR Bumper (Pin A0)</span>
                    <span className="text-[11px] text-zinc-400 font-mono">
                      {telemetry.ir1_adc !== undefined ? `ADC: ${telemetry.ir1_adc} (${(telemetry.ir1_adc * 5.0 / 1023).toFixed(2)}V)` : "Digital proximity <10cm"}
                    </span>
                  </div>
                </div>
                <div>
                  <span className={`px-2.5 py-1 rounded-md text-xs font-bold ${
                    !serialConnected
                      ? "bg-zinc-900 text-zinc-600"
                      : telemetry.ir1 ? "bg-rose-950 text-rose-300 border border-rose-800" : "bg-emerald-950 text-emerald-300 border border-emerald-800"
                  }`}>
                    {!serialConnected ? "OFFLINE" : telemetry.ir1 ? "OBSTACLE DETECTED" : "CLEAR"}
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-between p-3 rounded-xl bg-zinc-950 border border-zinc-800/80">
                <div className="flex items-center gap-2.5">
                  <Zap className="w-4 h-4 text-amber-400" />
                  <div>
                    <span className="text-xs font-bold text-zinc-200 block">Right Optical IR Bumper (Pin A1)</span>
                    <span className="text-[11px] text-zinc-400 font-mono">
                      {telemetry.ir2_adc !== undefined ? `ADC: ${telemetry.ir2_adc} (${(telemetry.ir2_adc * 5.0 / 1023).toFixed(2)}V)` : "Digital proximity <10cm"}
                    </span>
                  </div>
                </div>
                <div>
                  <span className={`px-2.5 py-1 rounded-md text-xs font-bold ${
                    !serialConnected
                      ? "bg-zinc-900 text-zinc-600"
                      : telemetry.ir2 ? "bg-rose-950 text-rose-300 border border-rose-800" : "bg-emerald-950 text-emerald-300 border border-emerald-800"
                  }`}>
                    {!serialConnected ? "OFFLINE" : telemetry.ir2 ? "OBSTACLE DETECTED" : "CLEAR"}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Cyber-Physical Attack Injection & Verification Deck */}
          <div className="bg-zinc-900/90 border border-zinc-800 rounded-2xl p-5 shadow-xl flex flex-col gap-3">
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 text-rose-400" />
                <span className="text-xs font-bold uppercase tracking-wider text-zinc-300">
                  Cyber-Physical Attack Injection &amp; Verification Deck
                </span>
              </div>
              <span className={`text-[10px] font-mono px-2 py-0.5 rounded font-bold ${
                spoofAttack === "NONE"
                  ? "bg-zinc-800 text-zinc-400"
                  : "bg-rose-950 text-rose-300 border border-rose-700 animate-pulse"
              }`}>
                {spoofAttack === "NONE" ? "RAW HARDWARE STREAM" : `INJECTING: ${spoofAttack}`}
              </span>
            </div>

            <p className="text-[11px] text-zinc-400 leading-relaxed">
              Inject synthetic adversarial faults into the real-time sensor bus to watch the 3-Pillar Trust Engine detect spoofing and physically throttle the rover in hardware:
            </p>

            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setSpoofAttack("BLINDSPOT")}
                disabled={!serialConnected}
                className={`py-2 px-2.5 rounded-xl text-left border transition text-xs flex flex-col gap-0.5 cursor-pointer ${
                  spoofAttack === "BLINDSPOT"
                    ? "bg-rose-950/80 border-rose-600 text-rose-200 shadow-md shadow-rose-900/40"
                    : "bg-zinc-950 hover:bg-zinc-800/80 border-zinc-800 text-zinc-300 disabled:opacity-40"
                }`}
              >
                <span className="font-bold flex items-center gap-1.5 text-rose-400">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  Blindspot Spoof
                </span>
                <span className="text-[10px] text-zinc-400">Forces US=145cm with IR1=1 (Pillar 1)</span>
              </button>

              <button
                onClick={() => setSpoofAttack("GHOST_WALL")}
                disabled={!serialConnected}
                className={`py-2 px-2.5 rounded-xl text-left border transition text-xs flex flex-col gap-0.5 cursor-pointer ${
                  spoofAttack === "GHOST_WALL"
                    ? "bg-rose-950/80 border-rose-600 text-rose-200 shadow-md shadow-rose-900/40"
                    : "bg-zinc-950 hover:bg-zinc-800/80 border-zinc-800 text-zinc-300 disabled:opacity-40"
                }`}
              >
                <span className="font-bold flex items-center gap-1.5 text-amber-400">
                  <Radio className="w-3.5 h-3.5" />
                  Ghost Wall
                </span>
                <span className="text-[10px] text-zinc-400">Forces US=5cm with clear IRs (Pillar 1)</span>
              </button>

              <button
                onClick={() => setSpoofAttack("REPLAY_FREEZE")}
                disabled={!serialConnected}
                className={`py-2 px-2.5 rounded-xl text-left border transition text-xs flex flex-col gap-0.5 cursor-pointer ${
                  spoofAttack === "REPLAY_FREEZE"
                    ? "bg-rose-950/80 border-rose-600 text-rose-200 shadow-md shadow-rose-900/40"
                    : "bg-zinc-950 hover:bg-zinc-800/80 border-zinc-800 text-zinc-300 disabled:opacity-40"
                }`}
              >
                <span className="font-bold flex items-center gap-1.5 text-purple-400">
                  <Layers className="w-3.5 h-3.5" />
                  Replay Freeze
                </span>
                <span className="text-[10px] text-zinc-400">Locks US=42.0cm, 0 variance (Pillar 3)</span>
              </button>

              <button
                onClick={() => setSpoofAttack("KINEMATIC_JITTER")}
                disabled={!serialConnected}
                className={`py-2 px-2.5 rounded-xl text-left border transition text-xs flex flex-col gap-0.5 cursor-pointer ${
                  spoofAttack === "KINEMATIC_JITTER"
                    ? "bg-rose-950/80 border-rose-600 text-rose-200 shadow-md shadow-rose-900/40"
                    : "bg-zinc-950 hover:bg-zinc-800/80 border-zinc-800 text-zinc-300 disabled:opacity-40"
                }`}
              >
                <span className="font-bold flex items-center gap-1.5 text-cyan-400">
                  <Activity className="w-3.5 h-3.5" />
                  Kinematic Jitter
                </span>
                <span className="text-[10px] text-zinc-400">Jumps 12cm &harr; 140cm (Pillar 2)</span>
              </button>
            </div>

            <div className="flex items-center gap-2 pt-1">
              <button
                onClick={() => setSpoofAttack("NONE")}
                className={`flex-1 py-2 px-3 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 border transition cursor-pointer ${
                  spoofAttack === "NONE"
                    ? "bg-emerald-950/70 border-emerald-700 text-emerald-300"
                    : "bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border-zinc-700"
                }`}
              >
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                <span>Restore True Hardware Stream</span>
              </button>

              <button
                onClick={toggleSaccadic}
                disabled={!serialConnected}
                className={`py-2 px-3 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 border transition cursor-pointer ${
                  isSaccadicEnabled
                    ? "bg-cyan-950/80 border-cyan-700 text-cyan-200"
                    : "bg-zinc-950 border-zinc-800 text-zinc-500"
                }`}
                title="Automatically aims HC-SR04 servo at triggered IR bumper to cross-verify"
              >
                <Compass className="w-3.5 h-3.5 text-cyan-400" />
                <span>Saccadic Reflex: {isSaccadicEnabled ? "ON" : "OFF"}</span>
              </button>
            </div>
          </div>

          {/* Rolling Trust Score Chart */}
          <div className="bg-zinc-900/90 border border-zinc-800 rounded-2xl p-5 shadow-xl flex flex-col gap-2">
            <div className="flex justify-between items-center">
              <span className="text-xs font-bold uppercase tracking-wider text-zinc-400">Rolling Trust Integrity Score (60 Samples)</span>
              <span className="text-[10px] font-mono text-zinc-500">EMA Drop: 0.65 &middot; Recover: 0.12</span>
            </div>
            <div className="h-24 w-full bg-zinc-950 rounded-xl border border-zinc-800/80 overflow-hidden relative">
              <canvas ref={canvasRef} width={450} height={96} className="w-full h-full block" />
            </div>
          </div>

        </div>

        {/* ================= COLUMN 3: TERMINAL & LOGS (3 COLS) ================= */}
        <div className="lg:col-span-3 flex flex-col gap-6">

          {/* Live Raw Serial Console */}
          <div className="bg-zinc-900/90 border border-zinc-800 rounded-2xl p-5 shadow-xl flex flex-col gap-3">
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-2">
                <Terminal className="w-4 h-4 text-cyan-400" />
                <span className="text-xs font-bold uppercase tracking-wider text-zinc-400">Raw Serial Monitor</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPauseMonitor(!pauseMonitor)}
                  className="text-[10px] px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition cursor-pointer"
                >
                  {pauseMonitor ? "Resume" : "Pause"}
                </button>
                <button
                  onClick={() => setRawSerialLines([])}
                  className="text-[10px] px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition cursor-pointer"
                >
                  Clear
                </button>
              </div>
            </div>

            <div className="h-44 bg-zinc-950 border border-zinc-800 rounded-xl p-2.5 font-mono text-[11px] overflow-y-auto space-y-1 text-zinc-300 flex flex-col-reverse">
              {rawSerialLines.length === 0 ? (
                <div className="text-zinc-600 italic">No incoming data yet. Connect to a COM port to stream live telemetry.</div>
              ) : (
                rawSerialLines.slice().reverse().map((line, idx) => (
                  <div key={idx} className="break-all whitespace-pre-wrap leading-tight text-emerald-400/90 hover:text-white">
                    {line}
                  </div>
                ))
              )}
            </div>

            {/* Manual Command Dispatch */}
            <form onSubmit={handleSendCustomCmd} className="flex gap-2">
              <input
                type="text"
                placeholder='e.g. {"cmd":"safe_stop"}'
                value={customCommandInput}
                onChange={(e) => setCustomCommandInput(e.target.value)}
                disabled={!serialConnected}
                className="flex-1 bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-1.5 text-xs font-mono text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-cyan-500 disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={!serialConnected}
                className="px-3 py-1.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-xs disabled:opacity-50 disabled:cursor-not-allowed transition cursor-pointer"
              >
                Send
              </button>
            </form>
          </div>

          {/* Activity Event Log */}
          <div className="bg-zinc-900/90 border border-zinc-800 rounded-2xl p-5 shadow-xl flex flex-col flex-1">
            <div className="flex justify-between items-center mb-2">
              <span className="text-xs font-bold uppercase tracking-wider text-zinc-400">Ground Station Event Log</span>
              <span className="text-[10px] text-zinc-500 font-mono">{auditLogs.length} events</span>
            </div>
            <div className="h-56 overflow-y-auto space-y-2 pr-1 text-xs">
              {auditLogs.map((log) => (
                <div key={log.id} className="p-2.5 rounded-xl bg-zinc-950 border border-zinc-800/80 leading-snug">
                  <div className="flex items-center justify-between text-zinc-400 text-[10px] mb-1">
                    <span>{log.time}</span>
                    <span
                      className={`font-bold ${
                        log.state === "SAFE_STOP"
                          ? "text-rose-400"
                          : log.state === "LIMP_HOME"
                          ? "text-orange-400"
                          : log.state === "DEGRADED"
                          ? "text-amber-400"
                          : "text-emerald-400"
                      }`}
                    >
                      [{log.state}]
                    </span>
                  </div>
                  <div className="text-zinc-200">{log.text}</div>
                </div>
              ))}
            </div>
          </div>

        </div>

      </main>

      {/* ================= HARDWARE WIRING & PINOUT MODAL ================= */}
      {showWiringModal && (
        <div className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl max-w-2xl w-full p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <div className="flex items-center gap-2">
                <HelpCircle className="w-5 h-5 text-amber-400" />
                <h3 className="font-bold text-white text-base">Arduino Uno Hardware Wiring &amp; Pinout</h3>
              </div>
              <button
                onClick={() => setShowWiringModal(false)}
                className="text-zinc-400 hover:text-white p-1 rounded-lg hover:bg-zinc-800 transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4 text-xs text-zinc-300">
              <div>
                <h4 className="font-bold text-white mb-1.5 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-cyan-400"></span>
                  L293D Motor Driver Shield Hardware Pinout
                </h4>
                <div className="grid grid-cols-2 gap-2 text-[11px] font-mono">
                  <div className="p-3 rounded-lg bg-zinc-950 border border-zinc-800 space-y-1">
                    <strong className="text-cyan-300 block mb-1">Motors &amp; MG90S Servo:</strong>
                    <div>Left Wheel Motor: Screw Terminal <span className="text-emerald-400 font-bold">M3</span> (PWM Pin 6)</div>
                    <div>Right Wheel Motor: Screw Terminal <span className="text-emerald-400 font-bold">M4</span> (PWM Pin 5)</div>
                    <div>MG90S Servo: <span className="text-cyan-300 font-bold">SERVO 2</span> header (Pin 9)</div>
                    <div>L293D Power Jumper (PWR): <span className="text-amber-300 font-bold">ON</span></div>
                  </div>
                  <div className="p-3 rounded-lg bg-zinc-950 border border-zinc-800 space-y-1">
                    <strong className="text-cyan-300 block mb-1">Sensors &amp; Bluetooth:</strong>
                    <div>Ultrasonic Trig: Digital Pin <span className="text-cyan-300 font-bold">2</span></div>
                    <div>Ultrasonic Echo: Digital Pin <span className="text-cyan-300 font-bold">3</span></div>
                    <div>IR Sensor 1 (Left): Analog Pin <span className="text-cyan-300 font-bold">A0</span></div>
                    <div>IR Sensor 2 (Right): Analog Pin <span className="text-cyan-300 font-bold">A1</span></div>
                    <div>HC-05 BT: RX to Pin <span className="text-cyan-300 font-bold">A4</span>, TX to Pin <span className="text-cyan-300 font-bold">A5</span></div>
                  </div>
                </div>
              </div>

              <div>
                <h4 className="font-bold text-white mb-1.5 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-amber-400"></span>
                  Critical L293D Shield Checklist
                </h4>
                <ul className="space-y-1.5 list-disc pl-5 text-zinc-300">
                  <li><strong>Motor Terminals:</strong> Connect your two DC gear motors to <strong>M3</strong> and <strong>M4</strong> on the right side of the shield.</li>
                  <li><strong>Motor Power:</strong> Connect your battery to the blue <strong>EXT_PWR (+ and GND)</strong> screw terminals. Keep the small yellow <strong>PWR jumper</strong> on the shield plugged in so the battery also powers the Arduino.</li>
                  <li><strong>Native 74HC595 Driver:</strong> Zero external library dependencies required. Bit-banged directly in C++ firmware with sub-millisecond loop times.</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ================= DOWNLOAD FILES MODAL ================= */}
      {showDownloadsModal && (
        <div className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl max-w-xl w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <div className="flex items-center gap-2">
                <FileDown className="w-5 h-5 text-blue-400" />
                <h3 className="font-bold text-white text-base">Download Artifacts &amp; Firmware</h3>
              </div>
              <button
                onClick={() => setShowDownloadsModal(false)}
                className="text-zinc-400 hover:text-white p-1 rounded-lg hover:bg-zinc-800 transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
              {FILE_DOWNLOADS.map((f, i) => (
                <a
                  key={i}
                  href={f.path}
                  download={f.name}
                  className="flex items-center justify-between p-3 rounded-xl bg-zinc-950 hover:bg-zinc-800/80 border border-zinc-800 transition group"
                >
                  <div>
                    <span className="font-bold text-sm text-zinc-200 group-hover:text-cyan-400 transition block">
                      {f.name}
                    </span>
                    <span className="text-xs text-zinc-400">{f.label}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-zinc-400">
                      {f.type} &middot; {f.size}
                    </span>
                    <Download className="w-4 h-4 text-zinc-400 group-hover:text-white transition" />
                  </div>
                </a>
              ))}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
