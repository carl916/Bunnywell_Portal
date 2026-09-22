import { test, expect } from "@playwright/test";
import { legalFixture } from "./helpers/legal-ui-fixture";
import { mkdir } from "node:fs/promises";

test("completion package selects both PDFs, queries one file, preserves replacement history and unlocks legal completion only after approval",async({page})=>{
  const f=await legalFixture(page);f.profile.role="conveyancer";f.unit.sale_status="exchanged";Object.assign(f.attempt,{workflow_status:"exchanged",exchanged_at:"2026-09-01",completion_legacy_stage:"arrangements"});
  await f.reloadStage("Completion");const documents=page.locator("#completion-documents-step"),review=page.locator("#completion-approval-step"),legal=page.getByRole("list",{name:"Completion tasks",exact:true}).locator(":scope > li").nth(5);
  await mkdir("artifacts/completion-package",{recursive:true});
  await expect(review).toContainText("Available once the conveyancer has uploaded both completion documents.");await expect(review.getByRole("button")).toHaveCount(0);
  await expect(legal).toContainText("Available once the current completion documents have been approved by the developer.");await expect(legal.locator("input,button,textarea,select")).toHaveCount(0);
  await documents.screenshot({style:"nextjs-portal { display: none !important; }",path:"artifacts/completion-package/01-empty-upload.png"});await legal.screenshot({style:"nextjs-portal { display: none !important; }",path:"artifacts/completion-package/07-legal-locked.png"});
  const pdf=(name:string)=>({name,mimeType:"application/pdf",buffer:Buffer.from("%PDF-1.7\nfixture")});
  const picker=documents.getByLabel("Choose completion documents",{exact:true});await expect(picker).toHaveAttribute("multiple","");
  await picker.setInputFiles([pdf("first.pdf"),pdf("second.pdf")]);const upload=documents.getByRole("button",{name:"Upload completion documents",exact:true});
  await expect(upload).toBeDisabled();await documents.getByLabel("Document type for first.pdf").selectOption("completion_statement");await documents.getByLabel("Document type for second.pdf").selectOption("completion_statement");
  await expect(documents.getByRole("alert")).toContainText("different document type");await expect(upload).toBeDisabled();
  await documents.getByLabel("Document type for second.pdf").selectOption("draft_statement_of_account");await expect(upload).toBeEnabled();await expect(upload).toHaveClass(/primary/);
  await documents.getByLabel("Replace selected first.pdf",{exact:true}).setInputFiles(pdf("draft-completion.pdf"));await documents.getByLabel("Replace selected second.pdf",{exact:true}).setInputFiles(pdf("draft-account.pdf"));
  await documents.screenshot({style:"nextjs-portal { display: none !important; }",path:"artifacts/completion-package/02-two-selected.png"});
  await page.setViewportSize({width:390,height:2600});await documents.screenshot({style:"nextjs-portal { display: none !important; }",path:"artifacts/completion-package/02-two-selected-mobile.png"});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.setViewportSize({width:1280,height:900});
  f.failNotice(true);await upload.click();await expect(page.getByRole("alert").filter({hasText:"Upload failed"})).toBeVisible();await expect(documents.getByRole("group",{name:"Selected draft-account.pdf",exact:true})).toBeVisible();f.failNotice(false);await upload.click();
  await expect(documents.getByRole("group")).toHaveCount(0);await expect(documents.getByText("Awaiting approval",{exact:true})).toHaveCount(2);await expect(legal.locator("input,button")).toHaveCount(0);
  expect(f.actions.filter(action=>action.action==="prepare_completion_upload")).toHaveLength(2);expect(f.rows.unit_sale_document_versions).toHaveLength(2);await documents.screenshot({style:"nextjs-portal { display: none !important; }",path:"artifacts/completion-package/03-uploaded-awaiting.png"});
  f.profile.role="developer";await f.reloadStage("Completion");await expect(review.getByRole("article")).toHaveCount(2);await expect(review).not.toContainText("Version 1");await expect(review.getByRole("button",{name:"Approve completion documents",exact:true})).toHaveClass(/primary/);await review.screenshot({style:"nextjs-portal { display: none !important; }",path:"artifacts/completion-package/04-developer-review.png"});
  const query=review.getByRole("button",{name:"Raise a query",exact:true});await expect(query).toBeDisabled();await review.getByRole("checkbox",{name:"Draft statement of account",exact:true}).check();await expect(query).toBeDisabled();await review.getByLabel("Query or rejection reason").fill("Please correct the retained balance.");await query.click();
  expect(f.actions.find(action=>action.action==="query_completion_package")).toMatchObject({documentTypes:["draft_statement_of_account"],reason:"Please correct the retained balance."});
  f.profile.role="conveyancer";await f.reloadStage("Completion");await expect(documents.getByRole("article",{name:"Uploaded draft statement of account",exact:true})).toContainText("Query raised: Please correct the retained balance.");await documents.screenshot({style:"nextjs-portal { display: none !important; }",path:"artifacts/completion-package/05-queried-document.png"});
  const original=f.rows.unit_sale_document_versions.find(version=>version.file_name==="draft-account.pdf")!;
  await documents.getByLabel("Replace draft statement of account",{exact:true}).setInputFiles(pdf("corrected-account.pdf"));await expect(documents).toContainText("Replaces draft-account.pdf");await documents.getByRole("button",{name:"Upload replacement document",exact:true}).click();
  await expect(documents.getByText("Previous versions (1)",{exact:true})).toBeVisible();expect(original.is_current).toBe(false);expect(f.rows.unit_sale_document_versions).toHaveLength(3);
  await expect(legal.locator("input,button")).toHaveCount(0);f.profile.role="developer";await f.reloadStage("Completion");await review.getByRole("button",{name:"Approve completion documents",exact:true}).click();
  await expect(review.getByText("Completion documents approved",{exact:true})).toBeVisible();await expect(review).not.toContainText("Version 1");await review.screenshot({style:"nextjs-portal { display: none !important; }",path:"artifacts/completion-package/06-approved.png"});await expect(page.getByRole("button",{name:/^Handover\b/})).toBeDisabled();
  f.profile.role="conveyancer";await f.reloadStage("Completion");await expect(legal.getByLabel("Actual legal completion date and time (your local time)")).toBeVisible();await legal.screenshot({style:"nextjs-portal { display: none !important; }",path:"artifacts/completion-package/08-legal-unlocked.png"});
  // Replacing either approved file relocks the form without deleting its approval.
  await documents.getByLabel("Replace draft completion statement",{exact:true}).setInputFiles(pdf("revised-completion.pdf"));await documents.getByRole("button",{name:"Upload replacement document",exact:true}).click();await expect(legal.locator("input,button")).toHaveCount(0);expect(f.completionPackage.approval).not.toBeNull();
});

