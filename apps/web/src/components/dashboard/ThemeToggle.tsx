"use client";

import { useTheme } from "@/context/ThemeContext";

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === "dark";

  return (
    <button
      onClick={toggleTheme}
      aria-label={isDark ? "Passa alla modalità chiara" : "Passa alla modalità scura"}
      title={isDark ? "Light mode" : "Dark mode"}
      className="
        w-8 h-8 rounded-full flex items-center justify-center
        border border-[var(--color-grid-600)]
        bg-[var(--color-grid-800)] hover:bg-[var(--color-grid-700)]
        text-[var(--color-muted)] hover:text-[var(--color-fg)]
        transition-colors text-sm
      "
      data-testid="theme-toggle"
    >
      {isDark ? "☀" : "☾"}
    </button>
  );
}
