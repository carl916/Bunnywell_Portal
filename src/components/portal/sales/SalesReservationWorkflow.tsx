"use client";

import { SalesTableScroll } from "./SalesTableScroll";
import { isMissingSaleActorNames, salesLoadErrorMessage } from "@/lib/sales/load-errors";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { CheckCircle2, FileText, UploadCloud, X } from "lucide-react";
import type { User } from "@supabase/supabase-js";
import type { AppRole, Building, BuildingFloor, Organisation, Unit } from "@/lib/data/production";
import { GbpInput } from "@/components/portal/sales/GbpInput";
import { calculateAgentInvoicePreview as invoicePreview, calculateDeveloperNet } from "@/lib/sales/commercial-model";
import { buildDepositStructure, describeReservationFeeHolder, paymentScheduleSummary } from "@/lib/sales/deal-structure";
import { formatGbp, formatGbpDeduction, parseGbpInput } from "@/lib/sales/currency";
import { canPerformSalesAction } from "@/lib/sales/permissions";
import { calculateMilestoneFee, deriveAgentFeeSummary, deriveInvoicePaymentPosition, isActiveAgentFeePayment, normalisePayerType, validateAgentFeeStructure, type AgentFeeMilestone } from "@/lib/sales/agent-fees";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { SalesForecastingModule } from "@/components/portal/sales/SalesForecastingModule";
import { AgentFeesPortfolio } from "@/components/portal/sales/AgentFeesPortfolio";
import { SaleFileWorkspaceTabs, type SaleFileWorkspace } from "@/components/portal/sales/SaleFileWorkspaceTabs";
import { SaleConversationLayout, SaleMentionsInbox, UnreadBadge, useSaleConversationLayout, useSaleUnread } from "./SaleConversation";
import { useActivePanel } from "@/hooks/useActivePanel";
import { historicalActorLabel, workflowActorLabel, type ActorProfile, type SaleActorName } from "@/lib/sales/actor-identity";
import { currentSalesTask, getCompletionDocumentState, getCompletionTasks, getExchangeTasks, getReservationTasks } from "@/lib/sales/stage-tasks";
import { SalesStageTasks } from "./SalesStageTasks";
import { parsePercentInput } from "@/lib/sales/percentages";
import { canReturnUnitToForSale } from "@/lib/sales/reservation-redaction";
import styles from "./SalesReservationWorkflow.module.css";
import {
  SALES_ROUTE_STATUSES,
  isSalesRouteUnit,
  saleStatusLabel,
} from "@/lib/units/commercial-allocation";

type Profile = {
  id: string;
  role: AppRole;
  email?: string | null;
  name?: string | null;
  full_name?: string | null;
  organisation_id?: string | null;
};

type SaleAttempt = {
  id: string;
  building_id: string;
  unit_id: string;
  attempt_number: number;
  is_active: boolean;
  workflow_status: string;
  buyer_name: string | null;
  buyer_person_name: string | null;
  buyer_company_name: string | null;
  buyer_email: string | null;
  buyer_phone: string | null;
  buyer_solicitor_name: string | null;
  reservation_date: string | null;
  reservation_submitted_at: string | null;
  reservation_terms_checked: boolean | null;
  reservation_submitted_by_user_id: string | null;
  reservation_submitted_by_name: string | null;
  reservation_submitted_by_email: string | null;
  reservation_approved_at: string | null;
  reservation_approved_by_user_id: string | null;
  reservation_approved_by_name: string | null;
  reservation_approved_by_email: string | null;
  reservation_rejected_at: string | null;
  reservation_rejected_by_user_id: string | null;
  reservation_rejected_by_name: string | null;
  reservation_rejected_by_email: string | null;
  reservation_rejection_reason: string | null;
  commercial_approved_at: string | null;
  commercial_approved_by_user_id: string | null;
  exchanged_at: string | null;
  completed_at: string | null;
  fallen_through_at: string | null;
  fall_through_reason: string | null;
  redacted_at: string | null;
  stage_entered_at: string | null;
  created_at: string;
};

type SaleTerms = {
  id: string;
  sale_attempt_id: string;
  is_current: boolean;
  status: string;
  list_price_at_offer: number | null;
  parking_value: number;
  developer_contribution: number;
  developer_contribution_value: number | null;
  developer_contribution_value_type: "amount" | "percent" | null;
  agent_contribution: number;
  agent_contribution_value: number | null;
  agent_contribution_value_type: "amount" | "percent" | null;
  parking_contribution_value: number;
  parking_location_details: string | null;
  additional_special_conditions: string[] | null;
  contract_price: number | null;
  reservation_fee: number | null;
  reservation_fee_holder: string | null;
  agent_fee_percent: number | null;
  exchange_agent_fee_percent: number | null;
  completion_agent_fee_percent: number | null;
  vat_rate: number;
  solicitor_fee: number | null;
  exchange_deposit_percent: number | null;
  second_deposit_enabled: boolean | null;
  second_deposit_percent: number | null;
  second_deposit_months_after_exchange: number | null;
  completion_balance_percent: number | null;
  deposit_summary: string | null;
  commercial_summary: string | null;
};

type BuildingSaleDefault = {
  building_id: string;
  build_cost: number | null;
  reservation_fee: number | null;
  reservation_fee_holder_default: string;
  exchange_deposit_percent: number | null;
  second_deposit_enabled: boolean | null;
  second_deposit_percent: number | null;
  second_deposit_months_after_exchange: number | null;
  default_agent_fee_percent: number | null;
  default_exchange_agent_fee_percent: number | null;
  default_completion_agent_fee_percent: number | null;
  default_vat_rate: number | null;
  default_sales_solicitor_fee: number | null;
};

type PaymentScheduleRow = {
  id: string;
  sale_attempt_id: string;
  sequence_no: number;
  payment_stage: string;
  label: string;
  due_event: string | null;
  due_offset_days: number | null;
  percent_of_contract_price: number | null;
  fixed_amount: number | null;
  expected_amount: number | null;
  includes_reservation_fee: boolean;
  status: string;
};

type SaleDocument = {
  id: string;
  sale_attempt_id: string;
  document_type: string;
  fee_milestone: "exchange" | "completion" | null;
  title: string;
  status: string;
  query_note: string | null;
  approved_by_user_id: string | null;
  approved_at: string | null;
  redacted_at: string | null;
  superseded_at: string | null;
  updated_at: string;
};

type SaleActorProfile = ActorProfile & { organisation_id?: string | null };

type SaleDocumentVersion = {
  id: string;
  document_id: string;
  version_number: number;
  is_current: boolean;
  file_name: string;
  file_size_bytes: number | null;
  uploaded_at: string;
  uploaded_by_user_id: string | null;
  redacted_at: string | null;
};

type SaleWorkflowEvent = {
  id: string;
  sale_attempt_id: string;
  event_type: string;
  from_status: string | null;
  to_status: string | null;
  summary: string;
  metadata: Record<string, unknown> | null;
  created_by_user_id: string | null;
  actor_name?: string | null;
  created_at: string;
};

type SaleInvoice = {
  id: string;
  sale_attempt_id: string;
  document_id: string | null;
  invoice_type: string;
  fee_milestone: "exchange" | "completion" | null;
  fee_percentage: number | null;
  invoice_reference: string | null;
  invoice_date: string | null;
  net_amount: number | null;
  vat_amount: number | null;
  gross_amount: number | null;
  expected_gross_amount: number | null;
  reservation_fee_deduction: number;
  agent_contribution_deduction: number;
  expected_payable_amount: number | null;
  status: string;
  approved_at: string | null;
  approved_by_user_id: string | null;
};

type SaleInvoicePayment = {
  id: string;
  invoice_id: string;
  sale_attempt_id: string;
  payment_source: string;
  payer_type: "solicitor" | "developer" | "other" | null;
  amount: number;
  paid_at: string | null;
  notes: string | null;
  recorded_by_user_id: string | null;
  recorded_by_name: string | null;
  recorded_by_email: string | null;
  recorded_by_organisation_name: string | null;
  created_at: string;
  voided_at: string | null;
  voided_by_user_id: string | null;
  void_reason: string | null;
};

type SalesStageFilter = (typeof SALES_ROUTE_STATUSES)[number] | "all";
type SaleWorkflowStage = "reservation" | "exchange" | "completion" | "handover";
type SalesView = "pipeline" | "agent_fees";
type UnitSaleSection = SaleFileWorkspace;

type ApprovalHistoryEvent = {
  id: string;
  label: string;
  occurredAt: string | null;
  actor: string;
};

const SALES_PAGE_SIZE = 12;
const SALES_STAGE_FILTERS: Array<{ value: SalesStageFilter; label: string }> = [
  { value: "for_sale", label: "For sale" },
  { value: "reserved", label: "Reserved" },
  { value: "exchanged", label: "Exchanged" },
  { value: "completed", label: "Completed" },
  { value: "handed_over", label: "Handed over" },
  { value: "all", label: "All sales" },
];

function SalesViewTabs({
  activeView,
  canViewAgentFees,
  onChange,
}: {
  activeView: SalesView;
  canViewAgentFees: boolean;
  onChange: (view: SalesView) => void;
}) {
  return (
    <div className={styles.headerControls}>
      <div className="mt-4 flex flex-wrap gap-2 border-t border-[#eef0eb] pt-4" role="tablist" aria-label="Sales views">
      <button className={activeView === "pipeline" ? "primary" : "secondary"} type="button" role="tab" aria-selected={activeView === "pipeline"} onClick={() => onChange("pipeline")}>Sales overview</button>
      {canViewAgentFees && <button className={activeView === "agent_fees" ? "primary" : "secondary"} type="button" role="tab" aria-selected={activeView === "agent_fees"} onClick={() => onChange("agent_fees")}>Agent Fees</button>}
      </div>
      <div className={styles.headerMentions}><SaleMentionsInbox /></div>
    </div>
  );
}

function money(value: number | string | null | undefined) {
  return formatGbp(value);
}

function moneyDeduction(value: number | string | null | undefined) {
  return formatGbpDeduction(value);
}

function formatDate(value?: string | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(value));
}

function formatDateTime(value?: string | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function paymentRecorderLabel(payment: SaleInvoicePayment, profiles: SaleActorProfile[]) {
  const profile = payment.recorded_by_user_id
    ? profiles.find((candidate) => candidate.id === payment.recorded_by_user_id)
    : undefined;
  const organisationName = payment.recorded_by_organisation_name;
  const actorName = payment.recorded_by_name
    ?? profile?.display_name
    ?? profile?.full_name
    ?? profile?.name
    ?? payment.recorded_by_email
    ?? profile?.email
    ?? null;

  if (actorName) return organisationName ? `${actorName} (${organisationName})` : actorName;
  return statusLabel(normalisePayerType(payment));
}

function scrollToPortalSection(id: string) {
  if (typeof window === "undefined") return;
  const behavior: ScrollBehavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
  window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
    document.getElementById(id)?.scrollIntoView({ behavior, block: "start" });
  }));
}

function daysSince(value?: string | null) {
  if (!value) return "-";
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return "-";
  const days = Math.max(0, Math.floor((Date.now() - then) / 86_400_000));
  if (days === 0) return "Today";
  if (days === 1) return "1 day";
  return `${days} days`;
}

function saleStatusDate(unit: Unit, attempt?: SaleAttempt) {
  if (unit.sale_status === "reserved") return attempt?.reservation_date ?? null;
  if (attempt?.stage_entered_at) return attempt.stage_entered_at;
  if (unit.sale_status === "completed") return attempt?.completed_at ?? unit.completion_date ?? attempt?.created_at ?? null;
  if (unit.sale_status === "exchanged") return attempt?.exchanged_at ?? attempt?.commercial_approved_at ?? attempt?.created_at ?? null;
  return attempt?.created_at ?? null;
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    draft: "Draft",
    uploaded: "Awaiting approval",
    awaiting_approval: "Awaiting developer approval",
    approved: "Approved",
    rejected: "Rejected",
    reservation_submitted: "Awaiting developer approval",
    reservation_query_raised: "Rejected",
    reservation_approved: "Approved",
    awaiting_commercial_approval: "Awaiting commercial approval",
    ready_for_exchange: "Ready for Exchange",
    completion_pending: "Completion pending",
    completed: "Completed",
    fallen_through: "Failed",
    query_raised: "Correction requested",
    superseded: "Superseded",
  };
  return labels[status] ?? status.replace(/_/g, " ");
}

const SALE_STATUS_TONES: Record<Unit["sale_status"], { badge: string; dot: string; row: string }> = {
  not_released: {
    badge: "border-[#d8ddd7] bg-[#f2f4f0] text-[#617169]",
    dot: "bg-[#829188]",
    row: "bg-white hover:bg-[#fafbf9]",
  },
  not_for_sale: {
    badge: "border-[#decda6] bg-[#fbf5e8] text-[#765a18]",
    dot: "bg-[#d6a23a]",
    row: "bg-white hover:bg-[#fafbf9]",
  },
  for_sale: {
    badge: "border-[#d8ddd7] bg-[#f2f4f0] text-[#52645b]",
    dot: "bg-[#829188]",
    row: "bg-white hover:bg-[#fafbf9]",
  },
  reserved: {
    badge: "border-[#ead8a7] bg-[#fff8e8] text-[#765a18]",
    dot: "bg-[#d6a23a]",
    row: "bg-[#fffdf8] hover:bg-[#fff9eb]",
  },
  exchanged: {
    badge: "border-[#bfd8df] bg-[#eef8fa] text-[#315f6a]",
    dot: "bg-[#5f9eae]",
    row: "bg-[#f9fcfd] hover:bg-[#eff8fa]",
  },
  completed: {
    badge: "border-[#bedacb] bg-[#edf8f1] text-[#286348]",
    dot: "bg-[#4f9b73]",
    row: "bg-[#f9fcfa] hover:bg-[#f0f8f3]",
  },
  handed_over: {
    badge: "border-[#d6cae5] bg-[#f6f1fb] text-[#66507b]",
    dot: "bg-[#9277ad]",
    row: "bg-[#fcfafd] hover:bg-[#f6f1fa]",
  },
};

function saleStatusTone(status: Unit["sale_status"]) {
  return SALE_STATUS_TONES[status];
}

function fileSizeLabel(bytes?: number | null) {
  if (!bytes) return "";
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function normaliseNumberInput(value: string) {
  if (value.trim() === "") return null;
  const numeric = Number(value.replace(/,/g, ""));
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : null;
}

function scheduleAmount(row: PaymentScheduleRow, contractPrice?: number | null) {
  if (row.expected_amount !== null && row.expected_amount !== undefined) return row.expected_amount;
  if (row.fixed_amount !== null && row.fixed_amount !== undefined) return row.fixed_amount;
  if (row.percent_of_contract_price !== null && row.percent_of_contract_price !== undefined && contractPrice) return contractPrice * (row.percent_of_contract_price / 100);
  return 0;
}

function sortUnitsByFloorOrder(units: Unit[], buildingFloors: BuildingFloor[], buildingId?: string) {
  const floorOrder = new Map(
    buildingFloors
      .filter((floor) => !buildingId || floor.building_id === buildingId)
      .map((floor, index) => [floor.name.trim().toLowerCase(), floor.sort_order ?? index]),
  );

  return [...units].sort((a, b) => {
    const aFloorOrder = floorOrder.get((a.floor ?? "").trim().toLowerCase()) ?? Number.MAX_SAFE_INTEGER;
    const bFloorOrder = floorOrder.get((b.floor ?? "").trim().toLowerCase()) ?? Number.MAX_SAFE_INTEGER;
    if (aFloorOrder !== bFloorOrder) return aFloorOrder - bFloorOrder;
    return a.unit_number.localeCompare(b.unit_number, undefined, { numeric: true });
  });
}

function formatPercentValue(value?: number | null, maximumFractionDigits = 2) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "-";
  return `${Number(value).toLocaleString("en-GB", { maximumFractionDigits })}%`;
}

function contributionAmount(value: number, valueType: "amount" | "percent", contractPrice: number) {
  if (valueType === "percent") return Math.round(contractPrice * (value / 100) * 100) / 100;
  return value;
}

function contributionLabel(value: number, valueType: "amount" | "percent", amount: number) {
  if (valueType === "percent") return `${formatPercentValue(value)} (${money(amount)})`;
  return money(amount);
}

function contributionDeductionLabel(value: number, valueType: "amount" | "percent", amount: number) {
  if (valueType === "percent") return `${formatPercentValue(value)} (${moneyDeduction(amount)})`;
  return moneyDeduction(amount);
}

function buyerDisplay(attempt?: SaleAttempt | null) {
  const company = attempt?.buyer_company_name?.trim() || "";
  const splitPerson = attempt?.buyer_person_name?.trim() || "";
  const legacyPerson = company ? "" : attempt?.buyer_name?.trim() || "";
  const person = splitPerson || legacyPerson;
  if (person && company && person.toLowerCase() !== company.toLowerCase()) return `${person}\nPurchasing through ${company}`;
  return company || person || "-";
}

function hasRequiredBuyerInfo(attempt?: SaleAttempt | null) {
  return Boolean(
    attempt
    && buyerDisplay(attempt) !== "-"
    && attempt.buyer_email?.trim()
    && attempt.buyer_phone?.trim()
    && attempt.buyer_solicitor_name?.trim(),
  );
}

function FieldValue({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div className="min-w-0 border-b border-[#eef0eb] py-3">
      <span className="block text-xs font-bold uppercase tracking-[0.08em] text-[#617169]">{label}</span>
      <strong className="numeric-value mt-1 block whitespace-pre-line text-sm text-[#0F3D2E] [overflow-wrap:anywhere]">{value || "-"}</strong>
    </div>
  );
}

function KeyValueList({ items }: { items: Array<{ label: string; value: ReactNode }> }) {
  return (
    <dl className="divide-y divide-[#eef0eb] text-sm text-[#34413a]">
      {items.map((item) => (
        <div key={item.label} className="grid gap-1 py-2.5 first:pt-0 last:pb-0 sm:grid-cols-[minmax(8rem,0.8fr)_minmax(0,1.2fr)] sm:gap-4">
          <dt className="min-w-0 text-[#617169]">{item.label}</dt>
          <dd className="numeric-value min-w-0 whitespace-pre-line font-bold text-[#0F3D2E] [overflow-wrap:anywhere] sm:text-right">{item.value || "-"}</dd>
        </div>
      ))}
    </dl>
  );
}

function SaleMetadataStrip({ items }: { items: Array<{ label: string; value: ReactNode }> }) {
  return (
    <dl className="mt-3 flex flex-wrap items-start gap-x-5 gap-y-2.5 border-t border-[#eef0eb] pt-3">
      {items.map((item, index) => (
        <div key={item.label} className={`min-w-0 sm:pr-5 ${index > 0 ? "sm:border-l sm:border-[#e2ded3] sm:pl-5" : ""}`}>
          <dd className="numeric-value whitespace-pre-line text-[15px] font-semibold leading-snug text-[#0F3D2E] sm:text-base">{item.value || "-"}</dd>
          <dt className="mt-0.5 text-[11px] font-semibold uppercase tracking-[0.07em] text-[#728078]">{item.label}</dt>
        </div>
      ))}
    </dl>
  );
}

function ApprovalEventHistory({ events }: { events: ApprovalHistoryEvent[] }) {
  return (
    <ol className="mt-3 divide-y divide-[#eef0eb] text-sm" aria-label="Reservation approval history">
      {events.map((event) => (
        <li key={event.id} className={`grid min-w-0 gap-y-1 py-3 first:pt-0 last:pb-0 ${styles.approvalEventRow}`}>
          <strong className={`min-w-0 break-words font-semibold text-[#34413a] ${styles.approvalEventName}`}>{event.label}</strong>
          <time className="numeric-value whitespace-nowrap text-[#617169]" dateTime={event.occurredAt ?? undefined}>{formatDateTime(event.occurredAt)}</time>
          <span className="min-w-0 break-words text-[#617169]"><span className={`mr-1 ${styles.approvalEventSeparator}`} aria-hidden="true">·</span>{event.actor}</span>
        </li>
      ))}
    </ol>
  );
}

function CompletedActionSummary({
  title,
  description,
  items,
}: {
  title: string;
  description: string;
  items: Array<{ label: string; value: ReactNode }>;
}) {
  return (
    <div className="h-full rounded-bw-card border border-[#bedacb] bg-[#f7fbf8] p-4">
      <div className="flex items-start gap-3">
        <span className="rounded-full bg-[#e1f1e7] p-2 text-[#286348]"><CheckCircle2 size={18} aria-hidden /></span>
        <div>
          <h5 className="font-bold text-[#0F3D2E]">{title}</h5>
          <p className="mt-1 text-sm text-[#617169]">{description}</p>
        </div>
      </div>
      <div className="mt-4 border-t border-[#dbe9df] pt-3">
        <KeyValueList items={items} />
      </div>
    </div>
  );
}

