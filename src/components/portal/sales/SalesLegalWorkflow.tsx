"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { authorityStatus, authorityTerms, legalDateTime, resolveSalesRecipients, SalesRecipientError, type LegalEmail, type LegalSnapshot } from "@/lib/sales/legal-workflow";
import { canPerformSalesAction } from "@/lib/sales/permissions";
import { PdfUploadBox, type UploadVersion } from "./PdfUploadBox";
import { workflowActorLabel, type ActorProfile } from "@/lib/sales/actor-identity";

type Version = UploadVersion & { id: string; version_number: number; is_current: boolean; redacted_at: string | null };
type Document = { id: string; document_type: string; status: string; query_note: string | null; approved_version_id: string | null; approved_by_user_id?: string | null; approved_at: string | null; unit_sale_document_versions: Version[] };
type Context = {
  snapshot: LegalSnapshot; emails: LegalEmail[]; documents: Document[];
  events?: { event_type: string; actor_name?: string | null; created_by_user_id: string | null; created_at: string }[];
  actors?: ActorProfile[];
  attempt: { workflow_status: string; exchanged_at: string | null; completed_at: string | null; authority_requested_at: string | null; contractual_completion_date: string | null; completion_notice_issued_at: string | null; legal_completed_at: string | null };
};
type Preview = { kind: "authority" | "completion_instruction"; date: string; to: string[]; cc: string[]; subject: string; body: string; from: string; token: string; snapshot: LegalSnapshot };
type Failure = { message: string; settingsUrl?: string };
const localTime = (value: number) => { const date = new Date(value); return new Date(value - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
const shortDate = (value?: string | null) => value ? new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString("en-GB") : "Not recorded";

async function headers() {
  const { data, error } = await createSupabaseBrowserClient().auth.getSession();
  if (error || !data.session) throw new Error("Sign in again to continue.");
  return { Authorization: `Bearer ${data.session.access_token}` };
}
async function legalRequest<T>(sale: string, body?: Record<string, unknown> | FormData): Promise<T> {
  const response = await fetch(`/api/sales/legal${body ? "" : `?sale=${encodeURIComponent(sale)}`}`, {
    method: body ? "POST" : "GET", headers: { ...await headers(), ...(body && !(body instanceof FormData) ? { "Content-Type": "application/json" } : {}) },
    body: body instanceof FormData ? body : body ? JSON.stringify({ ...body, sale }) : undefined,
  });
  const result = await response.json();
  if (!response.ok) throw Object.assign(new Error(result.error || "Legal action failed."), { settingsUrl: result.settingsUrl });
  return result as T;
}

export function SalesLegalWorkflow({ saleId, stage, role, onNotice, onChanged }: {
  saleId: string; stage: "exchange" | "completion"; role: string; onNotice: (message: string) => void; onChanged: () => Promise<void>;
}) {
  const [context, setContext] = useState<Context | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [expiry, setExpiry] = useState(() => localTime(Date.now() + 48 * 3600000));
  const [expiryEdited, setExpiryEdited] = useState(false);
  const [proposed, setProposed] = useState("");
  const [confirmedDate, setConfirmedDate] = useState("");
  const [noticeDate, setNoticeDate] = useState("");
  const [exchangeDate, setExchangeDate] = useState("");
  const [deposit, setDeposit] = useState(false);
  const [completedTime, setCompletedTime] = useState("");
  const [legalConfirmed, setLegalConfirmed] = useState(false);
  const [reason, setReason] = useState("");
  const [query, setQuery] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [approvedPreview, setApprovedPreview] = useState(false);
  const requestId = useRef("");
  const [now, setNow] = useState(Date.now);
  const previewRef = useRef<HTMLDivElement>(null);
  const load = useCallback(async () => {
    const result = await legalRequest<Context>(saleId);
    setContext(result);
  }, [saleId]);
  useEffect(() => { let active = true; legalRequest<Context>(saleId).then((result) => { if (active) setContext(result); }).catch((error) => { if (active) setFailure(error); }); return () => { active = false; }; }, [saleId]);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(timer); }, []);
  useEffect(() => { if (preview) previewRef.current?.focus(); }, [preview]);

  async function run(body: Record<string, unknown> | FormData, message: string) {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setFailure(null);
    try {
      await legalRequest(saleId, body);
      setPreview(null); setApprovedPreview(false);
      await load(); await onChanged(); onNotice(message);
    } catch (error) {
      setFailure(error instanceof Error ? error : { message: "Legal action failed." });
      await load().catch(() => {});
    } finally { inFlight.current = false; setBusy(false); }
  }
  async function showPreview() {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setFailure(null); setApprovedPreview(false);
    try {
      const date = stage === "exchange" ? expiryEdited ? new Date(expiry).toISOString() : new Date(Date.now() + 48 * 3600000).toISOString() : proposed;
      if (stage === "exchange" && !expiryEdited) setExpiry(localTime(Date.parse(date)));
      const result = await legalRequest<Preview>(saleId, { action: "preview", kind: stage === "exchange" ? "authority" : "completion_instruction", date });
      requestId.current = crypto.randomUUID(); setPreview(result);
    } catch (error) { setFailure(error instanceof Error ? error : { message: "Email preview could not be loaded." }); }
    finally { inFlight.current = false; setBusy(false); }
  }

  if (!context?.attempt) return <section className="border-t border-[#d9ded6] py-5" aria-live="polite">{failure ? <p role="alert">{failure.message} <button className="secondary" onClick={() => void load().catch(setFailure)}>Retry</button></p> : "Loading legal workflow…"}</section>;
  const { attempt, snapshot, emails, documents } = context;
  const latestAuthority = emails.find((email) => email.kind === "authority");
  const authorityState = attempt.exchanged_at ? "Exchanged" : latestAuthority ? authorityStatus(latestAuthority, now) : attempt.authority_requested_at ? "Authority requested" : "Authority not requested";
  const canIssue = canPerformSalesAction(role, "approve_exchange");
  const conveyancer = canPerformSalesAction(role, "record_exchange");
  const reservationApproved = ["approved", "reservation_approved", "awaiting_commercial_approval", "ready_for_exchange", "exchanged", "completion_pending", "completed"].includes(attempt.workflow_status);
  const exchanged = Boolean(attempt.exchanged_at) || ["exchanged", "completion_pending", "completed"].includes(attempt.workflow_status);
  const completed = Boolean(attempt.completed_at) || attempt.workflow_status === "completed";
  const statement = documents.find((document) => document.document_type === "completion_statement");
  const currentVersion = statement?.unit_sale_document_versions.find((version) => version.is_current && !version.redacted_at);
  const statementApproved = Boolean(currentVersion && statement?.status === "approved" && statement.approved_version_id === currentVersion.id);
  const actorLabel = (type: string, fallback?: string | null) => workflowActorLabel(context.events?.find((event) => event.event_type === type), context.actors ?? [], fallback);
  const instruction = emails.find((email) => email.kind === "completion_instruction" && email.resend_message_id && !email.revoked_at);
  let routingProblem: SalesRecipientError | null = null;
  try { resolveSalesRecipients(snapshot, stage === "exchange" ? "authority" : "completion_instruction"); }
  catch (error) { if (error instanceof SalesRecipientError) routingProblem = error; }

  return <section id={`sales-stage-${stage}`} className="min-w-0 border-t border-[#d9ded6] py-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-xl font-bold text-[#0F3D2E]">{stage === "exchange" ? "Exchange" : "Completion"}</h3><span className="text-sm font-semibold">{stage === "exchange" ? authorityState : completed ? "Legally completed" : "Completion arrangements"}</span></div>
    <p className="mt-1 text-sm text-[#617169]">{snapshot.building.name} · Plot {snapshot.plot} · {snapshot.buyer}</p>
    {failure && <p className="my-4 text-sm text-red-800" role="alert">{failure.message} {failure.settingsUrl && <a className="underline" href={failure.settingsUrl}>Open settings</a>}</p>}
    {routingProblem && canIssue && !completed && <p className="my-4 text-sm text-amber-800">{routingProblem.message} <a className="underline" href={routingProblem.settingsUrl}>Open settings</a></p>}
    {stage === "exchange" ? <ol className="mt-5 divide-y divide-[#d9ded6]" aria-label="Exchange tasks">
      <li className="py-5"><h4 className="font-bold">1. Authority requested</h4><p className="mt-1 text-sm">A sales agent or conveyancer requests developer review. A request does not authorise exchange.</p>
        {attempt.authority_requested_at && <p className="mt-2 text-sm">Requested {legalDateTime(attempt.authority_requested_at)}</p>}
        {!exchanged && !attempt.authority_requested_at && canPerformSalesAction(role, "request_exchange_approval") && <button className="secondary mt-3" disabled={busy || !reservationApproved} onClick={() => void run({ action: "request_authority" }, "Exchange authority requested. The developer has been notified.")}>Request authority to exchange</button>}
      </li>
      <li className="py-5"><h4 className="font-bold">2. Authority issued</h4><p className="mt-1 text-sm">{exchanged ? "The terms authorised for exchange are retained below." : "The developer reviews the agreed sale terms and issues time-limited authority."}</p>
        <dl className="mt-4 divide-y divide-[#eef0eb]">{authorityTerms(exchanged && latestAuthority ? latestAuthority.snapshot : snapshot).map(([label, value], index) => <div className="grid gap-1 py-2 text-sm sm:grid-cols-[13rem_1fr]" key={`${label}-${index}`}><dt className="text-[#617169]">{label}</dt><dd className="min-w-0 whitespace-pre-wrap font-medium [overflow-wrap:anywhere]">{value}</dd></div>)}</dl>
        {latestAuthority && <p className="mt-3 text-sm">Version {latestAuthority.version} · {authorityStatus(latestAuthority, now)} · Expires {latestAuthority.expires_at && legalDateTime(latestAuthority.expires_at)}</p>}
        {exchanged && !latestAuthority && <p className="mt-3 text-sm">Exchange predates versioned authority records. Existing sale dates and approval history are retained.</p>}
        {!exchanged && canIssue && <div className="mt-4 grid gap-3">
          <label className="field-label">Authority expiry date and time (your local time)<input className="field max-w-md" type="datetime-local" value={expiry} onChange={(event) => { setExpiry(event.target.value); setExpiryEdited(true); setPreview(null); }} /></label>
          <button className="primary w-fit" disabled={busy || !reservationApproved || !expiry || Boolean(routingProblem)} onClick={() => void showPreview()}>{latestAuthority ? "Review reissued authority and email" : "Review authority and email"}</button>
          {latestAuthority && !latestAuthority.revoked_at && !latestAuthority.replaced_by && <div className="mt-2 border-t pt-3"><label className="field-label">Revocation reason<textarea className="field" value={reason} onChange={(event) => setReason(event.target.value)} /></label><button className="danger-button mt-2" disabled={busy || !reason.trim()} onClick={() => void run({ action: "revoke_authority", emailId: latestAuthority.id, reason }, "Authority revoked. Its complete history is retained.")}>Revoke authority</button></div>}
        </div>}
      </li>
      <li className="py-5"><h4 className="font-bold">3. Exchange confirmed</h4>{exchanged ? <p className="mt-2 text-sm">Actual exchange date: {shortDate(attempt.exchanged_at)} · Recorded by {actorLabel("exchange_recorded")}</p> : <>
        <p className="mt-1 text-sm">The conveyancer confirms exchange against the current, unexpired authority.</p>
        {conveyancer && <div className="mt-3 grid gap-3"><label className="field-label">Actual exchange date<input className="field max-w-md" type="date" value={exchangeDate} max={new Date().toISOString().slice(0, 10)} onChange={(event) => setExchangeDate(event.target.value)} /></label>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={deposit} onChange={(event) => setDeposit(event.target.checked)} />I confirm the exchange deposit has been received in line with the authorised terms.</label>
          <button className="primary w-fit" disabled={busy || !deposit || !exchangeDate || authorityState !== "Authority issued"} onClick={() => void run({ action: "confirm_exchange", date: exchangeDate, depositConfirmed: deposit }, "Exchange confirmed.")}>Confirm exchange</button></div>}
      </>}</li>
    </ol> : <ol className="mt-5 divide-y divide-[#d9ded6]" aria-label="Completion tasks">
      <li className="py-5"><h4 className="font-bold">1. Completion arrangements</h4><p className="mt-1 text-sm">The developer proposes a date and asks the conveyancer to take the appropriate contractual steps. It remains proposed until confirmed.</p>
        {instruction && <p className="mt-2 text-sm">Proposed completion: {shortDate(instruction.proposed_completion_date)}</p>}
        {canIssue && !completed && <div className="mt-3 grid gap-3"><label className="field-label">Proposed completion date<input className="field max-w-md" type="date" value={proposed} onChange={(event) => { setProposed(event.target.value); setPreview(null); }} /></label><button className="primary w-fit" disabled={busy || !exchanged || !proposed || Boolean(routingProblem)} onClick={() => void showPreview()}>Review completion instruction and email</button></div>}
        {!exchanged && <p className="mt-2 text-sm text-amber-800">Confirm exchange before starting completion arrangements.</p>}
      </li>
      <li className="py-5"><h4 className="font-bold">2. Completion date confirmed</h4><p className="mt-2 text-sm">Contractual completion date: {shortDate(attempt.contractual_completion_date)}{attempt.contractual_completion_date && <> · Confirmed by {actorLabel("completion_arrangements_confirmed")}</>}</p>
        {attempt.completion_notice_issued_at && <p className="text-sm">Notice or confirmation issued: {shortDate(attempt.completion_notice_issued_at)}</p>}
        {conveyancer && exchanged && !completed && <div className="mt-3 grid gap-3"><label className="field-label">Confirmed contractual completion date<input className="field max-w-md" type="date" value={confirmedDate} onChange={(event) => setConfirmedDate(event.target.value)} /></label><label className="field-label">Notice or confirmation issue date (optional)<input className="field max-w-md" type="date" value={noticeDate} onChange={(event) => setNoticeDate(event.target.value)} /></label><button className="primary w-fit" disabled={busy || !instruction || !confirmedDate} onClick={() => void run({ action: "confirm_arrangements", date: confirmedDate, noticeDate }, "Contractual completion date confirmed.")}>Confirm completion arrangements</button></div>}
        <LegalDocument saleId={saleId} type="completion_correspondence" label="Notice or correspondence" document={documents.find((item) => item.document_type === "completion_correspondence")} editable={conveyancer && exchanged && !completed} busy={busy} run={run} />
      </li>
      <li className="py-5"><h4 className="font-bold">3. Completion statement</h4><p className="mt-1 text-sm">The developer approves a specific document version. A replacement always needs fresh approval.</p>
        <LegalDocument saleId={saleId} type="completion_statement" label="Draft completion statement" document={statement} editable={conveyancer && exchanged && !completed} busy={busy} run={run} />
        {statement?.query_note && <p className="mt-3 whitespace-pre-wrap text-sm text-red-800">Developer query: {statement.query_note}</p>}
        {(statementApproved || completed && statement?.status === "approved") && <p className="mt-3 text-sm font-semibold">{statementApproved ? `Version ${currentVersion?.version_number} approved` : "Historical completion statement approved"} · Approved by {actorLabel("completion_documents_approved", statement?.approved_by_user_id)}{statement?.approved_at ? ` · ${legalDateTime(statement.approved_at)}` : ""}</p>}
        {canIssue && currentVersion && !completed && <div className="mt-3 grid gap-3"><label className="field-label">Query or rejection comments<textarea className="field" value={query} onChange={(event) => setQuery(event.target.value)} /></label><div className="flex flex-wrap gap-2"><button className="danger-button" disabled={busy || !query.trim()} onClick={() => void run({ action: "query_statement", versionId: currentVersion.id, reason: query }, "Completion statement queried.")}>Query / reject version {currentVersion.version_number}</button><button className="primary" disabled={busy || statementApproved} onClick={() => void run({ action: "approve_statement", versionId: currentVersion.id }, "Completion statement version approved.")}>Approve version {currentVersion.version_number}</button></div></div>}
      </li>
      <li className="py-5"><h4 className="font-bold">4. Legal completion</h4>{completed ? <p className="mt-2 text-sm">Legal completion: {attempt.legal_completed_at ? legalDateTime(attempt.legal_completed_at) : `${shortDate(attempt.completed_at)} (historical date; time not recorded)`} · Completed by {actorLabel("completion_recorded")}. Handover and key release are available.</p> : <>
        <p className="mt-1 text-sm">Handover and keys remain locked until the conveyancer confirms legal completion.</p>
        {conveyancer && exchanged && <div className="mt-3 grid gap-3"><label className="field-label">Actual legal completion date and time (your local time)<input className="field max-w-md" type="datetime-local" value={completedTime} onChange={(event) => setCompletedTime(event.target.value)} /></label><label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={legalConfirmed} onChange={(event) => setLegalConfirmed(event.target.checked)} />I confirm legal completion has taken place and keys may be released.</label><button className="primary w-fit" disabled={busy || !statementApproved || !attempt.contractual_completion_date || !completedTime || !legalConfirmed} onClick={() => void run({ action: "confirm_completion", dateTime: new Date(completedTime).toISOString() }, "Legal completion confirmed. Handover is now available.")}>Confirm legal completion</button></div>}
      </>}
        <LegalDocument saleId={saleId} type="statement_of_account" label="Final statement of account" document={documents.find((item) => item.document_type === "statement_of_account")} editable={conveyancer && completed} busy={busy} run={run} />
      </li>
    </ol>}

    {preview && <div ref={previewRef} tabIndex={-1} className="my-5 border-y-2 border-[#D6A23A] bg-[#fffdf7] p-4" role="region" aria-label="Final confirmation and email preview">
      <h4 className="font-bold">Final confirmation and email preview</h4>
      <dl className="mt-3 grid gap-2 text-sm">{[["From", preview.from], ["To", preview.to.join(", ")], ["CC", preview.cc.join(", ") || "None"], ["Subject", preview.subject], ["Building", preview.snapshot.building.name], ["Plot", preview.snapshot.plot], ["Buyer", preview.snapshot.buyer]].map(([label, value]) => <div key={label} className="grid gap-1 sm:grid-cols-[6rem_1fr]"><dt className="font-semibold">{label}</dt><dd className="min-w-0 [overflow-wrap:anywhere]">{value}</dd></div>)}</dl>
      <pre className="my-4 whitespace-pre-wrap font-sans text-sm [overflow-wrap:anywhere]">{preview.body}</pre>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={approvedPreview} onChange={(event) => setApprovedPreview(event.target.checked)} />I have reviewed these terms, recipients and dates and approve issuing this instruction.</label>
      <div className="mt-4 flex flex-wrap gap-2"><button className="secondary" disabled={busy} onClick={() => setPreview(null)}>Cancel</button><button className="primary" disabled={busy || !approvedPreview} onClick={() => void run({ action: "send", kind: preview.kind, date: preview.date, token: preview.token, requestId: requestId.current }, preview.kind === "authority" ? "Authority to exchange issued." : "Completion instruction sent.")}>{preview.kind === "authority" ? "Issue authority to exchange" : "Send completion instruction"}</button></div>
    </div>}
    {emails.length > 0 && <details className="mt-4 border-t border-[#d9ded6] py-4"><summary className="cursor-pointer font-bold">Instruction and email history ({emails.length})</summary><ol className="divide-y divide-[#d9ded6]">{emails.map((email) => <li key={email.id} className="py-4 text-sm">
      <p className="font-semibold">{email.kind === "authority" ? "Authority" : "Completion instruction"} · Version {email.version} · {email.delivery_status}</p><p>Approved by {email.snapshot.approver.name} · {legalDateTime(email.issued_at)}</p>
      {email.kind === "authority" && <p>{authorityStatus(email, now)} · Expires {email.expires_at && legalDateTime(email.expires_at)}</p>}
      {email.revoked_at && <p>Revoked {legalDateTime(email.revoked_at)}{email.revocation_reason ? ` · ${email.revocation_reason}` : ""}</p>}{email.exchanged_at && <p>Actual exchange: {shortDate(email.exchanged_at)}</p>}
      <p className="break-all">To: {email.to_recipients.join(", ")} · CC: {email.cc_recipients.join(", ") || "None"}</p>
      <details className="mt-2"><summary className="cursor-pointer underline">View saved email and authorised terms</summary><p className="mt-2 break-all">From: {email.sending_address}</p><p>{email.subject}</p><pre className="mt-2 whitespace-pre-wrap font-sans [overflow-wrap:anywhere]">{email.body}</pre>{email.resend_message_id && <p className="mt-2 break-all">Resend message: {email.resend_message_id}</p>}</details>
      {canIssue && <div className="mt-3 flex flex-wrap gap-2">{!email.resend_message_id && !email.revoked_at && !email.replaced_by && <button className="secondary" disabled={busy} onClick={() => void run({ action: "retry_email", emailId: email.id }, "Email status reconciled.")}>Retry email</button>}{email.resend_message_id && <button className="secondary" disabled={busy} onClick={() => void run({ action: "refresh_delivery", emailId: email.id }, "Email delivery status refreshed.")}>Refresh delivery status</button>}</div>}
      {canIssue && !completed && email.kind === "completion_instruction" && !email.resend_message_id && !email.revoked_at && <div className="mt-3"><p>Check Resend before cancelling an uncertain send. Cancelling here cannot recall an email already sent.</p><label className="field-label mt-2">Cancellation reason<textarea className="field" value={reason} onChange={(event) => setReason(event.target.value)} /></label><button className="secondary mt-2" disabled={busy || !reason.trim()} onClick={() => void run({ action: "cancel_instruction", emailId: email.id, reason }, "Instruction cancelled. You can review and issue a replacement.")}>Cancel pending instruction</button></div>}
    </li>)}</ol></details>}
  </section>;
}

