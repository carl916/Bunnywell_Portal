import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { approvedLocalEnvironment } from "@/lib/experiments/building-integration/local-environment";
import { documentActions, permittedCompletionAction, recordScope } from "@/lib/experiments/building-integration/completion-boundary";
import { uploadUuid } from "@/lib/sales/completion-upload";

export const dynamic = "force-dynamic";
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
function enabled() {
  return process.env.NODE_ENV === "development" && process.env.BUILDING_WORKSPACE_LOCAL === "1" &&
    process.env.BUILDING_COMPLETION_LOCAL === "1" && process.env.BUNNYWELL_LOCAL_EGRESS_GUARD === "1";
}
async function context(request: Request, supplied: unknown) {
  const scope = recordScope(supplied);
  const status = JSON.parse(readFileSync("local-runtime/status.json", "utf8").replace(/^\uFEFF/, ""));
  if (status.API_URL !== approvedLocalEnvironment.apiOrigin ||
      process.env.NEXT_PUBLIC_SUPABASE_URL !== status.API_URL ||
      process.env.SUPABASE_SERVICE_ROLE_KEY !== status.SERVICE_ROLE_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY !== status.ANON_KEY) throw Error("Local environment mismatch.");
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) throw Error("Sign in to the local workspace.");
  const client = createClient(status.API_URL, status.ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: authorization } },
  });
  const user = await client.auth.getUser(authorization.slice(7));
  if (user.error || !user.data.user) throw Error("Session expired. Sign in again.");
  const profile = await client.from("profiles").select("id,role,active").eq("id", user.data.user.id).single();
  if (profile.error || !profile.data.active) throw Error("Active account required.");
  const sale = await client.from("unit_sale_attempts").select("id,building_id,unit_id,is_active")
    .eq("id", scope.saleId).eq("building_id", scope.buildingId).eq("unit_id", scope.unitId)
    .eq("is_active", true).is("redacted_at", null).single();
  if (sale.error || !sale.data) throw Error("This building, unit and active sale attempt are unavailable.");
  return { scope, client, authorization, status };
}
export async function POST(request: Request) {
  if (!enabled()) return json({ error: "Unavailable" }, 404);
  try {
    if (request.headers.get("origin") !== approvedLocalEnvironment.appOrigin) return json({ error: "Local origin required." }, 403);
    if (!request.headers.get("content-type")?.startsWith("application/json")) return json({ error: "JSON metadata required." }, 415);
    const body = await request.text();
    if (body.length > 24000) return json({ error: "Request too large." }, 413);
    const payload = JSON.parse(body);
    if (!permittedCompletionAction(payload.action)) return json({ error: "Action unavailable in this local review." }, 403);
    const c = await context(request, payload.scope);
    if (documentActions.includes(payload.action)) {
      // Existing route owns role validation, PDF validation, version locks,
      // atomic upload/review transactions and workflow/activity writes.
      const { POST: existingLegalAction } = await import("@/app/api/sales/legal/route");
      const response = await existingLegalAction(new Request(request.url, {
        method: "POST", headers: { Authorization: c.authorization, "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, sale: c.scope.saleId }),
      }));
      response.headers.set("Cache-Control", "no-store");
      return response;
    }
    if (typeof payload.body !== "string" || !uploadUuid(payload.clientId)) throw Error("Comment text and submission reference required.");
    // Existing discussion RPC owns membership, length, idempotency and actor attribution.
    // Mentions, edits, assignments and read receipts are deliberately not exposed.
    const result = await c.client.rpc("sale_comment_write", {
      p_sale: c.scope.saleId, p_body: payload.body, p_client: payload.clientId, p_mentions: [],
    });
    if (result.error) throw result.error;
    return json({ id: result.data });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : (error as { message?: string })?.message || "Completion action failed." }, 400);
  }
}
export async function GET(request: Request) {
  if (!enabled()) return json({ error: "Unavailable" }, 404);
  try {
    const p = new URL(request.url).searchParams;
    const c = await context(request, { buildingId: p.get("building"), unitId: p.get("unit"), saleId: p.get("sale") });
    const kind = p.get("kind");
    if (kind === "comments" || kind === "activity") {
      const args: Record<string, unknown> = { p_sale: c.scope.saleId };
      if (kind === "comments") {
        args.p_unit = c.scope.unitId;
        if (p.has("target")) { if (!uploadUuid(p.get("target"))) throw Error("Invalid target."); args.p_target = p.get("target"); }
        if (p.has("after")) { const n = Number(p.get("after")); if (!Number.isSafeInteger(n) || n < 0) throw Error("Invalid cursor."); args.p_after = n; }
        if (p.has("before")) { const n = Number(p.get("before")); if (!Number.isSafeInteger(n) || n < 1) throw Error("Invalid cursor."); args.p_before = n; }
      } else if (p.has("beforeId")) {
        if (!uploadUuid(p.get("beforeId")) || !Number.isFinite(Date.parse(p.get("beforeTime") || ""))) throw Error("Invalid cursor.");
        args.p_before_id = p.get("beforeId"); args.p_before_time = p.get("beforeTime");
      }
      const result = await c.client.rpc(kind === "comments" ? "sale_comment_page" : "sale_activity_page", args);
      if (result.error) throw result.error;
      return json(result.data);
    }
    if (kind !== "document" || !uploadUuid(p.get("version"))) return json({ error: "Read unavailable." }, 400);
    const version = await c.client.from("unit_sale_document_versions")
      .select("id,storage_bucket,storage_path,file_name,document_id").eq("id", p.get("version")).is("redacted_at", null).single();
    if (version.error || !version.data || version.data.storage_bucket !== "sale-documents") throw Error("Document unavailable.");
    const document = await c.client.from("unit_sale_documents").select("id,document_type")
      .eq("id", version.data.document_id).eq("sale_attempt_id", c.scope.saleId)
      .in("document_type", ["completion_statement", "draft_statement_of_account", "completion_correspondence"])
      .is("redacted_at", null).is("superseded_at", null).single();
    if (document.error || !document.data) throw Error("Document unavailable on this sale.");
    const service = createClient(c.status.API_URL, c.status.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const bucket = service.storage.from("sale-documents");
    if ((await bucket.info(version.data.storage_path)).error) throw Error("File unavailable: this earlier synthetic record contains metadata only. Upload an eligible replacement through the normal workflow.");
    // Existing signer owns discussion membership, document visibility and current building access.
    const { GET: existingDocumentLink } = await import("@/app/api/sales/reservations/route");
    const linkUrl = new URL(request.url);
    linkUrl.search = new URLSearchParams({ versionId: version.data.id, discussionSaleId: c.scope.saleId }).toString();
    const signedResponse = await existingDocumentLink(new Request(linkUrl, { headers: { Authorization: c.authorization } }));
    const signed = await signedResponse.json();
    if (!signedResponse.ok) throw Error(signed.error || "Document access denied.");
    if (new URL(signed.signedUrl).origin !== approvedLocalEnvironment.apiOrigin) throw Error("Unexpected document origin.");
    return json({ url: signed.signedUrl, fileName: signed.fileName });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : (error as { message?: string })?.message || "Completion read failed." }, 400);
  }
}
