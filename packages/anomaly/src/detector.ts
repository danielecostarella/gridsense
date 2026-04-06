/**
 * Statistical anomaly detection for energy readings.
 *
 * Three detector types run independently per channel:
 *
 *   spike         — instantaneous z-score spike (|z| > threshold)
 *                   Fires when current power deviates sharply from the
 *                   rolling mean. Useful for detecting sudden faults,
 *                   appliances switched on unexpectedly, or meter errors.
 *
 *   night_load    — unexpected consumption during F3 (off-peak) hours.
 *                   Fires when power exceeds a configured baseline at night.
 *                   Useful for detecting devices left on accidentally.
 *
 *   sustained_high — power stays above a threshold for more than N readings.
 *                   Useful for detecting heating/cooling runaway or
 *                   long-running high-power appliances.
 *
 * All detectors run in-process in the collector using a circular buffer —
 * no DB reads required for real-time detection.
 */

import { classifyBand } from "@gridsense/tariff";

export type AnomalyType = "spike" | "night_load" | "sustained_high";

export interface Anomaly {
  detectedAt: Date;
  channelId: 0 | 1;
  type: AnomalyType;
  actPowerW: number;
  /** Rolling mean at detection time */
  baselineW: number;
  /** z-score (spike) or excess ratio (others) */
  deviation: number;
  description: string;
}

export interface AnomalyDetectorConfig {
  /** Window size for rolling statistics (number of readings) */
  windowSize?: number;
  /** Z-score threshold for spike detection (default: 3.5) */
  spikeZThreshold?: number;
  /** Minimum window fill before spike detection activates */
  warmupReadings?: number;
  /** Night load threshold [W] — power above this at F3 hours is flagged */
  nightLoadThresholdW?: number;
  /** Power [W] above which "sustained high" tracking begins */
  sustainedHighThresholdW?: number;
  /** Number of consecutive readings above threshold before flagging */
  sustainedHighReadings?: number;
  /** Minimum interval between same-type anomalies per channel [ms] — prevents alert flood */
  debounceMs?: number;
}

/** Welford's online algorithm for incremental mean and variance. */
class RollingStats {
  private buf: number[];
  private head = 0;
  private count = 0;
  readonly maxSize: number;

  constructor(size: number) {
    this.maxSize = size;
    this.buf = new Array<number>(size).fill(0);
  }

  push(v: number): void {
    this.buf[this.head] = v;
    this.head = (this.head + 1) % this.maxSize;
    if (this.count < this.maxSize) this.count++;
  }

  get size(): number { return this.count; }

  mean(): number {
    if (this.count === 0) return 0;
    let sum = 0;
    for (let i = 0; i < this.count; i++) sum += this.buf[i]!;
    return sum / this.count;
  }

  stddev(): number {
    if (this.count < 2) return 0;
    const m = this.mean();
    let variance = 0;
    for (let i = 0; i < this.count; i++) variance += (this.buf[i]! - m) ** 2;
    return Math.sqrt(variance / this.count);
  }

  zscore(v: number): number {
    const std = this.stddev();
    return std > 0 ? (v - this.mean()) / std : 0;
  }
}

interface ChannelDetectorState {
  rolling: RollingStats;
  sustainedCount: number;
  lastAnomalyAt: Partial<Record<AnomalyType, number>>;
}

export class AnomalyDetector {
  private readonly cfg: Required<AnomalyDetectorConfig>;
  private readonly channels: [ChannelDetectorState, ChannelDetectorState];

  constructor(cfg: AnomalyDetectorConfig = {}) {
    this.cfg = {
      windowSize:              cfg.windowSize              ?? 60,
      spikeZThreshold:         cfg.spikeZThreshold         ?? 3.5,
      warmupReadings:          cfg.warmupReadings           ?? 20,
      nightLoadThresholdW:     cfg.nightLoadThresholdW      ?? 150,
      sustainedHighThresholdW: cfg.sustainedHighThresholdW  ?? 3000,
      sustainedHighReadings:   cfg.sustainedHighReadings    ?? 12, // ~1 min at 5s
      debounceMs:              cfg.debounceMs               ?? 5 * 60_000, // 5 min
    };

    const mkState = (): ChannelDetectorState => ({
      rolling: new RollingStats(this.cfg.windowSize),
      sustainedCount: 0,
      lastAnomalyAt: {},
    });

    this.channels = [mkState(), mkState()];
  }

  /**
   * Processes one reading and returns any anomalies detected.
   * Call this for each channel after every poll/MQTT message.
   */
  process(channelId: 0 | 1, actPowerW: number, sampledAt: Date): Anomaly[] {
    const s       = this.channels[channelId]!;
    const results: Anomaly[] = [];
    const now     = sampledAt.getTime();

    const canFire = (type: AnomalyType): boolean => {
      const last = s.lastAnomalyAt[type] ?? 0;
      return now - last >= this.cfg.debounceMs;
    };

    const emit = (a: Anomaly): void => {
      s.lastAnomalyAt[a.type] = now;
      results.push(a);
    };

    // ── 1. Spike detection (requires warm window) ──────────────────────────
    if (s.rolling.size >= this.cfg.warmupReadings) {
      const z        = s.rolling.zscore(actPowerW);
      const baseline = s.rolling.mean();

      if (Math.abs(z) >= this.cfg.spikeZThreshold && canFire("spike")) {
        emit({
          detectedAt: sampledAt, channelId, type: "spike",
          actPowerW, baselineW: baseline, deviation: z,
          description: `CH${channelId}: power spike detected — ${actPowerW.toFixed(0)} W (z=${z.toFixed(2)}, baseline ${baseline.toFixed(0)} W)`,
        });
      }
    }

    // ── 2. Night load (F3 hours only) ─────────────────────────────────────
    const band = classifyBand(sampledAt);
    if (
      band === "F3" &&
      actPowerW > this.cfg.nightLoadThresholdW &&
      canFire("night_load")
    ) {
      emit({
        detectedAt: sampledAt, channelId, type: "night_load",
        actPowerW, baselineW: this.cfg.nightLoadThresholdW,
        deviation: actPowerW / this.cfg.nightLoadThresholdW,
        description: `CH${channelId}: unexpected night load — ${actPowerW.toFixed(0)} W during F3 hours`,
      });
    }

    // ── 3. Sustained high load ─────────────────────────────────────────────
    if (actPowerW > this.cfg.sustainedHighThresholdW) {
      s.sustainedCount++;
      if (s.sustainedCount >= this.cfg.sustainedHighReadings && canFire("sustained_high")) {
        emit({
          detectedAt: sampledAt, channelId, type: "sustained_high",
          actPowerW, baselineW: this.cfg.sustainedHighThresholdW,
          deviation: s.sustainedCount,
          description: `CH${channelId}: sustained high load — ${actPowerW.toFixed(0)} W for ${s.sustainedCount} consecutive readings`,
        });
      }
    } else {
      s.sustainedCount = 0;
    }

    // Push to rolling window AFTER spike check (don't pollute the baseline)
    s.rolling.push(actPowerW);

    return results;
  }
}
