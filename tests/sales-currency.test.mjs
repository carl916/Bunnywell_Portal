import test from "node:test";
import assert from "node:assert/strict";

import {
  formatGbp,
  formatGbpDeduction,
  formatGbpInputValue,
  parseGbpInput,
  rawGbpInputValue,
} from "../src/lib/sales/currency.ts";

test("GBP parser accepts plain, comma-formatted and pound-prefixed values", () => {
  assert.equal(parseGbpInput("5000"), 5000);
  assert.equal(parseGbpInput("5,000"), 5000);
  assert.equal(parseGbpInput("£5,000"), 5000);
  assert.equal(parseGbpInput("£250,000"), 250000);
});

test("GBP parser clears optional values and preserves zero", () => {
  assert.equal(parseGbpInput(""), null);
  assert.equal(rawGbpInputValue(""), "");
  assert.equal(parseGbpInput("0"), 0);
  assert.equal(rawGbpInputValue("£0"), "0");
});

test("GBP parser strips invalid characters and discards pence for whole-pound fields", () => {
  assert.equal(parseGbpInput("GBP 45,110,229"), 45110229);
  assert.equal(parseGbpInput("£5,000.99"), 5000);
  assert.equal(parseGbpInput("abc"), null);
});

test("GBP formatter presents whole pounds consistently", () => {
  assert.equal(formatGbp(5000), "£5,000");
  assert.equal(formatGbp(250000), "£250,000");
  assert.equal(formatGbp(45110229), "£45,110,229");
  assert.equal(formatGbp(null), "-");
  assert.equal(formatGbpDeduction(5000), "-£5,000");
});

test("GBP input formatter displays commas while keeping raw state database-safe", () => {
  assert.equal(formatGbpInputValue("5000"), "5,000");
  assert.equal(rawGbpInputValue("£45,110,229"), "45110229");
});
