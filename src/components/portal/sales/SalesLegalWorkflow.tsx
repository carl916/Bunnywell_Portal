"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { authorityStatus, authorityTerms, legalDateTime, resolveSalesRecipients, SalesRecipientError, type LegalEmail, type LegalSnapshot } from "@/lib/sales/legal-workflow";
import { canPerformSalesAction } from "@/lib/sales/permissions";
import { PdfUploadBox, type UploadVersion } from "./PdfUploadBox";
import { CompletionDocuments, currentCompletionVersion, type CompletionPackage } from "./CompletionDocuments";
import { ExchangeDepositReceipt, type ExchangeDepositContext } from "./ExchangeDepositReceipt";
import { authorityBadge, exchangeAuthorityState } from "@/lib/sales/authority-state";
import { workflowActorLabel, type ActorProfile } from "@/lib/sales/actor-identity";
import { addWorkingDays, completionNoticeState, noticeFileError, validNoticeDates, type CompletionNoticeState } from "@/lib/sales/completion-notice";
import { beginSalesMeasurement, legalPerformanceAction, salesNavigationReady, type SalesMeasurement } from "@/lib/sales/performance";

type Version = UploadVersion & { id: string; version_number: number; is_current: boolean; redacted_at: string | null };
type Document = { id: string; document_type: string; status: string; query_note: string | null; approved_version_id: string | null; approved_by_user_id?: string | null; approved_at: string | null; unit_sale_document_versions: Version[] };
type Context = {
  snapshot: LegalSnapshot; emails: LegalEmail[]; documents: Document[];
  deposit?: ExchangeDepositContext;
  completionPackage?: CompletionPackage;
  events?: { event_type: string; actor_name?: string | null; created_by_user_id: string | null; created_at: string }[];
  actors?: ActorProfile[];
  attempt: CompletionNoticeState & { workflow_status: string; exchanged_at: string | null; completed_at: string | null; authority_requested_at: string | null; contractual_completion_date: string | null; completion_notice_issued_at: string | null; legal_completed_at: string | null;
    completion_authority_requested_at?: string | null; completion_authority_requested_by?: string | null; completion_authority_given_by?: string | null; completion_arrangements_confirmed_by?: string | null };
};
type Preview = { kind: "authority" | "notice_authority"; date: string; to: string[]; cc: string[]; subject: string; body: string; html?: string; from: string; token: string; snapshot: LegalSnapshot };
type Run = (body: Record<string, unknown> | FormData, message: string, measurement?: SalesMeasurement) => Promise<boolean>;
type Failure = { message: string; settingsUrl?: string };
const localTime = (value: number) => { const date = new Date(value); return new Date(value - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
const shortDate = (value?: string | null) => value ? new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString("en-GB") : "Not recorded";

async function headers() {
  const { data, error } = await createSupabaseBrowserClient().auth.getSession();
  if (error || !data.session) throw new Error("Sign in again to continue.");
  return { Authorization: `Bearer ${data.session.access_token}` };
}
async function legalRequest<T>(sale: string, body?: Record<string, unknown> | FormData, measurement?: SalesMeasurement): Promise<T> {
  const authorization = await headers();
  measurement?.mark("request_started");
  const response = await fetch(`/api/sales/legal${body ? "" : `?sale=${encodeURIComponent(sale)}`}`, {
    method: body ? "POST" : "GET", headers: { ...authorization, ...(body && !(body instanceof FormData) ? { "Content-Type": "application/json" } : {}) },
    body: body instanceof FormData ? body : body ? JSON.stringify({ ...body, sale }) : undefined,
  });
  const result = await response.json().finally(() => measurement?.mark("request_completed"));
  if (!response.ok) throw Object.assign(new Error(result.error || "Legal action failed."), { settingsUrl: result.settingsUrl });
  return result as T;
}

export function SalesLegalWorkflow({ saleId, stage, role, onNotice, onChanged }: {
  saleId: string; stage: "exchange" | "completion"; role: string; onNotice: (message: string) => void; onChanged: (measurement?: SalesMeasurement) => Promise<void>;
}) {
  const [context, setContext] = useState<Context | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [noticeReviewFailure, setNoticeReviewFailure] = useState<Failure | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const measurementRef = useRef<SalesMeasurement | null>(null);
  const [expiry, setExpiry] = useState(() => localTime(Date.now() + 48 * 3600000));
  const [expiryEdited, setExpiryEdited] = useState(false);
  const [exchangeDate, setExchangeDate] = useState("");
  const [completedTime, setCompletedTime] = useState("");
  const [legalConfirmed, setLegalConfirmed] = useState(false);
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [approvedPreview, setApprovedPreview] = useState(false);
  const requestId = useRef("");
  const [now, setNow] = useState(Date.now);
  const previewRef = useRef<HTMLDivElement>(null);
  const noticeReviewButtonRef = useRef<HTMLButtonElement>(null);
  const noticePreviewId = `notice-authority-preview-${saleId}`;
  const load = useCallback(async () => {
    const result = await legalRequest<Context>(saleId);
    setContext(result);
  }, [saleId]);
  useEffect(() => { let active = true; legalRequest<Context>(saleId).then((result) => { if (active) setContext(result); }).catch((error) => { if (active) setFailure(error); }); return () => { active = false; }; }, [saleId]);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(timer); }, []);
  useEffect(() => { if (preview) previewRef.current?.focus(); }, [preview]);
  useEffect(() => { if (busy) measurementRef.current?.painted("pending_visible"); }, [busy]);
  useEffect(() => { if (context) salesNavigationReady(); }, [context, stage]);

  async function run(body: Record<string, unknown> | FormData, message: string, measurement?: SalesMeasurement, prepare?: () => Promise<void>) {
    if (inFlight.current) return false;
    const timing = measurement ?? beginSalesMeasurement(legalPerformanceAction(body instanceof FormData ? body.get("action") : body.action));
    measurementRef.current = timing;
    inFlight.current = true; setBusy(true); setFailure(null); setNoticeReviewFailure(null);
    try {
      await prepare?.();
      await legalRequest(saleId, body, timing);
      setPreview(null); setApprovedPreview(false);
      timing.mark("context_reload_started");
      await load(); timing.mark("context_reload_completed");
      await onChanged(timing); timing.mark("refresh_completed"); onNotice(message);
      return true;
    } catch (error) {
      timing.mark("error");
      const problem = error instanceof Error ? error : { message: "Legal action failed." };
      if (!(body instanceof FormData) && body.action === "send" && body.kind === "notice_authority") setNoticeReviewFailure(problem);
      else setFailure(problem);
      await load().catch(() => {});
      return false;
    } finally { inFlight.current = false; setBusy(false); timing.finish(); }
  }
  async function showPreview() {
    if (inFlight.current) return;
    const timing = beginSalesMeasurement("authority.preview_open"); measurementRef.current = timing;
    inFlight.current = true; setBusy(true); setFailure(null); setNoticeReviewFailure(null); setApprovedPreview(false);
    try {
      const date = stage === "exchange" ? expiryEdited ? new Date(expiry).toISOString() : new Date(Date.now() + 48 * 3600000).toISOString() : "";
      if (stage === "exchange" && !expiryEdited) setExpiry(localTime(Date.parse(date)));
      const result = await legalRequest<Preview>(saleId, { action: "preview", kind: stage === "exchange" ? "authority" : "notice_authority", date }, timing);
      requestId.current = crypto.randomUUID(); setPreview(result);
    } catch (error) { timing.mark("error"); (stage === "completion" ? setNoticeReviewFailure : setFailure)(error instanceof Error ? error : { message: "Email preview could not be loaded." }); }
    finally { inFlight.current = false; setBusy(false); timing.finish(); }
  }

  function closePreview() {
    setPreview(null); setApprovedPreview(false); setNoticeReviewFailure(null);
    if (stage === "completion") noticeReviewButtonRef.current?.focus();
  }

  if (!context?.attempt) return <section className="border-t border-[#d9ded6] py-5" aria-live="polite">{failure ? <p role="alert">{failure.message} <button className="secondary" onClick={() => void load().catch(setFailure)}>Retry</button></p> : "Loading legal workflow…"}</section>;
  const { attempt, snapshot, emails, documents } = context;
  const exchanged = Boolean(attempt.exchanged_at) || ["exchanged", "completion_pending", "completed"].includes(attempt.workflow_status);
  const authority = exchangeAuthorityState(emails, context.events ?? [], attempt.authority_requested_at, exchanged, now);
  const latestAuthority = authority.current;
  const authorityState = attempt.exchanged_at || ["exchanged", "completion_pending", "completed"].includes(attempt.workflow_status) ? context.deposit?.receipt ? "Exchanged · Deposit received" : "Exchanged · Deposit confirmation outstanding" : latestAuthority ? authorityStatus(latestAuthority, now) : attempt.authority_requested_at ? "Authority requested" : "Authority not requested";
  const canIssue = canPerformSalesAction(role, "approve_exchange");
  const conveyancer = canPerformSalesAction(role, "record_exchange");
  const reservationApproved = ["approved", "reservation_approved", "awaiting_commercial_approval", "ready_for_exchange", "exchanged", "completion_pending", "completed"].includes(attempt.workflow_status);
  const completed = Boolean(attempt.completed_at) || attempt.workflow_status === "completed";
  const statementVersion = currentCompletionVersion(documents.find(document => document.document_type === "completion_statement"));
  const accountVersion = currentCompletionVersion(documents.find(document => document.document_type === "draft_statement_of_account"));
  const packageApproved = Boolean(context.completionPackage?.approved && context.completionPackage.approval?.statement_version_id === statementVersion?.id && context.completionPackage.approval?.account_version_id === accountVersion?.id);
  const actorLabel = (type: string, fallback?: string | null) => workflowActorLabel(context.events?.find((event) => event.event_type === type), context.actors ?? [], fallback);
  const noticeState = completionNoticeState(attempt);
  let routingProblem: SalesRecipientError | null = null;
  try { resolveSalesRecipients(snapshot, stage === "exchange" ? "authority" : "notice_authority"); }
  catch (error) { if (error instanceof SalesRecipientError) routingProblem = error; }

  const previewPanel = preview && <div ref={previewRef} id={preview.kind === "notice_authority" ? noticePreviewId : undefined} tabIndex={-1} className="my-5 min-w-0 max-w-full border-y-2 border-[#D6A23A] bg-[#fffdf7] p-4" role="region" aria-label="Final confirmation and email preview">
      <h4 className="font-bold">Final confirmation and email preview</h4>
      <p className="mt-2 text-sm text-[#617169]">Preview only – this authority has not been issued.</p>
      {preview.kind === "authority" && <p className="mt-2 text-sm font-semibold">Valid until {legalDateTime(preview.date)}</p>}
      <dl className="mt-3 grid gap-2 text-sm">{[["From", preview.from], ["To", preview.to.join(", ")], ["CC", preview.cc.join(", ") || "None"], ["Subject", preview.subject], ["Building", preview.snapshot.building.name], ["Plot", preview.snapshot.plot], ["Buyer", preview.snapshot.buyer]].map(([label, value]) => <div key={label} className="grid gap-1 sm:grid-cols-[6rem_1fr]"><dt className="font-semibold">{label}</dt><dd className="min-w-0 [overflow-wrap:anywhere]">{value}</dd></div>)}</dl>
      <EmailBodyPreview body={preview.body} html={preview.html} />
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={approvedPreview} onChange={(event) => setApprovedPreview(event.target.checked)} />I have reviewed the email and recipients and approve issuing this authority.</label>
      <div className="mt-4 flex flex-wrap gap-2"><button className="secondary" disabled={busy} onClick={closePreview}>Cancel</button><button className="primary" disabled={busy || !approvedPreview} onClick={() => void run({ action: "send", kind: preview.kind, date: preview.date, token: preview.token, requestId: requestId.current }, preview.kind === "authority" ? "Authority to exchange issued." : "Authority to serve notice given.")}>{preview.kind === "authority" ? "Issue authority to exchange" : "Give authority to serve notice"}</button></div>
    </div>;

  return <section id={`sales-stage-${stage}`} className="min-w-0 border-t border-[#d9ded6] py-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-xl font-bold text-[#0F3D2E]">{stage === "exchange" ? "Exchange" : "Completion"}</h3><span className="text-sm font-semibold">{stage === "exchange" ? authorityState : completed ? "Legally completed" : "Completion arrangements"}</span></div>
    <p className="mt-1 text-sm text-[#617169]">{snapshot.building.name} · Plot {snapshot.plot} · {snapshot.buyer}</p>
    {failure && <p className="my-4 text-sm text-red-800" role="alert">{failure.message} {failure.settingsUrl && <a className="underline" href={failure.settingsUrl}>Open settings</a>}</p>}
    {routingProblem && canIssue && !completed && <p className="my-4 text-sm text-amber-800">{routingProblem.message} <a className="underline" href={routingProblem.settingsUrl}>Open settings</a></p>}
    {stage === "exchange" ? <ol className="mt-5 divide-y divide-[#d9ded6]" aria-label="Exchange tasks">
      <li className="py-5"><h4 className="font-bold">1. Authority request</h4>
        {authority.requestDate ? <p className="mt-2 text-sm">Requested by {workflowActorLabel(authority.request, context.actors ?? [])} on {legalDateTime(authority.requestDate)}</p>
          : authority.issued ? <p className="mt-2 text-sm">Not requested – authority given directly</p>
          : <p className="mt-1 text-sm">A sales agent or conveyancer can request developer review. The developer can also issue authority directly.</p>}
        {authority.canRequest && canPerformSalesAction(role, "request_exchange_approval") && <button className="secondary mt-3" disabled={busy || !reservationApproved} onClick={() => void run({ action: "request_authority" }, "Exchange authority requested. The developer has been notified.")}>{authority.renewal ? "Request renewed authority" : "Request authority to exchange"}</button>}
      </li>
      <li className="py-5"><h4 className="font-bold">2. Authority issued</h4>
        {latestAuthority ? <div className="mt-3 rounded-xl border border-[#d9ded6] bg-[#f5f7f3] p-4 text-sm" aria-label="Authority status">
          <div className="flex flex-wrap items-center gap-3"><span className={`rounded-full border bg-white px-3 py-1 font-semibold ${authority.badge === "Active" ? "border-[#cbd5ca] text-[#0F3D2E]" : authority.badge === "Revoked" ? "border-red-200 text-red-800" : authority.badge === "Expired" ? "border-amber-200 text-amber-800" : "border-[#d9ded6] text-[#617169]"}`}>{authority.badge}</span><span className="font-semibold">Version {latestAuthority.version}</span></div>
          <p className="mt-3">{authority.issued ? "Issued" : "Prepared"} by {latestAuthority.snapshot.approver.name} on {legalDateTime(latestAuthority.issued_at)}</p>
          {latestAuthority.expires_at && <p className="mt-1">Valid until {legalDateTime(latestAuthority.expires_at)}</p>}
          <p className="mt-2">Email delivery: {latestAuthority.delivery_status.replaceAll("_", " ")}</p>
          <p className="mt-1 [overflow-wrap:anywhere]">To: {latestAuthority.to_recipients.join(", ")} · CC: {latestAuthority.cc_recipients.join(", ") || "None"}</p>
        </div> : !exchanged && <p className="mt-1 text-sm">The developer reviews the agreed sale terms and issues time-limited authority.</p>}
        <dl className="mt-4 divide-y divide-[#eef0eb]">{authorityTerms(latestAuthority ? latestAuthority.snapshot : snapshot).map(([label, value], index) => <div className="grid gap-1 py-2 text-sm sm:grid-cols-[13rem_1fr]" key={`${label}-${index}`}><dt className="text-[#617169]">{label}</dt><dd className="min-w-0 whitespace-pre-wrap font-medium [overflow-wrap:anywhere]">{value}</dd></div>)}</dl>
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
          <button className="primary w-fit" disabled={busy || !exchangeDate || authorityState !== "Authority issued"} onClick={() => void run({ action: "confirm_exchange", date: exchangeDate }, "Exchange confirmed.")}>Confirm exchange</button></div>}
      </>}</li>
      <ExchangeDepositReceipt key={saleId} deposit={context.deposit} exchanged={exchanged} editable={canPerformSalesAction(role, "confirm_exchange_deposit")} busy={busy} run={run} />
    </ol> : <ol className="mt-5 divide-y divide-[#d9ded6]" aria-label="Completion tasks">
      <li className="py-5"><h4 className="font-bold">1. Request authority to serve notice</h4><p className="mt-1 text-sm">A sales agent or conveyancer can request developer authority. The developer can also give authority directly.</p>
        {attempt.completion_authority_requested_at ? <p className="mt-2 text-sm">Requested by {actorLabel("authority_notice_requested", attempt.completion_authority_requested_by)} · {legalDateTime(attempt.completion_authority_requested_at)}</p>
          : noticeState.authorised && <p className="mt-2 text-sm">{attempt.completion_authority_given_at ? "Not requested – authority given directly" : "Existing completion record – request not recorded"}</p>}
        {!noticeState.authorised && !attempt.completion_authority_requested_at && canPerformSalesAction(role, "request_exchange_approval") && <button className="secondary mt-3" disabled={busy || !exchanged} onClick={() => void run({ action: "request_notice_authority" }, "Authority to serve notice requested. The developer has been notified.")}>Request authority to serve notice</button>}
      </li>
      <li className="min-w-0 py-5" id="notice-authority-step"><h4 className="font-bold">2. Authority to serve notice</h4>{!noticeState.authorised && <p className="mt-1 text-sm">The developer authorises the conveyancer to serve notice under the contract.</p>}
        {attempt.completion_authority_given_at ? <p className="mt-2 text-sm">Authority given by {actorLabel("authority_notice_given", attempt.completion_authority_given_by)} · {legalDateTime(attempt.completion_authority_given_at)}</p>
          : noticeState.authorised && <p className="mt-2 text-sm">This completion record predates the authority gate. Existing dates, documents and history are retained; developer authority details were not recorded.</p>}
        {canIssue && !noticeState.authorised && !completed && <button ref={noticeReviewButtonRef} className="primary mt-3 max-w-full whitespace-normal" aria-expanded={preview?.kind === "notice_authority"} aria-controls={noticePreviewId} disabled={busy || !exchanged || Boolean(routingProblem)} onClick={() => preview?.kind === "notice_authority" ? closePreview() : void showPreview()}>Review authority to serve notice and email</button>}
        {preview?.kind === "notice_authority" && previewPanel}
        {noticeReviewFailure && <p className="mt-3 text-sm text-red-800 [overflow-wrap:anywhere]" role="alert">{noticeReviewFailure.message} {noticeReviewFailure.settingsUrl && <a className="underline" href={noticeReviewFailure.settingsUrl}>Open settings</a>}</p>}
        {!exchanged && <p className="mt-2 text-sm text-amber-800">Confirm exchange before starting completion arrangements.</p>}
      </li>
      <li className="py-5"><h4 className="font-bold">3. Notice issued and completion due date</h4>
        <NoticeArrangements saleId={saleId} attempt={attempt} document={documents.find((item) => item.document_type === "completion_correspondence")} editable={conveyancer && exchanged && !completed} busy={busy} run={run} actor={actorLabel("completion_arrangements_confirmed", attempt.completion_arrangements_confirmed_by)} confirmedAt={context.events?.find((event) => event.event_type === "completion_arrangements_confirmed")?.created_at} />
      </li>
      <CompletionDocuments key={saleId} saleId={saleId} documents={documents} packageState={context.completionPackage} uploadAllowed={conveyancer && exchanged && noticeState.confirmed && !completed} reviewAllowed={canIssue && noticeState.confirmed && !completed} arrangementsConfirmed={noticeState.confirmed} completed={completed} busy={busy} actors={context.actors ?? []} historicalApproval={completed && !packageApproved && documents.find(document => document.document_type === "completion_statement")?.status === "approved" ? { name: actorLabel("completion_documents_approved", documents.find(document => document.document_type === "completion_statement")?.approved_by_user_id), date: documents.find(document => document.document_type === "completion_statement")?.approved_at ?? null } : undefined} run={run} open={async (versionId) => {
        try { const response = await fetch(`/api/sales/reservations?versionId=${versionId}`, { headers: await headers() }); const result = await response.json(); if (!response.ok) throw new Error(result.error); window.open(result.signedUrl,"_blank","noopener,noreferrer"); }
        catch (error) { setFailure(error instanceof Error ? error : {message:"Document could not be opened."}); }
      }} />
      <li className="py-5"><h4 className="font-bold">6. Legal completion</h4>{completed ? <p className="mt-2 text-sm">Legal completion: {attempt.legal_completed_at ? legalDateTime(attempt.legal_completed_at) : `${shortDate(attempt.completed_at)} (historical date; time not recorded)`} · Completed by {actorLabel("completion_recorded")}. Handover and key release are available.</p> : !packageApproved ? <p className="mt-2 text-sm text-[#617169]">Available once the current completion documents have been approved by the developer.</p> : <>
        <p className="mt-1 text-sm">Handover and keys remain locked until the conveyancer confirms legal completion.</p>
        {conveyancer && exchanged && noticeState.confirmed && <div className="mt-3 grid gap-3"><label className="field-label">Actual legal completion date and time (your local time)<input className="field max-w-md" type="datetime-local" value={completedTime} onChange={(event) => setCompletedTime(event.target.value)} /></label><label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={legalConfirmed} onChange={(event) => setLegalConfirmed(event.target.checked)} />I confirm legal completion has taken place and keys may be released.</label><button className="primary w-fit" disabled={busy || !packageApproved || !attempt.contractual_completion_date || !completedTime || !legalConfirmed} onClick={() => void run({ action: "confirm_completion", dateTime: new Date(completedTime).toISOString() }, "Legal completion confirmed. Handover is now available.")}>Confirm legal completion</button></div>}
      </>}
        {completed && <LegalDocument saleId={saleId} type="statement_of_account" label="Final statement of account" document={documents.find((item) => item.document_type === "statement_of_account")} editable={conveyancer && completed} busy={busy} run={run} />}
      </li>
    </ol>}

    {stage === "exchange" && preview?.kind === "authority" && previewPanel}
    {emails.length > 0 && <details className="mt-4 border-t border-[#d9ded6] py-4"><summary className="cursor-pointer font-bold">Instruction and email history ({emails.length})</summary><ol className="divide-y divide-[#d9ded6]">{emails.map((email) => <li key={email.id} className="py-4 text-sm">
      <p className="font-semibold">{email.kind === "authority" ? "Authority" : email.kind === "notice_authority" ? "Authority to serve notice" : "Historic completion instruction"} · Version {email.version} · {email.delivery_status}</p><p>Approved by {email.snapshot.approver.name} · {legalDateTime(email.issued_at)}</p>
      {email.kind === "authority" && <p>{authorityBadge(email, now)} · Valid until {email.expires_at && legalDateTime(email.expires_at)}</p>}
      {email.revoked_at && <p>Revoked {legalDateTime(email.revoked_at)}{email.revocation_reason ? ` · ${email.revocation_reason}` : ""}</p>}{email.exchanged_at && <p>Actual exchange: {shortDate(email.exchanged_at)}</p>}
      <p className="break-all">To: {email.to_recipients.join(", ")} · CC: {email.cc_recipients.join(", ") || "None"}</p>
      <details className="mt-2"><summary className="cursor-pointer underline">View saved email and authorised terms</summary><p className="mt-2 break-all">From: {email.sending_address}</p><p>{email.subject}</p><EmailBodyPreview body={email.body} html={email.html_body} />{email.resend_message_id && <p className="mt-2 break-all">Resend message: {email.resend_message_id}</p>}</details>
      {canIssue && <div className="mt-3 flex flex-wrap gap-2">{!email.resend_message_id && !email.revoked_at && !email.replaced_by && <button className="secondary" disabled={busy} onClick={() => void run({ action: "retry_email", emailId: email.id }, "Email status reconciled.")}>Retry email</button>}{email.resend_message_id && <button className="secondary" disabled={busy} onClick={() => void run({ action: "refresh_delivery", emailId: email.id }, "Email delivery status refreshed.")}>Refresh delivery status</button>}</div>}
      {canIssue && !completed && (email.kind === "completion_instruction" || email.kind === "notice_authority") && !email.resend_message_id && !email.revoked_at && <div className="mt-3"><p>Check Resend before cancelling an uncertain send. Cancelling here cannot recall an email already sent.</p><label className="field-label mt-2">Cancellation reason<textarea className="field" value={reason} onChange={(event) => setReason(event.target.value)} /></label><button className="secondary mt-2" disabled={busy || !reason.trim()} onClick={() => void run({ action: email.kind === "notice_authority" ? "cancel_notice_authority" : "cancel_instruction", emailId: email.id, reason }, "Instruction cancelled. You can review and issue a replacement.")}>Cancel pending instruction</button></div>}
    </li>)}</ol></details>}
  </section>;
}

