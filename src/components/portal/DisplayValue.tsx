import type { ReactNode } from "react";

export function isEmptyDisplayValue(value: unknown) {
  return value == null || (typeof value === "string" && value.trim() === "");
}

/** Read-only fields only: keep input placeholders and workflow statuses explicit. */
export function EmptyValue() {
  return <span className="text-[#617169]" data-empty-value>—</span>;
}

/** Preserve populated content and its styling, including zero and boolean values. */
export function DisplayValue({ value }: { value?: ReactNode }) {
  // Some existing display formatters return a dash for absent values.
  if (isEmptyDisplayValue(value) || (typeof value === "string" && ["-", "—"].includes(value.trim()))) {
    return <EmptyValue />;
  }
  return <>{typeof value === "boolean" ? String(value) : value}</>;
}