test("completion combined drop zone keeps both files and independent upload leaves developer approval locked",async({page})=>{
  const f=await legalFixture(page);f.profile.role="conveyancer";f.unit.sale_status="exchanged";Object.assign(f.attempt,{workflow_status:"exchanged",exchanged_at:"2026-09-01",completion_legacy_stage:"arrangements"});await f.reloadStage("Completion");
  const documents=page.locator("#completion-documents-step"),review=page.locator("#completion-approval-step");
  const transfer=await page.evaluateHandle(()=>{const dt=new DataTransfer();for(const name of ["completion.pdf","account.pdf"])dt.items.add(new File(["%PDF-1.7"],name,{type:"application/pdf"}));return dt;});
  await documents.locator("label.upload-target").first().dispatchEvent("drop",{dataTransfer:transfer});await transfer.dispose();await expect(documents.getByRole("group")).toHaveCount(2);
  await expect(documents.getByLabel("Document type for completion.pdf")).toHaveValue("completion_statement");await expect(documents.getByLabel("Document type for account.pdf")).toHaveValue("draft_statement_of_account");
  await documents.getByRole("group",{name:"Selected account.pdf",exact:true}).getByRole("button",{name:"Remove",exact:true}).click();await documents.getByRole("button",{name:"Upload completion documents",exact:true}).click();await expect(review).toContainText("Available once the conveyancer has uploaded both completion documents.");
  await expect(documents.locator('[role="group"][aria-label^="Selected "]')).toHaveCount(0);expect(f.rows.unit_sale_document_versions).toHaveLength(1);await documents.getByLabel("Choose completion documents",{exact:true}).setInputFiles({name:"invalid.txt",mimeType:"text/plain",buffer:Buffer.from("text")});await expect(documents.getByRole("alert")).toContainText("PDF");
  for(const role of ["sales_agent","developer"]) {f.profile.role=role;await f.reloadStage("Completion");await expect(documents.locator('input[type="file"]')).toHaveCount(0);await expect(review.getByRole("button")).toHaveCount(0);}
});

