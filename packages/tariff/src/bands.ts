/**
 * Italian electricity tariff band classifier — ARERA trioraria scheme.
 *
 *   F1  Peak       Mon-Fri 08:00-19:00  (excluding public holidays)
 *   F2  Mid        Mon-Fri 07:00-08:00 and 19:00-23:00
 *                  Sat 07:00-23:00
 *   F3  Off-peak   all other hours (nights, Sundays, holidays)
 *
 * Bioraria (common residential): F1 as above, F23 = F2 ∪ F3.
 * All classification is in Europe/Rome local time.
 */

export type TariffBand = "F1" | "F2" | "F3";

const FIXED_HOLIDAYS: ReadonlyArray<{ month: number; day: number }> = [
  { month: 1,  day: 1  }, // Capodanno
  { month: 1,  day: 6  }, // Epifania
  { month: 4,  day: 25 }, // Liberazione
  { month: 5,  day: 1  }, // Festa dei Lavoratori
  { month: 6,  day: 2  }, // Festa della Repubblica
  { month: 8,  day: 15 }, // Ferragosto
  { month: 11, day: 1  }, // Ognissanti
  { month: 12, day: 8  }, // Immacolata
  { month: 12, day: 25 }, // Natale
  { month: 12, day: 26 }, // Santo Stefano
];

/** Meeus/Jones/Butcher algorithm for Easter Sunday */
function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31) - 1; // 0-based
  const day   = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month, day);
}

function isItalianHoliday(rome: Date): boolean {
  const y = rome.getFullYear();
  const m = rome.getMonth() + 1;
  const d = rome.getDate();

  if (FIXED_HOLIDAYS.some((h) => h.month === m && h.day === d)) return true;

  const easter = easterSunday(y);
  if (rome.getMonth() === easter.getMonth() && d === easter.getDate()) return true;

  // Easter Monday
  const easterMon = new Date(easter);
  easterMon.setDate(easter.getDate() + 1);
  if (rome.getMonth() === easterMon.getMonth() && d === easterMon.getDate()) return true;

  return false;
}

/** Projects UTC to Europe/Rome wall-clock time via Intl. No external deps. */
function toRome(utc: Date): Date {
  return new Date(utc.toLocaleString("en-US", { timeZone: "Europe/Rome" }));
}

/** Classifies a UTC timestamp into an Italian tariff band. */
export function classifyBand(utc: Date): TariffBand {
  const rome = toRome(utc);
  const hour = rome.getHours();
  const dow  = rome.getDay(); // 0=Sun

  if (dow === 0 || isItalianHoliday(rome)) return "F3";
  if (dow === 6) return hour >= 7 && hour < 23 ? "F2" : "F3";

  // Mon-Fri
  if (hour >= 8 && hour < 19) return "F1";
  if ((hour >= 7 && hour < 8) || (hour >= 19 && hour < 23)) return "F2";
  return "F3";
}

export const BAND_META: Record<TariffBand, { label: string; color: string }> = {
  F1: { label: "F1 — Picco",       color: "#ef4444" },
  F2: { label: "F2 — Intermedio",  color: "#f59e0b" },
  F3: { label: "F3 — Fuori picco", color: "#10b981" },
};
