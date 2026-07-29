"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { FileText, UploadCloud, X } from "lucide-react";
import type { User } from "@supabase/supabase-js";
import type { AppRole, Building, BuildingFloor, Unit } from "@/lib/data/production";
import { GbpInput } from "@/components/portal/sales/GbpInput";
import { calculateAgentInvoicePreview as invoicePreview, calculateDeveloperNet } from "@/lib/sales/commercial-model";
import { buildDepositStructure, describeReservationFeeHolder, paymentScheduleSummary } from "@/lib/sales/deal-structure";
import { formatGbp, formatGbpDeduction, parseGbpInput } from "@/lib/sales/currency";
import { canPerformSalesAction } from "@/lib/sales/permissions";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { SalesForecastingModule } from "@/components/portal/sales/SalesForecastingModule";

type Profile = {
  id: string;
  role: AppRole;
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
  reservation_submitted_at: string | null;
  reservation_terms_checked: boolean | null;
  reservation_submitted_by_user_id: string | null;
  reservation_submitted_by_name: string | null;
  reservation_submitted_by_email: string | null;
  reservation_approved_at: string | null;
  reservation_approved_by_user_id: string | null;
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
  title: string;
  status: string;
  query_note: string | null;
  redacted_at: string | null;
};

type SaleDocumentVersion = {
  id: string;
  document_id: string;
  version_number: number;
  file_name: string;
  file_size_bytes: number | null;
  uploaded_at: string;
  redacted_at: string | null;
};

type SaleInvoice = {
  id: string;
  sale_attempt_id: string;
  document_id: string | null;
  invoice_reference: string | null;
  invoice_date: string | null;
  net_amount: number | null;
  vat_amount: number | null;
  gross_amount: number | null;
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
  amount: number;
  paid_at: string | null;
  notes: string | null;
};

type SalesStageFilter = Unit["sale_status"] | "all";
type SaleWorkflowStage = "reservation" | "exchange" | "completion" | "handover";

const SALES_PAGE_SIZE = 12;
const SALES_STAGE_FILTERS: Array<{ value: SalesStageFilter; label: string }> = [
  { value: "for_sale", label: "For Sale" },
  { value: "reserved", label: "Reserved" },
  { value: "exchanged", label: "Exchanged" },
  { value: "completed", label: "Completed" },
  { value: "all", label: "All sales" },
];

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
  if (attempt?.stage_entered_at) return attempt.stage_entered_at;
  if (unit.sale_status === "completed") return attempt?.completed_at ?? unit.completion_date ?? attempt?.created_at ?? null;
  if (unit.sale_status === "exchanged") return attempt?.exchanged_at ?? attempt?.commercial_approved_at ?? attempt?.created_at ?? null;
  if (unit.sale_status === "reserved") return attempt?.reservation_approved_at ?? attempt?.reservation_submitted_at ?? attempt?.created_at ?? null;
  return attempt?.created_at ?? null;
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    draft: "Draft",
    reservation_submitted: "Submitted",
    reservation_query_raised: "Query raised",
    reservation_approved: "Approved",
    awaiting_commercial_approval: "Awaiting commercial approval",
    ready_for_exchange: "Ready for Exchange",
    completion_pending: "Completion pending",
    completed: "Completed",
    fallen_through: "Failed",
    superseded: "Superseded",
  };
  return labels[status] ?? status.replace(/_/g, " ");
}

