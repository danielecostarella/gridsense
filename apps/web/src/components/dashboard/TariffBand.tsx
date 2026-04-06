"use client";

import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";

interface BandResponse {
  band: "F1" | "F2" | "F3";
  label: string;
  color: string;
  rate: number;
}

async function fetchCurrentBand(): Promise<BandResponse> {
  const res = await fetch("/api/cost/current-band");
  if (!res.ok) throw new Error("Failed to fetch band");
  return res.json() as Promise<BandResponse>;
}

export function TariffBand() {
  const { data } = useQuery({
    queryKey: ["tariff-band"],
    queryFn: fetchCurrentBand,
    refetchInterval: 60_000,
    staleTime: 55_000,
  });

  if (!data) return null;

  return (
    <motion.div
      className="flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-medium"
      style={{
        borderColor: `${data.color}40`,
        backgroundColor: `${data.color}10`,
        color: data.color,
      }}
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      data-testid="tariff-band"
    >
      <span
        className="w-1.5 h-1.5 rounded-full"
        style={{ backgroundColor: data.color }}
      />
      {data.band} · €{data.rate.toFixed(4)}/kWh
    </motion.div>
  );
}
