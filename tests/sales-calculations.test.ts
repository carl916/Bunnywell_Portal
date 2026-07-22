import assert from "node:assert/strict";
import test from "node:test";
import {
  applyUnitIncentiveScenario,
  calculateSchemeSales,
  canEditIncentiveModel,
  unitForecastRevenue,
  unitNetSalesProceeds,
  type SalesUnitInput,
} from "../src/lib/sales/calculations";

const units: SalesUnitInput[] = [
  { id: "u1", saleStatus: "for_sale", listPrice: 300000, agentFee: 9000, solicitorFee: 1500 },
  { id: "u2", saleStatus: "reserved", listPrice: 325000, reservationPrice: 315000, contractPrice: 310000, developerContribution: 5000 },
  { id: "u3", saleStatus: "exchanged", listPrice: 350000, contractPrice: 340000, agentContribution: 3000 },
  { id: "u4", saleStatus: "completed", listPrice: 400000, contractPrice: 390000, agentFee: 10000, solicitorFee: 2000 },
];

test("calculates baseline GDV from list prices", () => {
  assert.equal(calculateSchemeSales(units).baselineGdv, 1375000);
});

test("uses sale-status forecast revenue fallbacks", () => {
  assert.equal(unitForecastRevenue(units[0]), 300000);
  assert.equal(unitForecastRevenue(units[1]), 315000);
  assert.equal(unitForecastRevenue(units[2]), 340000);
  assert.equal(unitForecastRevenue(units[3]), 390000);
  assert.equal(unitForecastRevenue({ id: "u5", saleStatus: "exchanged", listPrice: 250000 }), 250000);
});

test("calculates net sales proceeds after fees and contributions", () => {
  assert.equal(unitNetSalesProceeds(units[0]), 289500);
  assert.equal(unitNetSalesProceeds(units[1]), 310000);
  assert.equal(unitNetSalesProceeds(units[2]), 340000);
  assert.equal(unitNetSalesProceeds(units[3]), 378000);
});

test("calculates profit and ratios where denominators exist", () => {
  const result = calculateSchemeSales(units, { totalDevelopmentCost: 1000000, totalDebt: 500000 });
  assert.equal(result.currentForecastRevenue, 1345000);
  assert.equal(result.netSalesProceeds, 1317500);
  assert.equal(result.forecastProfit, 317500);
  assert.equal(result.forecastProfitMargin, 317500 / 1345000);
  assert.equal(result.returnOnCost, 317500 / 1000000);
  assert.equal(result.profitAsPercentageOfDebt, 317500 / 500000);
});

test("returns null ratios for missing or zero denominators", () => {
  const result = calculateSchemeSales(units, { totalDevelopmentCost: 0, totalDebt: null });
  assert.equal(result.forecastProfit, 1317500);
  assert.equal(result.returnOnCost, null);
  assert.equal(result.profitAsPercentageOfDebt, null);
});

test("tracks missing list prices without blocking totals", () => {
  const result = calculateSchemeSales([{ id: "u1", saleStatus: "for_sale", listPrice: null }]);
  assert.equal(result.baselineGdv, 0);
  assert.equal(result.currentForecastRevenue, 0);
  assert.equal(result.missingListPriceCount, 1);
});

test("supports negative profit", () => {
  const result = calculateSchemeSales(units, { totalDevelopmentCost: 2000000, totalDebt: 500000 });
  assert.equal(result.forecastProfit, -682500);
  assert.equal(result.returnOnCost, -682500 / 2000000);
});

test("applies incentive preview to selected unit only", () => {
  const preview = applyUnitIncentiveScenario(units, "u2", { scope: "unit", developerContribution: 25000, agentContribution: 10000 });
  assert.equal(preview.find((unit) => unit.id === "u2")?.developerContribution, 25000);
  assert.equal(preview.find((unit) => unit.id === "u1")?.developerContribution, undefined);
});

test("applies preview across selected and currently for-sale units only", () => {
  const preview = applyUnitIncentiveScenario(units, "u2", { scope: "all_for_sale", developerContribution: 15000, agentContribution: 5000 });
  assert.equal(preview.find((unit) => unit.id === "u1")?.developerContribution, 15000);
  assert.equal(preview.find((unit) => unit.id === "u2")?.developerContribution, 15000);
  assert.equal(preview.find((unit) => unit.id === "u3")?.developerContribution, undefined);
});

test("locks incentive modelling after reservation", () => {
  assert.equal(canEditIncentiveModel("for_sale"), true);
  assert.equal(canEditIncentiveModel("reserved"), false);
  assert.equal(canEditIncentiveModel("exchanged"), false);
  assert.equal(canEditIncentiveModel("completed"), false);
  assert.equal(canEditIncentiveModel("handed_over"), false);
  assert.equal(canEditIncentiveModel(null), false);
});
