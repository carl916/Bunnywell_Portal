import { randomUUID } from "node:crypto";
import { gzipSync } from "node:zlib";

// Temporary Phase 2D probe. Explicit Preview flag + request opt-in + staging backend.
// No URLs, query values, credentials, error messages or response bodies are retained.
const operations = new Set([
  "profiles", "user_unit_access", "user_building_access", "building_organisations",
  "buildings", "units", "building_floors", "organisations", "unit_sale_attempts",
  "snags", "handovers", "unit_tenancies", "resident_access_requests", "unit_sale_documents",
  "sale_legal_emails", "sale_exchange_deposit_receipts", "sale_exchange_deposit_sources",
  "sale_workflow_context", "sale_actor_names", "unit_sale_invoices", "unit_sale_invoice_payments",
  "unit_sale_terms", "rental_arrears_episodes", "rental_import_runs",
]);
type Stage = "auth.validate" | "profile.initial" | "access.initial" | "data" | "profile.final" | "access.final" | "derive";
type ReadSpan = {
  operation: string; stage: Stage; start: number; headers?: number; end?: number;
  status?: number; retry: number; page: number; batch: number; rows?: number;
  bodyStart?: number; bodyEnd?: number; bodyMs?: number; bytes?: number;
  upstreamMs?: number; attempts?: number; requestId?: string; ray?: string; error?: string;
};
const instance = randomUUID();
let invocations = 0;
let active = 0;
const round = (n: number) => Math.round(n * 100) / 100;
const numeric = (v: string | null) => v !== null && /^\d+(\.\d+)?$/.test(v) ? Number(v) : undefined;
const identifier = (v: string | null) => v && /^[a-zA-Z0-9:-]{1,100}$/.test(v) ? v : undefined;
function failure(error: unknown) {
  const e = error as { name?: string; code?: string; cause?: { code?: string } } | null;
  const code = e?.cause?.code ?? e?.code;
  return ["ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_SOCKET"].includes(code ?? "") ? code! : e?.name === "AbortError" ? "aborted" : "fetch_or_body_error";
}

export class DashboardReadDiagnostics {
  private readonly enabled = process.env.DASHBOARD_READ_DIAGNOSTICS === "1"
    && process.env.SALES_PERF_DIAGNOSTICS === "1" && process.env.VERCEL_ENV === "preview"
    && process.env.NEXT_PUBLIC_SUPABASE_URL === "https://vxkpvdtrldwwqiddoyof.supabase.co";
  private readonly started = performance.now();
  private readonly wallStarted = new Date().toISOString();
  private readonly id = randomUUID();
  private readonly spans: ReadSpan[] = [];
  private readonly stages: { stage: Stage; start: number }[] = [];
  private readonly batches = new Map<string, number>();
  private stage: Stage = "auth.validate";
  private allowed = false;
  private timer?: ReturnType<typeof setInterval>;
  private maxEventLoopLagMs = 0;
  private sequence = 0;
  private activeAtStart = 0;
  private readonly optedIn: boolean;
  constructor(request: Request, private readonly mode: "dashboard" | "sales-register", private readonly baseFetch: typeof fetch) {
    this.optedIn = this.enabled && request.headers.get("x-bunnywell-diagnostic") === "dashboard-tail";
    if (this.optedIn) {
      this.sequence = ++invocations; this.activeAtStart = ++active;
      let previous = performance.now();
      this.timer = setInterval(() => { const now = performance.now(); this.maxEventLoopLagMs = Math.max(this.maxEventLoopLagMs, now - previous - 50); previous = now; }, 50);
      this.timer.unref();
      this.setStage("auth.validate");
    }
  }
  authorize(role: string) { this.allowed = role === "admin" || role === "conveyancer"; }
  setStage(stage: Stage) {
    this.stage = stage;
    if (this.optedIn) this.stages.push({ stage, start: round(performance.now() - this.started) });
  }
  readonly fetch: typeof fetch = async (input, init) => {
    if (!this.optedIn || this.spans.length >= 120) return this.baseFetch(input, init);
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const name = url.pathname === "/auth/v1/user" ? "auth.validate" : url.pathname.split("/").at(-1) ?? "";
    const operation = name === "auth.validate" || operations.has(name) ? name : "other";
    const retry = numeric(new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined)).get("x-retry-count")) ?? 0;
    const offset = numeric(url.searchParams.get("offset")) ?? 0;
    const key = `${this.stage}.${operation}`;
    const batch = Math.max(1, (this.batches.get(key) ?? 0) + (offset === 0 && retry === 0 ? 1 : 0));
    this.batches.set(key, batch);
    const span: ReadSpan = { operation, stage: this.stage, start: round(performance.now() - this.started), retry, page: Math.floor(offset / 250) + 1, batch };
    this.spans.push(span);
    try {
      const response = await this.baseFetch(input, init);
      span.headers = round(performance.now() - this.started); span.status = response.status;
      span.upstreamMs = numeric(response.headers.get("x-envoy-upstream-service-time"));
      span.attempts = numeric(response.headers.get("x-envoy-attempt-count"));
      span.requestId = identifier(response.headers.get("sb-request-id"));
      span.ray = identifier(response.headers.get("cf-ray"));
      const range = response.headers.get("content-range")?.match(/^(\d+)-(\d+)\//);
      if (range) span.rows = Number(range[2]) - Number(range[1]) + 1;
      // Observe the SDK's normal consumption. Do not clone or eagerly read the body.
      for (const method of ["text", "json"] as const) {
        const consume = response[method].bind(response);
        Object.defineProperty(response, method, { configurable: true, value: async () => {
          const start = performance.now(); span.bodyStart = round(start - this.started);
          try {
            const value = await consume();
            if (typeof value === "string") span.bytes = Buffer.byteLength(value);
            else if (Array.isArray(value)) span.rows = value.length;
            return value;
          } catch (error) { span.error = failure(error); throw error; }
          finally { span.bodyEnd = span.end = round(performance.now() - this.started); span.bodyMs = round(performance.now() - start); }
        } });
      }
      return response;
    } catch (error) { span.error = failure(error); span.end = round(performance.now() - this.started); throw error; }
  };
  response<T extends Response>(response: T): T {
    if (this.timer) { clearInterval(this.timer); this.timer = undefined; active--; }
    if (this.optedIn && this.allowed && response.ok) {
      const trace = { version: 1, id: this.id, mode: this.mode, started: this.wallStarted,
        region: process.env.VERCEL_REGION === "fra1" ? "fra1" : process.env.VERCEL_REGION === "iad1" ? "iad1" : "other",
        instance, sequence: this.sequence, activeAtStart: this.activeAtStart, uptimeSeconds: round(process.uptime()),
        totalMs: round(performance.now() - this.started), maxEventLoopLagMs: round(this.maxEventLoopLagMs),
        truncated: this.spans.length >= 120, stages: this.stages, spans: this.spans };
      const encoded = gzipSync(JSON.stringify(trace)).toString("base64");
      response.headers.set("x-bunnywell-trace-id", this.id);
      // Bound diagnostic response headers even if the dataset grows. No ordinary-use logging.
      if (encoded.length <= 12000) response.headers.set("x-bunnywell-read-trace", encoded);
    }
    return response;
  }
}
