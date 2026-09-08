import { expect, test, type Page } from '@playwright/test';
import { salesFixture, at } from './helpers/sales-fixture';

const approver = '70000000-0000-4000-8000-000000000001';
const completer = '70000000-0000-4000-8000-000000000002';
const value = (page: Page, label: string) => page.locator('#sales-stage-completion dt').filter({ hasText: new RegExp(`^${label}$`) }).locator('..').locator('dd');

async function completedSale(page: Page) {
  const f = await salesFixture(page);
  f.unit.sale_status = 'completed';
  Object.assign(f.attempt, { workflow_status: 'completed', exchanged_at: '2026-08-02', completed_at: '2026-08-06' });
  f.documents();
  f.rows.unit_sale_documents.forEach(doc => Object.assign(doc, { status: 'approved', approved_at: at(5), approved_by_user_id: approver }));
  f.rows.unit_sale_workflow_events = [
    { ...f.event('completion_documents_approved', 5), created_by_user_id: approver },
    { ...f.event('completion_recorded', 6), created_by_user_id: completer },
  ];
  return f;
}

for (const role of ['sales_agent','conveyancer']) {
  test(`Completion resolves historical approver and completer missing from profiles for ${role}`, async ({ page }) => {
    const f = await completedSale(page);
    f.profile.role = role;
    let resolverCalls = 0;
    await page.route('**/rest/v1/rpc/sale_actor_names', async route => {
      resolverCalls++;
      expect(route.request().postDataJSON().p_sales).toContain(f.attempt.id);
      await route.fulfill({ json: [{ id: approver, display_name: 'Historical Approver' }, { id: completer, display_name: 'Historical Completer' }] });
    });
    await f.reloadStage('Completion');
    await expect(value(page,'Approved by')).toHaveText('Historical Approver');
    await expect(value(page,'Completed by')).toHaveText('Historical Completer');
    expect(resolverCalls).toBeGreaterThan(0);
    await expect(page.getByRole('button',{name:'Approve completion documents',exact:true})).toHaveCount(0);
    await expect(page.getByRole('button',{name:'Sale participants',exact:true})).toHaveCount(0);
    // A legacy sale may have the document approver but no approval event.
    f.rows.unit_sale_workflow_events.shift();
    await f.reloadStage('Completion');
    await expect(value(page,'Approved by')).toHaveText('Historical Approver');
  });
}

test('Completion uses workflow names without a profile lookup and keeps null IDs unknown', async ({ page }) => {
  const f = await completedSale(page);
  f.rows.unit_sale_workflow_events[0].actor_name = 'Approval Snapshot';
  f.rows.unit_sale_workflow_events[1].actor_name = 'Completion Snapshot';
  // The fixture returns no names from the resolver and only the viewer profile.
  await f.reloadStage('Completion');
  await expect(value(page,'Approved by')).toHaveText('Approval Snapshot');
  await expect(value(page,'Completed by')).toHaveText('Completion Snapshot');
  f.rows.unit_sale_workflow_events.forEach(e => Object.assign(e,{created_by_user_id:null,actor_name:null}));
  f.rows.unit_sale_documents.forEach(doc => { doc.approved_by_user_id = null; });
  await f.reloadStage('Completion');
  await expect(value(page,'Approved by')).toHaveText('Unknown user');
  await expect(value(page,'Completed by')).toHaveText('Unknown user');
});
