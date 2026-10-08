"use client";

import { useEffect, useRef, useState } from "react";
import type { Upload } from "tus-js-client";
import { uploadCompletionFiles, type UploadProgress } from "@/lib/sales/completion-upload-client";
import { PdfUploadBox, type UploadVersion } from "./PdfUploadBox";
import { noticeFileError } from "@/lib/sales/completion-notice";
import { historicalActorLabel, type ActorProfile } from "@/lib/sales/actor-identity";
import { legalDateTime } from "@/lib/sales/legal-workflow";
import { beginSalesMeasurement, type SalesMeasurement } from "@/lib/sales/performance";
import { completionDocumentApproved, completionDocumentLabels, completionDocumentTypes, completionVersionEvents, currentCompletionVersion, type CompletionReviewEvent } from "@/lib/sales/completion-review";
export { currentCompletionVersion } from "@/lib/sales/completion-review";

export type CompletionVersion = UploadVersion & { id: string; version_number: number; is_current: boolean; redacted_at: string | null; uploaded_by_user_id?: string | null };
export type CompletionDocument = { id: string; document_type: string; status: string; query_note: string | null; approved_version_id: string | null; approved_by_user_id?: string | null; approved_at: string | null; unit_sale_document_versions: CompletionVersion[] };
export type CompletionPackage = { approved: boolean; approval: { approved_by_name: string; approved_at: string; statement_version_id: string; account_version_id: string } | null };
export const draftDocumentTypes = completionDocumentTypes;
type DraftType = typeof draftDocumentTypes[number];
const labels: Record<DraftType, string> = { completion_statement: "Draft completion statement", draft_statement_of_account: "Draft statement of account" };
type Selection = { file: File; type: DraftType; expectedVersionId: string | null };
export function CompletionDocuments({ saleId, documents, events, uploadAllowed, reviewAllowed, arrangementsConfirmed, completed, busy, actors, run, open }: {
  saleId: string; documents: CompletionDocument[]; events: CompletionReviewEvent[]; uploadAllowed: boolean; reviewAllowed: boolean; arrangementsConfirmed: boolean; completed: boolean; busy: boolean; actors: ActorProfile[];
  run: (body: Record<string, unknown> | FormData, message: string, measurement?: SalesMeasurement, prepare?: () => Promise<void>) => Promise<boolean>; open: (versionId: string) => Promise<void>;
}) {
  const [selected, setSelected] = useState<Selection[]>([]);
  const [error, setError] = useState("");
  const [queries, setQueries] = useState<Partial<Record<DraftType, { versionId: string; reason: string }>>>({});
  const request = useRef("");
  const transfers = useRef(new Map<string, Upload>());
  const controller = useRef<AbortController | null>(null);
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  useEffect(() => () => { controller.current?.abort(); }, []);
  function resetRequest() { request.current = ""; transfers.current.clear(); }
  const doc = (type: DraftType) => documents.find(document => document.document_type === type);
  const current = (type: DraftType) => currentCompletionVersion(doc(type));
  const bothUploaded = draftDocumentTypes.every(type => current(type));
  const approvedCount = draftDocumentTypes.filter(type => completionDocumentApproved(doc(type))).length;
  const canUpload = uploadAllowed && approvedCount < 2;
  const valid = selected.length > 0 && selected.every(item => !noticeFileError(item.file) && doc(item.type)?.status !== "approved");
  function choose(type: DraftType, files: File[]) {
    if (files.length === 0 || busy || doc(type)?.status === "approved") return;
    const timing = beginSalesMeasurement("completion.documents_select"); timing.finish();
    if (files.length !== 1) { setError("Choose one PDF for each document slot."); return; }
    const problem = files.map(noticeFileError).find(Boolean);
    if (problem) { setError(problem); return; }
    setError(""); resetRequest();
    const expectedVersionId = current(type)?.id ?? null;
    setSelected(items => items.some(item => item.type === type)
      ? items.map(item => item.type === type ? { ...item, file: files[0] } : item)
      : [...items, { file: files[0], type, expectedVersionId }]);
  }
  async function upload() {
    if (!valid || busy || controller.current) return;
    const timing = beginSalesMeasurement("completion.documents_upload");
    request.current ||= crypto.randomUUID();
    const abort = new AbortController(); controller.current = abort; setError("");
    timing.mark("file_prepared");
    const ok = await run({ action: "finalize_completion_upload", requestId: request.current },"Uploaded documents are awaiting developer approval.",timing, async () => {
      await uploadCompletionFiles(saleId, request.current, selected.map(item => item.file), selected.map(item => ({ type: item.type, expectedVersionId: item.expectedVersionId, name: item.file.name, size: item.file.size, mime: "application/pdf" })), setProgress, abort.signal, transfers.current);
      abort.signal.throwIfAborted();
    });
    controller.current = null; setProgress(null);
    if (ok) { setSelected([]);resetRequest(); }
    else setError("Upload not confirmed. Retry with the selected files to resume or recover the saved result. If a file or current version is wrong, remove the selection and choose it again.");
  }
  function closeQuery(type: DraftType) {
    setQueries(items => { const next = { ...items }; delete next[type]; return next; });
  }
  async function submitQuery(type: DraftType) {
    const query = queries[type];
    if (!query?.reason.trim() || busy) return;
    if (await run({ action: "query_completion_document", documentType: type, versionId: query.versionId, reason: query.reason.trim() }, "Completion document query recorded.")) closeQuery(type);
  }
  const actor = (event?: CompletionReviewEvent, userId?: string | null) => historicalActorLabel({ snapshotName: event?.actor_name, userId: event?.created_by_user_id ?? userId, profiles: actors, fallback: "Unknown user" });
  function status(type: DraftType) {
    return !current(type) ? "Not uploaded" : completionDocumentApproved(doc(type)) ? "Approved" : doc(type)?.status === "query_raised" ? "Query raised" : "Awaiting approval";
  }
  function versionHistory(versionId: string) {
    return completionVersionEvents(events, versionId).filter(event => event.event_type === "completion_documents_approved" || event.event_type === "completion_documents_query_raised" || event.event_type.endsWith("_superseded")).map((event, index) => <p key={event.id ?? `${event.event_type}-${index}`} className="mt-2 whitespace-pre-wrap [overflow-wrap:anywhere]">
      {event.event_type === "completion_documents_query_raised" ? `Query raised: ${event.metadata?.queryNote ?? "Reason not recorded"}` : event.event_type === "completion_documents_approved" ? "Approved" : "Replaced"}
      <span className="block text-[#617169]">{actor(event)} · {legalDateTime(event.created_at)}</span>
    </p>);
  }
  function card(type: DraftType) {
    const document = doc(type), version = current(type);
    const locked = document?.status === "approved";
    const selection = locked ? undefined : selected.find(item => item.type === type);
    const older = document?.unit_sale_document_versions.filter(item => !item.is_current && !item.redacted_at).sort((a,b)=>b.version_number-a.version_number) ?? [];
    const title = completionDocumentApproved(document) ? completionDocumentLabels[type] : labels[type];
    const canReview = reviewAllowed && version && !locked && document?.status !== "query_raised";
    const query = queries[type]?.versionId === version?.id ? queries[type] : undefined;
    const queryEvent = version ? completionVersionEvents(events, version.id).find(event => event.event_type === "completion_documents_query_raised") : undefined;
    return <article key={type} id={`completion-document-${type}`} className="min-w-0 rounded-xl border border-[#d9ded6] bg-white p-4" aria-label={completionDocumentLabels[type]}>
      <div className="flex flex-wrap items-start justify-between gap-2"><h5 className="font-bold text-[#0F3D2E]">{title}</h5><span className="text-sm font-semibold">{selection ? "Ready to upload" : status(type)}</span></div>
      {uploadAllowed && !locked && (!version || selection) && <div className="mt-3" role={selection ? "group" : undefined} aria-label={selection ? `Selected ${selection.file.name}` : undefined}>
        <PdfUploadBox id={`${saleId}-${type}`} label={`${version || selection ? "Replace" : "Choose"} ${labels[type].toLowerCase()}`} file={selection?.file ?? null} disabled={busy}
          onFile={file => { if (file) choose(type, [file]); }} onFiles={files => choose(type, files)} multiple={false}
          onClear={() => { setSelected(items => items.filter(item => item.type !== type)); resetRequest(); setError(""); }}
          emptyPrompt={version ? "Choose or drop a replacement PDF" : "Choose or drop a PDF"}
          helperText="One PDF, maximum 10 MiB per document." />
        {selection && version && <p className="mt-2 text-sm text-amber-800">Replaces {version.file_name}. Only this document will need approval.</p>}
      </div>}
      {version && <><p className="mt-3 font-medium [overflow-wrap:anywhere]">{version.file_name}</p><p className="mt-1 text-sm text-[#617169]">Uploaded {legalDateTime(version.uploaded_at)} by {historicalActorLabel({userId:version.uploaded_by_user_id,profiles:actors,fallback:"Unknown user"})}</p>
        <div className="mt-3 flex flex-wrap gap-2"><button type="button" className="secondary upload-action" onClick={()=>void open(version.id)}>View/download</button>
        {uploadAllowed && !locked && !selection && <label className={`secondary upload-action upload-target ${busy ? "opacity-60" : "cursor-pointer"}`}>
          Replace<input className="sr-only" aria-label={`Replace ${labels[type].toLowerCase()}`} type="file" accept="application/pdf,.pdf" disabled={busy}
            onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) choose(type, [file]); }} />
        </label>}
        {canReview && !query && <>
          <button type="button" className="primary upload-action" disabled={busy} onClick={() => void run({ action: "approve_completion_document", documentType: type, versionId: version.id }, `${completionDocumentLabels[type]} approved.`)}>Approve</button>
          <button type="button" className="secondary upload-action" disabled={busy} aria-expanded={false} aria-controls={`${saleId}-${type}-query`} onClick={() => setQueries(items => ({ ...items, [type]: { versionId: version.id, reason: "" } }))}>Raise query</button>
        </>}
        </div>
        {canReview && query && <div id={`${saleId}-${type}-query`} className="mt-3 grid gap-3">
          <label className="field-label" htmlFor={`${saleId}-${type}-reason`}>Query / rejection reason</label>
          <textarea autoFocus id={`${saleId}-${type}-reason`} className="field" rows={3} value={query.reason} disabled={busy} onChange={event => setQueries(items => ({ ...items, [type]: { versionId: version.id, reason: event.target.value } }))} />
          <div className="flex flex-wrap gap-2"><button type="button" className="primary" disabled={busy || !query.reason.trim()} onClick={() => void submitQuery(type)}>Submit query</button><button type="button" className="secondary" disabled={busy} onClick={() => closeQuery(type)}>Cancel</button></div>
        </div>}
      </>}
      {version && document?.status === "query_raised" && document.query_note && <div className="mt-3 whitespace-pre-wrap rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 [overflow-wrap:anywhere]"><p>Query raised: {document.query_note}</p>{queryEvent && <p className="mt-2">Raised by {actor(queryEvent)} · {legalDateTime(queryEvent.created_at)}</p>}</div>}
      {older.length > 0 && <details className="mt-3 text-sm"><summary className="cursor-pointer">Previous versions ({older.length})</summary>{older.map(item => <div key={item.id} className="mt-2 border-t pt-2"><p className="[overflow-wrap:anywhere]">Superseded · Version {item.version_number} · {item.file_name}</p><p className="mt-1 text-[#617169]">Uploaded {legalDateTime(item.uploaded_at)} by {actor(undefined, item.uploaded_by_user_id)}</p>{versionHistory(item.id)}<button type="button" className="secondary upload-action mt-2" onClick={() => void open(item.id)}>View/download</button></div>)}</details>}
    </article>;
  }
  return <>
    <li className="min-w-0 py-5" id="completion-documents-step"><h4 className="font-bold">4. Completion documents</h4>
      <p className="mt-1 text-sm">{bothUploaded ? "Both current documents uploaded." : "Upload completion PDFs for developer review."}</p>
      {!arrangementsConfirmed && !completed && <p className="mt-2 text-sm text-amber-800">Confirm completion arrangements before continuing.</p>}
      {canUpload && <p className="mt-2 text-sm text-[#617169]">Choose a PDF for each document, then upload them together. You can also upload or replace an unapproved document at any time.</p>}
      <div className="mt-4 grid min-w-0 gap-4 lg:grid-cols-2">{draftDocumentTypes.map(card)}</div>
      {canUpload && <div className="mt-4 grid gap-4">
        {error && <p role="alert" className="text-sm text-red-800">{error}</p>}
        {progress && <div className="min-w-0 rounded-xl border border-[#d9ded6] bg-white p-4">
          <p role="status" className="text-sm">{progress.phase === "preparing" ? "Preparing secure upload…" : progress.phase === "verifying" ? "Verifying PDFs and saving document versions…" : `Uploading PDFs: ${Math.round(100 * progress.loaded / progress.total)}%`}</p>
          <progress aria-label="Completion document upload" max={progress.total} value={progress.loaded} className="mt-2 w-full" />
          {progress.phase !== "verifying" && <button type="button" className="secondary mt-2" onClick={() => controller.current?.abort()}>Pause upload</button>}
        </div>}
        <button type="button" className="primary w-fit" disabled={busy||!valid} onClick={()=>void upload()}>{selected.length===1 && selected[0].expectedVersionId ? "Upload replacement document" : "Upload completion documents"}</button>
      </div>}
    </li>
    <li className="min-w-0 py-5" id="completion-approval-step"><h4 className="font-bold">5. Developer approval</h4>
      <p className="mt-2 text-sm font-semibold">{approvedCount === 2 ? "✓ Completion documents approved" : `${approvedCount} of 2 completion documents approved.`}</p>
      <ul className="mt-2 space-y-1 text-sm">{draftDocumentTypes.map(type => {
        const document = doc(type), version = current(type);
        const approval = version ? completionVersionEvents(events, version.id).find(event => event.event_type === "completion_documents_approved") : undefined;
        return <li key={type}>{completionDocumentLabels[type]}{completionDocumentApproved(document) ? <> approved by {actor(approval, document?.approved_by_user_id)}{document?.approved_at ? ` · ${legalDateTime(document.approved_at)}` : " · Approval time not recorded"}</> : `: ${status(type)}`}</li>;
      })}</ul>
      {completed && approvedCount < 2 && <p className="mt-2 text-sm text-[#617169]">Historical completion – approval of both draft documents was not recorded.</p>}
    </li>
  </>;
}