function EmailBodyPreview({ body, html }: { body: string; html?: string | null }) {
  const text = <pre className="my-4 whitespace-pre-wrap font-sans text-sm [overflow-wrap:anywhere]">{body}</pre>;
  if (!html) return text;
  return <div className="my-4 min-w-0"><iframe title="Rendered email preview" sandbox="" srcDoc={html} className="h-[640px] w-full rounded border border-[#d9ded6] bg-white" /><details className="mt-3"><summary className="cursor-pointer text-sm underline">View plain-text email</summary>{text}</details></div>;
}

function NoticeArrangements({ saleId, attempt, document, editable, busy, run, actor, confirmedAt }: {
  saleId: string; attempt: Context["attempt"]; document?: Document; editable: boolean; busy: boolean; run: Run; actor: string; confirmedAt?: string;
}) {
  const state = completionNoticeState(attempt);
  const [noticeDate, setNoticeDate] = useState(attempt.completion_notice_issued_at || "");
  const [dueDate, setDueDate] = useState(attempt.contractual_completion_date || addWorkingDays(attempt.completion_notice_issued_at || ""));
  const [manualDueDate, setManualDueDate] = useState(Boolean(attempt.contractual_completion_date));
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState("");
  const [correcting, setCorrecting] = useState(false);
  const requestId = useRef("");
  const savedAt = attempt.completion_arrangements_confirmed_at || confirmedAt;
  const datesValid = validNoticeDates(noticeDate, dueDate);
  function choose(value: File | null) {
    requestId.current = "";
    const error = value ? noticeFileError(value) : null;
    setFileError(error || ""); setFile(error ? null : value);
  }
  async function submit() {
    if (!datesValid || !file || noticeFileError(file) || busy) return;
    requestId.current ||= crypto.randomUUID();
    const form = new FormData();
    for (const [key, value] of Object.entries({ sale: saleId, action: "confirm_notice", documentType: "completion_correspondence", noticeDate, date: dueDate, requestId: requestId.current })) form.set(key, value);
    form.set("file", file);
    if (await run(form, "Completion arrangements confirmed. The notice PDF and dates have been saved.")) { setFile(null); requestId.current = ""; }
  }
  if (!state.authorised) return <p className="mt-3 text-sm text-amber-800">Awaiting developer authority to serve notice</p>;
  return <div className="mt-3 min-w-0">
    {state.confirmed && <>
      <dl className="grid gap-2 text-sm"><div><dt className="font-semibold">Notice issue date</dt><dd>{shortDate(attempt.completion_notice_issued_at)}</dd></div><div><dt className="font-semibold">Completion due date</dt><dd>{shortDate(attempt.contractual_completion_date)}</dd></div></dl>
      <p className="mt-3 text-sm">{savedAt ? <>Confirmed by {actor} · {legalDateTime(savedAt)}</> : "Historical completion arrangements – confirmation details not recorded."}</p>
      <LegalDocument saleId={saleId} type="completion_correspondence" label="Notice PDF" document={document} editable={editable} busy={busy} run={run} />
      {editable && !correcting && <button className="secondary mt-3" disabled={busy} onClick={() => { setNoticeDate(attempt.completion_notice_issued_at || ""); setDueDate(attempt.contractual_completion_date || ""); setManualDueDate(true); setCorrecting(true); }}>Correct recorded dates</button>}
    </>}
    {editable && (!state.confirmed || correcting) && <div className="mt-4 grid gap-3">
      <label className="field-label">Notice issue date<input className="field max-w-md" type="date" required disabled={busy} value={noticeDate} onChange={(event) => { const next = event.target.value; setNoticeDate(next); if (!manualDueDate) setDueDate(addWorkingDays(next)); requestId.current = ""; }} /></label>
      <label className="field-label">Completion due date<input className="field max-w-md" type="date" required disabled={busy} min={noticeDate || undefined} value={dueDate} onChange={(event) => { setDueDate(event.target.value); setManualDueDate(true); requestId.current = ""; }} /></label>
      <p className="text-sm text-[#617169]">Defaults to 10 working days after the notice date, excluding weekends. Adjust it to match the contract.</p>
      {noticeDate && dueDate && !datesValid && <p role="alert" className="text-sm text-red-800">Completion due date cannot be earlier than the notice issue date.</p>}
      {correcting ? <div className="flex flex-wrap gap-2"><button className="secondary" disabled={busy} onClick={() => setCorrecting(false)}>Cancel correction</button><button className="primary" disabled={busy || !datesValid} onClick={async () => {
        if (await run({ action: "correct_completion_dates", noticeDate, date: dueDate, previousNoticeDate: attempt.completion_notice_issued_at, previousDate: attempt.contractual_completion_date }, "Recorded dates corrected. The previous dates remain in activity history.")) setCorrecting(false);
      }}>Save corrected dates</button></div> : <>
        <div><h5 className="mb-2 text-sm font-semibold">Notice PDF</h5><PdfUploadBox id={`${saleId}-notice`} label="Notice PDF" emptyPrompt="Choose or drop notice PDF" helperText="PDF only, maximum 10 MB" file={file} disabled={busy} onFile={choose} onClear={() => choose(null)} /></div>
        {fileError && <p role="alert" className="text-sm text-red-800">{fileError}</p>}
        <button className="primary w-fit" disabled={busy || !state.authorised || !datesValid || Boolean(noticeFileError(file))} onClick={() => void submit()}>Confirm completion arrangements</button>
      </>}
    </div>}
    {!state.confirmed && !editable && <p className="text-sm text-[#617169]">Awaiting the conveyancer’s notice dates and PDF.</p>}
    {!state.confirmed && document && <LegalDocument saleId={saleId} type="completion_correspondence" label="Existing notice PDF" document={document} editable={false} busy={busy} run={run} />}
  </div>;
}

