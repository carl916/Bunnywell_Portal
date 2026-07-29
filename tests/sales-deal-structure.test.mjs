import test from "node:test";
import assert from "node:assert/strict";

import {
  buildDepositStructure,
  buildPaymentScheduleRows,
  paymentScheduleSummary,
} from "../src/lib/sales/deal-structure.ts";

test("deal structure calculates Forum House-style 10/5/85 schedule", () => {
  const structure = buildDepositStructure({
    exchangeDepositPercent: 10,
    secondDepositEnabled: true,
    secondDepositPercent: 5,
    secondDepositMonthsAfterExchange: 6,
  });

  assert.equal(structure.isValid, true);
  assert.equal(structure.exchangeDepositPercent, 10);
  assert.equal(structure.secondDepositPercent, 5);
  assert.equal(structure.completionBalancePercent, 85);
  assert.equal(structure.totalPercent, 100);
  assert.equal(paymentScheduleSummary(structure), "10% on exchange, 5% 6 months after exchange, 85% on completion");
});

test("deal structure validates deposits above 100%", () => {
  const structure = buildDepositStructure({
    exchangeDepositPercent: 90,
    secondDepositEnabled: true,
    secondDepositPercent: 15,
    secondDepositMonthsAfterExchange: 6,
  });

  assert.equal(structure.isValid, false);
  assert.match(structure.error ?? "", /exceed 100/i);
});

test("payment schedule rows use contract price and exclude reservation fee from percent validation", () => {
  const rows = buildPaymentScheduleRows({
    contractPrice: 400000,
    exchangeDepositPercent: 10,
    secondDepositEnabled: true,
    secondDepositPercent: 5,
    secondDepositMonthsAfterExchange: 6,
  });

  assert.deepEqual(rows.map((row) => row.percentOfContractPrice), [10, 5, 85]);
  assert.deepEqual(rows.map((row) => row.expectedAmount), [40000, 20000, 340000]);
  assert.equal(rows[0].includesReservationFee, true);
});
