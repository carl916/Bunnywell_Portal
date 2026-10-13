/** All buyer-deposit timing is UK civil time; entry timestamps are separate facts. */
export type FurtherDepositTiming = {
  basis: "after_exchange" | "before_pc" | "fixed";
  months?: number | null;
  date?: string | null;
  time?: string | null;
  instant?: string | null;
};
export type FurtherDepositFact = {
  id: string; sale_attempt_id: string; required: boolean; expected_amount: number | null;
  percent: number | null; received_amount: number; timing: FurtherDepositTiming | null;
  months_after_exchange: number | null; exchanged_at: string | null; pc_date: string | null;
  deadline: { date: string; time: string | null; instant: string | null; id?: string } | null;
  terms_version: number | null;
};
export function londonDateTime(value: number | string = Date.now()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(value));
  const p = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}
export function calendarDate(value?: string | null): value is string {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T12:00:00Z`)) && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value);
}
/** Reject the missing/repeated hour rather than silently choosing a different instant. */
export function londonInstant(date: string, time: string): string | null {
  if (!calendarDate(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return null;
  const naive = Date.parse(`${date}T${time}:00Z`);
  const matches = [naive, naive - 3600000].filter(value => { const local = londonDateTime(value); return local.date === date && local.time === time; });
  return matches.length === 1 ? new Date(matches[0]).toISOString() : null;
}
export function addCalendarMonths(date: string, months: number): string | null {
  if (!calendarDate(date) || !Number.isInteger(months)) return null;
  const [year, month, day] = date.split("-").map(Number);
  const target = new Date(Date.UTC(year, month - 1 + months, 1, 12));
  const end = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, end));
  return target.toISOString().slice(0, 10);
}
export function timingDescription(timing?: FurtherDepositTiming | null, legacyMonths?: number | null) {
  const basis = timing?.basis ?? "after_exchange";
  const months = timing?.months ?? legacyMonths;
  if (basis === "fixed") return timing?.date ? `${timing.date}${timing.time ? ` at ${timing.time} UK time` : " (date only)"}` : "Deadline needs confirmation";
  return months == null ? "Timing needs confirmation" : `${months} calendar months ${basis === "before_pc" ? "before target practical completion" : "after legal exchange"}`;
}
export function timingError(timing: FurtherDepositTiming | null | undefined, legacyMonths: number | null, requireTime = false) {
  if (timing?.basis === "fixed") {
    if (!calendarDate(timing.date)) return "Enter a valid further-deposit deadline date.";
    if (requireTime && !timing.time) return "Enter the deadline time in UK time.";
    if (timing.time && !londonInstant(timing.date, timing.time)) return "Enter an unambiguous UK time (outside the daylight-saving clock change).";
  } else {
    const months = timing?.months ?? legacyMonths;
    if (months == null || !Number.isInteger(months) || months < 0 || months > 1200) return "Enter a whole number of calendar months (0–1200).";
  }
  return null;
}
export function furtherDepositState(fact: FurtherDepositFact, now: number) {
  const expectedPence = fact.expected_amount == null ? null : Math.round(Number(fact.expected_amount) * 100);
  const receivedPence = Math.round(Number(fact.received_amount) * 100);
  const outstanding = expectedPence == null ? null : Math.max(0, expectedPence - receivedPence) / 100;
  const excess = expectedPence == null ? 0 : Math.max(0, receivedPence - expectedPence) / 100;
  const payment = expectedPence != null && receivedPence >= expectedPence ? "Received" : receivedPence > 0 ? "Part received" : "Not received";
  const rule = fact.timing;
  const basis = rule?.basis ?? "after_exchange";
  const months = rule?.months ?? fact.months_after_exchange;
  let date = fact.deadline?.date ?? (basis === "fixed" ? rule?.date : null) ?? null;
  const time = fact.deadline ? fact.deadline.time : (basis === "fixed" ? rule?.time : null) ?? null;
  const instant = fact.deadline ? fact.deadline.instant : (date && time ? londonInstant(date, time) : null);
  const forecast = !fact.deadline && basis === "before_pc";
  let explanation = timingDescription(rule, fact.months_after_exchange);
  if (!date && basis !== "fixed" && months != null) {
    const anchor = basis === "before_pc" ? fact.pc_date : fact.exchanged_at;
    date = anchor ? addCalendarMonths(anchor, basis === "before_pc" ? -months : months) : null;
    if (!date) explanation += anchor ? ". Anchor has month-level or invalid precision; exact date needs confirmation." : `. ${basis === "before_pc" ? "Target PC" : "Legal exchange date"} not recorded.`;
  }
  const beforeExchange = Boolean(date && fact.exchanged_at && date < fact.exchanged_at.slice(0, 10));
  const confirmed = Boolean(date && !forecast && !beforeExchange && (!time || instant));
  const today = londonDateTime(now).date;
  const days = date ? Math.round((Date.parse(`${date}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86400000) : null;
  // Exact instant belongs to overdue; date-only obligations expire after that UK day.
  const timing = !confirmed ? "Deadline needs confirmation" : instant ? Date.parse(instant) <= now ? "Overdue" : date === today ? "Due today" : days! <= 30 ? "Upcoming" : "Scheduled" : days! < 0 ? "Overdue" : days === 0 ? "Due today" : days! <= 30 ? "Upcoming" : "Scheduled";
  return { outstanding, excess, payment, date, time, instant, forecast, confirmed, beforeExchange, timing, explanation };
}
