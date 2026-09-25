#!/usr/bin/env python3
"""
TRUSTEDGE - Bluetooth Serial Bridge Service
Component 2: Bridge Service (Laptop)
Author: TRUSTEDGE Robotics Team

Responsibilities:
  1. Opens serial connection to HC-05 Bluetooth module (or USB Serial fallback).
  2. Reads newline-terminated JSON sensor telemetry from ESP32.
  3. Validates and passes data to the Trust Engine.
  4. Accepts outgoing commands from Trust Engine/Dashboard and writes them back over serial.
  5. Implements resilient auto-reconnect loop (never crashes if BT drops or ESP32 resets).
"""

import sys
import time
import json
import queue
import threading
import argparse
from typing import Optional, Callable

try:
    import serial
    import serial.tools.list_ports
except ImportError:
    serial = None
    print("[WARN] 'pyserial' not installed. Run: pip install pyserial")

try:
    import websockets
except ImportError:
    websockets = None

from trust_engine import TrustEngine, TrustEngineServer


class BluetoothSerialBridge:
    def __init__(
        self,
        port: str = "/dev/rfcomm0",
        baudrate: int = 115200,
        reconnect_interval: float = 2.0,
        on_reading_callback: Optional[Callable[[str], None]] = None,
    ):
        self.port = port
        self.baudrate = baudrate
        self.reconnect_interval = reconnect_interval
        self.on_reading_callback = on_reading_callback
        
        self.serial_handle: Optional[serial.Serial] = None
        self.is_running = False
        self.outgoing_queue: queue.Queue = queue.Queue()
        
        self.stats = {
            "packets_received": 0,
            "packets_sent": 0,
            "corrupted_lines": 0,
            "reconnect_count": 0,
            "is_connected": False,
        }

    def send_command(self, cmd_dict: dict):
        """Thread-safe enqueueing of commands to send to ESP32."""
        try:
            line = json.dumps(cmd_dict) + "\n"
            self.outgoing_queue.put(line)
        except Exception as e:
            print(f"[BRIDGE_ERR] Failed to serialize command {cmd_dict}: {e}")

    def _connect(self) -> bool:
        if serial is None:
            print("[BRIDGE_FATAL] pyserial is required to connect to hardware.")
            return False

        try:
            print(f"[BRIDGE] Attempting connection to Bluetooth port: {self.port} @ {self.baudrate} baud...")
            self.serial_handle = serial.Serial(
                port=self.port,
                baudrate=self.baudrate,
                timeout=1.0,
                write_timeout=1.0
            )
            # Flush existing buffer
            self.serial_handle.reset_input_buffer()
            self.serial_handle.reset_output_buffer()
            self.stats["is_connected"] = True
            print(f"\033[92m[BRIDGE_OK] Successfully connected to {self.port}\033[0m")
            return True
        except serial.SerialException as e:
            self.stats["is_connected"] = False
            self.serial_handle = None
            print(f"[BRIDGE_RECONNECT] Could not open {self.port}: {e}. Retrying in {self.reconnect_interval}s...")
            return False
        except Exception as e:
            self.stats["is_connected"] = False
            self.serial_handle = None
            print(f"[BRIDGE_ERR] Unexpected error connecting: {e}")
            return False

    def _writer_thread(self):
        """Worker thread to dispatch outgoing commands without blocking reads."""
        while self.is_running:
            try:
                line = self.outgoing_queue.get(timeout=0.2)
            except queue.Empty:
                continue

            if not self.serial_handle or not self.serial_handle.is_open:
                # Re-queue if not connected yet
                self.outgoing_queue.put(line)
                time.sleep(0.5)
                continue

            try:
                self.serial_handle.write(line.encode("utf-8"))
                self.serial_handle.flush()
                self.stats["packets_sent"] += 1
                print(f"[TX -> ESP32] {line.strip()}")
            except (serial.SerialException, OSError) as e:
                print(f"[BRIDGE_TX_ERR] Failed to write to serial: {e}")
                self.stats["is_connected"] = False

    def start(self):
        """Main non-blocking reader loop with resilient reconnect."""
        self.is_running = True
        
        # Start command writer thread
        writer = threading.Thread(target=self._writer_thread, daemon=True)
        writer.start()

        line_buffer = bytearray()

        print("[BRIDGE] Service started. Entering resilient communication loop...")
        while self.is_running:
            # 1. Maintain Connection
            if not self.serial_handle or not self.serial_handle.is_open:
                self.stats["reconnect_count"] += 1
                connected = self._connect()
                if not connected:
                    time.sleep(self.reconnect_interval)
                    continue

            # 2. Read Serial Stream
            try:
                raw_bytes = self.serial_handle.readline()
                if not raw_bytes:
                    continue  # Timeout reached, loop around

                line = raw_bytes.decode("utf-8", errors="replace").strip()
                if not line:
                    continue

                # Basic sanity check before parsing
                if line.startswith("{") and line.endswith("}"):
                    self.stats["packets_received"] += 1
                    if self.on_reading_callback:
                        self.on_reading_callback(line)
                else:
                    self.stats["corrupted_lines"] += 1
                    # Could be debug log from ESP32 boot
                    if "ESP32" in line or "BOOT" in line:
                        print(f"[ESP32_DEBUG] {line}")

            except (serial.SerialException, OSError) as e:
                print(f"\033[91m[BRIDGE_DISCONNECT] Serial dropped: {e}\033[0m")
                self.stats["is_connected"] = False
                try:
                    if self.serial_handle:
                        self.serial_handle.close()
                except Exception:
                    pass
                self.serial_handle = None
                time.sleep(self.reconnect_interval)
            except Exception as e:
                print(f"[BRIDGE_LOOP_ERR] Unexpected error in read loop: {e}")
                time.sleep(0.5)

    def stop(self):
        self.is_running = False
        if self.serial_handle and self.serial_handle.is_open:
            self.serial_handle.close()
        print("[BRIDGE] Stopped.")


