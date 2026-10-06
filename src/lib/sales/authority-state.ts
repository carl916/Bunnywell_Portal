import { authorityStatus, type LegalEmail } from "./legal-workflow";

export type AuthorityRequestEvent = { event_type: string; created_at: string; created_by_user_id: string | null; actor_name?: string | null };

export function authorityBadge(email: LegalEmail, now: number) {
  const status = authorityStatus(email, now);
  return status === "Authority issued" ? "Active" : status === "Authority expired" ? "Expired" : status === "Authority revoked" ? "Revoked" : status === "Authority replaced" ? "Superseded" : status;
}

export function exchangeAuthorityState(emails: LegalEmail[], events: AuthorityRequestEvent[], requestedAt: string | null, exchanged: boolean, now: number) {
  const versions = emails.filter(email => email.kind === "authority").sort((a, b) => b.version - a.version);
  const current = versions.find(email => email.exchanged_at) ?? versions[0];
  const previous = versions.find(email => email.version < (current?.version ?? 0));
  const requests = events.filter(event => event.event_type === "authority_requested").sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  const latestRequestAt = requests[0]?.created_at ?? requestedAt;
  const invalidatedAt = current ? Math.min(...[current.revoked_at, current.expires_at].filter((value): value is string => Boolean(value)).map(Date.parse)) : Infinity;
  const pending = Boolean(latestRequestAt && (!current || Date.parse(latestRequestAt) >= invalidatedAt));
  const request = pending ? requests[0] : requests.find(event => (!current || Date.parse(event.created_at) <= Date.parse(current.issued_at)) && (!previous || Date.parse(event.created_at) > Date.parse(previous.issued_at)));
  const requestDate = request?.created_at ?? (requestedAt && (!previous || Date.parse(requestedAt) > Date.parse(previous.issued_at)) ? requestedAt : null);
  const expiredOrRevoked = Boolean(current && (current.revoked_at || current.expires_at && Date.parse(current.expires_at) <= now));
  const issued = Boolean(current && (current.sent_at || current.resend_message_id || current.exchanged_at || ["sent", "delivered", "delivery_delayed", "opened", "clicked"].includes(current.delivery_status)));
  const hasLiveAuthority = versions.some(email => !email.revoked_at && !email.replaced_by && (!email.expires_at || Date.parse(email.expires_at) > now));
  const badge = current ? authorityBadge(current, now) : "Not issued";
  return { current, issued, badge, request, requestDate, pending, canRequest: !exchanged && !pending && !hasLiveAuthority && (!current || expiredOrRevoked && !current.replaced_by), renewal: Boolean(current) };
}
