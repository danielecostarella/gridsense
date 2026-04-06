"use client";

import { useQuery } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";

interface AnomalySummaryItem {
  type: string;
  count: number;
  last_seen: string;
}

interface SummaryResponse {
  data: AnomalySummaryItem[];
  meta: { total: number };
}

async function fetchSummary(): Promise<SummaryResponse> {
  const res = await fetch("/api/anomalies/summary");
  if (!res.ok) throw new Error("Failed to fetch anomalies");
  return res.json() as Promise<SummaryResponse>;
}

const TYPE_META: Record<string, { label: string; color: string; icon: string }> = {
  spike:         { label: "Spike di potenza",  color: "#ef4444", icon: "⚡" },
  night_load:    { label: "Carico notturno",   color: "#f59e0b", icon: "🌙" },
  sustained_high:{ label: "Carico prolungato", color: "#818cf8", icon: "📈" },
};

export function AnomalyAlert() {
  const { data } = useQuery({
    queryKey: ["anomalies", "summary"],
    queryFn: fetchSummary,
    refetchInterval: 30_000,
    staleTime: 25_000,
  });

  const total = data?.meta.total ?? 0;
  const items = data?.data ?? [];

  if (total === 0) return null;

  return (
    <AnimatePresence>
      <motion.div
        className="
          bg-[var(--color-grid-800)] rounded-xl p-4
          border border-[#ef444440]
          flex flex-col gap-3
        "
        initial={{ opacity: 0, height: 0 }}
        animate={{ opacity: 1, height: "auto" }}
        exit={{ opacity: 0, height: 0 }}
        data-testid="anomaly-alert"
      >
        <div className="flex items-center gap-2">
          <span className="text-[#ef4444] text-sm font-semibold">
            {total} anomali{total === 1 ? "a" : "e"} nelle ultime 24h
          </span>
        </div>

        <div className="flex flex-col gap-2">
          {items.map((item) => {
            const meta = TYPE_META[item.type] ?? {
              label: item.type, color: "#64748b", icon: "⚠️",
            };
            return (
              <div key={item.type} className="flex items-center gap-2 text-xs">
                <span>{meta.icon}</span>
                <span style={{ color: meta.color }} className="font-medium">
                  {meta.label}
                </span>
                <span className="text-[var(--color-muted)]">×{item.count}</span>
                <span className="ml-auto text-[var(--color-muted)]">
                  {new Date(item.last_seen).toLocaleTimeString("it-IT", {
                    hour: "2-digit", minute: "2-digit",
                  })}
                </span>
              </div>
            );
          })}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
