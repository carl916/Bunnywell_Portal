import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessRequest } from './smoke-request-policy.mjs';
const telemetry = { category: 'vercel-function', endpoint: '/api/performance/vitals', method: 'POST', failed: true,
  failure: 'net::ERR_ABORTED', unloadAssociated: true, status: null, executionRegion: null };
test('unload telemetry without response is unknown, not successful or region-verified', () => {
  const p = assessRequest(telemetry); assert.equal(p.gateFailure, false); assert.equal(p.collectorOutcome, 'unknown'); assert.equal(p.regionUnknown, true);
});
test('received 204 is acceptance, while observed region remains mandatory', () => {
  const p = assessRequest({ ...telemetry, status: 204, executionRegion: 'iad1' }); assert.equal(p.collectorOutcome, 'accepted'); assert.equal(p.gateFailure, false);
  assert.equal(assessRequest({ ...telemetry, status: 204, executionRegion: 'fra1' }).gateFailure, true);
  assert.equal(assessRequest({ ...telemetry, status: 204, executionRegion: null }).gateFailure, true);
  assert.equal(assessRequest({ ...telemetry, status: 204, executionRegion: 'iad1', unloadAssociated: false }).gateFailure, false);
});
test('abort without unload evidence and other transport errors fail', () => {
  assert.equal(assessRequest({ ...telemetry, unloadAssociated: false }).gateFailure, true);
  assert.equal(assessRequest({ ...telemetry, failure: 'net::ERR_FAILED' }).gateFailure, true);
});
test('HTTP errors still fail, including unload-aborted telemetry', () => {
  assert.equal(assessRequest({ ...telemetry, status: 500, executionRegion: 'iad1' }).gateFailure, true);
});
test('legal and application aborts are never exempt', () => {
  assert.equal(assessRequest({ ...telemetry, endpoint: '/api/sales/legal' }).gateFailure, true);
  assert.equal(assessRequest({ ...telemetry, category: 'browser-supabase-data', endpoint: 'profiles' }).gateFailure, true);
});
test('successful functions require the actual correct region', () => {
  const legal = { category: 'vercel-function', endpoint: '/api/sales/legal', method: 'GET', status: 200, failed: false };
  assert.equal(assessRequest({ ...legal, executionRegion: 'fra1' }).gateFailure, false);
  assert.equal(assessRequest({ ...legal, executionRegion: 'iad1' }).gateFailure, true);
  assert.equal(assessRequest(legal).gateFailure, true);
});
