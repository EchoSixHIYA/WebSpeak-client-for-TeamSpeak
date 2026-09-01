export type ThemeMode = "system" | "light" | "dark";

const THEME_KEY = "webspeak:theme";

export function getStoredTheme(): ThemeMode {
  const value = typeof localStorage === "undefined" ? "" : localStorage.getItem(THEME_KEY);
  return value === "light" || value === "dark" || value === "system" ? value : "system";
}

export function applyTheme(theme: ThemeMode): void {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = theme;
}

export function saveTheme(theme: ThemeMode): void {
  if (typeof localStorage !== "undefined") localStorage.setItem(THEME_KEY, theme);
  applyTheme(theme);
}

export function nextTheme(theme: ThemeMode): ThemeMode {
  return theme === "system" ? "light" : theme === "light" ? "dark" : "system";
}

applyTheme(getStoredTheme());
