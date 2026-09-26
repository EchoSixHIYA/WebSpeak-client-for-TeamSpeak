export function resolveVisitorTotal(visitorNumber: number | null, recordedTotal: unknown): number | null {
  const currentVisitor = Number.isSafeInteger(visitorNumber) && Number(visitorNumber) > 0
    ? Number(visitorNumber)
    : null;
  const total = typeof recordedTotal === "number" && Number.isSafeInteger(recordedTotal) && recordedTotal >= 0
    ? recordedTotal
    : null;

  if (total === null) return currentVisitor;
  return Math.max(total, currentVisitor ?? 0);
}
