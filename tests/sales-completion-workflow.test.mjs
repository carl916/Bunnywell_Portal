import test from "node:test";
import assert from "node:assert/strict";
import { loadTypescriptModule } from "./helpers/load-typescript-module.mjs";

const actions = loadTypescriptModule("src/app/api/sales/reservations/route.ts", {
  overrides: { "@/lib/supabase/admin": { createSupabaseServiceRoleClient() { throw new Error("Live database access is forbidden in this test"); } } },
  exports: ["uploadCompletionDocument", "approveCompletionDocuments", "queryCompletionDocuments", "recordCompletion"],
});
const developer = { id: "developer", role: "developer" };
const solicitor = { id: "solicitor", role: "conveyancer" };
const payload = { saleAttemptId: "attempt", completionDate: "2026-08-05" };

function database() {
  const rows = {
    unit_sale_attempts: [{ id: "attempt", building_id: "building", unit_id: "unit", workflow_status: "exchanged" }],
    unit_sale_documents: ["completion_statement", "statement_of_account"].map((document_type, index) => ({ id: `doc-${index}`, sale_attempt_id: "attempt", document_type, status: "uploaded", approved_at: null })),
    unit_sale_document_versions: [0, 1].map((index) => ({ id: `version-${index}`, document_id: `doc-${index}`, is_current: true, version_number: 1, uploaded_at: "2026-08-01T12:00:00Z" })),
    unit_sale_workflow_events: [], unit_sale_notes: [],
    user_building_access: [{ user_id: solicitor.id, building_id: "building" }],
  };
  const rpcCalls = [];
  const client = {
    rpc: async (name) => { rpcCalls.push(name); return { error: null }; },
    storage: { listBuckets: async () => ({ data: [{ name: "sale-documents" }], error: null }), from: () => ({ upload: async () => ({ error: null }) }) },
    from(table) {
      assert.ok(Object.hasOwn(rows, table), `Unexpected table: ${table}`);
      const filters = []; let update; let inserts; let single = false; let limit; let order;
      const query = {
        select() { return query; },
        eq(key, value) { filters.push((row) => row[key] === value); return query; },
        is(key, value) { filters.push((row) => (row[key] ?? null) === value); return query; },
        in(key, values) { filters.push((row) => values.includes(row[key])); return query; },
        order(key, options) { order = { key, ...options }; return query; },
        limit(value) { limit = value; return query; },
        maybeSingle() { single = true; return query; },
        single() { single = true; return query; },
        update(value) { update = value; return query; },
        insert(value) { inserts = Array.isArray(value) ? value : [value]; return query; },
        then(resolve) {
          if (inserts) rows[table].push(...inserts.map((row) => ({ id: crypto.randomUUID(), created_at: new Date().toISOString(), uploaded_at: new Date().toISOString(), ...row })));
          let result = rows[table].filter((row) => filters.every((filter) => filter(row)));
          if (update) result.forEach((row) => Object.assign(row, update));
          if (order) result.sort((a, b) => String(a[order.key]).localeCompare(String(b[order.key])) * (order.ascending ? 1 : -1));
          if (limit) result = result.slice(0, limit);
          return Promise.resolve({ data: structuredClone(single ? result[0] ?? null : result), error: null }).then(resolve);
        },
      };
      return query;
    },
  };
  return { client, rows, rpcCalls };
}

function uploadForm() {
  const form = new FormData();
  form.set("saleAttemptId", "attempt"); form.set("documentType", "completion_statement");
  form.set("file", new File(["%PDF-1.4 test"], "corrected.pdf", { type: "application/pdf" }));
  return form;
}

