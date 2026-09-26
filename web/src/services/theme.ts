export type ThemeMode = "system" | "light" | "dark";

import lightManifest from "../skins/builtin/light/manifest.json";
import lightCss from "../skins/builtin/light/skin.css?inline";
import darkManifest from "../skins/builtin/dark/manifest.json";
import darkCss from "../skins/builtin/dark/skin.css?inline";

const THEME_KEY = "webspeak:theme";
const SKIN_STYLE_ELEMENT_ID = "webspeak-active-built-in-skin";
let activeThemeMode: ThemeMode = "system";

const builtinSkins = {
  light: { manifest: lightManifest, css: lightCss },
  dark: { manifest: darkManifest, css: darkCss },
} as const;

export function getBuiltinSkinCss(theme: Exclude<ThemeMode, "system">): string {
  return theme === "dark" ? builtinSkins.dark.css : builtinSkins.light.css;
}

export function getStoredTheme(): ThemeMode {
  const value = typeof localStorage === "undefined" ? "" : localStorage.getItem(THEME_KEY);
  return value === "light" || value === "dark" || value === "system" ? value : "system";
}

export function applyTheme(theme: ThemeMode, options: { preserveCustomSkins?: boolean } = {}): void {
  if (typeof document === "undefined") return;
  activeThemeMode = theme;
  const root = document.documentElement;
  const activeSkin = isDarkTheme(theme) ? builtinSkins.dark : builtinSkins.light;

  // Keep data-theme for the admin console's independent appearance rules.
  // Built-in skin CSS is scoped to public roots and can never restyle /admin.
  root.dataset.theme = theme;
  document.querySelectorAll<HTMLElement>(".ws-skin-root").forEach((clientRoot) => {
    const currentSkin = clientRoot.dataset.wsSkin;
    const isCustomSkin = currentSkin !== builtinSkins.light.manifest.id && currentSkin !== builtinSkins.dark.manifest.id;
    if (options.preserveCustomSkins && currentSkin && isCustomSkin) return;
    clientRoot.dataset.wsSkin = activeSkin.manifest.id;
  });

  let style = document.getElementById(SKIN_STYLE_ELEMENT_ID) as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement("style");
    style.id = SKIN_STYLE_ELEMENT_ID;
    style.dataset.skinPackage = activeSkin.manifest.id;
    document.head.append(style);
  }
  style.dataset.skinPackage = activeSkin.manifest.id;
  style.textContent = activeSkin.css;
}

export function saveTheme(theme: ThemeMode): void {
  if (typeof localStorage !== "undefined") localStorage.setItem(THEME_KEY, theme);
  applyTheme(theme);
}

export function isDarkTheme(theme: ThemeMode): boolean {
  if (theme === "dark") return true;
  if (theme === "light") return false;
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-color-scheme: dark)").matches
    : false;
}

export function nextTheme(theme: ThemeMode): ThemeMode {
  return isDarkTheme(theme) ? "light" : "dark";
}

applyTheme(getStoredTheme());

if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
  const systemColorScheme = window.matchMedia("(prefers-color-scheme: dark)");
  const updateSystemSkin = () => {
    if (activeThemeMode === "system") applyTheme("system", { preserveCustomSkins: true });
  };
  if (systemColorScheme.addEventListener) systemColorScheme.addEventListener("change", updateSystemSkin);
  else systemColorScheme.addListener?.(updateSystemSkin);
}