test("post-exchange deposit is locked before exchange, then records a full read-only receipt and audited correction",async({page})=>{
  const f=await legalFixture(page);f.profile.role="conveyancer";
  f.emails.push({id:"authority",kind:"authority",version:1,delivery_status:"sent",expires_at:new Date(Date.now()+86400000).toISOString(),issued_at:new Date().toISOString(),snapshot:f.snapshot,to_recipients:["legal@example.test"],cc_recipients:[],resend_message_id:"message"});
  await f.reloadStage("Exchange");const task=page.locator("#exchange-deposit-task");
  await expect(task).toContainText("Locked until the conveyancer records legal exchange.");await expect(task.getByRole("button")).toHaveCount(0);
  await page.getByLabel("Actual exchange date",{exact:true}).fill(new Date().toISOString().slice(0,10));await page.getByRole("button",{name:"Confirm exchange",exact:true}).click();
  await expect(task).toContainText("Expected exchange deposit: £26,250.00");await expect(page.getByRole("button",{name:/^Completion\b/})).toBeEnabled();
  await expect(page.getByRole("button",{name:/^Exchange\b/})).toContainText("Deposit confirmation outstanding");
  expect(f.actions.find(action=>action.action==="confirm_exchange")).not.toHaveProperty("depositConfirmed");
  await expect(task.locator('input[type="number"]')).toHaveCount(0);const confirm=task.getByRole("button",{name:"Confirm deposit received",exact:true});await expect(confirm).toBeDisabled();
  await task.getByRole("checkbox",{name:"I confirm that the full expected exchange deposit of £26,250.00 has been received."}).check();
  await task.getByLabel("Date deposit received",{exact:true}).fill("");await expect(confirm).toBeDisabled();
  await task.getByLabel("Date deposit received",{exact:true}).fill("2026-09-21");await expect(confirm).toBeEnabled();
  await mkdir("artifacts/exchange-deposit",{recursive:true});await page.locator("#sales-stage-exchange").screenshot({path:"artifacts/exchange-deposit/confirmation-form.png"});
  await page.setViewportSize({width:390,height:844});await task.screenshot({path:"artifacts/exchange-deposit/confirmation-mobile.png"});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await confirm.dblclick();await expect(task).toContainText("Deposit received");await expect(task.getByLabel("Date deposit received",{exact:true})).toHaveCount(0);
  await expect(task).toContainText("21 September 2026");await expect(task).toContainText("Abbie Smith");await expect(task).toContainText("22 September 2026");
  expect(f.actions.filter(action=>action.action==="confirm_exchange_deposit")).toEqual([{action:"confirm_exchange_deposit",sourceId:"deposit-source",date:"2026-09-21",confirmed:true,sale:f.attempt.id}]);
  await expect(page.getByRole("button",{name:/^Exchange\b/})).toContainText("Deposit received");
  await page.setViewportSize({width:1280,height:900});await page.locator("#sales-stage-exchange").screenshot({path:"artifacts/exchange-deposit/completed-outcome.png"});
  await task.getByRole("button",{name:"Correct receipt date",exact:true}).click();await task.getByLabel("Date deposit received",{exact:true}).fill("2026-09-20");
  await expect(task.getByRole("button",{name:"Save corrected receipt date"})).toBeDisabled();await task.getByLabel("Reason for correction").fill("Checked the client account ledger");await task.getByRole("button",{name:"Save corrected receipt date"}).click();
  await expect(task).toContainText("20 September 2026");await expect(task).toContainText("Original confirmation and corrections are retained in Activity.");
  await page.getByRole("button",{name:/^Completion\b/}).click();await expect(page.getByRole("list",{name:"Completion tasks",exact:true})).toBeVisible();
});

for(const role of ["developer","sales_agent"]) test(`${role} views historical outstanding deposit but cannot record it`,async({page})=>{
  const f=await legalFixture(page);f.profile.role=role;f.attempt.workflow_status="exchanged";f.attempt.exchanged_at="2026-08-01";f.unit.sale_status="exchanged";f.deposit.source.source_kind="legacy_locked_terms";
  await f.reloadStage("Exchange");const task=page.locator("#exchange-deposit-task");await expect(task).toContainText("Deposit confirmation outstanding");await expect(task).toContainText("Historical locked commercial terms");await expect(task.getByRole("button")).toHaveCount(0);await expect(task.getByRole("checkbox")).toHaveCount(0);await expect(page.getByRole("button",{name:/^Completion\b/})).toBeEnabled();
  if(role==="developer") {await mkdir("artifacts/exchange-deposit",{recursive:true});await page.locator("#sales-stage-exchange").screenshot({path:"artifacts/exchange-deposit/outstanding-task.png"});}
  f.deposit.receipt={id:"historical-receipt",received_amount:26250,received_date:"2026-09-21",recorded_by_name:"Abbie Smith",recorded_at:"2026-09-22T12:34:00Z",revision:1};await f.reloadStage("Exchange");await expect(task).toContainText("Deposit received");await expect(task).toContainText("Abbie Smith");await expect(task.getByRole("button")).toHaveCount(0);
});

