import { timingDescription, timingError, type FurtherDepositTiming } from "./further-deposit.ts";
export type DepositStructureInput = {
  furtherDepositTiming?: FurtherDepositTiming | null;
  exchangeDepositPercent?: number | null;
  secondDepositEnabled?: boolean | null;
  secondDepositPercent?: number | null;
  secondDepositMonthsAfterExchange?: number | null;
};

export type DepositStructure = {
  furtherDepositTiming: FurtherDepositTiming | null;
  exchangeDepositPercent: number;
  secondDepositEnabled: boolean;
  secondDepositPercent: number;
  secondDepositMonthsAfterExchange: number | null;
  completionBalancePercent: number;
  totalPercent: number;
  isValid: boolean;
  error: string | null;
};

export type PaymentScheduleDraftRow = {
  sequenceNo: number;
  paymentStage: "exchange" | "delayed_deposit" | "completion";
  label: string;
  dueEvent: "exchange" | "completion" | "manual_date";
  dueOffsetDays: number | null;
  percentOfContractPrice: number;
  includesReservationFee: boolean;
  expectedAmount: number | null;
};

function boundedPercent(value?: number | null) {
  if (value === null || value === undefined || Number.isNaN(value)) return 0;
  return Number(value);
}

export function describeReservationFeeHolder(holder?: string | null) {
  const labels: Record<string, string> = {
    sales_agent: "Sales agent",
    developer: "Developer",
    conveyancer: "Conveyancer",
    other: "Other",
  };
  return labels[holder ?? ""] ?? "-";
}

export function buildDepositStructure(input: DepositStructureInput): DepositStructure {
  const exchangeDepositPercent = boundedPercent(input.exchangeDepositPercent ?? 10);
  const secondDepositEnabled = Boolean(input.secondDepositEnabled);
  const secondDepositPercent = secondDepositEnabled ? boundedPercent(input.secondDepositPercent ?? 0) : 0;
  const secondDepositMonthsAfterExchange = secondDepositEnabled ? input.secondDepositMonthsAfterExchange ?? null : null;
  const furtherDepositTiming = secondDepositEnabled ? input.furtherDepositTiming ?? null : null;
  const completionBalancePercent = Math.round((100 - exchangeDepositPercent - secondDepositPercent) * 10_000) / 10_000;
  const totalPercent = Math.round((exchangeDepositPercent + secondDepositPercent + completionBalancePercent) * 10_000) / 10_000;

  let error: string | null = null;
  if (completionBalancePercent < 0) {
    error = "Deposit percentages exceed 100%. Reduce the exchange or further deposit.";
  } else if (exchangeDepositPercent <= 0) {
    error = "Exchange deposit must be greater than 0%.";
  } else if (secondDepositEnabled && secondDepositPercent <= 0) {
    error = "Enter a further deposit percentage, or turn the further deposit off.";
  }
  if (![exchangeDepositPercent, secondDepositPercent].every(value => Number.isFinite(value) && value >= 0 && value <= 100)) error = "Deposit percentages must be between 0% and 100%.";
  if (!error && secondDepositEnabled && (furtherDepositTiming || secondDepositMonthsAfterExchange != null)) error = timingError(furtherDepositTiming, secondDepositMonthsAfterExchange);

  return {
    furtherDepositTiming,
    exchangeDepositPercent,
    secondDepositEnabled,
    secondDepositPercent,
    secondDepositMonthsAfterExchange,
    completionBalancePercent,
    totalPercent,
    isValid: !error,
    error,
  };
}

export function paymentScheduleSummary(input: DepositStructureInput) {
  const structure = buildDepositStructure(input);
  const rows = [
    `${structure.exchangeDepositPercent}% on exchange`,
    structure.secondDepositEnabled
      ? `${structure.secondDepositPercent}% further deposit: ${timingDescription(structure.furtherDepositTiming, structure.secondDepositMonthsAfterExchange)}`
      : null,
    `${structure.completionBalancePercent}% on completion`,
  ].filter(Boolean);

  return rows.join(", ");
}

export function buildPaymentScheduleRows(input: DepositStructureInput & { contractPrice?: number | null }): PaymentScheduleDraftRow[] {
  const structure = buildDepositStructure(input);
  const contractPrice = input.contractPrice ?? null;
  const amount = (percent: number) => contractPrice === null ? null : Math.round(Math.round(contractPrice * 100) * Math.round(percent * 10_000) / 1_000_000) / 100;
  const rows: PaymentScheduleDraftRow[] = [
    {
      sequenceNo: 1,
      paymentStage: "exchange",
      label: `${structure.exchangeDepositPercent}% exchange deposit`,
      dueEvent: "exchange",
      dueOffsetDays: 0,
      percentOfContractPrice: structure.exchangeDepositPercent,
      includesReservationFee: true,
      expectedAmount: amount(structure.exchangeDepositPercent),
    },
  ];

  if (structure.secondDepositEnabled) {
    rows.push({
      sequenceNo: rows.length + 1,
      paymentStage: "delayed_deposit",
      label: `${structure.secondDepositPercent}% further deposit`,
      dueEvent: "manual_date",
      dueOffsetDays: null, // Calendar-month rules live in retained terms, never an approximation in days.
      percentOfContractPrice: structure.secondDepositPercent,
      includesReservationFee: false,
      expectedAmount: amount(structure.secondDepositPercent),
    });
  }

  rows.push({
    sequenceNo: rows.length + 1,
    paymentStage: "completion",
    label: `${structure.completionBalancePercent}% balance on completion`,
    dueEvent: "completion",
    dueOffsetDays: 0,
    percentOfContractPrice: structure.completionBalancePercent,
    includesReservationFee: false,
    expectedAmount: amount(structure.completionBalancePercent),
  });

  return rows;
}
