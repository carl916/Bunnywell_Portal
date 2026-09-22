import { test, expect, type Page } from "@playwright/test";
import { salesFixture, userId } from "./helpers/sales-fixture";
import { renderLegalEmail } from "../src/lib/sales/legal-workflow";

async function legalFixture(page: Page) {
  const f = await salesFixture(page);
  f.attempt.workflow_status = "approved"; f.unit.sale_status = "reserved";
  const snapshot = {
    sale_id: String(f.attempt.id), unit_id: String(f.unit.id), building: { id: String(f.unit.building_id), name: "Workflow Test House", seller_name: "Seller SPV Ltd", completion_information: "As agreed in the contract" },
    buyer: "Example Buyer", plot: "101", terms: { contract_price: 250000, reservation_fee: 2000, exchange_deposit_percent: 10, developer_contribution: 1000, agent_contribution: 0, parking_value: 0, parking_contribution_value: 0 }, schedule: [],
    conveyancer: { id: "legal-org", name: "Legal Team", type: "conveyancer", shared_system_email: "legal@example.test" as string | null },
    sales_agent: { id: "agent-org", name: "Agent Team", type: "sales_agent", shared_system_email: "sales@example.test" }, approver: { id: userId, name: "Developer Approver" },
  };
  const emails: Record<string, unknown>[] = [];
  const actions: Record<string, unknown>[] = [];
  let failNotice = false;
  let rendered: ReturnType<typeof renderLegalEmail> | undefined;
  await page.route("**/api/sales/legal**", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ json: { snapshot, emails, attempt: f.attempt, documents: f.rows.unit_sale_documents.map((document) => ({ ...document, unit_sale_document_versions: f.rows.unit_sale_document_versions.filter((version) => version.document_id === document.id) })), events: f.rows.unit_sale_workflow_events, actors: [{id:userId,full_name:"Historical Legal Actor"}] } }); return;
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
    if (body.action === "preview") {
      rendered = renderLegalEmail(snapshot, body.kind, body.date, Date.now(), "https://portal.bunnywell.co.uk");
      await route.fulfill({ json: { ...body, snapshot, ...rendered, from: "portal@example.test", token: "preview-token" } }); return;
    }
    if (body.action === "send") emails.unshift({ id: "authority-1", sale_attempt_id:f.attempt.id, kind: body.kind, version:1, snapshot, subject:rendered?.subject, body:rendered?.body, html_body:rendered?.html, sending_address:"portal@example.test", to_recipients:[snapshot.conveyancer.shared_system_email], cc_recipients:body.kind === "authority" ? [snapshot.sales_agent.shared_system_email] : [], issued_at:new Date().toISOString(), expires_at:body.kind === "authority" ? body.date : null, proposed_completion_date:body.kind === "completion_instruction" ? body.date : null, delivery_status:"sent",resend_message_id:"resend-1" });
    if (body.action === "request_authority") f.attempt.authority_requested_at=new Date().toISOString();
    if (body.action === "send" && body.kind === "notice_authority") { f.attempt.completion_authority_given_at=new Date().toISOString(); f.rows.unit_sale_workflow_events.unshift(f.event("authority_notice_given",22)); }
    if (body.action === "request_notice_authority") { f.attempt.completion_authority_requested_at=new Date().toISOString(); f.rows.unit_sale_workflow_events.unshift(f.event("authority_notice_requested",22)); }
    if (body.action === "revoke_authority") emails[0].revoked_at=new Date().toISOString();
    if (body.action === "confirm_exchange") { f.attempt.exchanged_at=body.date; f.attempt.workflow_status="exchanged"; f.unit.sale_status="exchanged"; emails[0].exchanged_at=body.date; }
    if (body.action === "approve_statement") { f.rows.unit_sale_documents[0].approved_version_id=body.versionId; f.rows.unit_sale_documents[0].status="approved"; }
    if (body.action === "confirm_arrangements") f.attempt.contractual_completion_date=body.date;
    if (body.action === "confirm_completion") { f.attempt.completed_at=body.dateTime.slice(0,10); f.attempt.legal_completed_at=body.dateTime; f.attempt.workflow_status="completed"; f.unit.sale_status="completed"; }
    await route.fulfill({json:{saleAttemptId:f.attempt.id}});
  });
  return {...f,snapshot,emails,actions,failNotice:(value:boolean)=>{failNotice=value;}};
}

