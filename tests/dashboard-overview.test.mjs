import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadTypescriptModule } from './helpers/load-typescript-module.mjs';
import { fixture, building, unit, sale, document, snag, NOW } from './helpers/dashboard-fixture.mjs';

const { deriveDashboard } = loadTypescriptModule('src/lib/dashboard/model.ts');
const { deriveInternalOverview, datesToReview } = loadTypescriptModule('src/lib/dashboard/overview.ts');
const { deriveDeveloperSalesRows, selectDeveloperSalesRows, readSalesOverviewFilters } = loadTypescriptModule('src/lib/sales/developer-overview.ts');
const { InternalDashboard } = loadTypescriptModule('src/components/portal/dashboard/InternalDashboard.tsx', {
  overrides: { '../sales/SaleConversation': { SaleMentionsInbox: () => null } },
});
const compose = input => { const snapshot = deriveDashboard(input); snapshot.overview = deriveInternalOverview(input, snapshot); return snapshot; };
const render = (snapshot, extra = {}) => renderToStaticMarkup(React.createElement(InternalDashboard, { snapshot, buildingId: snapshot?.scope.buildingId ?? '', error: '', refreshing: false, refresh() {}, ...extra }));

test('selected building and all buildings use the Sales row population and configured stages', () => {
  const second = { ...building, id: 'second', name: 'Second House' };
  const input = fixture({ buildings: [building, second], units: [unit, { ...unit, id: 'second-unit', building_id: second.id, sale_status: 'for_sale' }, { ...unit, id: 'retained', sale_status: 'not_for_sale' }] });
  const all = compose(input);
  assert.equal(all.overview.sales.reduce((n, s) => n + s.value, 0), 2);
  assert.match(render(all), /Portfolio position/);
  input.buildingId = building.id;
  const selected = compose(input);
  assert.equal(selected.overview.sales.reduce((n, s) => n + s.value, 0), 1);
  assert.match(render(selected), /Building position/);
  assert.doesNotMatch(render(selected), /Portfolio position/);
  for (const row of selected.overview.attention) assert.equal(new URL(row.href, 'https://test').searchParams.get('building'), building.id);
  for (const row of all.overview.attention) assert.equal(new URL(row.href, 'https://test').searchParams.get('building'), 'all');
});

test('Sales counts open exactly the canonical responsibility view, counting rows rather than tasks', () => {
  for (const scope of ['', building.id]) {
    const input = fixture({ buildingId: scope, documents: [document('completion_statement'), document('draft_statement_of_account')] });
    const snapshot = compose(input), row = snapshot.overview.attention.find(row => row.key === 'sales');
    for (const team of ['ours', 'others']) {
      const url = new URL(row[team].href, 'https://test');
      const filters = readSalesOverviewFilters(url.search);
      assert.equal(filters.work, team);
      assert.equal(filters.category, '');
      assert.equal(filters.stage, 'all');
      assert.equal(filters.search, '');
      assert.equal(filters.page, 1);
      assert.equal(row[team].value, selectDeveloperSalesRows(deriveDeveloperSalesRows(input), filters, NOW).length);
    }
    assert.equal(row.ours.value, 1);
    assert.ok(snapshot.items.filter(item => item.kind.startsWith('review_')).length > row.ours.value);
  }
});

test('unavailable dependent sources cannot masquerade as zero or a partial exact count', () => {
  const empty = compose(fixture({ sales: [], units: [] }));
  assert.equal(empty.overview.attention[0].ours.value, 0);
  assert.match(render(empty), /0 unit rows/);
  for (const [source, row] of [['legal', 'sales'], ['fees', 'fees'], ['snags', 'snags'], ['rent_risk', 'rentals']]) {
    const input = fixture(); input.sources = input.sources.map(s => s.key === source ? { ...s, state: 'unavailable' } : s);
    const snapshot = compose(input);
    assert.equal(snapshot.overview.attention.find(r => r.key === row).ours.value, null);
    assert.match(render(snapshot), /Unavailable/);
  }
  const input = fixture(); input.sources = input.sources.filter(s => s.key !== 'rentals');
  assert.equal(compose(input).summaries.find(s => s.key === 'occupied').value, null);
  assert.match(render(compose(input)), /No reported arrears is not proof that rent is paid/);
  assert.match(render(null), /Loading dashboard/);
  assert.match(render(null, { error: 'Read failed' }), /Dashboard unavailable/);
  assert.doesNotMatch(render(null, { error: 'Read failed' }), /Loading dashboard/);
});