for(const role of ["sales_agent","conveyancer"]) test(`${role} sees issued outcomes and can request renewal only after expiry`,async({page})=>{
  const f=await legalFixture(page);f.profile.role=role;
  const issued=new Date(Date.now()-7200000).toISOString();
  const email={id:"authority",kind:"authority",version:1,delivery_status:"delivered",expires_at:new Date(Date.now()+86400000).toISOString(),issued_at:issued,snapshot:structuredClone(f.snapshot),to_recipients:["legal@example.test"],cc_recipients:["sales@example.test"],resend_message_id:"message"};f.emails.push(email);
  f.snapshot.terms.contract_price=999999;
  await f.reloadStage("Exchange");const tasks=page.getByRole("list",{name:"Exchange tasks"}).getByRole("listitem"),summary=page.getByLabel("Authority status");
  await expect(tasks.nth(0)).toContainText("1. Authority request");await expect(tasks.nth(0)).toContainText("Not requested – authority given directly");await expect(tasks.nth(0).getByRole("button")).toHaveCount(0);
  await expect(summary).toContainText("Active");await expect(summary).toContainText("Issued by Developer Approver on");await expect(summary).toContainText("Valid until");await expect(summary).toContainText("Version 1");await expect(summary).toContainText("Email delivery: delivered");
  await expect(tasks.nth(1)).not.toContainText("The developer reviews the agreed sale terms");await expect(tasks.nth(1)).toContainText("£262,500.00");await expect(tasks.nth(1)).not.toContainText("£999,999.00");
  await mkdir("artifacts/authority-states",{recursive:true});if(role==="conveyancer") await page.locator("#sales-stage-exchange").screenshot({path:"artifacts/authority-states/active-authority.png"});
  email.expires_at=new Date(Date.now()-3600000).toISOString();await f.reloadStage("Exchange");await expect(summary.getByText("Expired",{exact:true})).toBeVisible();
  await page.getByRole("button",{name:"Request renewed authority",exact:true}).click();await expect(tasks.nth(0)).toContainText("Requested by Abbie Smith on");await expect(page.getByRole("button",{name:"Request renewed authority",exact:true})).toHaveCount(0);expect(f.emails).toHaveLength(1);
  if(role==="conveyancer") await page.locator("#sales-stage-exchange").screenshot({path:"artifacts/authority-states/renewal-requested.png"});
  f.emails.unshift({...email,id:"authority-2",version:2,issued_at:new Date(Date.now()+1000).toISOString(),expires_at:new Date(Date.now()+86400000).toISOString()});
  await f.reloadStage("Exchange");await expect(summary).toContainText("Version 2");await expect(tasks.nth(0).getByRole("button")).toHaveCount(0);await expect(tasks.nth(0)).toContainText("Requested by Abbie Smith on");
});

