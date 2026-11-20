export const notificationRoles = [
  { id: 'developer', label: 'Developers' },
  { id: 'sales_agent', label: 'Sales Agents' },
  { id: 'conveyancer', label: 'Conveyancers' },
] as const;
export type NotificationRole = typeof notificationRoles[number]['id'];
export type NotificationEvent = { id: string; label: string; kind: 'roles' | 'mention'; roles: NotificationRole[]; enabled: boolean };
export type EmailNotificationSettings = { version: number; events: NotificationEvent[]; updatedAt: string | null };
export type NotificationCandidate = {
  userId: string; email: string; roles: NotificationRole[]; active: boolean;
  canAccessSale: boolean; canViewComment: boolean; mentioned: boolean;
};
export type NotificationContext = {
  settings: EmailNotificationSettings; saleId: string; commentId: string | null;
  candidates: NotificationCandidate[];
};
export type NotificationRecipient = {
  userId: string; email: string; saleId: string; commentId: string | null;
  eventIds: string[]; reasons: ('role' | 'mention')[];
};

/** Pure selection over trusted server-loaded facts; never accepts browser-supplied access. */
export function selectEmailNotificationRecipients(context: NotificationContext, eventId: string): NotificationRecipient[] {
  const event = context.settings.events.find(item => item.id === eventId);
  if (!event) throw Error('Unknown email notification event.');
  const isComment = eventId === 'comment_added' || event.kind === 'mention';
  if (isComment && !context.commentId) throw Error('A comment is required for this notification.');
  if (!isComment && context.commentId) throw Error('This event does not accept a comment.');
  const mentions = context.settings.events.find(item => item.id === 'comment_mentioned');
  const recipients = new Map<string, NotificationRecipient>();
  for (const candidate of context.candidates) {
    if (!candidate.active || !candidate.canAccessSale || !candidate.email.trim() || (isComment && !candidate.canViewComment)) continue;
    const roleMatch = event.kind === 'roles' && candidate.roles.some(role => event.roles.includes(role));
    const mentionMatch = isComment && mentions?.enabled === true && candidate.mentioned;
    if (!roleMatch && !mentionMatch) continue;
    const recipient = recipients.get(candidate.userId) ?? {
      userId: candidate.userId, email: candidate.email, saleId: context.saleId,
      commentId: isComment ? context.commentId : null, eventIds: [], reasons: [],
    };
    if (roleMatch) { recipient.eventIds.push(event.id); recipient.reasons.push('role'); }
    if (mentionMatch) { recipient.eventIds.push('comment_mentioned'); recipient.reasons.push('mention'); }
    recipient.eventIds = [...new Set(recipient.eventIds)];
    recipient.reasons = [...new Set(recipient.reasons)];
    recipients.set(candidate.userId, recipient);
  }
  return [...recipients.values()];
}
