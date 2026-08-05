import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppRole } from "@/lib/data/production";
import { canPerformSalesAction, canViewSalesBuilding, isSalesInternalRole } from "@/lib/sales/permissions";
import { buildFailedReservationRedactionPatch } from "@/lib/sales/reservation-redaction";
import { buildDepositStructure, buildPaymentScheduleRows, paymentScheduleSummary } from "@/lib/sales/deal-structure";
import { parseGbpInput } from "@/lib/sales/currency";
import { createSupabaseServiceRoleClient, requiredEnv } from "@/lib/supabase/admin";

const SALE_DOCUMENTS_BUCKET = "sale-documents";

type Requester = {
  id: string;
  email: string | null;
  name: string | null;
  role: AppRole;
  organisation_id: string | null;
};

type ReservationPayload = {
  action?:
    | "save_reservation"
    | "approve_reservation"
    | "reject_reservation"
    | "query_reservation"
    | "fail_reservation"
    | "save_commercial_model"
    | "save_commercial_package"
    | "approve_commercial_package"
    | "record_exchange"
    | "record_invoice_reconciliation"
    | "approve_completion_documents"
    | "query_completion_documents"
    | "record_completion";
  unitId?: string;
  saleAttemptId?: string;
  buyerName?: string;
  buyerPersonName?: string;
  buyerCompanyName?: string;
  buyerEmail?: string;
  buyerPhone?: string;
  buyerSolicitorName?: string;
  reservationDate?: string | null;
  reservationTermsChecked?: boolean | null;
  reservationFee?: string | number | null;
  reservationFeeHolder?: string | null;
  listPriceAtOffer?: string | number | null;
  contractPrice?: string | number | null;
  parkingValue?: string | number | null;
  developerContribution?: string | number | null;
  developerContributionValueType?: "amount" | "percent" | null;
  agentContribution?: string | number | null;
  agentContributionValueType?: "amount" | "percent" | null;
  parkingContributionValue?: string | number | null;
  parkingLocationDetails?: string | null;
  additionalSpecialConditions?: string[] | null;
  agentFeePercent?: string | number | null;
  solicitorFee?: string | number | null;
  exchangeDepositPercent?: string | number | null;
  secondDepositEnabled?: boolean | null;
  secondDepositPercent?: string | number | null;
  secondDepositMonthsAfterExchange?: string | number | null;
  depositSummary?: string | null;
  commercialSummary?: string | null;
  invoiceReference?: string | null;
  invoiceDate?: string | null;
  invoiceNetAmount?: string | number | null;
  invoiceVatAmount?: string | number | null;
  invoiceGrossAmount?: string | number | null;
  exchangeDate?: string | null;
  solicitorPaymentAmount?: string | number | null;
  solicitorPaymentDate?: string | null;
  developerShortfallAmount?: string | number | null;
  developerShortfallDate?: string | null;
  reconciliationNotes?: string | null;
  completionDocumentType?: "completion_statement" | "statement_of_account";
  completionQueryNote?: string | null;
  completionDate?: string | null;
  reservationFormPath?: string | null;
  rejectionReason?: string | null;
  queryNote?: string | null;
  failReason?: string | null;
};

function normaliseText(value?: string | null) {
  const trimmed = value?.trim() ?? "";
  return trimmed || null;
}

function normaliseMoney(value?: string | number | null) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = parseGbpInput(value);
  return numeric !== null && Number.isFinite(numeric) && numeric >= 0 ? numeric : null;
}

function normalisePercent(value?: string | number | null) {
  const numeric = normaliseMoney(value);
  if (numeric === null || numeric > 100) return null;
  return numeric;
}

function normaliseInteger(value?: string | number | null) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = typeof value === "number" ? value : Number(value.toString().replace(/,/g, ""));
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  return Math.floor(numeric);
}

function normaliseDate(value?: string | null) {
  const trimmed = value?.trim() ?? "";
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : null;
}

function isFutureDate(value: string) {
  return value > new Date().toISOString().slice(0, 10);
}

function reservationDateTimestamp(value: string) {
  return `${value}T00:00:00.000Z`;
}

function hasRequiredBuyerInfo(attempt: {
  buyer_name?: string | null;
  buyer_person_name?: string | null;
  buyer_company_name?: string | null;
  buyer_email?: string | null;
  buyer_phone?: string | null;
  buyer_solicitor_name?: string | null;
}) {
  const hasBuyerIdentity = Boolean(normaliseText(attempt.buyer_person_name) || normaliseText(attempt.buyer_company_name) || normaliseText(attempt.buyer_name));
  return hasBuyerIdentity
    && Boolean(normaliseText(attempt.buyer_email))
    && Boolean(normaliseText(attempt.buyer_phone))
    && Boolean(normaliseText(attempt.buyer_solicitor_name));
}

function normaliseContributionType(value?: string | null, fallback: "amount" | "percent" = "amount") {
  return value === "percent" || value === "amount" ? value : fallback;
}

function normaliseTextArray(value?: string[] | null) {
  return (Array.isArray(value) ? value : [])
    .map((item) => normaliseText(item))
    .filter((item): item is string => Boolean(item));
}

function calculateContributionAmount(value: number, valueType: "amount" | "percent", contractPrice?: number | null) {
  if (valueType === "percent") return Math.round((Number(contractPrice ?? 0) * (value / 100)) * 100) / 100;
  return value;
}

function calculateAgentInvoiceValues(input: {
  contractPrice?: number | null;
  agentFeePercent?: number | null;
  vatRate?: number | null;
  reservationFee?: number | null;
  reservationFeeHolder?: string | null;
  agentContribution?: number | null;
}) {
  const feeBase = input.contractPrice ?? 0;
  const netAmount = feeBase * ((input.agentFeePercent ?? 0) / 100);
  const vatAmount = netAmount * ((input.vatRate ?? 20) / 100);
  const grossAmount = netAmount + vatAmount;
  const reservationFeeDeduction = input.reservationFeeHolder === "sales_agent" ? input.reservationFee ?? 0 : 0;
  const agentContributionDeduction = input.agentContribution ?? 0;
  const expectedPayableAmount = Math.max(0, grossAmount - reservationFeeDeduction - agentContributionDeduction);

  return {
    netAmount: Math.round(netAmount * 100) / 100,
    vatAmount: Math.round(vatAmount * 100) / 100,
    grossAmount: Math.round(grossAmount * 100) / 100,
    reservationFeeDeduction: Math.round(reservationFeeDeduction * 100) / 100,
    agentContributionDeduction: Math.round(agentContributionDeduction * 100) / 100,
    expectedPayableAmount: Math.round(expectedPayableAmount * 100) / 100,
  };
}

function calculateScheduleAmount(row: {
  expected_amount?: number | null;
  fixed_amount?: number | null;
  percent_of_contract_price?: number | null;
}, contractPrice?: number | null) {
  if (row.expected_amount !== null && row.expected_amount !== undefined) return Number(row.expected_amount);
  if (row.fixed_amount !== null && row.fixed_amount !== undefined) return Number(row.fixed_amount);
  if (row.percent_of_contract_price !== null && row.percent_of_contract_price !== undefined && contractPrice) {
    return Number(contractPrice) * (Number(row.percent_of_contract_price) / 100);
  }
  return 0;
}

async function getRequester(request: Request, adminClient: SupabaseClient) {
  const token = request.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) return { response: NextResponse.json({ error: "Missing session token." }, { status: 401 }) };

  const authClient = createSupabaseServiceRoleClient();
  const { data: userData, error: userError } = await authClient.auth.getUser(token);
  if (userError || !userData.user) return { response: NextResponse.json({ error: "Invalid session." }, { status: 401 }) };

  const { data: profile, error: profileError } = await adminClient
    .from("profiles")
    .select("id,email,name,full_name,role,organisation_id,active")
    .eq("id", userData.user.id)
    .maybeSingle();

  if (profileError) return { response: NextResponse.json({ error: profileError.message }, { status: 403 }) };
  if (!profile || profile.active === false) return { response: NextResponse.json({ error: "Active sales user profile not found." }, { status: 403 }) };

  return {
    requester: {
      id: profile.id,
      email: profile.email,
      name: profile.full_name || profile.name || profile.email,
      role: profile.role as AppRole,
      organisation_id: profile.organisation_id,
    } satisfies Requester,
  };
}

