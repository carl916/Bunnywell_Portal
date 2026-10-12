import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTypescriptModule } from './helpers/load-typescript-module.mjs';
import { fixture, building, sale, unit, document, NOW } from './helpers/dashboard-fixture.mjs';

const { deriveDashboard } = loadTypescriptModule('src/lib/dashboard/model.ts');
const { deriveInternalOverview, datesToReview } = loadTypescriptModule('src/lib/dashboard/overview.ts');
const { deriveDeveloperSalesRows, selectDeveloperSalesRows, INITIAL_SALES_OVERVIEW } = loadTypescriptModule('src/lib/sales/developer-overview.ts');
const { buildingSalesResponsibility, conflictingSaleAssignments } = loadTypescriptModule('src/lib/sales/responsibility.ts');
const { deriveFeePortfolio, feePortfolioFromSales, readAgentFeePortfolio } = loadTypescriptModule('src/lib/sales/fee-portfolio-data.ts');
const { feeActions } = loadTypescriptModule('src/lib/sales/fee-workspace.ts');
const { isUnallocatedWork, matchesWorkTeam } = loadTypescriptModule('src/lib/dashboard/work-classification.ts');
const { deriveSalesRegister } = loadTypescriptModule('src/lib/sales/register.ts');
const { todayDate, tenancyState } = loadTypescriptModule('src/lib/rentals/tenancies.ts');
const { londonDate, deadlineState } = loadTypescriptModule('src/lib/dashboard/dates.ts');

const fees = (overrides = {}) => ({ sale_attempt_id: sale.id, building_id: building.id, building_name: building.name,
  unit_id: unit.id, unit_number: unit.unit_number, unit_sale_status: 'exchanged', workflow_status: 'exchanged',
  contract_price: 100000, exchange_fee_percent: 1, completion_fee_percent: 1, vat_rate: 20,
  exchange_invoice: null, completion_invoice: null, exchange_active_payments: [], completion_active_payments: [], ...overrides });
const invoice = (overrides = {}) => ({ id: 'invoice', status: 'approved', expected_payable_amount: 1200,
  approved_at: '2026-10-01T12:00:00Z', ...overrides });
const portfolio = records => deriveFeePortfolio(records, [building], fixture().organisations);
const overview = input => { const snapshot = deriveDashboard(input); return { snapshot, ...deriveInternalOverview(input, snapshot) }; };

test('building appointments own blank and conflicting attempts; people are actors, not task owners', () => {
  for (const role of ['sales_agent', 'conveyancer']) {
    const organisation_id = role === 'sales_agent' ? 'agent-org' : 'legal-org';
    const f = fixture({ viewer: { id: 'amy', role, organisation_id }, sales: [{ ...sale,
      workflow_status: role === 'sales_agent' ? 'draft' : sale.workflow_status,
      exchanged_at: role === 'sales_agent' ? null : sale.exchanged_at,
      sales_agent_organisation_id: null, conveyancer_organisation_id: null }] });
    const kind = role === 'sales_agent' ? 'reservation_prepare' : 'missing_completion_statement';
    const owned = deriveDashboard(f).items.find(item => item.kind === kind);
    assert.equal(owned.responsibility.organisationId, organisation_id);
    assert.equal(owned.ours, true); assert.equal(owned.canAct, true);
    f.viewer.id = 'colleague'; assert.deepEqual(deriveDashboard(f).items.find(item => item.kind === kind), owned);
    f.sales[0][`${role}_organisation_id`] = 'legacy-other';
    assert.deepEqual(deriveDashboard(f).items.find(item => item.kind === kind), owned);
    assert.ok(conflictingSaleAssignments(f.sales[0], building).includes(`${role}_organisation_id`));
    f.viewer.organisation_id = 'unrelated';
    const unrelated = deriveDashboard(f).items.find(item => item.kind === kind);
    assert.equal(unrelated.ours, false); assert.equal(unrelated.canAct, false);
    f.viewer = { id: 'developer', role: 'developer', organisation_id: 'dev-org' };
    assert.equal(deriveDashboard(f).items.find(item => item.kind === kind).ours, false);
  }
});

