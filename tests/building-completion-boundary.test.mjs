import test from "node:test";
import assert from "node:assert/strict";
import { loadTypescriptModule } from "./helpers/load-typescript-module.mjs";
const { recordScope, permittedCompletionAction } = loadTypescriptModule("src/lib/experiments/building-integration/completion-boundary.ts");
const uuid = "b1700000-0000-4000-8000-000000000001";
test("Completion operations require stable building, unit and sale identifiers", () => {
  assert.deepEqual(recordScope({ buildingId: uuid, unitId: uuid, saleId: uuid }), { buildingId: uuid, unitId: uuid, saleId: uuid });
  for (const scope of [null, {}, { buildingId: uuid, unitId: "G11", saleId: uuid }, { buildingId: uuid, unitId: uuid }]) assert.throws(() => recordScope(scope));
});
test("only approved document-review operations and plain comments are exposed", () => {
  for (const action of ["prepare_completion_upload","finalize_completion_upload","approve_completion_document","query_completion_document","comment"]) assert.equal(permittedCompletionAction(action), true);
  for (const action of ["send","record_payment","confirm_completion","confirm_exchange","confirm_notice","revoke_authority","assign",null]) assert.equal(permittedCompletionAction(action), false);
});
test("production and missing flags cannot enable the local Completion API", async () => {
  const old = { ...process.env };
  const route = loadTypescriptModule("src/app/dev/building-workspace/completion/route.ts");
  try {
    for (const env of [
      { NODE_ENV: "production", BUILDING_WORKSPACE_LOCAL: "1", BUILDING_COMPLETION_LOCAL: "1", BUNNYWELL_LOCAL_EGRESS_GUARD: "1" },
      { NODE_ENV: "development", BUILDING_WORKSPACE_LOCAL: "1", BUILDING_COMPLETION_LOCAL: "0", BUNNYWELL_LOCAL_EGRESS_GUARD: "1" },
      { NODE_ENV: "development", BUILDING_WORKSPACE_LOCAL: "1", BUILDING_COMPLETION_LOCAL: "1", BUNNYWELL_LOCAL_EGRESS_GUARD: "0" },
    ]) { Object.assign(process.env, env); assert.equal((await route.GET(new Request("http://127.0.0.1:3031/dev/building-workspace/completion"))).status, 404); assert.equal((await route.POST(new Request("http://127.0.0.1:3031/dev/building-workspace/completion", { method: "POST" }))).status, 404); }
  } finally { for (const key of ["NODE_ENV","BUILDING_WORKSPACE_LOCAL","BUILDING_COMPLETION_LOCAL","BUNNYWELL_LOCAL_EGRESS_GUARD"]) if (old[key] === undefined) delete process.env[key]; else process.env[key] = old[key]; }
});
test("server transport denies external egress and unrelated RPC/table/auth writes before fetch", async () => {
  const original = globalThis.fetch, flag = process.env.BUNNYWELL_LOCAL_EGRESS_GUARD;
  let calls = 0, guarded;
  try {
    globalThis.fetch = async () => { calls++; return new Response("{}"); };
    await import("../scripts/building-workspace-local/network-guard.mjs");
    guarded = globalThis.fetch;
  } finally { globalThis.fetch = original; if (flag === undefined) delete process.env.BUNNYWELL_LOCAL_EGRESS_GUARD; else process.env.BUNNYWELL_LOCAL_EGRESS_GUARD = flag; }
  for (const [url, body] of [["https://api.resend.com/emails",{}],["http://127.0.0.1:54321/rest/v1/rpc/sales_legal_action",{p_action:"confirm_completion"}],["http://127.0.0.1:54321/rest/v1/rpc/sales_legal_expire",{}],["http://127.0.0.1:54321/rest/v1/unit_sale_attempts",{}],["http://127.0.0.1:54321/auth/v1/admin/users",{}],["http://127.0.0.1:54321/rest/v1/rpc/sale_comment_write",{p_mentions:["other"]}]]) await assert.rejects(guarded(url,{method:"POST",body:JSON.stringify(body)}));
  assert.equal(calls,0);
  await guarded("http://127.0.0.1:54321/rest/v1/rpc/sales_legal_action",{method:"POST",body:JSON.stringify({p_action:"approve_completion_document"})});
  assert.equal(calls,1);
});
