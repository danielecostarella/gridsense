"use client";

import { useQuery } from "@tanstack/react-query";

interface EnergyDelta {
  channelId: number;
  consumedWh: number;
  returnedWh: number;
  netWh: number;
}

interface TodayResponse {
  data: {
    channels: EnergyDelta[];
    total: { consumedWh: number; returnedWh: number; netWh: number };
  };
}

async function fetchToday(): Promise<TodayResponse> {
  const res = await fetch("/api/energy/today");
  if (!res.ok) throw new Error("Failed to fetch today energy");
  return res.json() as Promise<TodayResponse>;
}

function KwhBadge({
  label,
  value,
  color,
  testId,
}: {
  label: string;
  value: number;
  color: string;
  testId?: string;
}) {
  return (
    <div data-testid={testId} className="flex flex-col gap-0.5">
      <span className="text-xs text-[var(--color-muted)]">{label}</span>
      <span className="text-lg font-mono font-bold tabular-nums" style={{ color }}>
        {(value / 1000).toFixed(2)}
        <span className="text-sm font-normal text-[var(--color-muted)] ml-1">kWh</span>
      </span>
    </div>
  );
}

export function TodayEnergy() {
  const { data, isLoading } = useQuery({
    queryKey: ["energy", "today"],
    queryFn: fetchToday,
    refetchInterval: 30_000,
    staleTime: 25_000,
  });

  const total = data?.data.total;
  const channels = data?.data.channels ?? [];

  return (
    <div
      className="bg-[var(--color-grid-800)] rounded-xl p-4 border border-[var(--color-grid-600)] flex flex-col gap-3"
      data-testid="today-energy"
    >
      <p className="text-xs text-[var(--color-muted)] uppercase tracking-widest font-medium">
        Today
      </p>

      {isLoading ? (
        <p className="text-sm text-[var(--color-muted)]">Loading…</p>
      ) : (
        <>
          <KwhBadge
            label="Consumed"
            value={total?.consumedWh ?? 0}
            color="var(--color-power-400)"
            testId="today-consumed"
          />
          {(total?.returnedWh ?? 0) > 10 && (
            <KwhBadge
              label="Returned"
              value={total?.returnedWh ?? 0}
              color="var(--color-solar-400)"
              testId="today-returned"
            />
          )}

          {/* Per-channel breakdown */}
          <div className="border-t border-[var(--color-grid-600)] pt-3 flex gap-4">
            {channels.map((ch) => (
              <div key={ch.channelId} className="flex flex-col gap-0.5">
                <span className="text-xs text-[var(--color-muted)]">CH·{ch.channelId}</span>
                <span className="text-sm font-mono text-[var(--color-accent-400)]">
                  {(ch.consumedWh / 1000).toFixed(3)} kWh
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
