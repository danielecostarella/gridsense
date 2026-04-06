/**
 * Shared event contract between the collector (publisher)
 * and the API WebSocket layer (subscriber → browser clients).
 */

export const CHANNEL_READINGS = "gridsense:readings:live" as const;

export interface LiveChannelData {
  channelId: 0 | 1;
  voltageV: number;
  currentA: number;
  actPowerW: number;
  aprtPowerVA: number;
  reactivePowerVAr: number;
  powerFactor: number;
  frequencyHz: number;
  totalActEnergyKwh: number;
  totalActRetEnergyKwh: number;
}

export interface LiveReadingsEvent {
  sampledAt: string; // ISO 8601
  channels: [LiveChannelData, LiveChannelData];
  system: {
    totalActPowerW: number;
    totalAprtPowerVA: number;
    totalReactivePowerVAr: number;
    /** Positive = consuming from grid, negative = exporting to grid */
    netPowerW: number;
  };
}

/** Wire format: JSON-serialised LiveReadingsEvent */
export type ReadingsPayload = string;
