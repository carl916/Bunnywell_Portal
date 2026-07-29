export function parseGbpInput(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? Math.trunc(value) : null;

  const cleaned = value.replace(/[£,\s]/g, "").replace(/[^\d.]/g, "");
  const digits = cleaned.split(".")[0]?.replace(/[^\d]/g, "") ?? "";
  if (!digits) return null;
  const numeric = Number(digits);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : null;
}

export function formatGbp(value: string | number | null | undefined, fallback = "-") {
  const numeric = typeof value === "string" ? parseGbpInput(value) : value;
  if (numeric === null || numeric === undefined || Number.isNaN(Number(numeric))) return fallback;
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 }).format(Number(numeric));
}

export function formatGbpDeduction(value: string | number | null | undefined) {
  const numeric = typeof value === "string" ? parseGbpInput(value) : value;
  if (!numeric || Number.isNaN(Number(numeric))) return formatGbp(0);
  return `-${formatGbp(numeric)}`;
}

export function formatGbpInputValue(value: string | number | null | undefined) {
  const numeric = typeof value === "string" ? parseGbpInput(value) : value;
  if (numeric === null || numeric === undefined || Number.isNaN(Number(numeric))) return "";
  return new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 }).format(Number(numeric));
}

export function rawGbpInputValue(value: string | number | null | undefined) {
  const numeric = parseGbpInput(value);
  return numeric === null ? "" : String(numeric);
}
