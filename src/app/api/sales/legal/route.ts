import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createSupabaseServiceRoleClient, requiredEnv } from "@/lib/supabase/admin";
import { renderLegalEmail, SalesRecipientError, type LegalEmail, type LegalEmailKind, type LegalSnapshot } from "@/lib/sales/legal-workflow";
import { canPerformSalesAction } from "@/lib/sales/permissions";
import { noticeFileError, validNoticeDates } from "@/lib/sales/completion-notice";

const fail = (error: unknown) => NextResponse.json({
  error: error instanceof Error ? error.message : typeof error === "object" && error && "message" in error ? String(error.message) : "Legal workflow could not be completed.",
  ...(error instanceof SalesRecipientError ? { settingsUrl: error.settingsUrl } : {}),
}, { status: 400 });

function signature(value: unknown) {
  return createHmac("sha256", requiredEnv("SUPABASE_SERVICE_ROLE_KEY")).update(JSON.stringify(value)).digest("hex");
}
function sameSignature(actual: string, expected: string) {
  return /^[a-f0-9]{64}$/.test(actual) && timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expected, "hex"));
}
async function session(request: Request) {
  const client = createSupabaseServiceRoleClient();
  const token = request.headers.get("authorization")?.replace(/^Bearer /, "");
  if (!token) throw new Error("Sign in to use the legal workflow.");
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) throw new Error("Your session has expired. Sign in again.");
  const profile = await client.from("profiles").select("id,role,active").eq("id", data.user.id).single();
  if (profile.error || profile.data.active !== true) throw new Error("An active sales profile is required.");
  return { client, actor: data.user.id, role: String(profile.data.role) };
}

