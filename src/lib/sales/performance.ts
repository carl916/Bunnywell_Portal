// Opt-in, local diagnostics only. No payloads, identifiers, URLs or telemetry sink.
export const salesActions = ["sale.open", "progression.stage_change", "authority.preview_open", "authority.request", "authority.issue", "exchange.record", "completion.open", "completion.documents_select", "completion.documents_upload", "completion.documents_approve", "completion.documents_query", "completion.record", "legal.other"] as const;
export type SalesAction = typeof salesActions[number];
export type SalesPhase = "click" | "file_prepared" | "pending_visible" | "request_started" | "request_completed" | "context_reload_started" | "context_reload_completed" | "sales_reload_completed" | "portal_reload_completed" | "refresh_completed" | "ui_committed" | "ui_visible" | "error";
export type SalesMeasurement = { mark: (phase: SalesPhase) => void; painted: (phase: SalesPhase) => void; finish: () => void };
const inactive: SalesMeasurement = { mark() {}, painted() {}, finish() {} };
let sequence = 0;
const retained: { names: string[]; stop: () => void }[] = [];
const navigation = new Map<SalesAction, SalesMeasurement>();

export function beginSalesMeasurement(action: SalesAction): SalesMeasurement {
  if (typeof window === "undefined" || process.env.NEXT_PUBLIC_SALES_PERF_DIAGNOSTICS !== "1") return inactive;
  if (!["localhost", "127.0.0.1", "staging.bunnywell.co.uk"].includes(window.location.hostname) && !window.location.hostname.endsWith(".vercel.app")) return inactive;
  const prefix = `sales:${action}:${++sequence}`;
  const names: string[] = [];
  const started = performance.now();
  let finished = false;
  function mark(phase: SalesPhase) {
    if (finished) return;
    const name = `${prefix}:${phase}`;
    if (names.includes(name)) return;
    names.push(name);
    performance.mark(name);
    performance.measure(name, { start: started, end: performance.now() });
  }
  // Two animation frames approximate the next painted update, not physical display
  // latency. The journey independently checks the expected DOM outcome.
  function painted(phase: SalesPhase) { requestAnimationFrame(() => requestAnimationFrame(() => mark(phase))); }
  function finish() {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (finished) return;
      mark("ui_visible"); finished = true;
    }));
  }
  mark("click");
  // Bound unfinished/abandoned interactions too, including rapid navigation.
  retained.push({ names, stop: () => { finished = true; } });
  if (retained.length > 100) {
    const previous = retained.shift()!; previous.stop();
    for (const name of previous.names) { performance.clearMarks(name); performance.clearMeasures(name); }
  }
  const measurement = { mark, painted, finish };
  if (["sale.open", "progression.stage_change", "completion.open"].includes(action)) navigation.set(action, measurement);
  return measurement;
}

export function salesNavigationReady() {
  for (const measurement of navigation.values()) { measurement.mark("ui_committed"); measurement.finish(); }
  navigation.clear();
}

export function legalPerformanceAction(action: unknown): SalesAction {
  switch (action) {
    case "preview": return "authority.preview_open";
    case "send": case "retry_email": return "authority.issue";
    case "request_authority": case "request_notice_authority": return "authority.request";
    case "confirm_exchange": return "exchange.record";
    case "upload_completion_documents": return "completion.documents_upload";
    case "approve_completion_package": return "completion.documents_approve";
    case "query_completion_package": return "completion.documents_query";
    case "confirm_completion": return "completion.record";
    default: return "legal.other";
  }
}
