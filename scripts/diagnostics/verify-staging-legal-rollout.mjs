import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { assessRequest, isTelemetry } from './smoke-request-policy.mjs';
const phase = process.argv[2];
assert.ok(['preview-smoke', 'staging-smoke'].includes(phase));
const root = 'artifacts/performance/2026-10-05-staging-legal-rollout-corrected';
const directory = `${root}/${phase}`;
const read = name => JSON.parse(fs.readFileSync(`${directory}/${name}.json`, 'utf8'));
const verification = read('verification'), samples = read('samples'), other = read('other-function-verification');
const source = JSON.parse(fs.readFileSync('artifacts/performance/2026-10-05-staging-legal-rollout/source-environment-verification.json', 'utf8'));
const audit = read('request-audit');
assert.equal(createHash('sha256').update(fs.readFileSync('vercel.json')).digest('hex'), source.rootFileSha256);
assert.equal(verification.completed, true);
assert.equal(verification.unchanged, true);
assert.equal(verification.guardViolations, 0);
assert.equal(verification.selectedCompletedUnit, 107);
assert.equal(verification.previewOnlyUnit, 209);
assert.equal(verification.salesMutations, 0);
assert.equal(verification.sessions.length, 2);
assert.ok(verification.sessions.every(s => s.stagingVerified));
assert.equal(verification.setupRequests.length, 0);
assert.equal(samples.length, 12);
assert.ok(samples.every(s => s.status === 'ok' && s.failures === 0 && !s.timedOut && s.regionsVerified && s.displayedStateChecked));
const requests = samples.flatMap(s => s.requests);
const legal = requests.filter(r => r.category === 'vercel-function' && r.endpoint === '/api/sales/legal');
const otherFunctions = requests.filter(r => r.category === 'vercel-function' && r.endpoint !== '/api/sales/legal' && !isTelemetry(r));
assert.equal(legal.length, 6);
assert.equal(legal.filter(r => r.method === 'POST').length, 2);
assert.ok(legal.every(r => r.status === 200 && r.executionRegion === 'fra1'));
assert.ok(otherFunctions.length >= 4 && otherFunctions.every(r => r.status === 200 && r.executionRegion === 'iad1'));
assert.equal(other.isolationPassed, true);
assert.equal(other.successfulHandlers, true);
assert.equal(other.rows.length, 6);
assert.ok(requests.every(r => !assessRequest(r).gateFailure));
assert.ok(audit.every(r => !(r.status >= 400)));
assert.ok(audit.filter(r => r.category === 'vercel-function' && r.status != null).every(r => !assessRequest(r).regionFailure));
const telemetry = audit.filter(isTelemetry);
assert.ok(telemetry.every(r => r.status === 204 || assessRequest(r).unloadAbort && r.status == null));
const aborted = audit.filter(r => r.failed).map(r => ({ requestAuditId: r.id, profile: r.profile, action: r.action,
  endpoint: r.endpoint, requestType: isTelemetry(r) ? 'web-vitals-telemetry' : r.category, metric: r.metric,
  status: r.status, failure: r.failure, unloadAssociated: r.unloadAssociated,
  classification: isTelemetry(r) ? r.status === 204 ? 'accepted-telemetry-abort' : assessRequest(r).unloadAbort ? 'unload-telemetry-unknown' : 'telemetry-transport-failure' : 'application-abort',
  unloadEvidence: r.unloadEvidence, collectorOutcome: r.collectorOutcome, executionRegion: r.executionRegion }));
const result = { verifiedAt: new Date().toISOString(), phase, passed: true, applicationCommit: source.applicationCommit,
  deploymentCommit: source.deploymentCommit, salesOpened: [107, 209], excludedTestSales: [210, 211],
  actions: samples.length, failures: 0, legalGetChecks: 4, legalPreviewPostChecks: 2, legalRegion: 'fra1',
  otherMeasuredFunctions: otherFunctions.length, otherGetChecks: other.rows.length, otherRegion: 'iad1',
  stagingEnvironmentVerified: true, displayedStatesPassed: true, saleStateUnchanged: true, rootConfigUnchanged: true,
  telemetry: { requests: telemetry.length, accepted204: telemetry.filter(r => r.status === 204).length,
    unknownNoResponse: telemetry.filter(r => r.status == null).length,
    unloadAborted: telemetry.filter(r => assessRequest(r).unloadAbort).length,
    regionUnknown: telemetry.filter(r => r.executionRegion == null).length }, abortedRequests: aborted,
  timingSamples: samples.map(s => ({ profile: s.profile, action: s.action, readyMs: s.readyMs,
    completeMs: s.lastRequestEndMs, settledRequests: s.settledRequests })),
  functionInvocations: requests.filter(r => r.category === 'vercel-function').map(({ endpoint, method, status, vercelId, executionRegion }) => ({ endpoint, method, status, vercelId, executionRegion })) };
fs.writeFileSync(`${directory}/checks.json`, JSON.stringify(result, null, 2));
console.log(JSON.stringify({ phase, passed: result.passed, actions: result.actions, legalRegion: result.legalRegion,
  otherRegion: result.otherRegion, failures: result.failures, saleStateUnchanged: result.saleStateUnchanged }));
