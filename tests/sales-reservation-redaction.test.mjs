import test from "node:test";
import assert from "node:assert/strict";

import { buildFailedReservationRedactionPatch } from "../src/lib/sales/reservation-redaction.ts";

test("failed reservation redaction clears buyer details and deactivates sale attempt", () => {
  const patch = buildFailedReservationRedactionPatch({
    reason: "Buyer withdrew before exchange",
    redactedByUserId: "user-123",
    timestamp: "2026-07-22T10:00:00.000Z",
  });

  assert.equal(patch.buyer_name, null);
  assert.equal(patch.buyer_person_name, null);
  assert.equal(patch.buyer_company_name, null);
  assert.equal(patch.buyer_email, null);
  assert.equal(patch.buyer_phone, null);
  assert.equal(patch.buyer_solicitor_name, null);
  assert.equal(patch.is_active, false);
  assert.equal(patch.workflow_status, "fallen_through");
  assert.equal(patch.fall_through_reason, "Buyer withdrew before exchange");
  assert.equal(patch.stage_entered_at, "2026-07-22T10:00:00.000Z");
  assert.equal(patch.redacted_by_user_id, "user-123");
  assert.equal(patch.redacted_at, "2026-07-22T10:00:00.000Z");
});

test("failed reservation redaction records a default reason when blank", () => {
  const patch = buildFailedReservationRedactionPatch({
    reason: "   ",
    redactedByUserId: "user-123",
    timestamp: "2026-07-22T10:00:00.000Z",
  });

  assert.equal(patch.fall_through_reason, "Reservation failed.");
  assert.equal(patch.redaction_note, "Reservation failed.");
});