test('missing appointments are Unallocated; missing reads are unavailable; unresolved names retain known ownership', () => {
  const f = fixture({ buildings: [{ ...building, conveyancer_organisation_id: null }], documents: [document('completion_statement')] });
  let result = overview(f), row = result.attention.find(row => row.key === 'sales');
  assert.equal(row.ours.value, 1); assert.equal(row.others.value, 0); assert.equal(row.unallocated.value, 1);
  assert.ok(result.snapshot.items.some(isUnallocatedWork));
  delete f.buildings[0].conveyancer_organisation_id;
  result = overview(f); row = result.attention.find(row => row.key === 'sales');
  assert.equal(row.unallocated.value, null); assert.equal(row.others.value, null);
  assert.equal(deriveSalesRegister(f).actionsAvailable, false);
  assert.equal(result.snapshot.items.some(isUnallocatedWork), false);
  assert.equal(result.snapshot.sources.find(s => s.key === 'appointments').state, 'unavailable');
  assert.equal(buildingSalesResponsibility(building, 'conveyancer', []).organisationId, 'legal-org');
});

test('All buildings resolves each appointment independently and preserves internal approval responsibility', () => {
  const second = { ...building, id: 'b2', sales_agent_organisation_id: 'agent2', conveyancer_organisation_id: 'legal2' };
  const f = fixture({ buildings: [building, second], units: [unit, { ...unit, id: 'u2', building_id: 'b2' }],
    sales: [{ ...sale, workflow_status: 'draft', exchanged_at: null }, { ...sale, id: 's2', unit_id: 'u2', building_id: 'b2', workflow_status: 'draft', exchanged_at: null }],
    viewer: { id: 'amy', role: 'sales_agent', organisation_id: 'agent-org' } });
  const actions = deriveDashboard(f).items.filter(i => i.kind === 'reservation_prepare');
  assert.deepEqual(actions.map(i => [i.buildingId, i.responsibility.organisationId, i.ours]), [[building.id, 'agent-org', true], ['b2', 'agent2', false]]);
  f.sales[0].workflow_status = 'reservation_submitted';
  const approval = deriveDashboard(f).items.find(i => i.kind === 'reservation_review');
  assert.equal(approval.responsibility.kind, 'developer'); assert.equal(approval.ours, false); assert.equal(approval.canAct, false);
});

test('full fee portfolio counts distinct eligible historical attempts without expanding Sales unit work', () => {
  const active = fees({ exchange_invoice: invoice() });
  const historical = fees({ sale_attempt_id: 'historical', workflow_status: 'fallen_through', exchange_invoice: invoice({ id: 'historical-invoice' }), completion_invoice: invoice({ id: 'historical-completion' }) });
  const settled = fees({ sale_attempt_id: 'settled', exchange_invoice: invoice(), completion_invoice: invoice({ id: 'paid-completion' }), exchange_active_payments: [{ payer_type: 'developer', amount: 1200, payment_source: 'bank_transfer' }], completion_active_payments: [{ payer_type: 'developer', amount: 1200, payment_source: 'bank_transfer' }] });
  const f = fixture({ feePortfolio: portfolio([active, historical, settled]) });
  const result = overview(f), feesRow = result.attention.find(r => r.key === 'fees');
  assert.equal(feesRow.ours.value, 2); assert.equal(feesRow.others.value, 1); assert.equal(feesRow.ours.unit, 'sale attempts');
  assert.equal(feesRow.ours.href, undefined); assert.equal(feesRow.others.href, undefined);
  const rows = deriveDeveloperSalesRows(f, result.snapshot); assert.equal(rows.length, 1);
  assert.ok(rows[0].work.every(item => !['sale:historical', 'sale:settled'].includes(item.recordKey)));
  for (const team of ['ours', 'others']) assert.equal(result.attention[0][team].value, selectDeveloperSalesRows(rows, { ...INITIAL_SALES_OVERVIEW, work: team }, NOW).length);
  assert.equal(new Set(result.snapshot.items.filter(i => i.kind.startsWith('fee_') && matchesWorkTeam(i, 'ours')).map(i => i.recordKey)).size, 2);
});