function LegalDocument({ saleId, type, label, document, editable, busy, run }: {
  saleId: string; type: string; label: string; document?: Document; editable: boolean; busy: boolean; run: Run;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const requestId = useRef("");
  const versions = document?.unit_sale_document_versions.filter((version) => !version.redacted_at).sort((a, b) => b.version_number - a.version_number) ?? [];
  const current = versions.find((version) => version.is_current);
  const previousVersions = versions.filter((version) => version.id !== current?.id);
  async function open(version: Version) {
    try {
      const response = await fetch(`/api/sales/reservations?versionId=${version.id}`, { headers: await headers() });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      window.open(result.signedUrl, "_blank", "noopener,noreferrer");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Document could not be opened."); }
  }
  function choose(value: File | null) {
    setError(""); requestId.current = "";
    if (value && noticeFileError(value)) { setFile(null); setError("Choose a PDF up to 10 MB."); return; }
    setFile(value);
  }
  return <div className="mt-4 min-w-0">
    <h5 className="mb-2 text-sm font-semibold">{label}</h5>
    {error && <p role="alert" className="text-sm text-red-800">{error}</p>}
    {(editable || current) ? <PdfUploadBox id={`${saleId}-${type}`} label={`Choose ${label.toLowerCase()} PDF`} file={file} currentVersion={current} disabled={!editable || busy} onOpen={current ? () => void open(current) : undefined} onFile={choose} onClear={() => setFile(null)} /> : <p className="text-sm text-[#617169]">No document uploaded.</p>}
    {editable && file && <button className="secondary mt-3" disabled={busy} onClick={async () => {
      const form = new FormData(); form.set("sale", saleId); form.set("documentType", type); form.set("file", file);
      if (type === "completion_correspondence") { requestId.current ||= crypto.randomUUID(); form.set("action", "replace_notice"); form.set("requestId", requestId.current); form.set("expectedVersionId", current?.id || ""); }
      if (await run(form, `${label} version saved.`)) { setFile(null); requestId.current = ""; }
    }}>{type === "completion_correspondence" ? "Save replacement PDF" : `Upload ${label.toLowerCase()}`}</button>}
    {previousVersions.length > 0 && <details className="mt-3 text-sm"><summary className="cursor-pointer">Previous versions ({previousVersions.length})</summary>{previousVersions.map((version) => <div key={version.id} className="flex flex-wrap items-center justify-between gap-2 border-b py-2"><span className="break-all">Version {version.version_number} · {version.file_name}</span><button className="secondary" onClick={() => void open(version)}>View version {version.version_number}</button></div>)}</details>}
  </div>;
}
