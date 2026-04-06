/**
 * Shelly Pro EM-50 — RPC response types.
 *
 * Based on Shelly RPC API v2 (Gen2+ devices).
 * Endpoint: GET http://<host>/rpc/Shelly.GetStatus
 *
 * The EM-50 exposes two independent metering channels (em1:0, em1:1),
 * each backed by its own current transformer. Energy counters are cumulative
 * and persist across reboots.
 */

/** Single metering channel — instantaneous measurements */
export interface EM1Channel {
  id: 0 | 1;
  /** RMS voltage in Volts */
  voltage: number;
  /** RMS current in Amperes */
  current: number;
  /** Active (real) power in Watts */
  act_power: number;
  /** Apparent power in Volt-Amperes */
  aprt_power: number;
  /** Power factor — range [-1, 1]. Negative means leading (capacitive) load */
  pf: number;
  /** Line frequency in Hz */
  freq: number;
  /** Calibration mode: "factory" | "user" */
  calibration: string;
}

/** Cumulative energy counters for a channel — persisted on device */
export interface EM1Data {
  id: 0 | 1;
  /** Total active energy consumed, in Wh */
  total_act_energy: number;
  /**
   * Total active energy returned to the grid, in Wh.
   * Non-zero when a generation source (e.g. PV inverter) is on this channel.
   */
  total_act_ret_energy: number;
}

/** Output relay with temperature sensor (built into EM-50 hardware) */
export interface SwitchStatus {
  id: number;
  source: string;
  output: boolean;
  temperature: {
    /** Celsius */
    tC: number;
    /** Fahrenheit */
    tF: number;
  };
}

/** System-level device information */
export interface SysStatus {
  mac: string;
  restart_required: boolean;
  /** Local time string, e.g. "13:40" */
  time: string;
  /** Unix timestamp (seconds) from device clock */
  unixtime: number;
  last_sync_ts: number;
  /** Device uptime in seconds */
  uptime: number;
  ram_size: number;
  ram_free: number;
  ram_min_free: number;
  fs_size: number;
  fs_free: number;
  cfg_rev: number;
  available_updates: {
    stable?: { version: string };
    beta?: { version: string };
  };
}

export interface WifiStatus {
  sta_ip: string | null;
  status: string;
  ssid: string;
  /** RSSI in dBm — less negative means stronger signal */
  rssi: number;
}

/** Full response from Shelly.GetStatus on a Pro EM-50 */
export interface ShellyProEM50Status {
  "em1:0": EM1Channel;
  "em1:1": EM1Channel;
  "em1data:0": EM1Data;
  "em1data:1": EM1Data;
  "switch:0": SwitchStatus;
  sys: SysStatus;
  wifi: WifiStatus;
  cloud: { connected: boolean };
  mqtt: { connected: boolean };
}

/** Normalised reading — flat structure convenient for storage and computation */
export interface ChannelReading {
  /** Wall-clock time when the poll completed */
  sampledAt: Date;
  /** Channel index */
  channelId: 0 | 1;
  voltage: number;
  current: number;
  actPower: number;
  aprtPower: number;
  powerFactor: number;
  frequency: number;
  /** Reactive power derived from apparent and active: Q = sqrt(S²-P²) [VAr] */
  reactivePower: number;
  totalActEnergy: number;
  totalActRetEnergy: number;
}
