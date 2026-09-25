#!/usr/bin/env python3
"""
TRUSTEDGE Automated Test Suite & Benchmark (Software-in-the-Loop)
Tests the complete Python Trust Engine without any physical hardware.
Validates:
  1. Nominal Baseline & Zero False Positives
  2. Blindspot Attack Detection (<100ms response)
  3. Ghost Wall Anomaly Detection
  4. Kinematic Jitter Violation
  5. Replay Freeze & Zero-Variance Detection
  6. Persistence Escalation & Asymmetric Recovery
  7. Engine Latency & Throughput Benchmark
"""

import sys
import os
import time
import math

# Add current dir to path to import trust_engine cleanly
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from trust_engine import TrustEngine

GREEN = "\033[92m"
RED = "\033[91m"
CYAN = "\033[96m"
YELLOW = "\033[93m"
BOLD = "\033[1m"
RESET = "\033[0m"

def make_packet(ts, us=60.0, ir1=0, ir2=0, pir=0, temp=28.0, hum=65.0):
    return {
        "ts": ts,
        "ultrasonic_cm": us,
        "ir1": ir1,
        "ir2": ir2,
        "pir": pir,
        "temp_c": temp,
        "humidity_pct": hum,
    }

def print_header(title):
    print(f"\n{BOLD}{CYAN}{'='*60}{RESET}")
    print(f"{BOLD}{CYAN} TEST: {title}{RESET}")
    print(f"{BOLD}{CYAN}{'='*60}{RESET}")

def assert_test(condition, message):
    if condition:
        print(f"  [{GREEN}PASS{RESET}] {message}")
        return True
    else:
        print(f"  [{RED}FAIL{RESET}] {message}")
        return False