async function requesterBuildingIds(adminClient: SupabaseClient, requester: Requester) {
  if (isSalesInternalRole(requester.role)) return [];

  const [directAccess, organisationAccess] = await Promise.all([
    adminClient.from("user_building_access").select("building_id").eq("user_id", requester.id),
    requester.organisation_id
      ? adminClient
        .from("building_organisations")
        .select("building_id")
        .eq("organisation_id", requester.organisation_id)
        .eq("role_on_project", requester.role)
        .neq("active", false)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (directAccess.error) throw directAccess.error;
  if (organisationAccess.error) throw organisationAccess.error;

  return Array.from(new Set([
    ...(directAccess.data ?? []).map((row) => row.building_id as string),
    ...(organisationAccess.data ?? []).map((row) => row.building_id as string),
  ]));
}

async function assertCanUseBuilding(adminClient: SupabaseClient, requester: Requester, buildingId: string) {
  const accessibleBuildingIds = await requesterBuildingIds(adminClient, requester);
  if (!canViewSalesBuilding({ role: requester.role, buildingId, accessibleBuildingIds })) {
    throw new Error("You do not have sales access to this building.");
  }
}

async function loadUnit(adminClient: SupabaseClient, unitId: string) {
  const { data: unit, error } = await adminClient
    .from("units")
    .select("id,building_id,unit_number,sale_status")
    .eq("id", unitId)
    .maybeSingle();

  if (error) throw error;
  if (!unit) throw new Error("Unit not found.");
  return unit;
}

async function loadSaleAttempt(adminClient: SupabaseClient, saleAttemptId: string) {
  const { data: attempt, error } = await adminClient
    .from("unit_sale_attempts")
    .select("*")
    .eq("id", saleAttemptId)
    .maybeSingle();

  if (error) throw error;
  if (!attempt) throw new Error("Sale attempt not found.");
  return attempt;
}

async function nextAttemptNumber(adminClient: SupabaseClient, unitId: string) {
  const { data, error } = await adminClient
    .from("unit_sale_attempts")
    .select("attempt_number")
    .eq("unit_id", unitId)
    .order("attempt_number", { ascending: false })
    .limit(1);

  if (error) throw error;
  return ((data?.[0]?.attempt_number as number | undefined) ?? 0) + 1;
}

async function activeAttemptForUnit(adminClient: SupabaseClient, unitId: string) {
  const { data, error } = await adminClient
    .from("unit_sale_attempts")
    .select("*")
    .eq("unit_id", unitId)
    .eq("is_active", true)
    .maybeSingle();

  if (error) throw error;
  return data;
}

async function currentTermsForAttempt(adminClient: SupabaseClient, saleAttemptId: string) {
  const { data, error } = await adminClient
    .from("unit_sale_terms")
    .select("*")
    .eq("sale_attempt_id", saleAttemptId)
    .eq("is_current", true)
    .maybeSingle();

  if (error) throw error;
  return data;
}

async function loadBuildingSaleDefaults(adminClient: SupabaseClient, buildingId: string) {
  const { data, error } = await adminClient
    .from("building_sale_defaults")
    .select("*")
    .eq("building_id", buildingId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

async function createDraftSaleAttempt(adminClient: SupabaseClient, requester: Requester, unit: { id: string; building_id: string }) {
  const existing = await activeAttemptForUnit(adminClient, unit.id);
  if (existing) return existing;

  const now = new Date().toISOString();
  const { data, error } = await adminClient.from("unit_sale_attempts").insert({
    building_id: unit.building_id,
    unit_id: unit.id,
    attempt_number: await nextAttemptNumber(adminClient, unit.id),
    workflow_status: "draft",
    is_active: true,
    stage_entered_at: now,
    created_by_user_id: requester.id,
    updated_by_user_id: requester.id,
  }).select("*").single();

  if (error) throw error;
  return data;
}

function termsSnapshotFromDefaults(input: {
  defaults?: Record<string, unknown> | null;
  currentTerms?: Record<string, unknown> | null;
  payload?: ReservationPayload;
  usePayloadCommercials?: boolean;
}) {
  const { defaults, currentTerms, payload, usePayloadCommercials } = input;
  const hasPayloadValue = (key: keyof ReservationPayload) => Boolean(payload && Object.prototype.hasOwnProperty.call(payload, key));
  const toNumber = (value: unknown) => {
    const numeric = Number(value ?? 0);
    return Number.isFinite(numeric) ? numeric : 0;
  };
  const toNullableNumber = (value: unknown) => {
    const numeric = toNumber(value);
    return numeric > 0 ? numeric : null;
  };
  const payloadExchangeDeposit = usePayloadCommercials ? normalisePercent(payload?.exchangeDepositPercent) : null;
  const payloadSecondDepositPercent = usePayloadCommercials ? normalisePercent(payload?.secondDepositPercent) : null;
  const payloadSecondDepositMonths = usePayloadCommercials ? normaliseInteger(payload?.secondDepositMonthsAfterExchange) : null;
  const payloadSecondDepositEnabled = usePayloadCommercials ? Boolean(payload?.secondDepositEnabled) : null;

  const currentContractPrice = toNullableNumber(currentTerms?.contract_price ?? currentTerms?.list_price_at_offer);
  const contractPrice = usePayloadCommercials
    ? hasPayloadValue("contractPrice") ? normaliseMoney(payload?.contractPrice) : currentContractPrice
    : toNullableNumber(currentTerms?.contract_price);
  const developerContributionValueType = usePayloadCommercials
    ? normaliseContributionType(payload?.developerContributionValueType, normaliseContributionType(currentTerms?.developer_contribution_value_type as string | null | undefined))
    : normaliseContributionType(currentTerms?.developer_contribution_value_type as string | null | undefined);
  const developerContributionValue = usePayloadCommercials
    ? hasPayloadValue("developerContribution") ? normaliseMoney(payload?.developerContribution) ?? 0 : toNumber(currentTerms?.developer_contribution_value ?? currentTerms?.developer_contribution)
    : toNumber(currentTerms?.developer_contribution_value ?? currentTerms?.developer_contribution);
  const agentContributionValueType = usePayloadCommercials
    ? normaliseContributionType(payload?.agentContributionValueType, normaliseContributionType(currentTerms?.agent_contribution_value_type as string | null | undefined))
    : normaliseContributionType(currentTerms?.agent_contribution_value_type as string | null | undefined);
  const agentContributionValue = usePayloadCommercials
    ? hasPayloadValue("agentContribution") ? normaliseMoney(payload?.agentContribution) ?? 0 : toNumber(currentTerms?.agent_contribution_value ?? currentTerms?.agent_contribution)
    : toNumber(currentTerms?.agent_contribution_value ?? currentTerms?.agent_contribution);
  const exchangeDepositPercent = Number((usePayloadCommercials ? payloadExchangeDeposit : null) ?? currentTerms?.exchange_deposit_percent ?? defaults?.exchange_deposit_percent ?? 10);
  const secondDepositEnabled = Boolean((usePayloadCommercials ? payloadSecondDepositEnabled : null) ?? currentTerms?.second_deposit_enabled ?? defaults?.second_deposit_enabled ?? false);
  const secondDepositPercent = Number((usePayloadCommercials ? payloadSecondDepositPercent : null) ?? currentTerms?.second_deposit_percent ?? defaults?.second_deposit_percent ?? 0);
  const secondDepositMonthsSource = (usePayloadCommercials ? payloadSecondDepositMonths : null)
    ?? currentTerms?.second_deposit_months_after_exchange
    ?? defaults?.second_deposit_months_after_exchange;
  const secondDepositMonthsAfterExchange = normaliseInteger(secondDepositMonthsSource as string | number | null | undefined);
  const depositStructure = buildDepositStructure({
    exchangeDepositPercent,
    secondDepositEnabled,
    secondDepositPercent,
    secondDepositMonthsAfterExchange,
  });

  if (!depositStructure.isValid) throw new Error(depositStructure.error ?? "Payment schedule is invalid.");

  return {
    list_price_at_offer: usePayloadCommercials
      ? hasPayloadValue("listPriceAtOffer") ? normaliseMoney(payload?.listPriceAtOffer) : toNullableNumber(currentTerms?.list_price_at_offer ?? currentTerms?.contract_price ?? contractPrice)
      : toNullableNumber(currentTerms?.list_price_at_offer ?? currentTerms?.contract_price ?? contractPrice),
    contract_price: contractPrice,
    parking_value: usePayloadCommercials ? hasPayloadValue("parkingValue") ? normaliseMoney(payload?.parkingValue) ?? 0 : toNumber(currentTerms?.parking_value) : toNumber(currentTerms?.parking_value),
    developer_contribution: calculateContributionAmount(developerContributionValue, developerContributionValueType, contractPrice),
    developer_contribution_value: developerContributionValue,
    developer_contribution_value_type: developerContributionValueType,
    agent_contribution: calculateContributionAmount(agentContributionValue, agentContributionValueType, contractPrice),
    agent_contribution_value: agentContributionValue,
    agent_contribution_value_type: agentContributionValueType,
    parking_contribution_value: usePayloadCommercials ? hasPayloadValue("parkingContributionValue") ? normaliseMoney(payload?.parkingContributionValue) ?? 0 : toNumber(currentTerms?.parking_contribution_value) : toNumber(currentTerms?.parking_contribution_value),
    parking_location_details: usePayloadCommercials ? normaliseText(payload?.parkingLocationDetails) ?? currentTerms?.parking_location_details ?? null : currentTerms?.parking_location_details ?? null,
    additional_special_conditions: usePayloadCommercials ? normaliseTextArray(payload?.additionalSpecialConditions) : Array.isArray(currentTerms?.additional_special_conditions) ? currentTerms.additional_special_conditions : [],
    reservation_fee: usePayloadCommercials
      ? hasPayloadValue("reservationFee") ? normaliseMoney(payload?.reservationFee) : toNullableNumber(currentTerms?.reservation_fee ?? defaults?.reservation_fee)
      : toNullableNumber(currentTerms?.reservation_fee ?? defaults?.reservation_fee),
    reservation_fee_holder: usePayloadCommercials
      ? normaliseText(payload?.reservationFeeHolder) ?? currentTerms?.reservation_fee_holder ?? defaults?.reservation_fee_holder_default ?? "sales_agent"
      : currentTerms?.reservation_fee_holder ?? defaults?.reservation_fee_holder_default ?? "sales_agent",
    agent_fee_percent: usePayloadCommercials
      ? hasPayloadValue("agentFeePercent") ? normalisePercent(payload?.agentFeePercent) : toNullableNumber(currentTerms?.agent_fee_percent ?? defaults?.default_agent_fee_percent)
      : toNullableNumber(currentTerms?.agent_fee_percent ?? defaults?.default_agent_fee_percent),
    vat_rate: Number(currentTerms?.vat_rate ?? defaults?.default_vat_rate ?? 20),
    solicitor_fee: usePayloadCommercials
      ? hasPayloadValue("solicitorFee") ? normaliseMoney(payload?.solicitorFee) : Number(currentTerms?.solicitor_fee ?? defaults?.default_sales_solicitor_fee ?? 882)
      : Number(currentTerms?.solicitor_fee ?? defaults?.default_sales_solicitor_fee ?? 882),
    exchange_deposit_percent: depositStructure.exchangeDepositPercent,
    second_deposit_enabled: depositStructure.secondDepositEnabled,
    second_deposit_percent: depositStructure.secondDepositEnabled ? depositStructure.secondDepositPercent : null,
    second_deposit_months_after_exchange: depositStructure.secondDepositEnabled ? depositStructure.secondDepositMonthsAfterExchange : null,
    completion_balance_percent: depositStructure.completionBalancePercent,
    deposit_summary: paymentScheduleSummary(depositStructure),
    commercial_summary: usePayloadCommercials ? normaliseText(payload?.commercialSummary) : currentTerms?.commercial_summary ?? null,
  };
}

async function replacePaymentSchedule(adminClient: SupabaseClient, requester: Requester, attempt: { id: string }, saleTermsId: string, terms: Record<string, unknown>) {
  const rows = buildPaymentScheduleRows({
    contractPrice: terms.contract_price === null || terms.contract_price === undefined ? null : Number(terms.contract_price),
    exchangeDepositPercent: Number(terms.exchange_deposit_percent ?? 10),
    secondDepositEnabled: Boolean(terms.second_deposit_enabled),
    secondDepositPercent: Number(terms.second_deposit_percent ?? 0),
    secondDepositMonthsAfterExchange: normaliseInteger(terms.second_deposit_months_after_exchange as string | number | null | undefined),
  });

  const { error: deleteError } = await adminClient
    .from("unit_sale_payment_schedule")
    .delete()
    .eq("sale_attempt_id", attempt.id);
  if (deleteError) throw deleteError;

  const { error: insertError } = await adminClient.from("unit_sale_payment_schedule").insert(rows.map((row) => ({
    sale_attempt_id: attempt.id,
    sale_terms_id: saleTermsId,
    sequence_no: row.sequenceNo,
    payment_stage: row.paymentStage,
    label: row.label,
    due_event: row.dueEvent,
    due_offset_days: row.dueOffsetDays,
    percent_of_contract_price: row.percentOfContractPrice,
    fixed_amount: null,
    expected_amount: row.expectedAmount,
    includes_reservation_fee: row.includesReservationFee,
    status: "pending",
    created_by_user_id: requester.id,
    updated_by_user_id: requester.id,
  })));
  if (insertError) throw insertError;
}

async function insertEvent(
  adminClient: SupabaseClient,
  attempt: { id: string; building_id: string; unit_id: string; workflow_status?: string | null },
  requester: Requester,
  event: { type: string; toStatus?: string | null; summary: string; metadata?: Record<string, unknown> },
) {
  await adminClient.from("unit_sale_workflow_events").insert({
    sale_attempt_id: attempt.id,
    building_id: attempt.building_id,
    unit_id: attempt.unit_id,
    event_type: event.type,
    from_status: attempt.workflow_status ?? null,
    to_status: event.toStatus ?? null,
    summary: event.summary,
    metadata: event.metadata ?? {},
    created_by_user_id: requester.id,
  });
}

async function ensureSaleDocumentsBucket(adminClient: SupabaseClient) {
  const { data: buckets, error } = await adminClient.storage.listBuckets();
  if (error) throw error;
  if (buckets.some((bucket) => bucket.name === SALE_DOCUMENTS_BUCKET)) return;

  const { error: createError } = await adminClient.storage.createBucket(SALE_DOCUMENTS_BUCKET, {
    public: false,
    fileSizeLimit: 10 * 1024 * 1024,
    allowedMimeTypes: ["application/pdf"],
  });
  if (createError) throw createError;
}

async function saveReservation(adminClient: SupabaseClient, requester: Requester, payload: ReservationPayload) {
  if (!canPerformSalesAction(requester.role, "submit_reservation")) throw new Error("You cannot submit reservations.");
  if (!payload.unitId) throw new Error("Choose a unit.");
  const buyerPersonName = normaliseText(payload.buyerPersonName) ?? normaliseText(payload.buyerName);
  const buyerCompanyName = normaliseText(payload.buyerCompanyName);
  if (!buyerPersonName && !buyerCompanyName) throw new Error("Enter a personal buyer name, company name, or both.");
  if (!normaliseText(payload.buyerEmail)) throw new Error("Enter the buyer email before submitting the reservation.");
  if (!normaliseText(payload.buyerPhone)) throw new Error("Enter the buyer phone before submitting the reservation.");
  if (!normaliseText(payload.buyerSolicitorName)) throw new Error("Enter the buyer solicitor before submitting the reservation.");
  const reservationDate = normaliseDate(payload.reservationDate);
  if (!reservationDate) throw new Error("Enter the reservation date shown on the signed reservation form.");
  if (isFutureDate(reservationDate)) throw new Error("Reservation date cannot be in the future.");
  if (payload.reservationTermsChecked !== true) {
    throw new Error("Confirm that the reservation form reflects the developer-approved commercial terms.");
  }

  const unit = await loadUnit(adminClient, payload.unitId);
  await assertCanUseBuilding(adminClient, requester, unit.building_id);

  const now = new Date().toISOString();
  let attempt = await activeAttemptForUnit(adminClient, unit.id);

  if (!attempt) {
    attempt = await createDraftSaleAttempt(adminClient, requester, unit);
  }

  if (!["draft", "rejected", "reservation_query_raised"].includes(attempt.workflow_status)) {
    throw new Error("This reservation cannot be edited in its current approval state.");
  }

  const wasRejected = ["rejected", "reservation_query_raised"].includes(attempt.workflow_status);
  const { data: updatedAttempt, error: attemptError } = await adminClient.from("unit_sale_attempts").update({
    buyer_name: buyerPersonName ?? buyerCompanyName,
    buyer_person_name: buyerPersonName,
    buyer_company_name: buyerCompanyName,
    buyer_email: normaliseText(payload.buyerEmail),
    buyer_phone: normaliseText(payload.buyerPhone),
    buyer_solicitor_name: normaliseText(payload.buyerSolicitorName),
    workflow_status: "awaiting_approval",
    reservation_date: reservationDate,
    reservation_submitted_at: now,
    reservation_terms_checked: true,
    reservation_submitted_by_user_id: requester.id,
    reservation_submitted_by_name: requester.name,
    reservation_submitted_by_email: requester.email,
    reservation_approved_at: null,
    reservation_approved_by_user_id: null,
    reservation_approved_by_name: null,
    reservation_approved_by_email: null,
    reservation_rejected_at: null,
    reservation_rejected_by_user_id: null,
    reservation_rejected_by_name: null,
    reservation_rejected_by_email: null,
    reservation_rejection_reason: null,
    stage_entered_at: now,
    updated_by_user_id: requester.id,
    updated_at: now,
  }).eq("id", attempt.id).select("*").single();

  if (attemptError) throw attemptError;

  const currentTerms = await currentTermsForAttempt(adminClient, attempt.id);
  const defaults = await loadBuildingSaleDefaults(adminClient, unit.building_id);
  const termsPayload = {
    sale_attempt_id: attempt.id,
    is_current: true,
    status: "submitted",
    ...termsSnapshotFromDefaults({ defaults, currentTerms, payload, usePayloadCommercials: false }),
    updated_by_user_id: requester.id,
    updated_at: now,
  };

  let saleTermsId = currentTerms?.id as string | undefined;
  if (currentTerms) {
    const { data, error } = await adminClient.from("unit_sale_terms").update(termsPayload).eq("id", currentTerms.id).select("id").single();
    if (error) throw error;
    saleTermsId = data.id as string;
  } else {
    const { data, error } = await adminClient.from("unit_sale_terms").insert({
      ...termsPayload,
      version_number: 1,
      created_by_user_id: requester.id,
    }).select("id").single();
    if (error) throw error;
    saleTermsId = data.id as string;
  }
  if (saleTermsId) await replacePaymentSchedule(adminClient, requester, attempt, saleTermsId, termsPayload);

  await adminClient.from("units").update({
    sale_status: "for_sale",
    reservation_date: null,
  }).eq("id", unit.id);

  await adminClient.from("unit_sale_documents").update({
    status: "under_review",
    query_note: null,
    updated_by_user_id: requester.id,
    updated_at: now,
  }).eq("sale_attempt_id", attempt.id).eq("document_type", "reservation_form");

  await insertEvent(adminClient, attempt, requester, {
    type: wasRejected ? "reservation_resubmitted" : "reservation_submitted",
    toStatus: updatedAttempt.workflow_status,
    summary: wasRejected ? `Reservation resubmitted for unit ${unit.unit_number}.` : `Reservation submitted for unit ${unit.unit_number}.`,
    metadata: { reservationDate },
  });

  return { saleAttemptId: attempt.id };
}

async function uploadSaleDocument(adminClient: SupabaseClient, requester: Requester, formData: FormData, config?: {
  documentType?: "reservation_form" | "agent_invoice" | "completion_statement" | "statement_of_account";
  documentTitle?: string;
  requiredAction?: "submit_reservation" | "submit_agent_invoice" | "submit_completion_documents";
  storagePrefix?: string;
}) {
  const documentType = config?.documentType ?? "reservation_form";
  const documentTitle = config?.documentTitle ?? "Reservation form";
  const requiredAction = config?.requiredAction ?? "submit_reservation";
  const storagePrefix = config?.storagePrefix ?? "reservation-form";

  if (!canPerformSalesAction(requester.role, requiredAction)) throw new Error("You cannot upload this sale document.");
  const saleAttemptId = formData.get("saleAttemptId")?.toString();
  const file = formData.get("file");
  if (!saleAttemptId) throw new Error("Sale attempt is required.");
  if (!(file instanceof File)) throw new Error(`${documentTitle} PDF is required.`);
  if (file.type && file.type !== "application/pdf") throw new Error(`Upload the ${documentTitle.toLowerCase()} as a PDF.`);

  const attempt = await loadSaleAttempt(adminClient, saleAttemptId);
  await assertCanUseBuilding(adminClient, requester, attempt.building_id);

  const documentResult = await adminClient
    .from("unit_sale_documents")
    .select("*")
    .eq("sale_attempt_id", saleAttemptId)
    .eq("document_type", documentType)
    .is("superseded_at", null)
    .maybeSingle();
  let document = documentResult.data;
  const documentError = documentResult.error;

  if (documentError) throw documentError;
  if (documentType === "reservation_form") {
    let hasCurrentReservationVersion = false;
    if (document?.id) {
      const { data: currentVersion, error: currentVersionError } = await adminClient
        .from("unit_sale_document_versions")
        .select("id")
        .eq("document_id", document.id)
        .eq("is_current", true)
        .is("redacted_at", null)
        .maybeSingle();
      if (currentVersionError) throw currentVersionError;
      hasCurrentReservationVersion = Boolean(currentVersion);
    }
    const canUploadBeforeSubmission = ["draft", "rejected", "reservation_query_raised"].includes(attempt.workflow_status);
    const canCompleteMissingAwaitingUpload = ["awaiting_approval", "reservation_submitted"].includes(attempt.workflow_status) && !hasCurrentReservationVersion;
    if (!canUploadBeforeSubmission && !canCompleteMissingAwaitingUpload) {
      throw new Error("Reservation forms are locked while awaiting approval and after approval.");
    }
  }
  await ensureSaleDocumentsBucket(adminClient);

  const isReplacement = Boolean(document);
  if (!document) {
    const { data, error } = await adminClient.from("unit_sale_documents").insert({
      sale_attempt_id: saleAttemptId,
      document_type: documentType,
      title: documentTitle,
      status: "uploaded",
      visibility: "shared_sale_file",
      created_by_user_id: requester.id,
      updated_by_user_id: requester.id,
    }).select("*").single();
    if (error) throw error;
    document = data;
  } else {
    const { error } = await adminClient.from("unit_sale_documents").update({
      status: "uploaded",
      query_note: null,
      updated_by_user_id: requester.id,
      updated_at: new Date().toISOString(),
    }).eq("id", document.id);
    if (error) throw error;
  }

  const { data: versions, error: versionError } = await adminClient
    .from("unit_sale_document_versions")
    .select("version_number")
    .eq("document_id", document.id)
    .order("version_number", { ascending: false })
    .limit(1);

  if (versionError) throw versionError;
  const versionNumber = ((versions?.[0]?.version_number as number | undefined) ?? 0) + 1;
  const safeFileName = file.name.replace(/[^\w.\- ]+/g, "_") || `${storagePrefix}.pdf`;
  const storagePath = `${attempt.building_id}/${attempt.unit_id}/${saleAttemptId}/${storagePrefix}-v${versionNumber}-${crypto.randomUUID()}.pdf`;

  const { error: uploadError } = await adminClient.storage
    .from(SALE_DOCUMENTS_BUCKET)
    .upload(storagePath, file, {
      contentType: file.type || "application/pdf",
      upsert: false,
    });
  if (uploadError) throw uploadError;

  await adminClient.from("unit_sale_document_versions").update({ is_current: false }).eq("document_id", document.id);

  const { error: insertVersionError } = await adminClient.from("unit_sale_document_versions").insert({
    document_id: document.id,
    version_number: versionNumber,
    is_current: true,
    storage_bucket: SALE_DOCUMENTS_BUCKET,
    storage_path: storagePath,
    file_name: safeFileName,
    mime_type: file.type || "application/pdf",
    file_size_bytes: file.size,
    uploaded_by_user_id: requester.id,
  });
  if (insertVersionError) throw insertVersionError;

  await insertEvent(adminClient, attempt, requester, {
    type: isReplacement ? `${documentType}_replaced` : `${documentType}_uploaded`,
    summary: `${documentTitle} ${isReplacement ? "replaced" : "uploaded"}.`,
    metadata: { fileName: safeFileName, versionNumber },
  });

  return { saleAttemptId, documentId: document.id };
}

async function uploadReservationForm(adminClient: SupabaseClient, requester: Requester, formData: FormData) {
  return uploadSaleDocument(adminClient, requester, formData);
}

async function uploadAgentInvoice(adminClient: SupabaseClient, requester: Requester, formData: FormData) {
  const result = await uploadSaleDocument(adminClient, requester, formData, {
    documentType: "agent_invoice",
    documentTitle: "Agent invoice",
    requiredAction: "submit_agent_invoice",
    storagePrefix: "agent-invoice",
  });

  const attempt = await loadSaleAttempt(adminClient, result.saleAttemptId);
  const currentTerms = await currentTermsForAttempt(adminClient, attempt.id);
  const expected = calculateAgentInvoiceValues({
    contractPrice: currentTerms?.contract_price as number | null,
    agentFeePercent: currentTerms?.agent_fee_percent as number | null,
    vatRate: currentTerms?.vat_rate as number | null,
    reservationFee: currentTerms?.reservation_fee as number | null,
    reservationFeeHolder: currentTerms?.reservation_fee_holder as string | null,
    agentContribution: currentTerms?.agent_contribution as number | null,
  });

  const existingInvoice = await adminClient
    .from("unit_sale_invoices")
    .select("id")
    .eq("sale_attempt_id", attempt.id)
    .eq("invoice_type", "sales_agent")
    .maybeSingle();
  if (existingInvoice.error) throw existingInvoice.error;

  const invoicePayload = {
    sale_attempt_id: attempt.id,
    document_id: result.documentId,
    invoice_type: "sales_agent",
    supplier_organisation_id: attempt.sales_agent_organisation_id,
    net_amount: expected.netAmount,
    vat_amount: expected.vatAmount,
    gross_amount: expected.grossAmount,
    reservation_fee_deduction: expected.reservationFeeDeduction,
    agent_contribution_deduction: expected.agentContributionDeduction,
    expected_payable_amount: expected.expectedPayableAmount,
    status: "uploaded",
    updated_by_user_id: requester.id,
    updated_at: new Date().toISOString(),
  };

  if (existingInvoice.data?.id) {
    const { error } = await adminClient.from("unit_sale_invoices").update(invoicePayload).eq("id", existingInvoice.data.id);
    if (error) throw error;
  } else {
    const { error } = await adminClient.from("unit_sale_invoices").insert({
      ...invoicePayload,
      created_by_user_id: requester.id,
    });
    if (error) throw error;
  }

  return result;
}

async function uploadCompletionDocument(adminClient: SupabaseClient, requester: Requester, formData: FormData) {
  const documentType = formData.get("documentType")?.toString();
  if (documentType !== "completion_statement" && documentType !== "statement_of_account") {
    throw new Error("Choose a valid completion document type.");
  }

  const saleAttemptId = formData.get("saleAttemptId")?.toString();
  if (!saleAttemptId) throw new Error("Sale attempt is required.");
  const attempt = await loadSaleAttempt(adminClient, saleAttemptId);
  if (!["exchanged", "completion_pending", "completed"].includes(attempt.workflow_status)) {
    throw new Error("Exchange must be recorded before completion documents are uploaded.");
  }

  return uploadSaleDocument(adminClient, requester, formData, {
    documentType,
    documentTitle: documentType === "completion_statement" ? "Completion statement" : "Statement of account",
    requiredAction: "submit_completion_documents",
    storagePrefix: documentType === "completion_statement" ? "completion-statement" : "statement-of-account",
  });
}

async function approveReservation(adminClient: SupabaseClient, requester: Requester, payload: ReservationPayload) {
  if (!canPerformSalesAction(requester.role, "approve_reservation")) throw new Error("Only developers can approve reservations.");
  if (!payload.saleAttemptId) throw new Error("Sale attempt is required.");

  const attempt = await loadSaleAttempt(adminClient, payload.saleAttemptId);
  await assertCanUseBuilding(adminClient, requester, attempt.building_id);
  if (!["awaiting_approval", "reservation_submitted"].includes(attempt.workflow_status)) {
    throw new Error("A submitted reservation pack is required before approval.");
  }
  if (!hasRequiredBuyerInfo(attempt)) {
    throw new Error("Buyer email, phone, solicitor and buyer name are required before approval.");
  }
  const reservationDate = normaliseDate(payload.reservationDate ?? attempt.reservation_date);
  if (!reservationDate) throw new Error("Reservation date is required before approval.");
  if (isFutureDate(reservationDate)) throw new Error("Reservation date cannot be in the future.");

  const { data: reservationVersion, error: reservationVersionError } = await adminClient
    .from("unit_sale_document_versions")
    .select("id,unit_sale_documents!inner(sale_attempt_id,document_type)")
    .eq("unit_sale_documents.sale_attempt_id", attempt.id)
    .eq("unit_sale_documents.document_type", "reservation_form")
    .eq("is_current", true)
    .is("redacted_at", null)
    .maybeSingle();
  if (reservationVersionError) throw reservationVersionError;
  if (!reservationVersion) throw new Error("Upload the reservation form PDF before approving the reservation.");

  const now = new Date().toISOString();

  const { data: updatedAttempt, error } = await adminClient.from("unit_sale_attempts").update({
    workflow_status: "approved",
    reservation_date: reservationDate,
    reservation_approved_at: now,
    reservation_approved_by_user_id: requester.id,
    reservation_approved_by_name: requester.name,
    reservation_approved_by_email: requester.email,
    stage_entered_at: reservationDateTimestamp(reservationDate),
    updated_by_user_id: requester.id,
    updated_at: now,
  }).eq("id", attempt.id).select("*").single();
  if (error) throw error;

  await adminClient.from("unit_sale_terms").update({
    status: "approved",
    approved_by_user_id: requester.id,
    approved_at: now,
    updated_by_user_id: requester.id,
    updated_at: now,
  }).eq("sale_attempt_id", attempt.id).eq("is_current", true);

  await adminClient.from("unit_sale_documents").update({
    status: "approved",
    approved_by_user_id: requester.id,
    approved_at: now,
    updated_by_user_id: requester.id,
    updated_at: now,
  }).eq("sale_attempt_id", attempt.id).eq("document_type", "reservation_form");

  await adminClient.from("units").update({ sale_status: "reserved", reservation_date: reservationDate }).eq("id", attempt.unit_id);

  await insertEvent(adminClient, attempt, requester, {
    type: "reservation_approved",
    toStatus: "approved",
    summary: "Reservation approved. Unit marked Reserved.",
    metadata: { reservationDate },
  });

  return { saleAttemptId: updatedAttempt.id };
}

async function rejectReservation(adminClient: SupabaseClient, requester: Requester, payload: ReservationPayload) {
  if (!canPerformSalesAction(requester.role, "approve_reservation")) throw new Error("Only developers can reject reservations.");
  if (!payload.saleAttemptId) throw new Error("Sale attempt is required.");
  const rejectionReason = normaliseText(payload.rejectionReason);
  if (!rejectionReason) throw new Error("Add a rejection reason.");

  const attempt = await loadSaleAttempt(adminClient, payload.saleAttemptId);
  await assertCanUseBuilding(adminClient, requester, attempt.building_id);
  if (!["awaiting_approval", "reservation_submitted"].includes(attempt.workflow_status)) {
    throw new Error("Only reservations awaiting developer approval can be rejected.");
  }

  const now = new Date().toISOString();
  await adminClient.from("unit_sale_attempts").update({
    workflow_status: "rejected",
    reservation_rejected_at: now,
    reservation_rejected_by_user_id: requester.id,
    reservation_rejected_by_name: requester.name,
    reservation_rejected_by_email: requester.email,
    reservation_rejection_reason: rejectionReason,
    stage_entered_at: now,
    updated_by_user_id: requester.id,
    updated_at: now,
  }).eq("id", attempt.id);

  await adminClient.from("unit_sale_terms").update({
    status: "draft",
    updated_by_user_id: requester.id,
    updated_at: now,
  }).eq("sale_attempt_id", attempt.id).eq("is_current", true);

  await adminClient.from("unit_sale_documents").update({
    status: "uploaded",
    query_note: null,
    updated_by_user_id: requester.id,
    updated_at: now,
  }).eq("sale_attempt_id", attempt.id).eq("document_type", "reservation_form");

  await adminClient.from("units").update({
    sale_status: "for_sale",
    reservation_date: null,
  }).eq("id", attempt.unit_id);

  await adminClient.from("unit_sale_notes").insert({
    sale_attempt_id: attempt.id,
    building_id: attempt.building_id,
    unit_id: attempt.unit_id,
    category: "blocker",
    visibility: "shared_sale_file",
    body: rejectionReason,
    created_by_user_id: requester.id,
  });

  await insertEvent(adminClient, attempt, requester, {
    type: "reservation_rejected",
    toStatus: "rejected",
    summary: "Reservation rejected. Unit remains For Sale.",
    metadata: { rejectionReason },
  });

  return { saleAttemptId: attempt.id };
}

async function queryReservation(adminClient: SupabaseClient, requester: Requester, payload: ReservationPayload) {
  if (!canPerformSalesAction(requester.role, "approve_reservation")) throw new Error("Only developers can query reservations.");
  if (!payload.saleAttemptId) throw new Error("Sale attempt is required.");
  const queryNote = normaliseText(payload.queryNote);
  if (!queryNote) throw new Error("Add a query note.");

  const attempt = await loadSaleAttempt(adminClient, payload.saleAttemptId);
  await assertCanUseBuilding(adminClient, requester, attempt.building_id);
  const now = new Date().toISOString();

  await adminClient.from("unit_sale_attempts").update({
    workflow_status: "reservation_query_raised",
    updated_by_user_id: requester.id,
    updated_at: now,
  }).eq("id", attempt.id);

  await adminClient.from("unit_sale_documents").update({
    status: "query_raised",
    query_note: queryNote,
    updated_by_user_id: requester.id,
    updated_at: now,
  }).eq("sale_attempt_id", attempt.id).eq("document_type", "reservation_form");

  await adminClient.from("unit_sale_notes").insert({
    sale_attempt_id: attempt.id,
    building_id: attempt.building_id,
    unit_id: attempt.unit_id,
    category: "blocker",
    visibility: "shared_sale_file",
    body: queryNote,
    created_by_user_id: requester.id,
  });

  await insertEvent(adminClient, attempt, requester, {
    type: "reservation_query_raised",
    toStatus: "reservation_query_raised",
    summary: "Reservation queried.",
    metadata: { queryNote },
  });

  return { saleAttemptId: attempt.id };
}

async function failReservation(adminClient: SupabaseClient, requester: Requester, payload: ReservationPayload) {
  if (!canPerformSalesAction(requester.role, "fail_reservation")) throw new Error("Only developers can fail and redact reservations.");
  if (!payload.saleAttemptId) throw new Error("Sale attempt is required.");
  const failReason = normaliseText(payload.failReason);
  if (!failReason) throw new Error("Add a reason for the failed reservation.");

  const attempt = await loadSaleAttempt(adminClient, payload.saleAttemptId);
  await assertCanUseBuilding(adminClient, requester, attempt.building_id);
  const now = new Date().toISOString();
  const patch = buildFailedReservationRedactionPatch({ reason: failReason, redactedByUserId: requester.id, timestamp: now });

  const { data: versions, error: versionError } = await adminClient
    .from("unit_sale_document_versions")
    .select("storage_bucket,storage_path,unit_sale_documents!inner(sale_attempt_id)")
    .eq("unit_sale_documents.sale_attempt_id", attempt.id)
    .is("redacted_at", null);
  if (versionError) throw versionError;

  const pathsByBucket = new Map<string, string[]>();
  for (const version of versions ?? []) {
    const bucket = version.storage_bucket as string;
    const path = version.storage_path as string;
    pathsByBucket.set(bucket, [...(pathsByBucket.get(bucket) ?? []), path]);
  }
  for (const [bucket, paths] of pathsByBucket.entries()) {
    await adminClient.storage.from(bucket).remove(paths);
  }

  await adminClient.from("unit_sale_attempts").update(patch).eq("id", attempt.id);
  await adminClient.from("unit_sale_terms").update({
    status: "superseded",
    is_current: false,
    superseded_at: now,
    updated_by_user_id: requester.id,
    updated_at: now,
  }).eq("sale_attempt_id", attempt.id).eq("is_current", true);
  await adminClient.from("unit_sale_documents").update({
    status: "redacted",
    redacted_at: now,
    redacted_by_user_id: requester.id,
    updated_by_user_id: requester.id,
    updated_at: now,
  }).eq("sale_attempt_id", attempt.id);
  const redactedStoragePaths = Array.from(pathsByBucket.values()).flat();
  if (redactedStoragePaths.length > 0) {
    await adminClient.from("unit_sale_document_versions").update({
      is_current: false,
      redacted_at: now,
      redacted_by_user_id: requester.id,
    }).in("storage_path", redactedStoragePaths);
  }
  await adminClient.from("unit_sale_invoices").update({
    status: "redacted",
    updated_by_user_id: requester.id,
    updated_at: now,
  }).eq("sale_attempt_id", attempt.id);
  await adminClient.from("units").update({ sale_status: "for_sale" }).eq("id", attempt.unit_id);

  await insertEvent(adminClient, attempt, requester, {
    type: "reservation_failed_redacted",
    toStatus: "fallen_through",
    summary: "Reservation failed. Buyer details and active documents redacted.",
    metadata: { reason: failReason },
  });

  return { saleAttemptId: attempt.id };
}

async function saveCommercialModel(adminClient: SupabaseClient, requester: Requester, payload: ReservationPayload) {
  if (!canPerformSalesAction(requester.role, "manage_commercial_terms")) throw new Error("Only developers can save commercial terms.");
  if (!payload.unitId && !payload.saleAttemptId) throw new Error("Choose a unit before saving commercial terms.");

  let unitId = payload.unitId;
  let buildingId: string;
  const existingAttempt = payload.saleAttemptId ? await loadSaleAttempt(adminClient, payload.saleAttemptId) : null;
  if (existingAttempt) {
    unitId = existingAttempt.unit_id;
    buildingId = existingAttempt.building_id;
  } else {
    const unit = await loadUnit(adminClient, unitId as string);
    unitId = unit.id;
    buildingId = unit.building_id;
  }

  await assertCanUseBuilding(adminClient, requester, buildingId);
  const attempt = existingAttempt ?? (unitId ? await activeAttemptForUnit(adminClient, unitId) : null);
  if (attempt && !["draft", "rejected", "reservation_query_raised"].includes(attempt.workflow_status)) {
    throw new Error("This commercial package cannot be edited.");
  }

  const currentTerms = attempt ? await currentTermsForAttempt(adminClient, attempt.id) : null;
  const defaults = await loadBuildingSaleDefaults(adminClient, buildingId);
  const termsPatch = termsSnapshotFromDefaults({ defaults, currentTerms, payload, usePayloadCommercials: true });
  const scheduleRows = buildPaymentScheduleRows({
    contractPrice: termsPatch.contract_price === null || termsPatch.contract_price === undefined ? null : Number(termsPatch.contract_price),
    exchangeDepositPercent: Number(termsPatch.exchange_deposit_percent ?? 10),
    secondDepositEnabled: Boolean(termsPatch.second_deposit_enabled),
    secondDepositPercent: Number(termsPatch.second_deposit_percent ?? 0),
    secondDepositMonthsAfterExchange: normaliseInteger(termsPatch.second_deposit_months_after_exchange as string | number | null | undefined),
  });

  const { data, error } = await adminClient.rpc("save_unit_commercial_model", {
    p_unit_id: unitId,
    p_requester_id: requester.id,
    p_list_price_at_offer: termsPatch.list_price_at_offer,
    p_contract_price: termsPatch.contract_price,
    p_parking_value: termsPatch.parking_value,
    p_developer_contribution: termsPatch.developer_contribution,
    p_agent_contribution: termsPatch.agent_contribution,
    p_reservation_fee: termsPatch.reservation_fee,
    p_reservation_fee_holder: termsPatch.reservation_fee_holder,
    p_agent_fee_percent: termsPatch.agent_fee_percent,
    p_vat_rate: termsPatch.vat_rate,
    p_solicitor_fee: termsPatch.solicitor_fee,
    p_exchange_deposit_percent: termsPatch.exchange_deposit_percent,
    p_second_deposit_enabled: termsPatch.second_deposit_enabled,
    p_second_deposit_percent: termsPatch.second_deposit_percent,
    p_second_deposit_months_after_exchange: termsPatch.second_deposit_months_after_exchange,
    p_completion_balance_percent: termsPatch.completion_balance_percent,
    p_deposit_summary: termsPatch.deposit_summary,
    p_commercial_summary: termsPatch.commercial_summary,
    p_payment_schedule: scheduleRows,
    p_developer_contribution_value: termsPatch.developer_contribution_value,
    p_developer_contribution_value_type: termsPatch.developer_contribution_value_type,
    p_agent_contribution_value: termsPatch.agent_contribution_value,
    p_agent_contribution_value_type: termsPatch.agent_contribution_value_type,
    p_parking_contribution_value: termsPatch.parking_contribution_value,
    p_parking_location_details: termsPatch.parking_location_details,
    p_additional_special_conditions: termsPatch.additional_special_conditions,
  });
  if (error) throw error;

  const result = Array.isArray(data) ? data[0] : data;
  return { saleAttemptId: result?.sale_attempt_id ?? attempt?.id };
}

async function approveCommercialPackage(adminClient: SupabaseClient, requester: Requester, payload: ReservationPayload) {
  if (!canPerformSalesAction(requester.role, "approve_commercial_package")) throw new Error("Only developers can approve the commercial package.");
  if (!payload.saleAttemptId) throw new Error("Sale attempt is required.");

  const attempt = await loadSaleAttempt(adminClient, payload.saleAttemptId);
  await assertCanUseBuilding(adminClient, requester, attempt.building_id);
  if (!["approved", "reservation_approved", "awaiting_commercial_approval", "ready_for_exchange"].includes(attempt.workflow_status)) {
    throw new Error("Approve the reservation before commercial approval.");
  }

  const currentTerms = await currentTermsForAttempt(adminClient, attempt.id);
  if (!currentTerms?.contract_price) throw new Error("Contract price is required before commercial approval.");

  const { data: invoice, error: invoiceError } = await adminClient
    .from("unit_sale_invoices")
    .select("id,document_id,status")
    .eq("sale_attempt_id", attempt.id)
    .eq("invoice_type", "sales_agent")
    .maybeSingle();
  if (invoiceError) throw invoiceError;
  if (!invoice?.document_id) throw new Error("Upload the sales agent invoice before commercial approval.");

  const { data: invoiceVersion, error: invoiceVersionError } = await adminClient
    .from("unit_sale_document_versions")
    .select("id")
    .eq("document_id", invoice.document_id)
    .eq("is_current", true)
    .is("redacted_at", null)
    .maybeSingle();
  if (invoiceVersionError) throw invoiceVersionError;
  if (!invoiceVersion) throw new Error("Upload the sales agent invoice before commercial approval.");

  const now = new Date().toISOString();
  const { data: updatedAttempt, error: attemptError } = await adminClient.from("unit_sale_attempts").update({
    workflow_status: "ready_for_exchange",
    commercial_approved_at: now,
    commercial_approved_by_user_id: requester.id,
    updated_by_user_id: requester.id,
    updated_at: now,
  }).eq("id", attempt.id).select("*").single();
  if (attemptError) throw attemptError;

  await adminClient.from("unit_sale_terms").update({
    status: "approved",
    approved_by_user_id: requester.id,
    approved_at: now,
    updated_by_user_id: requester.id,
    updated_at: now,
  }).eq("id", currentTerms.id);

  await adminClient.from("unit_sale_documents").update({
    status: "approved",
    approved_by_user_id: requester.id,
    approved_at: now,
    updated_by_user_id: requester.id,
    updated_at: now,
  }).eq("id", invoice.document_id);

  await adminClient.from("unit_sale_invoices").update({
    status: "approved",
    approved_by_user_id: requester.id,
    approved_at: now,
    updated_by_user_id: requester.id,
    updated_at: now,
  }).eq("id", invoice.id);

  await insertEvent(adminClient, attempt, requester, {
    type: "commercial_package_approved",
    toStatus: "ready_for_exchange",
    summary: "Commercial package approved. Sale is Ready for Exchange.",
  });

  return { saleAttemptId: updatedAttempt.id };
}

async function recordExchange(adminClient: SupabaseClient, requester: Requester, payload: ReservationPayload) {
  if (!canPerformSalesAction(requester.role, "record_exchange")) throw new Error("Only developers or conveyancers can record exchange.");
  if (!payload.saleAttemptId) throw new Error("Sale attempt is required.");

  const exchangeDate = normaliseDate(payload.exchangeDate);
  if (!exchangeDate) throw new Error("Enter a valid exchange date.");
  const today = new Date().toISOString().slice(0, 10);
  if (exchangeDate > today) throw new Error("Exchange date cannot be in the future.");

  const attempt = await loadSaleAttempt(adminClient, payload.saleAttemptId);
  await assertCanUseBuilding(adminClient, requester, attempt.building_id);
  if (!["ready_for_exchange", "exchanged"].includes(attempt.workflow_status)) {
    throw new Error("Commercial approval is required before recording exchange.");
  }

  const now = new Date().toISOString();
  const { data: updatedAttempt, error: attemptError } = await adminClient.from("unit_sale_attempts").update({
    workflow_status: "exchanged",
    exchanged_at: exchangeDate,
    stage_entered_at: now,
    updated_by_user_id: requester.id,
    updated_at: now,
  }).eq("id", attempt.id).select("*").single();
  if (attemptError) throw attemptError;

  const { error: unitError } = await adminClient.from("units").update({ sale_status: "exchanged" }).eq("id", attempt.unit_id);
  if (unitError) throw unitError;

  await insertEvent(adminClient, attempt, requester, {
    type: "exchange_recorded",
    toStatus: "exchanged",
    summary: "Exchange recorded. Unit marked Exchanged.",
    metadata: { exchangeDate },
  });

  return { saleAttemptId: updatedAttempt.id };
}

async function upsertInvoicePayment(
  adminClient: SupabaseClient,
  input: {
    invoiceId: string;
    saleAttemptId: string;
    paymentSource: "solicitor_deposit" | "developer_shortfall";
    amount: number | null;
    paidAt: string | null;
    requester: Requester;
    notes: string | null;
  },
) {
  const { data: existing, error: existingError } = await adminClient
    .from("unit_sale_invoice_payments")
    .select("id")
    .eq("invoice_id", input.invoiceId)
    .eq("payment_source", input.paymentSource)
    .maybeSingle();
  if (existingError) throw existingError;

  if (input.amount === null) return;

  const paymentPayload = {
    amount: input.amount,
    paid_at: input.paidAt,
    recorded_by_user_id: input.requester.id,
    notes: input.notes,
  };

  if (existing?.id) {
    const { error } = await adminClient.from("unit_sale_invoice_payments").update(paymentPayload).eq("id", existing.id);
    if (error) throw error;
    return;
  }

  const { error } = await adminClient.from("unit_sale_invoice_payments").insert({
    invoice_id: input.invoiceId,
    sale_attempt_id: input.saleAttemptId,
    payment_source: input.paymentSource,
    ...paymentPayload,
  });
  if (error) throw error;
}

async function recordInvoiceReconciliation(adminClient: SupabaseClient, requester: Requester, payload: ReservationPayload) {
  if (!payload.saleAttemptId) throw new Error("Sale attempt is required.");

  const solicitorPaymentAmount = normaliseMoney(payload.solicitorPaymentAmount);
  const solicitorPaymentDate = normaliseDate(payload.solicitorPaymentDate);
  const developerShortfallAmount = normaliseMoney(payload.developerShortfallAmount);
  const developerShortfallDate = normaliseDate(payload.developerShortfallDate);
  const notes = normaliseText(payload.reconciliationNotes);

  if (solicitorPaymentAmount !== null && !canPerformSalesAction(requester.role, "record_solicitor_payment")) {
    throw new Error("Only developers or conveyancers can record solicitor invoice payments.");
  }
  if (developerShortfallAmount !== null && !canPerformSalesAction(requester.role, "record_developer_shortfall")) {
    throw new Error("Only developers can record developer shortfall payments.");
  }
  if (solicitorPaymentAmount === null && developerShortfallAmount === null) {
    throw new Error("Enter a solicitor payment or developer shortfall payment before saving reconciliation.");
  }
  if (solicitorPaymentAmount !== null && !solicitorPaymentDate) throw new Error("Enter a valid solicitor payment date.");
  if (developerShortfallAmount !== null && !developerShortfallDate) throw new Error("Enter a valid developer shortfall payment date.");

  const today = new Date().toISOString().slice(0, 10);
  if (solicitorPaymentDate && solicitorPaymentDate > today) throw new Error("Solicitor payment date cannot be in the future.");
  if (developerShortfallDate && developerShortfallDate > today) throw new Error("Developer shortfall payment date cannot be in the future.");

  const attempt = await loadSaleAttempt(adminClient, payload.saleAttemptId);
  await assertCanUseBuilding(adminClient, requester, attempt.building_id);
  if (!["exchanged", "completion_pending", "completed"].includes(attempt.workflow_status)) {
    throw new Error("Exchange must be recorded before invoice reconciliation.");
  }

  const { data: invoice, error: invoiceError } = await adminClient
    .from("unit_sale_invoices")
    .select("*")
    .eq("sale_attempt_id", attempt.id)
    .eq("invoice_type", "sales_agent")
    .maybeSingle();
  if (invoiceError) throw invoiceError;
  if (!invoice) throw new Error("Sales agent invoice is required before reconciliation.");

  await upsertInvoicePayment(adminClient, {
    invoiceId: invoice.id,
    saleAttemptId: attempt.id,
    paymentSource: "solicitor_deposit",
    amount: solicitorPaymentAmount,
    paidAt: solicitorPaymentDate,
    requester,
    notes,
  });
  await upsertInvoicePayment(adminClient, {
    invoiceId: invoice.id,
    saleAttemptId: attempt.id,
    paymentSource: "developer_shortfall",
    amount: developerShortfallAmount,
    paidAt: developerShortfallDate,
    requester,
    notes,
  });

  const { data: paymentRows, error: paymentsError } = await adminClient
    .from("unit_sale_invoice_payments")
    .select("amount,payment_source")
    .eq("invoice_id", invoice.id);
  if (paymentsError) throw paymentsError;

  const paidAgainstInvoice = (paymentRows ?? []).reduce((total, row) => total + Number(row.amount ?? 0), 0);
  const expectedPayable = Number(invoice.expected_payable_amount ?? invoice.gross_amount ?? 0);
  const reservationFeeDeduction = Number(invoice.reservation_fee_deduction ?? 0);
  const totalReceivedByAgent = paidAgainstInvoice + reservationFeeDeduction;
  const outstandingDeveloperBalance = Math.max(0, expectedPayable - paidAgainstInvoice);
  const status = outstandingDeveloperBalance <= 0 ? "reconciled" : paidAgainstInvoice > 0 ? "part_paid" : invoice.status;

  const now = new Date().toISOString();
  const { error: invoiceUpdateError } = await adminClient.from("unit_sale_invoices").update({
    status,
    updated_by_user_id: requester.id,
    updated_at: now,
  }).eq("id", invoice.id);
  if (invoiceUpdateError) throw invoiceUpdateError;

  await insertEvent(adminClient, attempt, requester, {
    type: status === "reconciled" ? "invoice_reconciled" : "invoice_payment_recorded",
    toStatus: attempt.workflow_status,
    summary: status === "reconciled" ? "Sales agent invoice reconciled." : "Sales agent invoice payment recorded.",
    metadata: {
      paidAgainstInvoice,
      reservationFeeDeduction,
      totalReceivedByAgent,
      outstandingDeveloperBalance,
      status,
    },
  });

  return { saleAttemptId: attempt.id };
}

async function loadCompletionDocuments(adminClient: SupabaseClient, saleAttemptId: string) {
  const { data, error } = await adminClient
    .from("unit_sale_documents")
    .select("id,document_type,status")
    .eq("sale_attempt_id", saleAttemptId)
    .in("document_type", ["completion_statement", "statement_of_account"])
    .is("redacted_at", null);
  if (error) throw error;
  return data ?? [];
}

async function currentDocumentVersionExists(adminClient: SupabaseClient, documentId: string) {
  const { data, error } = await adminClient
    .from("unit_sale_document_versions")
    .select("id")
    .eq("document_id", documentId)
    .eq("is_current", true)
    .is("redacted_at", null)
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

async function approveCompletionDocuments(adminClient: SupabaseClient, requester: Requester, payload: ReservationPayload) {
  if (!canPerformSalesAction(requester.role, "approve_completion_documents")) throw new Error("Only developers can approve completion documents.");
  if (!payload.saleAttemptId) throw new Error("Sale attempt is required.");

  const attempt = await loadSaleAttempt(adminClient, payload.saleAttemptId);
  await assertCanUseBuilding(adminClient, requester, attempt.building_id);
  if (!["exchanged", "completion_pending", "completed"].includes(attempt.workflow_status)) {
    throw new Error("Exchange must be recorded before completion documents can be approved.");
  }

  const completionDocuments = await loadCompletionDocuments(adminClient, attempt.id);
  const completionStatement = completionDocuments.find((document) => document.document_type === "completion_statement");
  const statementOfAccount = completionDocuments.find((document) => document.document_type === "statement_of_account");
  if (!completionStatement || !(await currentDocumentVersionExists(adminClient, completionStatement.id))) {
    throw new Error("Upload the completion statement before approval.");
  }
  if (!statementOfAccount || !(await currentDocumentVersionExists(adminClient, statementOfAccount.id))) {
    throw new Error("Upload the statement of account before approval.");
  }

  const now = new Date().toISOString();
  const documentIds = [completionStatement.id, statementOfAccount.id];
  const { error: documentError } = await adminClient.from("unit_sale_documents").update({
    status: "approved",
    query_note: null,
    approved_by_user_id: requester.id,
    approved_at: now,
    updated_by_user_id: requester.id,
    updated_at: now,
  }).in("id", documentIds);
  if (documentError) throw documentError;

  const { error: attemptError } = await adminClient.from("unit_sale_attempts").update({
    workflow_status: attempt.workflow_status === "completed" ? "completed" : "completion_pending",
    updated_by_user_id: requester.id,
    updated_at: now,
  }).eq("id", attempt.id);
  if (attemptError) throw attemptError;

  await insertEvent(adminClient, attempt, requester, {
    type: "completion_documents_approved",
    toStatus: attempt.workflow_status === "completed" ? "completed" : "completion_pending",
    summary: "Completion statement and statement of account approved.",
  });

  return { saleAttemptId: attempt.id };
}

async function queryCompletionDocuments(adminClient: SupabaseClient, requester: Requester, payload: ReservationPayload) {
  if (!canPerformSalesAction(requester.role, "approve_completion_documents")) throw new Error("Only developers can query completion documents.");
  if (!payload.saleAttemptId) throw new Error("Sale attempt is required.");
  const queryNote = normaliseText(payload.completionQueryNote);
  if (!queryNote) throw new Error("Add a completion document query note.");

  const attempt = await loadSaleAttempt(adminClient, payload.saleAttemptId);
  await assertCanUseBuilding(adminClient, requester, attempt.building_id);
  if (!["exchanged", "completion_pending", "completed"].includes(attempt.workflow_status)) {
    throw new Error("Exchange must be recorded before completion documents can be queried.");
  }

  const completionDocuments = await loadCompletionDocuments(adminClient, attempt.id);
  if (completionDocuments.length === 0) throw new Error("Upload completion documents before raising a query.");

  const now = new Date().toISOString();
  const { error: documentError } = await adminClient.from("unit_sale_documents").update({
    status: "query_raised",
    query_note: queryNote,
    updated_by_user_id: requester.id,
    updated_at: now,
  }).in("id", completionDocuments.map((document) => document.id));
  if (documentError) throw documentError;

  await adminClient.from("unit_sale_notes").insert({
    sale_attempt_id: attempt.id,
    building_id: attempt.building_id,
    unit_id: attempt.unit_id,
    category: "solicitor_update",
    visibility: "shared_sale_file",
    body: queryNote,
    created_by_user_id: requester.id,
  });

  await insertEvent(adminClient, attempt, requester, {
    type: "completion_documents_query_raised",
    toStatus: attempt.workflow_status,
    summary: "Completion document query raised.",
    metadata: { queryNote },
  });

  return { saleAttemptId: attempt.id };
}

async function recordCompletion(adminClient: SupabaseClient, requester: Requester, payload: ReservationPayload) {
  if (!canPerformSalesAction(requester.role, "record_completion")) throw new Error("Only developers or conveyancers can record completion.");
  if (!payload.saleAttemptId) throw new Error("Sale attempt is required.");

  const completionDate = normaliseDate(payload.completionDate);
  if (!completionDate) throw new Error("Enter a valid completion date.");
  const today = new Date().toISOString().slice(0, 10);
  if (completionDate > today) throw new Error("Completion date cannot be in the future.");

  const attempt = await loadSaleAttempt(adminClient, payload.saleAttemptId);
  await assertCanUseBuilding(adminClient, requester, attempt.building_id);
  if (!["completion_pending", "completed"].includes(attempt.workflow_status)) {
    throw new Error("Completion documents must be approved before recording completion.");
  }

  const now = new Date().toISOString();
  const { data: updatedAttempt, error: attemptError } = await adminClient.from("unit_sale_attempts").update({
    workflow_status: "completed",
    completed_at: completionDate,
    stage_entered_at: now,
    updated_by_user_id: requester.id,
    updated_at: now,
  }).eq("id", attempt.id).select("*").single();
  if (attemptError) throw attemptError;

  const { error: unitError } = await adminClient.from("units").update({ sale_status: "completed" }).eq("id", attempt.unit_id);
  if (unitError) throw unitError;

  await insertEvent(adminClient, attempt, requester, {
    type: "completion_recorded",
    toStatus: "completed",
    summary: "Completion recorded. Unit marked Completed.",
    metadata: { completionDate },
  });

  return { saleAttemptId: updatedAttempt.id };
}

async function signedDocumentVersionUrl(adminClient: SupabaseClient, requester: Requester, versionId: string | null) {
  if (!versionId) throw new Error("Document version is required.");

  const { data: version, error: versionError } = await adminClient
    .from("unit_sale_document_versions")
    .select("id,document_id,storage_bucket,storage_path,file_name,redacted_at")
    .eq("id", versionId)
    .maybeSingle();
  if (versionError) throw versionError;
  if (!version || version.redacted_at) throw new Error("Document version not found.");

  const { data: document, error: documentError } = await adminClient
    .from("unit_sale_documents")
    .select("id,sale_attempt_id,redacted_at")
    .eq("id", version.document_id)
    .maybeSingle();
  if (documentError) throw documentError;
  if (!document || document.redacted_at) throw new Error("Document not found.");

  const attempt = await loadSaleAttempt(adminClient, document.sale_attempt_id as string);
  await assertCanUseBuilding(adminClient, requester, attempt.building_id);

  const { data: signed, error: signedError } = await adminClient.storage
    .from(version.storage_bucket as string)
    .createSignedUrl(version.storage_path as string, 60);
  if (signedError) throw signedError;

  return { signedUrl: signed.signedUrl, fileName: version.file_name };
}

export async function GET(request: Request) {
  try {
    requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
    const adminClient = createSupabaseServiceRoleClient();
    const { requester, response } = await getRequester(request, adminClient);
    if (response || !requester) return response;

    const url = new URL(request.url);
    return NextResponse.json(await signedDocumentVersionUrl(adminClient, requester, url.searchParams.get("versionId")));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Document link could not be created." }, { status: 400 });
  }
}

export async function POST(request: Request) {
  let action = "save_reservation";
  try {
    requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
    const adminClient = createSupabaseServiceRoleClient();
    const { requester, response } = await getRequester(request, adminClient);
    if (response || !requester) return response;

    const contentType = request.headers.get("content-type") ?? "";
    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const action = formData.get("action")?.toString();
      const result = action === "upload_agent_invoice"
        ? await uploadAgentInvoice(adminClient, requester, formData)
        : action === "upload_completion_document"
          ? await uploadCompletionDocument(adminClient, requester, formData)
          : await uploadReservationForm(adminClient, requester, formData);
      return NextResponse.json(result);
    }

    const payload = (await request.json()) as ReservationPayload;
    action = payload.action ?? "save_reservation";
    if (action === "save_reservation") return NextResponse.json(await saveReservation(adminClient, requester, payload));
    if (action === "approve_reservation") return NextResponse.json(await approveReservation(adminClient, requester, payload));
    if (action === "reject_reservation") return NextResponse.json(await rejectReservation(adminClient, requester, payload));
    if (action === "query_reservation") return NextResponse.json(await queryReservation(adminClient, requester, payload));
    if (action === "fail_reservation") return NextResponse.json(await failReservation(adminClient, requester, payload));
    if (action === "save_commercial_model" || action === "save_commercial_package") return NextResponse.json(await saveCommercialModel(adminClient, requester, payload));
    if (action === "approve_commercial_package") return NextResponse.json(await approveCommercialPackage(adminClient, requester, payload));
    if (action === "record_exchange") return NextResponse.json(await recordExchange(adminClient, requester, payload));
    if (action === "record_invoice_reconciliation") return NextResponse.json(await recordInvoiceReconciliation(adminClient, requester, payload));
    if (action === "approve_completion_documents") return NextResponse.json(await approveCompletionDocuments(adminClient, requester, payload));
    if (action === "query_completion_documents") return NextResponse.json(await queryCompletionDocuments(adminClient, requester, payload));
    if (action === "record_completion") return NextResponse.json(await recordCompletion(adminClient, requester, payload));

    return NextResponse.json({ error: "Unsupported reservation action." }, { status: 400 });
  } catch (error) {
    const fallback = action === "save_commercial_model" || action === "save_commercial_package"
      ? "Commercial model could not be saved."
      : action === "save_reservation" || action === "approve_reservation" || action === "reject_reservation" || action === "query_reservation" || action === "fail_reservation"
        ? "Reservation could not be completed."
        : "Sales action could not be completed.";
    return NextResponse.json({ error: error instanceof Error ? error.message : fallback }, { status: 400 });
  }
}