function StageWorkspace({
  id,
  title,
  description,
  status,
  statusTone,
  taskLabel = "Current task",
  currentTask,
  taskNavigation,
  children,
}: {
  id: string;
  title: string;
  description: string;
  status: string;
  statusTone: "done" | "current" | "locked" | "attention";
  taskLabel?: string;
  currentTask: string;
  taskNavigation?: ReactNode;
  children: ReactNode;
}) {
  const statusClasses = {
    done: "border-[#bedacb] bg-[#eaf6ee] text-[#286348]",
    current: "border-[#ead8a7] bg-[#fff1cc] text-[#765a18]",
    locked: "border-[#d9ded6] bg-[#ebece9] text-[#727d77]",
    attention: "border-[#e5c4be] bg-[#fbeeea] text-[#8d382d]",
  }[statusTone];

  return (
    <section id={id} className="mt-6 scroll-mt-6 rounded-bw-panel bg-[#f3f5f1] px-4 py-6 sm:px-6 sm:py-7">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[#d9ded6] pb-5">
        <div className="max-w-3xl">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-[#617169]">Selected sales stage</p>
          <h3 className="mt-1 text-2xl font-bold uppercase tracking-[0.04em] text-[#0F3D2E] sm:text-3xl">{title}</h3>
          <p className="mt-2 text-sm text-[#617169] sm:text-base">{description}</p>
        </div>
        <span className={`rounded-full border px-3 py-1 text-xs font-bold uppercase ${statusClasses}`}>{status}</span>
      </div>

      {taskNavigation}

      <div className="mt-7">
        <p className="text-xs font-bold uppercase tracking-[0.12em] text-[#617169]">{taskLabel}</p>
        <h4 className="mt-1 text-xl font-bold text-[#0F3D2E]">{currentTask}</h4>
      </div>

      <div className="mt-5">{children}</div>
    </section>
  );
}

function PdfUploadBox({
  id,
  label,
  file,
  currentVersion,
  disabled,
  onOpen,
  onFile,
  onClear,
  onRemoveCurrent,
}: {
  id: string;
  label: string;
  file: File | null;
  currentVersion?: SaleDocumentVersion | null;
  disabled?: boolean;
  onOpen?: () => void;
  onFile: (file: File | null) => void;
  onClear: () => void;
  onRemoveCurrent?: () => void;
}) {
  const selectedName = file?.name ?? null;

  if (currentVersion && !file) {
    return (
      <div className="min-w-0 py-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 max-w-full items-start gap-3">
            <span className="mt-1 shrink-0 rounded-full bg-[#EEF6F1] p-2 text-[#0F3D2E]"><FileText size={18} aria-hidden /></span>
            <div className="min-w-0">
              <p className="font-bold text-[#0F3D2E] [overflow-wrap:anywhere]">{currentVersion.file_name}</p>
              <p className="text-sm text-[#617169]">
                Uploaded {formatDate(currentVersion.uploaded_at)} {fileSizeLabel(currentVersion.file_size_bytes)}
              </p>
            </div>
          </div>
          <button className="secondary min-h-9 px-3 py-1.5 text-sm" type="button" onClick={onOpen} disabled={!onOpen}>
            View/download
          </button>
        </div>
        {!disabled && (
          onRemoveCurrent ? (
            <button className="secondary mt-3 min-h-9 w-fit px-3 py-1.5 text-sm" type="button" onClick={onRemoveCurrent}>
              <X size={14} aria-hidden /> Remove PDF
            </button>
          ) : (
            <label className="secondary upload-target mt-3 inline-flex w-fit cursor-pointer items-center gap-2">
              Replace PDF
              <input className="sr-only" type="file" accept="application/pdf" onChange={(event) => onFile(event.target.files?.[0] ?? null)} />
            </label>
          )
        )}
      </div>
    );
  }

  return (
    <label
      className={`upload-target block rounded-bw-card border border-dashed p-5 text-center transition ${disabled ? "cursor-not-allowed border-[#d9ded6] bg-[#f4f6f3] opacity-70" : "cursor-pointer border-[#cdbd9d] bg-white hover:border-[#0F3D2E]"}`}
      htmlFor={id}
      onDragOver={(event) => {
        if (disabled) return;
        event.preventDefault();
      }}
      onDrop={(event) => {
        if (disabled) return;
        event.preventDefault();
        onFile(event.dataTransfer.files?.[0] ?? null);
      }}
    >
      <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-[#EEF6F1] text-[#0F3D2E]">
        <UploadCloud size={20} aria-hidden />
      </span>
      <span className="mt-3 block font-bold text-[#0F3D2E]">{label}</span>
      <span className="mt-1 block text-sm text-[#617169]">Choose a file or drag and drop. PDF only, maximum 10 MB.</span>
      {selectedName && (
        <span className="mt-3 inline-flex max-w-full items-center gap-2 rounded-bw-inset border border-[#d9ded6] bg-[#F7F5EF] px-3 py-1 text-sm font-semibold text-[#0F3D2E]">
          <span className="min-w-0 [overflow-wrap:anywhere]">{selectedName}</span>
          <button
            type="button"
            className="rounded-full p-0.5 text-[#617169] hover:bg-white"
            onClick={(event) => {
              event.preventDefault();
              onClear();
            }}
            aria-label="Remove selected PDF"
          >
            <X size={14} aria-hidden />
          </button>
        </span>
      )}
      <input
        id={id}
        className="sr-only"
        type="file"
        accept="application/pdf"
        disabled={disabled}
        onChange={(event) => onFile(event.target.files?.[0] ?? null)}
      />
    </label>
  );
}

function DocumentVersionHistory({
  versions,
  onOpen,
}: {
  versions: SaleDocumentVersion[];
  onOpen: (version: SaleDocumentVersion) => void;
}) {
  if (versions.length === 0) return null;

  return (
    <div className="mt-3 min-w-0 border-t border-[#eef0eb] pt-3">
      <h6 className="text-xs font-bold uppercase tracking-[0.08em] text-[#617169]">Document history</h6>
      <div className="mt-2 grid gap-2">
        {versions.map((version) => (
          <div key={version.id} className="flex flex-wrap items-center justify-between gap-2 text-sm text-[#34413a]">
            <span className="min-w-0 [overflow-wrap:anywhere]">
              Version {version.version_number}: {version.file_name} {fileSizeLabel(version.file_size_bytes)}
              {version.is_current ? " current" : ""}
            </span>
            <button className="secondary min-h-9 px-3" type="button" onClick={() => onOpen(version)}>Open</button>
          </div>
        ))}
      </div>
    </div>
  );
}

function AgentInvoiceSubmissionForm({
  milestone,
  feePercent,
  expectedNetAmount,
  expectedVatAmount,
  expectedGrossAmount,
  isReplacement,
  reference,
  invoiceDate,
  grossAmount,
  file,
  canSubmit,
  isSaving,
  todayDate,
  onReference,
  onInvoiceDate,
  onGrossAmount,
  onFile,
  onSubmit,
}: {
  milestone: AgentFeeMilestone;
  feePercent: number;
  expectedNetAmount: number;
  expectedVatAmount: number;
  expectedGrossAmount: number;
  isReplacement: boolean;
  reference: string;
  invoiceDate: string;
  grossAmount: string;
  file: File | null;
  canSubmit: boolean;
  isSaving: boolean;
  todayDate: string;
  onReference: (value: string) => void;
  onInvoiceDate: (value: string) => void;
  onGrossAmount: (value: string) => void;
  onFile: (file: File | null) => void;
  onSubmit: () => void;
}) {
  const label = milestone === "completion" ? "Completion" : "Exchange";
  return (
    <div className="mt-4 rounded-md border border-[#e2ded3] bg-white p-4">
      <h5 className="font-bold text-[#0F3D2E]">{isReplacement ? `Replace ${label} invoice` : `Submit ${label} invoice`}</h5>
      <div className="mt-3 grid gap-x-4 text-sm text-[#34413a] sm:grid-cols-4">
        <FieldValue label={`${label} fee`} value={formatPercentValue(feePercent)} />
        <FieldValue label="Expected net fee" value={money(expectedNetAmount)} />
        <FieldValue label="Expected VAT" value={money(expectedVatAmount)} />
        <FieldValue label="Expected invoice total" value={money(expectedGrossAmount)} />
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <label className="field-label">Invoice reference<input className="field" value={reference} onChange={(event) => onReference(event.target.value)} disabled={!canSubmit || isSaving} /></label>
        <label className="field-label">Invoice date<input className="field" type="date" max={todayDate} value={invoiceDate} onChange={(event) => onInvoiceDate(event.target.value)} disabled={!canSubmit || isSaving} /></label>
        <label className="field-label">Invoice total<GbpInput value={grossAmount} onChange={onGrossAmount} disabled={!canSubmit || isSaving} aria-label={`${label} invoice total`} /></label>
        <div className="md:col-span-3">
          <PdfUploadBox id={`${milestone}-agent-invoice-upload`} label={`Upload ${isReplacement ? "corrected " : ""}${label} invoice PDF`} file={file} disabled={!canSubmit || isSaving} onFile={onFile} onClear={() => onFile(null)} />
        </div>
      </div>
      <div className="mt-4 flex justify-end">
        {canSubmit
          ? <button className="primary" type="button" onClick={onSubmit} disabled={isSaving || !file || !reference.trim() || !invoiceDate || (parseGbpInput(grossAmount) ?? 0) <= 0}>{isSaving ? "Submitting…" : "Submit invoice"}</button>
          : <p className="text-sm text-[#617169]">Waiting for the sales agent to submit the invoice.</p>}
      </div>
    </div>
  );
}

function AgentInvoicePaymentSection({
  position,
  payments,
  profiles,
  canRecord,
  canVoid,
  isSaving,
  amount,
  paymentDate,
  todayDate,
  onAmount,
  onPaymentDate,
  onRecord,
  onRequestVoid,
}: {
  position: ReturnType<typeof deriveInvoicePaymentPosition>;
  payments: SaleInvoicePayment[];
  profiles: SaleActorProfile[];
  canRecord: boolean;
  canVoid: boolean;
  isSaving: boolean;
  amount: string;
  paymentDate: string;
  todayDate: string;
  onAmount: (value: string) => void;
  onPaymentDate: (value: string) => void;
  onRecord: () => Promise<boolean>;
  onRequestVoid: (payment: SaleInvoicePayment) => void;
}) {
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const cashPayments = payments.filter((payment) => payment.payment_source !== "reservation_fee");
  const sortedPayments = [...cashPayments].sort((a, b) => `${b.paid_at ?? ""}${b.created_at}`.localeCompare(`${a.paid_at ?? ""}${a.created_at}`));
  const activeCashPayments = cashPayments.filter(isActiveAgentFeePayment);
  const voidedPayments = cashPayments.filter((payment) => !isActiveAgentFeePayment(payment));
  const receivedAmount = activeCashPayments.reduce((total, payment) => total + Number(payment.amount || 0), 0);

  async function submitPayment() {
    if (await onRecord()) setShowPaymentForm(false);
  }

  return (
    <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="rounded-md border border-[#e2ded3] bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h5 className="font-bold text-[#0F3D2E]">Payment position</h5>
            <p className="numeric-value mt-1 text-xs text-[#617169]">
              {position.reservationFeeHeld > 0
                ? `Cash amount due already reflects the ${money(position.reservationFeeHeld)} reservation fee held.`
                : "Cash amount due reflects all invoice credits."}
            </p>
          </div>
          <span className="rounded-full border border-[#d9ded6] bg-[#F7F5EF] px-2.5 py-1 text-xs font-bold text-[#617169]">{position.paymentStatus}</span>
        </div>
        <div className="mt-4 grid gap-2 text-sm text-[#34413a]">
          <div className="flex justify-between gap-4 border-b border-[#eef0eb] pb-2"><span>Cash amount due</span><strong className="numeric-value">{money(position.cashAmountPayable)}</strong></div>
          <div className="flex justify-between gap-4 border-b border-[#eef0eb] pb-2"><span>Payments received</span><strong className="numeric-value">{money(position.cashReceived)}</strong></div>
          <div className="flex items-baseline justify-between gap-4 pt-1 font-bold text-[#0F3D2E]"><span>Outstanding</span><strong className="numeric-value text-lg">{money(position.outstandingBalance)}</strong></div>
        </div>
      </div>

      <section className="rounded-md border border-[#e2ded3] bg-white p-4" aria-labelledby="agent-fee-payments-heading">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h5 id="agent-fee-payments-heading" className="font-bold text-[#0F3D2E]">Payments</h5>
            <p className="mt-1 text-xs text-[#617169]">
              {activeCashPayments.length} {activeCashPayments.length === 1 ? "payment" : "payments"} · {money(receivedAmount)} received
              {voidedPayments.length > 0 && <span className="text-[#7a271a]"> · {voidedPayments.length} voided</span>}
            </p>
          </div>
          {canRecord && position.paymentStatus !== "Paid" && !showPaymentForm && (
            <button className="secondary min-h-9 px-3 text-sm" type="button" onClick={() => setShowPaymentForm(true)} disabled={isSaving}>Record payment</button>
          )}
        </div>

        {canRecord && position.paymentStatus !== "Paid" && showPaymentForm && (
          <div className={`mt-4 border-t border-[#d9ded6] pt-4 ${styles.paymentEntry}`}>
            <div className={styles.paymentEntryGrid}>
              <label className="field-label">Amount<GbpInput value={amount} onChange={onAmount} disabled={isSaving} aria-label="Agent fee payment amount" /></label>
              <label className="field-label">Payment date<input className="field" type="date" max={todayDate} value={paymentDate} onChange={(event) => onPaymentDate(event.target.value)} disabled={isSaving} /></label>
              <div className={styles.paymentEntryActions}>
                <button className="secondary min-h-10 px-3" type="button" onClick={() => setShowPaymentForm(false)} disabled={isSaving}>Cancel</button>
                <button className="primary min-h-10 px-3" type="button" onClick={() => void submitPayment()} disabled={isSaving || (parseGbpInput(amount) ?? 0) <= 0 || !paymentDate || (parseGbpInput(amount) ?? 0) > position.outstandingBalance}>{isSaving ? "Recording…" : "Save payment"}</button>
              </div>
            </div>
          </div>
        )}

        {sortedPayments.length > 0 ? (
          <div className="mt-4 divide-y divide-[#eef0eb] border-t border-[#eef0eb]">
            {sortedPayments.map((payment) => (
              <div key={payment.id} className={`py-2.5 text-sm ${payment.voided_at ? "text-[#617169]" : "text-[#34413a]"}`}>
                <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
                  <span className="min-w-0">{formatDate(payment.paid_at)} · {paymentRecorderLabel(payment, profiles)}</span>
                  <span className="flex flex-wrap items-center gap-2">
                    {payment.voided_at && <span className="text-xs font-bold uppercase tracking-[0.06em] text-[#7a271a]">Voided</span>}
                    <strong className={`numeric-value ${payment.voided_at ? "line-through" : ""}`}>{money(payment.amount)}</strong>
                  </span>
                </div>
                {payment.notes && <p className="mt-1 text-xs text-[#617169]">{payment.notes}</p>}
                {payment.voided_at && (
                  <div className="mt-2 border-t border-[#d9ded6] pt-2 text-xs text-[#617169]">
                    <p><strong>Reason:</strong> {payment.void_reason ?? "No reason recorded"}</p>
                    <p className="mt-1">Voided {formatDateTime(payment.voided_at)}</p>
                  </div>
                )}
                {canVoid && !payment.voided_at && payment.payment_source !== "reservation_fee" && (
                  <div className="mt-1 flex justify-end">
                    <button className="min-h-8 px-1 text-xs font-semibold text-[#9f3027] underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#9f3027]" type="button" onClick={() => onRequestVoid(payment)} disabled={isSaving}>Void payment</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : <p className="mt-3 text-sm text-[#617169]">No cash payments recorded yet.</p>}

      </section>
    </div>
  );
}

function AdditionalConditionsEditor({
  conditions,
  onChange,
  disabled = false,
}: {
  conditions: string[];
  onChange: (conditions: string[]) => void;
  disabled?: boolean;
}) {
  const [draftCondition, setDraftCondition] = useState("");
  const cleanConditions = conditions.map((condition) => condition.trim()).filter(Boolean);

  function addCondition() {
    const nextCondition = draftCondition.trim();
    if (!nextCondition) return;
    onChange([...cleanConditions, nextCondition]);
    setDraftCondition("");
  }

  function removeCondition(index: number) {
    onChange(cleanConditions.filter((_, itemIndex) => itemIndex !== index));
  }

  return (
    <div className="grid gap-2">
      <span className="field-label">Additional conditions</span>
      {cleanConditions.length > 0 && (
        <div className="grid gap-2">
          {cleanConditions.map((condition, index) => (
            <div key={`${condition}-${index}`} className="flex flex-wrap items-center justify-between gap-2 border-b border-[#e5e9e4] py-2 text-sm text-[#34413a] [overflow-wrap:anywhere]">
              <span className="min-w-0 flex-1 break-words font-semibold">{condition}</span>
              <button
                className="inline-flex min-h-8 items-center gap-1 rounded-md px-2 text-xs font-bold text-[#b42318] hover:bg-[#fff4f2] disabled:cursor-not-allowed disabled:opacity-50"
                type="button"
                onClick={() => removeCondition(index)}
                disabled={disabled}
                aria-label={`Remove condition ${condition}`}
              >
                <X size={15} aria-hidden /> Remove
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
        <input
          className="field"
          value={draftCondition}
          onChange={(event) => setDraftCondition(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              addCondition();
            }
          }}
          placeholder="Type a condition"
          disabled={disabled}
        />
        <button className="secondary min-h-10 px-4" type="button" onClick={addCondition} disabled={disabled || !draftCondition.trim()}>
          Add
        </button>
      </div>
    </div>
  );
}

export function SalesReservationWorkflow({
  user,
  profile,
  profiles: portalProfiles,
  buildings,
  buildingFloors,
  units,
  buildingContextId,
  onNotice,
  reloadPortalData,
}: {
  user: User;
  profile: Profile | null;
  profiles: Profile[];
  organisations: Organisation[];
  buildings: Building[];
  buildingFloors: BuildingFloor[];
  units: Unit[];
  buildingContextId: string;
  onNotice: (notice: string) => void;
  reloadPortalData: () => Promise<void>;
}) {
  const commercialModelControlRef = useRef<HTMLDivElement | null>(null);
  const manuallySelectedWorkflowStageRef = useRef<SaleWorkflowStage | null>(null);
  const pendingAgentFeesScrollRef = useRef<AgentFeeMilestone | null>(null);
  const pendingWorkflowStageScrollRef = useRef<SaleWorkflowStage | null>(null);
  const completionReviewSubmissionInFlightRef = useRef(false);
  const completionRecordSubmissionInFlightRef = useRef(false);
  const buildingId = buildingContextId;
  const buildingUnits = useMemo(
    () => sortUnitsByFloorOrder(
      units.filter((unit) => (!buildingId || unit.building_id === buildingId) && isSalesRouteUnit(unit)),
      buildingFloors,
      buildingId,
    ),
    [buildingFloors, buildingId, units],
  );
  const [unitId, setUnitId] = useState(buildingUnits[0]?.id ?? "");
  const [saleActorNames, setSaleActorNames] = useState<SaleActorName[]>([]);
  const profiles: SaleActorProfile[] = [
    ...portalProfiles.map((profile) => ({ ...profile, display_name: saleActorNames.find((actor) => actor.id === profile.id)?.display_name })),
    ...saleActorNames.filter((actor) => !portalProfiles.some((person) => person.id === actor.id)),
  ];
  const [attempts, setAttempts] = useState<SaleAttempt[]>([]);
  const unreadComments = useSaleUnread(attempts.map((attempt) => attempt.id));
  const { containerRef: conversationContainerRef, docked: conversationDocked, open: conversationOpen, setIntent: setConversationIntent } = useSaleConversationLayout();
  const [conversationTarget, setConversationTarget] = useState<{ unit: string; sale?: string; comment?: string } | null>(null);
  const [terms, setTerms] = useState<SaleTerms[]>([]);
  const [buildingSaleDefaults, setBuildingSaleDefaults] = useState<BuildingSaleDefault[]>([]);
  const [paymentSchedule, setPaymentSchedule] = useState<PaymentScheduleRow[]>([]);
  const [documents, setDocuments] = useState<SaleDocument[]>([]);
  const [versions, setVersions] = useState<SaleDocumentVersion[]>([]);
  const [workflowEvents, setWorkflowEvents] = useState<SaleWorkflowEvent[]>([]);
  const [invoices, setInvoices] = useState<SaleInvoice[]>([]);
  const [invoicePayments, setInvoicePayments] = useState<SaleInvoicePayment[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [buyerPersonName, setBuyerPersonName] = useState("");
  const [buyerCompanyName, setBuyerCompanyName] = useState("");
  const [buyerEmail, setBuyerEmail] = useState("");
  const [buyerPhone, setBuyerPhone] = useState("");
  const [buyerSolicitorName, setBuyerSolicitorName] = useState("");
  const [reservationDate, setReservationDate] = useState("");
  const [reservationTermsChecked, setReservationTermsChecked] = useState(false);
  const [contractPrice, setContractPrice] = useState("");
  const [reservationFee, setReservationFee] = useState("");
  const [reservationFeeHolder, setReservationFeeHolder] = useState("sales_agent");
  const [reservationFormFile, setReservationFormFile] = useState<File | null>(null);
  const [reservationDocumentRemoved, setReservationDocumentRemoved] = useState(false);
  const [reservationDocumentHistoryUnlocked, setReservationDocumentHistoryUnlocked] = useState(false);
  const [parkingValue, setParkingValue] = useState("");
  const [developerContribution, setDeveloperContribution] = useState("");
  const [developerContributionValueType, setDeveloperContributionValueType] = useState<"amount" | "percent">("amount");
  const [agentContribution, setAgentContribution] = useState("");
  const [agentContributionValueType, setAgentContributionValueType] = useState<"amount" | "percent">("amount");
  const [parkingLocationDetails, setParkingLocationDetails] = useState("");
  const [additionalSpecialConditions, setAdditionalSpecialConditions] = useState<string[]>([""]);
  const [agentFeePercent, setAgentFeePercent] = useState("");
  const [exchangeAgentFeePercent, setExchangeAgentFeePercent] = useState("");
  const [completionAgentFeePercent, setCompletionAgentFeePercent] = useState("");
  const [solicitorFee, setSolicitorFee] = useState("");
  const [exchangeDepositPercent, setExchangeDepositPercent] = useState("10");
  const [secondDepositEnabled, setSecondDepositEnabled] = useState(false);
  const [secondDepositPercent, setSecondDepositPercent] = useState("");
  const [secondDepositMonthsAfterExchange, setSecondDepositMonthsAfterExchange] = useState("");
  const [depositSummary, setDepositSummary] = useState("");
  const [commercialSummary, setCommercialSummary] = useState("");
  const [invoiceReference, setInvoiceReference] = useState("");
  const [invoiceDate, setInvoiceDate] = useState("");
  const [invoiceNetAmount, setInvoiceNetAmount] = useState("");
  const [invoiceVatAmount, setInvoiceVatAmount] = useState("");
  const [invoiceGrossAmount, setInvoiceGrossAmount] = useState("");
  const [agentInvoiceFile, setAgentInvoiceFile] = useState<File | null>(null);
  const [completionInvoiceReference, setCompletionInvoiceReference] = useState("");
  const [completionInvoiceDate, setCompletionInvoiceDate] = useState("");
  const [completionInvoiceGrossAmount, setCompletionInvoiceGrossAmount] = useState("");
  const [completionAgentInvoiceFile, setCompletionAgentInvoiceFile] = useState<File | null>(null);
  const [exchangeDate, setExchangeDate] = useState("");
  const [exchangeDepositConfirmed, setExchangeDepositConfirmed] = useState(false);
  const [solicitorPaymentAmount, setSolicitorPaymentAmount] = useState("");
  const [solicitorPaymentDate, setSolicitorPaymentDate] = useState("");
  const paymentSubmissionInFlightRef = useRef(false);
  const paymentClientReferenceRef = useRef<string | null>(null);
  const [completionPaymentAmount, setCompletionPaymentAmount] = useState("");
  const [completionPaymentDate, setCompletionPaymentDate] = useState("");
  const completionPaymentSubmissionInFlightRef = useRef(false);
  const completionPaymentClientReferenceRef = useRef<string | null>(null);
  const [paymentToVoid, setPaymentToVoid] = useState<SaleInvoicePayment | null>(null);
  const [paymentVoidReason, setPaymentVoidReason] = useState("");
  const voidPaymentSubmissionInFlightRef = useRef(false);
  const [completionStatementFile, setCompletionStatementFile] = useState<File | null>(null);
  const [statementOfAccountFile, setStatementOfAccountFile] = useState<File | null>(null);
  const [completionQueryNote, setCompletionQueryNote] = useState("");
  const [completionDate, setCompletionDate] = useState("");
  const [rejectionReason, setRejectionReason] = useState("");
  const [returnToForSaleReason, setReturnToForSaleReason] = useState("");
  const [invoiceRejectionReason, setInvoiceRejectionReason] = useState("");
  const [completionInvoiceRejectionReason, setCompletionInvoiceRejectionReason] = useState("");
  const [selectedSaleUnitId, setSelectedSaleUnitId] = useState("");
  const [salesStageFilter, setSalesStageFilter] = useState<SalesStageFilter>("all");
  const [salesSearch, setSalesSearch] = useState("");
  const [salesPage, setSalesPage] = useState(1);
  const [activeWorkflowStage, setActiveWorkflowStage] = useState<SaleWorkflowStage>("reservation");
  const [activeSalesView, setActiveSalesView] = useState<SalesView>("pipeline");
  const [activeUnitSection, setActiveUnitSection] = useState<UnitSaleSection>("progression");
  const [showCommercialModel, setShowCommercialModel] = useState(false);
  const [showAdvancedDealSetup, setShowAdvancedDealSetup] = useState(false);
  const [commercialSetupChanged, setCommercialSetupChanged] = useState(false);
  const [showForecasting, setShowForecasting] = useState(false);
  const [showRejectReservationConfirm, setShowRejectReservationConfirm] = useState(false);
  const [showReturnToForSaleConfirm, setShowReturnToForSaleConfirm] = useState(false);
  const [showRejectInvoiceConfirm, setShowRejectInvoiceConfirm] = useState(false);
  const [showRejectCompletionInvoiceConfirm, setShowRejectCompletionInvoiceConfirm] = useState(false);
  const invoiceRejectionInputRef = useRef<HTMLInputElement | null>(null);
  const { panelRef: invoiceRejectionPanelRef, requestActivePanel: requestInvoiceRejectionPanel } = useActivePanel<HTMLDivElement>();
  const completionInvoiceRejectionInputRef = useRef<HTMLInputElement | null>(null);
  const { panelRef: completionInvoiceRejectionPanelRef, requestActivePanel: requestCompletionInvoiceRejectionPanel } = useActivePanel<HTMLDivElement>();
  const paymentVoidReasonInputRef = useRef<HTMLInputElement | null>(null);
  const { panelRef: paymentVoidPanelRef, requestActivePanel: requestPaymentVoidPanel } = useActivePanel<HTMLDivElement>();
  const [hasReadSalesUrl, setHasReadSalesUrl] = useState(false);

  const role = profile?.role ?? "user";
  const canSubmitReservation = canPerformSalesAction(role, "submit_reservation");
  const canApproveReservation = canPerformSalesAction(role, "approve_reservation");
  const canSubmitAgentInvoice = canPerformSalesAction(role, "submit_agent_invoice");
  const canManageCommercialTerms = canPerformSalesAction(role, "manage_commercial_terms");
  const canApproveCommercialPackage = canPerformSalesAction(role, "approve_commercial_package");
  const canApproveAgentInvoice = canPerformSalesAction(role, "approve_agent_invoice");
  const canRejectAgentInvoice = canPerformSalesAction(role, "reject_agent_invoice");
  const canRecordExchange = canPerformSalesAction(role, "record_exchange");
  const canRecordAgentFeePayment = canPerformSalesAction(role, "record_agent_fee_payment");
  const canVoidAgentFeePayment = canPerformSalesAction(role, "void_agent_fee_payment");
  const canViewAgentFeesPortfolio = canPerformSalesAction(role, "view_agent_fees_portfolio");
  const canSubmitCompletionDocuments = canPerformSalesAction(role, "submit_completion_documents");
  const canApproveCompletionDocuments = canPerformSalesAction(role, "approve_completion_documents");
  const canRecordCompletion = canPerformSalesAction(role, "record_completion");
  const selectedUnit = units.find((unit) => unit.id === unitId);
  const selectedBuilding = buildings.find((building) => building.id === (selectedUnit?.building_id ?? buildingId));
  const scopeBuilding = buildings.find((building) => building.id === buildingId);
  const selectedBuildingDefault = buildingSaleDefaults.find((item) => item.building_id === (selectedUnit?.building_id ?? buildingId)) ?? null;
  const activeAttempt = attempts.find((attempt) => attempt.unit_id === unitId && attempt.is_active);
  const selectedConversationId = conversationTarget?.unit === unitId && conversationTarget.sale ? conversationTarget.sale : activeAttempt?.id;
  const canReturnToForSale = canPerformSalesAction(role, "fail_reservation")
    && Boolean(activeAttempt?.is_active && canReturnUnitToForSale(activeAttempt.workflow_status));
  const failedAttempts = attempts.filter((attempt) => attempt.unit_id === unitId && attempt.workflow_status === "fallen_through");
  const activeTerms = activeAttempt ? terms.find((item) => item.sale_attempt_id === activeAttempt.id && item.is_current) : null;
  const reservationDocument = activeAttempt ? documents.find((item) => item.sale_attempt_id === activeAttempt.id && item.document_type === "reservation_form") : null;
  const reservationVersions = reservationDocument
    ? versions
      .filter((item) => item.document_id === reservationDocument.id && !item.redacted_at)
      .sort((a, b) => b.version_number - a.version_number)
    : [];
  const reservationVersion = reservationVersions.find((item) => item.is_current) ?? reservationVersions[0] ?? null;
  const visibleReservationVersion = reservationDocumentRemoved ? null : reservationVersion;
  const showReservationDocumentHistory = reservationDocumentHistoryUnlocked || reservationVersions.some((version) => !version.is_current);
  const agentInvoiceDocument = activeAttempt ? documents.find((item) => item.sale_attempt_id === activeAttempt.id && item.document_type === "agent_invoice" && (item.fee_milestone === "exchange" || item.fee_milestone === null)) : null;
  const agentInvoiceVersion = agentInvoiceDocument ? versions.find((item) => item.document_id === agentInvoiceDocument.id && item.is_current && !item.redacted_at) : null;
  const completionAgentInvoiceDocument = activeAttempt ? documents.find((item) => item.sale_attempt_id === activeAttempt.id && item.document_type === "agent_invoice" && item.fee_milestone === "completion") : null;
  const completionAgentInvoiceVersion = completionAgentInvoiceDocument ? versions.find((item) => item.document_id === completionAgentInvoiceDocument.id && item.is_current && !item.redacted_at) : null;
  const completionStatementDocument = activeAttempt ? documents.find((item) => item.sale_attempt_id === activeAttempt.id && item.document_type === "completion_statement" && !item.redacted_at && !item.superseded_at) : null;
  const completionStatementVersion = completionStatementDocument ? versions.find((item) => item.document_id === completionStatementDocument.id && item.is_current && !item.redacted_at) : null;
  const statementOfAccountDocument = activeAttempt ? documents.find((item) => item.sale_attempt_id === activeAttempt.id && item.document_type === "statement_of_account" && !item.redacted_at && !item.superseded_at) : null;
  const statementOfAccountVersion = statementOfAccountDocument ? versions.find((item) => item.document_id === statementOfAccountDocument.id && item.is_current && !item.redacted_at) : null;
  const activeInvoice = activeAttempt ? invoices.find((item) => item.sale_attempt_id === activeAttempt.id && item.invoice_type === "sales_agent" && (item.fee_milestone === "exchange" || item.fee_milestone === null)) : null;
  const completionAgentInvoice = activeAttempt ? invoices.find((item) => item.sale_attempt_id === activeAttempt.id && item.invoice_type === "sales_agent" && item.fee_milestone === "completion") : null;
  const activeInvoicePayments = activeInvoice ? invoicePayments.filter((item) => item.invoice_id === activeInvoice.id) : [];
  const completionInvoicePayments = completionAgentInvoice ? invoicePayments.filter((item) => item.invoice_id === completionAgentInvoice.id) : [];
  const exchangeAgentInvoiceVersions = agentInvoiceDocument
    ? versions.filter((item) => item.document_id === agentInvoiceDocument.id && !item.redacted_at).sort((a, b) => b.version_number - a.version_number)
    : [];
  const completionAgentInvoiceVersions = completionAgentInvoiceDocument
    ? versions.filter((item) => item.document_id === completionAgentInvoiceDocument.id && !item.redacted_at).sort((a, b) => b.version_number - a.version_number)
    : [];
  const activePaymentSchedule = activeAttempt ? paymentSchedule.filter((item) => item.sale_attempt_id === activeAttempt.id).sort((a, b) => a.sequence_no - b.sequence_no) : [];
  const activeWorkflowEvents = activeAttempt ? workflowEvents.filter((event) => event.sale_attempt_id === activeAttempt.id)
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)) : [];
  const commercialApprovalEvent = activeWorkflowEvents.find((event) => event.event_type === "commercial_package_approved");
  const exchangeRecordedEvent = activeWorkflowEvents.find((event) => event.event_type === "exchange_recorded");
  const completionApprovalEvent = activeWorkflowEvents.find((event) => event.event_type === "completion_documents_approved");
  const completionRecordedEvent = activeWorkflowEvents.find((event) => event.event_type === "completion_recorded");
  const completionQueryEvent = activeWorkflowEvents.find((event) => event.event_type === "completion_documents_query_raised");
  const completionDocumentState = getCompletionDocumentState(
    [completionStatementDocument, statementOfAccountDocument].filter((document): document is SaleDocument => Boolean(document)),
    versions,
    completionQueryEvent?.created_at,
  );
  const reservationApproved = activeAttempt ? ["approved", "reservation_approved", "awaiting_commercial_approval", "ready_for_exchange", "exchanged", "completion_pending", "completed"].includes(activeAttempt.workflow_status) : false;
  const commercialApproved = activeAttempt?.workflow_status === "ready_for_exchange" || Boolean(activeAttempt?.commercial_approved_at);
  const exchangeRecorded = activeAttempt ? ["exchanged", "completion_pending", "completed"].includes(activeAttempt.workflow_status) || Boolean(activeAttempt.exchanged_at) : false;
  const completionDocumentsApproved = completionDocumentState.approved;
  const completionReady = exchangeRecorded && completionDocumentsApproved;
  const completionRecorded = activeAttempt ? activeAttempt.workflow_status === "completed" || Boolean(activeAttempt.completed_at) : false;

  const commercialApprovedBy = workflowActorLabel(commercialApprovalEvent, profiles, activeAttempt?.commercial_approved_by_user_id);
  const exchangeRecordedBy = workflowActorLabel(exchangeRecordedEvent, profiles);
  const completionDocumentsApprovedBy = workflowActorLabel(completionApprovalEvent, profiles,
    completionStatementDocument?.approved_by_user_id ?? statementOfAccountDocument?.approved_by_user_id);
  const completionDocumentsApprovedAt = completionApprovalEvent?.created_at
    ?? completionStatementDocument?.approved_at
    ?? statementOfAccountDocument?.approved_at;
  const completionRecordedBy = workflowActorLabel(completionRecordedEvent, profiles);
  const taskActorName = (userId?: string | null) => historicalActorLabel({ userId, profiles, fallback: "" });
  const completionTasks = getCompletionTasks({
    exchangeRecorded, completionRecorded, documents: completionDocumentState,
    uploadedBy: taskActorName(completionDocumentState.uploadedByUserId),
    approvedBy: completionDocumentsApprovedBy,
    recordedBy: completionRecordedBy,
  });
  const exchangeTasks = getExchangeTasks({
    reservationApproved, commercialApproved, exchangeRecorded,
    commercialApprovedBy,
    exchangeRecordedBy,
  });
  const persistedCompletionQuery = typeof completionQueryEvent?.metadata?.queryNote === "string"
    ? completionQueryEvent.metadata.queryNote : completionStatementDocument?.query_note ?? statementOfAccountDocument?.query_note;
  const displayAgentFeePercent = activeTerms?.agent_fee_percent ?? selectedBuildingDefault?.default_agent_fee_percent ?? 0;
  const displayExchangeAgentFeePercent = activeTerms?.exchange_agent_fee_percent ?? selectedBuildingDefault?.default_exchange_agent_fee_percent ?? displayAgentFeePercent;
  const displayCompletionAgentFeePercent = activeTerms?.completion_agent_fee_percent ?? selectedBuildingDefault?.default_completion_agent_fee_percent ?? 0;
  const displayVatRate = activeTerms?.vat_rate ?? selectedBuildingDefault?.default_vat_rate ?? 20;
  const displayReservationFee = activeTerms?.reservation_fee ?? selectedBuildingDefault?.reservation_fee ?? 0;
  const displayReservationFeeHolder = activeTerms?.reservation_fee_holder ?? selectedBuildingDefault?.reservation_fee_holder_default ?? "sales_agent";
  const displaySolicitorFee = activeTerms?.solicitor_fee ?? selectedBuildingDefault?.default_sales_solicitor_fee ?? 882;
  const displayDepositStructure = buildDepositStructure({
    exchangeDepositPercent: activeTerms?.exchange_deposit_percent ?? selectedBuildingDefault?.exchange_deposit_percent ?? 10,
    secondDepositEnabled: activeTerms?.second_deposit_enabled ?? selectedBuildingDefault?.second_deposit_enabled ?? false,
    secondDepositPercent: activeTerms?.second_deposit_percent ?? selectedBuildingDefault?.second_deposit_percent ?? 0,
    secondDepositMonthsAfterExchange: activeTerms?.second_deposit_months_after_exchange ?? selectedBuildingDefault?.second_deposit_months_after_exchange ?? null,
  });
  const buildingDefaultDepositStructure = buildDepositStructure({
    exchangeDepositPercent: selectedBuildingDefault?.exchange_deposit_percent ?? 10,
    secondDepositEnabled: selectedBuildingDefault?.second_deposit_enabled ?? false,
    secondDepositPercent: selectedBuildingDefault?.second_deposit_percent ?? 0,
    secondDepositMonthsAfterExchange: selectedBuildingDefault?.second_deposit_months_after_exchange ?? null,
  });
  const previewContractPrice = parseGbpInput(contractPrice) ?? activeTerms?.contract_price ?? 0;
  const previewAgentFeePercent = parsePercentInput(agentFeePercent) ?? displayAgentFeePercent;
  const previewExchangeAgentFeePercent = parsePercentInput(exchangeAgentFeePercent) ?? displayExchangeAgentFeePercent;
  const previewCompletionAgentFeePercent = parsePercentInput(completionAgentFeePercent) ?? displayCompletionAgentFeePercent;
  const invalidAgentFeeInput = [agentFeePercent, exchangeAgentFeePercent, completionAgentFeePercent].some((value) => value.trim() !== "" && parsePercentInput(value) === null);
  const previewAgentFeeStructure = invalidAgentFeeInput ? { isValid: false, error: "Enter percentages between 0% and 100%." } : validateAgentFeeStructure({
    totalFeePercent: previewAgentFeePercent,
    exchangeFeePercent: previewExchangeAgentFeePercent,
    completionFeePercent: previewCompletionAgentFeePercent,
  });
  const previewAgentFeeSum = Math.round((previewExchangeAgentFeePercent + previewCompletionAgentFeePercent) * 10_000) / 10_000;
  const previewReservationFee = parseGbpInput(reservationFee) ?? displayReservationFee;
  const previewDeveloperContributionValue = parseGbpInput(developerContribution) ?? activeTerms?.developer_contribution_value ?? activeTerms?.developer_contribution ?? 0;
  const previewDeveloperContributionType = developerContributionValueType;
  const previewDeveloperContributionAmount = contributionAmount(previewDeveloperContributionValue, previewDeveloperContributionType, previewContractPrice);
  const previewAgentContributionValue = parseGbpInput(agentContribution) ?? activeTerms?.agent_contribution_value ?? activeTerms?.agent_contribution ?? 0;
  const previewAgentContributionType = agentContributionValueType;
  const previewAgentContribution = contributionAmount(previewAgentContributionValue, previewAgentContributionType, previewContractPrice);
  const previewDepositStructure = buildDepositStructure({
    exchangeDepositPercent: normaliseNumberInput(exchangeDepositPercent) ?? displayDepositStructure.exchangeDepositPercent,
    secondDepositEnabled,
    secondDepositPercent: normaliseNumberInput(secondDepositPercent) ?? 0,
    secondDepositMonthsAfterExchange: normaliseNumberInput(secondDepositMonthsAfterExchange) ?? null,
  });
  const previewInvoice = invoicePreview({
    contractPrice: previewContractPrice,
    agentFeePercent: previewExchangeAgentFeePercent,
    vatRate: displayVatRate,
    reservationFee: previewReservationFee,
    reservationFeeHolder,
    agentContribution: previewAgentContribution,
  });
  const completionInvoicePreview = calculateMilestoneFee({ salePrice: previewContractPrice, feePercent: previewCompletionAgentFeePercent, vatRate: displayVatRate });
  const uploadedInvoiceGross = activeInvoice?.gross_amount ?? parseGbpInput(invoiceGrossAmount);
  const invoiceVariance = uploadedInvoiceGross === null || uploadedInvoiceGross === undefined ? null : uploadedInvoiceGross - previewInvoice.grossAmount;
  const permittedRelease = activePaymentSchedule
    .filter((row) => row.payment_stage === "exchange")
    .reduce((total, row) => total + scheduleAmount(row, activeTerms?.contract_price), 0);
  const expectedPayableAmount = activeInvoice?.expected_payable_amount ?? previewInvoice.expectedPayableAmount;
  const invoicePaymentPosition = deriveInvoicePaymentPosition({
    cashAmountPayable: expectedPayableAmount,
    reservationFeeHeld: activeInvoice?.reservation_fee_deduction ?? previewInvoice.reservationFeeDeduction,
    payments: activeInvoicePayments,
  });
  const completionExpectedPayableAmount = completionAgentInvoice?.expected_payable_amount ?? completionInvoicePreview.grossAmount;
  const completionInvoicePaymentPosition = deriveInvoicePaymentPosition({
    cashAmountPayable: completionExpectedPayableAmount,
    reservationFeeHeld: 0,
    payments: completionInvoicePayments,
  });
  const completionInvoiceVariance = completionAgentInvoice?.gross_amount === null || completionAgentInvoice?.gross_amount === undefined
    ? null
    : completionAgentInvoice.gross_amount - completionInvoicePreview.grossAmount;
  const agentFeeSummary = deriveAgentFeeSummary({
    milestones: [
      {
        expectedNetAmount: previewInvoice.netAmount,
        expectedVatAmount: previewInvoice.vatAmount,
        expectedGrossAmount: previewInvoice.grossAmount,
        invoice: activeInvoice,
        payments: activeInvoicePayments,
      },
      {
        expectedNetAmount: completionInvoicePreview.netAmount,
        expectedVatAmount: completionInvoicePreview.vatAmount,
        expectedGrossAmount: completionInvoicePreview.grossAmount,
        invoice: completionAgentInvoice,
        payments: completionInvoicePayments,
      },
    ],
  });
  const agentInvoiceNeedsCorrection = agentInvoiceDocument?.status === "query_raised" || activeInvoice?.status === "query_raised";
  const completionInvoiceNeedsCorrection = completionAgentInvoiceDocument?.status === "query_raised" || completionAgentInvoice?.status === "query_raised";
  const exchangeInvoiceApproved = activeInvoice?.status === "approved" || Boolean(activeInvoice?.approved_at);
  const completionInvoiceApproved = completionAgentInvoice?.status === "approved" || Boolean(completionAgentInvoice?.approved_at);
  const completionInvoiceSubmissionAvailable = exchangeRecorded && previewCompletionAgentFeePercent > 0;
  const exchangeAgentFeeStatus = !activeInvoice
      ? "Invoice required"
      : agentInvoiceNeedsCorrection
        ? "Correction requested"
      : !exchangeInvoiceApproved
        ? "Awaiting approval"
        : invoicePaymentPosition.paymentStatus;
  const completionAgentFeeStatus = previewCompletionAgentFeePercent <= 0
    ? "Not applicable"
    : !completionAgentInvoice
      ? completionInvoiceSubmissionAvailable ? "Invoice required" : "Available after Exchange"
      : completionInvoiceNeedsCorrection
        ? "Correction requested"
        : !completionInvoiceApproved
          ? "Awaiting approval"
          : completionInvoicePaymentPosition.paymentStatus;
  const activeAttemptByUnit = useMemo(
    () => new Map(attempts.filter((attempt) => attempt.is_active).map((attempt) => [attempt.unit_id, attempt])),
    [attempts],
  );
  const currentTermsByAttempt = useMemo(
    () => new Map(terms.filter((item) => item.is_current).map((item) => [item.sale_attempt_id, item])),
    [terms],
  );
  const currentTermForUnit = (unit: Unit) => {
    const attempt = activeAttemptByUnit.get(unit.id);
    return attempt ? currentTermsByAttempt.get(attempt.id) ?? null : null;
  };
  const unitSaleValue = (unit: Unit) => {
    const term = currentTermForUnit(unit);
    return term?.contract_price ?? term?.list_price_at_offer ?? 0;
  };
  const developerNetForTerms = (saleTerms?: SaleTerms | null) => {
    if (!saleTerms) return 0;
    return calculateDeveloperNet({
      contractPrice: saleTerms.contract_price ?? saleTerms.list_price_at_offer ?? 0,
      parkingValue: saleTerms.parking_value ?? 0,
      developerContribution: saleTerms.developer_contribution ?? 0,
      solicitorFee: saleTerms.solicitor_fee ?? 0,
      agentFeePercent: saleTerms.agent_fee_percent ?? 0,
    });
  };
  const selectedContractValue = activeTerms?.contract_price ?? activeTerms?.list_price_at_offer ?? 0;
  const selectedAgentInvoice = invoicePreview({
    contractPrice: selectedContractValue,
    agentFeePercent: displayAgentFeePercent,
    vatRate: displayVatRate,
    reservationFee: displayReservationFee,
    reservationFeeHolder: displayReservationFeeHolder,
    agentContribution: activeTerms?.agent_contribution ?? 0,
  });
  const selectedExchangeInvoice = invoicePreview({
    contractPrice: selectedContractValue,
    agentFeePercent: displayExchangeAgentFeePercent,
    vatRate: displayVatRate,
    reservationFee: displayReservationFee,
    reservationFeeHolder: displayReservationFeeHolder,
    agentContribution: activeTerms?.agent_contribution ?? 0,
  });
  const selectedDeveloperNet = calculateDeveloperNet({
    contractPrice: selectedContractValue,
    parkingValue: activeTerms?.parking_value ?? 0,
    developerContribution: activeTerms?.developer_contribution ?? 0,
    solicitorFee: displaySolicitorFee,
    agentFeePercent: displayAgentFeePercent,
  });
  const modelParkingValue = parseGbpInput(parkingValue) ?? activeTerms?.parking_value ?? 0;
  const modelSolicitorFee = parseGbpInput(solicitorFee) ?? displaySolicitorFee;
  const modelDeveloperNet = calculateDeveloperNet({
    contractPrice: previewContractPrice,
    parkingValue: modelParkingValue,
    developerContribution: previewDeveloperContributionAmount,
    solicitorFee: modelSolicitorFee,
    agentFeePercent: previewAgentFeePercent,
  });
  const selectedExchangeDeposit = selectedContractValue * (displayDepositStructure.exchangeDepositPercent / 100);
  const exchangeDepositDue = permittedRelease || selectedExchangeDeposit;
  const selectedSecondDeposit = displayDepositStructure.secondDepositEnabled
    ? selectedContractValue * (displayDepositStructure.secondDepositPercent / 100)
    : 0;
  const selectedCompletionBalance = selectedContractValue * (displayDepositStructure.completionBalancePercent / 100);
  const selectedBuyerContributionTotal = (activeTerms?.developer_contribution ?? 0) + (activeTerms?.agent_contribution ?? 0);
  const selectedBuyerNetCost = Math.max(0, selectedContractValue + (activeTerms?.parking_value ?? 0) - selectedBuyerContributionTotal - (activeTerms?.parking_contribution_value ?? 0));
  const activeDeveloperContributionType = activeTerms?.developer_contribution_value_type ?? "amount";
  const activeDeveloperContributionValue = activeTerms?.developer_contribution_value ?? activeTerms?.developer_contribution ?? 0;
  const activeDeveloperContributionLabel = contributionLabel(activeDeveloperContributionValue, activeDeveloperContributionType, activeTerms?.developer_contribution ?? 0);
  const activeDeveloperContributionDeductionLabel = contributionDeductionLabel(activeDeveloperContributionValue, activeDeveloperContributionType, activeTerms?.developer_contribution ?? 0);
  const activeAgentContributionType = activeTerms?.agent_contribution_value_type ?? "amount";
  const activeAgentContributionValue = activeTerms?.agent_contribution_value ?? activeTerms?.agent_contribution ?? 0;
  const activeAgentContributionLabel = contributionLabel(activeAgentContributionValue, activeAgentContributionType, activeTerms?.agent_contribution ?? 0);
  const activeAgentContributionDeductionLabel = contributionDeductionLabel(activeAgentContributionValue, activeAgentContributionType, activeTerms?.agent_contribution ?? 0);
  const activeSpecialConditions = [
    ...(activeTerms?.additional_special_conditions?.filter((condition) => condition.trim()) ?? []),
    ...(activeTerms?.parking_location_details ? [activeTerms.parking_location_details] : []),
  ].filter((condition, index, items) => items.findIndex((item) => item.toLowerCase() === condition.toLowerCase()) === index);
  const todayDate = new Date().toISOString().slice(0, 10);
  const buyerIdentityEntered = Boolean(buyerPersonName.trim() || buyerCompanyName.trim());
  const buyerDetailsComplete = buyerIdentityEntered && Boolean(buyerEmail.trim()) && Boolean(buyerPhone.trim()) && Boolean(buyerSolicitorName.trim());
  const submittedByName = historicalActorLabel({
    snapshotName: activeAttempt?.reservation_submitted_by_name,
    snapshotEmail: activeAttempt?.reservation_submitted_by_email,
    userId: activeAttempt?.reservation_submitted_by_user_id,
    profiles,
    fallback: "-",
  });
  const approvedByName = historicalActorLabel({
    snapshotName: activeAttempt?.reservation_approved_by_name,
    snapshotEmail: activeAttempt?.reservation_approved_by_email,
    userId: activeAttempt?.reservation_approved_by_user_id,
    profiles,
    fallback: "-",
  });
  const approvalHistoryEvents: ApprovalHistoryEvent[] = activeAttempt ? [
    {
      id: `${activeAttempt.id}-reservation-submitted`,
      label: "Reservation submitted",
      occurredAt: activeAttempt.reservation_submitted_at,
      actor: submittedByName,
    },
    {
      id: `${activeAttempt.id}-reservation-approved`,
      label: "Approved",
      occurredAt: activeAttempt.reservation_approved_at,
      actor: approvedByName,
    },
  ] : [];
  const rejectionByName = historicalActorLabel({
    snapshotName: activeAttempt?.reservation_rejected_by_name,
    snapshotEmail: activeAttempt?.reservation_rejected_by_email,
    userId: activeAttempt?.reservation_rejected_by_user_id,
    profiles,
    fallback: "-",
  });
  const formalReservationDate = activeAttempt?.reservation_date ?? reservationDate;
  const reservationDateMissing = !formalReservationDate;
  const reservationDateIsFuture = Boolean(formalReservationDate && formalReservationDate > todayDate);
  const activeRejectionReason = activeAttempt?.reservation_rejection_reason ?? reservationDocument?.query_note ?? "";
  const saleUsesProtectedSnapshot = Boolean(
    activeTerms
    && selectedUnit
    && (selectedUnit.sale_status !== "for_sale" || activeAttempt?.reservation_approved_at || activeAttempt?.exchanged_at || activeAttempt?.completed_at),
  );
  const buildingDefaultsDifferFromSnapshot = Boolean(
    saleUsesProtectedSnapshot
    && selectedBuildingDefault
    && (
      (activeTerms?.agent_fee_percent ?? null) !== (selectedBuildingDefault.default_agent_fee_percent ?? null)
      || (activeTerms?.exchange_agent_fee_percent ?? null) !== (selectedBuildingDefault.default_exchange_agent_fee_percent ?? selectedBuildingDefault.default_agent_fee_percent ?? null)
      || (activeTerms?.completion_agent_fee_percent ?? null) !== (selectedBuildingDefault.default_completion_agent_fee_percent ?? 0)
      || (activeTerms?.reservation_fee ?? null) !== (selectedBuildingDefault.reservation_fee ?? null)
      || (activeTerms?.reservation_fee_holder ?? null) !== (selectedBuildingDefault.reservation_fee_holder_default ?? null)
      || (activeTerms?.exchange_deposit_percent ?? null) !== (selectedBuildingDefault.exchange_deposit_percent ?? null)
      || Boolean(activeTerms?.second_deposit_enabled) !== Boolean(selectedBuildingDefault.second_deposit_enabled)
      || (activeTerms?.second_deposit_percent ?? null) !== (selectedBuildingDefault.second_deposit_percent ?? null)
      || (activeTerms?.second_deposit_months_after_exchange ?? null) !== (selectedBuildingDefault.second_deposit_months_after_exchange ?? null)
      || (activeTerms?.completion_balance_percent ?? null) !== buildingDefaultDepositStructure.completionBalancePercent
    ),
  );
  const forSaleUnits = buildingUnits.filter((unit) => unit.sale_status === "for_sale");
  const modelGdvDelta = (previewContractPrice + modelParkingValue) - selectedContractValue;
  const forSaleCurrentGdv = forSaleUnits.reduce((total, unit) => total + unitSaleValue(unit), 0);
  const forSaleCurrentNet = forSaleUnits.reduce((total, unit) => total + developerNetForTerms(currentTermForUnit(unit)), 0);
  const forSaleProposedGdv = forSaleCurrentGdv + (modelGdvDelta * forSaleUnits.length);
  const forSaleProposedNet = forSaleCurrentNet + ((modelDeveloperNet - selectedDeveloperNet) * forSaleUnits.length);
  function workflowStageForUnit(unit: Unit): SaleWorkflowStage {
    const attempt = activeAttemptByUnit.get(unit.id);
    if (unit.sale_status === "completed" || attempt?.workflow_status === "completed") return "handover";
    if (unit.sale_status === "exchanged" || attempt?.workflow_status === "exchanged" || attempt?.workflow_status === "completion_pending") return "completion";
    if (unit.sale_status === "reserved" || attempt?.reservation_approved_at || ["approved", "reservation_approved", "awaiting_commercial_approval", "ready_for_exchange"].includes(attempt?.workflow_status ?? "")) return "exchange";
    return "reservation";
  }
  const selectedWorkflowStage: SaleWorkflowStage = selectedUnit ? workflowStageForUnit(selectedUnit) : "reservation";
  const workflowOrder: SaleWorkflowStage[] = ["reservation", "exchange", "completion", "handover"];
  const currentWorkflowIndex = workflowOrder.indexOf(selectedWorkflowStage);
  const workflowStages = [
    {
      key: "reservation" as const,
      label: "Reservation",
      status: reservationApproved ? "Approved" : ["awaiting_approval", "reservation_submitted"].includes(activeAttempt?.workflow_status ?? "") ? "Awaiting developer approval" : ["rejected", "reservation_query_raised"].includes(activeAttempt?.workflow_status ?? "") ? "Rejected" : activeAttempt ? "Draft" : "Not started",
    },
    {
      key: "exchange" as const,
      label: "Exchange",
      status: exchangeRecorded ? "Exchanged" : commercialApproved ? "Ready" : reservationApproved ? "Commercial approval" : "Locked",
    },
    {
      key: "completion" as const,
      label: "Completion",
      status: completionRecorded ? "Completed" : exchangeRecorded ? "Documents required" : "Locked",
    },
    {
      key: "handover" as const,
      label: "Handover",
      status: completionRecorded ? "Available" : "Locked",
    },
  ];
  const currentLegalStage = workflowStages[currentWorkflowIndex] ?? workflowStages[0];
  const currentLegalStageDate = selectedUnit ? saleStatusDate(selectedUnit, activeAttempt) : null;
  const reservationState: "not_started" | "awaiting_approval" | "rejected" | "approved" | "failed" = (() => {
    if (activeAttempt?.workflow_status === "fallen_through") return "failed";
    if (reservationApproved) return "approved";
    if (["rejected", "reservation_query_raised"].includes(activeAttempt?.workflow_status ?? "")) return "rejected";
    if (["awaiting_approval", "reservation_submitted"].includes(activeAttempt?.workflow_status ?? "")) return "awaiting_approval";
    return "not_started";
  })();
  const reservationStateLabel: Record<typeof reservationState, string> = {
    not_started: "Not started",
    awaiting_approval: "Awaiting developer approval",
    rejected: "Rejected",
    approved: "Approved",
    failed: "Failed",
  };
  const reservationTasks = getReservationTasks({
    state: reservationState,
    submittedBy: submittedByName === "-" ? null : submittedByName,
    approvedBy: approvedByName === "-" ? null : approvedByName,
  });
  const reservationCanBeEdited = canSubmitReservation && ["not_started", "rejected"].includes(reservationState);
  const reservationCanBeReviewed = canApproveReservation && reservationState === "awaiting_approval";
  const approvalBlocked = !activeAttempt || !reservationVersion || reservationDateMissing || reservationDateIsFuture || !hasRequiredBuyerInfo(activeAttempt);
  const commercialModelLocked = Boolean(activeAttempt && !["draft", "rejected", "reservation_query_raised"].includes(activeAttempt.workflow_status));
  const commercialModelEditable = canManageCommercialTerms && !commercialModelLocked;
  const displayedPaymentSchedule = activePaymentSchedule.length > 0
    ? activePaymentSchedule
    : [
      {
        id: "exchange",
        sale_attempt_id: activeAttempt?.id ?? "",
        sequence_no: 1,
        payment_stage: "exchange",
        label: `${displayDepositStructure.exchangeDepositPercent}% exchange deposit`,
        due_event: "exchange",
        due_offset_days: 0,
        percent_of_contract_price: displayDepositStructure.exchangeDepositPercent,
        fixed_amount: null,
        expected_amount: selectedContractValue ? selectedContractValue * (displayDepositStructure.exchangeDepositPercent / 100) : null,
        includes_reservation_fee: true,
        status: "pending",
      },
      ...(displayDepositStructure.secondDepositEnabled ? [{
        id: "second",
        sale_attempt_id: activeAttempt?.id ?? "",
        sequence_no: 2,
        payment_stage: "delayed_deposit",
        label: `${displayDepositStructure.secondDepositPercent}% second deposit`,
        due_event: "manual_date",
        due_offset_days: (displayDepositStructure.secondDepositMonthsAfterExchange ?? 0) * 31,
        percent_of_contract_price: displayDepositStructure.secondDepositPercent,
        fixed_amount: null,
        expected_amount: selectedContractValue ? selectedContractValue * (displayDepositStructure.secondDepositPercent / 100) : null,
        includes_reservation_fee: false,
        status: "pending",
      }] : []),
      {
        id: "completion",
        sale_attempt_id: activeAttempt?.id ?? "",
        sequence_no: displayDepositStructure.secondDepositEnabled ? 3 : 2,
        payment_stage: "completion",
        label: `${displayDepositStructure.completionBalancePercent}% balance on completion`,
        due_event: "completion",
        due_offset_days: 0,
        percent_of_contract_price: displayDepositStructure.completionBalancePercent,
        fixed_amount: null,
        expected_amount: selectedContractValue ? selectedContractValue * (displayDepositStructure.completionBalancePercent / 100) : null,
        includes_reservation_fee: false,
        status: "pending",
      },
    ];
  const baselineGdv = buildingUnits.reduce((total, unit) => {
    const term = currentTermForUnit(unit);
    return total + (term?.list_price_at_offer ?? term?.contract_price ?? 0);
  }, 0);
  const forecastRevenue = buildingUnits.reduce((total, unit) => total + unitSaleValue(unit), 0);
  const netSalesProceeds = buildingUnits.reduce((total, unit) => total + developerNetForTerms(currentTermForUnit(unit)), 0);
  const saleValuesCount = buildingUnits.filter((unit) => unitSaleValue(unit) > 0).length;
  const pipelineSummary = SALES_ROUTE_STATUSES.map((status) => {
    const stageUnits = buildingUnits.filter((unit) => unit.sale_status === status);
    return {
      status,
      label: saleStatusLabel(status),
      count: stageUnits.length,
      value: stageUnits.reduce((total, unit) => total + unitSaleValue(unit), 0),
    };
  });
  const filteredSalesUnits = buildingUnits.filter((unit) => {
    const matchesStatus = salesStageFilter === "all" || unit.sale_status === salesStageFilter;
    const searchValue = salesSearch.trim().toLowerCase();
    const buildingName = buildings.find((building) => building.id === unit.building_id)?.name ?? "";
    const matchesSearch = unit.unit_number.toLowerCase().includes(searchValue) || buildingName.toLowerCase().includes(searchValue);
    return matchesStatus && matchesSearch;
  });
  const salesPageCount = Math.max(1, Math.ceil(filteredSalesUnits.length / SALES_PAGE_SIZE));
  const currentSalesPage = Math.min(salesPage, salesPageCount);
  const pagedSalesUnits = filteredSalesUnits.slice((currentSalesPage - 1) * SALES_PAGE_SIZE, currentSalesPage * SALES_PAGE_SIZE);

  function nextActionForUnit(unit: Unit) {
    const attempt = activeAttemptByUnit.get(unit.id);
    if (!attempt) return "Submit reservation";
    if (["rejected", "reservation_query_raised"].includes(attempt.workflow_status)) return "Resolve rejected reservation";
    if (["awaiting_approval", "reservation_submitted"].includes(attempt.workflow_status)) return "Awaiting developer approval";
    if (unit.sale_status === "for_sale") return "Submit reservation";
    if (unit.sale_status === "reserved") {
      if (!attempt.commercial_approved_at && attempt.workflow_status !== "ready_for_exchange") return "Commercial approval";
      return "Record exchange";
    }
    if (unit.sale_status === "exchanged") return "Completion documents";
    if (unit.sale_status === "completed") return "Handover available";
    return "Review sale file";
  }

  function writeSalesUrl(next: { building?: string; unit?: string | null; filter?: SalesStageFilter | null; view?: SalesView | null; section?: UnitSaleSection | null; hash?: string | null }) {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    params.set("screen", "sales");
    if (next.unit === null) params.delete("salesUnitId");
    if (next.unit) params.set("salesUnitId", next.unit);
    if (next.filter === null) params.delete("salesFilter");
    if (next.filter) params.set("salesFilter", next.filter);
    if (next.view === null || next.view === "pipeline") params.delete("salesView");
    if (next.view === "agent_fees") params.set("salesView", next.view);
    if (next.section === null || next.section === "progression") params.delete("section");
    if (next.section === "financials" || next.section === "commercial") params.set("section", next.section);
    const hash = next.hash ? `#${next.hash}` : "";
    window.history.pushState(null, "", `${window.location.pathname}?${params.toString()}${hash}`);
  }

  function openSaleFile(nextUnitId: string, nextBuildingId = buildingId, focusAgentFees = false) {
    setConversationTarget(null);
    manuallySelectedWorkflowStageRef.current = null;
    pendingAgentFeesScrollRef.current = focusAgentFees ? "exchange" : null;
    setUnitId(nextUnitId);
    setSelectedSaleUnitId(nextUnitId);
    setActiveSalesView("pipeline");
    setActiveUnitSection(focusAgentFees ? "financials" : "progression");
    setShowCommercialModel(false);
    const nextUnit = units.find((unit) => unit.id === nextUnitId);
    setActiveWorkflowStage(nextUnit ? workflowStageForUnit(nextUnit) : "reservation");
    writeSalesUrl({ building: nextBuildingId, unit: nextUnitId, filter: salesStageFilter, view: "pipeline", section: focusAgentFees ? "financials" : "progression", hash: focusAgentFees ? "exchange-fee" : null });
    if (!focusAgentFees) window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function backToSalesOverview() {
    manuallySelectedWorkflowStageRef.current = null;
    setSelectedSaleUnitId("");
    setActiveSalesView("pipeline");
    setActiveUnitSection("progression");
    setShowCommercialModel(false);
    writeSalesUrl({ building: buildingId, unit: null, filter: salesStageFilter, view: "pipeline", section: null });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function changeSalesView(view: SalesView) {
    setActiveSalesView(view);
    setSelectedSaleUnitId("");
    setActiveUnitSection("progression");
    writeSalesUrl({ building: view === "pipeline" ? buildingId : undefined, unit: null, filter: view === "pipeline" ? salesStageFilter : null, view, section: null });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function changeUnitSection(section: UnitSaleSection) {
    pendingAgentFeesScrollRef.current = null;
    setActiveUnitSection(section);
    writeSalesUrl({ building: buildingId, unit: selectedSaleUnitId, view: "pipeline", section });
  }

  function setReservationFormPdf(file: File | null) {
    setReservationFormFile(file);
    if (file) setReservationDocumentHistoryUnlocked(reservationDocumentRemoved || reservationVersions.length > 0);
  }

  function removeCurrentReservationPdf() {
    setReservationFormFile(null);
    setReservationDocumentRemoved(true);
    setReservationDocumentHistoryUnlocked(true);
  }

  useEffect(() => {
    if (hasReadSalesUrl || typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const urlUnitId = params.get("salesUnitId");
    const urlFilter = params.get("salesFilter") as SalesStageFilter | null;
    const urlView = params.get("salesView");
    const urlSection = params.get("section") as UnitSaleSection | null;

    if (urlUnitId && units.some((unit) => unit.id === urlUnitId)) {
      const conversation = params.get("conversation");
      const comment = params.get("comment");
      if (conversation || comment) {
        setConversationTarget({ unit: urlUnitId, sale: conversation ?? undefined, comment: comment ?? undefined });
        setConversationIntent("open");
      }
      const urlUnit = units.find((unit) => unit.id === urlUnitId);
      setUnitId(urlUnitId);
      setSelectedSaleUnitId(urlUnitId);
      if (urlUnit) {
        setActiveWorkflowStage(workflowStageForUnit(urlUnit));
      }
      if (urlSection === "financials" || urlSection === "commercial") {
        setActiveUnitSection(urlSection);
        if (urlSection === "financials" && (window.location.hash === "#exchange-fee" || window.location.hash === "#completion-fee")) {
          pendingAgentFeesScrollRef.current = window.location.hash === "#completion-fee" ? "completion" : "exchange";
        }
      }
    }

    if (urlFilter && SALES_STAGE_FILTERS.some((filter) => filter.value === urlFilter)) {
      setSalesStageFilter(urlFilter);
    }

    if (urlView === "agent_fees" && canViewAgentFeesPortfolio) {
      setActiveSalesView("agent_fees");
      setSelectedSaleUnitId("");
    }

    setHasReadSalesUrl(true);
  }, [buildings, canViewAgentFeesPortfolio, hasReadSalesUrl, setConversationIntent, units]);

  useEffect(() => {
    if (!pendingAgentFeesScrollRef.current || !activeAttempt || activeUnitSection !== "financials") return;
    const milestone = pendingAgentFeesScrollRef.current;
    pendingAgentFeesScrollRef.current = null;
    if (!reservationApproved) return;
    scrollToPortalSection(`${milestone}-fee`);
  }, [activeAttempt, activeUnitSection, reservationApproved]);

  useEffect(() => {
    if (!pendingWorkflowStageScrollRef.current || activeUnitSection !== "progression") return;
    const stage = pendingWorkflowStageScrollRef.current;
    pendingWorkflowStageScrollRef.current = null;
    scrollToPortalSection(`sales-stage-${stage}`);
  }, [activeUnitSection, activeWorkflowStage]);

  useEffect(() => {
    const handlePopState = () => {
      const section = new URLSearchParams(window.location.search).get("section");
      setActiveUnitSection(section === "financials" || section === "commercial" ? section : "progression");
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    setSalesPage(1);
  }, [buildingId, salesSearch, salesStageFilter]);

  useEffect(() => {
    if (!selectedSaleUnitId || !selectedUnit) return;
    if (manuallySelectedWorkflowStageRef.current === activeWorkflowStage) return;
    setActiveWorkflowStage(selectedWorkflowStage);
  }, [activeWorkflowStage, selectedSaleUnitId, selectedUnit, selectedWorkflowStage]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (selectedSaleUnitId && !buildingUnits.some((unit) => unit.id === selectedSaleUnitId)) {
        setSelectedSaleUnitId("");
        setActiveUnitSection("progression");
        writeSalesUrl({ unit: null, filter: salesStageFilter, view: activeSalesView, section: null });
      }
      if (buildingUnits.length > 0 && !buildingUnits.some((unit) => unit.id === unitId)) setUnitId(buildingUnits[0].id);
      if (buildingUnits.length === 0 && unitId) setUnitId("");
    }, 0);
    return () => window.clearTimeout(timer);
  }, [activeSalesView, buildingUnits, salesStageFilter, selectedSaleUnitId, unitId]);

  useEffect(() => {
    if (!activeAttempt) {
      setBuyerPersonName("");
      setBuyerCompanyName("");
      setBuyerEmail("");
      setBuyerPhone("");
      setBuyerSolicitorName("");
      setReservationDate("");
      setReservationTermsChecked(false);
      setContractPrice("");
      setReservationFee(selectedBuildingDefault?.reservation_fee?.toString() ?? "");
      setReservationFeeHolder(selectedBuildingDefault?.reservation_fee_holder_default ?? "sales_agent");
      setReservationFormFile(null);
      setReservationDocumentRemoved(false);
      setReservationDocumentHistoryUnlocked(false);
      setParkingValue("");
      setDeveloperContribution("");
      setDeveloperContributionValueType("amount");
      setAgentContribution("");
      setAgentContributionValueType("amount");
      setParkingLocationDetails("");
      setAdditionalSpecialConditions([""]);
      setAgentFeePercent(selectedBuildingDefault?.default_agent_fee_percent?.toString() ?? "");
      setExchangeAgentFeePercent(selectedBuildingDefault?.default_exchange_agent_fee_percent?.toString() ?? selectedBuildingDefault?.default_agent_fee_percent?.toString() ?? "");
      setCompletionAgentFeePercent(selectedBuildingDefault?.default_completion_agent_fee_percent?.toString() ?? "0");
      setSolicitorFee(selectedBuildingDefault?.default_sales_solicitor_fee?.toString() ?? "882");
      setExchangeDepositPercent(selectedBuildingDefault?.exchange_deposit_percent?.toString() ?? "10");
      setSecondDepositEnabled(Boolean(selectedBuildingDefault?.second_deposit_enabled));
      setSecondDepositPercent(selectedBuildingDefault?.second_deposit_percent?.toString() ?? "");
      setSecondDepositMonthsAfterExchange(selectedBuildingDefault?.second_deposit_months_after_exchange?.toString() ?? "");
      setDepositSummary(paymentScheduleSummary({
        exchangeDepositPercent: selectedBuildingDefault?.exchange_deposit_percent ?? 10,
        secondDepositEnabled: selectedBuildingDefault?.second_deposit_enabled ?? false,
        secondDepositPercent: selectedBuildingDefault?.second_deposit_percent ?? 0,
        secondDepositMonthsAfterExchange: selectedBuildingDefault?.second_deposit_months_after_exchange ?? null,
      }));
      setCommercialSummary("");
      setInvoiceReference("");
      setInvoiceDate("");
      setInvoiceNetAmount("");
      setInvoiceVatAmount("");
      setInvoiceGrossAmount("");
      setAgentInvoiceFile(null);
      setCompletionInvoiceReference("");
      setCompletionInvoiceDate("");
      setCompletionInvoiceGrossAmount("");
      setCompletionAgentInvoiceFile(null);
      setExchangeDate("");
      setExchangeDepositConfirmed(false);
      setSolicitorPaymentAmount("");
      setSolicitorPaymentDate("");
      paymentClientReferenceRef.current = null;
      setCompletionPaymentAmount("");
      setCompletionPaymentDate("");
      completionPaymentClientReferenceRef.current = null;
      setPaymentToVoid(null);
      setPaymentVoidReason("");
      setCompletionStatementFile(null);
      setStatementOfAccountFile(null);
      setCompletionQueryNote("");
      setCompletionDate("");
      setRejectionReason("");
      setInvoiceRejectionReason("");
      setCompletionInvoiceRejectionReason("");
      setShowRejectReservationConfirm(false);
      setShowRejectInvoiceConfirm(false);
      setShowRejectCompletionInvoiceConfirm(false);
      setShowAdvancedDealSetup(false);
      setCommercialSetupChanged(false);
      return;
    }

    const storedCompanyName = activeAttempt.buyer_company_name?.trim() || "";
    const storedPersonName = activeAttempt.buyer_person_name?.trim() || "";
    setBuyerPersonName(storedPersonName || (storedCompanyName ? "" : activeAttempt.buyer_name ?? ""));
    setBuyerCompanyName(storedCompanyName);
    setBuyerEmail(activeAttempt.buyer_email ?? "");
    setBuyerPhone(activeAttempt.buyer_phone ?? "");
    setBuyerSolicitorName(activeAttempt.buyer_solicitor_name ?? "");
    setReservationDate(activeAttempt.reservation_date ?? "");
    setReservationTermsChecked(Boolean(activeAttempt.reservation_terms_checked));
    setContractPrice(activeTerms?.contract_price?.toString() ?? activeTerms?.list_price_at_offer?.toString() ?? "");
    setReservationFee(activeTerms?.reservation_fee?.toString() ?? selectedBuildingDefault?.reservation_fee?.toString() ?? "");
    setReservationFeeHolder(activeTerms?.reservation_fee_holder ?? selectedBuildingDefault?.reservation_fee_holder_default ?? "sales_agent");
    setParkingValue(activeTerms?.parking_value?.toString() ?? "");
    setDeveloperContribution((activeTerms?.developer_contribution_value ?? activeTerms?.developer_contribution)?.toString() ?? "");
    setDeveloperContributionValueType(activeTerms?.developer_contribution_value_type ?? "amount");
    setAgentContribution((activeTerms?.agent_contribution_value ?? activeTerms?.agent_contribution)?.toString() ?? "");
    setAgentContributionValueType(activeTerms?.agent_contribution_value_type ?? "amount");
    setParkingLocationDetails("");
    const loadedAdditionalConditions = activeTerms?.additional_special_conditions?.filter((condition) => condition.trim()) ?? [];
    const legacyParkingCondition = activeTerms?.parking_location_details?.trim();
    const combinedAdditionalConditions = [
      ...loadedAdditionalConditions,
      ...(legacyParkingCondition && !loadedAdditionalConditions.some((condition) => condition.toLowerCase() === legacyParkingCondition.toLowerCase()) ? [legacyParkingCondition] : []),
    ];
    setAdditionalSpecialConditions(combinedAdditionalConditions.length ? combinedAdditionalConditions : [""]);
    setAgentFeePercent(activeTerms?.agent_fee_percent?.toString() ?? selectedBuildingDefault?.default_agent_fee_percent?.toString() ?? "");
    setExchangeAgentFeePercent(activeTerms?.exchange_agent_fee_percent?.toString() ?? selectedBuildingDefault?.default_exchange_agent_fee_percent?.toString() ?? activeTerms?.agent_fee_percent?.toString() ?? selectedBuildingDefault?.default_agent_fee_percent?.toString() ?? "");
    setCompletionAgentFeePercent(activeTerms?.completion_agent_fee_percent?.toString() ?? selectedBuildingDefault?.default_completion_agent_fee_percent?.toString() ?? "0");
    setSolicitorFee(activeTerms?.solicitor_fee?.toString() ?? selectedBuildingDefault?.default_sales_solicitor_fee?.toString() ?? "882");
    setExchangeDepositPercent(activeTerms?.exchange_deposit_percent?.toString() ?? selectedBuildingDefault?.exchange_deposit_percent?.toString() ?? "10");
    setSecondDepositEnabled(Boolean(activeTerms?.second_deposit_enabled ?? selectedBuildingDefault?.second_deposit_enabled));
    setSecondDepositPercent(activeTerms?.second_deposit_percent?.toString() ?? selectedBuildingDefault?.second_deposit_percent?.toString() ?? "");
    setSecondDepositMonthsAfterExchange(activeTerms?.second_deposit_months_after_exchange?.toString() ?? selectedBuildingDefault?.second_deposit_months_after_exchange?.toString() ?? "");
    setDepositSummary(activeTerms?.deposit_summary ?? paymentScheduleSummary({
      exchangeDepositPercent: activeTerms?.exchange_deposit_percent ?? selectedBuildingDefault?.exchange_deposit_percent ?? 10,
      secondDepositEnabled: activeTerms?.second_deposit_enabled ?? selectedBuildingDefault?.second_deposit_enabled ?? false,
      secondDepositPercent: activeTerms?.second_deposit_percent ?? selectedBuildingDefault?.second_deposit_percent ?? 0,
      secondDepositMonthsAfterExchange: activeTerms?.second_deposit_months_after_exchange ?? selectedBuildingDefault?.second_deposit_months_after_exchange ?? null,
    }));
    setCommercialSummary(activeTerms?.commercial_summary ?? "");
    setInvoiceReference(activeInvoice?.invoice_reference ?? "");
    setInvoiceDate(activeInvoice?.invoice_date ?? "");
    setInvoiceNetAmount(activeInvoice?.net_amount?.toString() ?? "");
    setInvoiceVatAmount(activeInvoice?.vat_amount?.toString() ?? "");
    setInvoiceGrossAmount(activeInvoice?.gross_amount?.toString() ?? "");
    setCompletionInvoiceReference(completionAgentInvoice?.invoice_reference ?? "");
    setCompletionInvoiceDate(completionAgentInvoice?.invoice_date ?? "");
    setCompletionInvoiceGrossAmount(completionAgentInvoice?.gross_amount?.toString() ?? "");
    setReservationFormFile(null);
    setReservationDocumentRemoved(false);
    setReservationDocumentHistoryUnlocked(false);
    setAgentInvoiceFile(null);
    setCompletionAgentInvoiceFile(null);
    setExchangeDate(activeAttempt.exchanged_at ?? "");
    setExchangeDepositConfirmed(Boolean(activeAttempt.exchanged_at));
    setSolicitorPaymentAmount("");
    setSolicitorPaymentDate("");
    paymentClientReferenceRef.current = null;
    setCompletionPaymentAmount("");
    setCompletionPaymentDate("");
    completionPaymentClientReferenceRef.current = null;
    setPaymentToVoid(null);
    setPaymentVoidReason("");
    setCompletionStatementFile(null);
    setStatementOfAccountFile(null);
    setCompletionQueryNote(completionStatementDocument?.query_note ?? statementOfAccountDocument?.query_note ?? "");
    setCompletionDate(activeAttempt.completed_at ?? "");
    setRejectionReason("");
    setReturnToForSaleReason("");
    setInvoiceRejectionReason("");
    setCompletionInvoiceRejectionReason("");
    setShowRejectReservationConfirm(false);
    setShowReturnToForSaleConfirm(false);
    setShowRejectInvoiceConfirm(false);
    setShowRejectCompletionInvoiceConfirm(false);
    setShowAdvancedDealSetup(false);
    setCommercialSetupChanged(false);
  }, [activeAttempt, activeInvoice, activeTerms, completionAgentInvoice, completionStatementDocument, reservationDocument, selectedBuildingDefault, statementOfAccountDocument]);

  async function loadSalesData() {
    const supabase = createSupabaseBrowserClient();
    let defaultsQuery = supabase.from("building_sale_defaults").select("*");
    if (buildingId) defaultsQuery = defaultsQuery.eq("building_id", buildingId);
    const { data: defaultRows, error: defaultsError } = await defaultsQuery;
    setSaleActorNames([]);
    if (defaultsError) onNotice(defaultsError.message);
    else setBuildingSaleDefaults((defaultRows ?? []) as BuildingSaleDefault[]);

    if (buildingUnits.length === 0) {
      setAttempts([]);
      setTerms([]);
      setPaymentSchedule([]);
      setDocuments([]);
      setVersions([]);
      setWorkflowEvents([]);
      setInvoices([]);
      setInvoicePayments([]);
      return;
    }

    setIsLoading(true);
    try {
      const unitIds = buildingUnits.map((unit) => unit.id);
      const { data: saleAttempts, error: attemptsError } = await supabase
        .from("unit_sale_attempts")
        .select("*")
        .in("unit_id", unitIds)
        .order("attempt_number", { ascending: false });
      if (attemptsError) throw attemptsError;

      const attemptIds = (saleAttempts ?? []).map((attempt) => attempt.id as string);
      setAttempts((saleAttempts ?? []) as SaleAttempt[]);

      if (attemptIds.length === 0) {
        setTerms([]);
        setPaymentSchedule([]);
        setDocuments([]);
        setVersions([]);
        setWorkflowEvents([]);
        setInvoices([]);
        setInvoicePayments([]);
        return;
      }

      const [termsResult, scheduleResult, documentsResult, invoicesResult, invoicePaymentsResult, workflowEventsResult, actorNamesResult] = await Promise.all([
        supabase.from("unit_sale_terms").select("*").in("sale_attempt_id", attemptIds),
        supabase.from("unit_sale_payment_schedule").select("*").in("sale_attempt_id", attemptIds).order("sequence_no"),
        supabase.from("unit_sale_documents").select("*").in("sale_attempt_id", attemptIds),
        supabase.from("unit_sale_invoices").select("*").in("sale_attempt_id", attemptIds),
        supabase.from("unit_sale_invoice_payments").select("*").in("sale_attempt_id", attemptIds),
        supabase.rpc("sale_workflow_context", { p_sales: attemptIds }),
        supabase.rpc("sale_actor_names", { p_sales: attemptIds }),
      ]);
      if (termsResult.error) throw termsResult.error;
      if (scheduleResult.error) throw scheduleResult.error;
      if (documentsResult.error) throw documentsResult.error;
      if (invoicesResult.error) throw invoicesResult.error;
      if (invoicePaymentsResult.error) throw invoicePaymentsResult.error;
      if (workflowEventsResult.error) throw workflowEventsResult.error;

      if (actorNamesResult.error && !isMissingSaleActorNames(actorNamesResult.error)) throw actorNamesResult.error;
      setSaleActorNames((actorNamesResult.data ?? []) as SaleActorName[]);
      if (actorNamesResult.error) {
        console.warn("Sale actor names are unavailable. Apply supabase/migrations/20260908b_sale_actor_names.sql to this database.", actorNamesResult.error);
        onNotice("Sales data is available, but some user names need a database update. Please contact an administrator.");
      }

      const loadedDocuments = (documentsResult.data ?? []) as SaleDocument[];
      setTerms((termsResult.data ?? []) as SaleTerms[]);
      setPaymentSchedule((scheduleResult.data ?? []) as PaymentScheduleRow[]);
      setDocuments(loadedDocuments);
      setInvoices((invoicesResult.data ?? []) as SaleInvoice[]);
      setInvoicePayments((invoicePaymentsResult.data ?? []) as SaleInvoicePayment[]);
      setWorkflowEvents((workflowEventsResult.data ?? []) as SaleWorkflowEvent[]);

      const documentIds = loadedDocuments.map((document) => document.id);
      if (documentIds.length === 0) {
        setVersions([]);
        return;
      }

      const { data: versionRows, error: versionsError } = await supabase
        .from("unit_sale_document_versions")
        .select("*")
        .in("document_id", documentIds)
        .order("version_number", { ascending: false });
      if (versionsError) throw versionsError;
      setVersions((versionRows ?? []) as SaleDocumentVersion[]);
    } catch (error) {
      onNotice(salesLoadErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadSalesData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildingId, units.length]);

  function resetCommercialModelDraft() {
    setCommercialSetupChanged(false);
    const loadedAdditionalConditions = activeTerms?.additional_special_conditions?.filter((condition) => condition.trim()) ?? [];
    const legacyParkingCondition = activeTerms?.parking_location_details?.trim();
    const combinedAdditionalConditions = [
      ...loadedAdditionalConditions,
      ...(legacyParkingCondition && !loadedAdditionalConditions.some((condition) => condition.toLowerCase() === legacyParkingCondition.toLowerCase()) ? [legacyParkingCondition] : []),
    ];

    setContractPrice(activeTerms?.contract_price?.toString() ?? activeTerms?.list_price_at_offer?.toString() ?? "");
    setReservationFee(activeTerms?.reservation_fee?.toString() ?? selectedBuildingDefault?.reservation_fee?.toString() ?? "");
    setReservationFeeHolder(activeTerms?.reservation_fee_holder ?? selectedBuildingDefault?.reservation_fee_holder_default ?? "sales_agent");
    setParkingValue(activeTerms?.parking_value?.toString() ?? "");
    setDeveloperContribution((activeTerms?.developer_contribution_value ?? activeTerms?.developer_contribution)?.toString() ?? "");
    setDeveloperContributionValueType(activeTerms?.developer_contribution_value_type ?? "amount");
    setAgentContribution((activeTerms?.agent_contribution_value ?? activeTerms?.agent_contribution)?.toString() ?? "");
    setAgentContributionValueType(activeTerms?.agent_contribution_value_type ?? "amount");
    setParkingLocationDetails("");
    setAdditionalSpecialConditions(combinedAdditionalConditions);
    setAgentFeePercent(activeTerms?.agent_fee_percent?.toString() ?? selectedBuildingDefault?.default_agent_fee_percent?.toString() ?? "");
    setExchangeAgentFeePercent(activeTerms?.exchange_agent_fee_percent?.toString() ?? selectedBuildingDefault?.default_exchange_agent_fee_percent?.toString() ?? activeTerms?.agent_fee_percent?.toString() ?? selectedBuildingDefault?.default_agent_fee_percent?.toString() ?? "");
    setCompletionAgentFeePercent(activeTerms?.completion_agent_fee_percent?.toString() ?? selectedBuildingDefault?.default_completion_agent_fee_percent?.toString() ?? "0");
    setSolicitorFee(activeTerms?.solicitor_fee?.toString() ?? selectedBuildingDefault?.default_sales_solicitor_fee?.toString() ?? "882");
    setExchangeDepositPercent(activeTerms?.exchange_deposit_percent?.toString() ?? selectedBuildingDefault?.exchange_deposit_percent?.toString() ?? "10");
    setSecondDepositEnabled(Boolean(activeTerms?.second_deposit_enabled ?? selectedBuildingDefault?.second_deposit_enabled));
    setSecondDepositPercent(activeTerms?.second_deposit_percent?.toString() ?? selectedBuildingDefault?.second_deposit_percent?.toString() ?? "");
    setSecondDepositMonthsAfterExchange(activeTerms?.second_deposit_months_after_exchange?.toString() ?? selectedBuildingDefault?.second_deposit_months_after_exchange?.toString() ?? "");
    setDepositSummary(activeTerms?.deposit_summary ?? paymentScheduleSummary({
      exchangeDepositPercent: activeTerms?.exchange_deposit_percent ?? selectedBuildingDefault?.exchange_deposit_percent ?? 10,
      secondDepositEnabled: activeTerms?.second_deposit_enabled ?? selectedBuildingDefault?.second_deposit_enabled ?? false,
      secondDepositPercent: activeTerms?.second_deposit_percent ?? selectedBuildingDefault?.second_deposit_percent ?? 0,
      secondDepositMonthsAfterExchange: activeTerms?.second_deposit_months_after_exchange ?? selectedBuildingDefault?.second_deposit_months_after_exchange ?? null,
    }));
    setCommercialSummary(activeTerms?.commercial_summary ?? "");
    setInvoiceReference(activeInvoice?.invoice_reference ?? "");
    setInvoiceDate(activeInvoice?.invoice_date ?? "");
    setInvoiceNetAmount(activeInvoice?.net_amount?.toString() ?? "");
    setInvoiceVatAmount(activeInvoice?.vat_amount?.toString() ?? "");
    setInvoiceGrossAmount(activeInvoice?.gross_amount?.toString() ?? "");
  }

  function cancelCommercialModel() {
    resetCommercialModelDraft();
    setShowCommercialModel(false);
    setShowAdvancedDealSetup(false);
  }

  function toggleCommercialModel() {
    const next = !showCommercialModel;
    if (!next) {
      cancelCommercialModel();
      return;
    }
    setShowCommercialModel(next);
    window.requestAnimationFrame(() => {
      commercialModelControlRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  async function authHeaders() {
    const supabase = createSupabaseBrowserClient();
    const { data } = await supabase.auth.getSession();
    return { Authorization: `Bearer ${data.session?.access_token ?? ""}` };
  }

  async function readApiPayload<T extends { error?: string }>(response: Response, fallback: string) {
    const text = await response.text();
    if (!text.trim()) return {} as T;

    try {
      return JSON.parse(text) as T;
    } catch {
      const trimmed = text.trim();
      const readableText = trimmed.startsWith("<") ? "" : trimmed.slice(0, 240);
      const suffix = readableText || `The server returned a ${response.status || "non-JSON"} response instead of JSON.`;
      throw new Error(`${fallback} ${suffix}`);
    }
  }

  async function postReservationJson(body: Record<string, unknown>) {
    const response = await fetch("/api/sales/reservations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(await authHeaders()),
      },
      body: JSON.stringify(body),
    });
    const action = typeof body.action === "string" ? body.action : "";
    const fallback = action === "save_commercial_model" || action === "save_commercial_package"
      ? "Commercial model could not be saved."
      : action === "return_unit_for_sale"
        ? "The reservation attempt could not be cancelled."
      : "Reservation could not be completed.";
    const payload = await readApiPayload<{ error?: string; saleAttemptId?: string; voided?: boolean; paymentStatus?: string }>(response, fallback);
    if (!response.ok) throw new Error(payload.error ?? fallback);
    return payload;
  }

  async function uploadReservationForm(saleAttemptId: string) {
    if (!reservationFormFile) return;
    const formData = new FormData();
    formData.set("saleAttemptId", saleAttemptId);
    formData.set("file", reservationFormFile);
    const response = await fetch("/api/sales/reservations", {
      method: "POST",
      headers: await authHeaders(),
      body: formData,
    });
    const payload = await readApiPayload<{ error?: string }>(response, "Reservation form upload failed.");
    if (!response.ok) throw new Error(payload.error ?? "Reservation form upload failed.");
  }

  async function openDocumentVersion(version?: SaleDocumentVersion | null) {
    if (!version) return;
    try {
      const params = new URLSearchParams({ versionId: version.id });
      const response = await fetch(`/api/sales/reservations?${params.toString()}`, {
        headers: await authHeaders(),
      });
      const payload = await readApiPayload<{ error?: string; signedUrl?: string }>(response, "Document link could not be created.");
      if (!response.ok || !payload.signedUrl) throw new Error(payload.error ?? "Document link could not be created.");
      window.open(payload.signedUrl, "_blank", "noopener,noreferrer");
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Document could not be opened.");
    }
  }

  async function saveReservation() {
    if (!selectedUnit) return;
    if (!buyerPersonName.trim() && !buyerCompanyName.trim()) {
      onNotice("Enter a personal buyer name, company name, or both before saving the reservation.");
      return;
    }
    if (!buyerEmail.trim() || !buyerPhone.trim() || !buyerSolicitorName.trim()) {
      onNotice("Enter the buyer email, phone and solicitor before submitting the reservation.");
      return;
    }
    if (!reservationDate) {
      onNotice("Enter the reservation date shown on the signed reservation form.");
      return;
    }
    if (reservationDate > todayDate) {
      onNotice("Reservation date cannot be in the future.");
      return;
    }
    if (!reservationTermsChecked) {
      onNotice("Confirm that the reservation form reflects the developer-approved commercial terms.");
      return;
    }
    if (!reservationFormFile && !visibleReservationVersion) {
      onNotice("Upload the reservation form PDF before submitting the reservation.");
      return;
    }

    setIsSaving(true);
    try {
      if (activeAttempt?.id && reservationFormFile) {
        await uploadReservationForm(activeAttempt.id);
      }
      const payload = await postReservationJson({
        action: "save_reservation",
        unitId: selectedUnit.id,
        buyerPersonName,
        buyerCompanyName,
        buyerEmail,
        buyerPhone,
        buyerSolicitorName,
        reservationDate,
        reservationTermsChecked,
      });
      if (!activeAttempt?.id && payload.saleAttemptId) await uploadReservationForm(payload.saleAttemptId);
      onNotice(reservationState === "rejected" ? `Reservation resubmitted for Unit ${selectedUnit.unit_number}.` : `Reservation submitted for Unit ${selectedUnit.unit_number}.`);
      setReservationDocumentRemoved(false);
      setReservationDocumentHistoryUnlocked(false);
      await Promise.all([loadSalesData(), reloadPortalData()]);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Reservation could not be saved.");
    } finally {
      setIsSaving(false);
    }
  }

  async function approveReservation() {
    if (!activeAttempt || !selectedUnit) return;
    setIsSaving(true);
    try {
      await postReservationJson({ action: "approve_reservation", saleAttemptId: activeAttempt.id, reservationDate: formalReservationDate });
      manuallySelectedWorkflowStageRef.current = "reservation";
      setActiveWorkflowStage("reservation");
      onNotice(`Reservation approved. Unit ${selectedUnit.unit_number} marked Reserved.`);
      await Promise.all([loadSalesData(), reloadPortalData()]);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Reservation could not be approved.");
    } finally {
      setIsSaving(false);
    }
  }

  async function rejectReservation() {
    if (!activeAttempt || !selectedUnit) return;
    if (!rejectionReason.trim()) {
      onNotice("Add a rejection reason.");
      return;
    }
    setIsSaving(true);
    try {
      await postReservationJson({ action: "reject_reservation", saleAttemptId: activeAttempt.id, rejectionReason });
      onNotice(`Reservation rejected. Unit ${selectedUnit.unit_number} remains For Sale.`);
      setShowRejectReservationConfirm(false);
      setRejectionReason("");
      setReservationTermsChecked(false);
      await Promise.all([loadSalesData(), reloadPortalData()]);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Reservation could not be rejected.");
    } finally {
      setIsSaving(false);
    }
  }

  async function uploadAgentInvoice(milestone: AgentFeeMilestone = "exchange") {
    if (!activeAttempt) {
      onNotice("Create and approve a reservation before uploading the sales agent invoice.");
      return;
    }
    const milestoneLabel = milestone === "completion" ? "Completion" : "Exchange";
    const file = milestone === "completion" ? completionAgentInvoiceFile : agentInvoiceFile;
    const reference = milestone === "completion" ? completionInvoiceReference : invoiceReference;
    const date = milestone === "completion" ? completionInvoiceDate : invoiceDate;
    const grossAmount = milestone === "completion" ? completionInvoiceGrossAmount : invoiceGrossAmount;
    if (!file) {
      onNotice(`Choose the ${milestoneLabel} agent invoice PDF before submitting.`);
      return;
    }
    if (!reference.trim() || !date || (parseGbpInput(grossAmount) ?? 0) <= 0) {
      onNotice("Enter the invoice reference, invoice date and total before uploading.");
      return;
    }

    setIsSaving(true);
    try {
      const formData = new FormData();
      formData.set("action", "upload_agent_invoice");
      formData.set("saleAttemptId", activeAttempt.id);
      formData.set("feeMilestone", milestone);
      formData.set("file", file);
      formData.set("invoiceReference", reference.trim());
      formData.set("invoiceDate", date);
      formData.set("invoiceGrossAmount", grossAmount);
      const response = await fetch("/api/sales/reservations", {
        method: "POST",
        headers: await authHeaders(),
        body: formData,
      });
      const payload = await readApiPayload<{ error?: string }>(response, "Sales agent invoice upload failed.");
      if (!response.ok) throw new Error(payload.error ?? "Sales agent invoice upload failed.");
      onNotice(`${milestoneLabel} agent invoice submitted.`);
      if (milestone === "completion") setCompletionAgentInvoiceFile(null);
      else setAgentInvoiceFile(null);
      await Promise.all([loadSalesData(), reloadPortalData()]);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Sales agent invoice could not be uploaded.");
    } finally {
      setIsSaving(false);
    }
  }

  async function saveCommercialPackage() {
    if (!selectedUnit) return;
    if (!previewDepositStructure.isValid) {
      onNotice(previewDepositStructure.error ?? "Payment schedule is invalid.");
      return;
    }
    if (!previewAgentFeeStructure.isValid) {
      onNotice(previewAgentFeeStructure.error ?? "Agent fee structure is invalid.");
      return;
    }
    setIsSaving(true);
    try {
      const payload: Record<string, unknown> = {
        action: "save_commercial_model",
        unitId: selectedUnit.id,
        saleAttemptId: activeAttempt?.id,
        contractPrice,
        parkingValue,
        developerContribution,
        developerContributionValueType,
        agentContribution,
        agentContributionValueType,
        parkingLocationDetails,
        additionalSpecialConditions: additionalSpecialConditions.map((condition) => condition.trim()).filter(Boolean),
        commercialSummary,
        invoiceReference,
        invoiceDate,
        invoiceNetAmount,
        invoiceVatAmount,
        invoiceGrossAmount,
      };
      if (showAdvancedDealSetup || commercialSetupChanged) {
        Object.assign(payload, {
          reservationFee,
          reservationFeeHolder,
          agentFeePercent: previewAgentFeePercent,
          exchangeAgentFeePercent: previewExchangeAgentFeePercent,
          completionAgentFeePercent: previewCompletionAgentFeePercent,
          solicitorFee,
          exchangeDepositPercent,
          secondDepositEnabled,
          secondDepositPercent,
          secondDepositMonthsAfterExchange,
          depositSummary,
        });
      }
      await postReservationJson(payload);
      onNotice("Commercial package saved.");
      setShowCommercialModel(false);
      setShowAdvancedDealSetup(false);
      await Promise.all([loadSalesData(), reloadPortalData()]);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Commercial package could not be saved.");
    } finally {
      setIsSaving(false);
    }
  }

  async function approveCommercialPackage() {
    if (!activeAttempt || !selectedUnit) return;
    setIsSaving(true);
    try {
      await postReservationJson({ action: "approve_commercial_package", saleAttemptId: activeAttempt.id });
      onNotice(`Commercial package approved. Unit ${selectedUnit.unit_number} is Ready for Exchange.`);
      await Promise.all([loadSalesData(), reloadPortalData()]);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Commercial package could not be approved.");
    } finally {
      setIsSaving(false);
    }
  }

  async function returnUnitToForSale() {
    if (!activeAttempt || !selectedUnit || !canReturnToForSale) return;
    if (!returnToForSaleReason.trim()) {
      onNotice("Add a reason for cancelling the reservation attempt.");
      return;
    }
    setIsSaving(true);
    try {
      await postReservationJson({
        action: "return_unit_for_sale",
        saleAttemptId: activeAttempt.id,
        returnReason: returnToForSaleReason,
      });
      onNotice(`Reservation attempt cancelled. Unit ${selectedUnit.unit_number} returned to For sale, with the previous attempt retained in Reservation history.`);
      setShowReturnToForSaleConfirm(false);
      setReturnToForSaleReason("");
      manuallySelectedWorkflowStageRef.current = "reservation";
      setActiveWorkflowStage("reservation");
      await Promise.all([loadSalesData(), reloadPortalData()]);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "The reservation attempt could not be cancelled.");
    } finally {
      setIsSaving(false);
    }
  }

  async function approveAgentInvoice(milestone: AgentFeeMilestone) {
    if (!activeAttempt || !selectedUnit) return;
    const milestoneLabel = milestone === "completion" ? "Completion" : "Exchange";
    setIsSaving(true);
    try {
      await postReservationJson({ action: "approve_agent_invoice", saleAttemptId: activeAttempt.id, invoiceMilestone: milestone });
      onNotice(`${milestoneLabel} agent invoice approved for Unit ${selectedUnit.unit_number}.`);
      await Promise.all([loadSalesData(), reloadPortalData()]);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : `${milestoneLabel} agent invoice could not be approved.`);
    } finally {
      setIsSaving(false);
    }
  }

  async function rejectAgentInvoice(milestone: AgentFeeMilestone = "exchange") {
    const reason = milestone === "completion" ? completionInvoiceRejectionReason : invoiceRejectionReason;
    if (!activeAttempt || !selectedUnit || !reason.trim()) return;
    const milestoneLabel = milestone === "completion" ? "Completion" : "Exchange";
    setIsSaving(true);
    try {
      await postReservationJson({
        action: "reject_agent_invoice",
        saleAttemptId: activeAttempt.id,
        invoiceMilestone: milestone,
        invoiceRejectionReason: reason.trim(),
      });
      onNotice(`${milestoneLabel} agent invoice rejected for Unit ${selectedUnit.unit_number}. A corrected invoice is required.`);
      if (milestone === "completion") {
        setShowRejectCompletionInvoiceConfirm(false);
        setCompletionInvoiceRejectionReason("");
      } else {
        setShowRejectInvoiceConfirm(false);
        setInvoiceRejectionReason("");
      }
      await Promise.all([loadSalesData(), reloadPortalData()]);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Sales agent invoice could not be rejected.");
    } finally {
      setIsSaving(false);
    }
  }

  async function recordExchange() {
    if (!activeAttempt || !selectedUnit) return;
    if (!exchangeDate) {
      onNotice("Enter the actual exchange date.");
      return;
    }
    if (!exchangeDepositConfirmed) {
      onNotice("Confirm that the exchange deposit has been received.");
      return;
    }

    setIsSaving(true);
    try {
      await postReservationJson({ action: "record_exchange", saleAttemptId: activeAttempt.id, exchangeDate, exchangeDepositConfirmed });
      manuallySelectedWorkflowStageRef.current = "exchange";
      setActiveWorkflowStage("exchange");
      onNotice(`Exchange recorded. Unit ${selectedUnit.unit_number} marked Exchanged.`);
      await Promise.all([loadSalesData(), reloadPortalData()]);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Exchange could not be recorded.");
    } finally {
      setIsSaving(false);
    }
  }

  async function recordAgentFeePayment(milestone: AgentFeeMilestone = "exchange") {
    const invoice = milestone === "completion" ? completionAgentInvoice : activeInvoice;
    const amountValue = milestone === "completion" ? completionPaymentAmount : solicitorPaymentAmount;
    const dateValue = milestone === "completion" ? completionPaymentDate : solicitorPaymentDate;
    const position = milestone === "completion" ? completionInvoicePaymentPosition : invoicePaymentPosition;
    const submissionRef = milestone === "completion" ? completionPaymentSubmissionInFlightRef : paymentSubmissionInFlightRef;
    const clientReferenceRef = milestone === "completion" ? completionPaymentClientReferenceRef : paymentClientReferenceRef;
    if (!activeAttempt || !invoice || !selectedUnit || submissionRef.current) return false;
    const paymentAmount = parseGbpInput(amountValue);
    if (paymentAmount === null || paymentAmount <= 0 || !dateValue) {
      onNotice("Enter the amount paid and payment date.");
      return false;
    }
    if (dateValue > todayDate) {
      onNotice("Payment date cannot be in the future.");
      return false;
    }
    if (paymentAmount > position.outstandingBalance) {
      onNotice(`Payment cannot exceed the ${money(position.outstandingBalance)} outstanding balance.`);
      return false;
    }
    submissionRef.current = true;
    clientReferenceRef.current ??= crypto.randomUUID();
    setIsSaving(true);
    try {
      await postReservationJson({
        action: "record_agent_fee_payment",
        invoiceId: invoice.id,
        paymentAmount: amountValue,
        paymentDate: dateValue,
        paymentClientReference: clientReferenceRef.current,
      });
      onNotice(`${milestone === "completion" ? "Completion" : "Exchange"} invoice payment recorded for Unit ${selectedUnit.unit_number}.`);
      if (milestone === "completion") {
        setCompletionPaymentAmount("");
        setCompletionPaymentDate("");
      } else {
        setSolicitorPaymentAmount("");
        setSolicitorPaymentDate("");
      }
      clientReferenceRef.current = null;
      await Promise.all([loadSalesData(), reloadPortalData()]);
      return true;
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Invoice payment could not be saved.");
      return false;
    } finally {
      submissionRef.current = false;
      setIsSaving(false);
    }
  }

  function requestVoidAgentFeePayment(payment: SaleInvoicePayment) {
    if (!canVoidAgentFeePayment || payment.voided_at || payment.payment_source === "reservation_fee") return;
    setPaymentToVoid(payment);
    setPaymentVoidReason("");
    requestPaymentVoidPanel({ focus: () => paymentVoidReasonInputRef.current });
  }

  async function voidAgentFeePayment() {
    if (!paymentToVoid || voidPaymentSubmissionInFlightRef.current) return;
    const reason = paymentVoidReason.trim();
    if (!reason) {
      onNotice("Add a reason for voiding the payment.");
      paymentVoidReasonInputRef.current?.focus();
      return;
    }

    voidPaymentSubmissionInFlightRef.current = true;
    setIsSaving(true);
    try {
      const result = await postReservationJson({
        action: "void_agent_fee_payment",
        paymentId: paymentToVoid.id,
        paymentVoidReason: reason,
      });
      onNotice(result.voided
        ? `${money(paymentToVoid.amount)} payment voided. Record the corrected payment when ready.`
        : "This payment was already voided. The latest invoice position has been loaded.");
      setPaymentToVoid(null);
      setPaymentVoidReason("");
      await Promise.all([loadSalesData(), reloadPortalData()]);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Payment could not be voided.");
    } finally {
      voidPaymentSubmissionInFlightRef.current = false;
      setIsSaving(false);
    }
  }

  async function uploadCompletionDocument(documentType: "completion_statement" | "statement_of_account") {
    if (!activeAttempt) return;
    const file = documentType === "completion_statement" ? completionStatementFile : statementOfAccountFile;
    if (!file) {
      onNotice(documentType === "completion_statement" ? "Choose the completion statement PDF before uploading." : "Choose the statement of account PDF before uploading.");
      return;
    }

    setIsSaving(true);
    try {
      const formData = new FormData();
      formData.set("action", "upload_completion_document");
      formData.set("saleAttemptId", activeAttempt.id);
      formData.set("documentType", documentType);
      formData.set("file", file);
      const response = await fetch("/api/sales/reservations", {
        method: "POST",
        headers: await authHeaders(),
        body: formData,
      });
      const payload = await readApiPayload<{ error?: string }>(response, "Completion document upload failed.");
      if (!response.ok) throw new Error(payload.error ?? "Completion document upload failed.");
      onNotice(documentType === "completion_statement" ? "Completion statement uploaded." : "Statement of account uploaded.");
      await Promise.all([loadSalesData(), reloadPortalData()]);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Completion document could not be uploaded.");
    } finally {
      setIsSaving(false);
    }
  }

  async function approveCompletionDocuments() {
    if (!activeAttempt || completionDocumentsApproved || !completionDocumentState.canReview || completionReviewSubmissionInFlightRef.current) return;
    completionReviewSubmissionInFlightRef.current = true;
    setIsSaving(true);
    try {
      await postReservationJson({ action: "approve_completion_documents", saleAttemptId: activeAttempt.id });
      onNotice("Completion documents approved.");
      await Promise.all([loadSalesData(), reloadPortalData()]);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Completion documents could not be approved.");
    } finally {
      completionReviewSubmissionInFlightRef.current = false;
      setIsSaving(false);
    }
  }

  async function queryCompletionDocuments() {
    if (!activeAttempt) return;
    setIsSaving(true);
    try {
      await postReservationJson({ action: "query_completion_documents", saleAttemptId: activeAttempt.id, completionQueryNote });
      onNotice("Completion document query raised.");
      await Promise.all([loadSalesData(), reloadPortalData()]);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Completion documents could not be queried.");
    } finally {
      setIsSaving(false);
    }
  }

  async function recordCompletion() {
    if (!activeAttempt || !selectedUnit || completionRecorded || !completionReady || completionRecordSubmissionInFlightRef.current) return;
    if (!completionDate) {
      onNotice("Enter the actual completion date.");
      return;
    }

    completionRecordSubmissionInFlightRef.current = true;
    setIsSaving(true);
    try {
      await postReservationJson({ action: "record_completion", saleAttemptId: activeAttempt.id, completionDate });
      onNotice(`Completion recorded. Unit ${selectedUnit.unit_number} marked Completed.`);
      await Promise.all([loadSalesData(), reloadPortalData()]);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Completion could not be recorded.");
    } finally {
      completionRecordSubmissionInFlightRef.current = false;
      setIsSaving(false);
    }
  }

  if (!selectedSaleUnitId) {
    if (activeSalesView === "agent_fees" && canViewAgentFeesPortfolio) {
      return (
        <div className="grid gap-5">
          <section className="panel">
            <h2 className="text-2xl font-bold text-[#0F3D2E]">Sales</h2>
            <p className="mt-1 text-sm text-[#617169]">Portfolio sales operations and unit-level workspaces.</p>
            <SalesViewTabs activeView={activeSalesView} canViewAgentFees={canViewAgentFeesPortfolio} onChange={changeSalesView} />
          </section>
          <AgentFeesPortfolio
            requesterId={profile?.id ?? user.id}
            buildingContextId={buildingId}
            buildingContextName={scopeBuilding?.name ?? "Selected building"}
            onOpenSale={(nextUnitId, nextBuildingId) => openSaleFile(nextUnitId, nextBuildingId, true)}
          />
        </div>
      );
    }

    return (
      <div className="grid gap-5">
        <section className="panel">
          <div>
            <div>
              <h2 className="text-2xl font-bold text-[#0F3D2E]">Sales</h2>
              <p className="mt-1 flex flex-wrap items-center gap-x-2 text-sm text-[#617169]">
                <strong className="font-semibold text-[#34413a]">{scopeBuilding?.name ?? "All buildings"}</strong>
                <span aria-hidden="true">·</span>
                <span>{buildingUnits.length} {buildingUnits.length === 1 ? "unit" : "units"} in the sales route</span>
              </p>
            </div>
          </div>
          <SalesViewTabs activeView={activeSalesView} canViewAgentFees={canViewAgentFeesPortfolio} onChange={changeSalesView} />
        </section>

        <section className={`panel ${styles.financialOverview}`}>
          <div>
            <h3 className="text-xl font-bold text-[#0F3D2E]">Financial overview</h3>
            <p className="mt-1 text-sm text-[#617169]">Forecast sales position for units currently in the sales route.</p>
          </div>
          <div className={`mt-5 grid gap-4 ${styles.financialOverviewGrid}`}>
            <div className={`rounded-bw-card border border-[#d9ded6] bg-[#fbfcfa] p-4 ${styles.financialOverviewCard}`}>
              <h4 className="font-bold text-[#0F3D2E]">Revenue view</h4>
              <p className="mt-1 text-sm text-[#617169]">Sales-route list-price baseline compared with the current forecast.</p>
              <div className="mt-4 grid gap-2 text-sm text-[#34413a]">
                <div className="flex justify-between gap-4 border-b border-[#eef0eb] pb-2"><span>Baseline GDV</span><strong className="numeric-value text-right">{money(baselineGdv)}</strong></div>
                <div className="flex justify-between gap-4 border-b border-[#eef0eb] pb-2"><span>Forecast revenue</span><strong className="numeric-value text-right text-[#0F3D2E]">{money(forecastRevenue)}</strong></div>
                <div className="flex justify-between gap-4"><span>Variance</span><strong className="numeric-value text-right">{money(forecastRevenue - baselineGdv)}</strong></div>
              </div>
            </div>
            <div className={`rounded-bw-card border border-[#d9ded6] bg-[#fbfcfa] p-4 ${styles.financialOverviewCard}`}>
              <h4 className="font-bold text-[#0F3D2E]">Cost / debt view</h4>
              <p className="mt-1 text-sm text-[#617169]">Core assumptions will be set in forecasting.</p>
              <div className="mt-4 grid gap-2 text-sm text-[#34413a]">
                <div className="flex justify-between gap-4 border-b border-[#eef0eb] pb-2"><span>Total development cost</span><strong className="numeric-value text-right">-</strong></div>
                <div className="flex justify-between gap-4 border-b border-[#eef0eb] pb-2"><span>Total debt</span><strong className="numeric-value text-right">-</strong></div>
                <div className="flex justify-between gap-4"><span>Net sales proceeds</span><strong className="numeric-value text-right text-[#0F3D2E]">{money(netSalesProceeds)}</strong></div>
              </div>
            </div>
            <div className={`rounded-bw-card border border-[#d9ded6] bg-[#fbfcfa] p-4 ${styles.financialOverviewCard} ${styles.profitCard}`}>
              <h4 className="font-bold text-[#0F3D2E]">Profit view</h4>
              <p className="mt-1 text-sm text-[#617169]">Profitability will appear once scheme costs and debt have been added.</p>
              <div className="mt-4 grid gap-2 text-sm text-[#34413a]">
                <div className="flex justify-between gap-4 border-b border-[#eef0eb] pb-2"><span>Forecast profit</span><strong className="numeric-value text-right text-[#829188]">—</strong></div>
                <div className="flex justify-between gap-4 border-b border-[#eef0eb] pb-2"><span>Profit margin</span><strong className="numeric-value text-right text-[#829188]">—</strong></div>
                <div className="flex justify-between gap-4 border-b border-[#eef0eb] pb-2"><span>Return on cost</span><strong className="numeric-value text-right text-[#829188]">—</strong></div>
                <div className="flex justify-between gap-4"><span>Units with sale values</span><strong className="numeric-value text-right">{saleValuesCount} of {buildingUnits.length}</strong></div>
              </div>
            </div>
          </div>
        </section>

        <section className="panel">
          <div>
            <h3 className="text-xl font-bold text-[#0F3D2E]">Sales pipeline</h3>
            <p className="mt-1 text-sm text-[#617169]">Click a stage to filter the sales table.</p>
          </div>
          <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            {pipelineSummary.map((stage) => (
              <button
                key={stage.status}
                className={`rounded-bw-card border p-4 text-left transition ${salesStageFilter === stage.status ? "border-[#0F3D2E] bg-[#fbfcfa] shadow-sm" : "border-[#d9ded6] bg-[#fbfcfa] hover:border-[#0F3D2E]"}`}
                onClick={() => {
                  setSalesStageFilter(stage.status);
                  writeSalesUrl({ building: buildingId, unit: null, filter: stage.status });
                }}
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="font-bold text-[#0F3D2E]">{stage.label}</span>
                  <span className="text-[#617169]">&gt;</span>
                </div>
                <p className="numeric-value mt-2 text-3xl font-bold text-[#0F3D2E]">{stage.count}</p>
                <p className="numeric-value mt-1 text-sm text-[#617169]">{money(stage.value)}</p>
              </button>
            ))}
          </div>
        </section>

        <section className="panel">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h3 className="text-xl font-bold text-[#0F3D2E]">Sales results</h3>
              <p className="mt-1 text-sm text-[#617169]">{filteredSalesUnits.length} units shown</p>
              <div className="mt-4 flex flex-wrap gap-2">
                {SALES_STAGE_FILTERS.map((filter) => (
                  <button
                    key={filter.value}
                    className={salesStageFilter === filter.value ? "primary" : "secondary"}
                    onClick={() => {
                      setSalesStageFilter(filter.value);
                      writeSalesUrl({ building: buildingId, unit: null, filter: filter.value === "all" ? null : filter.value });
                    }}
                  >
                    {filter.label}
                  </button>
                ))}
              </div>
            </div>
            <label className="field-label lg:w-[320px]">
              Search
              <input className="field" value={salesSearch} onChange={(event) => setSalesSearch(event.target.value)} placeholder={buildingId ? "Unit number" : "Unit or building"} />
            </label>
          </div>

          <SalesTableScroll label="Sales results" className="mt-5 rounded-bw-panel border border-[#d9ded6]">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-[#fbfcfa] text-xs uppercase text-[#617169]">
                <tr>
                  <th className="border-b border-[#d9ded6] px-4 py-3">Unit</th>
                  {!buildingId && <th className="border-b border-[#d9ded6] px-4 py-3">Building</th>}
                  <th className="border-b border-[#d9ded6] px-4 py-3">Stage</th>
                  <th className="border-b border-[#d9ded6] px-4 py-3 text-right">Price</th>
                  <th className="border-b border-[#d9ded6] px-4 py-3">Next action</th>
                  <th className="border-b border-[#d9ded6] px-4 py-3">Time in stage</th>
                </tr>
              </thead>
              <tbody>
                {pagedSalesUnits.length === 0 ? (
                  <tr>
                    <td className="px-4 py-6 text-center text-[#617169]" colSpan={buildingId ? 5 : 6}>No units match this view.</td>
                  </tr>
                ) : pagedSalesUnits.map((unit) => {
                  const attempt = activeAttemptByUnit.get(unit.id);
                  const stageTone = saleStatusTone(unit.sale_status);
                  return (
                    <tr
                      key={unit.id}
                      className={`cursor-pointer transition-colors ${stageTone.row}`}
                      onClick={() => openSaleFile(unit.id)}
                    >
                      <td className="border-b border-[#eef0eb] px-4 py-3 font-bold text-[#0F3D2E]">Unit {unit.unit_number}
                        {attempt && (unreadComments[attempt.id] ?? 0) > 0 && <button className="ml-2 text-xs font-medium underline" aria-label={`Open ${unreadComments[attempt.id]} unread comments for Unit ${unit.unit_number}`} onClick={(event) => {
                          event.stopPropagation(); openSaleFile(unit.id); setConversationIntent("open"); setConversationTarget({ unit: unit.id, sale: attempt.id });
                        }}>Comments <UnreadBadge count={unreadComments[attempt.id]} /></button>}
                      </td>
                      {!buildingId && <td className="border-b border-[#eef0eb] px-4 py-3 text-[#34413a]">{buildings.find((building) => building.id === unit.building_id)?.name ?? "Building"}</td>}
                      <td className="border-b border-[#eef0eb] px-4 py-3">
                        <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-bold ${stageTone.badge}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${stageTone.dot}`} aria-hidden="true" />
                          {saleStatusLabel(unit.sale_status)}
                        </span>
                      </td>
                      <td className="numeric-value border-b border-[#eef0eb] px-4 py-3 text-right">{money(unitSaleValue(unit))}</td>
                      <td className="border-b border-[#eef0eb] px-4 py-3 text-[#34413a]">{nextActionForUnit(unit)}</td>
                      <td className="border-b border-[#eef0eb] px-4 py-3 text-[#34413a]">{daysSince(saleStatusDate(unit, attempt))}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </SalesTableScroll>

          <div className="mt-4 flex flex-col gap-3 text-sm text-[#617169] sm:flex-row sm:items-center sm:justify-between">
            <span>Showing {filteredSalesUnits.length === 0 ? 0 : (currentSalesPage - 1) * SALES_PAGE_SIZE + 1}-{Math.min(currentSalesPage * SALES_PAGE_SIZE, filteredSalesUnits.length)} of {filteredSalesUnits.length}</span>
            <div className="flex justify-end gap-2">
              <button className="secondary" onClick={() => setSalesPage((page) => Math.max(1, page - 1))} disabled={currentSalesPage <= 1}>Previous</button>
              <button className="secondary" onClick={() => setSalesPage((page) => Math.min(salesPageCount, page + 1))} disabled={currentSalesPage >= salesPageCount}>Next</button>
            </div>
          </div>
        </section>

        <section className="panel">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-xl font-bold text-[#0F3D2E]">Forecasting</h3>
              <p className="mt-1 text-sm text-[#617169]">Building-level scenario modelling for sell, retain, rent and refinance assumptions.</p>
            </div>
            <button className="secondary" onClick={() => setShowForecasting((value) => !value)} disabled={!buildingId}>
              {showForecasting ? "Hide forecasting" : "Open forecasting"}
            </button>
          </div>
          {!buildingId && <p className="mt-3 rounded-bw-card border border-[#d9ded6] bg-[#fbfcfa] p-3 text-sm text-[#617169]">Select a building in the app header to use building-level forecasting.</p>}
          {showForecasting && buildingId && (
            <div className="mt-5">
              <SalesForecastingModule
                user={user}
                profile={profile}
                buildings={buildings}
                units={units}
                onNotice={onNotice}
                initialBuildingId={buildingId}
                hideBuildingSelector
              />
            </div>
          )}
        </section>
      </div>
    );
  }

  return (
    <div data-sale-file className="grid min-w-0 grid-cols-1 gap-5">
      <section className="panel">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <button className="secondary w-fit" onClick={backToSalesOverview}>
            &lt; Back to sales overview
          </button>
          <SaleMentionsInbox />
          <div className="grid gap-3 sm:grid-cols-2 lg:w-[520px]">
            <label className="field-label">
              Search sales
              <input
                className="field"
                value={salesSearch}
                onChange={(event) => setSalesSearch(event.target.value)}
                placeholder="Unit number"
              />
            </label>
            <label className="field-label">
              Open unit
              <select
                className="field"
                value={unitId}
                onChange={(event) => openSaleFile(event.target.value)}
                disabled={buildingUnits.length === 0}
              >
                {buildingUnits.length === 0 && <option value="">No units available</option>}
                {buildingUnits
                  .filter((unit) => !salesSearch.trim() || unit.unit_number.toLowerCase().includes(salesSearch.trim().toLowerCase()))
                  .map((unit) => <option key={unit.id} value={unit.id}>{!buildingId ? `${buildings.find((building) => building.id === unit.building_id)?.name ?? "Building"} · ` : ""}Unit {unit.unit_number} - {saleStatusLabel(unit.sale_status)}</option>)}
              </select>
            </label>
          </div>
        </div>
      </section>

      {selectedUnit && (
        <section className="panel min-w-0">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#D6A23A]">Selected sale file</p>
              <h3 className="mt-1 text-2xl font-bold text-[#0F3D2E]">Unit {selectedUnit.unit_number}</h3>
              <p className="text-sm text-[#617169]">{selectedBuilding?.name ?? "Building"} / {selectedUnit.floor ?? "No floor"}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button className="secondary" aria-controls="sale-conversation" aria-expanded={conversationOpen} onClick={() => setConversationIntent("open")}>Comments <UnreadBadge count={unreadComments[selectedConversationId ?? ""] ?? 0} /></button>
              <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold ${saleStatusTone(selectedUnit.sale_status).badge}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${saleStatusTone(selectedUnit.sale_status).dot}`} aria-hidden="true" />
                {saleStatusLabel(selectedUnit.sale_status)}
              </span>
            </div>
          </div>
          <SaleMetadataStrip items={[
            { label: "Contract price", value: money(selectedContractValue) },
            { label: "Buyer", value: buyerDisplay(activeAttempt) },
            { label: "Current stage", value: <>{currentLegalStage.label}{currentLegalStageDate ? ` · ${formatDate(currentLegalStageDate)}` : ""}</> },
          ]} />
          {buildingDefaultsDifferFromSnapshot && (
            <p className="mt-2 text-xs text-[#617169]">This sale uses the deal setup agreed at reservation. Building defaults may have changed since.</p>
          )}

          <SaleConversationLayout userId={user.id} unitId={selectedUnit.id}
            saleId={selectedConversationId} stageLinks={selectedConversationId === activeAttempt?.id}
            targetComment={conversationTarget?.unit === selectedUnit.id ? conversationTarget.comment : undefined}
            containerRef={conversationContainerRef} docked={conversationDocked} open={conversationOpen} onClose={() => setConversationIntent("closed")}
            unread={unreadComments[conversationTarget?.unit === selectedUnit.id && conversationTarget.sale ? conversationTarget.sale : activeAttempt?.id ?? ""] ?? 0}
            onStage={(stage) => {
              if (conversationTarget?.sale && conversationTarget.sale !== activeAttempt?.id) return;
              setActiveUnitSection("progression"); setActiveWorkflowStage(stage as SaleWorkflowStage);
              manuallySelectedWorkflowStageRef.current = stage as SaleWorkflowStage;
            }}>
          {conversationTarget?.sale && conversationTarget.sale !== activeAttempt?.id && <p className="mt-3 border-l-2 border-[#D6A23A] pl-3 text-sm">The conversation is for an earlier sale transaction. <button className="underline" onClick={() => setConversationTarget(null)}>Open current sale comments</button></p>}
          <SaleFileWorkspaceTabs activeWorkspace={activeUnitSection} onChange={changeUnitSection} />

          {activeUnitSection === "commercial" && (
          <div id="unit-sale-commercial" role="tabpanel" aria-labelledby="sale-file-tab-commercial" className={`min-w-0 rounded-b-bw-panel border border-t-0 border-[#d9ded6] bg-white p-4 sm:p-5 ${styles.commercialSummary}`}>
          <div className={styles.commercialCards} data-testid="commercial-summary-cards">
            <div className="rounded-bw-card border border-[#d9ded6] bg-[#fbfcfa] p-4">
              <h4 className="font-bold text-[#0F3D2E]">Developer</h4>
              <p className="mt-1 text-sm text-[#617169]">Sale value, development-side deductions and net proceeds.</p>
              <div className="mt-4 grid gap-2 text-sm text-[#34413a]">
                <div className="flex justify-between gap-4 border-b border-[#eef0eb] pb-2"><span>List price</span><strong className="numeric-value text-right">{money(activeTerms?.list_price_at_offer ?? selectedContractValue)}</strong></div>
                <div className="flex justify-between gap-4 border-b border-[#eef0eb] pb-2"><span>Contract price</span><strong className="numeric-value text-right">{money(selectedContractValue)}</strong></div>
                <div className="flex justify-between gap-4 border-b border-[#eef0eb] pb-2"><span>Parking value</span><strong className="numeric-value text-right">{money(activeTerms?.parking_value ?? 0)}</strong></div>
                <div className="flex justify-between gap-4 border-b border-[#eef0eb] pb-2"><span>Developer contribution</span><strong className="numeric-value text-right">{activeDeveloperContributionDeductionLabel}</strong></div>
                <div className="flex justify-between gap-4 border-b border-[#eef0eb] pb-2"><span>Solicitor fee</span><strong className="numeric-value text-right">{moneyDeduction(displaySolicitorFee)}</strong></div>
                <div className="flex justify-between gap-4 border-b border-[#eef0eb] pb-2"><span>Agent fee / invoice impact</span><strong className="numeric-value text-right">{moneyDeduction(selectedAgentInvoice.netAmount)}</strong></div>
                <div className="flex justify-between gap-4"><span>Net developer proceeds</span><strong className="numeric-value text-right text-[#0F3D2E]">{money(selectedDeveloperNet)}</strong></div>
              </div>
            </div>
            <div className="rounded-bw-card border border-[#d9ded6] bg-[#fbfcfa] p-4">
              <h4 className="font-bold text-[#0F3D2E]">Agent</h4>
              <p className="mt-1 text-sm text-[#617169]">Forecast agent invoice after deductions.</p>
              <div className="mt-4 grid gap-2 text-sm text-[#34413a]">
                <div className="flex justify-between gap-4 border-b border-[#eef0eb] pb-2"><span>Total agent fee</span><strong className="numeric-value text-right">{formatPercentValue(displayAgentFeePercent)}</strong></div>
                <div className="flex justify-between gap-4 border-b border-[#eef0eb] pb-2"><span>Fee base</span><strong className="numeric-value text-right">{money(selectedContractValue)}</strong></div>
                <div className="flex justify-between gap-4 border-b border-[#eef0eb] pb-2"><span>Total net agent fee</span><strong className="numeric-value text-right">{money(selectedAgentInvoice.netAmount)}</strong></div>
                <div className="flex justify-between gap-4 border-b border-[#eef0eb] pb-2"><span>Exchange tranche</span><strong className="numeric-value text-right">{formatPercentValue(displayExchangeAgentFeePercent)}</strong></div>
                <div className="flex justify-between gap-4 border-b border-[#eef0eb] pb-2"><span>Completion tranche</span><strong className="numeric-value text-right">{formatPercentValue(displayCompletionAgentFeePercent)}</strong></div>
                <div className="flex justify-between gap-4"><span>Agent contribution</span><strong className="numeric-value text-right">{activeAgentContributionDeductionLabel}</strong></div>
              </div>
            </div>
            <div className="rounded-bw-card border border-[#d9ded6] bg-[#fbfcfa] p-4">
              <h4 className="font-bold text-[#0F3D2E]">Buyer</h4>
              <p className="mt-1 text-sm text-[#617169]">Payment schedule and buyer-facing contributions.</p>
              <div className="mt-4 grid gap-2 text-sm text-[#34413a]">
                <div className="flex justify-between gap-4 border-b border-[#eef0eb] pb-2"><span>Contract price</span><strong className="numeric-value text-right">{money(selectedContractValue)}</strong></div>
                <div className="flex justify-between gap-4 border-b border-[#eef0eb] pb-2"><span>Reservation fee</span><strong className="numeric-value text-right">{money(displayReservationFee)}</strong></div>
                <div className="flex justify-between gap-4 border-b border-[#eef0eb] pb-2"><span>Exchange deposit ({formatPercentValue(displayDepositStructure.exchangeDepositPercent)})</span><strong className="numeric-value text-right">{money(selectedExchangeDeposit)}</strong></div>
                {displayDepositStructure.secondDepositEnabled && (
                  <div className="flex justify-between gap-4 border-b border-[#eef0eb] pb-2"><span>Second deposit ({formatPercentValue(displayDepositStructure.secondDepositPercent)})</span><strong className="numeric-value text-right">{money(selectedSecondDeposit)}</strong></div>
                )}
                <div className="flex justify-between gap-4 border-b border-[#eef0eb] pb-2"><span>Completion balance ({formatPercentValue(displayDepositStructure.completionBalancePercent)})</span><strong className="numeric-value text-right">{money(selectedCompletionBalance)}</strong></div>
                <div className="flex justify-between gap-4 border-b border-[#eef0eb] pb-2"><span>Developer contribution / cashback</span><strong className="numeric-value text-right">{activeDeveloperContributionLabel}</strong></div>
                <div className="flex justify-between gap-4 border-b border-[#eef0eb] pb-2"><span>Agent contribution / cashback</span><strong className="numeric-value text-right">{activeAgentContributionLabel}</strong></div>
                {(activeTerms?.parking_contribution_value ?? 0) > 0 && <div className="flex justify-between gap-4 border-b border-[#eef0eb] pb-2"><span>Parking contribution</span><strong className="numeric-value text-right">{money(activeTerms?.parking_contribution_value ?? 0)}</strong></div>}
                {(activeTerms?.parking_value ?? 0) > 0 && <div className="flex justify-between gap-4 border-b border-[#eef0eb] pb-2"><span>Parking value</span><strong className="numeric-value text-right">{money(activeTerms?.parking_value ?? 0)}</strong></div>}
                <div className="flex justify-between gap-4"><span>Net cost to buyer</span><strong className="numeric-value text-right text-[#0F3D2E]">{money(selectedBuyerNetCost)}</strong></div>
              </div>
            </div>
          </div>

          {activeSpecialConditions.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-[#e7e1d5] bg-[#fbfcfa] px-3 py-2 text-xs text-[#617169]">
              <span className="font-bold uppercase tracking-[0.08em] text-[#0F3D2E]">Additional conditions</span>
              {activeSpecialConditions.map((condition, index) => (
                <span key={`${condition}-${index}`} className="rounded-full border border-[#d9ded6] bg-white px-2 py-1 font-semibold text-[#34413a]">{condition}</span>
              ))}
            </div>
          )}

          <div ref={commercialModelControlRef} className="mt-4 scroll-mt-4 flex flex-wrap items-center gap-2">
            {canManageCommercialTerms && (
              <button className="secondary" onClick={toggleCommercialModel} disabled={commercialModelLocked}>
                {showCommercialModel ? "Close commercial model" : "Edit commercial model"}
              </button>
            )}
          </div>

          {showCommercialModel && (
            <div className={`mt-5 border-t border-[#d9ded6] pt-5 ${styles.commercialEditor}`} data-testid="commercial-model-editor">
              <div className={styles.commercialEditorGrid}>
                <div className={styles.commercialInputs}>
                  <h4 className="font-bold text-[#0F3D2E]">Deal inputs</h4>
                  <p className="mt-1 text-sm text-[#617169]">Developer-only modelling before commercial approval.</p>
                  <div className="mt-4 grid gap-3">
                    <h5 className="text-sm font-bold text-[#0F3D2E]">Commercial model</h5>
                    <div className={styles.fieldRow}>
                      <label className={`field-label ${styles.numericField}`}>Proposed contract price<GbpInput value={contractPrice} onChange={setContractPrice} disabled={!commercialModelEditable} aria-label="Proposed contract price" /></label>
                      <label className={`field-label ${styles.numericField}`}>Parking value<GbpInput value={parkingValue} onChange={setParkingValue} disabled={!commercialModelEditable} aria-label="Parking value" /></label>
                    </div>
                    <div className="border-t border-[#eef0eb] pt-4">
                      <h5 className="text-sm font-bold text-[#0F3D2E]">Buyer incentives and special conditions</h5>
                      <div className={`mt-3 ${styles.fieldRow}`}>
                        <label className="field-label">
                          Developer contribution
                          <div className={styles.contributionInput}>
                            {developerContributionValueType === "percent" ? (
                              <input className="field" inputMode="decimal" value={developerContribution} onChange={(event) => setDeveloperContribution(event.target.value)} disabled={!commercialModelEditable} aria-label="Developer contribution percent" />
                            ) : (
                              <GbpInput value={developerContribution} onChange={setDeveloperContribution} disabled={!commercialModelEditable} aria-label="Developer contribution amount" />
                            )}
                            <select className="field" value={developerContributionValueType} onChange={(event) => setDeveloperContributionValueType(event.target.value as "amount" | "percent")} disabled={!commercialModelEditable} aria-label="Developer contribution value type">
                              <option value="amount">GBP</option>
                              <option value="percent">%</option>
                            </select>
                          </div>
                          {developerContributionValueType === "percent" && <span className="mt-1 text-xs text-[#617169]">Equivalent: {money(previewDeveloperContributionAmount)}</span>}
                        </label>
                        <label className="field-label">
                          Agent contribution
                          <div className={styles.contributionInput}>
                            {agentContributionValueType === "percent" ? (
                              <input className="field" inputMode="decimal" value={agentContribution} onChange={(event) => setAgentContribution(event.target.value)} disabled={!commercialModelEditable} aria-label="Agent contribution percent" />
                            ) : (
                              <GbpInput value={agentContribution} onChange={setAgentContribution} disabled={!commercialModelEditable} aria-label="Agent contribution amount" />
                            )}
                            <select className="field" value={agentContributionValueType} onChange={(event) => setAgentContributionValueType(event.target.value as "amount" | "percent")} disabled={!commercialModelEditable} aria-label="Agent contribution value type">
                              <option value="amount">GBP</option>
                              <option value="percent">%</option>
                            </select>
                          </div>
                          {agentContributionValueType === "percent" && <span className="mt-1 text-xs text-[#617169]">Equivalent: {money(previewAgentContribution)}</span>}
                        </label>
                      </div>
                      <div className="mt-3"><AdditionalConditionsEditor conditions={additionalSpecialConditions} onChange={setAdditionalSpecialConditions} disabled={!commercialModelEditable} /></div>
                    </div>
                    <div className="border-t border-[#eef0eb] pt-3">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <h5 className="text-sm font-bold text-[#0F3D2E]">Advanced deal setup</h5>
                          <p className="mt-1 text-xs text-[#617169]">These values normally come from the building defaults. Only change them for unit-specific exceptions.</p>
                        </div>
                        <button className="secondary" type="button" aria-expanded={showAdvancedDealSetup} aria-controls="commercial-advanced-setup" onClick={() => setShowAdvancedDealSetup((value) => !value)} disabled={!commercialModelEditable}>
                          {showAdvancedDealSetup ? "Hide setup" : "Edit deal setup"}
                        </button>
                      </div>
                    </div>
                    {!showAdvancedDealSetup ? (
                      <div className="text-sm text-[#34413a]">
                        <div className={styles.setupSummary}>
                          <div className="flex justify-between gap-3 border-b border-[#e8e5dc] pb-2"><span>Total agent fee</span><strong className="numeric-value">{formatPercentValue(previewAgentFeePercent, 4)}</strong></div>
                          <div className="flex justify-between gap-3 border-b border-[#e8e5dc] pb-2"><span>Exchange fee</span><strong className="numeric-value">{formatPercentValue(previewExchangeAgentFeePercent, 4)}</strong></div>
                          <div className="flex justify-between gap-3 border-b border-[#e8e5dc] pb-2"><span>Completion fee</span><strong className="numeric-value">{formatPercentValue(previewCompletionAgentFeePercent, 4)}</strong></div>
                          <div className="flex justify-between gap-3 border-b border-[#e8e5dc] pb-2"><span>Reservation fee</span><strong className="numeric-value">{money(previewReservationFee)}</strong></div>
                          <div className="flex justify-between gap-3 border-b border-[#e8e5dc] pb-2"><span>Exchange deposit</span><strong className="numeric-value">{formatPercentValue(previewDepositStructure.exchangeDepositPercent)}</strong></div>
                          {previewDepositStructure.secondDepositEnabled && <div className="flex justify-between gap-3 border-b border-[#e8e5dc] pb-2"><span>Second deposit</span><strong className="numeric-value">{formatPercentValue(previewDepositStructure.secondDepositPercent)}</strong></div>}
                          <div className="flex justify-between gap-3"><span>Completion balance</span><strong className="numeric-value">{formatPercentValue(previewDepositStructure.completionBalancePercent)}</strong></div>
                        </div>
                      </div>
                    ) : (
                      <div id="commercial-advanced-setup" className="grid gap-5" onChange={() => setCommercialSetupChanged(true)}>
                      <fieldset className="min-w-0">
                        <legend className="mb-3 text-sm font-bold text-[#0F3D2E]">Agent fees</legend>
                        <div className={styles.feeRow}>
                        <label className="field-label">Total agent fee %<input className="field" inputMode="decimal" value={agentFeePercent} onChange={(event) => setAgentFeePercent(event.target.value)} disabled={!commercialModelEditable} /></label>
                        <label className="field-label">Exchange fee %<input className="field" inputMode="decimal" value={exchangeAgentFeePercent} onChange={(event) => setExchangeAgentFeePercent(event.target.value)} disabled={!commercialModelEditable} /></label>
                        <label className="field-label">Completion fee %<input className="field" inputMode="decimal" value={completionAgentFeePercent} onChange={(event) => setCompletionAgentFeePercent(event.target.value)} disabled={!commercialModelEditable} /></label>
                        </div>
                        <div className={`mt-3 rounded-bw-inset px-3 py-2 text-sm ${previewAgentFeeStructure.isValid ? "bg-[#eaf6ee] text-[#18794e]" : "bg-[#fff8e7] text-[#7a5416]"}`} role="status" aria-live="polite" data-testid="agent-fee-validation">
                          {!invalidAgentFeeInput && <p className="numeric-value font-semibold">{formatPercentValue(previewExchangeAgentFeePercent, 4)} + {formatPercentValue(previewCompletionAgentFeePercent, 4)} = {formatPercentValue(previewAgentFeeSum, 4)}{previewAgentFeeStructure.isValid && <CheckCircle2 className="ml-2 inline-block" size={15} aria-label="Valid fee split" />}</p>}
                          {!previewAgentFeeStructure.isValid && <p>{invalidAgentFeeInput ? previewAgentFeeStructure.error : `Must equal total agent fee of ${formatPercentValue(previewAgentFeePercent, 4)}.`}</p>}
                        </div>
                      </fieldset>
                      <fieldset className="min-w-0 border-t border-[#eef0eb] pt-4">
                        <legend className="text-sm font-bold text-[#0F3D2E]">Reservation</legend>
                        <div className={styles.fieldRow}>
                        <label className="field-label">Reservation fee<GbpInput value={reservationFee} onChange={setReservationFee} disabled={!commercialModelEditable} aria-label="Reservation fee" /></label>
                        <label className="field-label">
                          Reservation fee holder
                          <select className="field" value={reservationFeeHolder} onChange={(event) => setReservationFeeHolder(event.target.value)} disabled={!commercialModelEditable}>
                            <option value="sales_agent">Sales agent</option>
                            <option value="developer">Developer</option>
                            <option value="conveyancer">Conveyancer</option>
                            <option value="other">Other</option>
                          </select>
                        </label>
                        </div>
                      </fieldset>
                      <fieldset className="min-w-0 border-t border-[#eef0eb] pt-4">
                        <legend className="text-sm font-bold text-[#0F3D2E]">Buyer payment schedule</legend>
                        <div className={styles.feeRow}>
                        <label className="field-label">Exchange deposit %<input className="field" inputMode="decimal" value={exchangeDepositPercent} onChange={(event) => setExchangeDepositPercent(event.target.value)} disabled={!commercialModelEditable} /></label>
                        {secondDepositEnabled && (
                          <>
                            <label className="field-label">Second deposit %<input className="field" inputMode="decimal" value={secondDepositPercent} onChange={(event) => setSecondDepositPercent(event.target.value)} disabled={!commercialModelEditable} /></label>
                            <label className="field-label">Months after exchange<input className="field" inputMode="numeric" value={secondDepositMonthsAfterExchange} onChange={(event) => setSecondDepositMonthsAfterExchange(event.target.value)} disabled={!commercialModelEditable} /></label>
                          </>
                        )}
                        </div>
                        <label className="mt-3 flex w-fit items-center gap-2 text-sm text-[#34413a]">
                          <input checked={secondDepositEnabled} onChange={(event) => setSecondDepositEnabled(event.target.checked)} type="checkbox" disabled={!commercialModelEditable} />
                          Optional second deposit
                        </label>
                        <div className={`mt-3 border-t py-3 text-sm ${previewDepositStructure.isValid ? "border-[#d9ded6] text-[#34413a]" : "rounded-bw-inset border-[#D6A23A] bg-[#fff8e7] px-3 text-[#5c4a1f]"}`} role="status" data-testid="payment-schedule-summary">
                          <div className={styles.feeRow}>
                            <div>Exchange deposit<strong className="numeric-value block">{formatPercentValue(previewDepositStructure.exchangeDepositPercent)}</strong></div>
                            {previewDepositStructure.secondDepositEnabled && <div>Second deposit<strong className="numeric-value block">{formatPercentValue(previewDepositStructure.secondDepositPercent)}</strong></div>}
                            <div>Completion balance<strong className="numeric-value block">{formatPercentValue(previewDepositStructure.completionBalancePercent)}</strong></div>
                          </div>
                          {previewDepositStructure.isValid && <p className="mt-2 border-t border-[#e8e5dc] pt-2 font-semibold">Total 100% <CheckCircle2 className="ml-1 inline-block text-[#18794e]" size={15} aria-label="Valid payment schedule" /></p>}
                          <p className="mt-1 text-xs">{previewDepositStructure.error ?? "Reservation fee is separate from the 100% payment schedule."}</p>
                        </div>
                      </fieldset>
                      </div>
                    )}
                    {!showAdvancedDealSetup && !previewAgentFeeStructure.isValid && <p className="text-sm text-[#7a5416]" role="alert">{previewAgentFeeStructure.error} Open Edit deal setup to correct the fee split.</p>}
                    </div>
                  </div>
                <aside className={styles.previewRail} aria-label="Commercial preview">
                <div className="rounded-bw-card border border-[#e2ded3] bg-white p-4">
                  <h4 className="font-bold text-[#0F3D2E]">Live preview</h4>
                  <div className="mt-4 grid gap-2 text-sm text-[#34413a]">
                    <div className="flex justify-between gap-4 border-b border-[#eef0eb] pb-2"><span>Developer net before</span><strong className="numeric-value text-right">{money(selectedDeveloperNet)}</strong></div>
                    <div className="flex justify-between gap-4 border-b border-[#eef0eb] pb-2"><span>Developer net after</span><strong className="numeric-value text-right text-[#0F3D2E]">{money(modelDeveloperNet)}</strong></div>
                    <div className="flex justify-between gap-4 border-b border-[#eef0eb] pb-2"><span>Developer difference</span><strong className="numeric-value text-right">{money(modelDeveloperNet - selectedDeveloperNet)}</strong></div>
                    <div className="flex justify-between gap-4 border-b border-[#eef0eb] pb-2"><span>Exchange invoice before</span><strong className="numeric-value text-right">{money(selectedExchangeInvoice.expectedPayableAmount)}</strong></div>
                    <div className="flex justify-between gap-4 border-b border-[#eef0eb] pb-2"><span>Exchange invoice after</span><strong className="numeric-value text-right text-[#0F3D2E]">{money(previewInvoice.expectedPayableAmount)}</strong></div>
                    <div className="flex justify-between gap-4"><span>Exchange invoice difference</span><strong className="numeric-value text-right">{money(previewInvoice.expectedPayableAmount - selectedExchangeInvoice.expectedPayableAmount)}</strong></div>
                  </div>
                </div>
                <div className="rounded-bw-card border border-[#e2ded3] bg-white p-4">
                  <h4 className="font-bold text-[#0F3D2E]">Scheme impact</h4>
                  <p className="mt-1 text-sm text-[#617169]">Forecast impact across {forSaleUnits.length} For Sale units.</p>
                  <div className="mt-4 grid gap-2 text-sm text-[#34413a]">
                    <div className="flex justify-between gap-4 border-b border-[#eef0eb] pb-2"><span>Applies to</span><strong className="numeric-value text-right">{forSaleUnits.length} For Sale units</strong></div>
                    <div className="flex justify-between gap-4 border-b border-[#eef0eb] pb-2"><span>Current GDV</span><strong className="numeric-value text-right">{money(forSaleCurrentGdv)}</strong></div>
                    <div className="flex justify-between gap-4 border-b border-[#eef0eb] pb-2"><span>Proposed GDV</span><strong className="numeric-value text-right text-[#0F3D2E]">{money(forSaleProposedGdv)}</strong></div>
                    <div className="flex justify-between gap-4 border-b border-[#eef0eb] pb-2"><span>GDV difference</span><strong className="numeric-value text-right">{money(forSaleProposedGdv - forSaleCurrentGdv)}</strong></div>
                    <div className="flex justify-between gap-4 border-b border-[#eef0eb] pb-2"><span>Current forecast net proceeds</span><strong className="numeric-value text-right">{money(forSaleCurrentNet)}</strong></div>
                    <div className="flex justify-between gap-4 border-b border-[#eef0eb] pb-2"><span>Proposed forecast net proceeds</span><strong className="numeric-value text-right text-[#0F3D2E]">{money(forSaleProposedNet)}</strong></div>
                    <div className="flex justify-between gap-4"><span>Forecast difference</span><strong className="numeric-value text-right">{money(forSaleProposedNet - forSaleCurrentNet)}</strong></div>
                  </div>
                  <p className="mt-3 text-xs text-[#617169]">Estimate based on current For Sale units.</p>
                </div>
                </aside>
              </div>
              <div className="mt-4 flex justify-end gap-2">
                <button className="secondary" onClick={cancelCommercialModel}>Cancel</button>
                <button className="primary" onClick={() => void saveCommercialPackage()} disabled={isSaving || !commercialModelEditable || !previewDepositStructure.isValid || !previewAgentFeeStructure.isValid}>
                  Save commercial model
                </button>
              </div>
            </div>
          )}
          </div>
          )}

          {activeUnitSection === "progression" && (
          <div id="unit-sale-progression" role="tabpanel" aria-labelledby="sale-file-tab-progression" className="rounded-b-bw-panel border border-t-0 border-[#d9ded6] bg-white p-3 sm:p-4">
            <div>
              <h4 className="text-lg font-bold text-[#0F3D2E]">Sales stages</h4>
              <p className="text-sm text-[#617169]">Track the legal sale lifecycle and select a stage to view its workspace.</p>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {workflowStages.map((stage, index) => {
                const isLocked = index > currentWorkflowIndex;
                const isDone = index < currentWorkflowIndex;
                const isSelected = activeWorkflowStage === stage.key;
                const needsAttention = stage.status === "Rejected";
                const cardTone = needsAttention
                  ? "border-[#e5c4be] bg-[#fff9f7] hover:border-[#a94b3d]"
                  : isDone
                    ? "border-[#c8ddcf] bg-[#f7fbf8] hover:border-[#4f8d68]"
                    : isLocked
                      ? "cursor-not-allowed border-[#d9ded6] bg-[#f5f6f4]"
                      : "border-[#ead8a7] bg-[#fffaf0] hover:border-[#d6a23a]";
                const statusTone = needsAttention
                  ? "border-[#e5c4be] bg-[#fbeeea] text-[#8d382d]"
                  : isDone
                    ? "border-[#bedacb] bg-[#eaf6ee] text-[#286348]"
                    : isLocked
                      ? "border-[#d9ded6] bg-[#ebece9] text-[#727d77]"
                      : "border-[#ead8a7] bg-[#fff1cc] text-[#765a18]";
                return (
                  <button
                    key={stage.key}
                    className={`flex min-h-24 min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-3 rounded-bw-card border p-4 text-left transition sm:p-5 ${cardTone} ${isSelected ? "ring-1 ring-[#0F3D2E] shadow-sm" : ""}`}
                    onClick={() => {
                      if (!isLocked) {
                        manuallySelectedWorkflowStageRef.current = stage.key;
                        pendingWorkflowStageScrollRef.current = stage.key;
                        setActiveWorkflowStage(stage.key);
                      }
                    }}
                    disabled={isLocked}
                    aria-current={isSelected ? "step" : undefined}
                  >
                    <div className="min-w-0">
                      <span className="block break-words text-lg font-bold leading-tight text-[#0F3D2E]">{stage.label}</span>
                      {isSelected && <span className="mt-2 block text-xs font-bold uppercase tracking-[0.08em] text-[#D6A23A]">Selected</span>}
                    </div>
                    <span className={`max-w-full shrink-0 whitespace-normal break-words rounded-full border px-2.5 py-1 text-center text-xs font-bold leading-tight ${statusTone}`}>{stage.status}</span>
                  </button>
                );
              })}
            </div>
          </div>
          )}

          {activeUnitSection === "progression" && activeWorkflowStage === "reservation" && (
            <StageWorkspace
              id="sales-stage-reservation"
              title="Reservation"
              description="Review the reservation record, buyer details and agreed commercial terms."
              status={reservationStateLabel[reservationState]}
              statusTone={reservationState === "approved" ? "done" : reservationState === "rejected" || reservationState === "failed" ? "attention" : "current"}
              taskLabel={reservationState === "approved" ? "Stage outcome" : "Current task"}
              currentTask={reservationState === "approved" ? "Approval record" : currentSalesTask(reservationTasks, "Reservation ended")}
              taskNavigation={<SalesStageTasks stage="Reservation" steps={reservationTasks} />}
            >

              {reservationCanBeEdited && (
                <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(20rem,0.75fr)]">
                  <div className="rounded-bw-card border border-[#d9ded6] bg-white p-4">
                    {reservationState === "rejected" && (
                      <div className="mb-4 rounded-bw-inset border border-[#f1b8b2] bg-[#fff4f2] p-3 text-sm text-[#7a271a]">
                        <strong className="block">Reservation rejected</strong>
                        <span>{activeRejectionReason || "Developer rejected the reservation pack. Update and resubmit."}</span>
                        {activeAttempt?.reservation_rejected_at && (
                          <span className="mt-1 block text-xs font-semibold uppercase">Rejected {formatDateTime(activeAttempt.reservation_rejected_at)} by {rejectionByName}</span>
                        )}
                      </div>
                    )}
                    <h5 className="font-bold text-[#0F3D2E]">Buyer and reservation form</h5>
                    <p className="mt-1 text-sm text-[#617169]">Commercial terms are read-only here and come from the saved deal model/building defaults.</p>
                    <div className="mt-4 border-l-2 border-[#D6A23A] py-2 pl-4 [overflow-wrap:anywhere]">
                      <h5 className="font-bold text-[#0F3D2E]">Developer-approved commercial terms</h5>
                      <div className="mt-3 grid gap-2 text-sm text-[#34413a]">
                        <div className="flex justify-between gap-4 border-b border-[#eadfbf] pb-2"><span>Developer contribution</span><strong className="numeric-value text-right">{activeDeveloperContributionLabel}</strong></div>
                        <div className="flex justify-between gap-4 border-b border-[#eadfbf] pb-2"><span>Agent contribution</span><strong className="numeric-value text-right">{activeAgentContributionLabel}</strong></div>
                        {(activeTerms?.parking_contribution_value ?? 0) > 0 && <div className="flex justify-between gap-4 border-b border-[#eadfbf] pb-2"><span>Parking contribution</span><strong className="numeric-value text-right">{money(activeTerms?.parking_contribution_value ?? 0)}</strong></div>}
                        {activeSpecialConditions.length > 0 ? activeSpecialConditions.map((condition, index) => (
                          <div key={`${condition}-${index}`} className="flex justify-between gap-4 border-b border-[#eadfbf] pb-2"><span>Additional condition</span><strong className="text-right">{condition}</strong></div>
                        )) : <div className="flex justify-between gap-4"><span>Additional condition</span><strong>-</strong></div>}
                      </div>
                    </div>
                    <div className="mt-4 grid gap-3 md:grid-cols-2">
                      <label className="field-label">Personal buyer name<input className="field" value={buyerPersonName} onChange={(event) => setBuyerPersonName(event.target.value)} disabled={!reservationCanBeEdited} /></label>
                      <label className="field-label">Company buyer name<input className="field" value={buyerCompanyName} onChange={(event) => setBuyerCompanyName(event.target.value)} disabled={!reservationCanBeEdited} /></label>
                      <label className="field-label">Buyer email<input className="field" type="email" value={buyerEmail} onChange={(event) => setBuyerEmail(event.target.value)} disabled={!reservationCanBeEdited} /></label>
                      <label className="field-label">Buyer phone<input className="field" value={buyerPhone} onChange={(event) => setBuyerPhone(event.target.value)} disabled={!reservationCanBeEdited} /></label>
                      <label className="field-label">Buyer solicitor<input className="field" value={buyerSolicitorName} onChange={(event) => setBuyerSolicitorName(event.target.value)} disabled={!reservationCanBeEdited} /></label>
                      <label className="field-label">Reservation date<input className="field" type="date" max={todayDate} value={reservationDate} onChange={(event) => setReservationDate(event.target.value)} disabled={!reservationCanBeEdited} /></label>
                      <div className="md:col-span-2">
                        <PdfUploadBox
                          id={`reservation-form-${selectedUnit.id}`}
                          label="Upload reservation form PDF"
                          file={reservationFormFile}
                          currentVersion={visibleReservationVersion}
                          disabled={!reservationCanBeEdited}
                          onOpen={visibleReservationVersion ? () => void openDocumentVersion(visibleReservationVersion) : undefined}
                          onFile={setReservationFormPdf}
                          onClear={() => setReservationFormFile(null)}
                          onRemoveCurrent={reservationState === "rejected" && reservationVersion ? removeCurrentReservationPdf : undefined}
                        />
                        {showReservationDocumentHistory && <DocumentVersionHistory versions={reservationVersions} onOpen={(version) => void openDocumentVersion(version)} />}
                      </div>
                    </div>
                    <label className="mt-4 flex min-h-10 cursor-pointer items-start gap-3 border-t border-[#eef0eb] py-3 text-sm font-semibold text-[#34413a]">
                      <input className="mt-1" type="checkbox" checked={reservationTermsChecked} onChange={(event) => setReservationTermsChecked(event.target.checked)} disabled={!reservationCanBeEdited} />
                      <span>I have checked that the reservation form reflects the developer-approved commercial terms.</span>
                    </label>
                    <div className="mt-4 flex justify-end">
                      <button className="primary" onClick={() => void saveReservation()} disabled={isSaving || !buyerDetailsComplete || !reservationDate || !reservationTermsChecked}>
                        {reservationState === "rejected" ? "Resubmit reservation" : "Submit reservation"}
                      </button>
                    </div>
                  </div>

                  <div className="grid content-start gap-4">
                    <div className="rounded-bw-card border border-[#d9ded6] bg-white p-4">
                      <h5 className="font-bold text-[#0F3D2E]">Commercial terms</h5>
                      <div className="mt-3">
                        <KeyValueList items={[
                          { label: "Contract price", value: money(selectedContractValue) },
                          { label: "Reservation fee", value: money(displayReservationFee) },
                          { label: "Reservation fee holder", value: describeReservationFeeHolder(displayReservationFeeHolder) },
                          { label: "Exchange deposit", value: formatPercentValue(displayDepositStructure.exchangeDepositPercent) },
                          ...(displayDepositStructure.secondDepositEnabled ? [{ label: "Second deposit", value: `${formatPercentValue(displayDepositStructure.secondDepositPercent)} after ${displayDepositStructure.secondDepositMonthsAfterExchange ?? 0} months` }] : []),
                          { label: "Completion balance", value: formatPercentValue(displayDepositStructure.completionBalancePercent) },
                        ]} />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {reservationState === "awaiting_approval" && (
                <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(20rem,0.85fr)]">
                  <div className="rounded-bw-card border border-[#d9ded6] bg-white p-4">
                    <h5 className="font-bold text-[#0F3D2E]">Submitted reservation pack</h5>
                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                      <FieldValue label="Buyer" value={buyerDisplay(activeAttempt)} />
                      <FieldValue label="Buyer email" value={activeAttempt?.buyer_email} />
                      <FieldValue label="Buyer phone" value={activeAttempt?.buyer_phone} />
                      <FieldValue label="Buyer solicitor" value={activeAttempt?.buyer_solicitor_name} />
                      <FieldValue label="Reservation date" value={activeAttempt?.reservation_date ? formatDate(activeAttempt.reservation_date) : "Missing"} />
                      <FieldValue label="Submitted date and time" value={formatDateTime(activeAttempt?.reservation_submitted_at)} />
                      <FieldValue label="Submitted by" value={submittedByName} />
                      <FieldValue label="Uploaded reservation form" value={reservationVersion?.file_name ?? "Missing"} />
                    </div>
                    <div className="mt-4">
                      <PdfUploadBox
                        id={`reservation-form-review-${selectedUnit.id}`}
                        label="Upload reservation form PDF"
                        file={reservationFormFile}
                        currentVersion={visibleReservationVersion}
                        disabled
                        onOpen={visibleReservationVersion ? () => void openDocumentVersion(visibleReservationVersion) : undefined}
                        onFile={setReservationFormPdf}
                        onClear={() => setReservationFormFile(null)}
                      />
                      {showReservationDocumentHistory && <DocumentVersionHistory versions={reservationVersions} onOpen={(version) => void openDocumentVersion(version)} />}
                    </div>
                  </div>

                  <div className="rounded-bw-card border border-[#d9ded6] bg-white p-4">
                    <h5 className="font-bold text-[#0F3D2E]">Developer review</h5>
                    <span className="mt-2 inline-flex rounded-full border border-[#d9ded6] bg-[#F7F5EF] px-3 py-1 text-xs font-bold uppercase text-[#617169]">Awaiting developer approval</span>
                    <div className="mt-3 grid gap-2 text-sm text-[#34413a]">
                      <div className="flex justify-between gap-4 border-b border-[#eef0eb] pb-2"><span>Contract price</span><strong className="numeric-value">{money(selectedContractValue)}</strong></div>
                      <div className="flex justify-between gap-4 border-b border-[#eef0eb] pb-2"><span>Reservation fee</span><strong className="numeric-value">{money(displayReservationFee)}</strong></div>
                      <div className="flex justify-between gap-4 border-b border-[#eef0eb] pb-2"><span>Fee holder</span><strong>{describeReservationFeeHolder(displayReservationFeeHolder)}</strong></div>
                      <div className="flex justify-between gap-4 border-b border-[#eef0eb] pb-2"><span>Payment schedule</span><strong className="text-right">{displayedPaymentSchedule.map((row) => row.label).join(", ")}</strong></div>
                      <div className="flex justify-between gap-4 border-b border-[#eef0eb] pb-2"><span>Developer-funded incentives</span><strong className="numeric-value text-right">{activeDeveloperContributionLabel}</strong></div>
                      <div className="flex justify-between gap-4 border-b border-[#eef0eb] pb-2"><span>Agent-funded incentives</span><strong className="numeric-value text-right">{activeAgentContributionLabel}</strong></div>
                      <div className="flex justify-between gap-4"><span>Special conditions</span><strong className="text-right">{activeSpecialConditions.length ? activeSpecialConditions.join(", ") : "-"}</strong></div>
                    </div>
                    {!activeAttempt?.reservation_date && (
                      <label className="field-label mt-4">
                        Reservation date
                        <input className="field" type="date" max={todayDate} value={reservationDate} onChange={(event) => setReservationDate(event.target.value)} disabled={!reservationCanBeReviewed} />
                      </label>
                    )}
                    <div className="mt-4 flex flex-wrap justify-end gap-2">
                      {reservationCanBeReviewed && (
                        <>
                          <button className="danger-button" onClick={() => setShowRejectReservationConfirm(true)} disabled={isSaving || !activeAttempt}>Reject reservation</button>
                          <button className="primary" onClick={() => void approveReservation()} disabled={isSaving || approvalBlocked}>Approve reservation</button>
                        </>
                      )}
                    </div>
                    {showRejectReservationConfirm && reservationCanBeReviewed && (
                      <div className="mt-4 rounded-bw-inset border border-[#f1b8b2] bg-[#fff4f2] p-3">
                        <label className="field-label">
                          Rejection reason
                          <textarea className="field min-h-20" value={rejectionReason} onChange={(event) => setRejectionReason(event.target.value)} />
                        </label>
                        <div className="mt-3 flex flex-wrap justify-end gap-2">
                          <button className="secondary min-h-9 px-3 py-1.5 text-sm" onClick={() => {
                            setShowRejectReservationConfirm(false);
                            setRejectionReason("");
                          }}>Cancel</button>
                          <button className="danger-button min-h-9 px-3 py-1.5 text-sm" onClick={() => void rejectReservation()} disabled={isSaving || !activeAttempt || !rejectionReason.trim()}>Confirm rejection</button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {reservationState === "approved" && (
                <div className="mt-4 grid items-start gap-4 lg:grid-cols-2">
                  <section className="rounded-bw-card border border-[#d9ded6] bg-white p-4 sm:p-5">
                    <h5 className="font-bold text-[#0F3D2E]">Reservation</h5>
                    <div className="mt-4">
                      <KeyValueList items={[
                        { label: "Buyer", value: buyerDisplay(activeAttempt) },
                        { label: "Reservation date", value: activeAttempt?.reservation_date ? formatDate(activeAttempt.reservation_date) : "Missing" },
                        { label: "Contract price", value: money(selectedContractValue) },
                        { label: "Reservation fee", value: money(displayReservationFee) },
                        { label: "Fee holder", value: describeReservationFeeHolder(displayReservationFeeHolder) },
                        { label: "Payment schedule", value: displayedPaymentSchedule.map((row) => row.label).join(", ") },
                        { label: "Uploaded reservation form", value: reservationVersion ? <button className="font-bold underline underline-offset-2" type="button" onClick={() => void openDocumentVersion(reservationVersion)}>{reservationVersion.file_name}</button> : "-" },
                      ]} />
                    </div>
                    {showReservationDocumentHistory && <DocumentVersionHistory versions={reservationVersions} onOpen={(version) => void openDocumentVersion(version)} />}
                  </section>
                  <section className={`rounded-bw-card border border-[#d9ded6] bg-white p-4 sm:p-5 ${styles.approvalHistoryCard}`}>
                    <h5 className="font-bold text-[#0F3D2E]">Approval</h5>
                    <ApprovalEventHistory events={approvalHistoryEvents} />
                  </section>
                  </div>
              )}

              {canReturnToForSale && (
                <details className="mt-6 border-t border-[#d9ded6] pt-4">
                  <summary className="w-fit cursor-pointer text-xs font-semibold text-[#617169] underline decoration-[#aeb8b2] underline-offset-4 hover:text-[#0F3D2E]">
                    Reservation options
                  </summary>
                  <div className="mt-3 max-w-2xl rounded-md border border-[#e2ded3] bg-white p-3">
                    {!showReturnToForSaleConfirm ? (
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <p className="text-xs text-[#617169]">Use this only when the current reservation or reservation attempt will not proceed.</p>
                        <button
                          className="text-xs font-semibold text-[#7a271a] underline decoration-[#d9aaa2] underline-offset-4 hover:text-[#591b12]"
                          type="button"
                          onClick={() => setShowReturnToForSaleConfirm(true)}
                          disabled={isSaving}
                        >
                          Cancel reservation attempt
                        </button>
                      </div>
                    ) : (
                      <div>
                        <h5 className="font-bold text-[#7a271a]">Cancel this reservation attempt?</h5>
                        <p className="mt-1 text-sm text-[#6f514b]">This closes the current pre-exchange sale attempt and returns Unit {selectedUnit.unit_number} to For sale. Buyer contact and solicitor details will be cleared; the buyer name, reservation date, reservation form and cancellation reason remain in Reservation history.</p>
                        <label className="field-label mt-3">
                          Cancellation reason
                          <textarea className="field min-h-24" value={returnToForSaleReason} onChange={(event) => setReturnToForSaleReason(event.target.value)} disabled={isSaving} placeholder="Explain why this reservation attempt has ended" />
                        </label>
                        <div className="mt-3 flex flex-wrap justify-end gap-2">
                          <button className="secondary min-h-9 px-3 py-1.5 text-sm" type="button" onClick={() => { setShowReturnToForSaleConfirm(false); setReturnToForSaleReason(""); }} disabled={isSaving}>Keep reservation attempt</button>
                          <button className="danger-button min-h-9 px-3 py-1.5 text-sm" type="button" onClick={() => void returnUnitToForSale()} disabled={isSaving || !returnToForSaleReason.trim()}>{isSaving ? "Cancelling…" : "Confirm cancellation"}</button>
                        </div>
                      </div>
                    )}
                  </div>
                </details>
              )}

            </StageWorkspace>
          )}

          {activeUnitSection === "financials" && activeAttempt && reservationApproved && (
            <section id="agent-fees" role="tabpanel" aria-labelledby="sale-file-tab-financials" className="min-w-0 scroll-mt-4 rounded-b-bw-panel border border-t-0 border-[#d9ded6] bg-white px-4 py-6 sm:px-6 sm:py-7">
              <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[#e2ded3] pb-5">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.14em] text-[#617169]">Sale workspace</p>
                  <h3 className="mt-1 text-2xl font-bold text-[#0F3D2E]">Agent fees</h3>
                  <p className="mt-2 text-sm text-[#617169]">Sales-agent invoicing and payments are tracked independently from the legal sale lifecycle.</p>
                </div>
                <div className="flex flex-wrap gap-2 text-xs font-bold">
                  <span className="rounded-full border border-[#d9ded6] bg-[#f2f4f0] px-3 py-1 text-[#617169]">Exchange: {exchangeAgentFeeStatus}</span>
                  <span className="rounded-full border border-[#d9ded6] bg-[#f2f4f0] px-3 py-1 text-[#617169]">Completion: {completionAgentFeeStatus}</span>
                </div>
              </div>

              <div className="mt-5">
                <h4 className="font-bold text-[#0F3D2E]">Agent fee summary</h4>
                <p className="mt-1 text-xs text-[#617169]">Expected totals sum the independently penny-rounded Exchange and Completion tranches.</p>
                <div className="mt-4 grid gap-4 lg:grid-cols-2">
                  <section className="border-t border-[#e2ded3] pt-4 lg:pr-4">
                    <h5 className="font-bold text-[#0F3D2E]">Fee agreement</h5>
                    <div className="mt-3">
                      <KeyValueList items={[
                        { label: "Sale price", value: money(activeTerms?.contract_price) },
                        { label: "Total agent fee", value: formatPercentValue(displayAgentFeePercent) },
                        { label: "Exchange tranche", value: `${formatPercentValue(displayExchangeAgentFeePercent)} · ${money(previewInvoice.netAmount)} net` },
                        { label: "Completion tranche", value: `${formatPercentValue(displayCompletionAgentFeePercent)} · ${money(completionInvoicePreview.netAmount)} net` },
                        { label: "Expected fee net", value: money(agentFeeSummary.expectedNetAmount) },
                        { label: "Expected fee gross", value: money(agentFeeSummary.expectedGrossAmount) },
                      ]} />
                    </div>
                  </section>
                  <section className="border-t border-[#e2ded3] pt-4 lg:border-l lg:pl-4">
                    <h5 className="font-bold text-[#0F3D2E]">Current position</h5>
                    <div className="mt-3">
                      <KeyValueList items={[
                        { label: "Total invoiced", value: money(agentFeeSummary.invoicedGrossAmount) },
                        { label: "Reservation fee credits held", value: money(agentFeeSummary.reservationCredits) },
                        { label: "Agent contribution credits", value: money(agentFeeSummary.agentContributionCredits) },
                        { label: "Cash payments recorded", value: money(agentFeeSummary.cashPayments) },
                        { label: "Total paid / credited", value: money(agentFeeSummary.totalPaidOrCredited) },
                        { label: "Outstanding submitted invoices", value: money(agentFeeSummary.submittedInvoiceOutstanding) },
                        { label: "Remaining uninvoiced fee", value: money(agentFeeSummary.uninvoicedNetAmount) },
                      ]} />
                    </div>
                  </section>
                </div>
                {saleUsesProtectedSnapshot && <p className="mt-3 text-xs text-[#617169]">This sale uses its own agreed fee snapshot; later building-default changes do not alter these amounts.</p>}
              </div>

              <div className="mt-5 grid gap-5">
                <article id="exchange-fee" className="scroll-mt-6 rounded-bw-card border border-[#d9ded6] bg-[#fbfcfa] p-4 sm:p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-bold uppercase tracking-[0.1em] text-[#617169]">Exchange milestone</p>
                      <h4 className="mt-1 text-lg font-bold text-[#0F3D2E]">Exchange fee</h4>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <span className="rounded-full border border-[#d9ded6] bg-white px-2.5 py-1 text-xs font-bold text-[#617169]">{activeInvoice ? statusLabel(activeInvoice.status) : "Invoice not received"}</span>
                      {activeInvoice && <span className="rounded-full border border-[#d9ded6] bg-white px-2.5 py-1 text-xs font-bold text-[#617169]">{invoicePaymentPosition.paymentStatus}</span>}
                    </div>
                  </div>

                  <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                    <div className="rounded-md bg-white p-4">
                      <h5 className="font-bold text-[#0F3D2E]">Expected Exchange invoice</h5>
                      <div className="mt-3 grid gap-2 text-sm text-[#34413a]">
                        <div className="flex justify-between gap-4 border-b border-[#eef0eb] pb-2"><span>Agreed fee</span><strong className="numeric-value">{formatPercentValue(displayExchangeAgentFeePercent)}</strong></div>
                        <div className="flex justify-between gap-4 border-b border-[#eef0eb] pb-2"><span>Expected net fee</span><strong className="numeric-value">{money(previewInvoice.netAmount)}</strong></div>
                        <div className="flex justify-between gap-4 border-b border-[#eef0eb] pb-2"><span>Expected VAT</span><strong className="numeric-value">{money(previewInvoice.vatAmount)}</strong></div>
                        <div className="flex justify-between gap-4 border-b border-[#eef0eb] pb-2"><span>Expected gross fee</span><strong className="numeric-value">{money(activeInvoice?.expected_gross_amount ?? previewInvoice.grossAmount)}</strong></div>
                        <div className="flex justify-between gap-4 border-b border-[#eef0eb] pb-2"><span>Reservation fee credit already held</span><strong className="numeric-value">{moneyDeduction(activeInvoice?.reservation_fee_deduction ?? previewInvoice.reservationFeeDeduction)}</strong></div>
                        <div className="flex justify-between gap-4 border-b border-[#eef0eb] pb-2"><span>Agent contribution deduction</span><strong className="numeric-value">{moneyDeduction(activeInvoice?.agent_contribution_deduction ?? previewInvoice.agentContributionDeduction)}</strong></div>
                        <div className="flex justify-between gap-4"><span>Expected cash amount payable</span><strong className="numeric-value text-[#0F3D2E]">{money(expectedPayableAmount)}</strong></div>
                      </div>
                    </div>

                    <div className="rounded-md bg-white p-4">
                      <h5 className="font-bold text-[#0F3D2E]">Invoice</h5>
                      {agentInvoiceVersion ? (
                        <>
                          <div className="mt-3 grid gap-2 text-sm text-[#34413a]">
                            <div className="flex justify-between gap-4 border-b border-[#eef0eb] pb-2"><span>Reference</span><strong>{activeInvoice?.invoice_reference ?? "-"}</strong></div>
                            <div className="flex justify-between gap-4 border-b border-[#eef0eb] pb-2"><span>Invoice date</span><strong>{formatDate(activeInvoice?.invoice_date)}</strong></div>
                            <div className="flex justify-between gap-4 border-b border-[#eef0eb] pb-2"><span>Uploaded invoice total</span><strong className="numeric-value">{money(activeInvoice?.gross_amount)}</strong></div>
                            <div className="flex justify-between gap-4"><span>Variance from expected gross fee</span><strong className="numeric-value">{money(invoiceVariance)}</strong></div>
                          </div>
                          <button className="secondary mt-4" type="button" onClick={() => void openDocumentVersion(agentInvoiceVersion)}>Open invoice PDF</button>
                          {exchangeAgentInvoiceVersions.length > 1 && <DocumentVersionHistory versions={exchangeAgentInvoiceVersions} onOpen={(version) => void openDocumentVersion(version)} />}
                          {agentInvoiceNeedsCorrection && <p className="mt-3 rounded-bw-inset border border-[#f1b8b2] bg-[#fff4f2] p-3 text-sm text-[#7a271a]">{agentInvoiceDocument?.query_note ?? "A corrected invoice has been requested."}</p>}
                        </>
                      ) : <p className="mt-3 text-sm text-[#617169]">Invoice not yet received.</p>}
                    </div>
                  </div>

                  {(!agentInvoiceVersion || agentInvoiceNeedsCorrection) && (
                    <AgentInvoiceSubmissionForm
                      milestone="exchange"
                      feePercent={previewExchangeAgentFeePercent}
                      expectedNetAmount={previewInvoice.netAmount}
                      expectedVatAmount={previewInvoice.vatAmount}
                      expectedGrossAmount={previewInvoice.grossAmount}
                      isReplacement={agentInvoiceNeedsCorrection}
                      reference={invoiceReference}
                      invoiceDate={invoiceDate}
                      grossAmount={invoiceGrossAmount}
                      file={agentInvoiceFile}
                      canSubmit={canSubmitAgentInvoice}
                      isSaving={isSaving}
                      todayDate={todayDate}
                      onReference={setInvoiceReference}
                      onInvoiceDate={setInvoiceDate}
                      onGrossAmount={setInvoiceGrossAmount}
                      onFile={setAgentInvoiceFile}
                      onSubmit={() => void uploadAgentInvoice("exchange")}
                    />
                  )}

                  {agentInvoiceVersion && !exchangeInvoiceApproved && !agentInvoiceNeedsCorrection && (
                    <div className="mt-4 rounded-md border border-[#e2ded3] bg-white p-4">
                      <h5 className="font-bold text-[#0F3D2E]">Developer approval</h5>
                      <p className="mt-1 text-sm text-[#617169]">Review this invoice independently. Approval or rejection does not change the legal sale stage.</p>
                      {showRejectInvoiceConfirm && canRejectAgentInvoice && (
                        <div ref={invoiceRejectionPanelRef} className="active-panel-target active-panel-with-context mt-4 rounded-bw-inset border border-[#f1b8b2] bg-[#fff4f2] p-4">
                          <label className="field-label">Reason for rejecting the invoice<input ref={invoiceRejectionInputRef} className="field" value={invoiceRejectionReason} onChange={(event) => setInvoiceRejectionReason(event.target.value)} /></label>
                          <div className="mt-3 flex flex-wrap justify-end gap-2">
                            <button className="secondary" onClick={() => { setShowRejectInvoiceConfirm(false); setInvoiceRejectionReason(""); }}>Cancel</button>
                            <button className="danger-button" onClick={() => void rejectAgentInvoice()} disabled={isSaving || !invoiceRejectionReason.trim()}>Confirm rejection</button>
                          </div>
                        </div>
                      )}
                      <div className="mt-4 flex flex-wrap justify-end gap-2">
                        {canRejectAgentInvoice && <button className="danger-button" onClick={() => { setShowRejectInvoiceConfirm(true); requestInvoiceRejectionPanel({ focus: () => invoiceRejectionInputRef.current }); }} disabled={isSaving}>Reject invoice</button>}
                        {canApproveAgentInvoice && <button className="primary" type="button" onClick={() => void approveAgentInvoice("exchange")} disabled={isSaving}>Approve invoice</button>}
                      </div>
                    </div>
                  )}

                  {activeInvoice && exchangeInvoiceApproved && (
                    <AgentInvoicePaymentSection
                      position={invoicePaymentPosition}
                      payments={activeInvoicePayments}
                      profiles={profiles}
                      canRecord={canRecordAgentFeePayment}
                      canVoid={canVoidAgentFeePayment}
                      isSaving={isSaving}
                      amount={solicitorPaymentAmount}
                      paymentDate={solicitorPaymentDate}
                      todayDate={todayDate}
                      onAmount={setSolicitorPaymentAmount}
                      onPaymentDate={setSolicitorPaymentDate}
                      onRecord={() => recordAgentFeePayment("exchange")}
                      onRequestVoid={requestVoidAgentFeePayment}
                    />
                  )}
                </article>

                <article id="completion-fee" className="scroll-mt-6 rounded-bw-card border border-[#d9ded6] bg-[#fbfcfa] p-4 sm:p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div><p className="text-xs font-bold uppercase tracking-[0.1em] text-[#617169]">Completion milestone</p><h4 className="mt-1 text-lg font-bold text-[#0F3D2E]">Completion fee</h4></div>
                    <div className="flex flex-wrap gap-2">
                      <span className="rounded-full border border-[#d9ded6] bg-white px-2.5 py-1 text-xs font-bold text-[#617169]">{completionAgentInvoice ? statusLabel(completionAgentInvoice.status) : "Invoice not received"}</span>
                      {completionAgentInvoice && <span className="rounded-full border border-[#d9ded6] bg-white px-2.5 py-1 text-xs font-bold text-[#617169]">{completionInvoicePaymentPosition.paymentStatus}</span>}
                    </div>
                  </div>

                  <p className="mt-2 text-sm text-[#617169]">Available after legal Exchange and before or after legal Completion. Its submission, approval and payment do not block Completion.</p>

                  <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                    <div className="rounded-md bg-white p-4">
                      <h5 className="font-bold text-[#0F3D2E]">Expected Completion invoice</h5>
                      <div className="mt-3 grid gap-2 text-sm text-[#34413a]">
                        <div className="flex justify-between gap-4 border-b border-[#eef0eb] pb-2"><span>Agreed fee</span><strong className="numeric-value">{formatPercentValue(displayCompletionAgentFeePercent)}</strong></div>
                        <div className="flex justify-between gap-4 border-b border-[#eef0eb] pb-2"><span>Expected net fee</span><strong className="numeric-value">{money(completionInvoicePreview.netAmount)}</strong></div>
                        <div className="flex justify-between gap-4 border-b border-[#eef0eb] pb-2"><span>Expected VAT</span><strong className="numeric-value">{money(completionInvoicePreview.vatAmount)}</strong></div>
                        <div className="flex justify-between gap-4"><span>Expected gross fee</span><strong className="numeric-value text-[#0F3D2E]">{money(completionAgentInvoice?.expected_gross_amount ?? completionInvoicePreview.grossAmount)}</strong></div>
                      </div>
                    </div>

                    <div className="rounded-md bg-white p-4">
                      <h5 className="font-bold text-[#0F3D2E]">Invoice</h5>
                      {completionAgentInvoiceVersion ? (
                        <>
                          <div className="mt-3 grid gap-2 text-sm text-[#34413a]">
                            <div className="flex justify-between gap-4 border-b border-[#eef0eb] pb-2"><span>Reference</span><strong>{completionAgentInvoice?.invoice_reference ?? "-"}</strong></div>
                            <div className="flex justify-between gap-4 border-b border-[#eef0eb] pb-2"><span>Invoice date</span><strong>{formatDate(completionAgentInvoice?.invoice_date)}</strong></div>
                            <div className="flex justify-between gap-4 border-b border-[#eef0eb] pb-2"><span>Uploaded invoice total</span><strong className="numeric-value">{money(completionAgentInvoice?.gross_amount)}</strong></div>
                            <div className="flex justify-between gap-4"><span>Variance from expected gross fee</span><strong className="numeric-value">{money(completionInvoiceVariance)}</strong></div>
                          </div>
                          <button className="secondary mt-4" type="button" onClick={() => void openDocumentVersion(completionAgentInvoiceVersion)}>Open Completion invoice PDF</button>
                          {completionAgentInvoiceVersions.length > 1 && <DocumentVersionHistory versions={completionAgentInvoiceVersions} onOpen={(version) => void openDocumentVersion(version)} />}
                          {completionInvoiceNeedsCorrection && <p className="mt-3 rounded-bw-inset border border-[#f1b8b2] bg-[#fff4f2] p-3 text-sm text-[#7a271a]">{completionAgentInvoiceDocument?.query_note ?? "A corrected Completion invoice has been requested."}</p>}
                        </>
                      ) : <p className="mt-3 text-sm text-[#617169]">Invoice not yet received.</p>}
                    </div>
                  </div>

                  {previewCompletionAgentFeePercent <= 0 ? (
                    <p className="mt-4 rounded-md border border-[#e2ded3] bg-white p-4 text-sm text-[#617169]">No Completion fee tranche is configured for this sale.</p>
                  ) : !completionInvoiceSubmissionAvailable && !completionAgentInvoiceVersion ? (
                    <p className="mt-4 rounded-md border border-[#e2ded3] bg-white p-4 text-sm text-[#617169]">Completion invoice submission becomes available after legal Exchange. It is not required before legal Completion.</p>
                  ) : (!completionAgentInvoiceVersion || completionInvoiceNeedsCorrection) && (
                    <AgentInvoiceSubmissionForm
                      milestone="completion"
                      feePercent={previewCompletionAgentFeePercent}
                      expectedNetAmount={completionInvoicePreview.netAmount}
                      expectedVatAmount={completionInvoicePreview.vatAmount}
                      expectedGrossAmount={completionInvoicePreview.grossAmount}
                      isReplacement={completionInvoiceNeedsCorrection}
                      reference={completionInvoiceReference}
                      invoiceDate={completionInvoiceDate}
                      grossAmount={completionInvoiceGrossAmount}
                      file={completionAgentInvoiceFile}
                      canSubmit={canSubmitAgentInvoice && completionInvoiceSubmissionAvailable}
                      isSaving={isSaving}
                      todayDate={todayDate}
                      onReference={setCompletionInvoiceReference}
                      onInvoiceDate={setCompletionInvoiceDate}
                      onGrossAmount={setCompletionInvoiceGrossAmount}
                      onFile={setCompletionAgentInvoiceFile}
                      onSubmit={() => void uploadAgentInvoice("completion")}
                    />
                  )}

                  {completionAgentInvoiceVersion && !completionInvoiceApproved && !completionInvoiceNeedsCorrection && (
                    <div className="mt-4 rounded-md border border-[#e2ded3] bg-white p-4">
                      <h5 className="font-bold text-[#0F3D2E]">Developer approval</h5>
                      <p className="mt-1 text-sm text-[#617169]">Review this invoice independently. Approval or rejection does not change the legal sale stage.</p>
                      {showRejectCompletionInvoiceConfirm && canRejectAgentInvoice && (
                        <div ref={completionInvoiceRejectionPanelRef} className="active-panel-target active-panel-with-context mt-4 rounded-bw-inset border border-[#f1b8b2] bg-[#fff4f2] p-4">
                          <label className="field-label">Reason for rejecting the invoice<input ref={completionInvoiceRejectionInputRef} className="field" value={completionInvoiceRejectionReason} onChange={(event) => setCompletionInvoiceRejectionReason(event.target.value)} /></label>
                          <div className="mt-3 flex flex-wrap justify-end gap-2">
                            <button className="secondary" type="button" onClick={() => { setShowRejectCompletionInvoiceConfirm(false); setCompletionInvoiceRejectionReason(""); }}>Cancel</button>
                            <button className="danger-button" type="button" onClick={() => void rejectAgentInvoice("completion")} disabled={isSaving || !completionInvoiceRejectionReason.trim()}>Confirm rejection</button>
                          </div>
                        </div>
                      )}
                      <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
                        {!canApproveAgentInvoice && !canRejectAgentInvoice && <span className="text-sm text-[#617169]">Awaiting developer review.</span>}
                        {canRejectAgentInvoice && <button className="danger-button" type="button" onClick={() => { setShowRejectCompletionInvoiceConfirm(true); requestCompletionInvoiceRejectionPanel({ focus: () => completionInvoiceRejectionInputRef.current }); }} disabled={isSaving}>Reject invoice</button>}
                        {canApproveAgentInvoice && <button className="primary" type="button" onClick={() => void approveAgentInvoice("completion")} disabled={isSaving}>Approve invoice</button>}
                      </div>
                    </div>
                  )}

                  {completionAgentInvoice && completionInvoiceApproved && (
                    <AgentInvoicePaymentSection
                      position={completionInvoicePaymentPosition}
                      payments={completionInvoicePayments}
                      profiles={profiles}
                      canRecord={canRecordAgentFeePayment}
                      canVoid={canVoidAgentFeePayment}
                      isSaving={isSaving}
                      amount={completionPaymentAmount}
                      paymentDate={completionPaymentDate}
                      todayDate={todayDate}
                      onAmount={setCompletionPaymentAmount}
                      onPaymentDate={setCompletionPaymentDate}
                      onRecord={() => recordAgentFeePayment("completion")}
                      onRequestVoid={requestVoidAgentFeePayment}
                    />
                  )}
                </article>
              </div>

              {paymentToVoid && canVoidAgentFeePayment && (
                <div ref={paymentVoidPanelRef} className="active-panel-target active-panel-with-context mt-5 rounded-bw-card border border-[#e5c4be] bg-[#fff9f7] p-4 sm:p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h4 className="font-bold text-[#7a271a]">Void payment</h4>
                      <p className="mt-1 text-sm text-[#617169]">This payment will remain in the audit history but will no longer count towards the invoice balance.</p>
                    </div>
                    <span className="rounded-full border border-[#e5c4be] bg-white px-2.5 py-1 text-xs font-bold text-[#7a271a]">
                      {completionAgentInvoice?.id === paymentToVoid.invoice_id ? "Completion" : "Exchange"}
                    </span>
                  </div>
                  <div className="mt-4 grid gap-x-4 text-sm text-[#34413a] sm:grid-cols-3">
                    <FieldValue label="Recorded by" value={paymentRecorderLabel(paymentToVoid, profiles)} />
                    <FieldValue label="Payment date" value={formatDate(paymentToVoid.paid_at)} />
                    <FieldValue label="Original amount" value={money(paymentToVoid.amount)} />
                  </div>
                  <label className="field-label mt-4">
                    Reason for correction
                    <input ref={paymentVoidReasonInputRef} className="field" value={paymentVoidReason} onChange={(event) => setPaymentVoidReason(event.target.value)} disabled={isSaving} />
                  </label>
                  <div className="mt-4 flex flex-wrap justify-end gap-2">
                    <button className="secondary" type="button" onClick={() => { setPaymentToVoid(null); setPaymentVoidReason(""); }} disabled={isSaving}>Cancel</button>
                    <button className="danger-button" type="button" onClick={() => void voidAgentFeePayment()} disabled={isSaving || !paymentVoidReason.trim()}>{isSaving ? "Voiding…" : "Void payment"}</button>
                  </div>
                </div>
              )}
            </section>
          )}

          {activeUnitSection === "progression" && activeWorkflowStage === "exchange" && (
            <StageWorkspace
              id="sales-stage-exchange"
              title="Exchange"
              description="Confirm the agreed legal position and record the actual exchange date."
              status={workflowStages[1].status}
              statusTone={currentWorkflowIndex > 1 ? "done" : currentWorkflowIndex < 1 ? "locked" : "current"}
              taskLabel={exchangeRecorded ? "Stage outcome" : "Current task"}
              currentTask={exchangeRecorded ? "Exchange recorded" : !reservationApproved ? "Waiting for reservation approval" : !commercialApproved ? "Confirm commercial terms" : "Record exchange"}
              taskNavigation={<SalesStageTasks stage="Exchange" steps={exchangeTasks} />}
            >
              {!reservationApproved ? (
                <div className="rounded-md border border-[#e2ded3] bg-white p-4 text-sm text-[#617169]">
                  Approve the reservation before preparing for legal Exchange.
                </div>
              ) : !commercialApproved ? (
                <div className="grid gap-4 lg:grid-cols-2">
                  <section className="rounded-md border border-[#e2ded3] bg-white p-4">
                    <h5 className="font-bold text-[#0F3D2E]">Commercial terms to confirm</h5>
                    <div className="mt-3">
                      <KeyValueList items={[
                        { label: "Buyer", value: buyerDisplay(activeAttempt) },
                        { label: "Contract price", value: money(activeTerms?.contract_price) },
                        { label: "Reservation fee", value: money(activeTerms?.reservation_fee) },
                        { label: "Exchange deposit due", value: money(exchangeDepositDue) },
                        { label: "Deposit / payment structure", value: activeTerms?.deposit_summary ?? paymentScheduleSummary(displayDepositStructure) },
                      ]} />
                    </div>
                  </section>
                  <section className="rounded-md border border-[#e2ded3] bg-white p-4">
                    <h5 className="font-bold text-[#0F3D2E]">Commercial confirmation</h5>
                    <p className="mt-1 text-sm text-[#617169]">Confirm the agreed contract and deposit position before recording Exchange.</p>
                    <div className="mt-4 flex justify-end">
                      {canApproveCommercialPackage ? (
                        <button className="primary" type="button" onClick={() => void approveCommercialPackage()} disabled={isSaving || !previewContractPrice}>
                          Confirm terms ready for Exchange
                        </button>
                      ) : (
                        <p className="text-sm text-[#617169]">Awaiting developer confirmation.</p>
                      )}
                    </div>
                  </section>
                </div>
              ) : (
                <div className="grid gap-4 lg:grid-cols-2">
                  <section className="rounded-md border border-[#e2ded3] bg-white p-4">
                    <h5 className="font-bold text-[#0F3D2E]">Approved commercial snapshot</h5>
                    <div className="mt-3">
                      <KeyValueList items={[
                        { label: "Buyer", value: buyerDisplay(activeAttempt) },
                        { label: "Contract price", value: money(activeTerms?.contract_price) },
                        { label: "Reservation fee", value: money(activeTerms?.reservation_fee) },
                        { label: "Exchange deposit due", value: money(exchangeDepositDue) },
                        { label: "Deposit / payment structure", value: activeTerms?.deposit_summary ?? paymentScheduleSummary(displayDepositStructure) },
                        { label: "Confirmed by", value: commercialApprovedBy },
                        { label: "Commercial confirmed", value: formatDateTime(activeAttempt?.commercial_approved_at) },
                      ]} />
                    </div>
                  </section>

                  {exchangeRecorded ? (
                    <CompletedActionSummary
                        title="Exchange confirmed"
                        description="The legal exchange position has been recorded and the controls are now locked."
                        items={[
                          { label: "Exchange deposit", value: `${money(exchangeDepositDue)} received` },
                          { label: "Actual exchange date", value: formatDate(activeAttempt?.exchanged_at) },
                          { label: "Recorded by", value: exchangeRecordedBy },
                        ]}
                    />
                  ) : (
                    <section className="h-full rounded-md border border-[#e2ded3] bg-white p-4">
                        <h5 className="font-bold text-[#0F3D2E]">Exchange confirmation</h5>
                        <label className="mt-3 flex min-h-10 cursor-pointer items-start gap-3 border-t border-[#eef0eb] py-3 text-sm font-semibold text-[#34413a]">
                          <input className="mt-1" type="checkbox" checked={exchangeDepositConfirmed} onChange={(event) => setExchangeDepositConfirmed(event.target.checked)} disabled={!canRecordExchange} />
                          <span>I confirm the exchange deposit of {money(exchangeDepositDue)} has been received in line with the approved commercial terms.</span>
                        </label>
                        <label className="field-label mt-3">
                          Actual exchange date
                          <input className="field" type="date" max={todayDate} value={exchangeDate} onChange={(event) => setExchangeDate(event.target.value)} disabled={!canRecordExchange} />
                        </label>
                        <div className="mt-4 flex justify-end">
                          {canRecordExchange && (
                            <button className="primary" type="button" onClick={() => void recordExchange()} disabled={isSaving || !exchangeDate || !exchangeDepositConfirmed}>
                              Mark unit Exchanged
                            </button>
                          )}
                        </div>
                    </section>
                  )}
                </div>
              )}
            </StageWorkspace>
          )}

          {activeUnitSection === "progression" && activeWorkflowStage === "completion" && (
            <StageWorkspace
              id="sales-stage-completion"
              title="Completion"
              description="Complete the document review and record the legal completion date."
              status={completionRecorded ? "Completed" : completionReady ? "Approved" : !exchangeRecorded ? "Locked" : completionDocumentState.needsChanges ? "Changes required" : completionDocumentState.uploaded ? "Awaiting developer review" : "Documents required"}
              statusTone={completionRecorded ? "done" : !exchangeRecorded ? "locked" : completionDocumentState.needsChanges ? "attention" : "current"}
              taskLabel={completionRecorded ? "Stage outcome" : "Current task"}
              currentTask={completionRecorded ? "Completion recorded" : currentSalesTask(completionTasks, "Waiting for exchange")}
              taskNavigation={<SalesStageTasks stage="Completion" steps={completionTasks} />}
            >

            {!exchangeRecorded ? (
              <div className="mt-4 rounded-md border border-[#e2ded3] bg-white p-4 text-sm text-[#617169]">
                Record exchange before starting completion.
              </div>
            ) : (
              <div className="mt-4">
                {persistedCompletionQuery && !completionRecorded && !completionDocumentsApproved && (
                  <div className={`mb-4 rounded-md border p-4 ${completionDocumentState.needsChanges ? "border-[#e7b7ae] bg-[#fbeeea]" : "border-[#e2ded3] bg-white"}`}>
                    <h5 className="font-bold text-[#0F3D2E]">{completionDocumentState.needsChanges ? "Completion documents need changes" : "Documents resubmitted for review"}</h5>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-[#7a271a]">{persistedCompletionQuery}</p>
                    {completionQueryEvent && <p className="mt-2 text-xs text-[#617169]">Queried by {workflowActorLabel(completionQueryEvent, profiles)} · {formatDateTime(completionQueryEvent.created_at)}</p>}
                    <p className="mt-2 text-sm text-[#617169]">{completionDocumentState.needsChanges ? "The solicitor must replace the relevant documents below. The developer will then review the document pack again." : "The developer must review the current documents and explicitly approve them before completion can be recorded."}</p>
                  </div>
                )}
                <div className="grid items-stretch gap-4 lg:grid-cols-2">
                  <section className="h-full rounded-md border border-[#e2ded3] bg-white p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h5 className="font-bold text-[#0F3D2E]">Completion statement</h5>
                        <p className="text-sm text-[#617169]">PDF from the conveyancer.</p>
                      </div>
                      <span className="rounded-full border border-[#d9ded6] bg-[#F7F5EF] px-2 py-1 text-xs font-bold text-[#617169]">{completionStatementDocument ? statusLabel(completionStatementDocument.status) : "Not uploaded"}</span>
                    </div>
                    <div className="mt-4">
                      <PdfUploadBox
                        id={`completion-statement-${selectedUnit.id}`}
                        label="Choose completion statement PDF"
                        file={completionStatementFile}
                        currentVersion={completionStatementVersion}
                        disabled={!canSubmitCompletionDocuments || completionReady || completionRecorded || isSaving}
                        onOpen={completionStatementVersion ? () => void openDocumentVersion(completionStatementVersion) : undefined}
                        onFile={setCompletionStatementFile}
                        onClear={() => setCompletionStatementFile(null)}
                      />
                      {canSubmitCompletionDocuments && !completionReady && !completionRecorded && (
                        <div className="mt-3 flex justify-end">
                          <button className="secondary" type="button" onClick={() => void uploadCompletionDocument("completion_statement")} disabled={isSaving || !completionStatementFile}>Upload completion statement</button>
                        </div>
                      )}
                      {completionStatementDocument && versions.some((version) => version.document_id === completionStatementDocument.id && !version.is_current && !version.redacted_at) && <DocumentVersionHistory versions={versions.filter((version) => version.document_id === completionStatementDocument.id && !version.redacted_at)} onOpen={(version) => void openDocumentVersion(version)} />}
                    </div>
                  </section>

                  <section className="h-full rounded-md border border-[#e2ded3] bg-white p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h5 className="font-bold text-[#0F3D2E]">Statement of account</h5>
                        <p className="text-sm text-[#617169]">PDF showing completion account movements.</p>
                      </div>
                      <span className="rounded-full border border-[#d9ded6] bg-[#F7F5EF] px-2 py-1 text-xs font-bold text-[#617169]">{statementOfAccountDocument ? statusLabel(statementOfAccountDocument.status) : "Not uploaded"}</span>
                    </div>
                    <div className="mt-4">
                      <PdfUploadBox
                        id={`statement-of-account-${selectedUnit.id}`}
                        label="Choose statement of account PDF"
                        file={statementOfAccountFile}
                        currentVersion={statementOfAccountVersion}
                        disabled={!canSubmitCompletionDocuments || completionReady || completionRecorded || isSaving}
                        onOpen={statementOfAccountVersion ? () => void openDocumentVersion(statementOfAccountVersion) : undefined}
                        onFile={setStatementOfAccountFile}
                        onClear={() => setStatementOfAccountFile(null)}
                      />
                      {canSubmitCompletionDocuments && !completionReady && !completionRecorded && (
                        <div className="mt-3 flex justify-end">
                          <button className="secondary" type="button" onClick={() => void uploadCompletionDocument("statement_of_account")} disabled={isSaving || !statementOfAccountFile}>Upload statement of account</button>
                        </div>
                      )}
                      {statementOfAccountDocument && versions.some((version) => version.document_id === statementOfAccountDocument.id && !version.is_current && !version.redacted_at) && <DocumentVersionHistory versions={versions.filter((version) => version.document_id === statementOfAccountDocument.id && !version.redacted_at)} onOpen={(version) => void openDocumentVersion(version)} />}
                    </div>
                  </section>
                </div>

                <div className="mt-4 grid items-stretch gap-4 lg:grid-cols-2">
                  {completionDocumentsApproved ? (
                    <CompletedActionSummary
                      title="Completion documents approved"
                      description="The completion statement and statement of account have passed developer review."
                      items={[
                        { label: "Approved by", value: completionDocumentsApprovedBy },
                        { label: "Approved at", value: formatDateTime(completionDocumentsApprovedAt) },
                      ]}
                    />
                  ) : completionDocumentState.canReview && !completionRecorded ? (
                    <section className="h-full rounded-md border border-[#e2ded3] bg-white p-4">
                      <h5 className="font-bold text-[#0F3D2E]">Review completion documents</h5>
                      <p className="mt-1 text-sm text-[#617169]">{canApproveCompletionDocuments ? "Review the PDFs above, then approve the document pack or request corrections from the solicitor." : "Awaiting the developer’s review of the documents above. Completion stays locked until approval."}</p>
                      {canApproveCompletionDocuments && <>
                      <label className="field-label mt-3">
                        Rejection / query reason
                        <textarea className="field min-h-24" value={completionQueryNote} onChange={(event) => setCompletionQueryNote(event.target.value)} disabled={isSaving} />
                      </label>
                      <div className="mt-3 flex flex-wrap justify-end gap-2">
                        <button className="danger-button" type="button" onClick={() => void queryCompletionDocuments()} disabled={isSaving || !completionQueryNote.trim()}>Reject / query documents</button>
                        <button className="primary" type="button" onClick={() => void approveCompletionDocuments()} disabled={isSaving || !completionDocumentState.canReview}>Approve completion documents</button>
                      </div>
                      </>}
                    </section>
                  ) : null}

                  {completionRecorded ? (
                    <CompletedActionSummary
                      title="Sale completed"
                      description="The legal completion has been recorded and the handover workflow is available."
                      items={[
                        { label: "Actual completion date", value: formatDate(activeAttempt?.completed_at) },
                        { label: "Completed by", value: completionRecordedBy },
                      ]}
                    />
                  ) : completionReady ? (
                    <section className="h-full rounded-md border border-[#e2ded3] bg-white p-4">
                      <h5 className="font-bold text-[#0F3D2E]">Record completion</h5>
                      <p className="mt-1 text-sm text-[#617169]">{canRecordCompletion ? "Enter the actual legal completion date to mark this unit Completed." : "The solicitor can now enter the legal completion date and mark this unit Completed."}</p>
                      <label className="field-label mt-3">
                        Actual completion date
                        <input className="field" type="date" max={todayDate} value={completionDate} onChange={(event) => setCompletionDate(event.target.value)} disabled={!canRecordCompletion || !completionReady} />
                      </label>
                      <div className="mt-4 flex justify-end">
                        {canRecordCompletion && (
                          <button className="primary" type="button" onClick={() => void recordCompletion()} disabled={isSaving || !completionDate || !completionReady}>
                            Mark unit Completed
                          </button>
                        )}
                      </div>
                    </section>
                  ) : null}
                </div>
              </div>
            )}
            </StageWorkspace>
          )}

          {activeUnitSection === "progression" && activeWorkflowStage === "handover" && (
            <StageWorkspace
              id="sales-stage-handover"
              title="Handover"
              description="Continue into the existing Bunnywell handover process once the sale is complete."
              status={completionRecorded ? "Available" : "Locked"}
              statusTone={completionRecorded ? "current" : "locked"}
              currentTask={completionRecorded ? "Continue to handover" : "Waiting for completion"}
            >
              <div className="rounded-md bg-white p-4 text-sm text-[#34413a]">
                {completionRecorded ? (
                  <p>Unit {selectedUnit.unit_number} is completed. Use the existing Handover area to manage resident and agent handover activity.</p>
                ) : (
                  <p>Complete the sale before handover becomes available.</p>
                )}
              </div>
            </StageWorkspace>
          )}

          {activeUnitSection === "progression" && failedAttempts.length > 0 && (
            <div className="mt-5 rounded-bw-card border border-[#d9ded6] bg-[#F7F5EF] p-4">
              <h4 className="text-base font-bold text-[#0F3D2E]">Reservation history</h4>
              <div className="mt-3 grid gap-2">
                {failedAttempts.map((attempt) => {
                  const reservationFormDocument = documents.find((document) => document.sale_attempt_id === attempt.id && document.document_type === "reservation_form" && !document.redacted_at);
                  const reservationFormVersion = reservationFormDocument
                    ? versions
                      .filter((version) => version.document_id === reservationFormDocument.id && !version.redacted_at)
                      .sort((a, b) => Number(b.is_current) - Number(a.is_current) || b.version_number - a.version_number)[0] ?? null
                    : null;

                  return (
                    <div key={attempt.id} className="rounded-md border border-[#e2ded3] bg-white p-3 text-sm">
                      <p className="font-semibold text-[#34413a]">Attempt {attempt.attempt_number} ended {formatDate(attempt.fallen_through_at)}</p>
                      <button className="mt-2 text-xs underline" onClick={() => { setConversationTarget({ unit: selectedUnit.id, sale: attempt.id }); setConversationIntent("open"); }}>Open this transaction’s comments</button>
                      <p className="mt-1 text-[#617169]">{attempt.fall_through_reason ?? "No reason recorded."}</p>
                      <dl className="mt-3 grid gap-2 border-t border-[#eef0eb] pt-3 sm:grid-cols-3">
                        <div>
                          <dt className="text-xs font-semibold uppercase tracking-wide text-[#617169]">Buyer</dt>
                          <dd className="mt-1 whitespace-pre-line font-semibold text-[#34413a]">{buyerDisplay(attempt)}</dd>
                        </div>
                        <div>
                          <dt className="text-xs font-semibold uppercase tracking-wide text-[#617169]">Reservation date</dt>
                          <dd className="mt-1 font-semibold text-[#34413a]">{attempt.reservation_date ? formatDate(attempt.reservation_date) : "Not recorded"}</dd>
                        </div>
                        <div>
                          <dt className="text-xs font-semibold uppercase tracking-wide text-[#617169]">Reservation form</dt>
                          <dd className="mt-1">
                            {reservationFormVersion ? (
                              <button className="font-semibold text-[#0F3D2E] underline underline-offset-2" type="button" onClick={() => void openDocumentVersion(reservationFormVersion)}>
                                {reservationFormVersion.file_name}
                              </button>
                            ) : "Not available"}
                          </dd>
                        </div>
                      </dl>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {activeUnitSection === "financials" && (!activeAttempt || !reservationApproved) && (
            <section id="agent-fees" role="tabpanel" aria-labelledby="sale-file-tab-financials" className="rounded-b-bw-panel border border-t-0 border-[#d9ded6] bg-white p-5 text-sm text-[#617169]">
              Agent fees become available after the reservation is approved.
            </section>
          )}
          </SaleConversationLayout>
        </section>
      )}
    </div>
  );
}
