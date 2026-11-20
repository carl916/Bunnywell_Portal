import {timingError,type FurtherDepositTiming} from "./further-deposit";
import {buildDepositStructure,paymentScheduleSummary} from "./deal-structure";
import {parseGbpInput} from "./currency";
import {parsePercentInput} from "./percentages";
import {validateAgentFeeStructure} from "./agent-fees";
export type ReservationPayload = {
  action?:
    | "save_reservation"
    | "save_reservation_draft"
    | "approve_reservation"
    | "reject_reservation"
    | "query_reservation"
    | "fail_reservation"
    | "return_unit_for_sale"
    | "save_setup_unit_price"
    | "save_commercial_model"
    | "save_commercial_package"
    | "approve_commercial_package"
    | "approve_agent_invoice"
    | "reject_agent_invoice"
    | "record_exchange"
    | "record_agent_fee_payment"
    | "void_agent_fee_payment"
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
  returnReason?: string | null;
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
  exchangeAgentFeePercent?: string | number | null;
  completionAgentFeePercent?: string | number | null;
  solicitorFee?: string | number | null;
  exchangeDepositPercent?: string | number | null;
  furtherDepositTiming?: FurtherDepositTiming | null;
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
  invoiceMilestone?: "exchange" | "completion" | null;
  exchangeDate?: string | null;
  exchangeDepositConfirmed?: boolean | null;
  invoiceId?: string | null;
  paymentAmount?: string | number | null;
  paymentDate?: string | null;
  paymentClientReference?: string | null;
  paymentId?: string | null;
  paymentVoidReason?: string | null;
  completionDocumentType?: "completion_statement" | "statement_of_account";
  completionQueryNote?: string | null;
  completionDate?: string | null;
  reservationFormPath?: string | null;
  rejectionReason?: string | null;
  invoiceRejectionReason?: string | null;
  queryNote?: string | null;
  failReason?: string | null;
};

function normaliseText(value?: string | null) {
  const trimmed = value?.trim() ?? "";
  return trimmed || null;
}

function normaliseMoney(value?: string | number | null) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "string" && value.includes("-")) return null;
  const numeric = parseGbpInput(value);
  return numeric !== null && Number.isFinite(numeric) && numeric >= 0 ? numeric : null;
}

