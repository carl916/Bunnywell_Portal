"use client";

import { useReportWebVitals } from "next/web-vitals";
import { vitalPayload, vitalRoute } from "@/lib/performance/web-vitals";

// A stable module-level callback avoids replay on React rerenders. Retain only
// numeric values, bounded to four metrics; metric IDs and entries are never kept.
const reported = new Map<string, number>();
let route: ReturnType<typeof vitalRoute> | undefined;
const report: Parameters<typeof useReportWebVitals>[0] = (metric) => {
  if (!["staging.bunnywell.co.uk", "localhost", "127.0.0.1"].includes(window.location.hostname)) return;
  route ??= vitalRoute(window.location.href);
  const payload = vitalPayload(metric, route);
  if (!payload || reported.get(payload.metric) === payload.value) return;
  reported.set(payload.metric, payload.value);
  // Never block a workflow, send credentials/referrers, retry or log failures.
  void fetch("/api/performance/vitals", { method: "POST", keepalive: true,
    credentials: "omit", referrerPolicy: "no-referrer",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
  }).catch(() => {});
};

export function StagingWebVitals() {
  useReportWebVitals(report);
  return null;
}
