// Disabled by default. Enable only for an explicitly configured diagnostic run.
// Durations cover remote service round trips, not pure PostgreSQL execution time.
type Phase = "auth" | "db_read" | "db_mutation" | "storage_upload" | "storage_cleanup" | "email_delivery" | "remote_other" | "multipart_parse" | "file_prepare";
export class SalesServerTiming {
  private readonly started = performance.now();
  private readonly entries = new Map<Phase, { duration: number; count: number; completed: number }>();
  private readonly enabled = process.env.SALES_PERF_DIAGNOSTICS === "1" && process.env.VERCEL_ENV !== "production";
  async measure<T>(phase: Phase, work: () => PromiseLike<T>): Promise<T> {
    if (!this.enabled) return await work();
    const start = performance.now();
    try { return await work(); }
    finally {
      const previous = this.entries.get(phase);
      this.entries.set(phase, { duration: (previous?.duration ?? 0) + performance.now() - start, count: (previous?.count ?? 0) + 1, completed: performance.now() - this.started });
    }
  }
  readonly fetch: typeof fetch = async (input, init) => {
    if (!this.enabled) return fetch(input, init);
    // Inspect only routing metadata; never retain URLs, bodies, headers or errors.
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    let phase: Phase = "remote_other";
    if (url.pathname.startsWith("/auth/")) phase = "auth";
    else if (url.pathname.startsWith("/storage/")) phase = method === "DELETE" ? "storage_cleanup" : "storage_upload";
    else if (url.hostname === "api.resend.com") phase = "email_delivery";
    else if (url.pathname.startsWith("/rest/")) {
      const mutation = /\/(sales_legal_action|sales_legal_dispatch|sales_legal_prepare_email|sales_legal_expire|sales_completion_upload|sales_legal_submit_notice|sales_legal_register_document)$/.test(url.pathname);
      phase = mutation || !url.pathname.includes("/rpc/") && !["GET", "HEAD"].includes(method) ? "db_mutation" : "db_read";
    }
    return this.measure(phase, () => fetch(input, init));
  };
  response<T extends Response>(response: T): T {
    if (this.enabled) {
      const entries = [`route;dur=${(performance.now() - this.started).toFixed(2)}`];
      for (const [phase, value] of this.entries) {
        entries.push(`${phase};dur=${value.duration.toFixed(2)};desc="${value.count} calls"`, `${phase}_end;dur=${value.completed.toFixed(2)};desc="offset from route entry"`);
      }
      response.headers.set("Server-Timing", entries.join(", "));
    }
    return response;
  }
}
