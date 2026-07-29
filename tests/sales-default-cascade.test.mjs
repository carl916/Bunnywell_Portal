import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  classifyDefaultDealSetupCascade,
  defaultDealSetupCascadeSummary,
} from "../src/lib/sales/default-cascade.ts";

const setupSource = readFileSync("src/components/portal/ProductionPortalApp.tsx", "utf8");
const workflowSource = readFileSync("src/components/portal/sales/SalesReservationWorkflow.tsx", "utf8");

test("building default cascade updates only unreserved For Sale units", () => {
  const result = classifyDefaultDealSetupCascade({
    units: [
      { id: "for-sale-empty", sale_status: "for_sale" },
      { id: "for-sale-priced", sale_status: "for_sale" },
      { id: "reserved", sale_status: "reserved" },
      { id: "exchanged", sale_status: "exchanged" },
      { id: "completed", sale_status: "completed" },
    ],
    attempts: [
      { id: "attempt-priced", unit_id: "for-sale-priced", is_active: true, workflow_status: "draft" },
      { id: "attempt-reserved", unit_id: "reserved", is_active: true, workflow_status: "reservation_approved", reservation_approved_at: "2026-07-01T10:00:00Z" },
      { id: "attempt-exchanged", unit_id: "exchanged", is_active: true, workflow_status: "exchanged", exchanged_at: "2026-07-10" },
      { id: "attempt-completed", unit_id: "completed", is_active: true, workflow_status: "completed", completed_at: "2026-07-20" },
    ],
  });

  assert.deepEqual(result.eligibleUnitIds, ["for-sale-empty", "for-sale-priced"]);
  assert.deepEqual(result.eligibleAttemptIds, ["attempt-priced"]);
  assert.equal(result.reservedSkipped, 1);
  assert.equal(result.exchangedSkipped, 1);
  assert.equal(result.completedSkipped, 1);
});

test("building default cascade skips reservation drafts", () => {
  const result = classifyDefaultDealSetupCascade({
    units: [
      { id: "buyer-draft", sale_status: "for_sale" },
      { id: "uploaded-form", sale_status: "for_sale" },
      { id: "submitted", sale_status: "for_sale" },
    ],
    attempts: [
      { id: "attempt-buyer", unit_id: "buyer-draft", is_active: true, workflow_status: "draft", buyer_name: "Buyer One" },
      { id: "attempt-uploaded", unit_id: "uploaded-form", is_active: true, workflow_status: "draft" },
      { id: "attempt-submitted", unit_id: "submitted", is_active: true, workflow_status: "reservation_submitted" },
    ],
    documents: [
      { sale_attempt_id: "attempt-uploaded", document_type: "reservation_form", status: "uploaded", redacted_at: null },
    ],
  });

  assert.deepEqual(result.eligibleUnitIds, []);
  assert.equal(result.draftReservationsSkipped, 3);
});

test("building sales setup communicates cascade scope and count summary", () => {
  assert.match(setupSource, /These defaults apply to unreserved units\. Reserved, exchanged and completed sale files keep their own agreed commercial snapshot\./);
  assert.match(setupSource, /defaultDealSetupCascadeSummary\(cascade\)/);
  assert.match(setupSource, /applyDefaultDealSetupToUnreservedUnits/);
});

test("protected sale files show a muted snapshot note when defaults differ", () => {
  assert.match(workflowSource, /This sale uses the deal setup agreed at reservation\. Building defaults may have changed since\./);
  assert.match(workflowSource, /buildingDefaultsDifferFromSnapshot/);
});

test("default cascade summary includes updated and protected counts", () => {
  assert.equal(
    defaultDealSetupCascadeSummary({
      eligibleUnitIds: ["u1", "u2"],
      eligibleAttemptIds: ["a1"],
      draftReservationsSkipped: 1,
      reservedSkipped: 3,
      exchangedSkipped: 4,
      completedSkipped: 5,
    }),
    "Updated 2 For Sale units. 1 reservation draft left unchanged. 3 Reserved, 4 Exchanged and 5 Completed units were not changed.",
  );
});
