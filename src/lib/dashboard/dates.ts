export const DASHBOARD_TIME_ZONE = "Europe/London";
export const AUTHORITY_WARNING_HOURS = 48;
export const COMPLETION_WARNING_DAYS = 7;
export const EXPANDED_DEADLINE_DAYS = 30;
const DAY = 86_400_000;

export function londonDate(now: number | Date = Date.now()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: DASHBOARD_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function calendarDays(left: string, right: string) {
  return Math.round((Date.parse(`${right.slice(0, 10)}T12:00:00Z`) - Date.parse(`${left.slice(0, 10)}T12:00:00Z`)) / DAY);
}

export function addCalendarDays(date: string, days: number) {
  return new Date(Date.parse(`${date}T12:00:00Z`) + days * DAY).toISOString().slice(0, 10);
}

/** London midnight, including the 23/25-hour days at BST transitions. */
export function londonMidnight(date: string) {
  const utc = Date.parse(`${date}T00:00:00Z`);
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: DASHBOARD_TIME_ZONE, hour: "2-digit", hourCycle: "h23" }).format(utc));
  return utc - hour * 3_600_000;
}

export function recentBusinessWindow(now: number, days = 7) {
  const today = londonDate(now);
  return { start: londonMidnight(addCalendarDays(today, 1 - days)), end: londonMidnight(addCalendarDays(today, 1)) };
}

export type WorkDeadline = { at: string; precision: "date" | "instant"; basis: string };
export function deadlineState(deadline: WorkDeadline | null, now: number, upcomingDays = COMPLETION_WARNING_DAYS) {
  if (!deadline) return "none";
  if (deadline.precision === "instant") {
    const remaining = Date.parse(deadline.at) - now;
    return remaining <= 0 ? "overdue" : remaining <= AUTHORITY_WARNING_HOURS * 3_600_000 ? "soon" : "future";
  }
  const days = calendarDays(londonDate(now), deadline.at);
  return days < 0 ? "overdue" : days === 0 ? "today" : days <= upcomingDays ? "soon" : "future";
}

export function formatWorkDate(value: string, precision: "date" | "instant" = "instant") {
  const date = new Date(precision === "date" ? `${value.slice(0, 10)}T12:00:00Z` : value);
  if (!Number.isFinite(date.valueOf())) return "Date unavailable";
  return new Intl.DateTimeFormat("en-GB", { timeZone: DASHBOARD_TIME_ZONE, dateStyle: "medium", ...(precision === "instant" ? { timeStyle: "short" as const } : {}) }).format(date);
}
