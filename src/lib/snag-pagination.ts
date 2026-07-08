export function snagResultsSummary({
  filtered,
  filtersActive,
  pageEnd,
  pageStart,
  totalPages,
}: {
  filtered: number;
  filtersActive: boolean;
  pageEnd: number;
  pageStart: number;
  totalPages: number;
}) {
  if (filtered === 0) return filtersActive ? "No matching snags" : "No snags found";

  const qualifier = filtersActive ? "matching " : "";

  if (totalPages <= 1) {
    return `${filtered} ${qualifier}snag${filtered === 1 ? "" : "s"} shown`;
  }

  return `Showing ${pageStart}-${pageEnd} of ${filtered} ${qualifier}snag${filtered === 1 ? "" : "s"}`;
}
