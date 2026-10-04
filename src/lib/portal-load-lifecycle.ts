import { traceLoad } from "./performance/load-trace";

// Per-component ownership, never a cross-user cache. Only identical in-flight
// reads coalesce; explicit refresh and invalidation always supersede old work.
export function createLoadCoordinator(scope: string) {
  let revision = 0;
  let pending: { key: string; promise: Promise<void> } | null = null;
  return {
    invalidate() { revision++; pending = null; },
    run(key: string, event: string, work: (valid: () => boolean) => Promise<void>, force = false) {
      traceLoad(scope, event, "trigger");
      if (!force && pending?.key === key) {
        traceLoad(scope, event, "coalesced");
        return pending.promise;
      }
      const current = ++revision;
      const valid = () => current === revision;
      const promise = Promise.resolve().then(() => {
        if (!valid()) return;
        traceLoad(scope, event, "start");
        return work(valid);
      }).finally(() => {
        if (valid()) pending = null;
        traceLoad(scope, event, valid() ? "settled" : "discarded");
      });
      pending = { key, promise };
      return promise;
    },
  };
}

type SessionUser = { id: string };
type Session<U> = { user: U; access_token: string };

// Auth callbacks only record/schedule work; reads run outside Supabase's auth
// lock. Explicit getUser validation owns restoration, including INITIAL_SESSION.
export function createSessionLifecycle<U extends SessionUser>(options: {
  validate: () => Promise<U | null>;
  load: (user: U, event: string) => Promise<void>;
  clear: () => void;
  invalidate: () => void;
  recheck?: (user: U) => Promise<boolean>;
  error: (error: unknown) => void;
}) {
  let alive = true, restored = false, epoch = 0;
  let latest: Session<U> | null | undefined;
  let identity: string | null = null;
  let appliedToken: string | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  async function apply(session: Session<U>, event: string) {
    if (!alive) return;
    const current = epoch;
    if (identity === session.user.id && appliedToken === session.access_token && event !== "USER_UPDATED") {
      traceLoad("auth", event, "duplicate");
      if (event !== "SIGNED_IN" || !options.recheck || !await options.recheck(session.user)) return;
    }
    if (!alive || current !== epoch) return;
    // Validate a new principal with Auth rather than trusting stored session data.
    const verified = identity === session.user.id ? session.user : await options.validate();
    if (!alive || current !== epoch || verified?.id !== session.user.id) return;
    if (identity && identity !== verified.id) options.clear();
    identity = verified.id;
    appliedToken = session.access_token;
    try { await options.load(verified, `auth:${event}`); }
    catch (error) { if (alive && current === epoch) { appliedToken = null; options.error(error); } }
  }
  return {
    observe(event: string, session: Session<U> | null) {
      traceLoad("auth", event, "trigger");
      const changed = latest?.user.id !== session?.user.id || latest?.access_token !== session?.access_token;
      if (changed || event === "SIGNED_OUT" || event === "USER_UPDATED") { epoch++; if (restored) options.invalidate(); }
      latest = session;
      if (!session) {
        if (event === "SIGNED_OUT") { identity = null; appliedToken = null; options.clear(); }
        return;
      }
      if (!restored) return;
      clearTimeout(timer);
      timer = setTimeout(() => { void apply(session, event).catch(options.error); }, 0);
    },
    async restore() {
      const user = await options.validate();
      if (!alive) return;
      restored = true;
      if (latest === null) { options.clear(); return; }
      if (latest && latest.user.id !== user?.id) { await apply(latest, "SIGNED_IN"); return; }
      if (!user) { options.clear(); return; }
      identity = user.id;
      appliedToken = latest?.access_token ?? null;
      const current = epoch;
      try { await options.load(user, "session-restoration"); }
      catch (error) { if (alive && current === epoch) { appliedToken = null; throw error; } }
    },
    dispose() { alive = false; epoch++; clearTimeout(timer); },
  };
}

// Stable membership detects equal-count replacements, but ignores sorting,
// price/status edits and units outside the selected building.
export function salesMembershipKey(units: { id: string }[]) {
  return JSON.stringify(units.map(unit => unit.id).sort());
}