test('outside-pipeline draft work remains separate without linking to the hidden Units screen', () => {
  const f = fixture({ units: [{ ...unit, sale_status: 'not_released' }], sales: [{ ...sale, workflow_status: 'draft', exchanged_at: null }] });
  const result = overview(f);
  assert.equal(result.sales.reduce((sum, stage) => sum + stage.value, 0), 0);
  const draft = result.additional.find(item => item.key.startsWith('sales-outside-pipeline:'));
  assert.equal(draft.count, 1);
  assert.equal(draft.href, undefined);
  assert.ok(draft.detail.includes(building.name));
  assert.ok(draft.detail.includes(unit.unit_number));
  assert.match(draft.detail, /navigation is unavailable/);
});

test('canonical payment actions exclude nonpositive balances and retain partial, voided and reservation-credit rules', () => {
  for (const balance of [0, -25]) {
    const row = portfolio([fees({ exchange_invoice: invoice({ expected_payable_amount: balance }) })])[0];
    assert.equal(feeActions(row).some(a => a.category === 'payment-position'), false);
  }
  const row = portfolio([fees({ exchange_invoice: invoice(), exchange_active_payments: [
    { payer_type: 'developer', amount: 200, payment_source: 'bank_transfer' }, { payer_type: 'developer', amount: 500, payment_source: 'reservation_fee' },
    { payer_type: 'developer', amount: 900, payment_source: 'bank_transfer', voided_at: '2026-10-01' },
  ] })])[0];
  assert.equal(row.exchange.outstandingBalance, 1000); assert.equal(row.exchange.kind, 'part_paid');
  const actions = feeActions(row); assert.equal(actions[0].owner, 'developer'); assert.equal(actions[1].owner, 'agent');
});

test('Sales adapter matches invoice exclusions, latest terms fallback, and rejects missing required terms', () => {
  const f = fixture();
  f.terms = [{ sale_attempt_id: sale.id, is_current: false, version_number: 1, contract_price: 100000, exchange_agent_fee_percent: 0, completion_agent_fee_percent: 0, vat_rate: 20 },
    { sale_attempt_id: sale.id, is_current: false, version_number: 2, contract_price: 100000, exchange_agent_fee_percent: 1, completion_agent_fee_percent: 0, vat_rate: 20 }];
  f.invoices = [invoice({ sale_attempt_id: sale.id, invoice_type: 'sales_agent', fee_milestone: 'exchange', status: 'redacted', created_at: '2026-10-01' })];
  assert.equal(feePortfolioFromSales(f)[0].exchange.kind, 'not_submitted');
  assert.equal(feeActions(feePortfolioFromSales(f)[0])[0].category, 'invoice-submission');
  f.terms[0].is_current = true; assert.equal(feeActions(feePortfolioFromSales(f)[0]).length, 0);
  f.invoices[0].status = 'superseded'; assert.equal(feeActions(feePortfolioFromSales(f)[0]).length, 0);
  f.invoices[0].status = 'approved'; f.invoices[0].invoice_type = 'other'; assert.equal(feeActions(feePortfolioFromSales(f)[0]).length, 0);
  f.terms = [];
  assert.throws(() => feePortfolioFromSales(f), /incomplete/);
  const result = overview(f); assert.equal(result.attention.find(r => r.key === 'fees').ours.value, null);
  assert.equal(result.attention[0].ours.value, null);
  assert.ok(result.snapshot.items.some(i => i.kind === 'missing_completion_statement'), 'valid legal information survives');
});

test('failed and incomplete fee reads never turn into an empty portfolio; genuine empty data does', async () => {
  const call = response => readAgentFeePortfolio({ rpc: async (name, args, options) => {
    assert.equal(name, 'get_agent_fee_portfolio'); assert.deepEqual(args, { p_requester_id: 'developer' }); assert.deepEqual(options, { count: 'exact' }); return response;
  } }, 'developer', [building], []);
  assert.deepEqual(await call({ data: [], count: 0 }), []);
  for (const response of [{ data: [], count: null }, { data: [fees()], count: 2 }, { data: [fees(), fees()], count: 2 },
    { data: [fees({ exchange_active_payments: [{ amount: 50, payer_type: 'developer' }] })], count: 1 },
    { data: [fees({ vat_rate: null })], count: 1 }, { data: [fees({ exchange_active_payments: null })], count: 1 },
    { data: null, error: new Error('denied') }]) await assert.rejects(call(response));
});

