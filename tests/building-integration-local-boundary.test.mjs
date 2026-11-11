import test from "node:test";
import assert from "node:assert/strict";
import { loadTypescriptModule } from "./helpers/load-typescript-module.mjs";
const { approvedLocalEnvironment: approved, assertLocalEnvironment, createLocalReadTransport } = loadTypescriptModule("src/lib/experiments/building-integration/local-environment.ts");
const path = "/rest/v1/buildings";
const url = approved.apiOrigin + path;

test("only the explicitly approved project and exact loopback origins are accepted", () => {
  assert.doesNotThrow(() => assertLocalEnvironment(approved));
  for (const change of [{ projectId: "staging" }, { apiOrigin: "https://unapproved.invalid" }, { apiOrigin: "http://localhost:54321" }, { appOrigin: "http://127.0.0.1:3027" }]) {
    assert.throws(() => assertLocalEnvironment({ ...approved, ...change }));
  }
});

test("outbound origins, credentials, GET RPCs and side-effectful legacy paths never reach fetch", async () => {
  let calls = 0;
  const read = createLocalReadTransport(approved, [path], async () => { calls++; return new Response("{}"); });
  for (const target of ["https://unapproved.invalid/rest/v1/buildings", "http://127.0.0.1:54322/rest/v1/buildings", "http://user:password@127.0.0.1:54321/rest/v1/buildings", url + "#fragment", approved.apiOrigin + "/rest/v1/rpc/sales_legal_expire", approved.apiOrigin + "/api/sales/legal", approved.apiOrigin + "/auth/v1/user", approved.apiOrigin + "/storage/v1/object/test", approved.apiOrigin + "/rest/v1/unit_sales"]) {
    await assert.rejects(read(target));
  }
  assert.equal(calls, 0);
});

test("unsafe paths cannot be authorised by the table allowlist", () => {
  for (const candidate of ["/rest/v1/rpc/sale_comment_read", "/api/sales/legal", "/auth/v1/token", "https://unapproved.invalid/rest/v1/buildings"]) {
    assert.throws(() => createLocalReadTransport(approved, [candidate]));
  }
});

test("all business mutations, GET bodies and redirect following are rejected before fetch", async () => {
  let calls = 0;
  const read = createLocalReadTransport(approved, [path], async () => { calls++; return new Response("{}"); });
  for (const method of ["POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]) await assert.rejects(read(url, { method }));
  await assert.rejects(read(url, { body: "{}" }));
  await assert.rejects(read(url, { redirect: "follow" }));
  await assert.rejects(read(url, { redirect: "manual" }));
  assert.equal(calls, 0);
});

test("permitted read preserves the query, auth header and cancellation; disables caching and redirects", async () => {
  const controller = new AbortController();
  let seen;
  const read = createLocalReadTransport(approved, [path], async (target, options) => { seen = { target, options }; return new Response("[]"); });
  await read(url + "?select=id,name&limit=20", { headers: { Authorization: "Bearer synthetic-test-token" }, signal: controller.signal });
  assert.equal(seen.target.href, url + "?select=id,name&limit=20");
  assert.equal(seen.options.headers.Authorization, "Bearer synthetic-test-token");
  assert.equal(seen.options.signal, controller.signal);
  assert.equal(seen.options.redirect, "error");
  assert.equal(seen.options.cache, "no-store");
  assert.equal(seen.options.method, "GET");
});

test("unexpected redirect and origin responses fail closed", async () => {
  for (const response of [{ redirected: true, url }, { redirected: false, url: "https://unapproved.invalid/rest/v1/buildings" }]) {
    const read = createLocalReadTransport(approved, [path], async () => response);
    await assert.rejects(read(url));
  }
});