test('only admin and developer receive the simplified composition; shared external worklist stays intact', () => {
  for (const role of ['admin', 'developer']) assert.ok(compose(fixture({ viewer: { id: 'same-team-colleague', role, organisation_id: 'dev-org' } })).overview);
  for (const role of ['sales_agent', 'conveyancer', 'contractor', 'developer_representative', 'resident']) assert.equal(compose(fixture({ viewer: { id: 'external', role, organisation_id: 'agent-org' } })).overview, undefined);
  const colleague = compose(fixture({ documents: [document('completion_statement')], viewer: { id: 'someone-else', role: 'developer', organisation_id: 'dev-org' } }));
  assert.equal(colleague.overview.attention[0].ours.value, 1);
  const source = readFileSync('src/components/portal/dashboard/OrganisationWorklist.tsx', 'utf8');
  assert.match(source, /!external && isSalesInternalRole/);
  assert.match(source, /Sales organisation worklist/);
  assert.match(source, /Worklist pages/);
});

test('unsupported exact views stay non-interactive and each area has a real general destination', () => {
  const snapshot = compose(fixture({ invoices: [{ id: 'invoice', sale_attempt_id: sale.id, invoice_type: 'sales_agent', fee_milestone: 'exchange', status: 'submitted', gross_amount: 120, created_at: '2026-10-01' }], snags: [snag({ trade_id: null })] }));
  for (const key of ['fees', 'snags', 'rentals']) {
    const row = snapshot.overview.attention.find(r => r.key === key);
    assert.equal(row.ours.href, undefined); assert.equal(row.others.href, undefined);
    assert.ok(row.href);
  }
  const fees = snapshot.overview.attention.find(r => r.key === 'fees');
  assert.equal(fees.ours.value, 1); assert.equal(fees.ours.unit, 'sale attempts');
  assert.match(fees.note, /historical/);
  const snags = snapshot.overview.attention.find(r => r.key === 'snags');
  assert.equal(snags.ours.value, 1); assert.equal(snags.others.value, 1);
  assert.equal(new URL(fees.href, 'https://test').searchParams.get('salesView'), 'agent_fees');
});

test('handover, access, lifecycle, unallocated and rental evidence work are not dropped', () => {
  const input = fixture({ viewer: { id: 'admin', role: 'admin', organisation_id: null },
    units: [{ ...unit, sale_status: 'completed', rental_portfolio_status: 'active' }], sales: [],
    snags: [snag({ assigned_to_organisation_id: null })],
    accessRequests: [{ id: 'request', created_at: '2026-10-01', requested_units: [{ building_id: building.id }] }],
  });
  let snapshot = compose(input);
  for (const key of ['handover', 'resident_access', 'rental_evidence']) assert.ok(snapshot.overview.additional.some(g => g.key === key), key);
  assert.equal(snapshot.overview.attention.find(r=>r.key==='snags').unallocated.value,1);
  assert.equal(snapshot.overview.attention.find(r => r.key === 'rentals').ours.value, 1);
  input.buildings = [{ ...building, pc_confirmed: false, pc_date: '2026-09-01' }];
  snapshot = compose(input);
  assert.ok(snapshot.overview.additional.some(g => g.key === 'pc_confirmation'));
  const lifecycle = snapshot.overview.additional.find(g => g.key === 'pc_confirmation');
  assert.match(lifecycle.href, /screen=setup_buildings/);
  assert.equal(lifecycle.detail, building.name);
  input.viewer.role = 'developer';
  assert.equal(compose(input).overview.additional.find(g => g.key === 'pc_confirmation').href, undefined);
});

test('dates preserve priority and saved-date language; all remaining exceptions stay reachable', () => {
  const snapshot = compose(fixture({ snags: Array.from({ length: 8 }, (_, i) => snag({ id: `defect-${i}`, source_type: 'leaseholder_defect', priority_code: 'P1', sla_due_date: '2026-10-06' })) }));
  const dates = datesToReview(snapshot);
  assert.equal(dates.length, 9);
  assert.ok(dates.slice(0, 8).every(item => item.urgent));
  const html = render(snapshot);
  assert.match(html, /4 more dates and exceptions/);
  assert.match(html, /Review saved contractual completion date/);
  assert.doesNotMatch(html, /Overdue completion|View all/);
  assert.equal((html.match(/aria-label="Open /g) ?? []).length, 9);
});

test('structure exists during loading, activity is collapsed and internal worklist controls are gone', () => {
  for (const snapshot of [null, compose(fixture())]) {
    const html = render(snapshot);
    const labels = ['Dashboard</h1>', 'Portfolio position', 'Work needing attention', 'Dates to review', 'Recent sales activity'];
    let previous = -1;
    for (const label of labels) { const at = html.indexOf(label); assert.ok(at > previous, label); previous = at; }
    assert.doesNotMatch(html, /<details[^>]* open|Worklist pages|Work modules|aria-label="Responsibility"|Latest business context/);
  }
});
