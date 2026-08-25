import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { notificationVariantForMessage } from "../src/lib/notifications.ts";

const portalSource = readFileSync("src/components/portal/ProductionPortalApp.tsx", "utf8");

test("completed actions use the success notification semantic", () => {
  for (const message of [
    "Payment recorded successfully.",
    "Invoice approved.",
    "Record saved.",
    "Document uploaded.",
  ]) {
    assert.equal(notificationVariantForMessage(message), "success");
  }
});

test("warning, destructive/error and neutral messages have distinct semantics", () => {
  assert.equal(notificationVariantForMessage("Documents required before completion."), "warning");
  assert.equal(notificationVariantForMessage("Invoice upload failed."), "error");
  assert.equal(notificationVariantForMessage("Payment voided."), "error");
  assert.equal(notificationVariantForMessage("The latest data has been loaded."), "info");
});

test("the shared portal notice renders all four semantic variants accessibly", () => {
  assert.match(portalSource, /notificationVariantForMessage\(notice\)/);
  assert.match(portalSource, /variant === "success"/);
  assert.match(portalSource, /variant === "warning"/);
  assert.match(portalSource, /variant === "error"/);
  assert.match(portalSource, /role=\{noticeVariant === "error" \? "alert" : "status"\}/);
});