test("developer reviews exact recipients, confirms and preserves the sent authority", async ({ page }, testInfo) => {
  const f=await legalFixture(page); await f.reloadStage("Exchange");
  await expect(page.getByRole("button",{name:"Confirm exchange",exact:true})).toHaveCount(0);
  await page.getByRole("button",{name:"Review authority and email",exact:true}).click();
  const preview=page.getByRole("region",{name:"Final confirmation and email preview"});
  await expect(preview).toContainText("legal@example.test"); await expect(preview).toContainText("sales@example.test");
  await expect(preview.frameLocator("iframe").getByText("Seller SPV Ltd", {exact:true})).toBeVisible();
  await expect(preview.locator("iframe")).toHaveAttribute("sandbox", "");
  await preview.getByText("View plain-text email", {exact:true}).click();
  await expect(preview.locator("pre")).toContainText(`conversation=${f.attempt.id}`);
  const send=preview.getByRole("button",{name:"Issue authority to exchange",exact:true}); await expect(send).toBeDisabled();
  await preview.getByRole("checkbox").check(); await send.click();
  await expect(page.getByText("Version 1 · Authority issued",{exact:false})).toBeVisible();
  expect(f.actions.filter(action=>action.action==="send")).toHaveLength(1);
  await page.getByText("Instruction and email history (1)",{exact:true}).click();
  await expect(page.getByText("To: legal@example.test · CC: sales@example.test")).toBeVisible();
  await page.getByText("View saved email and authorised terms",{exact:true}).click();
  await expect(page.frameLocator("iframe").getByRole("link", {name:"View sale file in Bunnywell Portal",exact:true})).toHaveAttribute("href", new RegExp(`conversation=${f.attempt.id}`));
  await page.getByLabel("Revocation reason").fill("Revised contract terms"); await page.getByRole("button",{name:"Revoke authority",exact:true}).click();
  await expect(page.getByText("Version 1 · Authority revoked",{exact:false})).toBeVisible();
  await page.screenshot({path:testInfo.outputPath("legal-exchange-desktop.png"),fullPage:true});
});

test("missing recipient blocks email review and offers organisation settings",async({page})=>{
  const f=await legalFixture(page); f.snapshot.conveyancer.shared_system_email=null;
  await f.reloadStage("Exchange");
  await expect(page.getByRole("button",{name:"Review authority and email"})).toBeDisabled();
  await expect(page.getByRole("link",{name:"Open settings"})).toHaveAttribute("href",/organisation-legal-org/);
  await expect(page.getByText(/Add a valid shared system email to Legal Team/)).toBeVisible();
});

test("agent can request authority; conveyancer confirms exchange only while authority is valid",async({page})=>{
  const f=await legalFixture(page); f.profile.role="sales_agent";
  await f.reloadStage("Exchange"); await page.getByRole("button",{name:"Request authority to exchange"}).click();
  await expect(page.getByRole("button",{name:"Review authority and email"})).toHaveCount(0);
  f.profile.role="conveyancer";
  await f.reloadStage("Exchange");
  await page.getByLabel("Actual exchange date",{exact:true}).fill(new Date().toISOString().slice(0,10)); await page.getByRole("checkbox").check();
  await expect(page.getByRole("button",{name:"Confirm exchange",exact:true})).toBeDisabled();
});

test("completion statement approval does not release keys; conveyancer legal confirmation does",async({page},testInfo)=>{
  const f=await legalFixture(page); f.unit.sale_status="exchanged"; f.attempt.workflow_status="exchanged"; f.attempt.exchanged_at="2026-08-01"; f.attempt.contractual_completion_date="2026-08-05";
  f.attempt.completion_legacy_stage="arrangements";
  f.documents(); f.rows.unit_sale_documents=f.rows.unit_sale_documents.filter(document=>document.document_type==="completion_statement");
  await f.reloadStage("Completion");
  await page.getByRole("button",{name:"Approve version 1",exact:true}).click();
  await expect(page.getByText("Version 1 approved",{exact:false})).toBeVisible();
  await expect(page.getByRole("button",{name:/^Handover\b/})).toBeDisabled();
  f.profile.role="conveyancer"; await f.reloadStage("Completion");
  await page.getByLabel("Actual legal completion date and time (your local time)").fill("2026-08-05T15:00");
  await page.getByRole("checkbox",{name:/I confirm legal completion/}).check();
  await page.getByRole("button",{name:"Confirm legal completion",exact:true}).click();
  await expect(page.getByRole("button",{name:/^Completion\b/})).toHaveAttribute("aria-current","step");
  await expect(page.getByText(/Handover and key release are available/)).toBeVisible();
  await expect(page.getByText("Choose final statement of account PDF",{exact:true})).toBeVisible();
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.screenshot({path:testInfo.outputPath("legal-completion-mobile.png"),fullPage:true});
});

test("historical completion retains dates and actor names with no invented timestamp",async({page})=>{
  const f=await legalFixture(page); f.unit.sale_status="completed"; f.attempt.workflow_status="completed"; f.attempt.exchanged_at="2026-08-01"; f.attempt.completed_at="2026-08-05";
  f.rows.unit_sale_workflow_events=[f.event("completion_recorded",5)];
  await f.reloadStage("Completion");
  await expect(page.getByText(/05\/08\/2026 \(historical date; time not recorded\)/)).toBeVisible();
  await expect(page.getByText(/Completed by Historical Legal Actor/)).toBeVisible();
  await expect(page.getByRole("button",{name:"Confirm legal completion",exact:true})).toHaveCount(0);
});

