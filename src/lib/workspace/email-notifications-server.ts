import 'server-only';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/admin';
import { validId } from '@/lib/experiments/building-contracts/contracts';
import { ReadError, type Viewer } from './server';
import { operationsFetch } from './operations-fetch';
import { moduleAllowed, stagingEnabled, stagingOrigin } from './staging';
import { selectEmailNotificationRecipients, type EmailNotificationSettings, type NotificationContext } from './email-notifications';

export async function emailNotificationSettings(viewer: Viewer): Promise<EmailNotificationSettings> {
  if (!moduleAllowed(viewer.profile.role, 'setup')) throw new ReadError('System-wide settings require Setup administration access.');
  const client = createSupabaseServiceRoleClient(operationsFetch(viewer.profile.id, {}, true), viewer.profile.id);
  const result = await client.rpc('workspace_email_notification_settings', { p_actor: viewer.profile.id });
  if (result.error) throw new ReadError('Email notification settings could not be loaded.', 503);
  return result.data;
}

/** Stage 2 entry point. Selection only: no mail provider, outbox or delivery side effects. */
export async function resolveEmailNotificationRecipients(eventId: string, saleId: string, commentId: string | null = null) {
  if (!stagingEnabled()) throw new ReadError('Notification selection is unavailable.', 404);
  if (!validId(saleId) || (commentId !== null && !validId(commentId))) throw new ReadError('An exact sale and valid comment are required.', 400);
  const guardedFetch: typeof fetch = async (input, options) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const body = options?.body ?? (input instanceof Request ? await input.clone().text() : null);
    const args = typeof body === 'string' ? JSON.parse(body) : {};
    if (url.href !== stagingOrigin + '/rest/v1/rpc/workspace_email_notification_context'
      || (options?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase() !== 'POST'
      || args.p_sale !== saleId || args.p_comment !== commentId) throw Error('Notification selection egress rejected.');
    return fetch(input, { ...options, redirect: 'error' });
  };
  const client = createSupabaseServiceRoleClient(guardedFetch);
  const result = await client.rpc('workspace_email_notification_context', { p_sale: saleId, p_comment: commentId });
  if (result.error) throw new ReadError('Notification recipients could not be resolved.', 503);
  return selectEmailNotificationRecipients(result.data as NotificationContext, eventId);
}
