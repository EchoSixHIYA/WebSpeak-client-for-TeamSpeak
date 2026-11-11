/**
 * Closed-shadow, top-layer rendering layer for trusted host UI.
 *
 * Skin CSS is compiled to two scopes: `.ws-skin-root[data-ws-skin="…"] …` and
 * `:root[data-ws-host-skin="…"] [data-ws-part="host.…"] …`. Content rendered in
 * this layer satisfies neither:
 *
 *  - it lives inside a closed shadow root, so no author selector can reach its
 *    internals (open or closed, author CSS never crosses a shadow boundary);
 *  - its host element carries no `data-ws-part`, so it never matches the
 *    document-level host-chrome scope either;
 *  - whichever of its children is promoted to the top layer (`<dialog>`
 *    `showModal()` / a `popover="manual"` element) paints above every normal
 *    stacking context, including `z-index: 2147483647`.
 *
 * The host element is also a fixed, pointer-transparent wrapper so a browser
 * without the Popover API still shows the UI above ordinary content.
 */

export type HostOwnedLayerName = "recovery" | "authorization";

/**
 * The CSS 32-bit maximum stacking value. A compiled skin may legitimately use
 * `z-index: 2147483647` on a fullscreen part, so the pre-Popover fallback must
 * not sit below it. At equal maximum stacking the host layer still paints on
 * top: it is appended to `document.body` after `#app`, and later siblings win
 * when the stacking level ties. The top-layer paths (`showPopover()` /
 * `showModal()`) still outrank both.
 */
export const HOST_OWNED_LAYER_Z_INDEX = 2147483647;

export interface HostOwnedLayer {
  readonly name: HostOwnedLayerName;
  readonly host: HTMLElement;
  /** Closed shadow root; only the host that created the layer holds this. */
  readonly shadow: ShadowRoot;
  /** Teleport target for the layer's Vue subtree. */
  readonly container: HTMLElement;
  dispose(): void;
}

const layers = new Set<HostOwnedLayer>();

/** Diagnostics / tests: enumerate live host-owned layers in this realm. */
export function hostOwnedLayers(): readonly HostOwnedLayer[] {
  return [...layers];
}

/**
 * Create a detached-from-skin-DOM host with a closed shadow root and inject the
 * layer's stylesheet inside it. Returns `null` in a non-DOM environment.
 */
export function createHostOwnedLayer(name: HostOwnedLayerName, css: string): HostOwnedLayer | null {
  if (typeof document === "undefined" || !document.body) return null;

  const host = document.createElement("div");
  host.setAttribute("data-ws-host-layer", name);
  // The wrapper itself must never intercept clicks meant for the page; the
  // promoted child re-enables pointer events for its own controls.
  host.style.cssText = `position:fixed;inset:0;z-index:${HOST_OWNED_LAYER_Z_INDEX};pointer-events:none;overflow:visible;`;

  const shadow = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = css;
  const container = document.createElement("div");
  container.setAttribute("data-ws-host-layer-content", name);
  shadow.append(style, container);
  document.body.append(host);

  const layer: HostOwnedLayer = {
    name,
    host,
    shadow,
    container,
    dispose() {
      layers.delete(layer);
      host.remove();
    },
  };
  layers.add(layer);
  return layer;
}

type PopoverCapableElement = HTMLElement & {
  showPopover?: () => void;
  hidePopover?: () => void;
  matches?: (selector: string) => boolean;
};

/**
 * Elements that already used the display fallback must never flap back to the
 * Popover API: re-entering it could re-apply the UA `[popover] { display: none
 * !important }` rule and hide the capsule again.
 */
const popoverFallbacks = new WeakSet<HTMLElement>();

/**
 * Show or hide a manual recovery popover, with a display-based fallback.
 *
 * A closed `[popover]` is `display: none !important` in the UA stylesheet and
 * has no `:popover-open` box, so simply setting `style.display` leaves it
 * invisible. The fallback therefore removes the `popover` attribute before
 * assigning `display`. The same path is used when the Popover API is missing
 * or when top-layer promotion throws (for example in a constrained embed).
 */
export function syncRecoveryPopover(element: HTMLElement | null | undefined, visible: boolean): void {
  if (!element) return;

  const enterFallback = (): void => {
    popoverFallbacks.add(element);
    element.removeAttribute("popover");
    element.style.display = visible ? "flex" : "none";
  };

  if (popoverFallbacks.has(element)) {
    element.style.display = visible ? "flex" : "none";
    return;
  }

  const candidate = element as PopoverCapableElement;
  if (typeof candidate.showPopover !== "function") {
    // Pre-Popover browsers: the fixed host layer is the only fallback.
    enterFallback();
    return;
  }
  try {
    const open = candidate.matches?.(":popover-open") ?? false;
    if (visible && !open) candidate.showPopover();
    else if (!visible && open) candidate.hidePopover?.();
  } catch {
    // Constrained embeds may reject top-layer promotion. The fixed host layer
    // is still there, but only the display fallback can actually reveal it.
    enterFallback();
  }
}
