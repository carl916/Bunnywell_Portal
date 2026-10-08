import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, building, sale } from './helpers/dashboard-fixture.mjs';
import { loadTypescriptModule } from './helpers/load-typescript-module.mjs';
import { reservationRouteFixture } from './helpers/reservation-route-fixture.mjs';
import { legalDatabase } from './helpers/legal-database.mjs';
const { deriveDashboard } = loadTypescriptModule('src/lib/dashboard/model.ts');
const { deriveSalesRegister } = loadTypescriptModule('src/lib/sales/register.ts');

test('seller organisation comes from building contacts, not sale allocation or buyer solicitor; equivalent accounts agree', () => {
  const f = fixture({ sales: [{ ...sale, conveyancer_organisation_id: 'wrong', buyer_solicitor_name: 'Buyer Solicitors Ltd' }] });
  for (const id of ['individual-a', 'individual-b', 'shared-account', 'shared-account']) {
    f.viewer = { id, role: 'conveyancer', organisation_id: 'legal-org' };
    const items = deriveDashboard(f).items.filter(item => item.responsibility.kind === 'conveyancer');
    assert.ok(items.length); assert.ok(items.every(item => item.ours && item.responsibility.label === 'Synthetic Legal Team'));
    assert.ok(deriveSalesRegister(f).rows[0].actions.every(item => item.party.organisationId === 'legal-org'));
  }
  f.viewer.organisation_id = 'other'; assert.ok(deriveDashboard(f).items.every(item => !item.ours));
});
test('missing and unresolved configured organisations stay unallocated even with sale/relationship allocations', () => {
  for (const id of [null, 'missing']) {
    const f = fixture({ buildings: [{ ...building, conveyancer_organisation_id: id }], buildingOrganisations: [{ building_id: building.id, organisation_id: 'legal-org', role_on_project: 'conveyancer' }] });
    const items = deriveDashboard(f).items.filter(item => item.responsibility.kind === 'conveyancer');
    assert.ok(items.every(item => item.responsibility.organisationId === null && !item.ours));
    assert.match(items[0].responsibility.label, id ? /configuration unresolved/ : /not configured/);
  }
});
function setup(role = 'sales_agent') {
  const profile = { id: 'agent', role, organisation_id: 'agent-org', active: true };
  const rows = { profiles: [profile], units: [{ id: 'unit', unit_number: 'G08', building_id: 'building', sale_status: 'for_sale' }], user_building_access: [{ user_id: profile.id, building_id: 'building' }], unit_sale_attempts: [], unit_sale_documents: [], unit_sale_document_versions: [], building_sale_defaults: [] };
  return { rows, profile, ...reservationRouteFixture(rows, profile) };
}
const fields = { unitId: 'unit', buyerPersonName: 'Synthetic Buyer', buyerEmail: 'buyer@example.test', buyerPhone: '07000000000', buyerSolicitorName: 'Buyer Solicitors Ltd', reservationDate: '2026-08-01', reservationTermsChecked: true };
test('real handler saves incomplete drafts, enforces submission fields and PDF, returns/resubmits/approves without replacing history', async () => {
  const f = setup();
  const historical = { id: 'old', unit_id: 'unit', is_active: false, workflow_status: 'fallen_through', attempt_number: 1, buyer_name: 'Previous Buyer' };
  f.rows.unit_sale_attempts.push(historical);
  let response = await f.post({ action: 'save_reservation_draft', unitId: 'unit', buyerPersonName: fields.buyerPersonName }); assert.equal(response.status, 200);
  const { saleAttemptId } = await response.json(); const active = f.rows.unit_sale_attempts.find(row => row.id === saleAttemptId);
  assert.equal(active.workflow_status, 'draft'); assert.equal(active.attempt_number, 2); assert.equal(active.reservation_submitted_at, undefined);
  assert.equal((await f.post({ action: 'save_reservation', unitId: 'unit', buyerPersonName: fields.buyerPersonName })).status, 400);
  response = await f.post({ ...fields, action: 'save_reservation' }); assert.equal(response.status, 400); assert.match((await response.json()).error, /PDF/);
  const upload = new FormData(); upload.set('saleAttemptId', saleAttemptId); upload.set('file', new File(['%PDF-1.4\nsynthetic'], 'reservation.pdf', { type: 'application/pdf' }));
  assert.equal((await f.post(upload)).status, 200); assert.equal(f.uploads.length, 1);
  assert.equal((await f.post({ ...fields, action: 'save_reservation' })).status, 200); assert.equal(active.workflow_status, 'awaiting_approval');
  assert.equal((await f.post({ action: 'approve_reservation', saleAttemptId })).status, 400);
  f.profile.role = 'developer';
  assert.equal((await f.post({ action: 'reject_reservation', saleAttemptId, rejectionReason: 'Correct buyer name' })).status, 200);
  f.profile.role = 'sales_agent';
  assert.equal((await f.post({ ...fields, action: 'save_reservation_draft', buyerPersonName: 'Corrected Buyer' })).status, 200);
  assert.equal(active.workflow_status, 'rejected'); assert.equal(active.reservation_rejection_reason, 'Correct buyer name');
  assert.equal((await f.post({ ...fields, action: 'save_reservation', buyerPersonName: 'Corrected Buyer' })).status, 200);
  f.profile.role = 'developer'; assert.equal((await f.post({ action: 'approve_reservation', saleAttemptId })).status, 200);
  assert.equal(active.workflow_status, 'approved'); assert.equal(f.rows.units[0].sale_status, 'reserved'); assert.equal(f.rows.unit_sale_attempts.length, 2); assert.deepEqual(f.rows.unit_sale_attempts[0], historical);
  assert.deepEqual(f.rows.unit_sale_workflow_events.map(row => row.event_type), ['reservation_draft_saved', 'reservation_submitted', 'reservation_rejected', 'reservation_draft_saved', 'reservation_resubmitted', 'reservation_approved']);
});
test('contacts never grant access; conveyancers cannot save/upload/approve; ineligible units and stale attempts reject', async () => {
  const f = setup('conveyancer');
  for (const action of ['save_reservation_draft', 'save_reservation', 'approve_reservation']) assert.equal((await f.post({ ...fields, action, saleAttemptId: 'sale' })).status, 400);
  const upload = new FormData(); upload.set('saleAttemptId', 'sale'); upload.set('file', new File(['%PDF-1.4'], 'test.pdf', { type: 'application/pdf' }));
  assert.equal((await f.post(upload)).status, 400); assert.equal(f.uploads.length, 0);
  assert.equal(f.writes.length, 0);
  f.profile.role = 'sales_agent'; f.rows.user_building_access = []; f.rows.buildings = [{ id: 'building', sales_agent_organisation_id: 'agent-org' }];
  assert.match(await (await f.post({ ...fields, action: 'save_reservation_draft' })).text(), /do not have sales access/);
  f.rows.user_building_access = [{ user_id: 'agent', building_id: 'building' }]; f.rows.units[0].sale_status = 'not_for_sale';
  assert.equal((await f.post({ ...fields, action: 'save_reservation_draft' })).status, 400);
  f.rows.units[0].sale_status = 'for_sale'; assert.equal((await f.post({ ...fields, action: 'save_reservation_draft', saleAttemptId: 'old' })).status, 400);
  assert.equal(f.writes.length, 0);
});

