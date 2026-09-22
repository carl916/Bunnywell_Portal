"use client";

import { useRef, useState } from "react";
import { PdfUploadBox, type UploadVersion } from "./PdfUploadBox";
import { noticeFileError } from "@/lib/sales/completion-notice";
import { historicalActorLabel, type ActorProfile } from "@/lib/sales/actor-identity";
import { legalDateTime } from "@/lib/sales/legal-workflow";

export type CompletionVersion = UploadVersion & { id: string; version_number: number; is_current: boolean; redacted_at: string | null; uploaded_by_user_id?: string | null };
export type CompletionDocument = { id: string; document_type: string; status: string; query_note: string | null; approved_version_id: string | null; approved_by_user_id?: string | null; approved_at: string | null; unit_sale_document_versions: CompletionVersion[] };
export type CompletionPackage = { approved: boolean; approval: { approved_by_name: string; approved_at: string; statement_version_id: string; account_version_id: string } | null };
export const draftDocumentTypes = ["completion_statement", "draft_statement_of_account"] as const;
type DraftType = typeof draftDocumentTypes[number];
const labels: Record<DraftType, string> = { completion_statement: "Draft completion statement", draft_statement_of_account: "Draft statement of account" };
type Selection = { id: string; file: File; type: DraftType | ""; expectedVersionId: string | null };
export const currentCompletionVersion = (document?: CompletionDocument) => document?.unit_sale_document_versions.find(version => version.is_current && !version.redacted_at);

