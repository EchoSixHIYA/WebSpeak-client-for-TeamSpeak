interface Size { width: number; height: number }
interface Point { x: number; y: number }
interface Anchor { left: number; right: number; top: number }

export function memberMenuInvocationPoint(
  event: Pick<MouseEvent, "type" | "detail" | "clientX" | "clientY">,
  triggerPoint: Point,
): Point {
  if (event.type !== "contextmenu" && event.detail <= 0) return triggerPoint;
  return { x: event.clientX, y: event.clientY };
}

// All inputs and results are rendered viewport pixels. CSS zoom conversion
// belongs to the component, after placement has been constrained.
export function placeMemberMenu(point: Point, size: Size, viewport: Size, inset = 12): Point {
  return {
    x: Math.max(inset, Math.min(point.x, viewport.width - size.width - inset)),
    y: Math.max(inset, Math.min(point.y, viewport.height - size.height - inset)),
  };
}

export function placeMemberSubmenu(anchor: Anchor, size: Size, viewport: Size, gap = 6): Point {
  const right = anchor.right + gap;
  const x = right + size.width <= viewport.width - 12 ? right : anchor.left - gap - size.width;
  return placeMemberMenu({ x, y: anchor.top }, size, viewport);
}
