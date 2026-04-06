import type { ShellyProEM50Status, ChannelReading } from "./types.js";

export interface ShellyClientOptions {
  host: string;
  timeoutMs?: number;
}

export class ShellyClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor({ host, timeoutMs = 3000 }: ShellyClientOptions) {
    this.baseUrl = `http://${host}`;
    this.timeoutMs = timeoutMs;
  }

  async getStatus(): Promise<ShellyProEM50Status> {
    const signal = AbortSignal.timeout(this.timeoutMs);

    const res = await fetch(`${this.baseUrl}/rpc/Shelly.GetStatus`, { signal });

    if (!res.ok) {
      throw new Error(
        `Shelly responded with HTTP ${res.status} ${res.statusText}`
      );
    }

    return res.json() as Promise<ShellyProEM50Status>;
  }

  /**
   * Polls the device and returns two normalised ChannelReadings (ch0 and ch1).
   * Reactive power is derived — not directly measured — so it represents the
   * magnitude |Q| and does not carry sign information.
   */
  async poll(): Promise<[ChannelReading, ChannelReading]> {
    const status = await this.getStatus();
    const sampledAt = new Date();

    return [0, 1].map((id) => {
      const ch = status[`em1:${id}` as "em1:0" | "em1:1"];
      const data = status[`em1data:${id}` as "em1data:0" | "em1data:1"];

      const S = ch.aprt_power;
      const P = ch.act_power;
      const reactivePower = Math.sqrt(Math.max(S * S - P * P, 0));

      return {
        sampledAt,
        channelId: id as 0 | 1,
        voltage: ch.voltage,
        current: ch.current,
        actPower: ch.act_power,
        aprtPower: ch.aprt_power,
        powerFactor: ch.pf,
        frequency: ch.freq,
        reactivePower,
        totalActEnergy: data.total_act_energy,
        totalActRetEnergy: data.total_act_ret_energy,
      } satisfies ChannelReading;
    }) as [ChannelReading, ChannelReading];
  }
}
