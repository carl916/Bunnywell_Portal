// Explicit synthetic staging fixtures only. No emails or legal completion are sent.
// Review uses the existing admin account; developer role restrictions are covered
// by the PostgreSQL and browser fixture tests. Tokens remain in memory.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import dotenv from 'dotenv';
import { chromium, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { jsPDF } from 'jspdf';

dotenv.config({ path: '.env.local', quiet: true });
const env = process.env, origin = env.REVIEW_TEST_ORIGIN;
const project = 'vxkpvdtrldwwqiddoyof';
if (env.REVIEW_TEST_STAGING !== '1' || new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname !== `${project}.supabase.co`) throw Error('Explicit staging opt-in required.');
if (!origin || !/^https:\/\/bunnywell-portal-[a-z0-9]+-carl-gilbert-s-projects\.vercel\.app$/.test(origin)) throw Error('Use the reviewed branch preview.');
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const { data: building, error: buildingError } = await admin.from('buildings').select('id').eq('name', 'E2E Completion Upload 2026-09-22').single();
if (buildingError || !building) throw Error('Dedicated completion test building missing.');
const { data: units, error: unitsError } = await admin.from('units').select('id,unit_number').eq('building_id', building.id).in('unit_number', ['UPLOAD-1', 'UPLOAD-2']);
if (unitsError || units?.length !== 2) throw Error('Dedicated completion test units missing.');
const { data: sales, error: salesError } = await admin.from('unit_sale_attempts').select('id,unit_id,workflow_status').in('unit_id', units.map(unit => unit.id)).eq('is_active', true);
if (salesError || sales?.length !== 2 || sales.some(sale => sale.workflow_status === 'completed')) throw Error('Expected two active synthetic completion sales.');
const statementType = 'completion_statement', accountType = 'draft_statement_of_account';
const out = 'test-results/completion-document-review-staging';
fs.mkdirSync(out, { recursive: true });
const checks = [], screenshots = [], runId = new Date().toISOString().replace(/[:.]/g, '-');
const save = () => fs.writeFileSync(`${out}/results.json`, JSON.stringify({ origin, project, reviewerRole: 'admin', runId, checks, screenshots }, null, 2));
function pass(journey, detail) { checks.push({ journey, detail, passed: true }); save(); console.log(`${journey}: ${detail}`); }
function pdf(name) { const file = new jsPDF(); file.text('SYNTHETIC COMPLETION REVIEW TEST - NOT A LEGAL DOCUMENT', 10, 20); return { name, mimeType: 'application/pdf', buffer: Buffer.from(file.output('arraybuffer')) }; }
async function state(saleId) {
  const result = await admin.from('unit_sale_documents').select('*,unit_sale_document_versions!unit_sale_document_versions_document_id_fkey(*)').eq('sale_attempt_id', saleId).in('document_type', [statementType, accountType]).is('redacted_at', null).is('superseded_at', null);
  if (result.error) throw Error('Could not read synthetic document state.');
  return Object.fromEntries(result.data.map(document => [document.document_type, { ...document, current: document.unit_sale_document_versions.find(version => version.is_current && !version.redacted_at) }]));
}
const browser = await chromium.launch({ headless: true });
let conveyancer, reviewer;
try {
  for (const [role, email] of [['conveyancer', 'carl@accoladeproperties.co.uk'], ['reviewer', env.PLAYWRIGHT_ADMIN_EMAIL]]) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1050 } });
    const page = await context.newPage(); page.setDefaultTimeout(30000);
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.hostname.endsWith('.supabase.co') && !url.hostname.startsWith(`${project}.`)) throw Error('Wrong backend.');
      await route.continue();
    });
    await page.goto(origin);
    await page.getByLabel('Email', { exact: true }).fill(email);
    await page.getByLabel('Password', { exact: true }).fill(env.PLAYWRIGHT_ADMIN_PASSWORD);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.getByRole('button', { name: 'Sign out', exact: true }).waitFor();
    if (role === 'conveyancer') conveyancer = page; else reviewer = page;
  }
  async function visit(page, unit) {
    await page.goto(`${origin}/?screen=sales&building=${building.id}&salesUnitId=${unit.id}`);
    await page.getByRole('button', { name: /^Completion\b/ }).click();
    await expect(page.locator('#completion-documents-step').getByRole('article')).toHaveCount(2);
    await expect(page.locator('#completion-approval-step').locator('article,button,input,textarea')).toHaveCount(0);
  }
  const docs = page => page.locator('#completion-documents-step');
  const card = (page, type) => docs(page).getByRole('article', { name: type === statementType ? 'Completion statement' : 'Statement of account', exact: true });
  const completionInput = page => page.getByLabel('Actual legal completion date and time (your local time)');
  async function shot(page, name) { const path = `${out}/${name}.png`; await docs(page).screenshot({ path }); screenshots.push(path); save(); }
  async function upload(page, files) {
    for (const [type, name] of files) await card(page, type).locator('input[type="file"]').setInputFiles(pdf(name));
    const response = page.waitForResponse(response => response.url() === `${origin}/api/sales/legal` && response.request().method() === 'POST' && response.request().postDataJSON().action === 'finalize_completion_upload', { timeout: 90000 });
    await docs(page).getByRole('button', { name: /^Upload (completion documents|replacement document)$/ }).click();
    const saved = await response;
    assert.equal(saved.status(), 200, `Upload finalisation failed: ${JSON.stringify(await saved.json())}`);
    await expect(docs(page).locator('[role="group"][aria-label^="Selected "]')).toHaveCount(0, { timeout: 30000 });
  }
  async function approve(page, type) {
    await card(page, type).getByRole('button', { name: 'Approve', exact: true }).click();
    await expect(card(page, type).getByText('Approved', { exact: true })).toBeVisible();
    await expect(card(page, type).getByRole('button', { name: /^(Approve|Raise query)$/ })).toHaveCount(0);
  }
  async function query(page, type, reason) {
    await card(page, type).getByRole('button', { name: 'Raise query', exact: true }).click();
    await expect(card(page, type).getByRole('button', { name: 'Submit query' })).toBeDisabled();
    await card(page, type).getByLabel('Query / rejection reason').fill(reason);
    await card(page, type).getByRole('button', { name: 'Submit query' }).click();
    await expect(card(page, type).getByText(`Query raised: ${reason}`, { exact: true })).toBeVisible();
    await expect(card(page, type).getByText(/^Raised by .+ · /)).toBeVisible();
    await expect(docs(page).locator('textarea')).toHaveCount(0);
    await expect(docs(page).getByRole('button', { name: 'Submit query' })).toHaveCount(0);
  }

  if (env.REVIEW_TEST_JOURNEY !== 'mixed') {
    const unit = units.find(unit => unit.unit_number === 'UPLOAD-1'), sale = sales.find(sale => sale.unit_id === unit.id);
    const initial = await state(sale.id);
    if (Object.values(initial).some(document => document.status === 'approved')) throw Error('Journey A already approved; use REVIEW_TEST_JOURNEY=mixed to continue the other fixture.');
    await visit(conveyancer, unit);
    await upload(conveyancer, [[statementType, 'review-a-statement.pdf'], [accountType, 'review-a-account.pdf']]);
    await expect(completionInput(conveyancer)).toHaveCount(0);
    await visit(reviewer, unit); await approve(reviewer, statementType); await approve(reviewer, accountType);
    await expect(reviewer.locator('#completion-approval-step')).toContainText('✓ Completion documents approved');
    await visit(conveyancer, unit); await expect(docs(conveyancer).locator('input[type="file"]')).toHaveCount(0); await expect(completionInput(conveyancer)).toBeVisible();
    const current = await state(sale.id);
    for (const type of [statementType, accountType]) { assert.equal(current[type].status, 'approved'); assert.equal(current[type].approved_version_id, current[type].current.id); assert.ok(current[type].approved_at); assert.ok(current[type].approved_by_user_id); }
    await shot(conveyancer, 'a-both-approved-locked'); pass('A', 'Both uploaded versions individually approved, cards locked, legal completion available.');
  }

  const unit = units.find(unit => unit.unit_number === 'UPLOAD-2'), sale = sales.find(sale => sale.unit_id === unit.id);
  const before = await state(sale.id);
  if (Object.values(before).some(document => document.status === 'approved')) throw Error('Mixed fixture already approved; inspect saved results before repeating.');
  await visit(conveyancer, unit); await upload(conveyancer, [[statementType, 'review-b-statement.pdf'], [accountType, 'review-b-account.pdf']]);
  const uploaded = await state(sale.id);
  await visit(reviewer, unit); await query(reviewer, statementType, 'Synthetic check: missing service charge');
  await expect(card(reviewer, accountType).getByText('Awaiting approval', { exact: true })).toBeVisible();
  const queried = await state(sale.id); assert.equal(queried[statementType].status, 'query_raised'); assert.deepEqual(queried[accountType], uploaded[accountType]);
  await shot(reviewer, 'b-single-query'); pass('B', 'Statement queried alone, account still awaiting approval, submitted query controls cleared.');

  await visit(conveyancer, unit); await upload(conveyancer, [[statementType, 'review-c-replacement.pdf']]);
  const replaced = await state(sale.id); assert.equal(replaced[statementType].status, 'uploaded'); assert.equal(replaced[statementType].query_note, null); assert.notEqual(replaced[statementType].current.id, uploaded[statementType].current.id); assert.deepEqual(replaced[accountType], uploaded[accountType]);
  const old = replaced[statementType].unit_sale_document_versions.find(version => version.id === uploaded[statementType].current.id); assert.ok(old); assert.equal(old.is_current, false);
  await expect(card(conveyancer, statementType).getByText('Query raised: Synthetic check: missing service charge')).not.toBeVisible();
  await card(conveyancer, statementType).locator('summary').click(); await expect(card(conveyancer, statementType).getByText('Query raised: Synthetic check: missing service charge')).toBeVisible();
  const events = await admin.from('unit_sale_workflow_events').select('metadata,created_by_user_id,created_at,actor_name').eq('sale_attempt_id', sale.id).eq('event_type', 'completion_documents_query_raised'); if (events.error) throw Error('Could not verify query audit.');
  const event = events.data.find(event => event.metadata?.versionId === uploaded[statementType].current.id && event.metadata?.queryNote === 'Synthetic check: missing service charge'); assert.ok(event?.created_at && event.created_by_user_id && event.actor_name);
  await shot(conveyancer, 'c-query-in-version-history'); pass('C', 'Replacement awaits approval; old version/query/actor/time preserved in history only.');

  await upload(conveyancer, [[statementType, 'review-d-unqueried-replacement.pdf']]);
  const unqueried = await state(sale.id); assert.equal(unqueried[statementType].status, 'uploaded'); assert.equal(unqueried[statementType].query_note, null); assert.notEqual(unqueried[statementType].current.id, replaced[statementType].current.id);
  pass('D', 'Awaiting-approval document replaced successfully without a query.');

  await visit(reviewer, unit); await approve(reviewer, accountType); await expect(card(reviewer, statementType).getByRole('button', { name: 'Approve', exact: true })).toBeVisible(); await expect(reviewer.locator('#completion-approval-step')).toContainText('1 of 2');
  await visit(conveyancer, unit); await expect(card(conveyancer, accountType).locator('input[type="file"]')).toHaveCount(0); await expect(card(conveyancer, statementType).locator('input[type="file"]')).toHaveCount(1); await expect(completionInput(conveyancer)).toHaveCount(0);
  const partial = await state(sale.id); pass('E', 'Only account approved and locked; statement actionable and legal completion locked.');

  await visit(reviewer, unit); await query(reviewer, statementType, 'Synthetic check: final balance'); assert.deepEqual((await state(sale.id))[accountType], partial[accountType]);
  await visit(conveyancer, unit); await upload(conveyancer, [[statementType, 'review-f-final-statement.pdf']]); assert.deepEqual((await state(sale.id))[accountType], partial[accountType]);
  await expect(completionInput(conveyancer)).toHaveCount(0); await shot(conveyancer, 'f-independent-account-approval');
  pass('F', 'Querying and replacing the statement preserved the account version, approval actor and timestamp.');
  await visit(reviewer, unit); await approve(reviewer, statementType); await visit(conveyancer, unit); await expect(completionInput(conveyancer)).toBeVisible(); await expect(docs(conveyancer).locator('input[type="file"]')).toHaveCount(0);
  await shot(conveyancer, 'mixed-journey-final-locked');
  pass('Final', 'Both synthetic sales retain full history; no legal completion was recorded.');
} catch (error) {
  save(); console.error(error instanceof Error ? error.message : 'Verification failed.'); process.exitCode = 1;
} finally { await browser.close(); }
