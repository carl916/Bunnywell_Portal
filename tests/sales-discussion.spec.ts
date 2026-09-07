import { expect, test, type Page } from '@playwright/test';
import { salesFixture, userId } from './helpers/sales-fixture';
import { discussionDatabase } from './helpers/discussion-database.mjs';

async function fixture(page: Page) {
  const ui = await salesFixture(page);
  const f = await discussionDatabase({ developer: userId, building: ui.unit.building_id, unit: ui.unit.id, sale: ui.attempt.id });
  let loseNextWriteResponse = false;
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  await page.route('**/rest/v1/rpc/**', async (route) => {
    const name = new URL(route.request().url()).pathname.split('/').at(-1)!;
    const args = route.request().postDataJSON(); calls.push({ name, args });
    try {
      await f.as('developer');
      const result = await f.rpc(name, args);
      if (name === 'sale_comment_write' && loseNextWriteResponse) { loseNextWriteResponse = false; throw new Error('Connection lost after sending. Retry your update.'); }
      await route.fulfill({ json: result });
    } catch (error) { await route.fulfill({ status: 400, json: { message: (error as Error).message } }); }
  });
  const seedComment = async (body: string) => { await f.as('agent'); return f.write(body, { p_sale: f.ids.sale }); };
  const reload = async (suffix = '') => { await page.goto(`/?screen=sales&building=${f.ids.building}&salesUnitId=${f.ids.unit}${suffix}`); await expect(page.getByRole('tab', { name: /^Progression/ })).toBeVisible(); };
  return { ...ui, sql: f, calls, seedComment, reload, loseResponse: () => { loseNextWriteResponse = true; } };
}
const panel = (page: Page) => page.locator('#sale-conversation');
const composer = (page: Page) => page.getByRole('textbox', { name: 'Write an update', exact: true });
const open = async (page: Page) => { if (!(await panel(page).isVisible())) await page.getByRole('button', { name: /^Comments/ }).first().click(); await expect(composer(page)).toBeVisible(); };

