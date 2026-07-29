export type DepositStructureInput = {
  exchangeDepositPercent?: number | null;
  secondDepositEnabled?: boolean | null;
  secondDepositPercent?: number | null;
  secondDepositMonthsAfterExchange?: number | null;
};

export type DepositStructure = {
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
  return Math.max(0, Math.min(100, Number(value)));
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
  const secondDepositMonthsAfterExchange = secondDepositEnabled
    ? Math.max(0, Math.floor(Number(input.secondDepositMonthsAfterExchange ?? 0)))
    : null;
  const completionBalancePercent = Math.round((100 - exchangeDepositPercent - secondDepositPercent) * 10_000) / 10_000;
  const totalPercent = Math.round((exchangeDepositPercent + secondDepositPercent + completionBalancePercent) * 10_000) / 10_000;

  let error: string | null = null;
  if (completionBalancePercent < 0) {
    error = "Deposit percentages exceed 100%. Reduce the exchange or second deposit.";
  } else if (exchangeDepositPercent <= 0) {
    error = "Exchange deposit must be greater than 0%.";
  } else if (secondDepositEnabled && secondDepositPercent <= 0) {
    error = "Enter a second deposit percentage, or turn the second deposit off.";
  }

  return {
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
      ? `${structure.secondDepositPercent}% ${structure.secondDepositMonthsAfterExchange ?? 0} months after exchange`
      : null,
    `${structure.completionBalancePercent}% on completion`,
  ].filter(Boolean);

  return rows.join(", ");
}

export function buildPaymentScheduleRows(input: DepositStructureInput & { contractPrice?: number | null }): PaymentScheduleDraftRow[] {
  const structure = buildDepositStructure(input);
  const contractPrice = input.contractPrice ?? null;
  const rows: PaymentScheduleDraftRow[] = [
    {
      sequenceNo: 1,
      paymentStage: "exchange",
      label: `${structure.exchangeDepositPercent}% exchange deposit`,
      dueEvent: "exchange",
      dueOffsetDays: 0,
      percentOfContractPrice: structure.exchangeDepositPercent,
      includesReservationFee: true,
      expectedAmount: contractPrice === null ? null : contractPrice * (structure.exchangeDepositPercent / 100),
    },
  ];

  if (structure.secondDepositEnabled) {
    rows.push({
      sequenceNo: rows.length + 1,
      paymentStage: "delayed_deposit",
      label: `${structure.secondDepositPercent}% second deposit`,
      dueEvent: "manual_date",
      dueOffsetDays: (structure.secondDepositMonthsAfterExchange ?? 0) * 31,
      percentOfContractPrice: structure.secondDepositPercent,
      includesReservationFee: false,
      expectedAmount: contractPrice === null ? null : contractPrice * (structure.secondDepositPercent / 100),
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
    expectedAmount: contractPrice === null ? null : contractPrice * (structure.completionBalancePercent / 100),
  });

  return rows;
}
