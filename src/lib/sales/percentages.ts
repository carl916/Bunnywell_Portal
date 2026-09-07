// Percentages are percentage points (9.5 means 9.5%), at the existing
// database precision of four decimal places. They are not currency amounts.
export function parsePercentInput(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || (typeof value === "string" && !value.trim())) return null;
  if (typeof value === "string" && !/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(value.trim())) return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0 || numeric > 100) return null;
  return Math.round(numeric * 10_000) / 10_000;
}
