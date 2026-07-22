export type SaleStatus = "for_sale" | "reserved" | "exchanged" | "completed" | "handed_over" | string;

// POC assumption: fixed sales solicitor fee of GBP 882 per unit.
export const POC_SALES_SOLICITOR_FEE = 882;

export type SalesUnitInput = {
  id: string;
  saleStatus: SaleStatus;
  listPrice?: number | null;
  reservationPrice?: number | null;
  contractPrice?: number | null;
  agentFee?: number | null;
  solicitorFee?: number | null;
  developerContribution?: number | null;
  agentContribution?: number | null;
};

export type SchemeSettingsInput = {
  totalDevelopmentCost?: number | null;
  totalDebt?: number | null;
};

export type RatioValue = number | null;

export function moneyValue(value?: number | null) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function unitListPrice(unit: SalesUnitInput) {
  return moneyValue(unit.listPrice);
}

export function unitForecastRevenue(unit: SalesUnitInput) {
  const listPrice = unitListPrice(unit);
  const reservationPrice = moneyValue(unit.reservationPrice);
  const contractPrice = moneyValue(unit.contractPrice);

  if (unit.saleStatus === "reserved") return reservationPrice ?? contractPrice ?? listPrice;
  if (unit.saleStatus === "exchanged" || unit.saleStatus === "completed" || unit.saleStatus === "handed_over") return contractPrice ?? listPrice;
  return listPrice;
}

export function unitNetSalesProceeds(unit: SalesUnitInput) {
  const revenue = unitForecastRevenue(unit);
  if (revenue === null) return null;

  return revenue
    - (moneyValue(unit.agentFee) ?? 0)
    - (moneyValue(unit.solicitorFee) ?? 0)
    - (moneyValue(unit.developerContribution) ?? 0);
}

export function ratio(numerator: number | null | undefined, denominator: number | null | undefined): RatioValue {
  if (typeof numerator !== "number" || !Number.isFinite(numerator)) return null;
  if (typeof denominator !== "number" || !Number.isFinite(denominator) || denominator <= 0) return null;
  return numerator / denominator;
}

export function calculateSchemeSales(units: SalesUnitInput[], settings: SchemeSettingsInput = {}) {
  let missingListPriceCount = 0;

  const baselineGdv = units.reduce((sum, unit) => {
    const value = unitListPrice(unit);
    if (value === null) {
      missingListPriceCount += 1;
      return sum;
    }
    return sum + value;
  }, 0);

  const currentForecastRevenue = units.reduce((sum, unit) => sum + (unitForecastRevenue(unit) ?? 0), 0);
  const netSalesProceeds = units.reduce((sum, unit) => sum + (unitNetSalesProceeds(unit) ?? 0), 0);
  const totalDevelopmentCost = moneyValue(settings.totalDevelopmentCost);
  const totalDebt = moneyValue(settings.totalDebt);
  const forecastProfit = totalDevelopmentCost !== null ? netSalesProceeds - totalDevelopmentCost : null;

  return {
    baselineGdv,
    currentForecastRevenue,
    forecastProfit,
    forecastProfitMargin: ratio(forecastProfit, currentForecastRevenue),
    missingListPriceCount,
    netSalesProceeds,
    profitAsPercentageOfDebt: ratio(forecastProfit, totalDebt),
    returnOnCost: ratio(forecastProfit, totalDevelopmentCost),
    totalDebt,
    totalDevelopmentCost,
    unitCount: units.length,
  };
}

export function applyUnitIncentiveScenario(
  units: SalesUnitInput[],
  selectedUnitId: string,
  scenario: { developerContribution: number; agentContribution: number; scope: "unit" | "all_for_sale" },
) {
  return units.map((unit) => {
    const shouldApply = scenario.scope === "unit"
      ? unit.id === selectedUnitId
      : unit.id === selectedUnitId || unit.saleStatus === "for_sale";

    if (!shouldApply) return unit;
    return {
      ...unit,
      agentContribution: scenario.agentContribution,
      developerContribution: scenario.developerContribution,
    };
  });
}

export function canEditIncentiveModel(saleStatus?: SaleStatus | null) {
  return saleStatus === "for_sale";
}