export async function GET(request: Request) {
  try {
    const { client, actor } = await session(request);
    const sale = new URL(request.url).searchParams.get("sale");
    if (!sale) throw new Error("Select a sale file.");
    const snapshot = await client.rpc("sales_legal_snapshot", { p_sale: sale, p_actor: actor });
    if (snapshot.error) throw snapshot.error;
    const expiry = await client.rpc("sales_legal_expire", { p_sale: sale, p_actor: actor });
    if (expiry.error) throw expiry.error;
    const [attempt, emails, documents, events, deposit, completionPackage] = await Promise.all([
      client.from("unit_sale_attempts").select("id,workflow_status,exchanged_at,completed_at,authority_requested_at,contractual_completion_date,completion_notice_issued_at,legal_completed_at,completion_authority_requested_at,completion_authority_requested_by,completion_authority_given_at,completion_authority_given_by,completion_arrangements_confirmed_at,completion_arrangements_confirmed_by,completion_legacy_stage").eq("id", sale).single(),
      client.from("sale_legal_emails").select("*").eq("sale_attempt_id", sale).order("issued_at", { ascending: false }),
      client.from("unit_sale_documents").select("*,unit_sale_document_versions!unit_sale_document_versions_document_id_fkey(*)").eq("sale_attempt_id", sale).in("document_type", ["completion_statement", "draft_statement_of_account", "statement_of_account", "completion_correspondence"]).is("redacted_at", null).is("superseded_at", null),
      client.from("unit_sale_workflow_events").select("id,event_type,actor_name,actor_role,created_by_user_id,created_at").eq("sale_attempt_id", sale).in("event_type", ["authority_requested", "exchange_recorded", "completion_recorded", "completion_documents_approved", "completion_arrangements_confirmed", "authority_notice_requested", "authority_notice_given", "completion_arrangements_dates_corrected"]).order("created_at", { ascending: false }),
      client.rpc("sales_exchange_deposit_context", { p_sale: sale, p_actor: actor }),
      client.rpc("sales_completion_package_context", { p_sale: sale, p_actor: actor }),
    ]);
    for (const result of [attempt, emails, documents, events, deposit, completionPackage]) if (result.error) throw result.error;
    const actorIds = [...new Set([...(events.data ?? []).map((event) => event.created_by_user_id), ...(documents.data ?? []).map((document) => document.approved_by_user_id), ...(documents.data ?? []).flatMap((document) => document.unit_sale_document_versions.map((version: { uploaded_by_user_id: string | null }) => version.uploaded_by_user_id))].filter(Boolean))];
    const actors = actorIds.length ? await client.from("profiles").select("id,full_name,name").in("id", actorIds) : { data: [], error: null };
    if (actors.error) throw actors.error;
    const visibleDocuments = (documents.data ?? []).map((document) => ({ ...document,
      unit_sale_document_versions: document.unit_sale_document_versions.filter((version: { redacted_at: string | null }) => !version.redacted_at),
    }));
    return NextResponse.json({ snapshot: snapshot.data, attempt: attempt.data, emails: emails.data, documents: visibleDocuments, events: events.data, actors: actors.data, deposit: deposit.data, completionPackage: completionPackage.data }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return fail(error); }
}

export async function POST(request: Request) {
  try {
    const { client, actor, role } = await session(request);
    if (request.headers.get("content-type")?.includes("multipart/form-data")) {
      if (!canPerformSalesAction(role, "submit_completion_documents")) throw new Error("Only conveyancers can upload legal completion documents.");
      const form = await request.formData();
      const sale = String(form.get("sale") || "");
      const type = String(form.get("documentType") || "");
      const action = String(form.get("action") || "");
      if (action === "upload_completion_documents") {
        const files = form.getAll("files");
        const assignments = JSON.parse(String(form.get("assignments") || "[]")) as { type: string; expectedVersionId: string | null }[];
        const requestId = String(form.get("requestId") || "");
        if (!/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(requestId)) throw new Error("A submission reference is required.");
        if (files.length < 1 || files.length > 2 || !Array.isArray(assignments) || assignments.length !== files.length || new Set(assignments.map(item => item?.type)).size !== files.length || assignments.some(item => !["completion_statement", "draft_statement_of_account"].includes(item?.type))) throw new Error("Assign one or two PDFs to different completion document types.");
        const prepared = await Promise.all(files.map(async (file, index) => {
          if (!(file instanceof File) || noticeFileError(file)) throw new Error("Choose PDFs up to 10 MB each.");
          const bytes = new Uint8Array(await file.arrayBuffer());
          if (new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-") throw new Error("Every selected file must be a PDF.");
          return { bytes, name: file.name, size: file.size, mime: "application/pdf", type: assignments[index].type, expectedVersionId: assignments[index].expectedVersionId };
        }));
        const snapshot = await client.rpc("sales_legal_snapshot", { p_sale: sale, p_actor: actor });
        if (snapshot.error) throw snapshot.error;
        const uploaded: { type: string; expectedVersionId: string | null; path: string; name: string; size: number; mime: string }[] = [];
        async function removeUnregistered(paths: string[]) {
          for (const path of paths) {
            const saved = await client.from("unit_sale_document_versions").select("id").eq("storage_path", path);
            if (!saved.error && saved.data?.length === 0) await client.storage.from("sale-documents").remove([path]);
          }
        }
        try {
          for (const { bytes, ...file } of prepared) {
            const path = `${snapshot.data.building.id}/${sale}/completion-${crypto.randomUUID()}.pdf`;
            const result = await client.storage.from("sale-documents").upload(path, bytes, { contentType: "application/pdf", upsert: false });
            if (result.error) throw result.error;
            uploaded.push({ ...file, path });
          }
          const result = await client.rpc("sales_completion_upload", { p_sale: sale, p_actor: actor, p_request: requestId, p_files: uploaded });
          if (result.error) throw result.error;
          await removeUnregistered(uploaded.map(file => file.path));
          return NextResponse.json({ documents: result.data });
        } catch (error) {
          await removeUnregistered(uploaded.map(file => file.path));
          throw error;
        }
      }
      const noticeSubmission = action === "confirm_notice" || action === "replace_notice";
      if (type === "completion_correspondence" && !noticeSubmission) throw new Error("Submit both dates and the notice PDF together.");
      if (noticeSubmission && type !== "completion_correspondence") throw new Error("Choose the notice PDF.");
      const noticeDate = String(form.get("noticeDate") || "");
      const dueDate = String(form.get("date") || "");
      if (action === "confirm_notice" && !validNoticeDates(noticeDate, dueDate)) throw new Error("Enter both dates. Completion due date cannot be earlier than the notice issue date.");
      const submissionId = String(form.get("requestId") || "");
      if (noticeSubmission && !/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(submissionId)) throw new Error("A submission reference is required.");
      const file = form.get("file");
      if (!(file instanceof File) || noticeFileError(file)) throw new Error("Choose a PDF up to 10 MB.");
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-") throw new Error("The selected file is not a PDF.");
      const snapshot = await client.rpc("sales_legal_snapshot", { p_sale: sale, p_actor: actor });
      if (snapshot.error) throw snapshot.error;
      const path = `${snapshot.data.building.id}/${sale}/legal-${crypto.randomUUID()}.pdf`;
      const upload = await client.storage.from("sale-documents").upload(path, bytes, { contentType: "application/pdf", upsert: false });
      if (upload.error) throw upload.error;
      const fileDetails = { path, name: file.name, size: file.size, mime: "application/pdf" };
      const registered = noticeSubmission
        ? await client.rpc("sales_legal_submit_notice", { p_sale: sale, p_actor: actor, p_request: submissionId, p_file: fileDetails,
          p_notice: noticeDate || null, p_due: dueDate || null, p_replace: action === "replace_notice", p_expected: String(form.get("expectedVersionId") || "") || null })
        : await client.rpc("sales_legal_register_document", { p_sale: sale, p_actor: actor, p_type: type, p_file: fileDetails });
      if (registered.error) {
        // A lost RPC response may follow a committed transaction. Never delete a
        // file that a saved version references; uncertain cleanup stays private.
        const saved = await client.from("unit_sale_document_versions").select("id").eq("storage_path", path);
        if (!saved.error && saved.data?.length === 0) await client.storage.from("sale-documents").remove([path]);
        throw registered.error;
      }
      if (noticeSubmission && registered.data.path !== path) await client.storage.from("sale-documents").remove([path]);
      return NextResponse.json(noticeSubmission ? registered.data : { versionId: registered.data });
    }
    const payload = await request.json();
    const sale = String(payload.sale || "");
    const action = String(payload.action || "");
    // This RPC applies the existing building access rule, also for service calls.
    const snapshotResult = await client.rpc("sales_legal_snapshot", { p_sale: sale, p_actor: actor });
    if (snapshotResult.error) throw snapshotResult.error;
    const snapshot = snapshotResult.data as LegalSnapshot;
    if (["preview", "send", "retry_email", "refresh_delivery"].includes(action)) {
      if (!canPerformSalesAction(role, "approve_exchange")) throw new Error("Only authorised developer users can issue instructions.");
      if (action === "refresh_delivery") {
        const found = await client.from("sale_legal_emails").select("*").eq("sale_attempt_id", sale).eq("id", payload.emailId).single();
        if (found.error) throw found.error;
        const email = found.data as LegalEmail;
        if (!email.resend_message_id) throw new Error("No Resend message ID is recorded yet. Retry the original email to reconcile an interrupted send.");
        const response = await fetch(`https://api.resend.com/emails/${encodeURIComponent(email.resend_message_id)}`, { headers: { Authorization: `Bearer ${requiredEnv("RESEND_API_KEY")}` }, signal: AbortSignal.timeout(20000) });
        if (!response.ok) throw new Error("Resend delivery status could not be retrieved.");
        const result = await response.json();
        const update = await client.rpc("sales_legal_dispatch", { p_id: email.id, p_actor: actor, p_status: result.last_event ?? "sent", p_message_id: email.resend_message_id });
        if (update.error) throw update.error;
        return NextResponse.json({ email: update.data });
      }
      let email: LegalEmail;
      if (action === "retry_email") {
        const result = await client.from("sale_legal_emails").select("*").eq("id", payload.emailId).eq("sale_attempt_id", sale).single();
        if (result.error) throw result.error;
        email = result.data as LegalEmail;
      } else {
        const kind: LegalEmailKind = payload.kind === "authority" ? "authority" : payload.kind === "notice_authority" ? "notice_authority" : (() => { throw new Error("Choose an instruction type."); })();
        const date = kind === "notice_authority" ? "" : String(payload.date || new Date(Date.now() + 48 * 3600000).toISOString());
        const rendered = renderLegalEmail(snapshot, kind, date);
        const from = process.env.SALES_FROM_EMAIL || process.env.DIGEST_FROM_EMAIL || "Bunnywell Portal <no-reply@bunnywell.co.uk>";
        const preview = { sale, kind, date, snapshot, ...rendered, from };
        if (action === "preview") return NextResponse.json({ ...preview, token: signature(preview) });
        if (!sameSignature(String(payload.token || ""), signature(preview))) throw new Error("Sale details, recipients or sender changed. Review a fresh preview before sending.");
        requiredEnv("RESEND_API_KEY");
        if (process.env.DIGEST_DRY_RUN_EMAIL) throw new Error("Legal instructions are disabled while email dry-run routing is configured.");
        const result = await client.rpc("sales_legal_prepare_email", { p_sale: sale, p_actor: actor, p_id: payload.requestId, p_kind: kind, p_snapshot: snapshot, p_email: { ...rendered, from }, p_date: date });
        if (result.error) throw result.error;
        email = result.data as LegalEmail;
      }
      requiredEnv("RESEND_API_KEY");
      if (process.env.DIGEST_DRY_RUN_EMAIL) throw new Error("Legal instructions are disabled while email dry-run routing is configured.");
      const claimed = await client.rpc("sales_legal_dispatch", { p_id: email.id, p_actor: actor, p_status: "sending" });
      if (claimed.error) throw claimed.error;
      if (claimed.data.resend_message_id) return NextResponse.json({ email: claimed.data });
      let response: Response;
      try {
        response = await fetch("https://api.resend.com/emails", {
          method: "POST", headers: { Authorization: `Bearer ${requiredEnv("RESEND_API_KEY")}`, "Content-Type": "application/json", "Idempotency-Key": `sales-legal/${email.id}` },
          body: JSON.stringify({ from: email.sending_address, to: email.to_recipients, cc: email.cc_recipients, subject: email.subject, text: email.body, ...(email.html_body ? { html: email.html_body } : {}) }), signal: AbortSignal.timeout(25000),
        });
      } catch {
        const result = await client.rpc("sales_legal_dispatch", { p_id: email.id, p_actor: actor, p_status: "unknown" });
        if (result.error) throw result.error;
        throw new Error("Email delivery is uncertain. Use Retry email in its history to reconcile the same message safely.");
      }
      if (!response.ok) {
        const update = await client.rpc("sales_legal_dispatch", { p_id: email.id, p_actor: actor, p_status: response.status >= 500 || response.status === 409 ? "unknown" : "failed" });
        if (update.error) throw update.error;
        throw new Error(`Resend did not confirm sending (HTTP ${response.status}). Retry the recorded email from its history.`);
      }
      const sent = await response.json();
      const result = await client.rpc("sales_legal_dispatch", { p_id: email.id, p_actor: actor, p_status: "sent", p_message_id: sent.id });
      if (result.error) throw new Error("Resend accepted this email, but its receipt could not be saved. Retry the recorded email to reconcile it without sending a duplicate.");
      return NextResponse.json({ email: result.data });
    }
    const permission = action === "request_authority" || action === "request_notice_authority" ? "request_exchange_approval" : action === "confirm_exchange" ? "record_exchange"
      : action === "confirm_exchange_deposit" || action === "correct_exchange_deposit_date" ? "confirm_exchange_deposit"
      : action === "correct_completion_dates" ? "confirm_completion_arrangements" : action === "confirm_completion" ? "record_completion"
      : action === "revoke_authority" || action === "cancel_instruction" || action === "cancel_notice_authority" ? "approve_exchange" : ["approve_statement", "query_statement", "approve_completion_package", "query_completion_package"].includes(action) ? "approve_completion_documents" : null;
    if (!permission || !canPerformSalesAction(role, permission)) throw new Error("Your role cannot perform this legal action.");
    const result = await client.rpc("sales_legal_action", { p_sale: sale, p_actor: actor, p_action: action, p_payload: payload });
    if (result.error) throw result.error;
    return NextResponse.json(result.data);
  } catch (error) { return fail(error); }
}
