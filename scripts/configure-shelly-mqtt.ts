#!/usr/bin/env bun
/**
 * One-time setup script — enables MQTT on the Shelly Pro EM-50 and points
 * it to the local Mosquitto broker.
 *
 * Usage:
 *   SHELLY_HOST=192.168.1.6 BROKER_HOST=<your-docker-host-ip> bun scripts/configure-shelly-mqtt.ts
 *
 * The script also sets the status publish interval to 5 seconds.
 * After running, restart the Shelly (or wait ~10s) for the settings to take effect.
 */

const SHELLY_HOST  = process.env["SHELLY_HOST"]  ?? "192.168.1.6";
const BROKER_HOST  = process.env["BROKER_HOST"]  ?? "192.168.1.1";
const BROKER_PORT  = parseInt(process.env["BROKER_PORT"] ?? "1883", 10);
const MQTT_PREFIX  = process.env["MQTT_PREFIX"]  ?? "gridsense/shelly";

async function rpc(method: string, params: Record<string, unknown>) {
  const url = `http://${SHELLY_HOST}/rpc/${method}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error(`RPC ${method} failed: ${res.status} ${res.statusText}`);
  return res.json();
}

async function main() {
  console.log(`Configuring Shelly at ${SHELLY_HOST}...`);

  // 1. Enable MQTT and set broker address
  const mqttResult = await rpc("MQTT.SetConfig", {
    config: {
      enable: true,
      server: `${BROKER_HOST}:${BROKER_PORT}`,
      topic_prefix: MQTT_PREFIX,
      client_id: `shelly-em50`,
      // Publish status every 5s even if unchanged
      rpc_ntf: true,
      status_ntf: true,
    },
  });
  console.log("MQTT config set:", JSON.stringify(mqttResult));

  // 2. Verify current MQTT config
  const currentConfig = await rpc("MQTT.GetConfig", {});
  console.log("Current MQTT config:", JSON.stringify(currentConfig, null, 2));

  // 3. Reboot to apply
  console.log("\nRebooting device to apply settings...");
  await rpc("Shelly.Reboot", {});
  console.log(`Done. Set SHELLY_MQTT_PREFIX=${MQTT_PREFIX} in your .env`);
}

main().catch((err) => {
  console.error("Error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
