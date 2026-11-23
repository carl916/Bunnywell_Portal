import { openDatabase } from "./database.ts";
import { Google } from "./google.ts";
import { STAGING_URL, uuid } from "./model.ts";
import { runBackups, safeError, type Scope } from "./run.ts";

const encoder = new TextEncoder();

async function authorized(header: string | null, secret: string | undefined) {
  if (!secret || secret.length < 32 || !header?.startsWith("Bearer ") || header.length > 512) return false;
  const [expected, actual] = await Promise.all([secret, header.slice(7)].map(async (value) =>
    new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)))));
  let difference = 0;
  for (let i = 0; i < expected.length; i++) difference |= expected[i] ^ actual[i];
  return difference === 0;
}

function response(status: number, body: object) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function parseScope(text: string): Scope {
  const body = text ? JSON.parse(text) : {};
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some((key) => !["buildingId", "kind"].includes(key))) throw Error();
  if (body.buildingId !== undefined && (typeof body.buildingId !== "string" || !uuid.test(body.buildingId))) throw Error();
  if (body.kind !== undefined && body.kind !== "sales" && body.kind !== "defects") throw Error();
  return { buildingId: body.buildingId ?? null, kind: body.kind ?? null };
}

Deno.serve(async (request) => {
  if (Deno.env.get("SUPABASE_URL") !== STAGING_URL) return response(404, { status: "unavailable" });
  if (request.method !== "POST") return response(405, { status: "method_not_allowed" });
  if (!await authorized(request.headers.get("Authorization"), Deno.env.get("SHEETS_BACKUP_TRIGGER_SECRET"))) {
    return response(401, { status: "unauthorized" });
  }
  let scope: Scope;
  try {
    const body = await request.text();
    if (body.length > 512) throw Error();
    scope = parseScope(body);
  } catch { return response(400, { status: "invalid_scope" }); }

  let db;
  try {
    db = openDatabase(Deno.env.get("SHEETS_BACKUP_DATABASE_URL"));
    const signal = AbortSignal.timeout(105_000);
    let google: Google;
    const results = await runBackups(db, () => google ??= new Google(Deno.env.get("SHEETS_BACKUP_GOOGLE_SERVICE_ACCOUNT"), signal), scope);
    if (results.length === 0) return response(404, { status: "no_enabled_targets" });
    if (results.every(({ status }) => status === "succeeded")) return response(200, { status: "succeeded", results });
    if (results.some(({ status }) => status === "succeeded")) return response(207, { status: "partial", results });
    if (results.every(({ status }) => status === "busy")) return response(409, { status: "busy", results });
    return response(502, { status: "failed", results });
  } catch (cause) {
    const error = safeError(cause);
    console.error(JSON.stringify({ component: "portal-sheets-backup", error }));
    return response(503, { status: "failed", error });
  } finally {
    await db?.close().catch(() => console.error(JSON.stringify({ component: "portal-sheets-backup", error: "Could not close the database connection." })));
  }
});
