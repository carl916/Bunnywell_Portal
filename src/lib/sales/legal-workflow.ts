import type { Organisation } from "@/lib/data/production";
import { absoluteSaleFileUrl, portalBaseUrl } from "@/lib/portal-url";
import { emailMoney as money, renderLegalEmailContent } from "./legal-email";

export function validSharedSystemEmail(value: string | null | undefined) {
  const local = value?.split("@")[0] ?? "";
  return !value || (value === value.trim() && value.length <= 254 && local.length <= 64 && !local.startsWith(".") && !local.endsWith(".") && !local.includes("..") && /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/.test(value));
}

export function salesContactOptions(organisations: readonly Organisation[], type: "conveyancer" | "sales_agent") {
  return organisations.filter((organisation) => organisation.type === type);
}

export type LegalOrganisation = { id: string; name: string; type: string; shared_system_email: string | null };
export type LegalSnapshot = {
  sale_id: string;
  unit_id: string;
  building: { id: string; name: string; seller_name: string | null; completion_information: string | null };
  plot: string;
  buyer: string;
  terms: Record<string, unknown>;
  schedule: Record<string, unknown>[];
  conveyancer: LegalOrganisation | null;
  sales_agent: LegalOrganisation | null;
  approver: { id: string; name: string };
};
export type LegalEmailKind = "authority" | "completion_instruction" | "notice_authority";
export type LegalEmail = {
  id: string; sale_attempt_id: string; kind: LegalEmailKind; version: number;
  snapshot: LegalSnapshot; subject: string; body: string; html_body?: string | null; sending_address: string;
  to_recipients: string[]; cc_recipients: string[]; issued_at: string;
  expires_at: string | null; proposed_completion_date: string | null;
  approved_by: string; revoked_at: string | null; replaced_by: string | null;
  revocation_reason?: string | null;
  exchanged_at: string | null; delivery_status: string; resend_message_id: string | null;
};
export class SalesRecipientError extends Error {
  constructor(message: string, public settingsUrl: string) { super(message); }
}
export function resolveSalesRecipients(snapshot: LegalSnapshot, kind: LegalEmailKind) {
  const buildingUrl = `/?screen=buildings&building=${snapshot.building.id}#sales-contacts`;
  if (!snapshot.conveyancer || snapshot.conveyancer.type !== "conveyancer") {
    throw new SalesRecipientError("Select a conveyancer organisation in the building’s Sales contacts before sending.", buildingUrl);
  }
  const conveyancer = snapshot.conveyancer;
  if (!conveyancer.shared_system_email || !validSharedSystemEmail(conveyancer.shared_system_email)) {
    throw new SalesRecipientError(`Add a valid shared system email to ${conveyancer.name} before sending.`, `/?screen=users#organisation-${conveyancer.id}`);
  }
  const agent = snapshot.sales_agent;
  const cc = (kind === "authority" || kind === "notice_authority") && agent?.type === "sales_agent" && agent.shared_system_email && validSharedSystemEmail(agent.shared_system_email)
    ? [agent.shared_system_email] : [];
  return { to: [conveyancer.shared_system_email], cc };
}

export const legalDateTime = (value: string) => new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London", dateStyle: "long", timeStyle: "long",
}).format(new Date(value));

export function authorityTerms(snapshot: LegalSnapshot) {
  const t = snapshot.terms;
  return [
    ["Seller/SPV", snapshot.building.seller_name || "Not configured"],
    ["Development and plot", `${snapshot.building.name} – ${snapshot.plot}`],
    ["Buyer name or names", snapshot.buyer],
    ["Contract price", money(t.contract_price)],
    ["Reservation fee", `${money(t.reservation_fee)} (held by ${String(t.reservation_fee_holder || "not recorded").replaceAll("_", " ")})`],
    ["Exchange deposit", `${money(Number(t.contract_price || 0) * Number(t.exchange_deposit_percent || 0) / 100)} (${t.exchange_deposit_percent ?? "Not recorded"}%)`],
    ["Payment structure", String(t.deposit_summary || `${t.exchange_deposit_percent ?? "Not recorded"}% on exchange${t.second_deposit_enabled ? `; ${t.second_deposit_percent}% ${t.second_deposit_months_after_exchange} months after exchange` : ""}; ${t.completion_balance_percent ?? "remaining balance"}${t.completion_balance_percent != null ? "%" : ""} on completion`)],
    ["Incentives or contributions", `Developer: ${money(t.developer_contribution)}; agent: ${money(t.agent_contribution)}; other concessions: ${money(t.other_concessions)}`],
    ["Parking", `${String(t.parking_location_details || "No location recorded")}; value ${money(t.parking_value)}; contribution ${money(t.parking_contribution_value)}`],
    ["Completion information", snapshot.building.completion_information || "Contractual completion date to be confirmed by the conveyancer"],
    ["Special terms or agreed variations", [t.commercial_summary, ...(Array.isArray(t.additional_special_conditions) ? t.additional_special_conditions : [])].filter(Boolean).join("; ") || "None recorded"],
    ...snapshot.schedule.map((row) => [`Payment: ${row.label}`, `${money(row.expected_amount ?? row.fixed_amount)}; ${row.percent_of_contract_price ?? "—"}%; due ${row.due_event ?? row.due_date ?? "as agreed"}${row.due_offset_days ? ` + ${row.due_offset_days} days` : ""}${row.notes ? `; ${row.notes}` : ""}`]),
  ];
}

export function renderLegalEmail(snapshot: LegalSnapshot, kind: LegalEmailKind, date: string, now = Date.now(), publicBaseUrl?: string) {
  const recipients = resolveSalesRecipients(snapshot, kind);
  if (!snapshot.building.seller_name?.trim()) throw new SalesRecipientError("Add the legal seller/SPV in building Sales contacts before sending.", `/?screen=buildings&building=${snapshot.building.id}#sales-contacts`);
  if (kind === "authority" && (!Number.isFinite(Date.parse(date)) || Date.parse(date) <= now)) throw new Error("Authority expiry must be an exact future date and time.");
  if (kind === "completion_instruction") throw new Error("Historic completion instructions cannot be issued. Use authority to serve notice.");
  const subject = `${kind === "authority" ? "Authority to Exchange" : "Authority to Serve Notice"} – ${snapshot.building.name} – ${snapshot.plot}`;
  const portalUrl = absoluteSaleFileUrl({ building_id: snapshot.building.id, unit_id: snapshot.unit_id, sale_attempt_id: snapshot.sale_id }, publicBaseUrl ?? portalBaseUrl());
  return { ...recipients, subject, ...renderLegalEmailContent(snapshot, kind, date, portalUrl) };
}

export function authorityStatus(email?: LegalEmail | null, now = Date.now()) {
  if (!email) return "Authority not requested";
  if (email.exchanged_at) return "Exchanged";
  if (email.revoked_at) return "Authority revoked";
  if (email.replaced_by) return "Authority replaced";
  if (email.expires_at && Date.parse(email.expires_at) <= now) return "Authority expired";
  if (!["sent", "delivered", "delivery_delayed", "opened", "clicked"].includes(email.delivery_status)) return `Email ${email.delivery_status}`;
  return "Authority issued";
}
