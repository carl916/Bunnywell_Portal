export const vitalNames = ["INP", "LCP", "CLS", "TTFB"] as const;
export const vitalRatings = ["good", "needs-improvement", "poor"] as const;
export const vitalRoutes = ["portal", "request-access", "other"] as const;
export type VitalPayload = {
  metric: typeof vitalNames[number];
  value: number;
  rating: typeof vitalRatings[number];
  route: typeof vitalRoutes[number];
};

// Match paths exactly. Query strings, hashes and record IDs never enter labels.
export function vitalRoute(url: string): VitalPayload["route"] {
  const pathname = new URL(url).pathname;
  return pathname === "/" ? "portal" : pathname === "/request-access" ? "request-access" : "other";
}

export function vitalPayload(metric: { name: string; value: number; rating: string }, route: VitalPayload["route"]): VitalPayload | null {
  if (!vitalNames.includes(metric.name as VitalPayload["metric"]) ||
    !vitalRatings.includes(metric.rating as VitalPayload["rating"]) ||
    !vitalRoutes.includes(route) || !Number.isFinite(metric.value) || metric.value < 0) return null;
  return { metric: metric.name as VitalPayload["metric"], value: metric.value,
    rating: metric.rating as VitalPayload["rating"], route };
}

export function parseVitalPayload(input: unknown): VitalPayload | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const record = input as Record<string, unknown>;
  if (Object.keys(record).sort().join(",") !== "metric,rating,route,value" ||
    typeof record.metric !== "string" || typeof record.value !== "number" ||
    typeof record.rating !== "string" || typeof record.route !== "string") return null;
  return vitalPayload({ name: record.metric, value: record.value, rating: record.rating }, record.route as VitalPayload["route"]);
}

export function stagingVitalsEnabled(hostname: string): boolean {
  return process.env.STAGING_WEB_VITALS === "1" && (
    process.env.VERCEL_ENV === "preview" && hostname === "staging.bunnywell.co.uk" ||
    !process.env.VERCEL_ENV && process.env.SALES_PERF_LOCAL === "1" && ["localhost", "127.0.0.1"].includes(hostname)
  );
}
