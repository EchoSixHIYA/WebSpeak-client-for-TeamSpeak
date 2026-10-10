export interface AudioDeviceMenuAnchor {
  top: number;
  bottom: number;
  left: number;
  width: number;
}

export interface AudioDeviceMenuPlacement {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
}

const VIEWPORT_INSET = 8;
const MENU_GAP = 4;
const MAX_MENU_HEIGHT = 240;

export function placeAudioDeviceMenu(
  anchor: AudioDeviceMenuAnchor,
  viewport: { width: number; height: number },
  naturalMenuHeight: number,
): AudioDeviceMenuPlacement {
  const insetX = Math.min(VIEWPORT_INSET, Math.max(0, viewport.width / 2));
  const width = Math.min(Math.max(0, anchor.width), Math.max(0, viewport.width - insetX * 2));
  const left = Math.max(insetX, Math.min(anchor.left, viewport.width - insetX - width));
  const fullHeight = Math.min(MAX_MENU_HEIGHT, Number.isFinite(naturalMenuHeight) ? Math.max(0, naturalMenuHeight) : 0);
  const below = Math.max(0, viewport.height - VIEWPORT_INSET - anchor.bottom - MENU_GAP);
  const above = Math.max(0, anchor.top - VIEWPORT_INSET - MENU_GAP);
  const opensAbove = below < fullHeight && above > below;
  const available = opensAbove ? above : below;
  const maxHeight = Math.min(fullHeight, available);
  const top = opensAbove ? anchor.top - MENU_GAP - maxHeight : anchor.bottom + MENU_GAP;

  return { top, left, width, maxHeight };
}
