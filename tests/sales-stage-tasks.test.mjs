import test from "node:test";
import assert from "node:assert/strict";
import { currentSalesTask, getCompletionDocumentState, getCompletionTasks, getExchangeTasks, getReservationTasks } from "../src/lib/sales/stage-tasks.ts";
import { historicalActorLabel } from "../src/lib/sales/actor-identity.ts";
import { canPerformSalesAction } from "../src/lib/sales/permissions.ts";

const time = (day) => `2026-08-${String(day).padStart(2, "0")}T12:00:00Z`;
const documents = ["completion_statement", "statement_of_account"].map((document_type, index) => ({
  id: `document-${index}`, document_type, status: "uploaded", approved_at: null, updated_at: time(index + 1),
}));
const versions = documents.map((document, index) => ({ document_id: document.id, is_current: true, uploaded_at: time(index + 1), uploaded_by_user_id: `solicitor-${index}` }));
const statuses = (tasks) => tasks.map((task) => task.status);
const completion = (docs = documents, files = versions, options = {}) => getCompletionTasks({
  exchangeRecorded: true, completionRecorded: false, documents: getCompletionDocumentState(docs, files, options.queryAt), ...options,
});

for (const [state, expected, current] of [
  ["not_started", ["current", "locked"], "Record reservation"],
  ["awaiting_approval", ["complete", "current"], "Approve reservation"],
  ["approved", ["complete", "complete"], "Approval record"],
  ["rejected", ["changes_required", "locked"], "Record reservation"],
  ["failed", ["locked", "locked"], "Reservation ended"],
]) {
  test(`reservation ${state} selects the right task and retains its two steps`, () => {
    const tasks = getReservationTasks({ state });
    assert.deepEqual(statuses(tasks), expected);
    assert.equal(currentSalesTask(tasks, current), current);
  });
}

test("same and different reservation actors are preserved; missing actors are not invented", () => {
  for (const approver of ["Jane Smith", "Sam Developer"]) {
    const tasks = getReservationTasks({ state: "approved", submittedBy: "Jane Smith", approvedBy: approver });
    assert.equal(tasks[0].completedBy, "Jane Smith");
    assert.equal(tasks[1].completedBy, approver);
  }
  assert.equal(historicalActorLabel({ userId: "deleted-user", profiles: [], fallback: "" }), "");
  assert.equal(getReservationTasks({ state: "approved" })[0].completedBy, undefined);
});

for (const [reservationApproved, commercialApproved, exchangeRecorded, expected] of [
  [false, false, false, ["locked", "locked"]],
  [true, false, false, ["current", "locked"]],
  [true, true, false, ["complete", "current"]],
  [true, true, true, ["complete", "complete"]],
]) {
  test(`exchange lifecycle ${expected.join(" / ")}`, () => {
    assert.deepEqual(statuses(getExchangeTasks({ reservationApproved, commercialApproved, exchangeRecorded })), expected);
  });
}

test("completion remains locked before exchange", () => {
  assert.deepEqual(statuses(completion([], [], { exchangeRecorded: false })), ["locked", "locked", "locked"]);
});

for (const files of [[], [versions[0]], [versions[1]]]) {
  test(`completion needs both current uploads (${files.map((file) => file.document_id).join() || "none"})`, () => {
    assert.deepEqual(statuses(completion(documents, files)), ["current", "locked", "locked"]);
  });
}

test("document records, redacted/superseded documents and old versions cannot stand in for current uploads", () => {
  assert.equal(getCompletionDocumentState(documents, versions.map((file) => ({ ...file, is_current: false }))).uploaded, false);
  for (const key of ["redacted_at", "superseded_at"]) {
    assert.equal(getCompletionDocumentState(documents.map((doc) => ({ ...doc, [key]: time(3) })), versions).uploaded, false);
  }
  assert.equal(getCompletionDocumentState(documents, versions.map((file) => ({ ...file, redacted_at: time(3) }))).uploaded, false);
});

test("both uploads require a separate developer approval and attribute the last required upload", () => {
  assert.deepEqual(statuses(completion()), ["complete", "current", "locked"]);
  assert.equal(getCompletionDocumentState(documents, versions).uploadedByUserId, "solicitor-1");
  assert.equal(getCompletionDocumentState(documents, versions.map((file) => ({ ...file, uploaded_by_user_id: null }))).uploadedByUserId, null);
});

test("query returns work to the solicitor; one relevant replacement requires fresh developer review", () => {
  const queried = documents.map((doc) => ({ ...doc, status: "query_raised", updated_at: time(3) }));
  assert.deepEqual(statuses(completion(queried, versions, { queryAt: time(3) })), ["changes_required", "awaiting_resubmission", "locked"]);
  const replaced = [{ ...queried[0], status: "uploaded", updated_at: time(4) }, queried[1]];
  const replacementVersions = [{ ...versions[0], uploaded_at: time(4), uploaded_by_user_id: "replacement-solicitor" }, versions[1]];
  const tasks = completion(replaced, replacementVersions, { queryAt: time(3) });
  assert.deepEqual(statuses(tasks), ["complete", "current", "locked"]);
  assert.equal(currentSalesTask(tasks, ""), "Review completion documents");
  // A reload supplies only stored rows; it must produce exactly the same state.
  assert.deepEqual(completion(JSON.parse(JSON.stringify(replaced)), JSON.parse(JSON.stringify(replacementVersions)), { queryAt: time(3) }), tasks);
  const approved = replaced.map((doc) => ({ ...doc, status: "approved", approved_at: time(5) }));
  assert.deepEqual(statuses(completion(approved, replacementVersions, { queryAt: time(3) })), ["complete", "complete", "current"]);
  assert.deepEqual(statuses(completion(approved, replacementVersions, { queryAt: time(3), completionRecorded: true })), ["complete", "complete", "complete"]);
});

test("stale approval and a failed replacement upload cannot advance completion", () => {
  const stale = documents.map((doc) => ({ ...doc, status: "approved", approved_at: time(1) }));
  assert.equal(getCompletionDocumentState(stale, versions).approved, false);
  const failedReplacement = documents.map((doc) => ({ ...doc, status: "uploaded", updated_at: time(4) }));
  assert.equal(getCompletionDocumentState(failedReplacement, versions, time(3)).needsChanges, true);
});

test("responsibilities use existing role permissions, including internal administrative access", () => {
  const actions = ["submit_reservation", "approve_reservation", "submit_completion_documents", "approve_completion_documents", "record_completion"];
  for (const [role, expected] of [
    ["sales_agent", [true, false, false, false, false]],
    ["conveyancer", [false, false, true, false, true]],
    ["developer", [true, true, true, true, true]],
    ["admin", [true, true, true, true, true]],
    ...["resident", "contractor", "user", "developer_representative"].map((role) => [role, [false, false, false, false, false]]),
  ]) assert.deepEqual(actions.map((action) => canPerformSalesAction(role, action)), expected, role);
});