for (const role of ["sales_agent", "conveyancer"]) test(`${role} requests notice authority while notice and later controls stay locked`, async ({page}) => {
  const f=await legalFixture(page);f.profile.role=role;f.unit.sale_status="exchanged";f.attempt.workflow_status="exchanged";f.attempt.exchanged_at="2026-08-01";
  await f.reloadStage("Completion");
  await expect(page.getByText("Awaiting developer authority to serve notice",{exact:true})).toBeVisible();
  await expect(page.getByLabel("Notice issue date",{exact:true})).toHaveCount(0);
  await expect(page.getByLabel("Notice PDF",{exact:true})).toHaveCount(0);
  await expect(page.getByText("Choose draft completion statement PDF",{exact:true})).toHaveCount(0);
  await expect(page.getByRole("button",{name:"Confirm legal completion",exact:true})).toHaveCount(0);
  await page.getByRole("button",{name:"Request authority to serve notice",exact:true}).click();
  await expect(page.getByRole("button",{name:"Request authority to serve notice",exact:true})).toHaveCount(0);
  await expect(page.getByText(/Requested by Historical Legal Actor/)).toBeVisible();
  expect(f.actions.filter(action=>action.action==="request_notice_authority")).toHaveLength(1);
});

test("developer reviews notice authority without a date and grants it directly",async({page})=>{
  const f=await legalFixture(page);f.unit.sale_status="exchanged";f.attempt.workflow_status="exchanged";f.attempt.exchanged_at="2026-08-01";
  await f.reloadStage("Completion");
  await expect(page.getByLabel(/Proposed completion/)).toHaveCount(0);
  await page.getByRole("button",{name:"Review authority to serve notice and email",exact:true}).click();
  const preview=page.getByRole("region",{name:"Final confirmation and email preview"});await expect(preview).toContainText("sales@example.test");await expect(preview).toContainText("legal@example.test");await expect(preview.frameLocator("iframe").locator("body")).toContainText("serve notice under the contract");
  await expect(preview.frameLocator("iframe").locator("body")).not.toContainText("Proposed completion date");
  await preview.getByRole("checkbox").check();await preview.getByRole("button",{name:"Give authority to serve notice",exact:true}).click();
  await expect(page.getByText("Not requested – authority given directly",{exact:true})).toBeVisible();await expect(page.getByText(/Authority given by Historical Legal Actor/)).toBeVisible();
  await expect(page.getByLabel("Notice issue date",{exact:true})).toHaveCount(0);
  await expect(page.getByRole("button",{name:"Review authority to serve notice and email",exact:true})).toHaveCount(0);
});

