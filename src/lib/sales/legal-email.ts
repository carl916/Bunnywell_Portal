import type { LegalSnapshot } from "./legal-workflow";
import { describeReservationFeeHolder, paymentScheduleSummary } from "./deal-structure";
import { isCalendarDate } from "./completion-notice";
import { emailCallout, emailDetails, emailParagraph, emailPortalButton, emailSection, emailShell, escapeHtml } from "@/lib/email/layout";

type Detail = readonly [string, string];
type Payment = { label: string; percentage: string; amount: string; due: string; notes: string };
const number = (value: unknown) => value == null || value === "" || !Number.isFinite(Number(value)) ? null : Number(value);
export const emailMoney = (value: unknown) => number(value) == null ? "Not recorded" : new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(Number(value));
const percent = (value: unknown) => number(value) == null ? "—" : `${new Intl.NumberFormat("en-GB", { maximumFractionDigits: 4 }).format(Number(value))}%`;
const clean = (value: unknown) => String(value ?? "").replace(/\bmanual_date\b/g, "agreed date").replace(/\bdelayed_deposit\b/g, "second deposit").replace(/\breservation_fee\b/g, "reservation fee").replace(/\bsales_agent\b/g, "sales agent").trim();

export function emailDate(value: string) {
  if (!isCalendarDate(value)) return "Not recorded";
  return new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "long", year: "numeric" }).format(new Date(`${value}T12:00:00Z`));
}

export function emailDateTime(value: string) {
  const date = new Date(value);
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "numeric", month: "long", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true, timeZoneName: "short" }).formatToParts(date).map(part => [part.type, part.value]));
  return `${parts.day} ${parts.month} ${parts.year} at ${Number(parts.hour)}:${parts.minute}${parts.dayPeriod.toLowerCase()} ${parts.timeZoneName}`;
}

function paymentDue(row: Record<string, unknown>) {
  if (typeof row.due_date === "string" && isCalendarDate(row.due_date)) return emailDate(row.due_date);
  const offset = number(row.due_offset_days) ?? 0;
  const event = row.due_event === "manual_date" && row.payment_stage === "delayed_deposit" ? "exchange" : row.due_event;
  if (["reservation", "exchange", "completion"].includes(String(event))) return offset ? `${Math.abs(offset)} days ${offset < 0 ? "before" : "after"} ${event}` : `On ${event}`;
  return offset ? `Agreed date ${offset < 0 ? "minus" : "plus"} ${Math.abs(offset)} days` : "On the agreed date";
}

export function legalEmailPayments(snapshot: LegalSnapshot): Payment[] {
  const t = snapshot.terms;
  let schedule = snapshot.schedule;
  if (!schedule.length) {
    const exchange = number(t.exchange_deposit_percent);
    const second = t.second_deposit_enabled ? number(t.second_deposit_percent) : 0;
    const balance = number(t.completion_balance_percent) ?? (exchange != null && second != null ? 100 - exchange - second : null);
    schedule = [
      ...(exchange != null ? [{ label: "Exchange deposit", percent_of_contract_price: exchange, due_event: "exchange", includes_reservation_fee: true }] : []),
      ...(t.second_deposit_enabled && second != null ? [{ label: "Second deposit", percent_of_contract_price: second, due_event: "manual_date", payment_stage: "delayed_deposit", due_offset_days: number(t.second_deposit_months_after_exchange) == null ? null : Number(t.second_deposit_months_after_exchange) * 31 }] : []),
      ...(balance != null ? [{ label: "Completion balance", percent_of_contract_price: balance, due_event: "completion" }] : []),
    ];
  }
  return schedule.map(row => {
    const percentage = number(row.percent_of_contract_price);
    const price = number(t.contract_price);
    const amount = number(row.expected_amount) ?? number(row.fixed_amount) ?? (price != null && percentage != null ? price * percentage / 100 : null);
    const label = clean(row.label || ({ exchange: "Exchange deposit", delayed_deposit: "Second deposit", completion: "Completion balance", reservation: "Reservation fee" }[String(row.payment_stage)] || "Payment"));
    const withoutPercent = percentage != null && label.startsWith(`${percentage}% `) ? label.slice(`${percentage}% `.length) : label;
    return { label: withoutPercent.charAt(0).toUpperCase() + withoutPercent.slice(1), percentage: percent(percentage), amount: emailMoney(amount), due: paymentDue(row), notes: [row.includes_reservation_fee ? "Includes reservation fee" : "", clean(row.notes)].filter(Boolean).join(". ") };
  });
}

