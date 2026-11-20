"use client";
import { usePendingUpload } from "./usePendingUpload";
import { useEffect, useRef, useState } from "react";
import { FileText, Upload as UploadIcon } from "lucide-react";
import type { Upload } from "tus-js-client";
import type { reader, Document } from "@/lib/experiments/building-integration/reader";
import type { RecordScope } from "@/lib/experiments/building-integration/completion-boundary";
import { completionDocumentApproved, currentCompletionVersion, completionVersionEvents, type CompletionDocumentType } from "@/lib/sales/completion-review";
import { completionUploadFiles } from "@/lib/sales/completion-upload";
import type { UploadProgress } from "@/lib/sales/completion-upload-client";
import type { SaleActivity } from "@/lib/sales/discussion";
import { Badge, Notice, date, label } from "./TaskWorkspace";
import s from "../sales-workspace/Workspace.module.css";
import p from './Progression.module.css';
import {RecordGrid,recordTime} from './ProgressionRecord';

export default function CompletionDocument({ api, scope, document, type, title, identity, canUpload, canReview, onSaved, fileViewing=true,historical=false,auditEvents=[] }: {
  api: ReturnType<typeof reader>; scope: RecordScope; document?: Document; type: CompletionDocumentType;
  title: string; identity: string; canUpload: boolean; canReview: boolean; fileViewing?: boolean; historical?:boolean; auditEvents?:SaleActivity[]; onSaved: (message: string) => void;
}) {
  const current = currentCompletionVersion(document), approved = completionDocumentApproved(document);
  const [file, setFile] = useState<File | null>(null), [query, setQuery] = useState<string | null>(null);
  const [success, setSuccess] = useState(""), [confirm, setConfirm] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [progress, setProgress] = useState<UploadProgress | null>(null), [events, setEvents] = useState<SaleActivity[] | null>(null);
  usePendingUpload(Boolean(file));
  const input = useRef<HTMLInputElement>(null), controller = useRef<AbortController | null>(null);
  const stagedVersion=useRef<string|null>(null);
  const attempts = useRef(new Map<string, Upload>()), requestId = useRef(""), alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; controller.current?.abort(); }; }, []);
  function select(next: File | null) {
    setError(""); setProgress(null);
    if (next) try { completionUploadFiles([{ type, name: next.name, size: next.size, mime: next.type, expectedVersionId: current?.id ?? null }]); }
    catch (e) { setError((e as Error).message); return; }
    stagedVersion.current=current?.id??null;setSuccess("");setFile(next); requestId.current = crypto.randomUUID(); attempts.current.clear();
  }
  async function run(action: () => Promise<unknown>, message: string) {
    if (busy) return; setBusy(true); setError("");
    try { await action(); if (alive.current) {setConfirm(false);setQuery(null);setEvents(null);onSaved(message);} }
    catch (e) { if (alive.current) setError(controller.current?.signal.aborted&&file?'Upload paused. Your selected PDF is retained. Resume when ready.':(e as Error).message); }
    finally { if (alive.current) setBusy(false); }
  }
  async function view(version: string) {
    const popup = window.open("about:blank", "_blank");
    if (popup) popup.opener = null;
    try { const result = await api.workflow.document(scope, version); if (popup) popup.location.replace(result.url); else setError("Allow a new tab to view the PDF."); }
    catch (e) { popup?.close(); if (alive.current) setError((e as Error).message); }
  }
  function upload() {
    if (!file) return;
    controller.current = new AbortController();
    const selected=file;
    void run(async () => {await api.workflow.upload(scope, requestId.current, selected, {
      type, name: file.name, size: file.size, mime: file.type, expectedVersionId: stagedVersion.current,
    }, setProgress, controller.current!.signal, attempts.current);if(alive.current){setSuccess(selected.name+" uploaded successfully — awaiting approval.");setFile(null);setProgress(null);attempts.current.clear();requestId.current="";if(input.current)input.current.value="";}}, title + " uploaded. Worklists refreshed.");
  }
  const status = approved ? 'Approved current version' : document?.status==='approved' ? (historical?'Historical approval · current version unconfirmed':'Current version awaiting approval') : historical?(current?'Stored document · no current-version approval':'No stored document'):document?.status==='uploaded'?'Uploaded — awaiting approval':document?label(document.status):'Awaiting upload';
  const versionEvents=current?completionVersionEvents(auditEvents.map(e=>({...e,created_by_user_id:e.created_by_user_id??null})),current.id):[];
  const uploadEvent=versionEvents.find(e=>/_(uploaded|replaced)$/.test(e.event_type)),approvalEvent=versionEvents.find(e=>/_approved$/.test(e.event_type));
  return <section className={`${s.documentCard} ${p.document}`} aria-label={title}>
    <div className={s.cardHeading}><h2>{title}</h2><Badge>{status}</Badge></div>
    {success && !approved && document?.status!=="query_raised" && <p className={s.uploadSuccess} role="status">{success}</p>}
    {document?.query_note && <div className={s.queryNote}><strong>Current query</strong><p>{document.query_note}</p></div>}
    <div className={p.file}><FileText size={24} aria-hidden="true"/><p>{current?.file_name || (historical?'No stored document':'No document uploaded')}</p></div>
    <p className={s.meta}>{current ? "Current version " + current.version_number : historical ? "No current document is stored for this completed sale." : canUpload ? "Choose a PDF, then upload it for developer approval." : "Waiting for the conveyancer to upload this document."}</p>
    {current&&<RecordGrid fields={[["Uploaded",recordTime(current.uploaded_at)],["Uploaded by",uploadEvent?.actor_name],...(approved?[["Approved",recordTime(document?.approved_at)],["Approved by",approvalEvent?.actor_name]] as [string,string|null|undefined][]:[]) ]}/>}
    {document?.status==='approved'&&!approved&&<p className={s.meta}>The recorded approval does not identify this current file version. It is not counted as a current-version approval.</p>}
    {approved && <p className={s.meta}>This approved version is locked.</p>}
    {current&&!approved&&!historical&&<p className={s.meta}>{canReview?'Review the current PDF before approving it or raising a query.':document?.status==='query_raised'?'The conveyancer can upload a revised PDF to address the query.':'Awaiting developer approval of this version.'}</p>}
    {error && <div role="alert"><Notice>{error}</Notice><button className={s.button} onClick={() => onSaved("Reloaded the current document state.")}>Reload current state</button></div>}
    <div className={s.actions}>
      {current && <button className={s.button} disabled={!fileViewing} title={!fileViewing?"File viewing is not yet connected":undefined} onClick={() => void view(current.id)}>View document</button>}
      {canReview && current && !approved && <><button className={s.primary} disabled={busy} onClick={() => { setConfirm(true); setQuery(null); }}>Approve document</button><button className={s.button} disabled={busy} onClick={() => { setQuery(""); setConfirm(false); }}>Raise query</button></>}
    </div>
    {confirm && current && <div className={s.notice}><p>Approve {title.toLowerCase()}, version {current.version_number}, for <strong>{identity}</strong>?</p><div className={s.actions}><button className={s.primary} disabled={busy} onClick={() => void run(() => api.workflow.action(scope, { action: "approve_completion_document", documentType: type, versionId: current.id }), title + " approved. Worklists refreshed.")}>Confirm approval</button><button className={s.button} disabled={busy} onClick={() => setConfirm(false)}>Cancel approval</button></div></div>}
    {query !== null && current && <form onSubmit={e => { e.preventDefault(); void run(() => api.workflow.action(scope, { action: "query_completion_document", documentType: type, versionId: current.id, reason: query }), "Query raised. Waiting on the conveyancing team."); }}>
      <label className={s.field}>Query for {title.toLowerCase()}<textarea aria-label={"Query for " + title.toLowerCase()} autoFocus required value={query} disabled={busy} onChange={e => setQuery(e.target.value)}/></label>
      <p className={s.meta}>{identity} · version {current.version_number}</p><div className={s.actions}><button className={s.primary} disabled={busy || !query.trim()}>Submit query</button><button className={s.button} type="button" disabled={busy} onClick={() => setQuery(null)}>Cancel query</button></div>
    </form>}
    {canUpload && !approved && <div className={s.upload} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); if (!busy) select(e.dataTransfer.files[0] || null); }}>
      <UploadIcon size={22}/><strong>{current ? "Upload a revised document" : "Upload " + title.toLowerCase()}</strong>
      <span>PDF only · up to 10 MiB · drop a file here or choose one</span>
      <input ref={input} type="file" accept=".pdf,application/pdf" hidden aria-label={"PDF for " + title.toLowerCase()} onChange={e => select(e.target.files?.[0] || null)}/>
      <button className={s.button} disabled={busy} onClick={() => input.current?.click()}>Choose PDF</button>
      {file && <><strong>{file.name}</strong><small>{(file.size / 1024).toFixed(1)} KB · Selected locally, not uploaded</small><div className={s.actions}>
        <button className={s.primary} disabled={busy} onClick={upload}>{busy?'Uploading…':progress||error ? "Resume / retry upload" : current ? "Upload revised document" : "Upload document"}</button>
        <button className={s.button} disabled={busy} onClick={() => { select(null); if (input.current) input.current.value = ""; }}>Remove selected file</button>
        {busy && <button className={s.button} onClick={() => controller.current?.abort()}>Pause upload</button>}
      </div></>}
      {progress && <div className={s.uploadProgress} role="status"><p>{busy?label(progress.phase):'Upload paused'} · {Math.min(100,Math.round(progress.loaded / Math.max(1, progress.total) * 100))}%</p><progress aria-label="PDF upload progress" max={Math.max(1,progress.total)} value={Math.min(progress.loaded,Math.max(1,progress.total))}/></div>}
    </div>}
    {document && <details className={s.historyDisclosure} onToggle={e => {
      if (e.currentTarget.open && !events) void api.workflow.activity(scope).then(setEvents).catch(e => setError(e.message));
    }}><summary>Recorded document versions</summary>
      {[...document.unit_sale_document_versions].filter(v => !v.redacted_at).sort((a, b) => b.version_number - a.version_number).map(v => <article key={v.id}>
        <p><strong>{v.is_current ? "Current" : "Previous"} · version {v.version_number}</strong> · {date(v.uploaded_at)} · {v.file_name}</p>
        <button className={s.button} disabled={!fileViewing} title={!fileViewing?"File viewing is not yet connected":undefined} onClick={() => void view(v.id)}>View version {v.version_number}</button>
        {completionVersionEvents((events || []).map(e => ({ ...e, created_by_user_id: e.created_by_user_id ?? null })), v.id).map(event => <p className={s.meta} key={event.id}>{event.actor_name || "Recorded actor"} · {date(event.created_at)} · {label(event.event_type)}{event.metadata?.queryNote && " · " + event.metadata.queryNote}</p>)}
      </article>)}
      {events?.length === 51 && <p className={s.meta}>Earlier review events are available in Activity using Load older activity.</p>}
    </details>}
  </section>;
}
