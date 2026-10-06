"use client";

import { useEffect, useRef, useState } from "react";
import type { Upload } from "tus-js-client";
import { uploadCompletionFiles, type UploadProgress } from "@/lib/sales/completion-upload-client";
import { PdfUploadBox, type UploadVersion } from "./PdfUploadBox";
import { noticeFileError } from "@/lib/sales/completion-notice";
import { historicalActorLabel, type ActorProfile } from "@/lib/sales/actor-identity";
import { legalDateTime } from "@/lib/sales/legal-workflow";
import { beginSalesMeasurement, type SalesMeasurement } from "@/lib/sales/performance";

export type CompletionVersion = UploadVersion & { id: string; version_number: number; is_current: boolean; redacted_at: string | null; uploaded_by_user_id?: string | null };
export type CompletionDocument = { id: string; document_type: string; status: string; query_note: string | null; approved_version_id: string | null; approved_by_user_id?: string | null; approved_at: string | null; unit_sale_document_versions: CompletionVersion[] };
export type CompletionPackage = { approved: boolean; approval: { approved_by_name: string; approved_at: string; statement_version_id: string; account_version_id: string } | null };
export const draftDocumentTypes = ["completion_statement", "draft_statement_of_account"] as const;
type DraftType = typeof draftDocumentTypes[number];
const labels: Record<DraftType, string> = { completion_statement: "Draft completion statement", draft_statement_of_account: "Draft statement of account" };
type Selection = { file: File; type: DraftType; expectedVersionId: string | null };
export const currentCompletionVersion = (document?: CompletionDocument) => document?.unit_sale_document_versions.find(version => version.is_current && !version.redacted_at);

