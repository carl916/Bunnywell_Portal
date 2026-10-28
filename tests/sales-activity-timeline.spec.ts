import { test, expect } from '@playwright/test';
import { salesFixture, userId } from './helpers/sales-fixture';

test('reservation and authority show milestones with accessible supporting details on desktop and mobile', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  const f = await salesFixture(page);
  const row = (id: string, event_type: string, second: number, summary: string, metadata = {}, version_id: string | null = null) => ({
    id, sale_attempt_id: f.attempt.id, event_type, summary, metadata, version_id, created_by_user_id: userId,
    actor_name: 'Test Agent', actor_role: 'sales_agent', actor_organisation: 'Example agency',
    created_at: new Date(Date.UTC(2026, 9, 26, 20, 11, second)).toISOString(),
  });
  f.rows.unit_sale_workflow_events = [
    row('record1', 'sale_record_changed', 29, 'Sale record changed'),
    row('draft', 'reservation_draft_saved', 29, 'Reservation draft saved'),
    row('form', 'reservation_form_uploaded', 37, 'Reservation form uploaded', { fileName: 'reservation.pdf', versionNumber: 1 }, 'original-version'),
    row('record2', 'sale_record_changed', 39, 'Sale record changed'),
    row('record3', 'sale_record_changed', 40, 'Sale record changed'),
    row('submitted', 'reservation_submitted', 41, 'Reservation submitted'),
    row('prepared', 'legal_email_prepared', 180, 'Email approved for sending', { emailId: 'mail', kind: 'authority' }),
    row('issued', 'authority_issued', 181, 'Authority to exchange issued', { emailId: 'mail', expiresAt: '2026-10-28T20:14:01Z', to: ['solicitor@example.test'] }),
    row('record4', 'sale_record_changed', 181, 'Sale record changed'),
    row('unmatched', 'sale_record_changed', -3600, 'Sale record changed'),
  ];
  await page.reload();
  const panel = page.locator('#sale-conversation');
  const feed = page.locator('#conversation-activity');
  const open = async () => {
    if (!await panel.isVisible()) await page.getByRole('button', { name: /^Comments/ }).first().click();
    await panel.getByRole('tab', { name: 'Activity', exact: true }).click();
  };
  await open();
  await expect(feed.locator('article')).toHaveCount(2);
  await expect(feed.getByText('Reservation form uploaded', { exact: true })).toBeHidden();
  await expect(feed.getByText('Email approved for sending', { exact: true })).toBeHidden();
  await expect(feed.getByText('Record history (1)', { exact: true })).toBeVisible();
  const reservation = feed.locator('[data-activity-id="submitted"]');
  const details = reservation.locator('summary');
  await details.focus();
  await page.keyboard.press('Enter');
  await expect(reservation.getByText('reservation.pdf · Version 1', { exact: true })).toBeVisible();
  await expect(reservation.getByText('Sale record changed', { exact: true })).toHaveCount(3);
  let requestedVersion: string | null = null;
  await page.route('**/api/sales/reservations?**', async route => {
    requestedVersion = new URL(route.request().url()).searchParams.get('versionId');
    await route.fulfill({ json: { signedUrl: 'about:blank' } });
  });
  await reservation.getByRole('button', { name: 'View document version' }).click();
  await expect.poll(() => requestedVersion).toBe('original-version');
  await details.click();
  const authority = feed.locator('[data-activity-id="issued"]');
  await authority.locator('summary').click();
  await expect(authority.getByText('Email approved for sending', { exact: true })).toBeVisible();
  await expect(authority.getByText('To: solicitor@example.test', { exact: true })).toBeVisible();
  await authority.locator('summary').click();
  for (const width of [1920, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1080 });
    await open();
    await expect(feed.locator('article')).toHaveCount(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await panel.screenshot({ path: testInfo.outputPath(`activity-milestones-${width}.png`) });
  }
});