test('docking, drawer fallback, mobile, draft and unsaved commercial values survive presentation changes', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  const f = await fixture(page);
  try {
    await f.seedComment('The solicitor has received the signed reservation form.\nPlease keep updates here.');
    f.rows.unit_sale_terms = [{ id: 'terms', sale_attempt_id: f.attempt.id, is_current: true, status: 'draft', contract_price: 340500, list_price_at_offer: 340500, exchange_agent_fee_percent: 9.5, completion_agent_fee_percent: 0.5, agent_fee_percent: 10, vat_rate: 20 }];
    await f.reload(); await open(page);
    await expect(panel(page)).toHaveAttribute('data-modal', 'false');
    await expect(panel(page).getByRole('button', { name: 'Send', exact: true })).toBeInViewport();
    await composer(page).fill('Draft remains on this transaction');
    await page.getByRole('tab', { name: /^Financials/ }).click(); await expect(composer(page)).toHaveValue('Draft remains on this transaction');
    await page.getByRole('tab', { name: /^Commercial/ }).click();
    await page.getByRole('button', { name: 'Edit commercial model', exact: true }).click();
    await page.getByLabel('Proposed contract price', { exact: true }).fill('350500');
    const editor = page.getByTestId('commercial-model-editor');
    const rail = page.getByRole('complementary', { name: 'Commercial preview' });
    const editorBox = (await editor.boundingBox())!, railBox = (await rail.boundingBox())!;
    expect(railBox.width / editorBox.width).toBeGreaterThan(0.25); expect(railBox.width / editorBox.width).toBeLessThan(0.4);
    await page.screenshot({ path: 'artifacts/sale-discussion-commercial-docked.png', fullPage: true });
    await page.setViewportSize({ width: 1366, height: 1000 });
    await expect(panel(page)).toHaveAttribute('data-modal', 'false');
    await page.setViewportSize({ width: 1200, height: 1000 });
    await expect(panel(page)).toBeHidden();
    await expect(page.locator('[data-conversation-backdrop]')).toHaveCount(0);
    await expect(page.getByLabel('Proposed contract price', { exact: true })).toHaveValue('350,500');
    await open(page); await expect(composer(page)).toHaveValue('Draft remains on this transaction');
    await expect(panel(page)).toHaveAttribute('data-modal', 'true');
    await page.screenshot({ path: 'artifacts/sale-discussion-commercial-drawer.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(panel(page)).toHaveAttribute('role', 'dialog');
    expect((await panel(page).boundingBox())!.width).toBe(390);
    await expect(composer(page)).toHaveValue('Draft remains on this transaction');
    await page.screenshot({ path: 'artifacts/sale-discussion-mobile.png', fullPage: true });
    await page.keyboard.press('Escape'); await open(page); await expect(composer(page)).toHaveValue('Draft remains on this transaction');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  } finally { await f.sql.db.close(); }
});

test('activity keeps earlier pages and scroll, identifies document subjects and links to the recorded version', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 }); const f = await fixture(page);
  try {
    await f.sql.owner();
    await f.sql.db.query("insert into unit_sale_workflow_events(sale_attempt_id,event_type,summary,created_at,created_by_user_id) select $1,'reservation_submitted','Reservation submitted',timestamp '2026-08-01'+i*interval '1 minute',$2 from generate_series(1,65) i", [f.sql.ids.sale,userId]);
    for (const kind of ['completion_statement','statement_of_account']) {
      const id=crypto.randomUUID();
      await f.sql.db.query('insert into unit_sale_documents(id,sale_attempt_id,document_type,title,status,updated_by_user_id) values($1,$2,$3,$3,$4,$5)',[id,f.sql.ids.sale,kind,'uploaded',userId]);
      await f.sql.db.query('insert into unit_sale_document_versions(document_id,version_number,file_name,uploaded_by_user_id) values($1,1,$2,$3)',[id,`Synthetic ${kind}.pdf`,userId]);
    }
    await f.sql.db.query("update unit_sale_documents set status='approved' where sale_attempt_id=$1",[f.sql.ids.sale]);
    await f.reload(); await open(page); await panel(page).getByRole('tab',{name:'Activity',exact:true}).click();
    await expect(panel(page).getByText('Completion statement approved',{exact:true})).toBeVisible();
    await expect(panel(page).getByText('Statement of account approved',{exact:true})).toBeVisible();
    await page.screenshot({path:'artifacts/sale-discussion-activity.png',fullPage:true});
    const count=await panel(page).locator('#conversation-activity article').count();
    await panel(page).getByRole('button',{name:'Load older activity'}).click();
    await expect(panel(page).locator('#conversation-activity article')).toHaveCount(69);
    expect(count).toBe(50);
    const feed=page.locator('#conversation-activity'); await feed.evaluate(node=>{node.scrollTop=400;});
    await panel(page).getByRole('tab',{name:/^Comments/}).click(); await panel(page).getByRole('tab',{name:'Activity',exact:true}).click();
    expect(await feed.evaluate(node=>node.scrollTop)).toBe(400);
    await feed.evaluate(node=>{node.scrollTop=0;});
    const document=panel(page).locator('article').filter({hasText:'Completion statement approved'});
    await expect(document.getByRole('button',{name:'View document version'})).toBeVisible();
    await document.getByRole('button',{name:'View completion',exact:true}).click();
    await expect(page.getByRole('heading',{name:'Completion',exact:true})).toBeVisible();
  } finally { await f.sql.db.close(); }
});

test('hidden panel and Activity do not read comments; visible comments acknowledge presented messages', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const f = await fixture(page);
  try {
    await f.seedComment('Unread first update'); await f.seedComment('Unread second update'); await f.reload();
    const before = f.calls.filter((c) => c.name === 'sale_comment_page').length;
    await expect(panel(page)).toBeHidden();
    await page.waitForTimeout(1100);
    expect(f.calls.filter((c) => c.name === 'sale_comment_page').length).toBe(before);
    await open(page); await panel(page).getByRole('tab', { name: 'Activity', exact: true }).click();
    await page.waitForTimeout(1200);
    expect(f.calls.filter((c) => c.name === 'sale_comment_read')).toHaveLength(0);
    await panel(page).getByRole('tab', { name: /^Comments/ }).click();
    await expect.poll(() => f.calls.filter((c) => c.name === 'sale_comment_read').length).toBeGreaterThan(0);
    await expect.poll(async () => { await f.sql.as('developer'); return (await f.sql.rpc('sale_comment_unread', { p_sales: [f.sql.ids.sale] }))[f.sql.ids.sale]; }).toBe(0);
  } finally { await f.sql.db.close(); }
});

