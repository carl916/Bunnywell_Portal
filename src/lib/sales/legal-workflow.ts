import type { Organisation } from "@/lib/data/production";
import { absoluteSaleFileUrl, portalBaseUrl } from "@/lib/portal-url";
import { renderLegalEmailContent } from "./legal-email";

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
  sent_at?: string | null;
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

export function renderLegalEmail(snapshot: LegalSnapshot, kind: LegalEmailKind, date: string, now = Date.now(), publicBaseUrl?: string) {
  const recipients = resolveSalesRecipients(snapshot, kind);
  if (!snapshot.building.seller_name?.trim()) throw new SalesRecipientError("Add the legal seller/SPV in building Sales contacts before sending.", `/?screen=buildings&building=${snapshot.building.id}#sales-contacts`);
  if (kind === "authority" && (!Number.isFinite(Date.parse(date)) || Date.parse(date) <= now)) throw new Error("Authority expiry must be an exact future date and time.");
  if (kind === "completion_instruction") throw new Error("Historic completion instructions cannot be issued. Use authority to serve notice.");
  const subject = `${kind === "authority" ? "Authority to Exchange" : "Authority to Serve Notice"} – ${snapshot.building.name} – ${snapshot.plot}`;
  const portalUrl = absoluteSaleFileUrl({ building_id: snapshot.building.id, unit_id: snapshot.unit_id, sale_attempt_id: snapshot.sale_id }, publicBaseUrl ?? portalBaseUrl());
  return { ...recipients, subject, ...renderLegalEmailContent(snapshot, kind, date, portalUrl) };
}

export function authorityStatus(email?: Pick<LegalEmail, "exchanged_at" | "revoked_at" | "replaced_by" | "expires_at" | "delivery_status"> | null, now = Date.now()) {
  if (!email) return "Authority not requested";
  if (email.exchanged_at) return "Exchanged";
  if (email.revoked_at) return "Authority revoked";
  if (email.replaced_by) return "Authority replaced";
  if (email.expires_at && Date.parse(email.expires_at) <= now) return "Authority expired";
  if (!["sent", "delivered", "delivery_delayed", "opened", "clicked"].includes(email.delivery_status)) return `Email ${email.delivery_status}`;
  return "Authority issued";
}
