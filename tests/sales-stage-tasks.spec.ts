import { expect, test, type Page } from "@playwright/test";
import { salesFixture as fixture, userId, at } from "./helpers/sales-fixture";

async function expectSteps(page: Page, stage: string, labels: string[]) {
  const cards = page.getByRole("list", { name: `${stage} tasks`, exact: true }).getByRole("listitem");
  await expect(cards).toHaveCount(labels.length);
  for (const [index, label] of labels.entries()) await expect(cards.nth(index).getByText(label, { exact: true })).toBeVisible();
}

test("Reservation remains selected after approval and unlocks Exchange", async ({page}) => {
  const f=await fixture(page);
  f.attempt.workflow_status="awaiting_approval";f.attempt.reservation_submitted_at=at(1);f.attempt.reservation_submitted_by_user_id=userId;
  f.rows.unit_sale_documents=[{id:"reservation-doc",sale_attempt_id:f.attempt.id,document_type:"reservation_form",status:"uploaded"}];
  f.rows.unit_sale_document_versions=[{id:"reservation-version",document_id:"reservation-doc",version_number:1,is_current:true,file_name:"reservation.pdf",uploaded_at:at(1),file_size_bytes:100}];
  await page.route("**/api/sales/reservations",async route=>{
    const body=route.request().postDataJSON();expect(body.action).toBe("approve_reservation");
    f.attempt.workflow_status="approved";f.attempt.reservation_approved_at=at(2);f.attempt.reservation_approved_by_user_id=userId;f.unit.sale_status="reserved";
    await route.fulfill({json:{saleAttemptId:f.attempt.id}});
  });
  await page.reload();await page.getByRole("button",{name:"Approve reservation",exact:true}).click();
  await expect(page.getByRole("heading",{name:"Approval record",exact:true})).toBeVisible();
  await expect(page.getByRole("button",{name:/^Reservation\b/})).toHaveAttribute("aria-current","step");
  await expect(page.getByRole("button",{name:/^Exchange\b/})).toBeEnabled();
  await expect(page.getByRole("list",{name:"Exchange tasks",exact:true})).toHaveCount(0);
});

test("reservation and exchange show their saved milestones, rejection and completed history", async ({ page }) => {
  const f = await fixture(page);
  await expectSteps(page, "Reservation", ["Current", "Locked"]);
  await expect(page.locator("#sales-stage-reservation").getByRole("heading", { name: "Record reservation", exact: true })).toBeVisible();
  f.attempt.workflow_status = "awaiting_approval";
  f.attempt.reservation_submitted_at = at(1);
  f.attempt.reservation_submitted_by_user_id = userId;
  await f.reloadStage("Reservation");
  await expectSteps(page, "Reservation", ["Complete", "Current"]);
  await expect(page.getByRole("list", { name: "Reservation tasks" })).toContainText(`by ${f.profile.full_name}`);
  f.attempt.workflow_status = "rejected";
  f.attempt.reservation_rejection_reason = "Correct the buyer details.";
  f.attempt.reservation_rejected_at = at(2);
  await f.reloadStage("Reservation");
  await expectSteps(page, "Reservation", ["Changes required", "Locked"]);
  await expect(page.getByText("Correct the buyer details.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Resubmit reservation" })).toBeVisible();
  f.attempt.workflow_status = "approved";
  f.attempt.reservation_approved_at = at(3);
  f.attempt.reservation_approved_by_user_id = userId;
  f.unit.sale_status = "reserved";
  await f.reloadStage("Reservation");
  await expectSteps(page, "Reservation", ["Complete", "Complete"]);
  await expect(page.getByRole("list", { name: "Reservation tasks" }).getByText(`by ${f.profile.full_name}`, { exact: true })).toHaveCount(2);
  await expect(page.getByRole("heading", { name: "Approval record", exact: true })).toBeVisible();
  await f.reloadStage("Exchange");
  await expectSteps(page, "Exchange", ["1. Authority request", "2. Authority issued", "3. Exchange confirmed", "4. Confirm deposit received"]);
  f.attempt.workflow_status = "ready_for_exchange";
  f.attempt.commercial_approved_at = at(3);
  await f.reloadStage("Exchange");
  await expectSteps(page, "Exchange", ["1. Authority request", "2. Authority issued", "3. Exchange confirmed", "4. Confirm deposit received"]);
  f.attempt.workflow_status = "exchanged";
  f.attempt.exchanged_at = "2026-08-04";
  f.unit.sale_status = "exchanged";
  await f.reloadStage("Exchange");
  await expect(page.getByText(/Exchange predates versioned authority records/)).toBeVisible();
});

