import { Hono } from "hono";
import { ShellyClient, type ChannelReading } from "@gridsense/shelly-client";

/**
 * /live — bypasses the database entirely and queries the Shelly device
 * directly. Latency is ~50-200ms (LAN round trip) vs the DB path which
 * is bounded by the collector's poll interval (default 5s).
 *
 * Use this for the real-time needle/gauge widgets on the dashboard.
 */
export function liveRouter(client: ShellyClient) {
  const app = new Hono();

  app.get("/", async (c) => {
    const [ch0, ch1] = await client.poll();

    const totalActPower = ch0.actPower + ch1.actPower;
    const totalAprtPower = ch0.aprtPower + ch1.aprtPower;
    const totalReactivePower = ch0.reactivePower + ch1.reactivePower;

    // System power factor from totals: PF = P / S
    const systemPF =
      totalAprtPower > 0
        ? parseFloat((totalActPower / totalAprtPower).toFixed(4))
        : 0;

    return c.json({
      sampled_at: ch0.sampledAt,
      channels: {
        "0": serializeChannel(ch0),
        "1": serializeChannel(ch1),
      },
      system: {
        total_act_power_w: round(totalActPower),
        total_aprt_power_va: round(totalAprtPower),
        total_reactive_power_var: round(totalReactivePower),
        power_factor: systemPF,
        // Net load across both channels [W].
        // Positive = drawing from grid, negative = exporting (e.g. PV surplus).
        net_power_w: round(ch0.actPower + ch1.actPower),
      },
    });
  });

  return app;
}

function serializeChannel(r: ChannelReading) {
  return {
    voltage_v: round(r.voltage),
    current_a: round(r.current, 3),
    act_power_w: round(r.actPower),
    aprt_power_va: round(r.aprtPower),
    reactive_power_var: round(r.reactivePower),
    power_factor: round(r.powerFactor, 3),
    frequency_hz: round(r.frequency, 2),
    total_act_energy_kwh: round(r.totalActEnergy / 1000, 3),
    total_act_ret_energy_kwh: round(r.totalActRetEnergy / 1000, 3),
  };
}

function round(n: number, decimals = 1): number {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}
