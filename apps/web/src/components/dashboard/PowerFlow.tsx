"use client";

import { motion } from "framer-motion";
import type { LiveReadingsEvent } from "@/hooks/useLiveData";

interface Props {
  data: LiveReadingsEvent | null;
}

const GRID_COLOR = "#818cf8";   // accent
const LOAD_COLOR = "#f59e0b";   // power amber

function Particle({
  pathId,
  color,
  delay,
  duration,
}: {
  pathId: string;
  color: string;
  delay: number;
  duration: number;
}) {
  return (
    <motion.circle
      r={4}
      fill={color}
      filter={`drop-shadow(0 0 4px ${color})`}
      style={{ offsetPath: `path('#${pathId}')` } as React.CSSProperties}
      animate={{ offsetDistance: ["0%", "100%"], opacity: [0, 1, 1, 0] }}
      transition={{
        duration,
        delay,
        repeat: Infinity,
        ease: "linear",
        times: [0, 0.1, 0.9, 1],
      }}
    />
  );
}

function FlowLine({
  pathId,
  d,
  color,
  active,
  particleCount = 3,
  duration = 2,
}: {
  pathId: string;
  d: string;
  color: string;
  active: boolean;
  particleCount?: number;
  duration?: number;
}) {
  return (
    <>
      {/* Static path — subtle glow */}
      <path
        id={pathId}
        d={d}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeOpacity={active ? 0.25 : 0.08}
        strokeDasharray="4 6"
      />
      {/* Animated particles — only when flow is active */}
      {active &&
        Array.from({ length: particleCount }, (_, i) => (
          <Particle
            key={i}
            pathId={pathId}
            color={color}
            delay={(i * duration) / particleCount}
            duration={duration}
          />
        ))}
    </>
  );
}

function NodeCircle({
  cx,
  cy,
  label,
  sublabel,
  color,
  active,
}: {
  cx: number;
  cy: number;
  label: string;
  sublabel: string;
  color: string;
  active: boolean;
}) {
  return (
    <g>
      {/* Outer glow ring */}
      {active && (
        <motion.circle
          cx={cx}
          cy={cy}
          r={32}
          fill="none"
          stroke={color}
          strokeWidth={1}
          strokeOpacity={0.3}
          animate={{ r: [32, 38, 32] }}
          transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
        />
      )}
      {/* Node background */}
      <circle cx={cx} cy={cy} r={28} fill="#161625" stroke={color} strokeWidth={1.5} strokeOpacity={active ? 0.6 : 0.2} />
      {/* Icon area — text fallback */}
      <text x={cx} y={cy - 4} textAnchor="middle" fill={active ? color : "#64748b"} fontSize={11} fontWeight={600}>
        {label}
      </text>
      <text x={cx} y={cy + 10} textAnchor="middle" fill="#64748b" fontSize={9}>
        {sublabel}
      </text>
    </g>
  );
}

export function PowerFlow({ data }: Props) {
  const ch0 = data?.channels[0];
  const ch1 = data?.channels[1];

  const gridActive = (ch0?.actPowerW ?? 0) > 5;
  const ch1Active = (ch1?.actPowerW ?? 0) > 5;

  // Derive particle speed from power magnitude (higher power = faster particles)
  const ch0Duration = Math.max(0.8, 3 - ((ch0?.actPowerW ?? 0) / 3000) * 2);
  const ch1Duration = Math.max(0.8, 3 - ((ch1?.actPowerW ?? 0) / 1000) * 2);

  const totalW = data?.system.totalActPowerW ?? 0;

  return (
    <div className="flex flex-col items-center gap-3" data-testid="power-flow">
      <p className="text-xs text-[var(--color-muted)] uppercase tracking-widest">
        Power Flow
      </p>

      <svg viewBox="0 0 340 180" className="w-full max-w-sm" aria-label="Energy flow diagram">
        {/* ── Paths ── */}
        {/* Grid → Home */}
        <FlowLine
          pathId="p-grid-home"
          d="M 70,90 C 120,90 180,90 230,90"
          color={GRID_COLOR}
          active={gridActive}
          particleCount={3}
          duration={ch0Duration}
        />

        {/* Ch1 → Home (from below) */}
        <FlowLine
          pathId="p-ch1-home"
          d="M 70,148 C 120,148 180,130 230,105"
          color={LOAD_COLOR}
          active={ch1Active}
          particleCount={2}
          duration={ch1Duration}
        />

        {/* Home → Loads */}
        <FlowLine
          pathId="p-home-loads"
          d="M 258,90 C 280,90 295,75 310,65"
          color={LOAD_COLOR}
          active={gridActive}
          particleCount={2}
          duration={ch0Duration * 1.2}
        />
        <FlowLine
          pathId="p-home-loads2"
          d="M 258,90 C 280,90 295,105 310,115"
          color={LOAD_COLOR}
          active={gridActive}
          particleCount={2}
          duration={ch0Duration * 1.5}
        />

        {/* ── Nodes ── */}
        {/* Grid / Channel 0 */}
        <NodeCircle
          cx={52}
          cy={90}
          label="GRID"
          sublabel={`CH·0`}
          color={GRID_COLOR}
          active={gridActive}
        />

        {/* Channel 1 */}
        <NodeCircle
          cx={52}
          cy={148}
          label="CH·1"
          sublabel="aux"
          color={LOAD_COLOR}
          active={ch1Active}
        />

        {/* Home */}
        <NodeCircle
          cx={244}
          cy={90}
          label="HOME"
          sublabel={`${Math.round(totalW)} W`}
          color={LOAD_COLOR}
          active={gridActive || ch1Active}
        />

        {/* Load indicators */}
        <circle cx={318} cy={63} r={10} fill="#161625" stroke={LOAD_COLOR} strokeWidth={1} strokeOpacity={gridActive ? 0.5 : 0.15} />
        <text x={318} y={67} textAnchor="middle" fill={gridActive ? LOAD_COLOR : "#334155"} fontSize={9}>L1</text>

        <circle cx={318} cy={117} r={10} fill="#161625" stroke={LOAD_COLOR} strokeWidth={1} strokeOpacity={gridActive ? 0.5 : 0.15} />
        <text x={318} y={121} textAnchor="middle" fill={gridActive ? LOAD_COLOR : "#334155"} fontSize={9}>L2</text>

        {/* ── Voltage / frequency label ── */}
        {ch0 && (
          <text x={170} y={76} textAnchor="middle" fill="#475569" fontSize={9}>
            {ch0.voltageV.toFixed(1)} V · {ch0.frequencyHz.toFixed(1)} Hz
          </text>
        )}
      </svg>
    </div>
  );
}
