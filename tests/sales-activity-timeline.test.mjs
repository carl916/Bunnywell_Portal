import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTypescriptModule } from './helpers/load-typescript-module.mjs';

const { buildActivityTimeline } = loadTypescriptModule('src/lib/sales/activity-timeline.ts');
const { activityPresentation } = loadTypescriptModule('src/lib/sales/discussion.ts');
const event = (id, event_type, seconds, metadata = {}, extra = {}) => ({ id, event_type, sale_attempt_id: 'sale',
  created_at: new Date(Date.UTC(2026, 9, 26, 20, 11, seconds)).toISOString(), created_by_user_id: 'agent',
  actor_name: 'Agent', actor_role: 'sales_agent', actor_organisation: null, summary: event_type, metadata, version_id: null, ...extra });
const allIds = timeline => [...timeline.items.flatMap(item => [item.event.id, ...item.supporting.map(row => row.id)]), ...timeline.recordUpdates.map(row => row.id)].sort();

test('LG03 sequence becomes one submission, retaining all six records and the exact file link', () => {
  const rows = [event('1', 'sale_record_changed', 29), event('2', 'reservation_draft_saved', 29.5),
    event('3', 'reservation_form_uploaded', 37, { fileName: 'reservation.pdf', versionNumber: 1 }, { version_id: 'original-version' }),
    event('4', 'sale_record_changed', 39), event('5', 'sale_record_changed', 40), event('6', 'reservation_submitted', 41)];
  const before = structuredClone(rows);
  const timeline = buildActivityTimeline(rows);
  assert.equal(timeline.items.length, 1);
  assert.equal(timeline.items[0].event.id, '6');
  assert.equal(timeline.items[0].supporting.find(row => row.id === '3').version_id, 'original-version');
  assert.deepEqual(allIds(timeline), rows.map(row => row.id));
  assert.deepEqual(rows, before, 'the raw rows and pagination cursor stay untouched');
});

test('authority issuance folds email preparation and record updates, preserving expiry and delivery failures', () => {
  const rows = [event('1', 'legal_email_prepared', 29, { emailId: 'mail', kind: 'authority' }),
    event('2', 'authority_issued', 30, { emailId: 'mail', expiresAt: '2026-10-28T08:38:00Z' }),
    event('3', 'sale_record_changed', 30), event('4', 'legal_email_delivery', 40, { emailId: 'mail', deliveryStatus: 'delivered' }),
    event('5', 'legal_email_delivery', 90, { emailId: 'mail', deliveryStatus: 'failed' }),
    event('6', 'authority_expired', 180000, {}, { created_by_user_id: null })];
  const result = buildActivityTimeline(rows);
  assert.deepEqual(result.items.map(item => item.event.id), ['6', '5', '2']);
  assert.equal(result.items[2].supporting.length, 3);
  assert.deepEqual(allIds(result), rows.map(row => row.id));
});

test('unissued email approvals, unknown delivery, revocations and standalone uploads remain visible', () => {
  const rows = [event('1', 'legal_email_prepared', 1, { emailId: 'pending', kind: 'authority' }),
    event('2', 'legal_email_delivery', 2, { emailId: 'pending', deliveryStatus: 'unknown' }),
    event('3', 'authority_revoked', 3), event('4', 'reservation_form_replaced', 4)];
  assert.equal(buildActivityTimeline(rows).items.length, 4);
  assert.equal(activityPresentation(rows[0]).title, 'Authority to exchange awaiting delivery');
  assert.equal(activityPresentation(rows[0]).stage, 'exchange');
  assert.equal(activityPresentation(event('notice', 'authority_notice_given', 1)).stage, 'completion');
});

test('reservation grouping does not cross actors, sales, later edits, rejection or a long pause', () => {
  const submission = event('submit', 'reservation_resubmitted', 30);
  for (const draft of [event('draft', 'reservation_draft_saved', 1, {}, { created_by_user_id: 'other' }),
    event('draft', 'reservation_draft_saved', 1, {}, { sale_attempt_id: 'other-sale' }),
    event('draft', 'reservation_draft_saved', 1, {}, { created_by_user_id: null }),
    event('draft', 'reservation_draft_saved', -300), event('draft', 'reservation_form_replaced', 31)]) {
    assert.equal(buildActivityTimeline([draft, submission]).items.length, 2);
  }
  assert.equal(buildActivityTimeline([event('draft', 'reservation_draft_saved', 1), event('rejected', 'reservation_rejected', 2), submission]).items.length, 3);
  assert.equal(buildActivityTimeline([event('draft', 'reservation_draft_saved', 1), submission]).items.length, 1);
});

