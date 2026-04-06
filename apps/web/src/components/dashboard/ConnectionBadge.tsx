"use client";

import { motion } from "framer-motion";

type State = "connecting" | "connected" | "disconnected" | "error";

const CONFIG: Record<State, { label: string; color: string; pulse: boolean }> = {
  connecting:   { label: "Connecting",   color: "#f59e0b", pulse: true  },
  connected:    { label: "Live",         color: "#10b981", pulse: true  },
  disconnected: { label: "Reconnecting", color: "#64748b", pulse: false },
  error:        { label: "Error",        color: "#ef4444", pulse: false },
};

export function ConnectionBadge({ state }: { state: State }) {
  const { label, color, pulse } = CONFIG[state];

  return (
    <div className="flex items-center gap-2" data-testid="connection-badge">
      <div className="relative flex items-center justify-center w-2.5 h-2.5">
        {pulse && (
          <motion.div
            className="absolute inset-0 rounded-full"
            style={{ backgroundColor: color }}
            animate={{ scale: [1, 1.8, 1], opacity: [0.6, 0, 0.6] }}
            transition={{ duration: 1.5, repeat: Infinity }}
          />
        )}
        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
      </div>
      <span className="text-xs font-medium" style={{ color }}>
        {label}
      </span>
    </div>
  );
}
