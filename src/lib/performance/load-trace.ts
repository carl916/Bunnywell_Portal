import type { SupabaseClient } from "@supabase/supabase-js";

type LoadTrace = { scope: string; event: string; phase: string; resource?: string; at: number };
declare global {
  interface Window { portalLoadTrace?: LoadTrace[]; portalLoadTracing?: boolean }
}

// Opt-in, bounded, browser-local diagnostics. Never include identifiers, query
// parameters, tokens or business rows, and never send diagnostic telemetry.
export function traceLoad(scope: string, event: string, phase: string, resource?: string) {
  if (typeof window === "undefined" || !window.portalLoadTracing) return;
  const rows = window.portalLoadTrace ??= [];
  rows.push({ scope, event, phase, ...(resource ? { resource } : {}), at: performance.now() });
  if (rows.length > 2000) rows.shift();
}

export function tracedClient(client: SupabaseClient, scope: string, event: string): SupabaseClient {
  function query<T extends object>(target: T, resource: string): T {
    return new Proxy(target, { get(object, key) {
      const value = Reflect.get(object, key);
      if (key === "then") return (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => {
        traceLoad(scope, event, "request", resource);
        return Reflect.apply(value as (...args: unknown[]) => unknown, object, [resolve, reject]);
      };
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        const result = value.apply(object, args);
        return result && typeof result === "object" ? query(result, resource) : result;
      };
    } });
  }
  return new Proxy(client, { get(object, key) {
    if (key === "from" || key === "rpc") return (resource: string, ...args: unknown[]) =>
      query(Reflect.apply(Reflect.get(object, key), object, [resource, ...args]), resource);
    const value = Reflect.get(object, key);
    return typeof value === "function" ? value.bind(object) : value;
  } });
}
