export interface SkinLayoutRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface SkinLayoutOffsetBounds {
  minimum: number;
  maximum: number;
}

export interface SkinLayoutGeometryIssues {
  overflow: boolean;
  overlap: boolean;
}

export function analyzeSkinLayoutGeometry(
  targets: readonly SkinLayoutRect[],
  container: SkinLayoutRect,
  peers: readonly SkinLayoutRect[],
  overlapThreshold = 8,
): SkinLayoutGeometryIssues {
  const intersects = (first: SkinLayoutRect, second: SkinLayoutRect) => {
    const width = Math.min(first.right, second.right) - Math.max(first.left, second.left);
    const height = Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top);
    return width > overlapThreshold && height > overlapThreshold;
  };
  const overflow = targets.some((target) => target.left < container.left - 1 || target.top < container.top - 1
    || target.right > container.right + 1 || target.bottom > container.bottom + 1);
  const overlap = targets.some((target, index) => peers.some((peer) => intersects(target, peer))
    || targets.slice(index + 1).some((peer) => intersects(target, peer)));
  return { overflow, overlap };
}

export function getSkinLayoutOffsetBounds(
  targets: readonly SkinLayoutRect[],
  container: SkinLayoutRect,
  currentOffset: number,
  axis: "x" | "y",
  absoluteLimit = 2000,
): SkinLayoutOffsetBounds | null {
  if (!targets.length || !Number.isFinite(currentOffset)) return null;
  const containerStart = axis === "x" ? container.left : container.top;
  const containerEnd = axis === "x" ? container.right : container.bottom;
  let minimum = -absoluteLimit;
  let maximum = absoluteLimit;
  for (const target of targets) {
    const start = axis === "x" ? target.left : target.top;
    const end = axis === "x" ? target.right : target.bottom;
    const baseStart = start - currentOffset;
    const baseEnd = end - currentOffset;
    minimum = Math.max(minimum, containerStart - baseStart);
    maximum = Math.min(maximum, containerEnd - baseEnd);
  }
  return minimum <= maximum ? { minimum: Math.ceil(minimum), maximum: Math.floor(maximum) } : null;
}

export function clampSkinLayoutOffset(value: number, bounds: SkinLayoutOffsetBounds | null): number {
  if (!bounds || !Number.isFinite(value)) return 0;
  return Math.max(bounds.minimum, Math.min(bounds.maximum, Math.round(value)));
}