function saleStatusLabel(status: Unit["sale_status"]) {
  const labels: Record<Unit["sale_status"], string> = {
    for_sale: "For Sale",
    reserved: "Reserved",
    exchanged: "Exchanged",
    completed: "Completed",
    handed_over: "Handed Over",
  };
  return labels[status] ?? status;
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

function formatPercentValue(value?: number | null) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "-";
  return `${Number(value).toLocaleString("en-GB", { maximumFractionDigits: 2 })}%`;
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

function FieldValue({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div className="rounded-md border border-[#eef0eb] bg-white p-3">
      <span className="block text-xs font-bold uppercase tracking-[0.08em] text-[#617169]">{label}</span>
      <strong className="mt-1 block whitespace-pre-line text-sm text-[#0F3D2E]">{value || "-"}</strong>
    </div>
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
}: {
  id: string;
  label: string;
  file: File | null;
  currentVersion?: SaleDocumentVersion | null;
  disabled?: boolean;
  onOpen?: () => void;
  onFile: (file: File | null) => void;
  onClear: () => void;
}) {
  const selectedName = file?.name ?? null;

  if (currentVersion && !file) {
    return (
      <div className="rounded-lg border border-[#d9ded6] bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <span className="mt-1 rounded-full bg-[#EEF6F1] p-2 text-[#0F3D2E]"><FileText size={18} aria-hidden /></span>
            <div>
              <p className="font-bold text-[#0F3D2E]">{currentVersion.file_name}</p>
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
          <label className="secondary mt-3 inline-flex w-fit cursor-pointer items-center gap-2">
            Replace PDF
            <input className="sr-only" type="file" accept="application/pdf" onChange={(event) => onFile(event.target.files?.[0] ?? null)} />
          </label>
        )}
      </div>
    );
  }

  return (
    <label
      className={`block rounded-lg border border-dashed p-5 text-center transition ${disabled ? "cursor-not-allowed border-[#d9ded6] bg-[#f4f6f3] opacity-70" : "cursor-pointer border-[#cdbd9d] bg-white hover:border-[#0F3D2E]"}`}
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
        <span className="mt-3 inline-flex items-center gap-2 rounded-full border border-[#d9ded6] bg-[#F7F5EF] px-3 py-1 text-sm font-semibold text-[#0F3D2E]">
          {selectedName}
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

export function SalesReservationWorkflow({
  user,
  profile,
  buildings,
  buildingFloors,
  units,
  onNotice,
  reloadPortalData,
}: {
  user: User;
  profile: Profile | null;
  buildings: Building[];
  buildingFloors: BuildingFloor[];
  units: Unit[];
  onNotice: (notice: string) => void;
  reloadPortalData: () => Promise<void>;
}) {
  const commercialModelControlRef = useRef<HTMLDivElement | null>(null);
  const [buildingId, setBuildingId] = useState(buildings[0]?.id ?? "");
  const buildingUnits = useMemo(
    () => sortUnitsByFloorOrder(
      units.filter((unit) => unit.building_id === buildingId),
      buildingFloors,
      buildingId,
    ),
    [buildingFloors, buildingId, units],
  );
  const [unitId, setUnitId] = useState(buildingUnits[0]?.id ?? "");
  const [attempts, setAttempts] = useState<SaleAttempt[]>([]);
  const [terms, setTerms] = useState<SaleTerms[]>([]);
  const [buildingSaleDefaults, setBuildingSaleDefaults] = useState<BuildingSaleDefault[]>([]);
  const [paymentSchedule, setPaymentSchedule] = useState<PaymentScheduleRow[]>([]);
  const [documents, setDocuments] = useState<SaleDocument[]>([]);
  const [versions, setVersions] = useState<SaleDocumentVersion[]>([]);
  const [invoices, setInvoices] = useState<SaleInvoice[]>([]);
  const [invoicePayments, setInvoicePayments] = useState<SaleInvoicePayment[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [buyerPersonName, setBuyerPersonName] = useState("");
  const [buyerCompanyName, setBuyerCompanyName] = useState("");
  const [buyerEmail, setBuyerEmail] = useState("");
  const [buyerPhone, setBuyerPhone] = useState("");
  const [buyerSolicitorName, setBuyerSolicitorName] = useState("");
  const [reservationTermsChecked, setReservationTermsChecked] = useState(false);
  const [contractPrice, setContractPrice] = useState("");
  const [reservationFee, setReservationFee] = useState("");
  const [reservationFeeHolder, setReservationFeeHolder] = useState("sales_agent");
  const [reservationFormFile, setReservationFormFile] = useState<File | null>(null);
  const [parkingValue, setParkingValue] = useState("");
  const [developerContribution, setDeveloperContribution] = useState("");
  const [developerContributionValueType, setDeveloperContributionValueType] = useState<"amount" | "percent">("amount");
  const [agentContribution, setAgentContribution] = useState("");
  const [agentContributionValueType, setAgentContributionValueType] = useState<"amount" | "percent">("amount");
  const [parkingContributionValue, setParkingContributionValue] = useState("");
  const [parkingLocationDetails, setParkingLocationDetails] = useState("");
  const [additionalSpecialConditions, setAdditionalSpecialConditions] = useState<string[]>([""]);
  const [agentFeePercent, setAgentFeePercent] = useState("");
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
  const [exchangeDate, setExchangeDate] = useState("");
  const [solicitorPaymentAmount, setSolicitorPaymentAmount] = useState("");
  const [solicitorPaymentDate, setSolicitorPaymentDate] = useState("");
  const [developerShortfallAmount, setDeveloperShortfallAmount] = useState("");
  const [developerShortfallDate, setDeveloperShortfallDate] = useState("");
  const [reconciliationNotes, setReconciliationNotes] = useState("");
  const [completionStatementFile, setCompletionStatementFile] = useState<File | null>(null);
  const [statementOfAccountFile, setStatementOfAccountFile] = useState<File | null>(null);
  const [completionQueryNote, setCompletionQueryNote] = useState("");
  const [completionDate, setCompletionDate] = useState("");
  const [queryNote, setQueryNote] = useState("");
  const [failReason, setFailReason] = useState("");
  const [selectedSaleUnitId, setSelectedSaleUnitId] = useState("");
  const [salesStageFilter, setSalesStageFilter] = useState<SalesStageFilter>("all");
  const [salesSearch, setSalesSearch] = useState("");
  const [salesPage, setSalesPage] = useState(1);
  const [activeWorkflowStage, setActiveWorkflowStage] = useState<SaleWorkflowStage>("reservation");
  const [showCommercialModel, setShowCommercialModel] = useState(false);
  const [showAdvancedDealSetup, setShowAdvancedDealSetup] = useState(false);
  const [showForecasting, setShowForecasting] = useState(false);
  const [showFailReservationConfirm, setShowFailReservationConfirm] = useState(false);
  const [confirmFailReservation, setConfirmFailReservation] = useState(false);
  const [hasReadSalesUrl, setHasReadSalesUrl] = useState(false);

  const role = profile?.role ?? "user";
  const canSubmitReservation = canPerformSalesAction(role, "submit_reservation");
  const canApproveReservation = canPerformSalesAction(role, "approve_reservation");
  const canFailReservation = canPerformSalesAction(role, "fail_reservation");
  const canSubmitAgentInvoice = canPerformSalesAction(role, "submit_agent_invoice");
  const canManageCommercialTerms = canPerformSalesAction(role, "manage_commercial_terms");
  const canApproveCommercialPackage = canPerformSalesAction(role, "approve_commercial_package");
  const canRecordExchange = canPerformSalesAction(role, "record_exchange");
  const canRecordSolicitorPayment = canPerformSalesAction(role, "record_solicitor_payment");
  const canRecordDeveloperShortfall = canPerformSalesAction(role, "record_developer_shortfall");
  const canSubmitCompletionDocuments = canPerformSalesAction(role, "submit_completion_documents");
  const canApproveCompletionDocuments = canPerformSalesAction(role, "approve_completion_documents");
  const canRecordCompletion = canPerformSalesAction(role, "record_completion");
  const selectedUnit = units.find((unit) => unit.id === unitId);
  const selectedBuilding = buildings.find((building) => building.id === buildingId);
  const selectedBuildingDefault = buildingSaleDefaults.find((item) => item.building_id === buildingId) ?? null;
  const activeAttempt = attempts.find((attempt) => attempt.unit_id === unitId && attempt.is_active);
  const failedAttempts = attempts.filter((attempt) => attempt.unit_id === unitId && attempt.workflow_status === "fallen_through");
  const activeTerms = activeAttempt ? terms.find((item) => item.sale_attempt_id === activeAttempt.id && item.is_current) : null;
  const reservationDocument = activeAttempt ? documents.find((item) => item.sale_attempt_id === activeAttempt.id && item.document_type === "reservation_form") : null;
  const reservationVersion = reservationDocument ? versions.find((item) => item.document_id === reservationDocument.id && !item.redacted_at) : null;
  const agentInvoiceDocument = activeAttempt ? documents.find((item) => item.sale_attempt_id === activeAttempt.id && item.document_type === "agent_invoice") : null;
  const agentInvoiceVersion = agentInvoiceDocument ? versions.find((item) => item.document_id === agentInvoiceDocument.id && !item.redacted_at) : null;
  const completionStatementDocument = activeAttempt ? documents.find((item) => item.sale_attempt_id === activeAttempt.id && item.document_type === "completion_statement") : null;
  const completionStatementVersion = completionStatementDocument ? versions.find((item) => item.document_id === completionStatementDocument.id && !item.redacted_at) : null;
  const statementOfAccountDocument = activeAttempt ? documents.find((item) => item.sale_attempt_id === activeAttempt.id && item.document_type === "statement_of_account") : null;
  const statementOfAccountVersion = statementOfAccountDocument ? versions.find((item) => item.document_id === statementOfAccountDocument.id && !item.redacted_at) : null;
  const activeInvoice = activeAttempt ? invoices.find((item) => item.sale_attempt_id === activeAttempt.id) : null;
  const activeInvoicePayments = activeInvoice ? invoicePayments.filter((item) => item.invoice_id === activeInvoice.id) : [];
  const solicitorPayment = activeInvoicePayments.find((item) => item.payment_source === "solicitor_deposit");
  const developerShortfallPayment = activeInvoicePayments.find((item) => item.payment_source === "developer_shortfall");
  const activePaymentSchedule = activeAttempt ? paymentSchedule.filter((item) => item.sale_attempt_id === activeAttempt.id).sort((a, b) => a.sequence_no - b.sequence_no) : [];
  const reservationApproved = activeAttempt ? ["reservation_approved", "awaiting_commercial_approval", "ready_for_exchange", "exchanged", "completion_pending", "completed"].includes(activeAttempt.workflow_status) : false;
  const commercialApproved = activeAttempt?.workflow_status === "ready_for_exchange" || Boolean(activeAttempt?.commercial_approved_at);
  const readyForExchange = activeAttempt ? ["ready_for_exchange", "exchanged", "completion_pending", "completed"].includes(activeAttempt.workflow_status) : false;
  const exchangeRecorded = activeAttempt ? ["exchanged", "completion_pending", "completed"].includes(activeAttempt.workflow_status) || Boolean(activeAttempt.exchanged_at) : false;
  const completionDocumentsApproved = completionStatementDocument?.status === "approved" && statementOfAccountDocument?.status === "approved";
  const completionReady = activeAttempt ? ["completion_pending", "completed"].includes(activeAttempt.workflow_status) || completionDocumentsApproved : false;
  const completionRecorded = activeAttempt ? activeAttempt.workflow_status === "completed" || Boolean(activeAttempt.completed_at) : false;
  const displayAgentFeePercent = activeTerms?.agent_fee_percent ?? selectedBuildingDefault?.default_agent_fee_percent ?? 0;
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
  const previewAgentFeePercent = normaliseNumberInput(agentFeePercent) ?? displayAgentFeePercent;
  const previewReservationFee = parseGbpInput(reservationFee) ?? displayReservationFee;
  const previewDeveloperContributionValue = parseGbpInput(developerContribution) ?? activeTerms?.developer_contribution_value ?? activeTerms?.developer_contribution ?? 0;
  const previewDeveloperContributionType = developerContributionValueType;
  const previewDeveloperContributionAmount = contributionAmount(previewDeveloperContributionValue, previewDeveloperContributionType, previewContractPrice);
  const previewAgentContributionValue = parseGbpInput(agentContribution) ?? activeTerms?.agent_contribution_value ?? activeTerms?.agent_contribution ?? 0;
  const previewAgentContributionType = agentContributionValueType;
  const previewAgentContribution = contributionAmount(previewAgentContributionValue, previewAgentContributionType, previewContractPrice);
  const previewParkingContribution = parseGbpInput(parkingContributionValue) ?? activeTerms?.parking_contribution_value ?? 0;
  const previewDepositStructure = buildDepositStructure({
    exchangeDepositPercent: normaliseNumberInput(exchangeDepositPercent) ?? displayDepositStructure.exchangeDepositPercent,
    secondDepositEnabled,
    secondDepositPercent: normaliseNumberInput(secondDepositPercent) ?? 0,
    secondDepositMonthsAfterExchange: normaliseNumberInput(secondDepositMonthsAfterExchange) ?? null,
  });
  const previewInvoice = invoicePreview({
    contractPrice: previewContractPrice,
    agentFeePercent: previewAgentFeePercent,
    vatRate: displayVatRate,
    reservationFee: previewReservationFee,
    reservationFeeHolder,
    agentContribution: previewAgentContribution,
  });
  const uploadedInvoiceGross = activeInvoice?.gross_amount ?? parseGbpInput(invoiceGrossAmount);
  const invoiceVariance = uploadedInvoiceGross === null || uploadedInvoiceGross === undefined ? null : uploadedInvoiceGross - previewInvoice.expectedPayableAmount;
  const permittedRelease = activePaymentSchedule
    .filter((row) => row.payment_stage === "exchange")
    .reduce((total, row) => total + scheduleAmount(row, activeTerms?.contract_price), 0);
  const recordedSolicitorPayment = parseGbpInput(solicitorPaymentAmount) ?? solicitorPayment?.amount ?? 0;
  const recordedDeveloperShortfall = parseGbpInput(developerShortfallAmount) ?? developerShortfallPayment?.amount ?? 0;
  const otherInvoicePayments = activeInvoicePayments
    .filter((payment) => payment.payment_source !== "solicitor_deposit" && payment.payment_source !== "developer_shortfall")
    .reduce((total, payment) => total + Number(payment.amount ?? 0), 0);
  const previewPaidAgainstInvoice = otherInvoicePayments + recordedSolicitorPayment + recordedDeveloperShortfall;
  const totalReceivedByAgent = previewInvoice.reservationFeeDeduction + previewPaidAgainstInvoice;
  const expectedPayableAmount = activeInvoice?.expected_payable_amount ?? previewInvoice.expectedPayableAmount;
  const outstandingDeveloperBalance = Math.max(0, expectedPayableAmount - previewPaidAgainstInvoice);
  const invoiceReconciled = activeInvoice?.status === "reconciled";
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
  const agentInvoiceForTerms = (saleTerms?: SaleTerms | null) => invoicePreview({
    contractPrice: saleTerms?.contract_price ?? saleTerms?.list_price_at_offer ?? 0,
    agentFeePercent: saleTerms?.agent_fee_percent ?? 0,
    vatRate: saleTerms?.vat_rate ?? 20,
    reservationFee: saleTerms?.reservation_fee ?? 0,
    reservationFeeHolder: saleTerms?.reservation_fee_holder ?? "sales_agent",
    agentContribution: saleTerms?.agent_contribution ?? 0,
  });
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
  const buyerIdentityEntered = Boolean(buyerPersonName.trim() || buyerCompanyName.trim());
  const submittedByName = activeAttempt?.reservation_submitted_by_name ?? "-";
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
    if (unit.sale_status === "reserved" || attempt?.reservation_approved_at || ["reservation_approved", "awaiting_commercial_approval", "ready_for_exchange"].includes(attempt?.workflow_status ?? "")) return "exchange";
    return "reservation";
  }
  const selectedWorkflowStage: SaleWorkflowStage = selectedUnit ? workflowStageForUnit(selectedUnit) : "reservation";
  const workflowOrder: SaleWorkflowStage[] = ["reservation", "exchange", "completion", "handover"];
  const currentWorkflowIndex = workflowOrder.indexOf(selectedWorkflowStage);
  const workflowStages = [
    {
      key: "reservation" as const,
      label: "Reservation",
      owner: "Sales agent / Developer",
      status: reservationApproved ? "Approved" : activeAttempt?.workflow_status === "reservation_query_raised" ? "Query raised" : activeAttempt ? "Submitted" : "Not started",
      summary: "Buyer details, reservation fee, reservation form and developer approval.",
    },
    {
      key: "exchange" as const,
      label: "Exchange",
      owner: "Developer / Conveyancer",
      status: exchangeRecorded ? "Exchanged" : commercialApproved ? "Ready" : reservationApproved ? "Commercial approval" : "Locked",
      summary: "Commercial approval, agent invoice, exchange date and post-exchange payments.",
    },
    {
      key: "completion" as const,
      label: "Completion",
      owner: "Conveyancer / Developer",
      status: completionRecorded ? "Completed" : exchangeRecorded ? "Documents required" : "Locked",
      summary: "Completion statement, statement of account, approval and completion date.",
    },
    {
      key: "handover" as const,
      label: "Handover",
      owner: "Developer / Resident",
      status: completionRecorded ? "Available" : "Locked",
      summary: "Existing handover workflow becomes available after completion.",
    },
  ];
  const reservationState: "not_started" | "awaiting_developer_review" | "queried" | "approved" | "failed" = (() => {
    if (activeAttempt?.workflow_status === "fallen_through") return "failed";
    if (reservationApproved) return "approved";
    if (activeAttempt?.workflow_status === "reservation_query_raised") return "queried";
    if (activeAttempt?.workflow_status === "reservation_submitted") return "awaiting_developer_review";
    return "not_started";
  })();
  const reservationStateLabel: Record<typeof reservationState, string> = {
    not_started: "Not started",
    awaiting_developer_review: "Awaiting developer review",
    queried: "Query raised",
    approved: "Approved",
    failed: "Failed",
  };
  const reservationCanBeEdited = canSubmitReservation && ["not_started", "queried"].includes(reservationState);
  const reservationCanBeReviewed = canApproveReservation && reservationState === "awaiting_developer_review";
  const reservationCanFail = canFailReservation && activeAttempt && ["reservation_submitted", "reservation_query_raised", "reservation_approved"].includes(activeAttempt.workflow_status);
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
  const pipelineSummary = (["for_sale", "reserved", "exchanged", "completed"] as const).map((status) => {
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
    const matchesSearch = unit.unit_number.toLowerCase().includes(salesSearch.trim().toLowerCase());
    return matchesStatus && matchesSearch;
  });
  const salesPageCount = Math.max(1, Math.ceil(filteredSalesUnits.length / SALES_PAGE_SIZE));
  const currentSalesPage = Math.min(salesPage, salesPageCount);
  const pagedSalesUnits = filteredSalesUnits.slice((currentSalesPage - 1) * SALES_PAGE_SIZE, currentSalesPage * SALES_PAGE_SIZE);

  function nextActionForUnit(unit: Unit) {
    const attempt = activeAttemptByUnit.get(unit.id);
    if (!attempt) return "Reserve unit";
    if (attempt.workflow_status === "reservation_query_raised") return "Resolve reservation query";
    if (unit.sale_status === "for_sale") return "Reserve unit";
    if (unit.sale_status === "reserved") {
      if (!attempt.commercial_approved_at && attempt.workflow_status !== "ready_for_exchange") return "Commercial approval";
      return "Record exchange";
    }
    if (unit.sale_status === "exchanged") return "Completion documents";
    if (unit.sale_status === "completed") return "Handover available";
    return "Review sale file";
  }

  function writeSalesUrl(next: { building?: string; unit?: string | null; filter?: SalesStageFilter | null }) {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    params.set("screen", "sales");
    if (next.building) params.set("salesBuildingId", next.building);
    if (next.unit === null) params.delete("salesUnitId");
    if (next.unit) params.set("salesUnitId", next.unit);
    if (next.filter === null) params.delete("salesFilter");
    if (next.filter) params.set("salesFilter", next.filter);
    window.history.pushState(null, "", `${window.location.pathname}?${params.toString()}`);
  }

  function openSaleFile(nextUnitId: string) {
    setUnitId(nextUnitId);
    setSelectedSaleUnitId(nextUnitId);
    setShowCommercialModel(false);
    const nextUnit = units.find((unit) => unit.id === nextUnitId);
    setActiveWorkflowStage(nextUnit ? workflowStageForUnit(nextUnit) : "reservation");
    writeSalesUrl({ building: buildingId, unit: nextUnitId, filter: salesStageFilter });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function backToSalesOverview() {
    setSelectedSaleUnitId("");
    setShowCommercialModel(false);
    writeSalesUrl({ building: buildingId, unit: null, filter: salesStageFilter });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  useEffect(() => {
    if (hasReadSalesUrl || typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const urlBuildingId = params.get("salesBuildingId");
    const urlUnitId = params.get("salesUnitId");
    const urlFilter = params.get("salesFilter") as SalesStageFilter | null;

    if (urlBuildingId && buildings.some((building) => building.id === urlBuildingId)) {
      setBuildingId(urlBuildingId);
    }

    if (urlUnitId && units.some((unit) => unit.id === urlUnitId)) {
      const urlUnit = units.find((unit) => unit.id === urlUnitId);
      setUnitId(urlUnitId);
      setSelectedSaleUnitId(urlUnitId);
      if (urlUnit) {
        setBuildingId(urlUnit.building_id);
        setActiveWorkflowStage(workflowStageForUnit(urlUnit));
      }
    }

    if (urlFilter && SALES_STAGE_FILTERS.some((filter) => filter.value === urlFilter)) {
      setSalesStageFilter(urlFilter);
    }

    setHasReadSalesUrl(true);
  }, [buildings, hasReadSalesUrl, units]);

  useEffect(() => {
    setSalesPage(1);
  }, [buildingId, salesSearch, salesStageFilter]);

  useEffect(() => {
    if (selectedSaleUnitId && selectedUnit) setActiveWorkflowStage(selectedWorkflowStage);
  }, [selectedSaleUnitId, selectedUnit, selectedWorkflowStage]);

  useEffect(() => {
    if (!buildingId && buildings[0]) setBuildingId(buildings[0].id);
    if (buildingId && !buildings.some((building) => building.id === buildingId)) setBuildingId(buildings[0]?.id ?? "");
  }, [buildingId, buildings]);

  useEffect(() => {
    if (buildingUnits.length > 0 && !buildingUnits.some((unit) => unit.id === unitId)) setUnitId(buildingUnits[0].id);
    if (buildingUnits.length === 0 && unitId) setUnitId("");
  }, [buildingUnits, unitId]);

  useEffect(() => {
    if (!activeAttempt) {
      setBuyerPersonName("");
      setBuyerCompanyName("");
      setBuyerEmail("");
      setBuyerPhone("");
      setBuyerSolicitorName("");
      setReservationTermsChecked(false);
      setContractPrice("");
      setReservationFee(selectedBuildingDefault?.reservation_fee?.toString() ?? "");
      setReservationFeeHolder(selectedBuildingDefault?.reservation_fee_holder_default ?? "sales_agent");
      setReservationFormFile(null);
      setParkingValue("");
      setDeveloperContribution("");
      setDeveloperContributionValueType("amount");
      setAgentContribution("");
      setAgentContributionValueType("amount");
      setParkingContributionValue("");
      setParkingLocationDetails("");
      setAdditionalSpecialConditions([""]);
      setAgentFeePercent(selectedBuildingDefault?.default_agent_fee_percent?.toString() ?? "");
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
      setExchangeDate("");
      setSolicitorPaymentAmount("");
      setSolicitorPaymentDate("");
      setDeveloperShortfallAmount("");
      setDeveloperShortfallDate("");
      setReconciliationNotes("");
      setCompletionStatementFile(null);
      setStatementOfAccountFile(null);
      setCompletionQueryNote("");
      setCompletionDate("");
      setQueryNote("");
      setFailReason("");
      setShowFailReservationConfirm(false);
      setConfirmFailReservation(false);
      setShowAdvancedDealSetup(false);
      return;
    }

    const storedCompanyName = activeAttempt.buyer_company_name?.trim() || "";
    const storedPersonName = activeAttempt.buyer_person_name?.trim() || "";
    setBuyerPersonName(storedPersonName || (storedCompanyName ? "" : activeAttempt.buyer_name ?? ""));
    setBuyerCompanyName(storedCompanyName);
    setBuyerEmail(activeAttempt.buyer_email ?? "");
    setBuyerPhone(activeAttempt.buyer_phone ?? "");
    setBuyerSolicitorName(activeAttempt.buyer_solicitor_name ?? "");
    setReservationTermsChecked(Boolean(activeAttempt.reservation_terms_checked));
    setContractPrice(activeTerms?.contract_price?.toString() ?? activeTerms?.list_price_at_offer?.toString() ?? "");
    setReservationFee(activeTerms?.reservation_fee?.toString() ?? selectedBuildingDefault?.reservation_fee?.toString() ?? "");
    setReservationFeeHolder(activeTerms?.reservation_fee_holder ?? selectedBuildingDefault?.reservation_fee_holder_default ?? "sales_agent");
    setParkingValue(activeTerms?.parking_value?.toString() ?? "");
    setDeveloperContribution((activeTerms?.developer_contribution_value ?? activeTerms?.developer_contribution)?.toString() ?? "");
    setDeveloperContributionValueType(activeTerms?.developer_contribution_value_type ?? "amount");
    setAgentContribution((activeTerms?.agent_contribution_value ?? activeTerms?.agent_contribution)?.toString() ?? "");
    setAgentContributionValueType(activeTerms?.agent_contribution_value_type ?? "amount");
    setParkingContributionValue(activeTerms?.parking_contribution_value?.toString() ?? "");
    setParkingLocationDetails("");
    const loadedAdditionalConditions = activeTerms?.additional_special_conditions?.filter((condition) => condition.trim()) ?? [];
    const legacyParkingCondition = activeTerms?.parking_location_details?.trim();
    const combinedAdditionalConditions = [
      ...loadedAdditionalConditions,
      ...(legacyParkingCondition && !loadedAdditionalConditions.some((condition) => condition.toLowerCase() === legacyParkingCondition.toLowerCase()) ? [legacyParkingCondition] : []),
    ];
    setAdditionalSpecialConditions(combinedAdditionalConditions.length ? combinedAdditionalConditions : [""]);
    setAgentFeePercent(activeTerms?.agent_fee_percent?.toString() ?? selectedBuildingDefault?.default_agent_fee_percent?.toString() ?? "");
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
    setReservationFormFile(null);
    setAgentInvoiceFile(null);
    setExchangeDate(activeAttempt.exchanged_at ?? "");
    setSolicitorPaymentAmount(solicitorPayment?.amount?.toString() ?? "");
    setSolicitorPaymentDate(solicitorPayment?.paid_at ?? "");
    setDeveloperShortfallAmount(developerShortfallPayment?.amount?.toString() ?? "");
    setDeveloperShortfallDate(developerShortfallPayment?.paid_at ?? "");
    setReconciliationNotes(solicitorPayment?.notes ?? developerShortfallPayment?.notes ?? "");
    setCompletionStatementFile(null);
    setStatementOfAccountFile(null);
    setCompletionQueryNote(completionStatementDocument?.query_note ?? statementOfAccountDocument?.query_note ?? "");
    setCompletionDate(activeAttempt.completed_at ?? "");
    setQueryNote(reservationDocument?.query_note ?? "");
    setFailReason("");
    setShowFailReservationConfirm(false);
    setConfirmFailReservation(false);
    setShowAdvancedDealSetup(false);
  }, [activeAttempt, activeInvoice, activeTerms, completionStatementDocument, developerShortfallPayment, reservationDocument, selectedBuildingDefault, solicitorPayment, statementOfAccountDocument]);

  async function loadSalesData() {
    const supabase = createSupabaseBrowserClient();
    if (buildingId) {
      const { data: defaultRows, error: defaultsError } = await supabase
        .from("building_sale_defaults")
        .select("*")
        .eq("building_id", buildingId);
      if (defaultsError) onNotice(defaultsError.message);
      else setBuildingSaleDefaults((defaultRows ?? []) as BuildingSaleDefault[]);
    }

    if (buildingUnits.length === 0) {
      setAttempts([]);
      setTerms([]);
      setPaymentSchedule([]);
      setDocuments([]);
      setVersions([]);
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
        setInvoices([]);
        setInvoicePayments([]);
        return;
      }

      const [termsResult, scheduleResult, documentsResult, invoicesResult, invoicePaymentsResult] = await Promise.all([
        supabase.from("unit_sale_terms").select("*").in("sale_attempt_id", attemptIds),
        supabase.from("unit_sale_payment_schedule").select("*").in("sale_attempt_id", attemptIds).order("sequence_no"),
        supabase.from("unit_sale_documents").select("*").in("sale_attempt_id", attemptIds),
        supabase.from("unit_sale_invoices").select("*").in("sale_attempt_id", attemptIds),
        supabase.from("unit_sale_invoice_payments").select("*").in("sale_attempt_id", attemptIds),
      ]);
      if (termsResult.error) throw termsResult.error;
      if (scheduleResult.error) throw scheduleResult.error;
      if (documentsResult.error) throw documentsResult.error;
      if (invoicesResult.error) throw invoicesResult.error;
      if (invoicePaymentsResult.error) throw invoicePaymentsResult.error;

      const loadedDocuments = (documentsResult.data ?? []) as SaleDocument[];
      setTerms((termsResult.data ?? []) as SaleTerms[]);
      setPaymentSchedule((scheduleResult.data ?? []) as PaymentScheduleRow[]);
      setDocuments(loadedDocuments);
      setInvoices((invoicesResult.data ?? []) as SaleInvoice[]);
      setInvoicePayments((invoicePaymentsResult.data ?? []) as SaleInvoicePayment[]);

      const documentIds = loadedDocuments.map((document) => document.id);
      if (documentIds.length === 0) {
        setVersions([]);
        return;
      }

      const { data: versionRows, error: versionsError } = await supabase
        .from("unit_sale_document_versions")
        .select("*")
        .in("document_id", documentIds)
        .eq("is_current", true);
      if (versionsError) throw versionsError;
      setVersions((versionRows ?? []) as SaleDocumentVersion[]);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Could not load sales data.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadSalesData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildingId, units.length]);

  function toggleCommercialModel() {
    const next = !showCommercialModel;
    setShowCommercialModel(next);
    if (!next) {
      setShowAdvancedDealSetup(false);
      return;
    }
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
      : "Reservation could not be completed.";
    const payload = await readApiPayload<{ error?: string; saleAttemptId?: string }>(response, fallback);
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
    if (!reservationTermsChecked) {
      onNotice("Confirm that the reservation form reflects the developer-approved commercial terms.");
      return;
    }
    if (!reservationFormFile && !reservationVersion) {
      onNotice("Upload the reservation form PDF before reserving the unit.");
      return;
    }

    setIsSaving(true);
    try {
      const payload = await postReservationJson({
        action: "save_reservation",
        unitId: selectedUnit.id,
        buyerPersonName,
        buyerCompanyName,
        buyerEmail,
        buyerPhone,
        buyerSolicitorName,
        reservationTermsChecked,
      });
      if (payload.saleAttemptId) await uploadReservationForm(payload.saleAttemptId);
      onNotice(reservationState === "queried" ? `Reservation resubmitted for Unit ${selectedUnit.unit_number}.` : `Reservation submitted for Unit ${selectedUnit.unit_number}.`);
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
      await postReservationJson({ action: "approve_reservation", saleAttemptId: activeAttempt.id });
      onNotice(`Reservation approved. Unit ${selectedUnit.unit_number} marked Reserved.`);
      await Promise.all([loadSalesData(), reloadPortalData()]);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Reservation could not be approved.");
    } finally {
      setIsSaving(false);
    }
  }

  async function queryReservation() {
    if (!activeAttempt) return;
    setIsSaving(true);
    try {
      await postReservationJson({ action: "query_reservation", saleAttemptId: activeAttempt.id, queryNote });
      onNotice("Reservation query raised.");
      await Promise.all([loadSalesData(), reloadPortalData()]);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Reservation could not be queried.");
    } finally {
      setIsSaving(false);
    }
  }

  async function failReservation() {
    if (!activeAttempt || !selectedUnit) return;
    if (!confirmFailReservation) {
      onNotice("Confirm the redaction before failing the reservation.");
      return;
    }
    setIsSaving(true);
    try {
      await postReservationJson({ action: "fail_reservation", saleAttemptId: activeAttempt.id, failReason });
      onNotice(`Reservation failed and redacted. Unit ${selectedUnit.unit_number} returned to For Sale.`);
      setShowFailReservationConfirm(false);
      setConfirmFailReservation(false);
      await Promise.all([loadSalesData(), reloadPortalData()]);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Reservation could not be failed.");
    } finally {
      setIsSaving(false);
    }
  }

  async function uploadAgentInvoice() {
    if (!activeAttempt) {
      onNotice("Create and approve a reservation before uploading the sales agent invoice.");
      return;
    }
    if (!agentInvoiceFile) {
      onNotice("Choose the sales agent invoice PDF before uploading.");
      return;
    }

    setIsSaving(true);
    try {
      const formData = new FormData();
      formData.set("action", "upload_agent_invoice");
      formData.set("saleAttemptId", activeAttempt.id);
      formData.set("file", agentInvoiceFile);
      const response = await fetch("/api/sales/reservations", {
        method: "POST",
        headers: await authHeaders(),
        body: formData,
      });
      const payload = await readApiPayload<{ error?: string }>(response, "Sales agent invoice upload failed.");
      if (!response.ok) throw new Error(payload.error ?? "Sales agent invoice upload failed.");
      onNotice("Sales agent invoice uploaded.");
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
        parkingContributionValue,
        parkingLocationDetails,
        additionalSpecialConditions,
        commercialSummary,
        invoiceReference,
        invoiceDate,
        invoiceNetAmount,
        invoiceVatAmount,
        invoiceGrossAmount,
      };
      if (showAdvancedDealSetup) {
        Object.assign(payload, {
          reservationFee,
          reservationFeeHolder,
          agentFeePercent,
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

  async function recordExchange() {
    if (!activeAttempt || !selectedUnit) return;
    if (!exchangeDate) {
      onNotice("Enter the actual exchange date.");
      return;
    }

    setIsSaving(true);
    try {
      await postReservationJson({ action: "record_exchange", saleAttemptId: activeAttempt.id, exchangeDate });
      onNotice(`Exchange recorded. Unit ${selectedUnit.unit_number} marked Exchanged.`);
      await Promise.all([loadSalesData(), reloadPortalData()]);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Exchange could not be recorded.");
    } finally {
      setIsSaving(false);
    }
  }

  async function saveInvoiceReconciliation() {
    if (!activeAttempt || !selectedUnit) return;
    setIsSaving(true);
    try {
      await postReservationJson({
        action: "record_invoice_reconciliation",
        saleAttemptId: activeAttempt.id,
        solicitorPaymentAmount: canRecordSolicitorPayment ? solicitorPaymentAmount : null,
        solicitorPaymentDate: canRecordSolicitorPayment ? solicitorPaymentDate : null,
        developerShortfallAmount: canRecordDeveloperShortfall ? developerShortfallAmount : null,
        developerShortfallDate: canRecordDeveloperShortfall ? developerShortfallDate : null,
        reconciliationNotes,
      });
      onNotice(`Invoice reconciliation saved for Unit ${selectedUnit.unit_number}.`);
      await Promise.all([loadSalesData(), reloadPortalData()]);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Invoice reconciliation could not be saved.");
    } finally {
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
    if (!activeAttempt) return;
    setIsSaving(true);
    try {
      await postReservationJson({ action: "approve_completion_documents", saleAttemptId: activeAttempt.id });
      onNotice("Completion documents approved.");
      await Promise.all([loadSalesData(), reloadPortalData()]);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Completion documents could not be approved.");
    } finally {
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
    if (!activeAttempt || !selectedUnit) return;
    if (!completionDate) {
      onNotice("Enter the actual completion date.");
      return;
    }

    setIsSaving(true);
    try {
      await postReservationJson({ action: "record_completion", saleAttemptId: activeAttempt.id, completionDate });
      onNotice(`Completion recorded. Unit ${selectedUnit.unit_number} marked Completed.`);
      await Promise.all([loadSalesData(), reloadPortalData()]);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Completion could not be recorded.");
    } finally {
      setIsSaving(false);
    }
  }

  if (!selectedSaleUnitId) {
    return (
      <div className="grid gap-5">
        <section className="panel">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-2xl font-bold text-[#0F3D2E]">Sales</h2>
              {selectedBuilding && (
                <>
                  <span className="hidden h-6 border-l border-[#d9ded6] sm:block" />
                  <span className="text-base font-semibold text-[#34413a]">{selectedBuilding.name}</span>
                </>
              )}
              <span className="rounded-full border border-[#d9ded6] bg-[#F7F5EF] px-3 py-1 text-sm font-semibold text-[#617169]">
                {buildingUnits.length} total units
              </span>
              <span className="text-sm text-[#617169]">Updated from current portal data</span>
            </div>
            <label className="field-label lg:w-[320px]">
              Building
              <select
                className="field"
                value={buildingId}
                onChange={(event) => {
                  setBuildingId(event.target.value);
                  setSelectedSaleUnitId("");
                  writeSalesUrl({ building: event.target.value, unit: null, filter: salesStageFilter });
                }}
              >
                {buildings.map((building) => <option key={building.id} value={building.id}>{building.name}</option>)}
              </select>
            </label>
          </div>
        </section>

        <section className="panel">
          <div>
            <h3 className="text-xl font-bold text-[#0F3D2E]">Financial overview</h3>
            <p className="mt-1 text-sm text-[#617169]">Forecast sales position for the selected building.</p>
          </div>
          <div className="mt-5 grid gap-4 xl:grid-cols-3">
            <div className="rounded-lg border border-[#d9ded6] bg-[#fbfcfa] p-4">
              <h4 className="font-bold text-[#0F3D2E]">Revenue view</h4>
              <p className="mt-1 text-sm text-[#617169]">List-price baseline compared with current sales forecast.</p>
              <div className="mt-4 grid gap-2 text-sm text-[#34413a]">
                <div className="flex justify-between gap-4 border-b border-[#eef0eb] pb-2"><span>Baseline GDV</span><strong className="numeric-value text-right">{money(baselineGdv)}</strong></div>
                <div className="flex justify-between gap-4 border-b border-[#eef0eb] pb-2"><span>Forecast revenue</span><strong className="numeric-value text-right text-[#0F3D2E]">{money(forecastRevenue)}</strong></div>
                <div className="flex justify-between gap-4"><span>Variance</span><strong className="numeric-value text-right">{money(forecastRevenue - baselineGdv)}</strong></div>
              </div>
            </div>
            <div className="rounded-lg border border-[#d9ded6] bg-[#fbfcfa] p-4">
              <h4 className="font-bold text-[#0F3D2E]">Cost / debt view</h4>
              <p className="mt-1 text-sm text-[#617169]">Core assumptions will be set in forecasting.</p>
              <div className="mt-4 grid gap-2 text-sm text-[#34413a]">
                <div className="flex justify-between gap-4 border-b border-[#eef0eb] pb-2"><span>Total development cost</span><strong className="numeric-value text-right">-</strong></div>
                <div className="flex justify-between gap-4 border-b border-[#eef0eb] pb-2"><span>Total debt</span><strong className="numeric-value text-right">-</strong></div>
                <div className="flex justify-between gap-4"><span>Net sales proceeds</span><strong className="numeric-value text-right text-[#0F3D2E]">{money(netSalesProceeds)}</strong></div>
              </div>
            </div>
            <div className="rounded-lg border border-[#d9ded6] bg-[#fbfcfa] p-4">
              <h4 className="font-bold text-[#0F3D2E]">Profit view</h4>
              <p className="mt-1 text-sm text-[#617169]">Forecast return once scheme cost and debt assumptions exist.</p>
              <div className="mt-4 grid gap-2 text-sm text-[#34413a]">
                <div className="flex justify-between gap-4 border-b border-[#eef0eb] pb-2"><span>Forecast profit</span><strong className="numeric-value text-right">-</strong></div>
                <div className="flex justify-between gap-4 border-b border-[#eef0eb] pb-2"><span>Profit margin</span><strong className="numeric-value text-right">-</strong></div>
                <div className="flex justify-between gap-4 border-b border-[#eef0eb] pb-2"><span>Return on cost</span><strong className="numeric-value text-right">-</strong></div>
                <div className="flex justify-between gap-4"><span>Valued sale records</span><strong className="numeric-value text-right">{saleValuesCount} of {buildingUnits.length}</strong></div>
              </div>
            </div>
          </div>
        </section>

        <section className="panel">
          <div>
            <h3 className="text-xl font-bold text-[#0F3D2E]">Sales pipeline</h3>
            <p className="mt-1 text-sm text-[#617169]">Click a stage to filter the sales table.</p>
          </div>
          <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {pipelineSummary.map((stage) => (
              <button
                key={stage.status}
                className={`rounded-lg border p-4 text-left transition ${salesStageFilter === stage.status ? "border-[#0F3D2E] bg-[#fbfcfa] shadow-sm" : "border-[#d9ded6] bg-[#fbfcfa] hover:border-[#0F3D2E]"}`}
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
              <input className="field" value={salesSearch} onChange={(event) => setSalesSearch(event.target.value)} placeholder="Unit number" />
            </label>
          </div>

          <div className="mt-5 overflow-x-auto rounded-lg border border-[#d9ded6]">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-[#fbfcfa] text-xs uppercase text-[#617169]">
                <tr>
                  <th className="border-b border-[#d9ded6] px-4 py-3">Unit</th>
                  <th className="border-b border-[#d9ded6] px-4 py-3">Stage</th>
                  <th className="border-b border-[#d9ded6] px-4 py-3 text-right">Price</th>
                  <th className="border-b border-[#d9ded6] px-4 py-3">Next action</th>
                  <th className="border-b border-[#d9ded6] px-4 py-3">Time in stage</th>
                </tr>
              </thead>
              <tbody>
                {pagedSalesUnits.length === 0 ? (
                  <tr>
                    <td className="px-4 py-6 text-center text-[#617169]" colSpan={5}>No units match this view.</td>
                  </tr>
                ) : pagedSalesUnits.map((unit) => {
                  const attempt = activeAttemptByUnit.get(unit.id);
                  return (
                    <tr
                      key={unit.id}
                      className="cursor-pointer bg-white hover:bg-[#fbfcfa]"
                      onClick={() => openSaleFile(unit.id)}
                    >
                      <td className="border-b border-[#eef0eb] px-4 py-3 font-bold text-[#0F3D2E]">Unit {unit.unit_number}</td>
                      <td className="border-b border-[#eef0eb] px-4 py-3">
                        <span className="rounded-full bg-[#F0EEE7] px-2 py-1 text-xs font-bold text-[#617169]">{saleStatusLabel(unit.sale_status)}</span>
                      </td>
                      <td className="numeric-value border-b border-[#eef0eb] px-4 py-3 text-right">{money(unitSaleValue(unit))}</td>
                      <td className="border-b border-[#eef0eb] px-4 py-3 text-[#34413a]">{nextActionForUnit(unit)}</td>
                      <td className="border-b border-[#eef0eb] px-4 py-3 text-[#34413a]">{daysSince(saleStatusDate(unit, attempt))}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

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
            <button className="secondary" onClick={() => setShowForecasting((value) => !value)}>
              {showForecasting ? "Hide forecasting" : "Open forecasting"}
            </button>
          </div>
          {showForecasting && (
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
    <div className="grid gap-5">
      <section className="panel">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <button className="secondary w-fit" onClick={backToSalesOverview}>
            &lt; Back to sales overview
          </button>
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
                  .map((unit) => <option key={unit.id} value={unit.id}>Unit {unit.unit_number} - {saleStatusLabel(unit.sale_status)}</option>)}
              </select>
            </label>
          </div>
        </div>
      </section>

      {selectedUnit && (
        <section className="panel">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#D6A23A]">Selected sale file</p>
              <h3 className="mt-1 text-2xl font-bold text-[#0F3D2E]">Unit {selectedUnit.unit_number}</h3>
              <p className="text-sm text-[#617169]">{selectedBuilding?.name ?? "Building"} / {selectedUnit.floor ?? "No floor"}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <span className="rounded-full border border-[#d9ded6] bg-[#F7F5EF] px-3 py-1 text-xs font-bold text-[#617169]">{saleStatusLabel(selectedUnit.sale_status)}</span>
              {activeAttempt && <span className="rounded-full border border-[#d9ded6] bg-[#F7F5EF] px-3 py-1 text-xs font-bold text-[#0F3D2E]">Reservation {statusLabel(activeAttempt.workflow_status)}</span>}
            </div>
          </div>
          {buildingDefaultsDifferFromSnapshot && (
            <p className="mt-3 text-xs text-[#617169]">This sale uses the deal setup agreed at reservation. Building defaults may have changed since.</p>
          )}

          <div className="mt-5 grid gap-4 xl:grid-cols-3">
            <div className="rounded-lg border border-[#d9ded6] bg-[#fbfcfa] p-4">
              <h4 className="font-bold text-[#0F3D2E]">Developer view</h4>
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
            <div className="rounded-lg border border-[#d9ded6] bg-[#fbfcfa] p-4">
              <h4 className="font-bold text-[#0F3D2E]">Agent view</h4>
              <p className="mt-1 text-sm text-[#617169]">Forecast agent invoice after deductions.</p>
              <div className="mt-4 grid gap-2 text-sm text-[#34413a]">
                <div className="flex justify-between gap-4 border-b border-[#eef0eb] pb-2"><span>Agent fee %</span><strong className="numeric-value text-right">{formatPercentValue(displayAgentFeePercent)}</strong></div>
                <div className="flex justify-between gap-4 border-b border-[#eef0eb] pb-2"><span>Fee base</span><strong className="numeric-value text-right">{money(selectedContractValue)}</strong></div>
                <div className="flex justify-between gap-4 border-b border-[#eef0eb] pb-2"><span>Net agent fee</span><strong className="numeric-value text-right">{money(selectedAgentInvoice.netAmount)}</strong></div>
                <div className="flex justify-between gap-4 border-b border-[#eef0eb] pb-2"><span>VAT</span><strong className="numeric-value text-right">{money(selectedAgentInvoice.vatAmount)}</strong></div>
                <div className="flex justify-between gap-4 border-b border-[#eef0eb] pb-2"><span>Reservation fee deduction</span><strong className="numeric-value text-right">{moneyDeduction(selectedAgentInvoice.reservationFeeDeduction)}</strong></div>
                <div className="flex justify-between gap-4 border-b border-[#eef0eb] pb-2"><span>Agent contribution</span><strong className="numeric-value text-right">{activeAgentContributionDeductionLabel}</strong></div>
                <div className="flex justify-between gap-4"><span>Forecast invoice</span><strong className="numeric-value text-right text-[#0F3D2E]">{money(selectedAgentInvoice.expectedPayableAmount)}</strong></div>
              </div>
            </div>
            <div className="rounded-lg border border-[#d9ded6] bg-[#fbfcfa] p-4">
              <h4 className="font-bold text-[#0F3D2E]">Buyer view</h4>
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
              <button className="secondary" onClick={toggleCommercialModel}>
                {showCommercialModel ? "Close commercial model" : "Edit commercial model"}
              </button>
            )}
          </div>

          {showCommercialModel && (
            <div className="mt-4 rounded-lg border border-[#d9ded6] bg-[#fbfcfa] p-4">
              <div className="grid gap-4 xl:grid-cols-3">
                <div className="rounded-lg border border-[#e2ded3] bg-white p-4">
                  <h4 className="font-bold text-[#0F3D2E]">Deal inputs</h4>
                  <p className="mt-1 text-sm text-[#617169]">Developer-only modelling before commercial approval.</p>
                  <div className="mt-4 grid gap-3">
                    <h5 className="text-sm font-bold text-[#0F3D2E]">Commercial model</h5>
                    <label className="field-label">Proposed contract price<GbpInput value={contractPrice} onChange={setContractPrice} disabled={!canManageCommercialTerms || commercialApproved} aria-label="Proposed contract price" /></label>
                    <label className="field-label">Parking value<GbpInput value={parkingValue} onChange={setParkingValue} disabled={!canManageCommercialTerms || commercialApproved} aria-label="Parking value" /></label>
                    <div className="rounded-md border border-[#eef0eb] bg-white p-3">
                      <h5 className="text-sm font-bold text-[#0F3D2E]">Buyer incentives and special conditions</h5>
                      <div className="mt-3 grid gap-3">
                        <label className="field-label">
                          Developer contribution
                          <div className="grid gap-2 sm:grid-cols-[1fr_9rem]">
                            {developerContributionValueType === "percent" ? (
                              <input className="field" inputMode="decimal" value={developerContribution} onChange={(event) => setDeveloperContribution(event.target.value)} disabled={!canManageCommercialTerms || commercialApproved} aria-label="Developer contribution percent" />
                            ) : (
                              <GbpInput value={developerContribution} onChange={setDeveloperContribution} disabled={!canManageCommercialTerms || commercialApproved} aria-label="Developer contribution amount" />
                            )}
                            <select className="field" value={developerContributionValueType} onChange={(event) => setDeveloperContributionValueType(event.target.value as "amount" | "percent")} disabled={!canManageCommercialTerms || commercialApproved} aria-label="Developer contribution value type">
                              <option value="amount">GBP amount</option>
                              <option value="percent">% of price</option>
                            </select>
                          </div>
                          {developerContributionValueType === "percent" && <span className="mt-1 text-xs text-[#617169]">Equivalent: {money(previewDeveloperContributionAmount)}</span>}
                        </label>
                        <label className="field-label">
                          Agent contribution
                          <div className="grid gap-2 sm:grid-cols-[1fr_9rem]">
                            {agentContributionValueType === "percent" ? (
                              <input className="field" inputMode="decimal" value={agentContribution} onChange={(event) => setAgentContribution(event.target.value)} disabled={!canManageCommercialTerms || commercialApproved} aria-label="Agent contribution percent" />
                            ) : (
                              <GbpInput value={agentContribution} onChange={setAgentContribution} disabled={!canManageCommercialTerms || commercialApproved} aria-label="Agent contribution amount" />
                            )}
                            <select className="field" value={agentContributionValueType} onChange={(event) => setAgentContributionValueType(event.target.value as "amount" | "percent")} disabled={!canManageCommercialTerms || commercialApproved} aria-label="Agent contribution value type">
                              <option value="amount">GBP amount</option>
                              <option value="percent">% of price</option>
                            </select>
                          </div>
                          {agentContributionValueType === "percent" && <span className="mt-1 text-xs text-[#617169]">Equivalent: {money(previewAgentContribution)}</span>}
                        </label>
                        <label className="field-label">Parking contribution<GbpInput value={parkingContributionValue} onChange={setParkingContributionValue} disabled={!canManageCommercialTerms || commercialApproved} aria-label="Parking contribution" /></label>
                        <div className="grid gap-2">
                          <span className="field-label">Additional conditions</span>
                          {additionalSpecialConditions.map((condition, index) => (
                            <div key={index} className="grid gap-2 sm:grid-cols-[1fr_auto]">
                              <input
                                className="field"
                                value={condition}
                                onChange={(event) => setAdditionalSpecialConditions((items) => items.map((item, itemIndex) => itemIndex === index ? event.target.value : item))}
                                disabled={!canManageCommercialTerms || commercialApproved}
                              />
                              <button className="secondary min-h-10 px-3" type="button" onClick={() => setAdditionalSpecialConditions((items) => items.filter((_, itemIndex) => itemIndex !== index))} disabled={!canManageCommercialTerms || commercialApproved || additionalSpecialConditions.length === 1} aria-label="Remove special condition">
                                <X size={16} aria-hidden />
                              </button>
                            </div>
                          ))}
                          <button className="secondary w-fit" type="button" onClick={() => setAdditionalSpecialConditions((items) => [...items, ""])} disabled={!canManageCommercialTerms || commercialApproved}>Add condition</button>
                        </div>
                      </div>
                    </div>
                    <div className="border-t border-[#eef0eb] pt-3">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <h5 className="text-sm font-bold text-[#0F3D2E]">Advanced deal setup</h5>
                          <p className="mt-1 text-xs text-[#617169]">These values normally come from the building defaults. Only change them for unit-specific exceptions.</p>
                        </div>
                        <button className="secondary" type="button" onClick={() => setShowAdvancedDealSetup((value) => !value)} disabled={!canManageCommercialTerms || commercialApproved}>
                          {showAdvancedDealSetup ? "Hide setup" : "Edit deal setup"}
                        </button>
                      </div>
                    </div>
                    {!showAdvancedDealSetup ? (
                      <div className="rounded-md border border-[#d9ded6] bg-[#F7F5EF] p-3 text-sm text-[#34413a]">
                        <div className="grid gap-2">
                          <div className="flex justify-between gap-3 border-b border-[#e8e5dc] pb-2"><span>Agent fee %</span><strong className="numeric-value">{formatPercentValue(previewAgentFeePercent)}</strong></div>
                          <div className="flex justify-between gap-3 border-b border-[#e8e5dc] pb-2"><span>Reservation fee</span><strong className="numeric-value">{money(previewReservationFee)}</strong></div>
                          <div className="flex justify-between gap-3 border-b border-[#e8e5dc] pb-2"><span>Exchange deposit</span><strong className="numeric-value">{formatPercentValue(previewDepositStructure.exchangeDepositPercent)}</strong></div>
                          {previewDepositStructure.secondDepositEnabled && <div className="flex justify-between gap-3 border-b border-[#e8e5dc] pb-2"><span>Second deposit</span><strong className="numeric-value">{formatPercentValue(previewDepositStructure.secondDepositPercent)}</strong></div>}
                          <div className="flex justify-between gap-3"><span>Completion balance</span><strong className="numeric-value">{formatPercentValue(previewDepositStructure.completionBalancePercent)}</strong></div>
                        </div>
                      </div>
                    ) : (
                      <>
                        <label className="field-label">Agent fee %<input className="field" inputMode="decimal" value={agentFeePercent} onChange={(event) => setAgentFeePercent(event.target.value)} disabled={!canManageCommercialTerms || commercialApproved} /></label>
                        <label className="field-label">Reservation fee<GbpInput value={reservationFee} onChange={setReservationFee} disabled={!canManageCommercialTerms || commercialApproved} aria-label="Reservation fee" /></label>
                        <label className="field-label">
                          Reservation fee holder
                          <select className="field" value={reservationFeeHolder} onChange={(event) => setReservationFeeHolder(event.target.value)} disabled={!canManageCommercialTerms || commercialApproved}>
                            <option value="sales_agent">Sales agent</option>
                            <option value="developer">Developer</option>
                            <option value="conveyancer">Conveyancer</option>
                            <option value="other">Other</option>
                          </select>
                        </label>
                        <label className="field-label">Exchange deposit %<input className="field" inputMode="decimal" value={exchangeDepositPercent} onChange={(event) => setExchangeDepositPercent(event.target.value)} disabled={!canManageCommercialTerms || commercialApproved} /></label>
                        <label className="option-card min-h-10 px-3 py-2 text-sm">
                          <input checked={secondDepositEnabled} onChange={(event) => setSecondDepositEnabled(event.target.checked)} type="checkbox" disabled={!canManageCommercialTerms || commercialApproved} />
                          Optional second deposit
                        </label>
                        {secondDepositEnabled && (
                          <>
                            <label className="field-label">Second deposit %<input className="field" inputMode="decimal" value={secondDepositPercent} onChange={(event) => setSecondDepositPercent(event.target.value)} disabled={!canManageCommercialTerms || commercialApproved} /></label>
                            <label className="field-label">Second deposit timing<input className="field" inputMode="numeric" value={secondDepositMonthsAfterExchange} onChange={(event) => setSecondDepositMonthsAfterExchange(event.target.value)} disabled={!canManageCommercialTerms || commercialApproved} placeholder="Months after exchange" /></label>
                          </>
                        )}
                        <div className={`rounded-md border p-3 text-sm ${previewDepositStructure.isValid ? "border-[#d9ded6] bg-[#F7F5EF] text-[#34413a]" : "border-[#D6A23A] bg-[#fff8e7] text-[#5c4a1f]"}`}>
                          <div className="flex justify-between gap-3"><span>Completion balance</span><strong className="numeric-value">{formatPercentValue(previewDepositStructure.completionBalancePercent)}</strong></div>
                          <p className="mt-1 text-xs">{previewDepositStructure.error ?? "Reservation fee is separate from the 100% payment schedule."}</p>
                        </div>
                      </>
                    )}
                    </div>
                  </div>
                <div className="rounded-lg border border-[#e2ded3] bg-white p-4">
                  <h4 className="font-bold text-[#0F3D2E]">Live preview</h4>
                  <div className="mt-4 grid gap-2 text-sm text-[#34413a]">
                    <div className="flex justify-between gap-4 border-b border-[#eef0eb] pb-2"><span>Developer net before</span><strong className="numeric-value text-right">{money(selectedDeveloperNet)}</strong></div>
                    <div className="flex justify-between gap-4 border-b border-[#eef0eb] pb-2"><span>Developer net after</span><strong className="numeric-value text-right text-[#0F3D2E]">{money(modelDeveloperNet)}</strong></div>
                    <div className="flex justify-between gap-4 border-b border-[#eef0eb] pb-2"><span>Developer difference</span><strong className="numeric-value text-right">{money(modelDeveloperNet - selectedDeveloperNet)}</strong></div>
                    <div className="flex justify-between gap-4 border-b border-[#eef0eb] pb-2"><span>Agent invoice before</span><strong className="numeric-value text-right">{money(selectedAgentInvoice.expectedPayableAmount)}</strong></div>
                    <div className="flex justify-between gap-4 border-b border-[#eef0eb] pb-2"><span>Agent invoice after</span><strong className="numeric-value text-right text-[#0F3D2E]">{money(previewInvoice.expectedPayableAmount)}</strong></div>
                    <div className="flex justify-between gap-4"><span>Agent difference</span><strong className="numeric-value text-right">{money(previewInvoice.expectedPayableAmount - selectedAgentInvoice.expectedPayableAmount)}</strong></div>
                  </div>
                </div>
                <div className="rounded-lg border border-[#e2ded3] bg-white p-4">
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
              </div>
              <div className="mt-4 flex justify-end gap-2">
                <button className="secondary" onClick={() => {
                  setShowCommercialModel(false);
                  setShowAdvancedDealSetup(false);
                }}>Close panel</button>
                <button className="primary" onClick={() => void saveCommercialPackage()} disabled={isSaving || commercialApproved || !previewDepositStructure.isValid}>
                  Save commercial model
                </button>
              </div>
            </div>
          )}

          <div className="mt-6 rounded-lg border border-[#d9ded6] bg-[#fbfcfa] p-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h4 className="text-lg font-bold text-[#0F3D2E]">Sales timeline</h4>
                <p className="text-sm text-[#617169]">Follow the handoff from agent to developer to conveyancer.</p>
              </div>
              <button className="secondary" type="button">View notes/activity (0)</button>
            </div>
            <div className="mt-4 grid gap-3 lg:grid-cols-4">
              {workflowStages.map((stage, index) => {
                const isLocked = index > currentWorkflowIndex;
                const isSelected = activeWorkflowStage === stage.key;
                return (
                  <button
                    key={stage.key}
                    className={`flex h-full min-h-36 flex-col items-stretch rounded-lg border p-4 text-left transition ${isSelected ? "border-[#0F3D2E] bg-white shadow-sm" : "border-[#d9ded6] bg-white"} ${isLocked ? "cursor-not-allowed opacity-55" : "hover:border-[#0F3D2E]"}`}
                    onClick={() => {
                      if (!isLocked) setActiveWorkflowStage(stage.key);
                    }}
                    disabled={isLocked}
                  >
                    <div className="flex min-h-8 items-start justify-between gap-3">
                      <span className="font-bold text-[#0F3D2E]">{index + 1}. {stage.label}</span>
                      <span className="shrink-0 rounded-full bg-[#F0EEE7] px-2 py-1 text-xs font-bold text-[#617169]">{stage.status}</span>
                    </div>
                    <p className="mt-2 text-xs font-semibold uppercase text-[#617169]">Owner: {stage.owner}</p>
                    <p className="mt-2 text-sm text-[#617169]">{stage.summary}</p>
                    <p className={`mt-auto pt-3 text-xs font-bold uppercase ${isSelected ? "text-[#D6A23A]" : "invisible"}`}>Selected</p>
                  </button>
                );
              })}
            </div>
          </div>

          {activeWorkflowStage === "reservation" && (
            <div className="mt-5 rounded-lg border border-[#d9ded6] bg-[#fbfcfa] p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.12em] text-[#617169]">Selected workflow step</p>
                  <h4 className="mt-1 text-lg font-bold text-[#0F3D2E]">1. Reservation</h4>
                  <p className="text-sm text-[#617169]">Agent submits buyer details and reservation form; developer approves before the unit becomes Reserved.</p>
                </div>
                <span className="rounded-full border border-[#d9ded6] bg-white px-3 py-1 text-xs font-bold uppercase text-[#617169]">
                  {reservationStateLabel[reservationState]}
                </span>
              </div>

              {reservationCanBeEdited && (
                <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(20rem,0.75fr)]">
                  <div className="rounded-lg border border-[#d9ded6] bg-white p-4">
                    {reservationState === "queried" && (
                      <div className="mb-4 rounded-md border border-[#D6A23A] bg-[#fff8e7] p-3 text-sm text-[#5c4a1f]">
                        <strong className="block">Developer query</strong>
                        <span>{reservationDocument?.query_note || "Developer has queried the reservation pack. Update and resubmit."}</span>
                      </div>
                    )}
                    <h5 className="font-bold text-[#0F3D2E]">Buyer and reservation form</h5>
                    <p className="mt-1 text-sm text-[#617169]">Commercial terms are read-only here and come from the saved deal model/building defaults.</p>
                    <div className="mt-4 rounded-md border border-[#D6A23A] bg-[#fffaf0] p-4">
                      <h5 className="font-bold text-[#0F3D2E]">Developer-approved commercial terms</h5>
                      <div className="mt-3 grid gap-2 text-sm text-[#34413a]">
                        <div className="flex justify-between gap-4 border-b border-[#eadfbf] pb-2"><span>Developer contribution</span><strong className="numeric-value text-right">{activeDeveloperContributionLabel}</strong></div>
                        <div className="flex justify-between gap-4 border-b border-[#eadfbf] pb-2"><span>Agent contribution</span><strong className="numeric-value text-right">{activeAgentContributionLabel}</strong></div>
                        <div className="flex justify-between gap-4 border-b border-[#eadfbf] pb-2"><span>Parking contribution</span><strong className="numeric-value text-right">{money(activeTerms?.parking_contribution_value ?? 0)}</strong></div>
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
                      <div className="md:col-span-2">
                        <PdfUploadBox
                          id={`reservation-form-${selectedUnit.id}`}
                          label="Upload reservation form PDF"
                          file={reservationFormFile}
                          currentVersion={reservationVersion}
                          disabled={!reservationCanBeEdited}
                          onOpen={reservationVersion ? () => void openDocumentVersion(reservationVersion) : undefined}
                          onFile={setReservationFormFile}
                          onClear={() => setReservationFormFile(null)}
                        />
                      </div>
                    </div>
                    <label className="mt-4 flex items-start gap-3 rounded-md border border-[#eef0eb] bg-[#fbfcfa] p-3 text-sm font-semibold text-[#34413a]">
                      <input className="mt-1" type="checkbox" checked={reservationTermsChecked} onChange={(event) => setReservationTermsChecked(event.target.checked)} disabled={!reservationCanBeEdited} />
                      <span>I have checked that the reservation form reflects the developer-approved commercial terms.</span>
                    </label>
                    <div className="mt-4 flex justify-end">
                      <button className="primary" onClick={() => void saveReservation()} disabled={isSaving || !buyerIdentityEntered || !reservationTermsChecked}>
                        {reservationState === "queried" ? "Resubmit reservation" : "Reserve unit"}
                      </button>
                    </div>
                  </div>

                  <div className="grid gap-4">
                    <div className="rounded-lg border border-[#d9ded6] bg-white p-4">
                      <h5 className="font-bold text-[#0F3D2E]">Commercial terms</h5>
                      <div className="mt-3 grid gap-2">
                        <FieldValue label="Contract price" value={money(selectedContractValue)} />
                        <FieldValue label="Reservation fee" value={money(displayReservationFee)} />
                        <FieldValue label="Reservation fee holder" value={describeReservationFeeHolder(displayReservationFeeHolder)} />
                        <FieldValue label="Exchange deposit" value={formatPercentValue(displayDepositStructure.exchangeDepositPercent)} />
                        {displayDepositStructure.secondDepositEnabled && <FieldValue label="Second deposit" value={`${formatPercentValue(displayDepositStructure.secondDepositPercent)} after ${displayDepositStructure.secondDepositMonthsAfterExchange ?? 0} months`} />}
                        <FieldValue label="Completion balance" value={formatPercentValue(displayDepositStructure.completionBalancePercent)} />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {reservationState === "awaiting_developer_review" && (
                <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(20rem,0.85fr)]">
                  <div className="rounded-lg border border-[#d9ded6] bg-white p-4">
                    <h5 className="font-bold text-[#0F3D2E]">Submitted reservation pack</h5>
                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                      <FieldValue label="Buyer" value={buyerDisplay(activeAttempt)} />
                      <FieldValue label="Buyer email" value={activeAttempt?.buyer_email} />
                      <FieldValue label="Buyer phone" value={activeAttempt?.buyer_phone} />
                      <FieldValue label="Buyer solicitor" value={activeAttempt?.buyer_solicitor_name} />
                      <FieldValue label="Submitted" value={formatDateTime(activeAttempt?.reservation_submitted_at)} />
                      <FieldValue label="Submitted by" value={submittedByName} />
                    </div>
                    <div className="mt-4">
                      <PdfUploadBox
                        id={`reservation-form-review-${selectedUnit.id}`}
                        label="Upload reservation form PDF"
                        file={reservationFormFile}
                        currentVersion={reservationVersion}
                        disabled
                        onOpen={reservationVersion ? () => void openDocumentVersion(reservationVersion) : undefined}
                        onFile={setReservationFormFile}
                        onClear={() => setReservationFormFile(null)}
                      />
                    </div>
                  </div>

                  <div className="rounded-lg border border-[#d9ded6] bg-white p-4">
                    <h5 className="font-bold text-[#0F3D2E]">Developer review</h5>
                    <p className="mt-1 text-sm text-[#617169]">Check the reservation form against the saved commercial terms before approving.</p>
                    <div className="mt-3 grid gap-2 text-sm text-[#34413a]">
                      <div className="flex justify-between gap-4 border-b border-[#eef0eb] pb-2"><span>Contract price</span><strong className="numeric-value">{money(selectedContractValue)}</strong></div>
                      <div className="flex justify-between gap-4 border-b border-[#eef0eb] pb-2"><span>Reservation fee</span><strong className="numeric-value">{money(displayReservationFee)}</strong></div>
                      <div className="flex justify-between gap-4 border-b border-[#eef0eb] pb-2"><span>Fee holder</span><strong>{describeReservationFeeHolder(displayReservationFeeHolder)}</strong></div>
                      <div className="flex justify-between gap-4"><span>Payment schedule</span><strong className="text-right">{displayedPaymentSchedule.map((row) => row.label).join(", ")}</strong></div>
                    </div>
                    <label className="field-label mt-4">Query note<textarea className="field min-h-20" value={queryNote} onChange={(event) => setQueryNote(event.target.value)} disabled={!reservationCanBeReviewed} /></label>
                    <div className="mt-4 flex flex-wrap justify-end gap-2">
                      <button className="secondary" onClick={() => setShowFailReservationConfirm(true)} disabled={!reservationCanFail}>Mark reservation as failed</button>
                      {reservationCanBeReviewed && (
                        <>
                          <button className="secondary" onClick={() => void queryReservation()} disabled={isSaving || !activeAttempt}>Query reservation</button>
                          <button className="primary" onClick={() => void approveReservation()} disabled={isSaving || !activeAttempt || !reservationVersion}>Approve reservation</button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {reservationState === "approved" && (
                <div className="mt-4 rounded-lg border border-[#d9ded6] bg-white p-4">
                  <h5 className="font-bold text-[#0F3D2E]">Reservation approved</h5>
                  <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                    <FieldValue label="Buyer" value={buyerDisplay(activeAttempt)} />
                    <FieldValue label="Contract price" value={money(selectedContractValue)} />
                    <FieldValue label="Reservation fee" value={money(displayReservationFee)} />
                    <FieldValue label="Reservation submitted" value={formatDate(activeAttempt?.reservation_submitted_at)} />
                    <FieldValue label="Approved" value={formatDate(activeAttempt?.reservation_approved_at)} />
                    <FieldValue label="Reservation form" value={reservationVersion?.file_name ?? "-"} />
                    <FieldValue label="Fee holder" value={describeReservationFeeHolder(displayReservationFeeHolder)} />
                    <FieldValue label="Payment schedule" value={displayedPaymentSchedule.map((row) => row.label).join(", ")} />
                  </div>
                  {reservationCanFail && (
                    <div className="mt-4 flex justify-end">
                      <button className="secondary" onClick={() => setShowFailReservationConfirm(true)}>Mark reservation as failed</button>
                    </div>
                  )}
                </div>
              )}

              {showFailReservationConfirm && (
                <div className="mt-4 rounded-lg border border-[#D6A23A] bg-[#fff8e7] p-4">
                  <h5 className="font-bold text-[#5c4a1f]">Fail and redact reservation</h5>
                  <p className="mt-1 text-sm text-[#5c4a1f]">Buyer details and active reservation documents will be redacted. The historical audit record will remain.</p>
                  <label className="field-label mt-3">Reason<textarea className="field min-h-20" value={failReason} onChange={(event) => setFailReason(event.target.value)} disabled={!canFailReservation} /></label>
                  <label className="option-card mt-3 min-h-10 px-3 py-2 text-sm">
                    <input checked={confirmFailReservation} onChange={(event) => setConfirmFailReservation(event.target.checked)} type="checkbox" disabled={!canFailReservation} />
                    I understand this redacts active buyer details and reservation documents.
                  </label>
                  <div className="mt-3 flex flex-wrap justify-end gap-2">
                    <button className="secondary" onClick={() => setShowFailReservationConfirm(false)}>Cancel</button>
                    {canFailReservation && <button className="danger-button" onClick={() => void failReservation()} disabled={isSaving || !activeAttempt || !confirmFailReservation}>Fail reservation</button>}
                  </div>
                </div>
              )}

              {failedAttempts.length > 0 && (
                <div className="mt-4 rounded-lg border border-[#d9ded6] bg-white p-4">
                  <h5 className="font-bold text-[#0F3D2E]">Failed reservation history</h5>
                  <div className="mt-3 grid gap-2">
                    {failedAttempts.map((attempt) => (
                      <div key={attempt.id} className="rounded-md border border-[#eef0eb] bg-[#fbfcfa] p-3 text-sm text-[#34413a]">
                        <div className="flex flex-wrap justify-between gap-3">
                          <strong>Attempt {attempt.attempt_number}</strong>
                          <span>{formatDate(attempt.fallen_through_at)}</span>
                        </div>
                        <p className="mt-1 text-[#617169]">{attempt.fall_through_reason ?? "Reservation failed."}</p>
                        <p className="mt-1 text-xs font-semibold uppercase text-[#617169]">Buyer data and active reservation documents redacted.</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {activeWorkflowStage === "exchange" && (
            <>
              <div className="mt-5 rounded-lg border border-[#d9ded6] bg-[#fbfcfa] p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h4 className="text-base font-bold text-[#0F3D2E]">Commercial approval</h4>
                    <p className="text-sm text-[#617169]">Review the approved reservation, invoice and commercial terms before the sale becomes Ready for Exchange.</p>
                  </div>
                  <span className="rounded-full border border-[#d9ded6] bg-white px-3 py-1 text-xs font-bold uppercase text-[#617169]">
                    {commercialApproved ? "Ready for Exchange" : reservationApproved ? "Approval required" : "Reservation required"}
                  </span>
                </div>

            {!reservationApproved ? (
              <div className="mt-4 rounded-md border border-[#e2ded3] bg-white p-4 text-sm text-[#617169]">
                Approve the reservation pack before preparing the commercial approval package.
              </div>
            ) : (
              <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_1fr]">
                <div className="grid gap-4">
                  <div className="rounded-md border border-[#e2ded3] bg-white p-4">
                    <h5 className="font-bold text-[#0F3D2E]">Commercial snapshot</h5>
                    <div className="mt-3 grid gap-2 text-sm text-[#34413a]">
                      <div className="flex justify-between gap-4 border-b border-[#eef0eb] pb-2"><span>Buyer</span><strong className="whitespace-pre-line text-right">{buyerDisplay(activeAttempt)}</strong></div>
                      <div className="flex justify-between gap-4 border-b border-[#eef0eb] pb-2"><span>Buyer email</span><strong>{activeAttempt?.buyer_email ?? "-"}</strong></div>
                      <div className="flex justify-between gap-4 border-b border-[#eef0eb] pb-2"><span>Buyer solicitor</span><strong>{activeAttempt?.buyer_solicitor_name ?? "-"}</strong></div>
                      <div className="flex justify-between gap-4 border-b border-[#eef0eb] pb-2"><span>Contract price</span><strong className="numeric-value">{money(previewContractPrice)}</strong></div>
                      <div className="flex justify-between gap-4 border-b border-[#eef0eb] pb-2"><span>Parking value</span><strong className="numeric-value">{money(parseGbpInput(parkingValue) ?? activeTerms?.parking_value ?? 0)}</strong></div>
                      <div className="flex justify-between gap-4 border-b border-[#eef0eb] pb-2"><span>Developer contribution</span><strong className="numeric-value">{moneyDeduction(previewDeveloperContributionAmount)}</strong></div>
                      <div className="flex justify-between gap-4 border-b border-[#eef0eb] pb-2"><span>Agent contribution</span><strong className="numeric-value">{moneyDeduction(previewAgentContribution)}</strong></div>
                      <div className="flex justify-between gap-4 border-b border-[#eef0eb] pb-2"><span>Parking contribution</span><strong className="numeric-value">{money(previewParkingContribution)}</strong></div>
                      <div className="flex justify-between gap-4"><span>Reservation fee</span><strong className="numeric-value">{money(previewReservationFee)}</strong></div>
                    </div>
                  </div>

                  <div className="rounded-md border border-[#e2ded3] bg-white p-4">
                    <h5 className="font-bold text-[#0F3D2E]">Deposit / payment schedule</h5>
                    <label className="field-label mt-3">
                      Deposit summary
                      <textarea
                        className="field min-h-20"
                        value={depositSummary}
                        onChange={(event) => setDepositSummary(event.target.value)}
                        disabled={!canManageCommercialTerms || commercialApproved}
                        placeholder="Example: 10% on exchange, balance on completion"
                      />
                    </label>
                    {activePaymentSchedule.length > 0 ? (
                      <div className="mt-3 grid gap-2">
                        {activePaymentSchedule.map((row) => (
                          <div key={row.id} className="rounded-md border border-[#eef0eb] bg-[#fbfcfa] p-3 text-sm">
                            <div className="flex justify-between gap-4">
                              <strong className="text-[#0F3D2E]">{row.label}</strong>
                              <span className="numeric-value">{row.expected_amount ? money(row.expected_amount) : row.percent_of_contract_price ? `${row.percent_of_contract_price}%` : money(row.fixed_amount)}</span>
                            </div>
                            <p className="mt-1 text-xs font-semibold uppercase text-[#617169]">{row.payment_stage.replace(/_/g, " ")} - {row.status.replace(/_/g, " ")}</p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-2 text-sm text-[#617169]">{depositSummary || "No detailed payment schedule has been recorded yet."}</p>
                    )}
                  </div>
                </div>

                <div className="grid gap-4">
                  <div className="rounded-md border border-[#e2ded3] bg-white p-4">
                    <h5 className="font-bold text-[#0F3D2E]">Commercial terms</h5>
                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                      <label className="field-label">Parking value<GbpInput value={parkingValue} onChange={setParkingValue} disabled={!canManageCommercialTerms || commercialApproved} aria-label="Parking value" /></label>
                      <label className="field-label">
                        Developer contribution
                        <div className="grid gap-2 sm:grid-cols-[1fr_9rem]">
                          {developerContributionValueType === "percent"
                            ? <input className="field" inputMode="decimal" value={developerContribution} onChange={(event) => setDeveloperContribution(event.target.value)} disabled={!canManageCommercialTerms || commercialApproved} />
                            : <GbpInput value={developerContribution} onChange={setDeveloperContribution} disabled={!canManageCommercialTerms || commercialApproved} aria-label="Developer contribution amount" />}
                          <select className="field" value={developerContributionValueType} onChange={(event) => setDeveloperContributionValueType(event.target.value as "amount" | "percent")} disabled={!canManageCommercialTerms || commercialApproved}>
                            <option value="amount">GBP amount</option>
                            <option value="percent">% of price</option>
                          </select>
                        </div>
                      </label>
                      <label className="field-label">
                        Agent contribution
                        <div className="grid gap-2 sm:grid-cols-[1fr_9rem]">
                          {agentContributionValueType === "percent"
                            ? <input className="field" inputMode="decimal" value={agentContribution} onChange={(event) => setAgentContribution(event.target.value)} disabled={!canManageCommercialTerms || commercialApproved} />
                            : <GbpInput value={agentContribution} onChange={setAgentContribution} disabled={!canManageCommercialTerms || commercialApproved} aria-label="Agent contribution amount" />}
                          <select className="field" value={agentContributionValueType} onChange={(event) => setAgentContributionValueType(event.target.value as "amount" | "percent")} disabled={!canManageCommercialTerms || commercialApproved}>
                            <option value="amount">GBP amount</option>
                            <option value="percent">% of price</option>
                          </select>
                        </div>
                      </label>
                      <label className="field-label">Parking contribution<GbpInput value={parkingContributionValue} onChange={setParkingContributionValue} disabled={!canManageCommercialTerms || commercialApproved} aria-label="Parking contribution" /></label>
                      <label className="field-label">Agent fee %<input className="field" inputMode="decimal" value={agentFeePercent} onChange={(event) => setAgentFeePercent(event.target.value)} disabled={!canManageCommercialTerms || commercialApproved} /></label>
                      <label className="field-label">Solicitor fee<GbpInput value={solicitorFee} onChange={setSolicitorFee} disabled={!canManageCommercialTerms || commercialApproved} aria-label="Solicitor fee" /></label>
                      <label className="field-label">Invoice reference<input className="field" value={invoiceReference} onChange={(event) => setInvoiceReference(event.target.value)} disabled={!canManageCommercialTerms || commercialApproved} /></label>
                      <label className="field-label">Invoice date<input className="field" type="date" value={invoiceDate} onChange={(event) => setInvoiceDate(event.target.value)} disabled={!canManageCommercialTerms || commercialApproved} /></label>
                      <label className="field-label">Uploaded invoice amount<GbpInput value={invoiceGrossAmount} onChange={setInvoiceGrossAmount} disabled={!canManageCommercialTerms || commercialApproved} aria-label="Uploaded invoice amount" /></label>
                      <label className="field-label md:col-span-2">Commercial summary<textarea className="field min-h-20" value={commercialSummary} onChange={(event) => setCommercialSummary(event.target.value)} disabled={!canManageCommercialTerms || commercialApproved} /></label>
                      <div className="md:col-span-2 grid gap-2">
                        <span className="field-label">Additional conditions</span>
                        {additionalSpecialConditions.map((condition, index) => (
                          <div key={index} className="grid gap-2 sm:grid-cols-[1fr_auto]">
                            <input
                              className="field"
                              value={condition}
                              onChange={(event) => setAdditionalSpecialConditions((items) => items.map((item, itemIndex) => itemIndex === index ? event.target.value : item))}
                              disabled={!canManageCommercialTerms || commercialApproved}
                            />
                            <button className="secondary min-h-10 px-3" type="button" onClick={() => setAdditionalSpecialConditions((items) => items.filter((_, itemIndex) => itemIndex !== index))} disabled={!canManageCommercialTerms || commercialApproved || additionalSpecialConditions.length === 1} aria-label="Remove special condition">
                              <X size={16} aria-hidden />
                            </button>
                          </div>
                        ))}
                        <button className="secondary w-fit" type="button" onClick={() => setAdditionalSpecialConditions((items) => [...items, ""])} disabled={!canManageCommercialTerms || commercialApproved}>Add condition</button>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-md border border-[#e2ded3] bg-white p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h5 className="font-bold text-[#0F3D2E]">Sales agent invoice</h5>
                        <p className="text-sm text-[#617169]">Required before commercial approval.</p>
                      </div>
                      <span className="rounded-full border border-[#d9ded6] bg-[#F7F5EF] px-2 py-1 text-xs font-bold text-[#617169]">{agentInvoiceVersion ? "Uploaded" : "Not uploaded"}</span>
                    </div>

                    {agentInvoiceVersion ? (
                      <p className="mt-3 rounded-md border border-[#eef0eb] bg-[#fbfcfa] p-3 text-sm text-[#617169]">
                        {agentInvoiceVersion.file_name} {fileSizeLabel(agentInvoiceVersion.file_size_bytes)}
                      </p>
                    ) : null}

                    <div className="mt-3 grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
                      <label className="field-label">
                        Agent invoice PDF
                        <input className="field" type="file" accept="application/pdf" onChange={(event) => setAgentInvoiceFile(event.target.files?.[0] ?? null)} disabled={!canSubmitAgentInvoice || commercialApproved} />
                      </label>
                      {canSubmitAgentInvoice && <button className="secondary" onClick={() => void uploadAgentInvoice()} disabled={isSaving || !agentInvoiceFile || commercialApproved}>Upload invoice</button>}
                    </div>
                  </div>

                  <div className="rounded-md border border-[#e2ded3] bg-white p-4">
                    <h5 className="font-bold text-[#0F3D2E]">Invoice reconciliation</h5>
                    <div className="mt-3 grid gap-2 text-sm text-[#34413a]">
                      <div className="flex justify-between gap-4 border-b border-[#eef0eb] pb-2"><span>Net agent fee</span><strong className="numeric-value">{money(previewInvoice.netAmount)}</strong></div>
                      <div className="flex justify-between gap-4 border-b border-[#eef0eb] pb-2"><span>VAT</span><strong className="numeric-value">{money(previewInvoice.vatAmount)}</strong></div>
                      <div className="flex justify-between gap-4 border-b border-[#eef0eb] pb-2"><span>Reservation fee deduction</span><strong className="numeric-value">{moneyDeduction(previewInvoice.reservationFeeDeduction)}</strong></div>
                      <div className="flex justify-between gap-4 border-b border-[#eef0eb] pb-2"><span>Agent contribution deduction</span><strong className="numeric-value">{moneyDeduction(previewInvoice.agentContributionDeduction)}</strong></div>
                      <div className="flex justify-between gap-4 border-b border-[#eef0eb] pb-2"><span>Expected payable amount</span><strong className="numeric-value text-[#0F3D2E]">{money(previewInvoice.expectedPayableAmount)}</strong></div>
                      <div className="flex justify-between gap-4 border-b border-[#eef0eb] pb-2"><span>Uploaded invoice amount</span><strong className="numeric-value">{money(uploadedInvoiceGross)}</strong></div>
                      <div className="flex justify-between gap-4"><span>Variance</span><strong className="numeric-value">{money(invoiceVariance)}</strong></div>
                    </div>
                  </div>

                  <div className="flex flex-wrap justify-end gap-2">
                    {canManageCommercialTerms && <button className="secondary" onClick={() => void saveCommercialPackage()} disabled={isSaving || !activeAttempt || commercialApproved}>Save commercial package</button>}
                    {canApproveCommercialPackage && (
                      <button
                        className="primary"
                        onClick={() => void approveCommercialPackage()}
                        disabled={isSaving || !activeAttempt || commercialApproved || !agentInvoiceVersion || !previewContractPrice}
                        title={!agentInvoiceVersion ? "Upload the sales agent invoice before approving." : undefined}
                      >
                        Approve commercial package
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
              <div className="mt-5 rounded-lg border border-[#d9ded6] bg-[#fbfcfa] p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h4 className="text-base font-bold text-[#0F3D2E]">Exchange</h4>
                <p className="text-sm text-[#617169]">Conveyancer records the actual exchange date once exchange has happened outside the portal.</p>
              </div>
              <span className="rounded-full border border-[#d9ded6] bg-white px-3 py-1 text-xs font-bold uppercase text-[#617169]">
                {exchangeRecorded ? "Exchanged" : readyForExchange ? "Ready" : "Locked"}
              </span>
            </div>

            {!readyForExchange ? (
              <div className="mt-4 rounded-md border border-[#e2ded3] bg-white p-4 text-sm text-[#617169]">
                Commercial approval is required before exchange can be recorded.
              </div>
            ) : (
              <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_1fr]">
                <div className="rounded-md border border-[#e2ded3] bg-white p-4">
                  <h5 className="font-bold text-[#0F3D2E]">Approved commercial snapshot</h5>
                  <div className="mt-3 grid gap-2 text-sm text-[#34413a]">
                    <div className="flex justify-between gap-4 border-b border-[#eef0eb] pb-2"><span>Buyer</span><strong className="whitespace-pre-line text-right">{buyerDisplay(activeAttempt)}</strong></div>
                    <div className="flex justify-between gap-4 border-b border-[#eef0eb] pb-2"><span>Contract price</span><strong className="numeric-value">{money(activeTerms?.contract_price)}</strong></div>
                    <div className="flex justify-between gap-4 border-b border-[#eef0eb] pb-2"><span>Parking value</span><strong className="numeric-value">{money(activeTerms?.parking_value ?? 0)}</strong></div>
                    <div className="flex justify-between gap-4 border-b border-[#eef0eb] pb-2"><span>Developer contribution</span><strong className="numeric-value">{activeDeveloperContributionLabel}</strong></div>
                    <div className="flex justify-between gap-4 border-b border-[#eef0eb] pb-2"><span>Agent contribution</span><strong className="numeric-value">{activeAgentContributionLabel}</strong></div>
                    <div className="flex justify-between gap-4 border-b border-[#eef0eb] pb-2"><span>Parking contribution</span><strong className="numeric-value">{money(activeTerms?.parking_contribution_value ?? 0)}</strong></div>
                    <div className="flex justify-between gap-4 border-b border-[#eef0eb] pb-2"><span>Reservation fee</span><strong className="numeric-value">{money(activeTerms?.reservation_fee)}</strong></div>
                    <div className="flex justify-between gap-4 border-b border-[#eef0eb] pb-2"><span>Deposit / payment</span><strong>{activeTerms?.deposit_summary ?? "-"}</strong></div>
                    <div className="flex justify-between gap-4"><span>Commercial approved</span><strong>{formatDate(activeAttempt?.commercial_approved_at)}</strong></div>
                  </div>
                </div>

                <div className="rounded-md border border-[#e2ded3] bg-white p-4">
                  <h5 className="font-bold text-[#0F3D2E]">Record exchange</h5>
                  <p className="mt-1 text-sm text-[#617169]">Payment recording is not required before exchange in this version.</p>
                  <label className="field-label mt-3">
                    Actual exchange date
                    <input
                      className="field"
                      type="date"
                      max={new Date().toISOString().slice(0, 10)}
                      value={exchangeDate}
                      onChange={(event) => setExchangeDate(event.target.value)}
                      disabled={!canRecordExchange || exchangeRecorded}
                    />
                  </label>
                  {activeAttempt?.exchanged_at && (
                    <p className="mt-3 rounded-md border border-[#eef0eb] bg-[#fbfcfa] p-3 text-sm text-[#617169]">
                      Exchange recorded for {formatDate(activeAttempt.exchanged_at)}.
                    </p>
                  )}
                  <div className="mt-4 flex justify-end">
                    {canRecordExchange && (
                      <button className="primary" onClick={() => void recordExchange()} disabled={isSaving || !exchangeDate || exchangeRecorded}>
                        Mark unit Exchanged
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
              <div className="mt-5 rounded-lg border border-[#d9ded6] bg-[#fbfcfa] p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h4 className="text-base font-bold text-[#0F3D2E]">Invoice reconciliation</h4>
                <p className="text-sm text-[#617169]">Record post-exchange payments against the sales agent invoice and settle any developer shortfall.</p>
              </div>
              <span className="rounded-full border border-[#d9ded6] bg-white px-3 py-1 text-xs font-bold uppercase text-[#617169]">
                {invoiceReconciled ? "Reconciled" : exchangeRecorded ? "Post-exchange" : "Locked"}
              </span>
            </div>

            {!exchangeRecorded ? (
              <div className="mt-4 rounded-md border border-[#e2ded3] bg-white p-4 text-sm text-[#617169]">
                Record exchange before reconciling the sales agent invoice.
              </div>
            ) : !activeInvoice ? (
              <div className="mt-4 rounded-md border border-[#e2ded3] bg-white p-4 text-sm text-[#617169]">
                A sales agent invoice is required before reconciliation.
              </div>
            ) : (
              <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_1fr]">
                <div className="rounded-md border border-[#e2ded3] bg-white p-4">
                  <h5 className="font-bold text-[#0F3D2E]">Reconciliation summary</h5>
                  <div className="mt-3 grid gap-2 text-sm text-[#34413a]">
                    <div className="flex justify-between gap-4 border-b border-[#eef0eb] pb-2"><span>Permitted release from payment schedule</span><strong className="numeric-value">{money(permittedRelease)}</strong></div>
                    <div className="flex justify-between gap-4 border-b border-[#eef0eb] pb-2"><span>Expected payable amount</span><strong className="numeric-value">{money(expectedPayableAmount)}</strong></div>
                    <div className="flex justify-between gap-4 border-b border-[#eef0eb] pb-2"><span>Reservation fee already held</span><strong className="numeric-value">{money(previewInvoice.reservationFeeDeduction)}</strong></div>
                    <div className="flex justify-between gap-4 border-b border-[#eef0eb] pb-2"><span>Solicitor payment recorded</span><strong className="numeric-value">{money(recordedSolicitorPayment)}</strong></div>
                    <div className="flex justify-between gap-4 border-b border-[#eef0eb] pb-2"><span>Developer shortfall recorded</span><strong className="numeric-value">{money(recordedDeveloperShortfall)}</strong></div>
                    <div className="flex justify-between gap-4 border-b border-[#eef0eb] pb-2"><span>Total received by agent</span><strong className="numeric-value text-[#0F3D2E]">{money(totalReceivedByAgent)}</strong></div>
                    <div className="flex justify-between gap-4"><span>Outstanding developer balance</span><strong className="numeric-value text-[#0F3D2E]">{money(outstandingDeveloperBalance)}</strong></div>
                  </div>
                  <p className="mt-3 text-xs text-[#617169]">Payment recording happens after exchange and does not block the exchange date being recorded.</p>
                </div>

                <div className="rounded-md border border-[#e2ded3] bg-white p-4">
                  <h5 className="font-bold text-[#0F3D2E]">Record payments</h5>
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <label className="field-label">
                      Solicitor payment amount
                      <GbpInput value={solicitorPaymentAmount} onChange={setSolicitorPaymentAmount} disabled={!canRecordSolicitorPayment || invoiceReconciled} aria-label="Solicitor payment amount" />
                    </label>
                    <label className="field-label">
                      Solicitor payment date
                      <input className="field" type="date" max={new Date().toISOString().slice(0, 10)} value={solicitorPaymentDate} onChange={(event) => setSolicitorPaymentDate(event.target.value)} disabled={!canRecordSolicitorPayment || invoiceReconciled} />
                    </label>
                    <label className="field-label">
                      Developer shortfall payment
                      <GbpInput value={developerShortfallAmount} onChange={setDeveloperShortfallAmount} disabled={!canRecordDeveloperShortfall || invoiceReconciled} aria-label="Developer shortfall payment" />
                    </label>
                    <label className="field-label">
                      Shortfall payment date
                      <input className="field" type="date" max={new Date().toISOString().slice(0, 10)} value={developerShortfallDate} onChange={(event) => setDeveloperShortfallDate(event.target.value)} disabled={!canRecordDeveloperShortfall || invoiceReconciled} />
                    </label>
                    <label className="field-label md:col-span-2">
                      Notes
                      <textarea className="field min-h-20" value={reconciliationNotes} onChange={(event) => setReconciliationNotes(event.target.value)} disabled={invoiceReconciled || (!canRecordSolicitorPayment && !canRecordDeveloperShortfall)} />
                    </label>
                  </div>
                  <div className="mt-4 flex justify-end">
                    {(canRecordSolicitorPayment || canRecordDeveloperShortfall) && (
                      <button className="primary" onClick={() => void saveInvoiceReconciliation()} disabled={isSaving || invoiceReconciled}>
                        Save reconciliation
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}
              </div>
            </>
          )}

          {activeWorkflowStage === "completion" && (
            <div className="mt-5 rounded-lg border border-[#d9ded6] bg-[#fbfcfa] p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h4 className="text-base font-bold text-[#0F3D2E]">Completion</h4>
                <p className="text-sm text-[#617169]">Upload completion documents, developer approves them, then completion can be recorded.</p>
              </div>
              <span className="rounded-full border border-[#d9ded6] bg-white px-3 py-1 text-xs font-bold uppercase text-[#617169]">
                {completionRecorded ? "Completed" : completionReady ? "Approved" : exchangeRecorded ? "Documents required" : "Locked"}
              </span>
            </div>

            {!exchangeRecorded ? (
              <div className="mt-4 rounded-md border border-[#e2ded3] bg-white p-4 text-sm text-[#617169]">
                Record exchange before starting completion.
              </div>
            ) : (
              <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_1fr]">
                <div className="grid gap-4">
                  <div className="rounded-md border border-[#e2ded3] bg-white p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h5 className="font-bold text-[#0F3D2E]">Completion statement</h5>
                        <p className="text-sm text-[#617169]">PDF from the conveyancer.</p>
                      </div>
                      <span className="rounded-full border border-[#d9ded6] bg-[#F7F5EF] px-2 py-1 text-xs font-bold text-[#617169]">{completionStatementDocument ? statusLabel(completionStatementDocument.status) : "Not uploaded"}</span>
                    </div>
                    {completionStatementVersion ? (
                      <p className="mt-3 rounded-md border border-[#eef0eb] bg-[#fbfcfa] p-3 text-sm text-[#617169]">
                        {completionStatementVersion.file_name} {fileSizeLabel(completionStatementVersion.file_size_bytes)}
                      </p>
                    ) : null}
                    <div className="mt-3 grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
                      <label className="field-label">
                        Completion statement PDF
                        <input className="field" type="file" accept="application/pdf" onChange={(event) => setCompletionStatementFile(event.target.files?.[0] ?? null)} disabled={!canSubmitCompletionDocuments || completionRecorded} />
                      </label>
                      {canSubmitCompletionDocuments && <button className="secondary" onClick={() => void uploadCompletionDocument("completion_statement")} disabled={isSaving || !completionStatementFile || completionRecorded}>Upload</button>}
                    </div>
                  </div>

                  <div className="rounded-md border border-[#e2ded3] bg-white p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h5 className="font-bold text-[#0F3D2E]">Statement of account</h5>
                        <p className="text-sm text-[#617169]">PDF showing completion account movements.</p>
                      </div>
                      <span className="rounded-full border border-[#d9ded6] bg-[#F7F5EF] px-2 py-1 text-xs font-bold text-[#617169]">{statementOfAccountDocument ? statusLabel(statementOfAccountDocument.status) : "Not uploaded"}</span>
                    </div>
                    {statementOfAccountVersion ? (
                      <p className="mt-3 rounded-md border border-[#eef0eb] bg-[#fbfcfa] p-3 text-sm text-[#617169]">
                        {statementOfAccountVersion.file_name} {fileSizeLabel(statementOfAccountVersion.file_size_bytes)}
                      </p>
                    ) : null}
                    <div className="mt-3 grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
                      <label className="field-label">
                        Statement of account PDF
                        <input className="field" type="file" accept="application/pdf" onChange={(event) => setStatementOfAccountFile(event.target.files?.[0] ?? null)} disabled={!canSubmitCompletionDocuments || completionRecorded} />
                      </label>
                      {canSubmitCompletionDocuments && <button className="secondary" onClick={() => void uploadCompletionDocument("statement_of_account")} disabled={isSaving || !statementOfAccountFile || completionRecorded}>Upload</button>}
                    </div>
                  </div>
                </div>

                <div className="grid gap-4">
                  <div className="rounded-md border border-[#e2ded3] bg-white p-4">
                    <h5 className="font-bold text-[#0F3D2E]">Developer review</h5>
                    <p className="mt-1 text-sm text-[#617169]">Approve or query the completion statement and statement of account before completion is recorded.</p>
                    <label className="field-label mt-3">
                      Query note
                      <textarea className="field min-h-20" value={completionQueryNote} onChange={(event) => setCompletionQueryNote(event.target.value)} disabled={!canApproveCompletionDocuments || completionRecorded} />
                    </label>
                    <div className="mt-3 flex flex-wrap justify-end gap-2">
                      {canApproveCompletionDocuments && (
                        <>
                          <button className="secondary" onClick={() => void queryCompletionDocuments()} disabled={isSaving || completionRecorded || (!completionStatementDocument && !statementOfAccountDocument)}>Query documents</button>
                          <button className="primary" onClick={() => void approveCompletionDocuments()} disabled={isSaving || completionRecorded || !completionStatementVersion || !statementOfAccountVersion}>Approve completion documents</button>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="rounded-md border border-[#e2ded3] bg-white p-4">
                    <h5 className="font-bold text-[#0F3D2E]">Record completion</h5>
                    <p className="mt-1 text-sm text-[#617169]">This marks the unit Completed. The existing handover workflow is unchanged.</p>
                    <label className="field-label mt-3">
                      Actual completion date
                      <input
                        className="field"
                        type="date"
                        max={new Date().toISOString().slice(0, 10)}
                        value={completionDate}
                        onChange={(event) => setCompletionDate(event.target.value)}
                        disabled={!canRecordCompletion || !completionReady || completionRecorded}
                      />
                    </label>
                    {activeAttempt?.completed_at && (
                      <p className="mt-3 rounded-md border border-[#eef0eb] bg-[#fbfcfa] p-3 text-sm text-[#617169]">
                        Completion recorded for {formatDate(activeAttempt.completed_at)}.
                      </p>
                    )}
                    <div className="mt-4 flex justify-end">
                      {canRecordCompletion && (
                        <button className="primary" onClick={() => void recordCompletion()} disabled={isSaving || !completionDate || !completionReady || completionRecorded}>
                          Mark unit Completed
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}
            </div>
          )}

          {activeWorkflowStage === "handover" && (
            <div className="mt-5 rounded-lg border border-[#d9ded6] bg-[#fbfcfa] p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h4 className="text-base font-bold text-[#0F3D2E]">Handover</h4>
                  <p className="text-sm text-[#617169]">Completion unlocks the existing Bunnywell handover process.</p>
                </div>
                <span className="rounded-full border border-[#d9ded6] bg-white px-3 py-1 text-xs font-bold uppercase text-[#617169]">
                  {completionRecorded ? "Available" : "Locked"}
                </span>
              </div>
              <div className="mt-4 rounded-md border border-[#e2ded3] bg-white p-4 text-sm text-[#34413a]">
                {completionRecorded ? (
                  <p>Unit {selectedUnit.unit_number} is completed. Use the existing Handover area to manage resident and agent handover activity.</p>
                ) : (
                  <p>Complete the sale before handover becomes available.</p>
                )}
              </div>
            </div>
          )}

          {failedAttempts.length > 0 && (
            <div className="mt-5 rounded-lg border border-[#d9ded6] bg-[#F7F5EF] p-4">
              <h4 className="text-base font-bold text-[#0F3D2E]">Reservation history</h4>
              <div className="mt-3 grid gap-2">
                {failedAttempts.map((attempt) => (
                  <div key={attempt.id} className="rounded-md border border-[#e2ded3] bg-white p-3 text-sm">
                    <p className="font-semibold text-[#34413a]">Attempt {attempt.attempt_number} failed {formatDate(attempt.fallen_through_at)}</p>
                    <p className="mt-1 text-[#617169]">{attempt.fall_through_reason ?? "No reason recorded."}</p>
                    <p className="mt-1 text-xs font-semibold uppercase text-[#617169]">Buyer data and active documents redacted</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