export function CompletionDocuments({ saleId, documents, packageState, uploadAllowed, reviewAllowed, arrangementsConfirmed, completed, busy, actors, historicalApproval, run, open }: {
  saleId: string; documents: CompletionDocument[]; packageState?: CompletionPackage; uploadAllowed: boolean; reviewAllowed: boolean; arrangementsConfirmed: boolean; completed: boolean; busy: boolean; actors: ActorProfile[];
  historicalApproval?: { name: string; date: string | null };
  run: (body: Record<string, unknown> | FormData, message: string) => Promise<boolean>; open: (versionId: string) => Promise<void>;
}) {
  const [selected, setSelected] = useState<Selection[]>([]);
  const [error, setError] = useState("");
  const [reason, setReason] = useState("");
  const [affected, setAffected] = useState<DraftType[]>([]);
  const request = useRef("");
  const doc = (type: DraftType) => documents.find(document => document.document_type === type);
  const current = (type: DraftType) => currentCompletionVersion(doc(type));
  const bothUploaded = draftDocumentTypes.every(type => current(type));
  const approved = Boolean(packageState?.approved);
  const duplicate = selected.some((item, index) => item.type && selected.some((other, otherIndex) => index !== otherIndex && item.type === other.type));
  const valid = selected.length > 0 && selected.every(item => item.type && !noticeFileError(item.file)) && !duplicate;
  function choose(files: File[], replacing?: Selection) {
    if (files.length === 0) return;
    const problem = files.map(noticeFileError).find(Boolean);
    if (problem || (!replacing && selected.length + files.length > 2)) { setError(problem || "Select at most two PDFs. Remove a selected file before adding another."); return; }
    setError(""); request.current = "";
    if (replacing) { setSelected(items => items.map(item => item.id === replacing.id ? { ...item, file: files[0] } : item)); return; }
    setSelected(items => [...items, ...files.map(file => {
      const type: DraftType | "" = /account|\bsoa\b/i.test(file.name) ? "draft_statement_of_account" : /completion|statement/i.test(file.name) ? "completion_statement" : "";
      return { id: crypto.randomUUID(), file, type, expectedVersionId: type ? current(type)?.id ?? null : null };
    })]);
  }
  async function upload() {
    if (!valid || busy) return;
    request.current ||= crypto.randomUUID();
    const form = new FormData();form.set("sale",saleId);form.set("action","upload_completion_documents");form.set("requestId",request.current);
    form.set("assignments",JSON.stringify(selected.map(item => ({ type:item.type,expectedVersionId:item.expectedVersionId }))));
    selected.forEach(item => form.append("files",item.file));
    if (await run(form,"Completion documents uploaded. Developer approval is required for the current files.")) { setSelected([]);request.current=""; }
  }
  function card(type: DraftType, history: boolean) {
    const document = doc(type), version = current(type);
    const older = document?.unit_sale_document_versions.filter(item => !item.is_current && !item.redacted_at).sort((a,b)=>b.version_number-a.version_number) ?? [];
    const status = !version ? "Not uploaded" : document?.status === "query_raised" ? "Query raised" : approved || completed && document?.status === "approved" ? "Approved" : "Awaiting approval";
    return <article key={type} className="min-w-0 rounded-xl border border-[#d9ded6] bg-white p-4" aria-label={`${history ? "Uploaded" : "Review"} ${labels[type].toLowerCase()}`}>
      <div className="flex flex-wrap items-start justify-between gap-2"><h5 className="font-bold text-[#0F3D2E]">{labels[type]}</h5><span className="text-sm font-semibold">{status}</span></div>
      {version && <><p className="mt-3 font-medium [overflow-wrap:anywhere]">{version.file_name}</p><p className="mt-1 text-sm text-[#617169]">Uploaded {legalDateTime(version.uploaded_at)} by {historicalActorLabel({userId:version.uploaded_by_user_id,profiles:actors,fallback:"Unknown user"})}</p>
        <button type="button" className="secondary mt-3" onClick={()=>void open(version.id)}>View/download</button>
        {history && uploadAllowed && <label className="secondary upload-target ml-2 mt-3 inline-flex cursor-pointer">Replace<input className="sr-only" aria-label={`Replace ${labels[type].toLowerCase()}`} type="file" accept="application/pdf,.pdf" disabled={busy || selected.length>=2 || selected.some(item=>item.type===type)} onChange={event=>{
          const file=event.target.files?.[0];event.target.value="";if(!file)return;const problem=noticeFileError(file);if(problem){setError(problem);return;}setError("");request.current="";setSelected(items=>[...items,{id:crypto.randomUUID(),file,type,expectedVersionId:version.id}]);
        }}/></label>}
      </>}
      {history && type === "completion_statement" && historicalApproval && <p className="mt-3 text-sm">Historical completion statement approved · Approved by {historicalApproval.name}{historicalApproval.date ? ` on ${legalDateTime(historicalApproval.date)}` : ""}</p>}
      {document?.query_note && <p className="mt-3 whitespace-pre-wrap rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Query raised: {document.query_note}</p>}
      {history && older.length>0 && <details className="mt-3 text-sm"><summary className="cursor-pointer">Previous versions ({older.length})</summary>{older.map(item=><div key={item.id} className="mt-2 border-t pt-2"><p className="[overflow-wrap:anywhere]">Superseded · Version {item.version_number} · {item.file_name}</p><button type="button" className="secondary mt-2" onClick={()=>void open(item.id)}>View/download</button></div>)}</details>}
    </article>;
  }
  return <>
    <li className="min-w-0 py-5" id="completion-documents-step"><h4 className="font-bold">4. Completion documents</h4>
      <p className="mt-1 text-sm">{bothUploaded ? "Both current documents uploaded." : "Upload both draft documents before developer review."}</p>
      {!arrangementsConfirmed && !completed && <p className="mt-2 text-sm text-amber-800">Confirm completion arrangements before continuing.</p>}
      {uploadAllowed && <div className="mt-4 grid gap-4">
        <PdfUploadBox id={`${saleId}-completion-documents`} label="Choose completion documents" file={null} disabled={busy} onFile={file=>{if(file)choose([file]);}} onFiles={files=>choose(files)} onClear={()=>{}} emptyPrompt="Choose or drop the completion documents" helperText="Upload the draft completion statement and draft statement of account. PDF only, maximum 10 MB per file."/>
        {selected.map(item=><div key={item.id} className="min-w-0" role="group" aria-label={`Selected ${item.file.name}`}>
          <PdfUploadBox id={item.id} label={`Replace selected ${item.file.name}`} file={item.file} disabled={busy} onFile={file=>{if(file)choose([file],item);}} onClear={()=>{setSelected(items=>items.filter(other=>other.id!==item.id));request.current="";setError("");}}/>
          <label className="field-label mt-2">Assigned document type<select className="field" aria-label={`Document type for ${item.file.name}`} value={item.type} disabled={busy} onChange={event=>{const type=event.target.value as DraftType|"";setSelected(items=>items.map(other=>other.id===item.id?{...other,type,expectedVersionId:type?current(type)?.id??null:null}:other));request.current="";}}>
            <option value="">Choose document type</option>{draftDocumentTypes.map(type=><option key={type} value={type}>{labels[type]}</option>)}
          </select></label>
          {item.type && current(item.type) && <p className="mt-2 text-sm text-amber-800">Replaces {current(item.type)?.file_name}. Fresh approval of both documents will be required.</p>}
        </div>)}
        {duplicate && <p role="alert" className="text-sm text-red-800">Assign each file a different document type.</p>}
        {error && <p role="alert" className="text-sm text-red-800">{error}</p>}
        {selected.length>0 && <button type="button" className="primary w-fit" disabled={busy||!valid} onClick={()=>void upload()}>{selected.length===1 && selected[0].expectedVersionId ? "Upload replacement document" : "Upload completion documents"}</button>}
      </div>}
      <div className="mt-4 grid min-w-0 gap-4 lg:grid-cols-2">{draftDocumentTypes.map(type=>card(type,true))}</div>
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