test("developer reviews exact recipients, confirms and preserves the sent authority", async ({ page }, testInfo) => {
  const f=await legalFixture(page); await f.reloadStage("Exchange");
  await expect(page.getByRole("button",{name:"Confirm exchange",exact:true})).toHaveCount(0);
  await page.getByRole("button",{name:"Review authority and email",exact:true}).click();
  const preview=page.getByRole("region",{name:"Final confirmation and email preview"});
  await expect(preview).toContainText("legal@example.test"); await expect(preview).toContainText("sales@example.test");
  await expect(preview.frameLocator("iframe").getByText("Seller SPV Ltd", {exact:true})).toBeVisible();
  await expect(preview.locator("iframe")).toHaveAttribute("sandbox", "");
  await expect(preview).toContainText("Preview only – this authority has not been issued.");await expect(preview).toContainText("Valid until");
  await mkdir("artifacts/authority-states",{recursive:true});await preview.screenshot({path:"artifacts/authority-states/email-preview.png"});
  await preview.getByText("View plain-text email", {exact:true}).click();
  await expect(preview.locator("pre")).toContainText(`conversation=${f.attempt.id}`);
  const send=preview.getByRole("button",{name:"Issue authority to exchange",exact:true}); await expect(send).toBeDisabled();
  await preview.getByRole("checkbox").check(); await send.click();
  await expect(page.getByLabel("Authority status").getByText("Active",{exact:true})).toBeVisible();
  expect(f.actions.filter(action=>action.action==="send")).toHaveLength(1);
  await page.getByText("Instruction and email history (1)",{exact:true}).click();
  await expect(page.getByText("To: legal@example.test · CC: sales@example.test").last()).toBeVisible();
  await page.getByText("View saved email and authorised terms",{exact:true}).click();
  await expect(page.frameLocator("iframe").getByRole("link", {name:"View sale file in Bunnywell Portal",exact:true})).toHaveAttribute("href", new RegExp(`conversation=${f.attempt.id}`));
  await page.getByLabel("Revocation reason").fill("Revised contract terms"); await page.getByRole("button",{name:"Revoke authority",exact:true}).click();
  await expect(page.getByLabel("Authority status").getByText("Revoked",{exact:true})).toBeVisible();
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
  await page.getByLabel("Actual exchange date",{exact:true}).fill(new Date().toISOString().slice(0,10));
  await expect(page.getByRole("button",{name:"Confirm exchange",exact:true})).toBeDisabled();
});

