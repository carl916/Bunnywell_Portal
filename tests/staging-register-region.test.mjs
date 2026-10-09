import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { stagingRegisterConfig, prepareStagingRegisterRegion } from '../scripts/prepare-staging-register-region.mjs';

const overlay = JSON.parse(fs.readFileSync('config/vercel.staging-register-region.json', 'utf8'));
const root = JSON.parse(fs.readFileSync('vercel.json', 'utf8'));
const route = 'src/app/api/sales/register/route.ts';
test('register overlay preserves every cron, existing legal override and unrelated function option', () => {
  const base = { ...root, functions: { 'src/app/api/sales/legal/route.ts': { regions: ['fra1'] }, [route]: { maxDuration: 60 } }, headers: [{ source: '/x', headers: [] }] };
  const original = structuredClone(base), merged = stagingRegisterConfig(base, overlay);
  assert.deepEqual(base, original);
  assert.deepEqual(merged, { ...base, regions: ['iad1'], functions: { ...base.functions, [route]: { maxDuration: 60, regions: ['fra1'] } } });
  assert.deepEqual(merged.crons, root.crons);
});
test('ordinary Git deployments remain unchanged and unrelated or blanket overrides are rejected', () => {
  assert.equal(root.regions, undefined); assert.equal(root.functions?.[route], undefined);
  assert.throws(() => stagingRegisterConfig(root, { ...overlay, regions: ['fra1'] }));
  assert.throws(() => stagingRegisterConfig(root, { ...overlay, env: { SOMETHING: '1' } }));
  assert.throws(() => stagingRegisterConfig(root, { ...overlay, functions: { 'src/app/api/sales/legal/route.ts': { regions: ['fra1'] } } }));
  assert.throws(() => stagingRegisterConfig({ ...root, regions: ['lhr1'] }, overlay));
});
test('generation is staging-only, check mode is read-only, and root configuration is never overwritten', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'register-region-'));
  t.after(() => {
    assert.ok(path.resolve(directory).startsWith(path.join(path.resolve(os.tmpdir()), 'register-region-')));
    fs.rmSync(directory, { recursive: true, force: true });
  });
  fs.mkdirSync(path.join(directory, path.dirname(route)), { recursive: true }); fs.writeFileSync(path.join(directory, route), '');
  fs.mkdirSync(path.join(directory, 'config'));
  const original = JSON.stringify(root); fs.writeFileSync(path.join(directory, 'vercel.json'), original);
  fs.writeFileSync(path.join(directory, 'config/vercel.staging-register-region.json'), JSON.stringify(overlay));
  execFileSync('git', ['init', '-b', 'main', directory], { stdio: 'ignore' });
  prepareStagingRegisterRegion(directory, { check: true }); assert.equal(fs.existsSync(path.join(directory, '.vercel')), false);
  assert.throws(() => prepareStagingRegisterRegion(directory), /staging branch only/);
  execFileSync('git', ['symbolic-ref', 'HEAD', 'refs/heads/staging'], { cwd: directory });
  const previousEnvironment = process.env.VERCEL_ENV;
  process.env.VERCEL_ENV = 'production';
  try { assert.throws(() => prepareStagingRegisterRegion(directory), /outside production/); }
  finally { if (previousEnvironment === undefined) delete process.env.VERCEL_ENV; else process.env.VERCEL_ENV = previousEnvironment; }
  prepareStagingRegisterRegion(directory);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(directory, '.vercel/staging-register-region.json'), 'utf8')), stagingRegisterConfig(root, overlay));
  assert.equal(fs.readFileSync(path.join(directory, 'vercel.json'), 'utf8'), original);
});
