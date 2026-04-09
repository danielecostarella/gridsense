"use client";

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { useQuery } from "@tanstack/react-query";
import { useTheme } from "@/context/ThemeContext";

interface HistoryPoint {
  bucket: string;
  channelId: number;
  avgActPower: number;
}

interface ChartPoint {
  time: string;
  ch0: number;
  ch1: number;
}

async function fetchHistory(): Promise<ChartPoint[]> {
  const from = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // last hour
  const res = await fetch(`/api/readings/history?from=${from}&resolution=1m`);
  if (!res.ok) throw new Error("Failed to fetch history");
  const json = (await res.json()) as { data: HistoryPoint[] };

  // Pivot: [{bucket, channelId, avgActPower}] → [{time, ch0, ch1}]
  const map = new Map<string, ChartPoint>();
  for (const row of json.data) {
    const time = new Date(row.bucket).toLocaleTimeString("it-IT", {
      hour: "2-digit",
      minute: "2-digit",
    });
    const existing = map.get(time) ?? { time, ch0: 0, ch1: 0 };
    if (row.channelId === 0) existing.ch0 = row.avgActPower;
    else existing.ch1 = row.avgActPower;
    map.set(time, existing);
  }

  return Array.from(map.values());
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
          {p.name}: {p.value.toFixed(0)} W
        </p>
      ))}
    </div>
  );
};

const CHART_COLORS = {
  dark:  { grid: "#1f1f35", tick: "#64748b" },
  light: { grid: "#e2e8f0", tick: "#94a3b8" },
};

export function PowerChart() {
  const { theme } = useTheme();
  const cc = CHART_COLORS[theme];
  const { data, isLoading, isError } = useQuery({
    queryKey: ["history", "1h"],
    queryFn: fetchHistory,
    refetchInterval: 60_000, // refresh every minute
    staleTime: 50_000,
  });

  if (isLoading) {
    return (
      <div className="h-48 flex items-center justify-center text-[var(--color-muted)] text-sm">
        Loading history…
      </div>
    );
  }

  if (isError || !data?.length) {
    return (
      <div className="h-48 flex items-center justify-center text-[var(--color-muted)] text-sm">
        No historical data yet
      </div>
    );
  }

  return (
    <div data-testid="power-chart">
      <p className="text-xs text-[var(--color-muted)] uppercase tracking-widest mb-3">
        Active Power — Last Hour
      </p>
      <ResponsiveContainer width="100%" height={180}>
        <AreaChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
          <defs>
            <linearGradient id="ch0-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="ch1-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke={cc.grid} vertical={false} />
          <XAxis
            dataKey="time"
            tick={{ fill: cc.tick, fontSize: 10 }}
            tickLine={false}
            axisLine={false}
            interval="preserveStartEnd"
          />
          <YAxis
            tick={{ fill: cc.tick, fontSize: 10 }}
            tickLine={false}
            axisLine={false}
            unit=" W"
          />
          <Tooltip content={<CustomTooltip />} />
          <Area
            type="monotone"
            dataKey="ch0"
            name="CH·0"
            stroke="#6366f1"
            strokeWidth={2}
            fill="url(#ch0-grad)"
            dot={false}
          />
          <Area
            type="monotone"
            dataKey="ch1"
            name="CH·1"
            stroke="#f59e0b"
            strokeWidth={2}
            fill="url(#ch1-grad)"
            dot={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
