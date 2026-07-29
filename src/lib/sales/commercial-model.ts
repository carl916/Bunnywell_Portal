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

export function calculateNetAgentFee(input: Pick<AgentInvoicePreviewInput, "contractPrice" | "agentFeePercent">) {
  return numeric(input.contractPrice) * (numeric(input.agentFeePercent) / 100);
}

export function calculateAgentInvoicePreview(input: AgentInvoicePreviewInput) {
  const netAmount = calculateNetAgentFee(input);
  const vatAmount = netAmount * (numeric(input.vatRate ?? 20) / 100);
  const grossAmount = netAmount + vatAmount;
  const reservationFeeDeduction = input.reservationFeeHolder === "sales_agent" ? numeric(input.reservationFee) : 0;
  const agentContributionDeduction = numeric(input.agentContribution);
  const expectedPayableAmount = Math.max(0, grossAmount - reservationFeeDeduction - agentContributionDeduction);

  return { netAmount, vatAmount, grossAmount, reservationFeeDeduction, agentContributionDeduction, expectedPayableAmount };
}

export function calculateDeveloperNet(input: DeveloperNetInput) {
  return numeric(input.contractPrice)
    + numeric(input.parkingValue)
    - numeric(input.developerContribution)
    - numeric(input.solicitorFee)
    - calculateNetAgentFee(input);
}