function commercialDetails(snapshot: LegalSnapshot): Detail[] {
  const t = snapshot.terms;
  const contributions = [["Developer", t.developer_contribution], ["Sales agent", t.agent_contribution], ["Other concessions", t.other_concessions]] as const;
  const incentives = contributions.filter(([, value]) => number(value) != null && number(value) !== 0).map(([label, value]) => `${label}: ${emailMoney(value)}`).join("; ") || "None";
  const parking = [clean(t.parking_location_details), number(t.parking_value) ? `Value: ${emailMoney(t.parking_value)}` : "", number(t.parking_contribution_value) ? `Contribution: ${emailMoney(t.parking_contribution_value)}` : ""].filter(Boolean).join("; ") || "None";
  const terms = [clean(t.commercial_summary), ...(Array.isArray(t.additional_special_conditions) ? t.additional_special_conditions.map(clean) : [])].filter(Boolean);
  // Preserve bespoke payment terms, while omitting the auto-generated summary
  // that duplicates the authoritative payment rows.
  const summary = clean(t.deposit_summary);
  const generated = paymentScheduleSummary({ exchangeDepositPercent: number(t.exchange_deposit_percent), secondDepositEnabled: Boolean(t.second_deposit_enabled), secondDepositPercent: number(t.second_deposit_percent), secondDepositMonthsAfterExchange: number(t.second_deposit_months_after_exchange) });
  if (summary && summary !== generated) terms.push(`Additional payment terms: ${summary}`);
  return [["Incentives and contributions", incentives], ["Parking arrangements", parking], ["Special terms or agreed variations", terms.join("\n") || "None"], ["Completion arrangements", clean(snapshot.building.completion_information) || "Contractual completion date to be confirmed by the conveyancer"]];
}

function paymentTable(rows: Payment[]) {
  if (!rows.length) return emailParagraph("Payment schedule not recorded.");
  const headings = [["Payment / stage", "31%"], ["%", "10%"], ["Amount", "29%"], ["Due", "30%"]];
  const header = headings.map(([label, width]) => `<th scope="col" width="${width}" align="left" style="padding:10px 5px;background:#eef7f1;color:#0f3d2e;font-weight:700;">${label}</th>`).join("");
  const body = rows.map(row => `<tr>${[row.label, row.percentage, row.amount, row.due].map((value, index) => {
    // Let the table size its columns around complete amounts on narrow screens.
    const wrapping = index === 1 || index === 2 ? "white-space:nowrap;" : "word-wrap:break-word;overflow-wrap:anywhere;";
    return `<td valign="top" style="padding:12px 5px;border-bottom:1px solid #edf0ec;${wrapping}">${escapeHtml(value)}${index === 0 && row.notes ? `<br><span style="font-size:11px;color:#637067;">${escapeHtml(row.notes)}</span>` : ""}</td>`;
  }).join("")}</tr>`).join("");
  return `<table width="100%" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;font-size:13px;line-height:1.5;"><thead><tr>${header}</tr></thead><tbody>${body}</tbody></table>`;
}

export function renderLegalEmailContent(snapshot: LegalSnapshot, kind: "authority" | "notice_authority", date: string, portalUrl: string) {
  const exchange = kind === "authority";
  const title = exchange ? "Authority to exchange" : "Authority to serve notice";
  const subtitle = `${snapshot.building.name} · Plot ${snapshot.plot}`;
  const intro = exchange
    ? `For and on behalf of ${snapshot.building.seller_name}, we authorise ${snapshot.conveyancer!.name} to exchange contracts for the above property on the following basis:`
    : `For and on behalf of ${snapshot.building.seller_name}, we authorise ${snapshot.conveyancer!.name} to serve notice under the contract for the property below. Please record the notice issue date, completion due date and notice PDF through the Bunnywell Portal.`;
  const details: Detail[] = [["Seller/SPV", snapshot.building.seller_name!], ["Development", snapshot.building.name], ["Plot", snapshot.plot], ["Buyer name or names", snapshot.buyer], ["Contract price", emailMoney(snapshot.terms.contract_price)]];
  if (exchange) details.push(["Reservation fee", `${emailMoney(snapshot.terms.reservation_fee)} (held by ${describeReservationFeeHolder(String(snapshot.terms.reservation_fee_holder ?? "")) === "-" ? "holder not recorded" : describeReservationFeeHolder(String(snapshot.terms.reservation_fee_holder))})`]);
  const approval = `Approved and issued by ${snapshot.approver.name} through Bunnywell.`;
  const text = ["Bunnywell Portal", title, subtitle, "", intro, "", "View sale file in Bunnywell Portal", portalUrl, "", "Sale details", ...details.map(([key, value]) => `${key}: ${value}`)];
  let content = emailParagraph(intro) + emailPortalButton(portalUrl) + emailSection("Sale details", emailDetails(details));
  if (exchange) {
    const commercial = commercialDetails(snapshot), payments = legalEmailPayments(snapshot);
    content += emailSection("Commercial terms", emailDetails(commercial)) + emailSection("Payment schedule", paymentTable(payments));
    text.push("", "Commercial terms", ...commercial.map(([key, value]) => `${key}: ${value}`), "", "Payment schedule", ...payments.map(row => `${row.label} | ${row.percentage} | ${row.amount} | ${row.due}${row.notes ? `\n  ${row.notes}` : ""}`));
    if (!payments.length) text.push("Payment schedule not recorded.");
    const validity = `Authority valid until ${emailDateTime(date)}`;
    const explanation = "It will expire automatically if exchange has not taken place by that time. Any material amendment to the above terms will require fresh authority.";
    const closing = "Please confirm exchange through the Bunnywell Portal.";
    content += emailCallout(validity, explanation) + `<div style="padding-top:22px;">${emailParagraph(closing)}</div>`;
    text.push("", "Authority validity", validity, explanation, "", closing);
  }
  text.push("", approval);
  return { body: text.join("\n"), html: emailShell({ title, subtitle, content, approval }) };
}
