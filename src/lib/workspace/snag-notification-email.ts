import { emailDetails, emailParagraph, emailPortalButton, emailSection, emailShell, escapeHtml } from '../email/layout';
import type { IntendedPerson, OriginalMail } from './staging-email';

const eventLabels: Record<string, string> = {
  assigned: 'Snag assigned',
  needs_information: 'Information requested',
  mentioned: 'You were mentioned in a comment',
  urgent: 'P1 snag requires attention',
  ready_for_review: 'Snag resolution needs developer review',
  returned: 'Snag returned to the contractor',
  created: 'New snag',
  updated: 'Snag updated',
  closed: 'Snag closed',
  status_changed: 'Status changed',
  comment: 'Comment added',
};

type Activity = { id: string; title: string; event: string };
export type SnagDeliveryContext = {
  revision: string;
  recipient: Exclude<IntendedPerson, string>;
  mode: 'immediate' | 'digest';
  buildingId: string;
  building: string;
  periodStart: string | null;
  cutoffAt: string | null;
  eventCount: number;
  created: number;
  awaitingInformation: number;
  closed: number;
  statusChanges: number;
  updates: number;
  comments: number;
  details: Activity[];
};

const ukTime = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  timeZone: 'Europe/London', timeZoneName: 'short',
});

function snagLink(building: string, params: Record<string, string> = {}) {
  return 'https://staging.bunnywell.co.uk/workspace?' + new URLSearchParams({ view: 'snags', building, ...params });
}

function detailLink(building: string, id: string) {
  return snagLink(building, { view: 'snag', snag: id });
}

export function renderSnagNotification(context: SnagDeliveryContext): OriginalMail {
  const { building, buildingId, details } = context;
  if (context.mode === 'immediate') {
    const [detail] = details;
    if (!detail) throw Error('Snagging notification activity is unavailable.');
    const heading = eventLabels[detail.event];
    const subject = `${building} — ${heading}`;
    const link = detailLink(buildingId, detail.id);
    const text = [heading, building, detail.title, 'Open snag: ' + link].join('\n\n');
    const html = emailShell({ title: heading, subtitle: building,
      content: emailParagraph(detail.title) + emailPortalButton(link, 'Open snag', 'open the snag in your browser'),
      approval: 'Bunnywell Portal snagging notification.' });
    return { subject, text, html };
  }

  const period = ukTime.format(new Date(context.periodStart!)) + ' to ' + ukTime.format(new Date(context.cutoffAt!));
  const subject = `${building} — Snagging activity digest`;
  const counts: [string, string][] = [
    ['New snags', String(context.created)],
    ['Currently awaiting information', String(context.awaitingInformation)],
    ['Snags closed', String(context.closed)],
    ['Other status changes', String(context.statusChanges)],
    ['Detail updates', String(context.updates)],
    ['Routine comments', String(context.comments)],
  ];
  const links = [
    ['Recently raised', snagLink(buildingId, { sort: 'raised-desc' })],
    ['Awaiting information', snagLink(buildingId, { status: 'needs_more_info' })],
    ['Closed snags', snagLink(buildingId, { status: 'closed' })],
  ];
  const summary = `${context.eventCount} recorded ${context.eventCount === 1 ? 'update' : 'updates'}`;
  const detailRows = details.map(detail => [`${eventLabels[detail.event]} · ${detail.title}`, detailLink(buildingId, detail.id)]);
  const htmlLinks = (rows: string[][]) => `<ul>${rows.map(([label, url]) =>
    `<li><a href="${escapeHtml(url)}">${escapeHtml(label)}</a></li>`).join('')}</ul>`;
  const text = [subject, period, summary, counts.map(row => row.join(': ')).join('\n'),
    ...detailRows.map(row => row.join(': ')), ...links.map(row => row.join(': '))].join('\n\n');
  const html = emailShell({ title: 'Snagging activity digest', subtitle: building,
    content: emailParagraph(period) + emailParagraph(summary) + emailDetails(counts)
      + (detailRows.length ? emailSection('Activity in this period', htmlLinks(detailRows)) : '')
      + emailSection('Open a filtered view', htmlLinks(links)),
    approval: 'Bunnywell Portal snagging digest.' });
  return { subject, html, text };
}