test('Rental date classification shares London reporting date at BST midnight and both transitions', () => {
  for (const [instant, expected] of [['2026-07-01T23:30:00Z', '2026-07-02'], ['2026-03-29T23:30:00Z', '2026-03-30'], ['2026-10-25T00:30:00Z', '2026-10-25'], ['2026-10-25T23:30:00Z', '2026-10-25']]) {
    const now = Date.parse(instant); assert.equal(todayDate(now), expected); assert.equal(todayDate(now), londonDate(now));
    assert.equal(tenancyState({ tenancy_start_date: expected, tenancy_end_date: null }, todayDate(now)), 'active');
  }
});

test('empty rental units retain source exceptions; unavailable sources never imply an empty active portfolio', () => {
  const f = fixture({ rentalImports: [{ id: 'bad', building_id: building.id, status: 'failed', data_as_of: '2026-10-01T23:30:00Z', started_at: '2026-10-02T12:00:00Z', error_count: 1 }] });
  let result = overview(f); assert.equal(result.snapshot.summaries.find(s => s.key === 'rentals').value, 0);
  assert.ok(result.additional.some(g => g.key === 'rental_import')); assert.equal(result.attention.find(r => r.key === 'rentals').ours.value, 0);
  f.sources.find(s => s.key === 'rentals').state = 'unavailable'; result = overview(f);
  assert.equal(result.snapshot.summaries.find(s => s.key === 'rentals').value, null); assert.equal(result.attention.find(r => r.key === 'rentals').ours.value, null);
});

test('passed contractual dates remain observations, with no new team task or invented deadline', () => {
  const f = fixture({ sales: [{ ...sale, contractual_completion_date: '2026-10-01' }] });
  const result = deriveDashboard(f), date = result.items.find(i => i.kind === 'completion_date');
  assert.ok(datesToReview(result).includes(date)); assert.equal(deadlineState(date.deadline, NOW), 'overdue');
  assert.equal(matchesWorkTeam(date, 'ours'), false); assert.equal(matchesWorkTeam(date, 'others'), false);
  assert.equal(isUnallocatedWork(date), false);
});

test('recent sales activity keeps source actors, unit/building context, latest per type, window and seven-entry cap', () => {
  const f = fixture({ saleEvents: [
    { id: 'latest', sale_attempt_id: sale.id, event_type: 'authority_issued', created_at: '2026-10-07T11:00:00Z', created_by_user_id: null, actor_name: 'Source-supplied actor' },
    { id: 'older', sale_attempt_id: sale.id, event_type: 'authority_issued', created_at: '2026-10-07T10:00:00Z', created_by_user_id: 'amy' },
    { id: 'outside', sale_attempt_id: sale.id, event_type: 'reservation_submitted', created_at: '2026-09-30T22:59:59Z', created_by_user_id: 'amy' },
    ...Array.from({ length: 8 }, (_, i) => ({ id: `e${i}`, sale_attempt_id: sale.id, event_type: `completion_${i}`, created_at: `2026-10-06T1${i}:00:00Z`, created_by_user_id: i === 7 ? 'amy' : null })),
  ], saleActors: [{ id: 'amy', display_name: 'Amy' }] });
  const activity = deriveDashboard(f).activity;
  assert.equal(activity.length, 7); assert.equal(activity[0].account, 'Source-supplied actor');
  assert.ok(activity.every(e => e.buildingName === building.name && e.reference === `Unit ${unit.unit_number}`));
  assert.equal(activity.some(e => ['older', 'outside'].includes(e.id)), false);
  assert.equal(activity.find(e => e.id === 'e7').account, 'Amy');
  assert.equal(activity.find(e => e.id === 'e6').account, 'Account not recorded');
});
