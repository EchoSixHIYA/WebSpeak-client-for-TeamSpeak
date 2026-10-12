export function promoteHostEditorToTopLayer(element: HTMLElement | null): void {
  const popover = element as (HTMLElement & {
    showPopover?: () => void;
    matches?: (selectors: string) => boolean;
  }) | null;
  if (!popover || typeof popover.showPopover !== "function") return;

  try {
    if (popover.matches?.(":popover-open")) return;
    popover.setAttribute("popover", "manual");
    popover.showPopover();
  } catch {
    popover.removeAttribute("popover");
  }
}