test("notice form stages PDF, preserves a manual due date, retries failures and retains replacement history",async({page},testInfo)=>{
  const f=await legalFixture(page);f.profile.role="conveyancer";f.unit.sale_status="exchanged";f.attempt.workflow_status="exchanged";f.attempt.exchanged_at="2026-08-01";f.attempt.completion_authority_given_at="2026-08-02T12:00:00Z";
  await f.reloadStage("Completion");
  const notice=page.getByLabel("Notice issue date",{exact:true}),due=page.getByLabel("Completion due date",{exact:true}),confirm=page.getByRole("button",{name:"Confirm completion arrangements",exact:true});
  await notice.fill("2026-09-18");await expect(due).toHaveValue("2026-10-02");await notice.fill("2026-09-21");await expect(due).toHaveValue("2026-10-05");
  await due.fill("2026-10-09");await notice.fill("2026-09-22");await expect(due).toHaveValue("2026-10-09");await expect(confirm).toBeDisabled();
  await page.getByLabel("Notice PDF",{exact:true}).setInputFiles({name:"not-a-pdf.txt",mimeType:"text/plain",buffer:Buffer.from("no")});await expect(page.getByRole("alert").filter({hasText:"Choose a PDF up to 10 MB."})).toBeVisible();await expect(confirm).toBeDisabled();
  const name="Notice-for-plot-101-with-a-long-complete-file-name-for-the-contract.pdf";
  await page.getByLabel("Notice PDF",{exact:true}).setInputFiles({name,mimeType:"application/pdf",buffer:Buffer.from("%PDF-1.7\nnotice")});
  await expect(page.getByText("Choose or drop notice PDF",{exact:true})).toHaveCount(0);await expect(page.getByText("Selected – ready to submit",{exact:true})).toBeVisible();await expect(confirm).toBeEnabled();expect(f.actions).toHaveLength(0);
  await page.getByRole("button",{name:"Remove",exact:true}).click();await expect(confirm).toBeDisabled();await expect(page.getByText("Choose or drop notice PDF",{exact:true})).toBeVisible();
  // Exercise dropping a PDF as well as the keyboard-accessible file input.
  const transfer=await page.evaluateHandle(()=>{const data=new DataTransfer();data.items.add(new File(["%PDF-1.7\nnotice"],"Notice-for-plot-101-with-a-long-complete-file-name-for-the-contract.pdf",{type:"application/pdf"}));return data;});
  await page.getByText("Choose or drop notice PDF",{exact:true}).dispatchEvent("drop",{dataTransfer:transfer});await expect(confirm).toBeEnabled();
  await due.fill("2026-09-01");await expect(confirm).toBeDisabled();await due.fill("2026-10-09");
  await page.setViewportSize({width:390,height:844});await page.locator("#sales-stage-completion").screenshot({path:testInfo.outputPath("notice-selected-mobile.png")});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  f.failNotice(true);await confirm.click();await expect(page.getByRole("alert").filter({hasText:"Upload failed"})).toBeVisible();await expect(page.getByText("Selected – ready to submit",{exact:true})).toBeVisible();
  f.failNotice(false);await confirm.dblclick();await expect(confirm).toHaveCount(0);
  expect(f.actions.filter(action=>action.action==="confirm_notice")).toHaveLength(2);await expect(page.getByText(name,{exact:true})).toHaveCount(1);await expect(page.getByText(/Confirmed by Historical Legal Actor/)).toBeVisible();
  await page.getByLabel("Replace Choose notice pdf PDF",{exact:true}).setInputFiles({name:"replacement.pdf",mimeType:"application/pdf",buffer:Buffer.from("%PDF-1.7\nreplacement")});
  await page.getByRole("button",{name:"Save replacement PDF",exact:true}).click();await expect(page.getByText("replacement.pdf",{exact:true})).toHaveCount(1);
  const history=page.getByText("Previous versions (1)",{exact:true});await expect(history).toBeVisible();await expect(page.getByText(new RegExp(`Version 1 · ${name}`))).not.toBeVisible();await history.click();await expect(page.getByText(new RegExp(`Version 1 · ${name}`))).toBeVisible();
  await expect(page.getByText("Version 2 · replacement.pdf",{exact:true})).toHaveCount(0);
});

test("Exchange remains selected after its final action when initially opened from the sale status",async({page})=>{
  const f=await legalFixture(page);f.profile.role="conveyancer";
  f.emails.push({id:"authority",kind:"authority",version:1,delivery_status:"sent",expires_at:new Date(Date.now()+86400000).toISOString(),issued_at:new Date().toISOString(),snapshot:f.snapshot,to_recipients:["legal@example.test"],cc_recipients:[],resend_message_id:"message"});
  await page.reload();await expect(page.getByRole("button",{name:/^Exchange\b/})).toHaveAttribute("aria-current","step");
  await page.getByLabel("Actual exchange date",{exact:true}).fill(new Date().toISOString().slice(0,10));await page.getByRole("checkbox",{name:/exchange deposit/}).check();
  await page.getByRole("button",{name:"Confirm exchange",exact:true}).click();await expect(page.getByText(/Actual exchange date:/)).toBeVisible();
  await expect(page.getByRole("button",{name:/^Exchange\b/})).toHaveAttribute("aria-current","step");await expect(page.getByRole("button",{name:/^Completion\b/})).toBeEnabled();
  await expect(page.getByRole("list",{name:"Completion tasks",exact:true})).toHaveCount(0);
});

test("Completion remains selected after legal completion when initially opened from the sale status",async({page})=>{
  const f=await legalFixture(page);f.profile.role="conveyancer";f.unit.sale_status="exchanged";f.attempt.workflow_status="exchanged";f.attempt.exchanged_at="2026-08-01";f.attempt.contractual_completion_date="2026-08-05";f.attempt.completion_legacy_stage="arrangements";
  f.documents();Object.assign(f.rows.unit_sale_documents[0],{status:"approved",approved_version_id:"version-0"});
  await page.reload();await expect(page.getByRole("button",{name:/^Completion\b/})).toHaveAttribute("aria-current","step");
  await page.getByLabel("Actual legal completion date and time (your local time)").fill("2026-08-05T15:00");await page.getByRole("checkbox",{name:/I confirm legal completion/}).check();await page.getByRole("button",{name:"Confirm legal completion",exact:true}).click();
  await expect(page.getByText(/Handover and key release are available/)).toBeVisible();await expect(page.getByRole("button",{name:/^Completion\b/})).toHaveAttribute("aria-current","step");await expect(page.getByRole("button",{name:/^Handover\b/})).toBeEnabled();
});
