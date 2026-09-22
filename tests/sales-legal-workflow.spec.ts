import { test, expect, type Page } from "@playwright/test";
import { salesFixture, userId } from "./helpers/sales-fixture";

async function legalFixture(page: Page) {
  const f = await salesFixture(page);
  f.attempt.workflow_status = "approved"; f.unit.sale_status = "reserved";
  const snapshot = {
    sale_id: f.attempt.id, building: { id: f.unit.building_id, name: "Workflow Test House", seller_name: "Seller SPV Ltd", completion_information: "As agreed in the contract" },
    buyer: "Example Buyer", plot: "101", terms: { contract_price: 250000, reservation_fee: 2000, exchange_deposit_percent: 10, developer_contribution: 1000, agent_contribution: 0, parking_value: 0, parking_contribution_value: 0 }, schedule: [],
    conveyancer: { id: "legal-org", name: "Legal Team", type: "conveyancer", shared_system_email: "legal@example.test" as string | null },
    sales_agent: { id: "agent-org", name: "Agent Team", type: "sales_agent", shared_system_email: "sales@example.test" }, approver: { id: userId, name: "Developer Approver" },
  };
  const emails: Record<string, unknown>[] = [];
  const actions: Record<string, unknown>[] = [];
  await page.route("**/api/sales/legal**", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ json: { snapshot, emails, attempt: f.attempt, documents: f.rows.unit_sale_documents.map((document) => ({ ...document, unit_sale_document_versions: f.rows.unit_sale_document_versions.filter((version) => version.document_id === document.id) })), events: f.rows.unit_sale_workflow_events, actors: [{id:userId,full_name:"Historical Legal Actor"}] } }); return;
    }
    const body = route.request().postDataJSON(); actions.push(body);
    if (body.action === "preview") {
      await route.fulfill({ json: { ...body, snapshot, to: [snapshot.conveyancer.shared_system_email], cc: body.kind === "authority" ? [snapshot.sales_agent.shared_system_email] : [], from: "portal@example.test", subject: `${body.kind === "authority" ? "Authority to Exchange" : "Completion Arrangements"} – Workflow Test House – 101`, body: `For and on behalf of Seller SPV Ltd\nBuyer: Example Buyer\nContract price: £250,000\nValid until ${body.date}\nApproved and issued by Developer Approver`, token: "preview-token" } }); return;
    }
    if (body.action === "send") emails.unshift({ id: "authority-1", sale_attempt_id:f.attempt.id, kind: body.kind, version:1, snapshot, subject:"Authority to Exchange", body:"Saved email body", sending_address:"portal@example.test", to_recipients:[snapshot.conveyancer.shared_system_email], cc_recipients:body.kind === "authority" ? [snapshot.sales_agent.shared_system_email] : [], issued_at:new Date().toISOString(), expires_at:body.kind === "authority" ? body.date : null, proposed_completion_date:body.kind === "completion_instruction" ? body.date : null, delivery_status:"sent",resend_message_id:"resend-1" });
    if (body.action === "request_authority") f.attempt.authority_requested_at=new Date().toISOString();
    if (body.action === "revoke_authority") emails[0].revoked_at=new Date().toISOString();
    if (body.action === "confirm_exchange") { f.attempt.exchanged_at=body.date; f.attempt.workflow_status="exchanged"; f.unit.sale_status="exchanged"; emails[0].exchanged_at=body.date; }
    if (body.action === "approve_statement") { f.rows.unit_sale_documents[0].approved_version_id=body.versionId; f.rows.unit_sale_documents[0].status="approved"; }
    if (body.action === "confirm_arrangements") f.attempt.contractual_completion_date=body.date;
    if (body.action === "confirm_completion") { f.attempt.completed_at=body.dateTime.slice(0,10); f.attempt.legal_completed_at=body.dateTime; f.attempt.workflow_status="completed"; f.unit.sale_status="completed"; }
    await route.fulfill({json:{saleAttemptId:f.attempt.id}});
  });
  return {...f,snapshot,emails,actions};
}

test("developer reviews exact recipients, confirms and preserves the sent authority", async ({ page }) => {
  const f=await legalFixture(page); await f.reloadStage("Exchange");
  await expect(page.getByRole("button",{name:"Confirm exchange",exact:true})).toHaveCount(0);
  await page.getByRole("button",{name:"Review authority and email",exact:true}).click();
  const preview=page.getByRole("region",{name:"Final confirmation and email preview"});
  await expect(preview).toContainText("legal@example.test"); await expect(preview).toContainText("sales@example.test");
  await expect(preview).toContainText("Seller SPV Ltd");
  const send=preview.getByRole("button",{name:"Issue authority to exchange",exact:true}); await expect(send).toBeDisabled();
  await preview.getByRole("checkbox").check(); await send.click();
  await expect(page.getByText("Version 1 · Authority issued",{exact:false})).toBeVisible();
  expect(f.actions.filter(action=>action.action==="send")).toHaveLength(1);
  await page.getByText("Instruction and email history (1)",{exact:true}).click();
  await expect(page.getByText("To: legal@example.test · CC: sales@example.test")).toBeVisible();
  await page.getByLabel("Revocation reason").fill("Revised contract terms"); await page.getByRole("button",{name:"Revoke authority",exact:true}).click();
  await expect(page.getByText("Version 1 · Authority revoked",{exact:false})).toBeVisible();
  await page.screenshot({path:"artifacts/legal-exchange-desktop.png",fullPage:true});
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

test("completion statement approval does not release keys; conveyancer legal confirmation does",async({page})=>{
  const f=await legalFixture(page); f.unit.sale_status="exchanged"; f.attempt.workflow_status="exchanged"; f.attempt.exchanged_at="2026-08-01"; f.attempt.contractual_completion_date="2026-08-05";
  f.documents(); f.rows.unit_sale_documents=f.rows.unit_sale_documents.filter(document=>document.document_type==="completion_statement");
  await f.reloadStage("Completion");
  await page.getByRole("button",{name:"Approve version 1",exact:true}).click();
  await expect(page.getByText("Version 1 approved",{exact:false})).toBeVisible();
  await expect(page.getByRole("button",{name:/^Handover\b/})).toBeDisabled();
  f.profile.role="conveyancer"; await f.reloadStage("Completion");
  await page.getByLabel("Actual legal completion date and time (your local time)").fill("2026-08-05T15:00");
  await page.getByRole("checkbox",{name:/I confirm legal completion/}).check();
  await page.getByRole("button",{name:"Confirm legal completion",exact:true}).click();
  await page.getByRole("button",{name:/^Completion\b/}).click();
  await expect(page.getByText(/Handover and key release are available/)).toBeVisible();
  await expect(page.getByText("Choose final statement of account PDF",{exact:true})).toBeVisible();
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.screenshot({path:"artifacts/legal-completion-mobile.png",fullPage:true});
});

test("historical completion retains dates and actor names with no invented timestamp",async({page})=>{
  const f=await legalFixture(page); f.unit.sale_status="completed"; f.attempt.workflow_status="completed"; f.attempt.exchanged_at="2026-08-01"; f.attempt.completed_at="2026-08-05";
  f.rows.unit_sale_workflow_events=[f.event("completion_recorded",5)];
  await f.reloadStage("Completion");
  await expect(page.getByText(/05\/08\/2026 \(historical date; time not recorded\)/)).toBeVisible();
  await expect(page.getByText(/Completed by Historical Legal Actor/)).toBeVisible();
  await expect(page.getByRole("button",{name:"Confirm legal completion",exact:true})).toHaveCount(0);
});
