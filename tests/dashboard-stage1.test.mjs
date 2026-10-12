import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadTypescriptModule } from './helpers/load-typescript-module.mjs';
import { fixture, unit, sale, building, document, snag, NOW } from './helpers/dashboard-fixture.mjs';
const { deriveDashboard } = loadTypescriptModule('src/lib/dashboard/model.ts');
const { deriveInternalOverview, datesToReview } = loadTypescriptModule('src/lib/dashboard/overview.ts');
const { dashboardResponse } = loadTypescriptModule('src/lib/dashboard/response.ts');
const { InternalDashboard } = loadTypescriptModule('src/components/portal/dashboard/InternalDashboard.tsx', { overrides: { '../sales/SaleConversation': { SaleMentionsInbox: () => null } } });
const fullResponse = input => { const result = deriveDashboard(input); result.overview = deriveInternalOverview(input, result); return result; };
const render = snapshot => renderToStaticMarkup(React.createElement(InternalDashboard, { snapshot, buildingId: snapshot.scope.buildingId, error: '', refreshing: false, refresh() {} }));

test('internal transport preserves every summary and renders identical complete dates/exceptions', () => {
  const units = Array.from({ length: 60 }, (_, i) => ({ ...unit, id: `unit-${i}`, unit_number: String(i + 1) }));
  const sales = units.map((u, i) => ({ ...sale, id: `sale-${i}`, unit_id: u.id, contractual_completion_date: i < 8 ? '2026-10-08' : '2027-02-01' }));
  for (const role of ['admin', 'developer']) for (const buildingId of ['', building.id]) {
    const input = fixture({ viewer: { id: 'viewer', role, organisation_id: null }, buildingId, units, sales, snags: [snag({ assigned_to_organisation_id: null }), snag({ id: 'urgent', priority_code: 'P1' })] });
    const full = fullResponse(input), reduced = dashboardResponse(input);
    assert.deepEqual({ ...reduced, items: full.items }, full);
    assert.deepEqual(reduced.items, datesToReview(full));
    assert.ok(reduced.items.length > 5, 'expanded entries are not truncated');
    assert.ok(reduced.items.length < full.items.length, 'non-display work is omitted');
    assert.equal(render(reduced), render(full), 'labels, links, ordering, deadlines and all expanded rows survive');
    assert.ok(Buffer.byteLength(JSON.stringify(reduced)) < Buffer.byteLength(JSON.stringify(full)) * 0.5);
  }
});

test('source failures retain null counts, evidence and exceptions after reduction', () => {
  for (const source of fixture().sources) {
    const input = fixture({ documents: [document('completion_statement')] });
    input.sources = input.sources.map(s => s.key === source.key ? { ...s, state: 'unavailable' } : s);
    const full = fullResponse(input), reduced = dashboardResponse(input);
    assert.deepEqual({ ...reduced, items: full.items }, full);
    assert.equal(render(reduced), render(full));
  }
});

test('external and operational roles retain the full detailed worklist', () => {
  for (const role of ['sales_agent', 'conveyancer', 'contractor', 'developer_representative']) {
    const input = fixture({ viewer: { id: 'external', role, organisation_id: 'agent-org' }, snags: [snag()] });
    assert.deepEqual(dashboardResponse(input), fullResponse(input));
  }
});

test('all classifications use the same inclusive review-window selector', () => {
  const full = fullResponse(fixture());
  const item = { ...full.items[0], kind: 'reservation_prepare' };
  full.items = [
    { ...item, id: 'unallocated', deadline: null, responsibility: { ...item.responsibility, kind: 'unallocated', organisationId: null, allocation: 'unallocated' } },
    { ...item, id: 'unavailable', deadline: null, responsibility: { ...item.responsibility, allocation: 'unavailable' } },
    { ...item, id: 'urgent', urgent: true, deadline: null },
    ...[-2, 0, 1, 29, 30, 31, 60].map(days => ({ ...item, id: `date-${days}`, urgent: false, responsibility: { kind: 'developer', organisationId: null, label: 'Developer team' }, deadline: { at: new Date(NOW + days * 86400000).toISOString().slice(0, 10), precision: 'date', basis: 'Saved date' } })),
  ];
  assert.deepEqual(datesToReview(full).map(item => item.id), ['unallocated', 'unavailable', 'urgent', 'date--2', 'date-0', 'date-1', 'date-29', 'date-30']);
});
