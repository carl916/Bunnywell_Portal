import type { Page } from "@playwright/test";
import { salesFixture, userId } from "./sales-fixture";
import { renderLegalEmail } from "../../src/lib/sales/legal-workflow";

export async function legalFixture(page: Page) {
  const f = await salesFixture(page);
  f.attempt.workflow_status = "approved"; f.unit.sale_status = "reserved";
  const snapshot = {
    sale_id: String(f.attempt.id), unit_id: String(f.unit.id), building: { id: String(f.unit.building_id), name: "Workflow Test House", seller_name: "Seller SPV Ltd", completion_information: "As agreed in the contract" },
    buyer: "Example Buyer", plot: "101", terms: { version_number: 2, contract_price: 262500, reservation_fee: 2000, exchange_deposit_percent: 10, developer_contribution: 1000, agent_contribution: 0, parking_value: 0, parking_contribution_value: 0 }, schedule: [{payment_stage:"exchange",due_event:"exchange",expected_amount:26250,includes_reservation_fee:true,label:"10% exchange deposit"}],
    conveyancer: { id: "legal-org", name: "Legal Team", type: "conveyancer", shared_system_email: "legal@example.test" as string | null },
    sales_agent: { id: "agent-org", name: "Agent Team", type: "sales_agent", shared_system_email: "sales@example.test" }, approver: { id: userId, name: "Developer Approver" },
  };
  const emails: Record<string, unknown>[] = [];
  const actions: Record<string, unknown>[] = [];
  const deposit = { source: { id: "deposit-source", expected_amount: 26250, source_kind: "executed_authority", authority_version: 1, terms_version: 2 }, receipt: null as Record<string, unknown> | null };
  f.rows.sale_exchange_deposit_receipts = [];
  let failNotice = false;
  let failAuthoritySend = false;
  let uploadFiles: {type:string;name:string;size:number;expectedVersionId:string|null}[] = [];
  let rendered: ReturnType<typeof renderLegalEmail> | undefined;
  await page.route("**/api/sales/legal**", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ json: { snapshot, emails, completionPackage:f.completionPackage, attempt: f.attempt, deposit: f.attempt.exchanged_at ? deposit : {source:null,receipt:null}, documents: f.rows.unit_sale_documents.map((document) => ({ ...document, unit_sale_document_versions: f.rows.unit_sale_document_versions.filter((version) => version.document_id === document.id) })), events: f.rows.unit_sale_workflow_events, actors: [{id:userId,full_name:"Historical Legal Actor"}] } }); return;
    }
    if (route.request().headers()["content-type"]?.includes("multipart/form-data")) {
      const form = await new Request("http://fixture.test", { method: "POST", headers: { "content-type": route.request().headers()["content-type"] }, body: new Uint8Array(route.request().postDataBuffer()!) }).formData();
      const file = form.get("file") as File;
      actions.push({ action: form.get("action"), date: form.get("date"), noticeDate: form.get("noticeDate"), name: file.name });
      if (failNotice) { await route.fulfill({status:400,json:{error:"Upload failed; please retry."}}); return; }
      await new Promise(resolve => setTimeout(resolve, 250));
      let document = f.rows.unit_sale_documents.find(item => item.document_type === "completion_correspondence");
      if (!document) { document = { id: "notice-document", sale_attempt_id: f.attempt.id, document_type: "completion_correspondence", status: "uploaded" }; f.rows.unit_sale_documents.push(document); }
      const previous = f.rows.unit_sale_document_versions.filter(version => version.document_id === document.id);
      previous.forEach(version => { version.is_current = false; });
      f.rows.unit_sale_document_versions.push({id:`notice-${previous.length+1}`,document_id:document.id,version_number:previous.length+1,is_current:true,file_name:file.name,file_size_bytes:file.size,uploaded_at:new Date().toISOString()});
      if (form.get("action") === "confirm_notice") {
        f.attempt.contractual_completion_date=form.get("date");f.attempt.completion_notice_issued_at=form.get("noticeDate");f.attempt.completion_arrangements_confirmed_at=new Date().toISOString();
        f.rows.unit_sale_workflow_events.unshift(f.event("completion_arrangements_confirmed",22));
      }
      await route.fulfill({json:{versionId:`notice-${previous.length+1}`}});return;
    }
    const body = route.request().postDataJSON(); actions.push(body);
    if (body.action === "prepare_completion_upload") {
      uploadFiles=body.files;
      if(failNotice){await route.fulfill({status:400,json:{error:"Upload failed; please retry."}});return;}
      await route.fulfill({json:{completed:false,files:uploadFiles.map((_,i)=>({path:String(i),ready:true}))}});return;
    }
    if (body.action === "finalize_completion_upload") {
      for (const file of uploadFiles) {
        const type=file.type; let document=f.rows.unit_sale_documents.find(item=>item.document_type===type);
        if(!document){document={id:type,sale_attempt_id:f.attempt.id,document_type:type};f.rows.unit_sale_documents.push(document);}
        Object.assign(document,{status:"uploaded",approved_version_id:null,query_note:null});
        const previous=f.rows.unit_sale_document_versions.filter(v=>v.document_id===document.id);previous.forEach(v=>{v.is_current=false;});
        f.rows.unit_sale_document_versions.push({id:crypto.randomUUID(),document_id:document.id,version_number:previous.length+1,is_current:true,file_name:file.name,file_size_bytes:file.size,uploaded_at:new Date().toISOString(),uploaded_by_user_id:userId});
      }
      f.completionPackage.approved=false;await route.fulfill({json:{completed:true}});return;
    }
    if (body.action === "send" && failAuthoritySend) { await route.fulfill({status:400,json:{error:"Email could not be sent. Please retry."}}); return; }
    if (body.action === "preview") {
      rendered = renderLegalEmail(snapshot, body.kind, body.date, Date.now(), "https://portal.bunnywell.co.uk");
      await route.fulfill({ json: { ...body, snapshot, ...rendered, from: "portal@example.test", token: "preview-token" } }); return;
    }
    if (body.action === "send") emails.unshift({ id: "authority-1", sale_attempt_id:f.attempt.id, kind: body.kind, version:1, snapshot, subject:rendered?.subject, body:rendered?.body, html_body:rendered?.html, sending_address:"portal@example.test", to_recipients:[snapshot.conveyancer.shared_system_email], cc_recipients:body.kind === "authority" ? [snapshot.sales_agent.shared_system_email] : [], issued_at:new Date().toISOString(), expires_at:body.kind === "authority" ? body.date : null, proposed_completion_date:body.kind === "completion_instruction" ? body.date : null, delivery_status:"sent",resend_message_id:"resend-1" });
    if (body.action === "request_authority") { f.attempt.authority_requested_at=new Date().toISOString(); f.rows.unit_sale_workflow_events.unshift({...f.event("authority_requested",22),created_at:f.attempt.authority_requested_at,actor_name:"Abbie Smith"}); }
    if (body.action === "send" && body.kind === "notice_authority") { f.attempt.completion_authority_given_at=new Date().toISOString(); f.rows.unit_sale_workflow_events.unshift(f.event("authority_notice_given",22)); }
    if (body.action === "request_notice_authority") { f.attempt.completion_authority_requested_at=new Date().toISOString(); f.rows.unit_sale_workflow_events.unshift(f.event("authority_notice_requested",22)); }
    if (body.action === "revoke_authority") emails[0].revoked_at=new Date().toISOString();
    if (body.action === "confirm_exchange") { f.attempt.exchanged_at=body.date; f.attempt.workflow_status="exchanged"; f.unit.sale_status="exchanged"; emails[0].exchanged_at=body.date; }
    if (body.action === "confirm_exchange_deposit" || body.action === "correct_exchange_deposit_date") {
      const revision = Number(deposit.receipt?.revision ?? 0) + 1;
      deposit.receipt = { id: `receipt-${revision}`, sale_attempt_id: f.attempt.id, source_id: deposit.source.id, revision, expected_amount: 26250, received_amount: 26250, received_date: body.date, recorded_by_name: "Abbie Smith", recorded_at: "2026-09-22T12:34:00Z", correction_reason: body.reason ?? null };
      f.rows.sale_exchange_deposit_receipts.push(deposit.receipt);
      f.rows.unit_sale_workflow_events.unshift({ ...f.event(revision === 1 ? "exchange_deposit_received" : "exchange_deposit_date_corrected",22), summary: `Exchange deposit of £26,250.00 recorded as received on ${body.date} by Abbie Smith.` });
    }
    if(body.action==="approve_completion_package") {
      f.completionPackage.approved=true;f.completionPackage.approval={statement_version_id:body.statementVersionId,account_version_id:body.accountVersionId,approved_by_name:"Developer Approver",approved_at:new Date().toISOString()};
      f.rows.unit_sale_documents.forEach(doc=>{if(["completion_statement","draft_statement_of_account"].includes(String(doc.document_type)))Object.assign(doc,{status:"approved",query_note:null});});
    }
    if(body.action==="query_completion_package") {f.completionPackage.approved=false;f.rows.unit_sale_documents.forEach(doc=>{if(body.documentTypes.includes(doc.document_type))Object.assign(doc,{status:"query_raised",query_note:body.reason});});}
    if (body.action === "confirm_arrangements") f.attempt.contractual_completion_date=body.date;
    if (body.action === "confirm_completion") { f.attempt.completed_at=body.dateTime.slice(0,10); f.attempt.legal_completed_at=body.dateTime; f.attempt.workflow_status="completed"; f.unit.sale_status="completed"; }
    await route.fulfill({json:{saleAttemptId:f.attempt.id}});
  });
  return {...f,snapshot,emails,actions,deposit,failNotice:(value:boolean)=>{failNotice=value;},failAuthoritySend:(value:boolean)=>{failAuthoritySend=value;}};
}

