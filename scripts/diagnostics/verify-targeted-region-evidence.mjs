import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const out='artifacts/performance/2026-10-05-targeted-region';
const read=n=>JSON.parse(fs.readFileSync(`${out}/${n}`));
const s=read('samples.json'),v=read('verification.json'),summary=read('summary.json'),details=read('details.json'),setup=read('setup-evidence.json');
assert(v.completed&&v.unchanged);assert.equal(v.guardViolations,0);
assert.equal(v.setupRequests.filter(r=>r.type==='pageerror').length,0);
assert.equal(s.length,192);assert.equal(summary.sampleCount,192);
assert(s.every(s=>s.status==='ok'&&!s.timedOut&&s.displayedStateChecked&&s.regionsVerified));
for(const g of summary.groups){assert.equal(g.iad1.readyMs.n,8);assert.equal(g.fra1.readyMs.n,8);assert.equal(g.pairedFraMinusIadMs.n,8);}
assert.equal(summary.failures,0);assert.equal(summary.verification.missingRegion,0);assert.equal(summary.verification.mismatchedRegion,0);
for(const source of [setup.sourceA,setup.sourceB])assert.deepEqual(source.files.map(f=>f.filename),['vercel.json']);
assert.deepEqual(setup.configA.crons,setup.configB.crons);
assert.deepEqual(setup.configA.regions,['iad1']);assert.deepEqual(setup.configB.regions,['iad1']);
assert.deepEqual(setup.configB.functions,{'src/app/api/sales/legal/route.ts':{regions:['fra1']}});
assert(read('preflight.json').isolationPassed);
const other=read('other-function-verification.json');assert(other.isolationPassed&&other.successfulHandlers);assert.equal(other.rows.length,12);
assert(read('runtime-asset-verification.json').onlyDeploymentIdDiffers);
const m=read('mutation-results.json');assert(m.completed&&m.matchedLegalSnapshots&&m.protectedUnchanged);assert.equal(m.failures.length,0);assert.deepEqual(m.consumedUnits,[210,211]);assert.equal(m.samples.length,2);
assert(read('candidate-details-before.json').unusedDraftsRemainEmpty);assert(read('candidate-details-after.json').unusedDraftsRemainEmpty);
assert.equal(m.fixtureSetupRequests.length,8);assert(m.fixtureSetupRequests.every(r=>r.status===200&&r.executionRegion==='iad1'));
for(const sample of m.samples){assert(sample.displayedStateChecked&&sample.legalRegionsVerified);assert.equal(sample.status,'ok');assert.equal(sample.savedEmailState.length,1);assert(sample.savedEmailState[0].hasSentAt&&sample.savedEmailState[0].hasProviderReceipt);assert.equal(sample.requests.filter(r=>r.category==='legal'&&r.method==='POST').length,1);}
const files=['samples.json','summary.json','details.json','region-verification.json','verification.json','mutation-results.json','preflight.json','setup-evidence.json','runtime-asset-verification.json','other-function-verification.json'];
const result={verifiedAt:new Date().toISOString(),passed:true,readOnlyActionSamples:s.length,mutationSamples:m.samples.length,mutationSamplesPerRegion:1,consumedUnits:m.consumedUnits,readOnlyRegionChecks:summary.verification.measuredFunctionRequests,staticAssetsCompared:details.staticAssetsCompared,staticAssetsIdentical:details.staticAssetsIdentical,hashes:Object.fromEntries(files.map(n=>[n,createHash('sha256').update(fs.readFileSync(`${out}/${n}`)).digest('hex')]))};
fs.writeFileSync(`${out}/evidence-checks.json`,JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
