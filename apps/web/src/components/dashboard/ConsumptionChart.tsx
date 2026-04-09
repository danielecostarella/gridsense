"use client";

import { useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { useQuery } from "@tanstack/react-query";
import { useTheme } from "@/context/ThemeContext";

type Period = "day" | "month" | "year";

interface ConsumptionBucket {
  period: string;
  ch0Wh: number;
  ch1Wh: number;
  totalWh: number;
}

interface ApiResponse {
  data: ConsumptionBucket[];
  meta: { period: Period; from: string; to: string };
}

async function fetchConsumption(period: Period): Promise<ConsumptionBucket[]> {
  const res = await fetch(`/api/energy/consumption?period=${period}`);
  if (!res.ok) throw new Error("Failed to fetch consumption data");
  const json = (await res.json()) as ApiResponse;
  return json.data;
}

function formatPeriodLabel(isoString: string, period: Period): string {
  const d = new Date(isoString);
  if (period === "day") {
    return d.toLocaleDateString("it-IT", { day: "2-digit", month: "short" });
  }
  if (period === "month") {
    return d.toLocaleDateString("it-IT", { month: "short", year: "2-digit" });
  }
  return d.getFullYear().toString();
}

function whToLabel(wh: number): string {
  if (wh >= 1000) return `${(wh / 1000).toFixed(2)} kWh`;
  return `${Math.round(wh)} Wh`;
}

const CustomTooltip = ({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ value: number; name: string; color: string }>;
  label?: string;
}) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-[var(--color-grid-800)] border border-[var(--color-grid-600)] rounded-lg px-3 py-2 text-xs shadow-xl">
      <p className="text-[var(--color-muted)] mb-1">{label}</p>
      {payload.map((p) => (
        <p key={p.name} style={{ color: p.color }}>
          {p.name}: {whToLabel(p.value)}
        </p>
      ))}
    </div>
  );
};

const CHART_COLORS = {
  dark:  { grid: "#1f1f35", tick: "#64748b", cursor: "#1f1f35", legend: "#64748b" },
  light: { grid: "#e2e8f0", tick: "#94a3b8", cursor: "#f1f5f9", legend: "#64748b" },
};

const TABS: { label: string; value: Period }[] = [
  { label: "Giorni", value: "day" },
  { label: "Mesi", value: "month" },
  { label: "Anni", value: "year" },
];

export function ConsumptionChart() {
  const { theme } = useTheme();
  const cc = CHART_COLORS[theme];
  const [period, setPeriod] = useState<Period>("day");

  const { data, isLoading, isError } = useQuery({
    queryKey: ["consumption", period],
    queryFn: () => fetchConsumption(period),
    refetchInterval: 5 * 60_000, // refresh every 5 minutes
    staleTime: 4 * 60_000,
  });

  const chartData = (data ?? []).map((b) => ({
    ...b,
    label: formatPeriodLabel(b.period, period),
    // Convert to kWh for readability when values are large
    ch0: b.ch0Wh,
    ch1: b.ch1Wh,
  }));

  return (
    <div data-testid="consumption-chart">
      {/* Header + period selector */}
      <div className="flex items-center justify-between mb-4">
        <p className="text-xs text-[var(--color-muted)] uppercase tracking-widest">
          Consumo Energetico
        </p>
        <div className="flex gap-1 bg-[var(--color-grid-950)] rounded-lg p-0.5 border border-[var(--color-grid-600)]">
          {TABS.map((tab) => (
            <button
              key={tab.value}
              onClick={() => setPeriod(tab.value)}
              className={`px-3 py-1 text-xs rounded-md transition-colors ${
                period === tab.value
                  ? "bg-[var(--color-accent-500)] text-white"
                  : "text-[var(--color-muted)] hover:text-slate-300"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {isLoading && (
        <div className="h-52 flex items-center justify-center text-[var(--color-muted)] text-sm">
          Caricamento…
        </div>
      )}

      {isError && (
        <div className="h-52 flex items-center justify-center text-[var(--color-muted)] text-sm">
          Dati non disponibili
        </div>
      )}

      {!isLoading && !isError && chartData.length === 0 && (
        <div className="h-52 flex items-center justify-center text-[var(--color-muted)] text-sm">
          Nessun dato per il periodo selezionato
        </div>
      )}

      {!isLoading && !isError && chartData.length > 0 && (
        <ResponsiveContainer width="100%" height={210}>
          <BarChart
            data={chartData}
            margin={{ top: 4, right: 4, left: -10, bottom: 0 }}
            barCategoryGap="25%"
            barGap={2}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              stroke={cc.grid}
              vertical={false}
            />
            <XAxis
              dataKey="label"
              tick={{ fill: cc.tick, fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              interval={period === "day" ? "preserveStartEnd" : 0}
            />
            <YAxis
              tick={{ fill: cc.tick, fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v: number) =>
                v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(Math.round(v))
              }
              unit=" Wh"
            />
            <Tooltip content={<CustomTooltip />} cursor={{ fill: cc.cursor }} />
            <Legend
              wrapperStyle={{ fontSize: 11, color: cc.legend, paddingTop: 8 }}
            />
            <Bar dataKey="ch0" name="CH·0" fill="#6366f1" radius={[3, 3, 0, 0]} />
            <Bar dataKey="ch1" name="CH·1" fill="#f59e0b" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
