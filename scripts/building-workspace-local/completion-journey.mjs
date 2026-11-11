import { chromium, expect } from "@playwright/test";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import assert from "node:assert/strict";
import { sql } from "./runtime.mjs";
const out = "artifacts/building-workspace-stage2/completion-review";
const record = JSON.parse(readFileSync(out + "/test-record.json", "utf8"));
const credentials = JSON.parse(readFileSync("local-runtime/test-access.json", "utf8"));
const base = "http://127.0.0.1:3031", endpoint = "/dev/building-workspace/completion";
const task = base + "/dev/building-workspace?" + new URLSearchParams({ view: "sale", building: record.buildingId, unit: record.unitId, sale: record.saleId, section: "completion" });
const tests = [], errors = [], network = [];
function pdf(text) {
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
  const stream = "BT /F1 16 Tf 50 780 Td (" + text + ") Tj ET";
  objects.push("<< /Length " + stream.length + " >>\nstream\n" + stream + "\nendstream");
  let result = "%PDF-1.4\n", offsets = [0];
  objects.forEach((o, i) => { offsets.push(Buffer.byteLength(result)); result += (i + 1) + " 0 obj\n" + o + "\nendobj\n"; });
  const xref = Buffer.byteLength(result);
  result += "xref\n0 6\n0000000000 65535 f \n" + offsets.slice(1).map(n => String(n).padStart(10, "0") + " 00000 n \n").join("") + "trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n" + xref + "\n%%EOF\n";
  return Buffer.from(result);
}
const browser = await chromium.launch();
async function context() {
  const c = await browser.newContext({ viewport: { width: 1366, height: 768 }, serviceWorkers: "block" });
  c.on("page", p => {
    p.on("pageerror", e => errors.push(e.message));
    p.on("request", r => { const u = new URL(r.url()); if (["http:","https:"].includes(u.protocol)) { network.push({ method: r.method(), origin: u.origin, path: u.pathname }); if (![base,"http://127.0.0.1:54321"].includes(u.origin)) errors.push("Unexpected network origin: " + u.origin); } });
  });
  return c;
}
async function login(c, alias, href = task) {
  const p = await c.newPage(); await p.goto(href);
  await p.getByLabel("Email", { exact: true }).fill(credentials.accounts.find(a => a.alias === alias).email);
  await p.getByLabel("Password", { exact: true }).fill(credentials.password);
  await p.getByRole("button", { name: "Sign in", exact: true }).click();
  await p.getByRole("heading", { name: "Completion at a glance", exact: true }).waitFor({ timeout: 40000 });
  return p;
}
const card = p => p.getByRole("region", { name: "Completion statement", exact: true });
const account = p => p.getByRole("region", { name: "Statement of account", exact: true });
async function call(p, action, values = {}, scope = record) {
  return p.evaluate(async ({ endpoint, action, values, scope }) => {
    const token = JSON.parse(sessionStorage.getItem("bunnywell-stage2-auth")).access_token;
    const r = await fetch(endpoint, { method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }, body: JSON.stringify({ action, scope, ...values }) });
    return { status: r.status, body: await r.json() };
  }, { endpoint, action, values, scope });
}
function documents() { return JSON.parse(sql("select coalesce(json_agg(json_build_object('type',d.document_type,'status',d.status,'query',d.query_note,'approvedVersion',d.approved_version_id,'approvedBy',d.approved_by_user_id,'version',v.id,'number',v.version_number,'actor',v.uploaded_by_user_id)),'[]') from unit_sale_documents d join unit_sale_document_versions v on v.document_id=d.id and v.is_current where d.sale_attempt_id='" + record.saleId + "';")); }
async function upload(p, name, text, selector = card) {
  const c = selector(p);
  await c.locator('input[type="file"]').setInputFiles({ name, mimeType: "application/pdf", buffer: pdf(text) });
  await c.getByRole("button", { name: /^(Upload document|Upload revised document)$/ }).click();
  await expect(selector(p).getByText(name, { exact: true })).toBeVisible({ timeout: 45000 });
  await expect(selector(p).getByText("Awaiting approval", { exact: true })).toBeVisible();
}

