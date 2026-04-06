"use client";

import { motion, AnimatePresence } from "framer-motion";

interface Props {
  label: string;
  value: number | null;
  unit: string;
  decimals?: number;
  accent?: "default" | "power" | "solar" | "danger";
  size?: "sm" | "md" | "lg";
  sublabel?: string;
  testId?: string;
}

const ACCENT_COLORS = {
  default: "var(--color-accent-400)",
  power:   "var(--color-power-400)",
  solar:   "var(--color-solar-400)",
  danger:  "var(--color-danger-500)",
};

export function MetricCard({
  label,
  value,
  unit,
  decimals = 1,
  accent = "default",
  size = "md",
  sublabel,
  testId,
}: Props) {
  const color = ACCENT_COLORS[accent];
  const formatted =
    value === null ? "—" : value.toLocaleString("it-IT", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });

  const valueSize =
    size === "lg" ? "text-4xl" : size === "md" ? "text-2xl" : "text-lg";

  return (
    <div
      className="
        bg-[var(--color-grid-800)] rounded-xl p-4
        border border-[var(--color-grid-600)]
        flex flex-col gap-1
      "
      data-testid={testId}
    >
      <p className="text-xs text-[var(--color-muted)] uppercase tracking-widest font-medium">
        {label}
      </p>

      <div className="flex items-baseline gap-1.5">
        <AnimatePresence mode="wait">
          <motion.span
            key={formatted}
            className={`${valueSize} font-mono font-bold tabular-nums`}
            style={{ color }}
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            transition={{ duration: 0.15 }}
          >
            {formatted}
          </motion.span>
        </AnimatePresence>
        <span className="text-sm text-[var(--color-muted)]">{unit}</span>
      </div>

      {sublabel && (
        <p className="text-xs text-[var(--color-muted)]">{sublabel}</p>
      )}
    </div>
  );
}