function LegalDocument({ saleId, type, label, document, editable, busy, run }: {
  saleId: string; type: string; label: string; document?: Document; editable: boolean; busy: boolean; run: (body: FormData, message: string) => Promise<void>;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const versions = document?.unit_sale_document_versions.filter((version) => !version.redacted_at).sort((a, b) => b.version_number - a.version_number) ?? [];
  const current = versions.find((version) => version.is_current);
  async function open(version: Version) {
    try {
      const response = await fetch(`/api/sales/reservations?versionId=${version.id}`, { headers: await headers() });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      window.open(result.signedUrl, "_blank", "noopener,noreferrer");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Document could not be opened."); }
  }
  function choose(value: File | null) {
    setError("");
    if (value && (!value.name.toLowerCase().endsWith(".pdf") || value.size > 10 * 1024 * 1024 || value.size === 0)) { setError("Choose a PDF up to 10 MB."); return; }
    setFile(value);
  }
  return <div className="mt-4 min-w-0">
    <h5 className="mb-2 text-sm font-semibold">{label}</h5>
    {error && <p role="alert" className="text-sm text-red-800">{error}</p>}
    {(editable || current) ? <PdfUploadBox id={`${saleId}-${type}`} label={`Choose ${label.toLowerCase()} PDF`} file={file} currentVersion={current} disabled={!editable || busy} onOpen={current ? () => void open(current) : undefined} onFile={choose} onClear={() => setFile(null)} /> : <p className="text-sm text-[#617169]">No document uploaded.</p>}
    {editable && file && <button className="secondary mt-3" disabled={busy} onClick={async () => { const form = new FormData(); form.set("sale", saleId); form.set("documentType", type); form.set("file", file); await run(form, `${label} version uploaded.`); setFile(null); }}>Upload {label.toLowerCase()}</button>}
    {versions.length > 1 && <details className="mt-3 text-sm"><summary className="cursor-pointer">Document versions</summary>{versions.map((version) => <div key={version.id} className="flex flex-wrap items-center justify-between gap-2 border-b py-2"><span className="break-all">Version {version.version_number} · {version.file_name}{version.is_current ? " · current" : ""}</span><button className="secondary" onClick={() => void open(version)}>View version {version.version_number}</button></div>)}</details>}
  </div>;
}
