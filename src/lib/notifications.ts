export type NotificationVariant = "success" | "warning" | "error" | "info";

const ERROR_PATTERN = /\b(cannot|could not|error|failed|failure|invalid|rejected|unable|unauthori[sz]ed|not found|expired|validation)\b/i;
const WARNING_PATTERN = /\b(add|attention|awaiting|choose|confirm|enter|incomplete|missing|outstanding|required|select|warning)\b/i;
const SUCCESS_PATTERN = /\b(added|approved|closed|completed|created|marked|paid|reactivated|reconciled|recorded|reset|resolved|saved|sent|submitted|updated|uploaded|welcome)\b/i;
const DESTRUCTIVE_PATTERN = /\b(deleted|removed|voided)\b/i;

export function notificationVariantForMessage(message: string): NotificationVariant {
  const text = message.trim();
  if (!text) return "info";
  if (ERROR_PATTERN.test(text) || DESTRUCTIVE_PATTERN.test(text)) return "error";
  if (WARNING_PATTERN.test(text)) return "warning";
  if (SUCCESS_PATTERN.test(text)) return "success";
  return "info";
}
