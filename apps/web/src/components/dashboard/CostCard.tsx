"use client";

import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";

interface BandCost {
  band: "F1" | "F2" | "F3";
  energyKwh: number;
  costEur: number;
  label: string;
  color: string;
}

interface TodayCostResponse {
  data: {
    bands: BandCost[];
    total: { energyKwh: number; costEur: number };
  };
}

async function fetchTodayCost(): Promise<TodayCostResponse> {
  const res = await fetch("/api/cost/today");
  if (!res.ok) throw new Error("Failed to fetch cost");
  return res.json() as Promise<TodayCostResponse>;
}

export function CostCard() {
  const { data, isLoading } = useQuery({
    queryKey: ["cost", "today"],
    queryFn: fetchTodayCost,
    refetchInterval: 60_000,
    staleTime: 55_000,
  });

  const total = data?.data.total;
  const bands = data?.data.bands.filter((b) => b.energyKwh > 0) ?? [];

  return (
    <div
      className="bg-[var(--color-grid-800)] rounded-xl p-4 border border-[var(--color-grid-600)] flex flex-col gap-3"
      data-testid="cost-card"
    >
      <p className="text-xs text-[var(--color-muted)] uppercase tracking-widest font-medium">
        Costo stimato oggi
      </p>

      {isLoading ? (
        <p className="text-sm text-[var(--color-muted)]">Calcolo…</p>
      ) : (
        <>
          {/* Total cost — hero number */}
          <div className="flex items-baseline gap-1">
            <motion.span
              key={total?.costEur}
              className="text-3xl font-mono font-bold tabular-nums text-[var(--color-solar-400)]"
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
            >
              €{(total?.costEur ?? 0).toFixed(3)}
            </motion.span>
            <span className="text-sm text-[var(--color-muted)]">
              / {(total?.energyKwh ?? 0).toFixed(3)} kWh
            </span>
          </div>

          {/* Per-band breakdown */}
          {bands.length > 0 && (
            <div className="flex flex-col gap-1.5 border-t border-[var(--color-grid-600)] pt-3">
              {bands.map((b) => {
                const pct = total?.costEur
                  ? (b.costEur / total.costEur) * 100
                  : 0;
                return (
                  <div key={b.band} className="flex flex-col gap-0.5">
                    <div className="flex justify-between items-center text-xs">
                      <span style={{ color: b.color }}>{b.band}</span>
                      <span className="text-[var(--color-muted)]">
                        {b.energyKwh.toFixed(3)} kWh · €{b.costEur.toFixed(3)}
                      </span>
                    </div>
                    <div className="h-1 rounded-full bg-[var(--color-grid-700)] overflow-hidden">
                      <motion.div
                        className="h-full rounded-full"
                        style={{ backgroundColor: b.color }}
                        initial={{ width: 0 }}
                        animate={{ width: `${pct}%` }}
                        transition={{ duration: 0.6, ease: "easeOut" }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