test("completion survives reload through upload, query, replacement, approval and recording", async ({ page }) => {
  const f = await fixture(page);
  f.unit.sale_status = "exchanged";
  f.attempt.workflow_status = "exchanged";
  f.attempt.exchanged_at = "2026-08-01";
  await f.reloadStage("Completion");
  await expectSteps(page, "Completion", ["1. Request authority to serve notice", "2. Authority to serve notice", "3. Notice issued and completion due date", "4. Completion documents", "5. Developer approval", "6. Legal completion"]);
  f.documents(true);
  f.attempt.completion_legacy_stage="arrangements";
  const second = f.rows.unit_sale_document_versions.pop()!;
  await f.reloadStage("Completion");
  await expectSteps(page, "Completion", ["1. Request authority to serve notice", "2. Authority to serve notice", "3. Notice issued and completion due date", "4. Completion documents", "5. Developer approval", "6. Legal completion"]);
  f.rows.unit_sale_document_versions.push(second);
  await f.reloadStage("Completion");
  await expectSteps(page, "Completion", ["1. Request authority to serve notice", "2. Authority to serve notice", "3. Notice issued and completion due date", "4. Completion documents", "5. Developer approval", "6. Legal completion"]);
  await expect(page.getByRole("button", { name: "Approve completion documents", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Raise a query", exact: true })).toBeDisabled();
  await page.getByRole("checkbox",{name:"Draft completion statement",exact:true}).check();
  await page.getByLabel("Query or rejection reason").fill("Correct the completion balance.");
  await expect(page.getByRole("button", { name: "Raise a query", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Confirm legal completion" })).toHaveCount(0);
  f.rows.unit_sale_documents.forEach((doc) => Object.assign(doc, { status: "query_raised", query_note: "Correct the completion balance.", updated_at: at(3) }));
  f.rows.unit_sale_workflow_events.push(f.event("completion_documents_query_raised", 3, { queryNote: "Correct the completion balance." }));
  f.profile.role = "conveyancer";
  await f.reloadStage("Completion");
  await expectSteps(page, "Completion", ["1. Request authority to serve notice", "2. Authority to serve notice", "3. Notice issued and completion due date", "4. Completion documents", "5. Developer approval", "6. Legal completion"]);
  await expect(page.getByText("Query raised: Correct the completion balance.", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Replace", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve completion documents" })).toHaveCount(0);
  Object.assign(f.rows.unit_sale_documents[0], { status: "uploaded", query_note: null, updated_at: at(4) });
  f.rows.unit_sale_document_versions[0].is_current = false;
  f.rows.unit_sale_document_versions.push({ ...f.rows.unit_sale_document_versions[0], id: "replacement", is_current: true, version_number: 2, uploaded_at: at(4) });
  await f.reloadStage("Completion");
  await expectSteps(page, "Completion", ["1. Request authority to serve notice", "2. Authority to serve notice", "3. Notice issued and completion due date", "4. Completion documents", "5. Developer approval", "6. Legal completion"]);
  await expect(page.getByRole("button", { name: "Confirm legal completion", exact: true })).toHaveCount(0);
  f.rows.unit_sale_documents.forEach((doc) => Object.assign(doc, { status: "approved", approved_at: at(5), approved_by_user_id: userId, query_note: null }));
  f.rows.unit_sale_workflow_events.push(f.event("completion_documents_approved", 5));
  f.rows.unit_sale_documents[0].approved_version_id = "replacement";
  f.attempt.contractual_completion_date = "2026-08-06";
  f.attempt.workflow_status = "completion_pending";
  f.completionPackage.approved=true;f.completionPackage.approval={statement_version_id:"replacement",account_version_id:"version-1",approved_by_name:"Abbie Smith",approved_at:at(5)};
  await f.reloadStage("Completion");
  await expectSteps(page, "Completion", ["1. Request authority to serve notice", "2. Authority to serve notice", "3. Notice issued and completion due date", "4. Completion documents", "5. Developer approval", "6. Legal completion"]);
  await page.getByLabel("Actual legal completion date and time (your local time)").fill("2026-08-06T12:00");
  await page.getByRole("checkbox", { name: /I confirm legal completion/ }).check();
  await expectSteps(page, "Completion", ["1. Request authority to serve notice", "2. Authority to serve notice", "3. Notice issued and completion due date", "4. Completion documents", "5. Developer approval", "6. Legal completion"]);
  await expect(page.getByRole("button", { name: "Confirm legal completion" })).toBeEnabled();
  f.attempt.workflow_status = "completed";
  f.attempt.completed_at = "2026-08-06";
  f.unit.sale_status = "completed";
  f.rows.unit_sale_workflow_events.push(f.event("completion_recorded", 6));
  await f.reloadStage("Completion");
  await expectSteps(page, "Completion", ["1. Request authority to serve notice", "2. Authority to serve notice", "3. Notice issued and completion due date", "4. Completion documents", "5. Developer approval", "6. Legal completion"]);
  await expect(page.getByText(/Handover and key release are available/)).toBeVisible();
  await page.getByRole("button", { name: /^Comments/ }).first().click();
  await page.locator('#sale-conversation').getByRole("tab", { name: "Activity", exact: true }).click();
  await expect(page.getByText("Reason: Correct the completion balance.", { exact: true })).toBeVisible();
});

test("task cards use available width without overflow at desktop, tablet and mobile sizes", async ({ page }, testInfo) => {
  const f = await fixture(page);
  f.documents(true);
  f.attempt.workflow_status = "completed";
  f.attempt.exchanged_at = "2026-08-01";
  f.attempt.completed_at = "2026-08-06";
  f.unit.sale_status = "completed";
  f.rows.unit_sale_documents.forEach((doc) => Object.assign(doc, { status: "approved", approved_at: at(5), approved_by_user_id: userId }));
  f.rows.unit_sale_workflow_events.push(f.event("completion_recorded", 6));
  await f.reloadStage("Completion");
  for (const width of [1440, 1100, 768, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    const list = page.getByRole("list", { name: "Completion tasks", exact: true });
    await list.scrollIntoViewIfNeeded();
    const box = await list.boundingBox();
    const cards = await list.getByRole("listitem").all();
    const bounds = await Promise.all(cards.map((card) => card.boundingBox()));
    expect(box!.width).toBeGreaterThan(200);
    expect(bounds[1]!.y).toBeGreaterThan(bounds[0]!.y);
    expect(bounds[2]!.y).toBeGreaterThan(bounds[1]!.y);
    for (const card of cards) expect(await card.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    expect(await page.locator("#sales-stage-completion").evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    const overflow = await page.evaluate(() => [...document.querySelectorAll("body *")].filter((element) => {
      const bounds = element.getBoundingClientRect();
      return bounds.width > 0 && bounds.right > window.innerWidth + 1 && getComputedStyle(element).position !== "fixed";
    }).slice(-12).map((element) => ({ tag: element.tagName, class: element.className, text: element.textContent?.slice(0, 70), width: element.getBoundingClientRect().width })));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), JSON.stringify(overflow)).toBe(true);
    await page.locator("#sales-stage-completion").screenshot({ path: testInfo.outputPath(`completion-${width}.png`) });
  }
});
