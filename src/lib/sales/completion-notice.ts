export const MAX_NOTICE_BYTES = 10 * 1024 * 1024;

export function isCalendarDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

// Shared calendar arithmetic, independent of the browser timezone. Callers may
// supply their applicable holiday calendar; existing callers retain their policy.
export function addWorkingDays(value: string, count = 10, holidays: readonly string[] = []) {
  if (!isCalendarDate(value)) return "";
  const date = new Date(`${value}T12:00:00Z`);
  while (count > 0) {
    date.setUTCDate(date.getUTCDate() + 1);
    if (date.getUTCDay() !== 0 && date.getUTCDay() !== 6 && !holidays.includes(date.toISOString().slice(0, 10))) count--;
  }
  return date.toISOString().slice(0, 10);
}

export function validNoticeDates(notice: string, due: string) {
  return isCalendarDate(notice) && isCalendarDate(due) && due >= notice;
}

export function noticeFileError(file: Pick<File, "name" | "size" | "type"> | null) {
  return !file || file.size <= 0 || file.size > MAX_NOTICE_BYTES || !file.name.toLowerCase().endsWith(".pdf") || (file.type && file.type !== "application/pdf")
    ? "Choose a PDF up to 10 MB." : null;
}

export type CompletionNoticeState = {
  completion_authority_given_at?: string | null;
  completion_arrangements_confirmed_at?: string | null;
  completion_legacy_stage?: "authority" | "arrangements" | null;
  completed_at?: string | null;
  workflow_status: string;
};

export function completionNoticeState(attempt: CompletionNoticeState) {
  const completed = Boolean(attempt.completed_at) || attempt.workflow_status === "completed";
  const confirmed = Boolean(attempt.completion_arrangements_confirmed_at) || attempt.completion_legacy_stage === "arrangements" || completed;
  return { confirmed, authorised: Boolean(attempt.completion_authority_given_at || attempt.completion_legacy_stage) || confirmed };
}
