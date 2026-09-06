import { expect, test, type Page } from "@playwright/test";

const buildingId = "10000000-0000-4000-8000-000000000001";
const unitId = "20000000-0000-4000-8000-000000000001";
const userId = "30000000-0000-4000-8000-000000000001";
const attemptId = "40000000-0000-4000-8000-000000000001";
const at = (day: number) => `2026-08-${String(day).padStart(2, "0")}T12:00:00Z`;
type Row = Record<string, unknown>;

async function fixture(page: Page) {
  const profile = { id: userId, email: "sales-ui@example.test", full_name: "Jane Alexandra Smith-Worthington", role: "developer", active: true, organisation_id: null };
  const unit: Row = { id: unitId, building_id: buildingId, unit_number: "101", floor: "Ground", sale_status: "for_sale", rental_portfolio_status: "not_in_portfolio", parking_bays: [] };
  const attempt: Row = { id: attemptId, building_id: buildingId, unit_id: unitId, attempt_number: 1, is_active: true, workflow_status: "draft", created_at: at(1), buyer_name: "Example Buyer", buyer_person_name: "Example Buyer", buyer_email: "buyer@example.test", buyer_phone: "07000000000", buyer_solicitor_name: "Example Solicitors", reservation_date: "2026-08-01", reservation_terms_checked: true };
  const rows: Record<string, Row[]> = {
    profiles: [profile],
    buildings: [{ id: buildingId, name: "Workflow Test House", status: "active", lifecycle_status: "active" }],
    units: [unit],
    user_building_access: [{ user_id: userId, building_id: buildingId }],
    unit_sale_attempts: [attempt],
    unit_sale_documents: [], unit_sale_document_versions: [], unit_sale_workflow_events: [],
  };
  const authUser = { id: userId, email: profile.email, aud: "authenticated", role: "authenticated", user_metadata: {}, app_metadata: { provider: "email" }, created_at: at(1) };
  const jwt = `${Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url")}.${Buffer.from(JSON.stringify({ sub: userId, exp: Math.floor(Date.now() / 1000) + 3600, role: "authenticated" })).toString("base64url")}.test-signature`;
  // All Supabase traffic is local fixture data; no live project is read or written.
  await page.route("**/auth/v1/**", async (route) => {
    const isUser = new URL(route.request().url()).pathname.endsWith("/user");
    await route.fulfill({ json: isUser ? authUser : { access_token: jwt, refresh_token: "test-refresh-token", token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: authUser } });
  });
  await page.route("**/rest/v1/**", async (route) => {
    const url = new URL(route.request().url());
    let result = rows[url.pathname.split("/").at(-1)!] ?? [];
    for (const [key, value] of url.searchParams) {
      if (value.startsWith("eq.")) result = result.filter((row) => String(row[key]) === value.slice(3));
    }
    const single = route.request().headers().accept?.includes("vnd.pgrst.object");
    await route.fulfill({ json: single ? result[0] ?? null : result });
  });
  await page.route("**/api/**", (route) => route.fulfill({ json: {} }));
  await page.goto(`/?screen=sales&building=${buildingId}&salesUnitId=${unitId}`);
  await page.getByLabel("Email", { exact: true }).fill(profile.email);
  await page.getByLabel("Password", { exact: true }).fill("fixture-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
  await page.goto(`/?screen=sales&building=${buildingId}&salesUnitId=${unitId}`);
  await expect(page.getByRole("list", { name: "Reservation tasks", exact: true })).toBeVisible();
  const event = (event_type: string, day: number, metadata = {}) => ({ id: `${event_type}-${day}`, sale_attempt_id: attemptId, event_type, created_at: at(day), created_by_user_id: userId, metadata, summary: event_type.replaceAll("_", " ") });
  const documents = () => {
    rows.unit_sale_documents = ["completion_statement", "statement_of_account"].map((document_type, index) => ({ id: `doc-${index}`, sale_attempt_id: attemptId, document_type, status: "uploaded", updated_at: at(2) }));
    rows.unit_sale_document_versions = rows.unit_sale_documents.map((doc, index) => ({ id: `version-${index}`, document_id: doc.id, version_number: 1, is_current: true, file_name: `${doc.document_type}.pdf`, file_size_bytes: 1024, uploaded_at: at(index + 1), uploaded_by_user_id: userId }));
  };
  const reloadStage = async (stage: string) => {
    await page.reload();
    const button = page.getByRole("button", { name: new RegExp(`^${stage}\\b`) });
    await expect(button).toBeVisible();
    await button.click();
    await expect(page.getByRole("list", { name: `${stage} tasks`, exact: true })).toBeVisible();
  };
  return { profile, rows, unit, attempt, event, documents, reloadStage };
}

async function expectSteps(page: Page, stage: string, labels: string[]) {
  const cards = page.getByRole("list", { name: `${stage} tasks`, exact: true }).getByRole("listitem");
  await expect(cards).toHaveCount(labels.length);
  for (const [index, label] of labels.entries()) await expect(cards.nth(index).getByText(label, { exact: true })).toBeVisible();
}

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
  await expectSteps(page, "Exchange", ["Current", "Locked"]);
  f.attempt.workflow_status = "ready_for_exchange";
  f.attempt.commercial_approved_at = at(3);
  await f.reloadStage("Exchange");
  await expectSteps(page, "Exchange", ["Complete", "Current"]);
  f.attempt.workflow_status = "exchanged";
  f.attempt.exchanged_at = "2026-08-04";
  f.unit.sale_status = "exchanged";
  await f.reloadStage("Exchange");
  await expectSteps(page, "Exchange", ["Complete", "Complete"]);
});