test('completion notice and PDF replacement use exact version/document references', () => {
  const rows = [event('notice', 'completion_correspondence_uploaded', 1, { versionId: 'notice-v1' }),
    event('confirmed', 'completion_arrangements_confirmed', 1, { versionId: 'notice-v1' }),
    event('old', 'completion_statement_superseded', 3, { documentId: 'statement' }, { version_id: 'old-version' }),
    event('new', 'completion_statement_replaced', 3, { documentId: 'statement' }, { version_id: 'new-version' }),
    event('unrelated', 'completion_statement_superseded', 3, { documentId: 'different' })];
  const result = buildActivityTimeline(rows);
  assert.equal(result.items.length, 3);
  assert.equal(result.items.find(item => item.event.id === 'new').supporting[0].version_id, 'old-version');
  assert.deepEqual(allIds(result), rows.map(row => row.id).sort());
});

test('one completion package upload has one entry, while separate submissions and queries stay separate', () => {
  const rows = [event('statement', 'completion_statement_replaced', 1, { packageWorkflow: true, documentType: 'completion_statement', documentId: 'statement' }),
    event('account', 'completion_draft_statement_of_account_uploaded', 1, { packageWorkflow: true, documentType: 'draft_statement_of_account' }),
    event('old', 'completion_statement_superseded', 1, { documentId: 'statement' }),
    event('later', 'completion_statement_replaced', 5, { packageWorkflow: true, documentType: 'completion_statement' }),
    event('query', 'completion_documents_query_raised', 5, { queryNote: 'Please correct the total' })];
  const result = buildActivityTimeline(rows);
  assert.equal(result.items.length, 3);
  assert.equal(result.items.find(item => item.title)?.title, 'Completion documents updated');
  assert.deepEqual(allIds(result), rows.map(row => row.id).sort());
});

test('financial outcomes retain each payment and only fold a matching fully-paid result', () => {
  const rows = [event('payment1', 'agent_fee_payment_recorded', 1, { invoiceId: 'invoice' }),
    event('payment2', 'agent_fee_payment_recorded', 2, { invoiceId: 'invoice' }),
    event('paid', 'agent_fee_invoice_paid', 2, { invoiceId: 'invoice' }),
    event('other', 'agent_fee_invoice_paid', 2, { invoiceId: 'another-invoice' }),
    event('void', 'agent_fee_payment_voided', 3)];
  const result = buildActivityTimeline(rows);
  assert.equal(result.items.length, 4);
  assert.equal(result.items.find(item => item.event.id === 'payment2').supporting[0].id, 'paid');
  assert.deepEqual(allIds(result), rows.map(row => row.id).sort());
});

test('ambiguous audit changes use separate history; unknown milestones are never dropped', () => {
  const rows = [event('audit', 'sale_record_changed', 1), event('approved', 'reservation_approved', 2),
    event('requested', 'authority_requested', 3), event('future', 'future_workflow_action', 300)];
  const result = buildActivityTimeline(rows);
  assert.deepEqual(result.recordUpdates.map(row => row.id), ['audit']);
  assert.equal(result.items.length, 3);
  assert.deepEqual(allIds(result), rows.map(row => row.id).sort());
});

test('grouping remains complete when related rows arrive on an older page or on refresh', () => {
  const newer = [event('submit', 'reservation_submitted', 40)];
  const older = [event('form', 'reservation_form_uploaded', 35), event('draft', 'reservation_draft_saved', 30)];
  assert.equal(buildActivityTimeline(newer).items.length, 1);
  const result = buildActivityTimeline([...newer, ...older, ...newer]);
  assert.equal(result.items.length, 1);
  assert.deepEqual(allIds(result), ['draft', 'form', 'submit']);
});