test('plain text, mentions, lost-response retry, reply, edit and revision history work against the SQL actions', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  const f = await fixture(page);
  try {
    await f.reload(); await open(page);
    await composer(page).fill('Please review @Test soli');
    await expect(page.getByRole('listbox', { name: 'Mention sale participant' })).toBeVisible();
    await composer(page).press('Tab');
    await composer(page).press('Enter');
    await composer(page).pressSequentially('Second line https://example.test/document <script>alert(1)</script>');
    expect(await composer(page).inputValue()).toContain('\n');
    f.loseResponse(); await composer(page).press('Control+Enter');
    await expect(panel(page).getByRole('alert')).toContainText('Connection lost');
    expect(await composer(page).inputValue()).toContain('Second line');
    await panel(page).getByRole('button', { name: 'Send', exact: true }).click();
    await expect(composer(page)).toHaveValue('');
    const message = panel(page).locator('article').filter({ hasText: 'Second line' });
    await expect(message).toHaveCount(1);
    await expect(message.getByRole('link', { name: 'https://example.test/document' })).toHaveAttribute('rel', 'noopener noreferrer');
    await message.getByRole('button', { name: 'Reply', exact: true }).click();
    await composer(page).fill('Follow-up on the same sale'); await composer(page).press('Control+Enter');
    const reply = panel(page).locator('article').filter({ hasText: 'Follow-up on the same sale' });
    await reply.getByRole('button', { name: 'Edit', exact: true }).click();
    await composer(page).fill('Revised follow-up'); await panel(page).getByRole('button', { name: 'Save edit' }).click();
    const edited = panel(page).locator('article').filter({ hasText: 'Revised follow-up' });
    await edited.getByRole('button', { name: 'Edited', exact: true }).click();
    await expect(edited).toContainText('Follow-up on the same sale');
    await expect(edited).toContainText('Version 1');
  } finally { await f.sql.db.close(); }
});

test('pagination and incoming messages preserve older reading position and separate activity scroll', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  const f = await fixture(page);
  try {
    const ids=[]; for (let i=0;i<70;i++) ids.push(await f.seedComment(`Progress update ${i}: ${'long supporting context '.repeat(12)}`));
    await f.sql.as('developer'); await f.sql.rpc('sale_comment_read', { p_sale: f.sql.ids.sale, p_comments: ids });
    await f.reload(); await open(page);
    await panel(page).getByRole('button', { name: 'Load older comments' }).click();
    const feed = page.locator('#conversation-comments'); await feed.evaluate((node) => { node.scrollTop=250; });
    const before = await feed.evaluate((node) => node.scrollTop);
    await f.seedComment('New arrival while reading earlier discussion');
    await expect(panel(page).getByRole('button', { name: 'New messages ↓' })).toBeVisible({ timeout: 20000 });
    expect(await feed.evaluate((node) => node.scrollTop)).toBeCloseTo(before,0);
    await panel(page).getByRole('tab', { name: 'Activity', exact: true }).click();
    await panel(page).getByRole('tab', { name: /^Comments/ }).click();
    expect(await feed.evaluate((node) => node.scrollTop)).toBeCloseTo(before,0);
    await panel(page).getByRole('button', { name: 'New messages ↓' }).click();
    await expect(panel(page).getByText('New arrival while reading earlier discussion', { exact: true })).toBeInViewport();
  } finally { await f.sql.db.close(); }
});

test('overview indicator and comment deep link open the correct sale and retain stage changes', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 }); const f = await fixture(page);
  try {
    const id = await f.seedComment('Deep-link context from the assigned agent');
    f.attempt.workflow_status = 'completed'; f.unit.sale_status = 'completed'; f.attempt.completed_at = '2026-08-30';
    await f.reload(`&conversation=${f.sql.ids.sale}&comment=${id}`);
    await expect(panel(page).getByText('Deep-link context from the assigned agent', { exact: true })).toBeInViewport();
    await composer(page).fill('Stage-independent draft');
    await page.getByRole('button', { name: /^Exchange\b/ }).first().click();
    await expect(composer(page)).toHaveValue('Stage-independent draft');
    await page.getByRole('button', { name: /^Completion\b/ }).first().click();
    await page.getByRole('button', { name: /^Reservation\b/ }).first().click();
    await expect(composer(page)).toHaveValue('Stage-independent draft');
    await page.screenshot({ path: 'artifacts/sale-discussion-after.png', fullPage: true });
    await page.getByRole('button', { name: /Back to sales overview/ }).click();
    await f.seedComment('Another unread update'); await page.reload();
    await page.getByRole('button', { name: /Open \d+ unread comments for Unit 101/ }).click();
    await expect(panel(page)).toBeVisible();
    await expect(composer(page)).toHaveValue('Stage-independent draft');
  } finally { await f.sql.db.close(); }
});
