import { parseVitalPayload, stagingVitalsEnabled } from "@/lib/performance/web-vitals";

export async function POST(request: Request) {
  const url = new URL(request.url);
  const headers = { "Cache-Control": "no-store" };
  if (!stagingVitalsEnabled(url.hostname)) return new Response(null, { status: 404, headers });
  // Refuse cross-origin browser submissions; the collector itself omits Referer.
  const origin = request.headers.get("origin");
  if (origin && origin !== url.origin || request.headers.get("sec-fetch-site") === "cross-site") return new Response(null, { status: 403, headers });
  if (!request.headers.get("content-type")?.startsWith("application/json")) return new Response(null, { status: 415, headers });
  // Bound the read even when Content-Length is absent or forged.
  const reader = request.body?.getReader();
  if (!reader) return new Response(null, { status: 400, headers });
  try {
    let text = "";
    let bytes = 0;
    const decoder = new TextDecoder();
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 512) { await reader.cancel(); return new Response(null, { status: 413, headers }); }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    const payload = parseVitalPayload(JSON.parse(text));
    if (!payload) return new Response(null, { status: 400, headers });
    // Approved staging destination: existing Vercel runtime logs. No request,
    // actor, URL, IP, user agent, cookies or metric entries are logged.
    console.info(JSON.stringify(payload));
    return new Response(null, { status: 204, headers });
  } catch {
    return new Response(null, { status: 400, headers });
  } finally {
    reader.releaseLock();
  }
}
