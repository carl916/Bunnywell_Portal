import 'server-only';
import { randomUUID } from 'node:crypto';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/admin';
import { renderSnagNotification, type SnagDeliveryContext } from './snag-notification-email';
import { hostedStaging, stagingEnabled, stagingOrigin } from './staging';
import { readStagingEmailStatus, redirectStagingEmail, requireStagingEmailConfiguration, stagingEmailFailure,
  submitStagingEmail, type ProviderPayload } from './staging-email';

type SnagDelivery = {
  id: string;
  providerId: string | null;
  providerPayload: ProviderPayload | null;
  context: SnagDeliveryContext | null;
};

export async function dispatchSnagNotifications() {
  if (!hostedStaging || !stagingEnabled()) throw Error('Staging delivery is unavailable.');
  const worker = randomUUID();
  const rpc = 'workspace_snag_notification_worker';
  const guarded: typeof fetch = async (input, options) => {
    const target = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const body = typeof options?.body === 'string' ? JSON.parse(options.body) : null;
    if (target !== stagingOrigin + '/rest/v1/rpc/' + rpc || options?.method?.toUpperCase() !== 'POST'
      || body?.p_worker !== worker) throw Error('Snagging delivery database boundary rejected.');
    return fetch(input, { ...options, redirect: 'error' });
  };
  const client = createSupabaseServiceRoleClient(guarded);
  async function command(action: string, payload: Record<string, unknown> = {}) {
    const { data, error } = await client.rpc(rpc, { p_worker: worker, p_action: action, p_payload: payload });
    if (error) throw Error(`Snagging delivery ${action} failed (${error.code}).`);
    return data;
  }

  const deadline = Date.now() + 35_000;
  const prepared = await command('prepare') as { events: number; digests: number } | null;
  const results: Record<string, number> = {};
  const record = (status: string) => { results[status] = (results[status] ?? 0) + 1; };
  let poll = true;
  for (let index = 0; index < 30 && Date.now() < deadline; index++) {
    const delivery = await command('claim', { poll }) as SnagDelivery | null;
    if (!delivery) break;
    const { id, providerId, context } = delivery;
    try {
      if (providerId) {
        poll = false;
        const config = requireStagingEmailConfiguration(process.env);
        const status = await readStagingEmailStatus(providerId, config.key);
        await command('result', { id, providerId, ...status });
        record(status.status === 'accepted' ? 'awaiting_confirmation' : status.status);
        continue;
      }

      const mail = context ? renderSnagNotification(context) : null;
      const capture = { id, revision: context?.revision, mail };
      if (!context || !mail) {
        const result = await command('release_for_send', capture);
        record(result.status);
        continue;
      }
      let config;
      try {
        config = requireStagingEmailConfiguration(process.env);
      } catch (error) {
        const result = await command('release_for_send', capture);
        if (result.captured) throw error;
        record(result.status);
        continue;
      }
      const intended = { to: [context.recipient], cc: [], bcc: [] };
      const providerPayload = delivery.providerPayload ?? redirectStagingEmail(mail, intended, config.from);
      const release = await command('release_for_send', { ...capture, providerPayload });
      if (!release.send) {
        record(release.status);
        continue;
      }
      const acceptedId = await submitStagingEmail(release.payload, config.key, release.idempotencyKey);
      await command('result', { id, status: 'accepted', providerId: acceptedId });
      record('accepted');
    } catch (error) {
      const failure = stagingEmailFailure(error);
      const result = await command('result', { id, providerId, ...failure, status: providerId ? 'accepted' : failure.status });
      record(providerId ? 'awaiting_confirmation' : result.status);
    }
  }
  return { events: prepared?.events ?? 0, digests: prepared?.digests ?? 0, delivery: results };
}