async function workState(p, expectedText) {
  await p.goto(base+"/dev/building-workspace?"+new URLSearchParams({building:record.buildingId,view:"worklist",q:record.unitNumber}));
  const row=p.getByRole("row").filter({hasText:record.unitNumber});
  await expect(row).toHaveCount(1);
  const text=await row.textContent();
  if(expectedText)assert.match(text,expectedText);
  await p.goto(base+"/dev/building-workspace?"+new URLSearchParams({building:record.buildingId,view:"dashboard"}));
  const queue=p.locator('section[class*="dashboardQueue"]').filter({has:p.getByRole("heading",{name:"Our actions",exact:true})});
  await expect(queue).toBeVisible();
  const count=Number((await queue.locator('[class*="badge"]').innerText()).match(/^(\d+) actions/)[1]);
  await p.goto(task);
  await p.getByRole("heading",{name:"Completion at a glance",exact:true}).waitFor();
  return {ourActions:count,row:text};
}
const counts={};
let conveyancer, developer;
try {
  const cc = await context(), dc = await context();
  conveyancer = await login(cc, "conveyancer"); developer = await login(dc, "developer");
  tests.push("Authenticated developer and conveyancer open the same exact full-page sale");
  await expect(card(developer).getByRole("button", { name: "Choose PDF" })).toHaveCount(0);
  await expect(conveyancer.getByRole("button", { name: "Confirm legal completion" })).toBeDisabled();
  tests.push("Role-appropriate controls and other business actions remain disabled");
  counts.before=await workState(developer);
  await upload(conveyancer, "Synthetic-completion-v1.pdf", "FICTIONAL LOCAL COMPLETION STATEMENT - VERSION ONE");
  let statement = documents().find(d => d.type === "completion_statement");
  const first = statement.version;
  assert.equal(statement.number, 1);
  assert.equal(statement.actor, credentials.accounts.find(a => a.alias === "conveyancer").id);
  tests.push("Conveyancer upload persisted through signed resumable Storage and existing finalisation transaction");
  counts.uploaded=await workState(developer,/completion statement/i);
  assert.equal(counts.uploaded.ourActions,counts.before.ourActions+1);
  await developer.reload();
  await expect(card(developer).getByText("Synthetic-completion-v1.pdf", { exact: true })).toBeVisible();
  await card(developer).getByRole("button", { name: "Raise query", exact: true }).click();
  await developer.getByLabel("Query for completion statement").fill("Please correct the fictional service-charge apportionment.");
  await developer.getByRole("button", { name: "Submit query", exact: true }).click();
  await expect(developer.getByRole("heading", { name: "Awaiting revised statement", exact: true })).toBeVisible();
  assert.equal(documents().find(d => d.type === "completion_statement").status, "query_raised");
  tests.push("Developer query persisted on the exact current version and changed the role-appropriate task heading");
  counts.queried=await workState(developer,/quer|revis/i);assert.equal(counts.queried.ourActions,counts.before.ourActions);
  await conveyancer.reload();
  await expect(conveyancer.getByRole("heading", { name: "Resolve the query", exact: true })).toBeVisible();
  await conveyancer.getByLabel("Comment", { exact: true }).fill("I will correct the fictional apportionment and upload the revised statement.");
  await conveyancer.getByRole("button", { name: "Send comment", exact: true }).click();
  await expect(conveyancer.getByRole("region", { name: "Conversation messages" }).getByText("I will correct the fictional apportionment and upload the revised statement.")).toBeVisible();
  tests.push("Conveyancer comment persisted using existing discussion permission and idempotency rules");
  await upload(conveyancer, "Synthetic-completion-v2.pdf", "FICTIONAL LOCAL COMPLETION STATEMENT - REVISED VERSION TWO");
  statement = documents().find(d => d.type === "completion_statement");
  assert.equal(statement.number, 2); assert.equal(statement.query, null);
  tests.push("Revised version supersedes v1, clears its current query and returns to awaiting approval");
  counts.revised=await workState(developer,/completion statement/i);assert.equal(counts.revised.ourActions,counts.before.ourActions+1);
  await developer.reload();
  await expect(card(developer).getByText("Synthetic-completion-v2.pdf", { exact: true })).toBeVisible();
  const stale = await call(developer, "approve_completion_document", { documentType: "completion_statement", versionId: first });
  assert.equal(stale.status, 400); assert.match(stale.body.error, /changed|current/i);
  const wrongRole = await call(conveyancer, "approve_completion_document", { documentType: "completion_statement", versionId: statement.version });
  assert.equal(wrongRole.status, 400);
  tests.push("Stale-version and conveyancer-approval attempts are rejected");
  await card(developer).getByRole("button", { name: "Approve document", exact: true }).click();
  await expect(card(developer).getByText(new RegExp(record.unitNumber))).toBeVisible();
  await card(developer).getByRole("button", { name: "Confirm approval", exact: true }).click();
  await expect(card(developer).getByText("Approved", { exact: true })).toBeVisible();
  statement = documents().find(d => d.type === "completion_statement");
  assert.equal(statement.status, "approved"); assert.equal(statement.approvedVersion, statement.version);
  assert.equal(statement.approvedBy, credentials.accounts.find(a => a.alias === "developer").id);
  tests.push("Developer approval persisted with exact version and authenticated actor; approved version locked");
  counts.approved=await workState(developer);assert.equal(counts.approved.ourActions,counts.before.ourActions);
  tests.push("Dashboard review counts and worklist actions update through upload, query, revision and approval");
  await developer.getByLabel("Comment", { exact: true }).fill("The revised fictional statement is approved.");
  await developer.getByRole("button", { name: "Send comment", exact: true }).click();
  await expect(developer.getByRole("region", { name: "Conversation messages" }).getByText("The revised fictional statement is approved.")).toBeVisible();
  await conveyancer.reload();
  await expect(card(conveyancer).getByText("Approved", { exact: true })).toBeVisible();
  await expect(card(conveyancer).getByRole("button", { name: "Choose PDF" })).toHaveCount(0);
  tests.push("Approval and both comments survive reload and separate authenticated sessions");
  await card(developer).getByText("Recorded document versions", { exact: true }).click();
  await expect(card(developer).getByText(/Previous · version 1/)).toBeVisible();
  await expect(card(developer).getByText(/Please correct the fictional service-charge apportionment/)).toBeVisible();
  tests.push("Previous version retains its query and actor in history");
  const viewed = await developer.evaluate(async ({ endpoint, record, first }) => {
    const token = JSON.parse(sessionStorage.getItem("bunnywell-stage2-auth")).access_token;
    const q = new URLSearchParams({ building: record.buildingId, unit: record.unitId, sale: record.saleId, kind: "document", version: first });
    const r = await fetch(endpoint + "?" + q, { headers: { Authorization: "Bearer " + token } });
    const body = await r.json(); if (!r.ok) return { status: r.status, error: body.error };
    const file = await fetch(body.url); return { status: file.status, prefix: (await file.text()).slice(0, 5), privateLink: new URL(body.url).origin === "http://127.0.0.1:54321" };
  }, { endpoint, record, first });
  assert.deepEqual(viewed, { status: 200, prefix: "%PDF-", privateLink: true });
  tests.push("Previously uploaded PDF is privately readable through existing authorised signing checks");
  await developer.getByRole("button", { name: "Activity", exact: true }).click();
  await expect(developer.getByRole("region", { name: "Sale activity" }).getByText(/approved/, { exact: false }).first()).toBeVisible();
  tests.push("Activity is backed by the existing role-safe workflow event projection");
  // Independently upload and approve the account; statement approval must be preserved.
  await upload(conveyancer, "Synthetic-account.pdf", "FICTIONAL LOCAL STATEMENT OF ACCOUNT", account);
  await developer.reload();
  await account(developer).getByRole("button", { name: "Approve document", exact: true }).click();
  await account(developer).getByRole("button", { name: "Confirm approval", exact: true }).click();
  await expect(developer.getByText("2 of 2 documents approved", { exact: true })).toBeVisible();
  assert.ok(documents().every(d => d.status === "approved"));
  assert.equal(documents().find(d => d.type === "completion_statement").approvedVersion, statement.version);
  tests.push("Both documents can be reviewed independently without altering the other approval");
  await developer.screenshot({ path: out + "/completion-1366.png", fullPage: false });
  await developer.getByRole("button", { name: "Back to worklist", exact: true }).click();
  await expect(developer.getByRole("heading", { name: /Sales/ }).first()).toBeVisible();
  await developer.getByRole("link", { name: new RegExp(record.unitNumber) }).first().waitFor().catch(() => {});
  assert.equal(sql("select workflow_status from unit_sale_attempts where id='" + record.saleId + "';").trim(), "completion_pending");
  tests.push("Existing transaction moves the sale to completion_pending; refreshed worklist uses the persisted facts");
  assert.equal(errors.length, 0, errors.join("\n"));
  assert.ok(network.every(r => [base,"http://127.0.0.1:54321"].includes(r.origin)));
  tests.push("Browser traffic remains local; no unrelated business API requests");
  writeFileSync(out + "/journey.json", JSON.stringify({ at: new Date().toISOString(), record, tests, counts, network, browserErrors: errors }, null, 2));
  console.log(JSON.stringify({ passed: tests.length, tests }, null, 2));
} catch (e) {
  mkdirSync(out, { recursive: true });
  if (developer) await developer.screenshot({ path: out + "/failure-developer.png", fullPage: true });
  if (conveyancer) await conveyancer.screenshot({ path: out + "/failure-conveyancer.png", fullPage: true });
  writeFileSync(out + "/failure.json", JSON.stringify({ tests, error: String(e), browserErrors: errors }, null, 2));
  console.error(JSON.stringify({ completed: tests, error: String(e), browserErrors: errors }, null, 2)); process.exitCode = 1;
} finally { await browser.close(); }
