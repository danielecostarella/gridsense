import type { TariffBand } from "./bands.js";

/**
 * Tariff rates in €/kWh.
 *
 * Defaults are indicative Italian Maggior Tutela / Servizio di tutela values
 * (ARERA, Q1 2026). Override via env vars at collector/API startup.
 *
 *   TARIFF_F1_RATE — peak rate
 *   TARIFF_F2_RATE — mid rate
 *   TARIFF_F3_RATE — off-peak rate
 */
export interface TariffRates {
  F1: number; // €/kWh
  F2: number;
  F3: number;
}

export const DEFAULT_RATES: TariffRates = {
  F1: 0.2596,
  F2: 0.2180,
  F3: 0.1820,
};

export function loadRatesFromEnv(): TariffRates {
  return {
    F1: parseFloat(process.env["TARIFF_F1_RATE"] ?? String(DEFAULT_RATES.F1)),
    F2: parseFloat(process.env["TARIFF_F2_RATE"] ?? String(DEFAULT_RATES.F2)),
    F3: parseFloat(process.env["TARIFF_F3_RATE"] ?? String(DEFAULT_RATES.F3)),
  };
}

export function rateFor(band: TariffBand, rates: TariffRates): number {
  return rates[band];
}
