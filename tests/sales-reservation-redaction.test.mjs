import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  buildFailedReservationRedactionPatch,
  canReturnUnitToForSale,
  PRE_EXCHANGE_RETURNABLE_STATUSES,
} from "../src/lib/sales/reservation-redaction.ts";

const routeSource = readFileSync("src/app/api/sales/reservations/route.ts", "utf8");
const workflowSource = readFileSync("src/components/portal/sales/SalesReservationWorkflow.tsx", "utf8");
const returnMigrationSource = readFileSync("supabase/migrations/20260830c_return_pre_exchange_unit_for_sale.sql", "utf8");

test("failed reservation redaction preserves buyer names while clearing contact details", () => {
  const patch = buildFailedReservationRedactionPatch({
    reason: "Buyer withdrew before exchange",
    redactedByUserId: "user-123",
    timestamp: "2026-07-22T10:00:00.000Z",
  });

  assert.equal(Object.hasOwn(patch, "buyer_name"), false);
  assert.equal(Object.hasOwn(patch, "buyer_person_name"), false);
  assert.equal(Object.hasOwn(patch, "buyer_company_name"), false);
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

test("every active pre-exchange stage can return to For sale and later stages cannot", () => {
  for (const status of [
    "draft",
    "awaiting_approval",
    "reservation_submitted",
    "rejected",
    "reservation_query_raised",
    "approved",
    "reservation_approved",
    "awaiting_commercial_approval",
    "ready_for_exchange",
  ]) {
    assert.equal(PRE_EXCHANGE_RETURNABLE_STATUSES.includes(status), true);
    assert.equal(canReturnUnitToForSale(status), true);
  }

  for (const status of ["exchanged", "completion_pending", "completed", "fallen_through", "superseded"]) {
    assert.equal(canReturnUnitToForSale(status), false);
  }
});

test("cancelling a reservation attempt is kept in the Reservation step and enforced atomically in the database", () => {
  const reservationWorkspaceStart = workflowSource.indexOf('id="sales-stage-reservation"');
  const reservationWorkspaceEnd = workflowSource.indexOf("</StageWorkspace>", reservationWorkspaceStart);
  const reservationWorkspace = workflowSource.slice(reservationWorkspaceStart, reservationWorkspaceEnd);
  const saleFileHeaderStart = workflowSource.indexOf("Selected sale file");
  const saleFileHeaderEnd = workflowSource.indexOf("<SaleFileWorkspaceTabs", saleFileHeaderStart);
  const saleFileHeader = workflowSource.slice(saleFileHeaderStart, saleFileHeaderEnd);

  assert.match(reservationWorkspace, /Reservation options/);
  assert.match(reservationWorkspace, /Cancel reservation attempt/);
  assert.match(reservationWorkspace, /Confirm cancellation/);
  assert.doesNotMatch(saleFileHeader, /Cancel reservation attempt|Return to For sale/);
  assert.match(workflowSource, /returnReason: returnToForSaleReason/);
  assert.match(routeSource, /rpc\("return_pre_exchange_unit_for_sale"/);
  assert.match(routeSource, /!attempt\.is_active \|\| !canReturnUnitToForSale/);
  assert.match(routeSource, /returnError\?\.code === "PGRST202"/);
  assert.match(workflowSource, /action === "return_unit_for_sale"[\s\S]*The reservation attempt could not be cancelled/);
  assert.match(returnMigrationSource, /for update/);
  assert.match(returnMigrationSource, /workflow_status = 'fallen_through'/);
  assert.match(returnMigrationSource, /is_active = false/);
  assert.match(returnMigrationSource, /sale_status = 'for_sale'/);
  assert.match(returnMigrationSource, /reservation_date = null/);
  assert.doesNotMatch(returnMigrationSource, /buyer_name = null/);
  assert.doesNotMatch(returnMigrationSource, /buyer_person_name = null/);
  assert.doesNotMatch(returnMigrationSource, /buyer_company_name = null/);
  assert.doesNotMatch(returnMigrationSource, /unit_sale_document_versions version[\s\S]*redacted_at = v_now/);
  assert.doesNotMatch(routeSource, /pathsByBucket/);
  assert.match(workflowSource, /Reservation history[\s\S]*buyerDisplay\(attempt\)/);
  assert.match(workflowSource, /Reservation history[\s\S]*Reservation date/);
  assert.match(workflowSource, /Reservation history[\s\S]*openDocumentVersion\(reservationFormVersion\)/);
  assert.match(returnMigrationSource, /'unit_returned_to_for_sale'/);
  assert.match(returnMigrationSource, /grant execute[\s\S]*to service_role/);
  assert.doesNotMatch(returnMigrationSource, /'exchanged'[\s\S]*'ready_for_exchange'/);
});