export function CompletionDocuments({ saleId, documents, packageState, uploadAllowed, reviewAllowed, arrangementsConfirmed, completed, busy, actors, historicalApproval, run, open }: {
  saleId: string; documents: CompletionDocument[]; packageState?: CompletionPackage; uploadAllowed: boolean; reviewAllowed: boolean; arrangementsConfirmed: boolean; completed: boolean; busy: boolean; actors: ActorProfile[];
  historicalApproval?: { name: string; date: string | null };
  run: (body: Record<string, unknown> | FormData, message: string, measurement?: SalesMeasurement, prepare?: () => Promise<void>) => Promise<boolean>; open: (versionId: string) => Promise<void>;
}) {
  const [selected, setSelected] = useState<Selection[]>([]);
  const [error, setError] = useState("");
  const [reason, setReason] = useState("");
  const [affected, setAffected] = useState<DraftType[]>([]);
  const request = useRef("");
  const transfers = useRef(new Map<string, Upload>());
  const controller = useRef<AbortController | null>(null);
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  useEffect(() => () => { controller.current?.abort(); }, []);
  function resetRequest() { request.current = ""; transfers.current.clear(); }
  const doc = (type: DraftType) => documents.find(document => document.document_type === type);
  const current = (type: DraftType) => currentCompletionVersion(doc(type));
  const bothUploaded = draftDocumentTypes.every(type => current(type));
  const approved = Boolean(packageState?.approved);
  const valid = selected.length > 0 && selected.every(item => !noticeFileError(item.file));
  function choose(type: DraftType, files: File[]) {
    if (files.length === 0 || busy) return;
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
    const ok = await run({ action: "finalize_completion_upload", requestId: request.current },"Completion documents uploaded. Developer approval is required for the current files.",timing, async () => {
      await uploadCompletionFiles(saleId, request.current, selected.map(item => item.file), selected.map(item => ({ type: item.type, expectedVersionId: item.expectedVersionId, name: item.file.name, size: item.file.size, mime: "application/pdf" })), setProgress, abort.signal, transfers.current);
      abort.signal.throwIfAborted();
    });
    controller.current = null; setProgress(null);
    if (ok) { setSelected([]);resetRequest(); }
    else setError("Upload not confirmed. Retry with the selected files to resume or recover the saved result. If a file or current version is wrong, remove the selection and choose it again.");
  }
  function card(type: DraftType, history: boolean) {
    const document = doc(type), version = current(type);
    const selection = history ? selected.find(item => item.type === type) : undefined;
    const older = document?.unit_sale_document_versions.filter(item => !item.is_current && !item.redacted_at).sort((a,b)=>b.version_number-a.version_number) ?? [];
    const status = !version ? "Not uploaded" : document?.status === "query_raised" ? "Query raised" : approved || completed && document?.status === "approved" ? "Approved" : "Awaiting approval";
    return <article key={type} className="min-w-0 rounded-xl border border-[#d9ded6] bg-white p-4" aria-label={`${history ? "Uploaded" : "Review"} ${labels[type].toLowerCase()}`}>
      <div className="flex flex-wrap items-start justify-between gap-2"><h5 className="font-bold text-[#0F3D2E]">{labels[type]}</h5><span className="text-sm font-semibold">{selection ? "Ready to upload" : status}</span></div>
      {history && uploadAllowed && (!version || selection) && <div className="mt-3" role={selection ? "group" : undefined} aria-label={selection ? `Selected ${selection.file.name}` : undefined}>
        <PdfUploadBox id={`${saleId}-${type}`} label={`${version || selection ? "Replace" : "Choose"} ${labels[type].toLowerCase()}`} file={selection?.file ?? null} disabled={busy}
          onFile={file => { if (file) choose(type, [file]); }} onFiles={files => choose(type, files)} multiple={false}
          onClear={() => { setSelected(items => items.filter(item => item.type !== type)); resetRequest(); setError(""); }}
          emptyPrompt={version ? "Choose or drop a replacement PDF" : "Choose or drop a PDF"}
          helperText="One PDF, maximum 10 MiB per document." />
        {selection && version && <p className="mt-2 text-sm text-amber-800">Replaces {version.file_name}. Fresh approval of both documents will be required.</p>}
      </div>}
      {version && <><p className="mt-3 font-medium [overflow-wrap:anywhere]">{version.file_name}</p><p className="mt-1 text-sm text-[#617169]">Uploaded {legalDateTime(version.uploaded_at)} by {historicalActorLabel({userId:version.uploaded_by_user_id,profiles:actors,fallback:"Unknown user"})}</p>
        <button type="button" className="secondary upload-action mt-3" onClick={()=>void open(version.id)}>View/download</button>
        {history && uploadAllowed && !selection && <label className={`secondary upload-action upload-target ml-2 mt-3 ${busy ? "opacity-60" : "cursor-pointer"}`}>
          Replace<input className="sr-only" aria-label={`Replace ${labels[type].toLowerCase()}`} type="file" accept="application/pdf,.pdf" disabled={busy}
            onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) choose(type, [file]); }} />
        </label>}
      </>}
      {history && type === "completion_statement" && historicalApproval && <p className="mt-3 text-sm">Historical completion statement approved · Approved by {historicalApproval.name}{historicalApproval.date ? ` on ${legalDateTime(historicalApproval.date)}` : ""}</p>}
      {document?.query_note && <p className="mt-3 whitespace-pre-wrap rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Query raised: {document.query_note}</p>}
      {history && older.length>0 && <details className="mt-3 text-sm"><summary className="cursor-pointer">Previous versions ({older.length})</summary>{older.map(item=><div key={item.id} className="mt-2 border-t pt-2"><p className="[overflow-wrap:anywhere]">Superseded · Version {item.version_number} · {item.file_name}</p><button type="button" className="secondary upload-action mt-2" onClick={()=>void open(item.id)}>View/download</button></div>)}</details>}
    </article>;
  }
  return <>
    <li className="min-w-0 py-5" id="completion-documents-step"><h4 className="font-bold">4. Completion documents</h4>
      <p className="mt-1 text-sm">{bothUploaded ? "Both current documents uploaded." : "Upload both draft documents before developer review."}</p>
      {!arrangementsConfirmed && !completed && <p className="mt-2 text-sm text-amber-800">Confirm completion arrangements before continuing.</p>}
      {uploadAllowed && <p className="mt-2 text-sm text-[#617169]">Choose a PDF for each document, then upload them together. You can also upload or replace one at a time.</p>}
      <div className="mt-4 grid min-w-0 gap-4 lg:grid-cols-2">{draftDocumentTypes.map(type=>card(type,true))}</div>
      {uploadAllowed && <div className="mt-4 grid gap-4">
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
      {!bothUploaded ? <p className="mt-2 text-sm text-[#617169]">{completed ? "Historical completion – approval of both draft documents was not recorded." : "Available once the conveyancer has uploaded both completion documents."}</p> : <>
        <p className="mt-2 text-sm font-semibold">{approved ? "Completion documents approved" : "Awaiting developer approval"}</p>
        <div className="mt-4 grid min-w-0 gap-4 lg:grid-cols-2">{draftDocumentTypes.map(type=>card(type,false))}</div>
        {approved && packageState?.approval && <p className="mt-3 text-sm">Approved by {packageState.approval.approved_by_name} on {legalDateTime(packageState.approval.approved_at)}</p>}
        {reviewAllowed && <div className="mt-4 grid gap-3">
          <fieldset><legend className="mb-2 text-sm font-semibold">Documents affected by a query</legend>{draftDocumentTypes.map(type=><label key={type} className="mb-2 flex items-start gap-2 text-sm"><input type="checkbox" disabled={busy} checked={affected.includes(type)} onChange={event=>setAffected(items=>event.target.checked?[...items,type]:items.filter(item=>item!==type))}/>{labels[type]}</label>)}</fieldset>
          <label className="field-label">Query or rejection reason<textarea className="field" value={reason} disabled={busy} onChange={event=>setReason(event.target.value)}/></label>
          <div className="flex flex-wrap gap-2"><button type="button" className="secondary" disabled={busy||!reason.trim()||affected.length===0} onClick={()=>void run({action:"query_completion_package",statementVersionId:current("completion_statement")?.id,accountVersionId:current("draft_statement_of_account")?.id,documentTypes:affected,reason},"Completion document query recorded.")}>Raise a query</button>
            <button type="button" className="primary" disabled={busy||approved} onClick={()=>void run({action:"approve_completion_package",statementVersionId:current("completion_statement")?.id,accountVersionId:current("draft_statement_of_account")?.id},"Completion documents approved.")}>Approve completion documents</button></div>
        </div>}
      </>}
    </li>
  </>;
}