function normalisePercent(value?: string | number | null) {
  return parsePercentInput(value);
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
  const payloadSecondDepositEnabled = usePayloadCommercials && hasPayloadValue("secondDepositEnabled") ? Boolean(payload?.secondDepositEnabled) : null;

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
    ?? (currentTerms ? currentTerms.second_deposit_months_after_exchange : defaults?.second_deposit_months_after_exchange);
  const secondDepositMonthsAfterExchange = normaliseInteger(secondDepositMonthsSource as string | number | null | undefined);
  const furtherDepositTiming = (usePayloadCommercials && hasPayloadValue("furtherDepositTiming") ? payload?.furtherDepositTiming : currentTerms ? currentTerms.further_deposit_timing : defaults?.further_deposit_timing) as FurtherDepositTiming | null;
  if (usePayloadCommercials) {
    for (const key of ["exchangeDepositPercent", "secondDepositPercent"] as const) {
      if (hasPayloadValue(key) && (key === "exchangeDepositPercent" || secondDepositEnabled) && normalisePercent(payload?.[key]) == null) throw new Error("Enter deposit percentages between 0% and 100%.");
    }
    if (secondDepositEnabled && (furtherDepositTiming?.basis ?? "after_exchange") === "after_exchange" && hasPayloadValue("secondDepositMonthsAfterExchange")
      && (payload?.secondDepositMonthsAfterExchange == null || String(payload.secondDepositMonthsAfterExchange).trim() === "" || !Number.isInteger(Number(payload.secondDepositMonthsAfterExchange)) || Number(payload.secondDepositMonthsAfterExchange) < 0)) throw new Error("Enter a whole number of calendar months; leave incomplete legacy terms for confirmation.");
  }
  if (usePayloadCommercials && hasPayloadValue("furtherDepositTiming") && secondDepositEnabled && furtherDepositTiming?.basis === "fixed" && timingError(furtherDepositTiming, null, true)) throw new Error(timingError(furtherDepositTiming, null, true)!);
  const depositStructure = buildDepositStructure({
    furtherDepositTiming,
    exchangeDepositPercent,
    secondDepositEnabled,
    secondDepositPercent,
    secondDepositMonthsAfterExchange,
  });

  if (!depositStructure.isValid) throw new Error(depositStructure.error ?? "Payment schedule is invalid.");
  for (const key of ["agentFeePercent", "exchangeAgentFeePercent", "completionAgentFeePercent"] as const) {
    if (usePayloadCommercials && hasPayloadValue(key) && payload?.[key] !== null && payload?.[key] !== undefined && payload[key]?.toString().trim() !== "" && normalisePercent(payload[key]) === null) {
      throw new Error("Agent fee percentages must be numbers between 0% and 100%.");
    }
  }
  const totalAgentFeePercent = usePayloadCommercials && hasPayloadValue("agentFeePercent")
    ? normalisePercent(payload?.agentFeePercent) ?? Number(currentTerms?.agent_fee_percent ?? defaults?.default_agent_fee_percent ?? 0)
    : Number(currentTerms?.agent_fee_percent ?? defaults?.default_agent_fee_percent ?? 0);
  const exchangeAgentFeePercent = usePayloadCommercials && hasPayloadValue("exchangeAgentFeePercent")
    ? normalisePercent(payload?.exchangeAgentFeePercent) ?? Number(currentTerms?.exchange_agent_fee_percent ?? defaults?.default_exchange_agent_fee_percent ?? totalAgentFeePercent ?? 0)
    : Number(currentTerms?.exchange_agent_fee_percent ?? defaults?.default_exchange_agent_fee_percent ?? totalAgentFeePercent ?? 0);
  const completionAgentFeePercent = usePayloadCommercials && hasPayloadValue("completionAgentFeePercent")
    ? normalisePercent(payload?.completionAgentFeePercent) ?? Number(currentTerms?.completion_agent_fee_percent ?? defaults?.default_completion_agent_fee_percent ?? 0)
    : Number(currentTerms?.completion_agent_fee_percent ?? defaults?.default_completion_agent_fee_percent ?? 0);
  const feeStructure = validateAgentFeeStructure({
    totalFeePercent: totalAgentFeePercent,
    exchangeFeePercent: exchangeAgentFeePercent,
    completionFeePercent: completionAgentFeePercent,
  });
  if (!feeStructure.isValid) throw new Error(feeStructure.error ?? "Agent fee structure is invalid.");

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
    agent_fee_percent: totalAgentFeePercent,
    exchange_agent_fee_percent: exchangeAgentFeePercent,
    completion_agent_fee_percent: completionAgentFeePercent,
    vat_rate: Number(currentTerms?.vat_rate ?? defaults?.default_vat_rate ?? 20),
    solicitor_fee: usePayloadCommercials
      ? hasPayloadValue("solicitorFee") ? normaliseMoney(payload?.solicitorFee) : Number(currentTerms?.solicitor_fee ?? defaults?.default_sales_solicitor_fee ?? 882)
      : Number(currentTerms?.solicitor_fee ?? defaults?.default_sales_solicitor_fee ?? 882),
    exchange_deposit_percent: depositStructure.exchangeDepositPercent,
    further_deposit_timing: depositStructure.furtherDepositTiming,
    second_deposit_enabled: depositStructure.secondDepositEnabled,
    second_deposit_percent: depositStructure.secondDepositEnabled ? depositStructure.secondDepositPercent : null,
    second_deposit_months_after_exchange: depositStructure.secondDepositEnabled ? depositStructure.secondDepositMonthsAfterExchange : null,
    completion_balance_percent: depositStructure.completionBalancePercent,
    deposit_summary: paymentScheduleSummary(depositStructure),
    commercial_summary: usePayloadCommercials ? normaliseText(payload?.commercialSummary) : currentTerms?.commercial_summary ?? null,
  };
}


export {normaliseText,normaliseMoney,normalisePercent,normaliseInteger,normaliseDate,isFutureDate,reservationDateTimestamp,hasRequiredBuyerInfo,normaliseContributionType,normaliseTextArray,calculateContributionAmount,termsSnapshotFromDefaults};