def run_tests():
    total_passed = 0
    total_tests = 0

    print(f"\n{BOLD}{YELLOW}TRUSTEDGE SOFTWARE-IN-THE-LOOP (SITL) VALIDATION SUITE{RESET}")
    print(f"Platform: Python {sys.version.split()[0]} | Hardware Emulation Mode\n")

    # -------------------------------------------------------------
    # TEST 1: Nominal Baseline & False Positive Check
    # -------------------------------------------------------------
    print_header("1. Nominal Baseline Stability (50 frames normal operation)")
    engine = TrustEngine()
    now = time.time()
    nominal_scores = []
    
    for i in range(50):
        # Normal driving with slight vibration noise
        us_val = 55.0 + math.sin(i * 0.2) * 2.5
        pkt = make_packet(now + i * 0.1, us=us_val, ir1=0, ir2=0)
        score, state, breakdown, reason = engine.evaluate_reading(pkt)
        nominal_scores.append(score)

    total_tests += 2
    avg_score = sum(nominal_scores) / len(nominal_scores)
    if assert_test(avg_score >= 95.0, f"Average trust score remains high ({avg_score:.1f}% >= 95%)"):
        total_passed += 1
    if assert_test(state == "NOMINAL", f"Final state remains NOMINAL (State: {state})"):
        total_passed += 1

    # -------------------------------------------------------------
    # TEST 2: Blindspot Attack Detection (<100ms reaction)
    # -------------------------------------------------------------
    print_header("2. Blindspot Attack Detection (Optical=Obstacle, Acoustic=Clear)")
    engine = TrustEngine()
    # 5 warm-up frames
    for i in range(5):
        engine.evaluate_reading(make_packet(now + i * 0.1, us=50.0, ir1=0, ir2=0))

    # Inject blindspot: IR1 triggers (obstacle < 14cm), but ultrasonic says 140cm clear!
    attack_pkt = make_packet(now + 0.6, us=140.0, ir1=1, ir2=0)
    score, state, breakdown, reason = engine.evaluate_reading(attack_pkt)

    total_tests += 3
    if assert_test(breakdown.cross_modal_penalty > 30.0, f"Cross-modal penalty triggered ({breakdown.cross_modal_penalty:.1f} pts)"):
        total_passed += 1
    if assert_test(score < 70.0, f"Trust score drops immediately on 1st attack frame ({score:.1f}%)"):
        total_passed += 1

    # Inject second consecutive frame: should escalate and force SAFE-STOP or LIMP-HOME
    score2, state2, _, _ = engine.evaluate_reading(make_packet(now + 0.7, us=140.0, ir1=1, ir2=0))
    if assert_test(state2 in ["LIMP-HOME", "SAFE-STOP"], f"FSM forced into fail-safe within 200ms (State: {state2})"):
        total_passed += 1

    # -------------------------------------------------------------
    # TEST 3: Ghost Wall Attack Detection
    # -------------------------------------------------------------
    print_header("3. Ghost Wall Attack Detection (Acoustic=Crash, Optical=Clear)")
    engine = TrustEngine()
    for i in range(5):
        engine.evaluate_reading(make_packet(now + i * 0.1, us=70.0, ir1=0, ir2=0))

    # Inject ghost wall: ultrasonic claims 5cm crash, but optical IR says 0
    score, state, breakdown, reason = engine.evaluate_reading(make_packet(now + 0.6, us=5.0, ir1=0, ir2=0))

    total_tests += 2
    if assert_test(breakdown.cross_modal_penalty >= 25.0, f"Ghost wall penalty applied ({breakdown.cross_modal_penalty:.1f} pts)"):
        total_passed += 1
    if assert_test(score < 90.0, f"Trust drops out of NOMINAL on false crash alarm ({score:.1f}%)"):
        total_passed += 1

    # -------------------------------------------------------------
    # TEST 4: Kinematic Jitter Violation (>450 cm/s velocity jump)
    # -------------------------------------------------------------
    print_header("4. Kinematic Jitter Violation (Implausible jump in 100ms)")
    engine = TrustEngine()
    engine.evaluate_reading(make_packet(now, us=20.0, ir1=0, ir2=0))
    # Jump from 20cm to 120cm in 0.1s -> 1000 cm/s
    score, state, breakdown, reason = engine.evaluate_reading(make_packet(now + 0.1, us=120.0, ir1=0, ir2=0))

    total_tests += 2
    if assert_test(breakdown.jitter_penalty > 15.0, f"Kinematic velocity penalty applied ({breakdown.jitter_penalty:.1f} pts)"):
        total_passed += 1
    if assert_test(score < 90.0, f"Score penalized for physical impossibility ({score:.1f}%)"):
        total_passed += 1

    # -------------------------------------------------------------
    # TEST 5: Replay Freeze & Zero-Variance Detection
    # -------------------------------------------------------------
    print_header("5. Sensor Replay Freeze (Identical floats across >=12 frames)")
    engine = TrustEngine()
    freeze_detected = False
    
    for i in range(16):
        # Exactly 45.123 cm with 0 variance
        score, state, breakdown, reason = engine.evaluate_reading(make_packet(now + i * 0.1, us=45.123, ir1=0, ir2=0))
        if breakdown.freeze_penalty > 0:
            freeze_detected = True
            break

    total_tests += 1
    if assert_test(freeze_detected, f"Sensor replay/freeze detected after consecutive identical samples"):
        total_passed += 1

    # -------------------------------------------------------------
    # TEST 6: Asymmetric Recovery Rate (Rapid drop vs. Cautious rise)
    # -------------------------------------------------------------
    print_header("6. Asymmetric Exponential Smoothing (Safety Hysteresis)")
    engine = TrustEngine()
    # Baseline
    engine.evaluate_reading(make_packet(now, us=50.0))
    # Attack frame -> drop
    s_drop, _, _, _ = engine.evaluate_reading(make_packet(now + 0.1, us=140.0, ir1=1))
    drop_delta = 100.0 - s_drop

    # Clean frame -> recovery
    s_rec, _, _, _ = engine.evaluate_reading(make_packet(now + 0.2, us=50.0, ir1=0))
    recovery_delta = s_rec - s_drop

    total_tests += 1
    if assert_test(drop_delta > recovery_delta, f"Drop rate ({drop_delta:.1f}%) is significantly faster than recovery rate ({recovery_delta:.1f}%)"):
        total_passed += 1

    # -------------------------------------------------------------
    # TEST 7: Throughput & Latency Benchmark (1,000 packets)
    # -------------------------------------------------------------
    print_header("7. High-Throughput Latency Benchmark (1,000 Cycles)")
    engine = TrustEngine()
    t_start = time.perf_counter()
    
    for i in range(1000):
        engine.evaluate_reading(make_packet(now + i * 0.1, us=50.0 + (i % 10) * 0.2))
        
    t_elapsed = time.perf_counter() - t_start
    avg_latency_ms = (t_elapsed / 1000.0) * 1000.0
    throughput_hz = 1000.0 / t_elapsed

    total_tests += 2
    if assert_test(avg_latency_ms < 1.0, f"Average execution latency is sub-millisecond ({avg_latency_ms:.3f} ms / packet)"):
        total_passed += 1
    if assert_test(throughput_hz > 1000.0, f"Throughput capability exceeds 1,000 Hz ({throughput_hz:,.0f} packets/sec)"):
        total_passed += 1

    # -------------------------------------------------------------
    # SUMMARY
    # -------------------------------------------------------------
    print(f"\n{BOLD}{CYAN}{'='*60}{RESET}")
    if total_passed == total_tests:
        print(f"{BOLD}{GREEN}ALL {total_passed}/{total_tests} TESTS PASSED SUCCESSFULLY! (100% PASS RATE){RESET}")
        print(f"{GREEN}The mathematical trust engine and FSM are verified and ready for presentation.{RESET}")
    else:
        print(f"{BOLD}{RED}{total_tests - total_passed} TESTS FAILED out of {total_tests}!{RESET}")
    print(f"{BOLD}{CYAN}{'='*60}{RESET}\n")

if __name__ == "__main__":
    run_tests()
