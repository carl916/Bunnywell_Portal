import type { SalesRegisterSnapshot } from "./register";

export type RegisterState = {
  snapshot: SalesRegisterSnapshot | null;
  error: string;
  revoked: boolean;
  refreshing: boolean;
};
export class RegisterAccessError extends Error {}

// One memory-only session per mounted, access-scoped Sales workspace. No shared cache.
export function createSalesRegisterSession(load: (signal: AbortSignal) => Promise<SalesRegisterSnapshot>) {
  let state: RegisterState = { snapshot: null, error: "", revoked: false, refreshing: true };
  const listeners = new Set<() => void>();
  let mounted = false, visible = false, explicitRefresh = false;
  let revision = 0, loadedRevision = -1, lastLoaded = 0;
  let active: AbortController | null = null;
  let scheduled: ReturnType<typeof setTimeout> | undefined;
  let activeTimeout: ReturnType<typeof setTimeout> | undefined;
  const publish = (patch: Partial<RegisterState>) => {
    state = { ...state, ...patch };
    listeners.forEach(notify => notify());
  };
  const needsRefresh = (age: number) => !state.snapshot || Boolean(state.error) || loadedRevision !== revision || Date.now() - lastLoaded >= age;
  const schedule = () => {
    if (!mounted || (!visible && !explicitRefresh) || document.visibilityState === "hidden" || active || scheduled !== undefined) return;
    // Related synchronous events share a request; invalidations during it share one follow-up.
    scheduled = setTimeout(() => { scheduled = undefined; void refresh(); }, 0);
  };
  async function refresh() {
    if (!mounted || (!visible && !explicitRefresh) || document.visibilityState === "hidden" || active) return;
    explicitRefresh = false;
    const controller = new AbortController();
    active = controller;
    const requestedRevision = revision;
    publish({ refreshing: true });
    const timeout = setTimeout(() => controller.abort(), 30_000);
    activeTimeout = timeout;
    try {
      const snapshot = await load(controller.signal);
      if (active !== controller || !mounted) return;
      if (controller.signal.aborted) throw new Error("Sales refresh timed out. Use Refresh to retry.");
      // A response started before a mutation cannot validate that mutation or advance freshness.
      if (requestedRevision === revision) {
        lastLoaded = Date.now();
        loadedRevision = requestedRevision;
        publish({ snapshot, error: "", revoked: false });
      }
    } catch (cause) {
      if (active !== controller || !mounted) return;
      const error = cause instanceof Error && cause.name !== "AbortError" ? cause.message : "Sales refresh timed out. Use Refresh to retry.";
      publish(cause instanceof RegisterAccessError ? { snapshot: null, revoked: true, error } : { error });
    } finally {
      clearTimeout(timeout);
      if (active === controller) {
        active = null; activeTimeout = undefined;
        publish({ refreshing: false });
        // Do not loop on errors. Only newer changes justify an automatic follow-up.
        if (requestedRevision !== revision) schedule();
      }
    }
  }
  return {
    getSnapshot: () => state,
    subscribe(notify: () => void) { listeners.add(notify); return () => { listeners.delete(notify); }; },
    start() { mounted = true; },
    stop() {
      mounted = false;
      clearTimeout(scheduled); scheduled = undefined;
      clearTimeout(activeTimeout); activeTimeout = undefined;
      active?.abort(); active = null;
      lastLoaded = 0; loadedRevision = -1; explicitRefresh = false;
      state = { snapshot: null, error: "", revoked: false, refreshing: true };
    },
    show(value: boolean) {
      visible = value;
      if (value && needsRefresh(60_000)) schedule();
    },
    invalidate() { revision++; schedule(); },
    refreshNow() { explicitRefresh = true; revision++; schedule(); },
    wake() { if (needsRefresh(15_000)) schedule(); },
    online() { revision++; schedule(); },
    revoke(message = "Sign in to see Sales.") {
      revision++;
      clearTimeout(scheduled); scheduled = undefined;
      clearTimeout(activeTimeout); activeTimeout = undefined;
      active?.abort(); active = null;
      lastLoaded = 0; loadedRevision = -1; explicitRefresh = false;
      publish({ snapshot: null, revoked: true, refreshing: false, error: message });
    },
  };
}