def auto_detect_ports():
    """Helper to list available ports on the host system."""
    if serial is None:
        return []
    ports = serial.tools.list_ports.comports()
    print("\n--- Available Serial / Bluetooth Ports ---")
    for p in ports:
        print(f"  * {p.device}: {p.description} (hwid: {p.hwid})")
    print("------------------------------------------\n")
    return [p.device for p in ports]


def main():
    parser = argparse.ArgumentParser(description="TRUSTEDGE Bluetooth Serial Bridge")
    parser.add_argument("--port", default="/dev/rfcomm0", help="Bluetooth serial device or COM port")
    parser.add_argument("--baud", type=int, default=115200, help="Baud rate (default: 115200)")
    parser.add_argument("--ws-port", type=int, default=8765, help="WebSocket port for live dashboard")
    parser.add_argument("--list-ports", action="store_true", help="List available serial/Bluetooth ports")
    args = parser.parse_args()

    if args.list_ports:
        auto_detect_ports()
        sys.exit(0)

    print("=" * 70)
    print("  TRUSTEDGE: BLUETOOTH SERIAL BRIDGE & TRUST ENGINE HOST")
    print(f"  Serial Port: {args.port} | Baud: {args.baud}")
    print(f"  Dashboard WebSocket: ws://localhost:{args.ws_port}")
    print("=" * 70)

    engine_server = TrustEngineServer(port=args.ws_port)

    # Wire Bridge <-> Engine
    bridge = BluetoothSerialBridge(
        port=args.port,
        baudrate=args.baud,
        on_reading_callback=lambda line: engine_server.process_incoming_sensor_json(line)
    )

    # When FSM decides an actuator command is needed, bridge sends it to ESP32
    engine_server.set_command_callback(bridge.send_command)

    # Start bridge in background thread
    bridge_thread = threading.Thread(target=bridge.start, daemon=True)
    bridge_thread.start()

    # Run WebSocket server event loop in main thread
    if websockets:
        import asyncio
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        engine_server.set_loop(loop)
        start_server = websockets.serve(engine_server.handle_client, engine_server.host, engine_server.port)
        print(f"[SERVER] WebSocket listening on ws://{engine_server.host}:{engine_server.port}")
        try:
            loop.run_until_complete(start_server)
            loop.run_forever()
        except KeyboardInterrupt:
            print("\nShutting down bridge and engine...")
            bridge.stop()
    else:
        print("[WARN] Running without WebSocket server (websockets module not installed).")
        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            bridge.stop()


if __name__ == "__main__":
    main()