test("completion statement approval does not release keys; conveyancer legal confirmation does",async({page},testInfo)=>{
  const f=await legalFixture(page); f.unit.sale_status="exchanged"; f.attempt.workflow_status="exchanged"; f.attempt.exchanged_at="2026-08-01"; f.attempt.contractual_completion_date="2026-08-05";
  f.attempt.completion_legacy_stage="arrangements";
  f.documents(true);
  await f.reloadStage("Completion");
  await page.getByRole("button",{name:"Approve completion documents",exact:true}).click();
  await expect(page.getByText("Completion documents approved",{exact:true})).toBeVisible();
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

test("notice authority preview stays in Step 2, toggles accessibly and preserves failed sends",async({page})=>{
  const f=await legalFixture(page);f.unit.sale_status="exchanged";f.attempt.workflow_status="exchanged";f.attempt.exchanged_at="2026-08-01";
  await f.reloadStage("Completion");
  const steps=page.getByRole("list",{name:"Completion tasks",exact:true}).locator(":scope > li");
  const step=steps.nth(1),button=step.getByRole("button",{name:"Review authority to serve notice and email",exact:true});
  const preview=page.getByRole("region",{name:"Final confirmation and email preview",exact:true});
  await expect(button).toHaveAttribute("aria-expanded","false");const collapsedTop=await steps.nth(2).evaluate(node=>node.getBoundingClientRect().top+scrollY);
  await button.focus();await page.keyboard.press("Enter");await expect(button).toHaveAttribute("aria-expanded","true");await expect(preview).toHaveCount(1);await expect(preview).toBeFocused();
  await expect(step.getByRole("region",{name:"Final confirmation and email preview"})).toHaveCount(1);
  await expect(preview).toHaveAttribute("id",await button.getAttribute("aria-controls") ?? "missing");
  expect(await button.evaluate(node=>node.nextElementSibling?.getAttribute("role"))).toBe("region");
  for(const index of [2,3,4,5]) expect(await steps.nth(index).evaluate(node=>node.previousElementSibling !== null && Boolean((document.querySelector('#notice-authority-step')?.compareDocumentPosition(node) ?? 0) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
  expect(await steps.nth(2).evaluate(node=>node.getBoundingClientRect().top+scrollY)).toBeGreaterThan(collapsedTop+500);
  expect(await preview.evaluate(node=>node.closest('li')?.id)).toBe("notice-authority-step");
  await button.focus();await page.keyboard.press("Space");await expect(button).toHaveAttribute("aria-expanded","false");await expect(preview).toHaveCount(0);await expect(button).toBeFocused();
  await page.keyboard.press("Enter");await preview.getByRole("checkbox").check();await preview.getByRole("button",{name:"Cancel",exact:true}).click();
  await expect(preview).toHaveCount(0);await expect(button).toHaveAttribute("aria-expanded","false");await expect(button).toBeFocused();
  await page.keyboard.press("Space");await expect(preview.getByRole("checkbox")).not.toBeChecked();
  const send=preview.getByRole("button",{name:"Give authority to serve notice",exact:true});await expect(send).toBeDisabled();
  await expect(preview.frameLocator("iframe").getByRole("heading",{name:"Authority to serve notice",exact:true})).toBeVisible();
  await mkdir("artifacts/notice-authority-preview",{recursive:true});await page.locator("#sales-stage-completion").screenshot({path:"artifacts/notice-authority-preview/desktop.png"});
  await page.setViewportSize({width:390,height:844});
  await expect.poll(()=>preview.evaluate(node=>{const panel=node.getBoundingClientRect(),parent=node.parentElement!.getBoundingClientRect();return panel.left>=parent.left && panel.right<=parent.right+1;})).toBe(true);
  await expect(preview.frameLocator("iframe").getByRole("heading",{name:"Authority to serve notice",exact:true})).toBeVisible();
  // A tall capture viewport paints the entire embedded email at the mobile width.
  await page.setViewportSize({width:390,height:2600});await preview.locator("iframe").scrollIntoViewIfNeeded();
  await page.locator("#sales-stage-completion").screenshot({path:"artifacts/notice-authority-preview/mobile.png"});
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  f.failAuthoritySend(true);await preview.getByRole("checkbox").check();await send.click();
  await expect(step.getByRole("alert")).toHaveText("Email could not be sent. Please retry.");await expect(page.locator("#sales-stage-completion").getByRole("alert")).toHaveCount(1);await expect(preview).toHaveCount(1);await expect(button).toHaveAttribute("aria-expanded","true");await expect(preview.getByRole("checkbox")).toBeChecked();
  await expect(steps.nth(2)).toContainText("Awaiting developer authority to serve notice");expect(f.emails).toHaveLength(0);
  f.failAuthoritySend(false);await send.click();await expect(preview).toHaveCount(0);await expect(step.getByRole("button")).toHaveCount(0);await expect(step).toContainText("Authority given by Historical Legal Actor");await expect(step.getByRole("alert")).toHaveCount(0);
  await expect(steps.nth(2)).not.toContainText("Awaiting developer authority");await expect(steps.nth(2)).toContainText("Awaiting the conveyancer’s notice dates and PDF.");
  expect(f.emails).toHaveLength(1);expect(f.emails[0]).toMatchObject({kind:"notice_authority",version:1,delivery_status:"sent"});
  const attempts=f.actions.filter(action=>action.action==="send");expect(attempts).toHaveLength(2);expect(attempts[0].requestId).toBe(attempts[1].requestId);
  await page.getByText("Instruction and email history (1)",{exact:true}).click();await expect(page.getByText("Authority to serve notice · Version 1 · sent",{exact:true})).toBeVisible();
  f.profile.role="conveyancer";await f.reloadStage("Completion");await expect(page.getByLabel("Notice issue date",{exact:true})).toBeVisible();
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
  await page.getByLabel("Actual exchange date",{exact:true}).fill(new Date().toISOString().slice(0,10));
  await page.getByRole("button",{name:"Confirm exchange",exact:true}).click();await expect(page.getByText(/Actual exchange date:/)).toBeVisible();
  await expect(page.getByRole("button",{name:/^Exchange\b/})).toHaveAttribute("aria-current","step");await expect(page.getByRole("button",{name:/^Completion\b/})).toBeEnabled();
  await expect(page.getByRole("list",{name:"Completion tasks",exact:true})).toHaveCount(0);
});

test("Completion remains selected after legal completion when initially opened from the sale status",async({page})=>{
  const f=await legalFixture(page);f.profile.role="conveyancer";f.unit.sale_status="exchanged";f.attempt.workflow_status="exchanged";f.attempt.exchanged_at="2026-08-01";f.attempt.contractual_completion_date="2026-08-05";f.attempt.completion_legacy_stage="arrangements";
  f.documents(true);f.completionPackage.approved=true;f.completionPackage.approval={statement_version_id:"version-0",account_version_id:"version-1",approved_by_name:"Developer Approver",approved_at:new Date().toISOString()};
  await page.reload();await expect(page.getByRole("button",{name:/^Completion\b/})).toHaveAttribute("aria-current","step");
  await page.getByLabel("Actual legal completion date and time (your local time)").fill("2026-08-05T15:00");await page.getByRole("checkbox",{name:/I confirm legal completion/}).check();await page.getByRole("button",{name:"Confirm legal completion",exact:true}).click();
  await expect(page.getByText(/Handover and key release are available/)).toBeVisible();await expect(page.getByRole("button",{name:/^Completion\b/})).toHaveAttribute("aria-current","step");await expect(page.getByRole("button",{name:/^Handover\b/})).toBeEnabled();
});
