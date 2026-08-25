export type AgentInvoicePreviewInput = {
  contractPrice?: number | null;
  agentFeePercent?: number | null;
  vatRate?: number | null;
  reservationFee?: number | null;
  reservationFeeHolder?: string | null;
  agentContribution?: number | null;
};

export type DeveloperNetInput = {
  contractPrice?: number | null;
  parkingValue?: number | null;
  developerContribution?: number | null;
  solicitorFee?: number | null;
  agentFeePercent?: number | null;
};

function numeric(value?: number | null) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function toPence(value?: number | null) {
  return Math.round(numeric(value) * 100);
}

function fromPence(value: number) {
  return value / 100;
}

function milestoneFee(input: Pick<AgentInvoicePreviewInput, "contractPrice" | "agentFeePercent" | "vatRate">) {
  const pricePence = toPence(input.contractPrice);
  const feeUnits = Math.round(numeric(input.agentFeePercent) * 10_000);
  const vatUnits = Math.round(numeric(input.vatRate ?? 20) * 10_000);
  const netPence = Math.round((pricePence * feeUnits) / 1_000_000);
  const vatPence = Math.round((netPence * vatUnits) / 1_000_000);
  return { netAmount: fromPence(netPence), vatAmount: fromPence(vatPence), grossAmount: fromPence(netPence + vatPence) };
}

export function calculateNetAgentFee(input: Pick<AgentInvoicePreviewInput, "contractPrice" | "agentFeePercent">) {
  return milestoneFee({ contractPrice: input.contractPrice, agentFeePercent: input.agentFeePercent, vatRate: 0 }).netAmount;
}

export function calculateAgentInvoicePreview(input: AgentInvoicePreviewInput) {
  const { netAmount, vatAmount, grossAmount } = milestoneFee({
    contractPrice: input.contractPrice,
    agentFeePercent: input.agentFeePercent,
    vatRate: input.vatRate,
  });
  const reservationFeeDeduction = input.reservationFeeHolder === "sales_agent" ? numeric(input.reservationFee) : 0;
  const agentContributionDeduction = numeric(input.agentContribution);
  const expectedPayableAmount = fromPence(Math.max(0, toPence(grossAmount) - toPence(reservationFeeDeduction) - toPence(agentContributionDeduction)));

  return { netAmount, vatAmount, grossAmount, reservationFeeDeduction, agentContributionDeduction, expectedPayableAmount };
}

export function calculateDeveloperNet(input: DeveloperNetInput) {
  return fromPence(
    toPence(input.contractPrice)
    + toPence(input.parkingValue)
    - toPence(input.developerContribution)
    - toPence(input.solicitorFee)
    - toPence(calculateNetAgentFee(input)),
  );
}
