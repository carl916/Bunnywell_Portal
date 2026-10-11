export const REPORTING_TIME_ZONE = "Europe/London";

/** A reporting calendar date, never a conversion of a stored date-only field. */
export function reportingDate(now: number | Date = Date.now()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: REPORTING_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