test("completion survives reload through upload, query, replacement, approval and recording", async ({ page }) => {
  const f = await fixture(page);
  f.unit.sale_status = "exchanged";
  f.attempt.workflow_status = "exchanged";
  f.attempt.exchanged_at = "2026-08-01";
  await f.reloadStage("Completion");
  await expectSteps(page, "Completion", ["Current", "Locked", "Locked"]);
  f.documents();
  const second = f.rows.unit_sale_document_versions.pop()!;
  await f.reloadStage("Completion");
  await expectSteps(page, "Completion", ["Current", "Locked", "Locked"]);
  f.rows.unit_sale_document_versions.push(second);
  await f.reloadStage("Completion");
  await expectSteps(page, "Completion", ["Complete", "Current", "Locked"]);
  await expect(page.getByRole("button", { name: "Approve completion documents", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Reject / query documents", exact: true })).toBeDisabled();
  await page.getByLabel("Rejection / query reason").fill("Correct the completion balance.");
  await expect(page.getByRole("button", { name: "Reject / query documents", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Mark unit Completed" })).toHaveCount(0);
  f.rows.unit_sale_documents.forEach((doc) => Object.assign(doc, { status: "query_raised", query_note: "Correct the completion balance.", updated_at: at(3) }));
  f.rows.unit_sale_workflow_events.push(f.event("completion_documents_query_raised", 3, { queryNote: "Correct the completion balance." }));
  f.profile.role = "conveyancer";
  await f.reloadStage("Completion");
  await expectSteps(page, "Completion", ["Changes required", "Awaiting resubmission", "Locked"]);
  await expect(page.getByText("Correct the completion balance.", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Upload completion statement", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve completion documents" })).toHaveCount(0);
  Object.assign(f.rows.unit_sale_documents[0], { status: "uploaded", query_note: null, updated_at: at(4) });
  f.rows.unit_sale_document_versions[0].is_current = false;
  f.rows.unit_sale_document_versions.push({ ...f.rows.unit_sale_document_versions[0], id: "replacement", is_current: true, version_number: 2, uploaded_at: at(4) });
  await f.reloadStage("Completion");
  await expectSteps(page, "Completion", ["Complete", "Current", "Locked"]);
  await expect(page.getByRole("heading", { name: "Documents resubmitted for review" })).toBeVisible();
  f.rows.unit_sale_documents.forEach((doc) => Object.assign(doc, { status: "approved", approved_at: at(5), approved_by_user_id: userId, query_note: null }));
  f.rows.unit_sale_workflow_events.push(f.event("completion_documents_approved", 5));
  f.attempt.workflow_status = "completion_pending";
  await f.reloadStage("Completion");
  await expectSteps(page, "Completion", ["Complete", "Complete", "Current"]);
  await page.getByLabel("Actual completion date", { exact: true }).fill("2026-08-06");
  await expectSteps(page, "Completion", ["Complete", "Complete", "Current"]);
  await expect(page.getByRole("button", { name: "Mark unit Completed" })).toBeEnabled();
  f.attempt.workflow_status = "completed";
  f.attempt.completed_at = "2026-08-06";
  f.unit.sale_status = "completed";
  f.rows.unit_sale_workflow_events.push(f.event("completion_recorded", 6));
  await f.reloadStage("Completion");
  await expectSteps(page, "Completion", ["Complete", "Complete", "Complete"]);
  await expect(page.getByRole("heading", { name: "Completion recorded", exact: true })).toBeVisible();
  await page.getByText("Show history", { exact: true }).click();
  await expect(page.getByText("Correct the completion balance.", { exact: true })).toBeVisible();
});

test("task cards use available width without overflow at desktop, tablet and mobile sizes", async ({ page }, testInfo) => {
  const f = await fixture(page);
  f.documents();
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
    const columns = box!.width >= 768 ? 3 : box!.width >= 480 ? 2 : 1;
    expect(Math.abs(bounds[0]!.y - bounds[1]!.y) < 2).toBe(columns > 1);
    expect(Math.abs(bounds[0]!.y - bounds[2]!.y) < 2).toBe(columns === 3);
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
