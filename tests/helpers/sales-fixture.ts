import { expect, type Page } from "@playwright/test";

const buildingId = "10000000-0000-4000-8000-000000000001";
const unitId = "20000000-0000-4000-8000-000000000001";
export const userId = "30000000-0000-4000-8000-000000000001";
const attemptId = "40000000-0000-4000-8000-000000000001";
export const at = (day: number) => `2026-08-${String(day).padStart(2, "0")}T12:00:00Z`;
type Row = Record<string, unknown>;

export async function salesFixture(page: Page) {
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
    if (url.pathname.includes('/rpc/')) {
      const name = url.pathname.split('/').at(-1);
      const json = name === 'sale_workflow_context' || name === 'sale_activity_page' ? rows.unit_sale_workflow_events
        : name === 'sale_comment_page' ? { comments: [], hasBefore: false, hasAfter: false }
        : name === 'sale_comment_unread' ? {} : [];
      await route.fulfill({ json }); return;
    }
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