test('submission rejects incomplete fields and redacted, superseded or non-current PDFs', async () => {
  const f = setup(); const { saleAttemptId } = await (await f.post({ ...fields, action: 'save_reservation_draft' })).json();
  for (const key of ['buyerPersonName', 'buyerEmail', 'buyerPhone', 'buyerSolicitorName', 'reservationDate', 'reservationTermsChecked']) {
    assert.equal((await f.post({ ...fields, [key]: key === 'reservationTermsChecked' ? false : '', action: 'save_reservation' })).status, 400, key);
  }
  const doc = { id: 'doc', sale_attempt_id: saleAttemptId, document_type: 'reservation_form' };
  const version = { id: 'version', document_id: 'doc', is_current: true };
  for (const [d, v] of [[{ ...doc, redacted_at: '2026-01-01' }, version], [{ ...doc, superseded_at: '2026-01-01' }, version], [doc, { ...version, redacted_at: '2026-01-01' }], [doc, { ...version, is_current: false }]]) {
    f.rows.unit_sale_documents = [d]; f.rows.unit_sale_document_versions = [v];
    assert.match(await (await f.post({ ...fields, action: 'save_reservation' })).text(), /PDF/);
    assert.equal(f.rows.unit_sale_attempts[0].workflow_status, 'draft');
  }
});
test('draft save refuses an approval-state change between read and write', async () => {
  const f = setup(); await f.post({ ...fields, action: 'save_reservation_draft' });
  f.beforeWrite((table, rows) => { assert.equal(table, 'unit_sale_attempts'); rows[table][0].workflow_status = 'awaiting_approval'; });
  assert.equal((await f.post({ ...fields, action: 'save_reservation_draft', buyerPersonName: 'Stale edit' })).status, 400);
  assert.equal(f.rows.unit_sale_attempts[0].buyer_name, fields.buyerPersonName);
});

test('PostgreSQL contact configuration does not grant building or sale access', async t => {
  const f = await legalDatabase(); t.after(() => f.db.close()); await f.owner();
  await f.db.query("update profiles set role='conveyancer',organisation_id=$1 where id=$2", [f.solicitorOrg, f.ids.outsider]);
  await f.db.query('delete from user_building_access where user_id=$1', [f.ids.outsider]);
  await f.as('outsider');
  assert.equal((await f.db.query('select * from unit_sale_attempts where id=$1', [f.ids.sale])).rows.length, 0);
  await assert.rejects(f.snapshot('outsider'), /access|permission|authoris/i);
  await f.owner(); await f.db.query('insert into user_building_access values($1,$2)', [f.ids.outsider, f.ids.building]);
  await f.as('outsider'); assert.equal((await f.db.query('select * from unit_sale_attempts where id=$1', [f.ids.sale])).rows.length, 1);
});