test("query, replacement, fresh approval and completion preserve audit and enforce the sequence", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-08-05T12:00:00Z") });
  const { client, rows, rpcCalls } = database();
  await actions.queryCompletionDocuments(client, developer, { ...payload, completionQueryNote: "Correct the completion balance." });
  assert.ok(rows.unit_sale_documents.every((doc) => doc.status === "query_raised" && doc.query_note === "Correct the completion balance."));
  assert.equal(rows.unit_sale_notes[0].body, "Correct the completion balance.");
  await assert.rejects(actions.approveCompletionDocuments(client, developer, payload), /corrected documents/);
  await assert.rejects(actions.recordCompletion(client, solicitor, payload), /approved/);
  t.mock.timers.tick(1000);
  await actions.uploadCompletionDocument(client, solicitor, uploadForm());
  assert.equal(rows.unit_sale_document_versions.filter((version) => version.document_id === "doc-0").length, 2);
  assert.equal(rows.unit_sale_documents[0].approved_at, null);
  assert.equal(rows.unit_sale_attempts[0].workflow_status, "exchanged");
  await assert.rejects(actions.recordCompletion(client, solicitor, payload), /approved/);
  t.mock.timers.tick(1000);
  await actions.approveCompletionDocuments(client, developer, payload);
  assert.ok(rows.unit_sale_documents.every((doc) => doc.status === "approved" && doc.approved_by_user_id === "developer"));
  assert.equal(rows.unit_sale_attempts[0].workflow_status, "completion_pending");
  await actions.recordCompletion(client, solicitor, payload);
  assert.equal(rows.unit_sale_attempts[0].workflow_status, "completed");
  assert.equal(rows.unit_sale_attempts[0].completed_at, "2026-08-05");
  assert.deepEqual(rpcCalls, ["sales_workflow_mark_unit_completed"]);
  assert.deepEqual(rows.unit_sale_workflow_events.map((event) => [event.event_type, event.created_by_user_id]), [
    ["completion_documents_query_raised", "developer"], ["completion_statement_replaced", "solicitor"],
    ["completion_documents_approved", "developer"], ["completion_recorded", "solicitor"],
  ]);
  assert.equal(rows.unit_sale_workflow_events[0].metadata.queryNote, "Correct the completion balance.");
  assert.equal((await actions.recordCompletion(client, solicitor, payload)).alreadyCompleted, true);
});

test("an overall completion_pending status cannot bypass unapproved or missing current documents", async () => {
  for (const state of ["uploaded", "query_raised", "missing", "stale"]) {
    const { client, rows, rpcCalls } = database();
    rows.unit_sale_attempts[0].workflow_status = "completion_pending";
    rows.unit_sale_documents.forEach((doc) => { doc.status = state === "missing" || state === "stale" ? "approved" : state; doc.approved_at = "2026-07-01T12:00:00Z"; });
    if (state === "missing") rows.unit_sale_document_versions = [];
    await assert.rejects(actions.recordCompletion(client, solicitor, payload), /approve the current/);
    assert.deepEqual(rpcCalls, []);
    assert.equal(rows.unit_sale_attempts[0].workflow_status, "completion_pending");
  }
});

test("completion actions reject unauthorised roles and out-of-building solicitors", async () => {
  const { client } = database();
  for (const role of ["sales_agent", "resident", "contractor", "user"]) {
    const requester = { id: role, role };
    await assert.rejects(actions.uploadCompletionDocument(client, requester, uploadForm()), /cannot upload/);
    await assert.rejects(actions.approveCompletionDocuments(client, requester, payload), /Only developers/);
    await assert.rejects(actions.queryCompletionDocuments(client, requester, { ...payload, completionQueryNote: "Fix" }), /Only developers/);
    await assert.rejects(actions.recordCompletion(client, requester, payload), /Only developers or conveyancers/);
  }
  await assert.rejects(actions.approveCompletionDocuments(client, solicitor, payload), /Only developers/);
  await assert.rejects(actions.uploadCompletionDocument(client, { id: "other-solicitor", role: "conveyancer" }, uploadForm()), /sales access/);
});

test("review requires both current documents and a query requires a reason", async () => {
  const { client, rows } = database();
  rows.unit_sale_document_versions.pop();
  await assert.rejects(actions.approveCompletionDocuments(client, developer, payload), /statement of account/);
  await assert.rejects(actions.queryCompletionDocuments(client, developer, { ...payload, completionQueryNote: "  " }), /query note/);
  assert.equal(rows.unit_sale_workflow_events.length, 0);
});
