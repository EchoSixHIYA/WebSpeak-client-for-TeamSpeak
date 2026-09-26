import { getInstalledSkin, saveInstalledSkin } from "./local-persistence.js";
import type { InstalledSkin } from "./skin-pack.js";
import { applyTheme, getBuiltinSkinCss, getStoredTheme, isDarkTheme, type ThemeMode } from "./theme.js";

export const ACTIVE_SKIN_KEY = "webspeak:active-skin";
export const BUILTIN_LIGHT_SKIN = "builtin.light";
export const BUILTIN_DARK_SKIN = "builtin.dark";
const CUSTOM_STYLE_ID = "webspeak-active-custom-skin";
const BUILTIN_STYLE_ID = "webspeak-active-built-in-skin";

let activeAssetUrls: string[] = [];
let criticalControlObserver: MutationObserver | null = null;

export function getStoredSkinId(): string | null {
  return typeof localStorage === "undefined" ? null : localStorage.getItem(ACTIVE_SKIN_KEY);
}

export function storeSkinId(id: string): void {
  if (typeof localStorage !== "undefined") localStorage.setItem(ACTIVE_SKIN_KEY, id);
}

export async function activateStoredSkin(): Promise<InstalledSkin | null> {
  const storedId = getStoredSkinId();
  const legacyTheme = getStoredTheme();
  const selectedId = storedId || (isDarkTheme(legacyTheme) ? BUILTIN_DARK_SKIN : BUILTIN_LIGHT_SKIN);
  storeSkinId(selectedId);
  return activateSkin(selectedId);
}

export async function activateSkin(id: string, expectedVersion?: string, appVersion = "0.2.4"): Promise<InstalledSkin | null> {
  if (id === BUILTIN_LIGHT_SKIN || id === BUILTIN_DARK_SKIN) {
    clearCustomSkinStyle();
    applyTheme(id === BUILTIN_DARK_SKIN ? "dark" : "light");
    markCoreControls();
    storeSkinId(id);
    return null;
  }

  let skin = await getInstalledSkin(id);
  if (!skin || (expectedVersion && skin.version !== expectedVersion)) {
    try {
      const response = await fetch(`/api/skins/${encodeURIComponent(id)}/package`, { cache: "no-cache" });
      if (!response.ok) throw new Error("Skin package is no longer available.");
      const archive = await response.blob();
      const file = new File([archive], `${id}.wskin`, { type: "application/octet-stream" });
      const { importSkinPack } = await import("./skin-pack.js");
      const downloaded = await importSkinPack(file);
      if (downloaded.id !== id) throw new Error("Skin package ID does not match its catalog entry.");
      if (expectedVersion && downloaded.version !== expectedVersion) throw new Error("Skin package version does not match its catalog entry.");
      skin = downloaded;
      await saveInstalledSkin(downloaded).catch(() => undefined);
    } catch {
      if (!skin) return fallBackToBuiltin();
    }
  }

  if (!isVersionCompatible(appVersion, skin.minAppVersion)) return fallBackToBuiltin();

  try {
    const { resolveSkinCssAssets } = await import("./skin-pack.js");
    const compiled = resolveSkinCssAssets(skin.css, skin.assets);
    const baseTheme: Exclude<ThemeMode, "system"> = isDarkTheme(getStoredTheme()) ? "dark" : "light";
    applyTheme(baseTheme);
    const root = document.getElementById(BUILTIN_STYLE_ID) as HTMLStyleElement | null;
    if (root) {
      root.dataset.skinPackage = skin.id;
      root.textContent = getBuiltinSkinCss(baseTheme).replaceAll(`data-ws-skin="builtin.${baseTheme}"`, `data-ws-skin="${skin.id}"`);
    }
    document.querySelectorAll<HTMLElement>(".ws-skin-root").forEach((clientRoot) => {
      clientRoot.dataset.wsSkin = skin!.id;
    });
    markCoreControls();

    let style = document.getElementById(CUSTOM_STYLE_ID) as HTMLStyleElement | null;
    if (!style) {
      style = document.createElement("style");
      style.id = CUSTOM_STYLE_ID;
      document.head.append(style);
    }
    style.dataset.skinPackage = skin.id;
    style.textContent = compiled.css;
    const previousAssetUrls = activeAssetUrls;
    activeAssetUrls = compiled.objectUrls;
    previousAssetUrls.forEach((url) => URL.revokeObjectURL(url));
    storeSkinId(id);
    return skin;
  } catch {
    return fallBackToBuiltin();
  }
}

function fallBackToBuiltin(): null {
  const fallback = isDarkTheme(getStoredTheme()) ? BUILTIN_DARK_SKIN : BUILTIN_LIGHT_SKIN;
  clearCustomSkinStyle();
  applyTheme(fallback === BUILTIN_DARK_SKIN ? "dark" : "light");
  storeSkinId(fallback);
  return null;
}

export function clearCustomSkinStyle(): void {
  document.getElementById(CUSTOM_STYLE_ID)?.remove();
  activeAssetUrls.forEach((url) => URL.revokeObjectURL(url));
  activeAssetUrls = [];
}

function isVersionCompatible(current: string, minimum: string): boolean {
  const parse = (value: string) => /^(\d+)\.(\d+)\.(\d+)/.exec(value)?.slice(1).map(Number);
  const currentParts = parse(current);
  const minimumParts = parse(minimum);
  if (!currentParts || !minimumParts) return false;
  for (let index = 0; index < 3; index += 1) {
    if (currentParts[index] > minimumParts[index]) return true;
    if (currentParts[index] < minimumParts[index]) return false;
  }
  return true;
}

function markCoreControls(): void {
  const roots = [...document.querySelectorAll<HTMLElement>(".ws-skin-root")];
  const selector = "button, a[href], input, select, textarea, [role='button'], [role='menuitem'], [draggable='true']";
  const markElement = (element: HTMLElement) => {
    element.dataset.wsCritical = "true";
    element.dataset.wsPart ||= "control";
    const role = element.getAttribute("role");
    const type = element instanceof HTMLInputElement ? element.type : "";
    element.dataset.wsControlKind = role === "menuitem" ? "menuitem" : role === "button" ? "button" : element instanceof HTMLInputElement && type === "range" ? "range" : element instanceof HTMLInputElement && type === "checkbox" ? "checkbox" : element instanceof HTMLInputElement ? "input" : element instanceof HTMLTextAreaElement ? "textarea" : element instanceof HTMLSelectElement ? "select" : element instanceof HTMLAnchorElement ? "link" : element instanceof HTMLButtonElement ? "button" : "draggable";
  };
  const mark = (root: ParentNode) => {
    if (root instanceof HTMLElement && root.matches(selector)) markElement(root);
    root.querySelectorAll<HTMLElement>(selector).forEach(markElement);
  };
  roots.forEach(mark);
  if (!criticalControlObserver) {
    criticalControlObserver = new MutationObserver((records) => {
      for (const record of records) for (const node of record.addedNodes) {
        if (!(node instanceof HTMLElement)) continue;
        const clientRoot = node.matches(".ws-skin-root") ? node : node.closest<HTMLElement>(".ws-skin-root");
        if (!clientRoot) continue;
        mark(node);
      }
    });
    criticalControlObserver.observe(document.getElementById("app") ?? document.body, { childList: true, subtree: true });
  }
}
