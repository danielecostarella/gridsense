"use client";

import { useLiveData } from "@/hooks/useLiveData";
import { PowerFlow } from "./PowerFlow";
import { MetricCard } from "./MetricCard";
import { ConnectionBadge } from "./ConnectionBadge";
import { PowerChart } from "./PowerChart";
import { TodayEnergy } from "./TodayEnergy";
import { CostCard } from "./CostCard";
import { TariffBand } from "./TariffBand";
import { AnomalyAlert } from "./AnomalyAlert";
import { ConsumptionChart } from "./ConsumptionChart";
import { ThemeToggle } from "./ThemeToggle";

export function DashboardClient() {
  const { data, connectionState } = useLiveData();

  const ch0 = data?.channels[0] ?? null;
  const ch1 = data?.channels[1] ?? null;
  const system = data?.system ?? null;

  const lastSeen = data?.sampledAt
    ? new Date(data.sampledAt).toLocaleTimeString("it-IT")
    : null;

  return (
    <div className="min-h-dvh bg-[var(--color-grid-950)] text-[var(--color-fg)]">
      {/* ── Header ── */}
      <header className="sticky top-0 z-10 border-b border-[var(--color-grid-700)] bg-[var(--color-grid-950)]/90 backdrop-blur-md">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="font-bold text-lg tracking-tight">
              Grid<span className="text-[var(--color-accent-400)]">Sense</span>
            </span>
            <span className="hidden sm:block text-xs text-[var(--color-muted)] bg-[var(--color-grid-800)] px-2 py-0.5 rounded-full border border-[var(--color-grid-600)]">
              Shelly Pro EM-50
            </span>
          </div>

          <div className="flex items-center gap-3">
            {lastSeen && (
              <span className="hidden sm:block text-xs text-[var(--color-muted)]">
                {lastSeen}
              </span>
            )}
            <TariffBand />
            <ThemeToggle />
            <ConnectionBadge state={connectionState} />
          </div>
        </div>
      </header>

      {/* ── Main ── */}
      <main className="max-w-6xl mx-auto px-4 py-6 space-y-6">

        {/* Row 1: Power Flow + System metrics */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

          {/* Power flow — spans 1 col */}
          <div className="bg-[var(--color-grid-800)] rounded-xl p-5 border border-[var(--color-grid-600)] flex items-center justify-center">
            <PowerFlow data={data} />
          </div>

          {/* System KPIs — spans 2 cols */}
          <div className="lg:col-span-2 grid grid-cols-2 sm:grid-cols-3 gap-3">
            <MetricCard
              label="Total Power"
              value={system?.totalActPowerW ?? null}
              unit="W"
              decimals={0}
              accent="power"
              size="lg"
              testId="metric-total-power"
            />
            <MetricCard
              label="Apparent Power"
              value={system?.totalAprtPowerVA ?? null}
              unit="VA"
              decimals={0}
              accent="default"
              testId="metric-aprt-power"
            />
            <MetricCard
              label="Reactive Power"
              value={system?.totalReactivePowerVAr ?? null}
              unit="VAr"
              decimals={0}
              accent="default"
              testId="metric-reactive-power"
            />

            {/* CH·0 */}
            <MetricCard
              label="CH·0 Voltage"
              value={ch0?.voltageV ?? null}
              unit="V"
              decimals={1}
              sublabel={`${ch0?.frequencyHz?.toFixed(2) ?? "—"} Hz`}
              testId="metric-ch0-voltage"
            />
            <MetricCard
              label="CH·0 Current"
              value={ch0?.currentA ?? null}
              unit="A"
              decimals={2}
              sublabel={`PF ${ch0?.powerFactor?.toFixed(2) ?? "—"}`}
              testId="metric-ch0-current"
            />
            <MetricCard
              label="CH·0 Power"
              value={ch0?.actPowerW ?? null}
              unit="W"
              decimals={0}
              accent="power"
              testId="metric-ch0-power"
            />

            {/* CH·1 */}
            <MetricCard
              label="CH·1 Voltage"
              value={ch1?.voltageV ?? null}
              unit="V"
              decimals={1}
              sublabel={`${ch1?.frequencyHz?.toFixed(2) ?? "—"} Hz`}
              testId="metric-ch1-voltage"
            />
            <MetricCard
              label="CH·1 Current"
              value={ch1?.currentA ?? null}
              unit="A"
              decimals={2}
              sublabel={`PF ${ch1?.powerFactor?.toFixed(2) ?? "—"}`}
              testId="metric-ch1-current"
            />
            <MetricCard
              label="CH·1 Power"
              value={ch1?.actPowerW ?? null}
              unit="W"
              decimals={0}
              accent={
                (ch1?.totalActRetEnergyKwh ?? 0) > 0 ? "solar" : "power"
              }
              testId="metric-ch1-power"
            />
          </div>
        </div>

        {/* Anomaly alerts — visible only when anomalies exist */}
        <AnomalyAlert />

        {/* Row 2: Energy totals + Today summary + Cost */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <MetricCard
            label="CH·0 Energy"
            value={ch0?.totalActEnergyKwh ?? null}
            unit="kWh"
            decimals={2}
            sublabel="Lifetime consumed"
            testId="metric-ch0-energy"
          />
          <MetricCard
            label="CH·1 Consumed"
            value={ch1?.totalActEnergyKwh ?? null}
            unit="kWh"
            decimals={2}
            testId="metric-ch1-energy"
          />
          <MetricCard
            label="CH·1 Returned"
            value={ch1?.totalActRetEnergyKwh ?? null}
            unit="kWh"
            decimals={2}
            accent={
              (ch1?.totalActRetEnergyKwh ?? 0) > 0 ? "solar" : "default"
            }
            sublabel="To grid / generation"
            testId="metric-ch1-returned"
          />
          <TodayEnergy />
          <CostCard />
        </div>

        {/* Row 3: Historical power chart + consumption bar chart */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="bg-[var(--color-grid-800)] rounded-xl p-5 border border-[var(--color-grid-600)]">
            <PowerChart />
          </div>
          <div className="bg-[var(--color-grid-800)] rounded-xl p-5 border border-[var(--color-grid-600)]">
            <ConsumptionChart />
          </div>
        </div>
      </main>
    </div>
  );
}
