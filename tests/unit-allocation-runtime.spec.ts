import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function desktopNavigation(page: Page) {
  return page.locator("header nav").first();
}

async function signIn(page: Page) {
  await page.context().clearCookies();
  await page.goto("/");
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();
  await page.getByLabel("Email").fill(requiredEnv("PLAYWRIGHT_ADMIN_EMAIL"));
  await page.getByLabel("Password").fill(requiredEnv("PLAYWRIGHT_ADMIN_PASSWORD"));
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
}

async function adminAccessToken(request: APIRequestContext) {
  const response = await request.post(`${requiredEnv("NEXT_PUBLIC_SUPABASE_URL")}/auth/v1/token?grant_type=password`, {
    headers: { apikey: requiredEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY") },
    data: {
      email: requiredEnv("PLAYWRIGHT_ADMIN_EMAIL"),
      password: requiredEnv("PLAYWRIGHT_ADMIN_PASSWORD"),
    },
  });
  expect(response.ok()).toBe(true);
  const payload = await response.json() as { access_token?: string; user?: { id?: string } };
  if (!payload.access_token || !payload.user?.id) throw new Error("Admin access token was not returned.");
  return { token: payload.access_token, userId: payload.user.id };
}

async function allocationMutation(
  request: APIRequestContext,
  token: string,
  input: { action: "set_sales_availability" | "set_rental_portfolio"; unitId: string; target: string },
) {
  return request.post("/api/units/allocation", {
    headers: { Authorization: `Bearer ${token}` },
    data: { action: input.action, unitIds: [input.unitId], target: input.target },
  });
}

async function selectTestUnit(page: Page, unitNumber: string) {
  const checkbox = page.getByLabel(`Select unit ${unitNumber}`);
  await expect(checkbox).toBeVisible();
  await checkbox.check();
}

async function applyToolbarAction(page: Page, actionName: string) {
  await page.getByRole("button", { name: actionName, exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Confirm allocation change" })).toBeVisible();
  await page.getByRole("button", { name: "Confirm change", exact: true }).click();
  await expect(page.getByText("0 units selected", { exact: true })).toBeVisible();
}

async function openUnitAllocation(page: Page, unitNumber: string) {
  await desktopNavigation(page).getByRole("button", { name: "Setup", exact: true }).click();
  await page.getByRole("button", { name: "Unit allocation", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Unit allocation", exact: true })).toBeVisible();
  await page.getByLabel("Unit number").fill(unitNumber);
  await expect(page.getByLabel(`Select unit ${unitNumber}`)).toBeVisible();
}

test("new-unit setup baseline remains allocatable until meaningful sales work starts", async ({ page, request }) => {
  const serviceClient: SupabaseClient = createClient(
    requiredEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const unitPrefix = `E2E-${Date.now().toString(36).toUpperCase()}`;
  const unitNumber = `${unitPrefix}-A`;
  const companionUnitNumber = `${unitPrefix}-B`;
  const unitPrice = 352_200;
  let createdUnitId: string | null = null;
  let companionUnitId: string | null = null;

  await signIn(page);
  const { token, userId } = await adminAccessToken(request);

  try {
    await desktopNavigation(page).getByRole("button", { name: "Setup", exact: true }).click();
    const structure = page.getByTestId("building-structure-section");
    await expect(structure).toBeVisible();

    for (const expandButton of await structure.getByRole("button", { name: /^Expand / }).all()) {
      await expandButton.click();
      if (await structure.getByPlaceholder(/^Add unit to /).count()) break;
    }

    const addUnitNumber = structure.getByPlaceholder(/^Add unit to /).first();
    test.skip(await addUnitNumber.count() === 0, "A configured floor is required for the normal Add unit flow.");
    const addUnitPanel = addUnitNumber.locator("xpath=parent::div");
    const unitType = addUnitPanel.locator("select");
    test.skip(await unitType.locator("option").count() < 2, "A unit type is required for the normal Add unit flow.");

    await addUnitNumber.fill(unitNumber);
    await addUnitPanel.getByPlaceholder("Size sqm").fill("72.5");
    await addUnitPanel.getByLabel("Unit price").fill(String(unitPrice));
    await unitType.selectOption({ index: 1 });
    await addUnitPanel.getByRole("button", { name: "Add unit", exact: true }).click();

    await expect.poll(async () => {
      const { data, error } = await serviceClient
        .from("units")
        .select("id")
        .eq("unit_number", unitNumber)
        .maybeSingle();
      if (error) throw error;
      createdUnitId = data?.id ?? null;
      return createdUnitId;
    }, { timeout: 20_000 }).not.toBeNull();

    if (!createdUnitId) throw new Error("The new unit was not persisted.");
    const unitId: string = createdUnitId;
    await expect.poll(async () => {
      const { data, error } = await serviceClient
        .from("unit_sale_terms")
        .select("id,unit_sale_attempts!inner(unit_id)")
        .eq("unit_sale_attempts.unit_id", unitId);
      if (error) throw error;
      return data?.length ?? 0;
    }, { timeout: 20_000 }).toBeGreaterThan(0);

    const [unitResult, attemptResult] = await Promise.all([
      serviceClient.from("units").select("*").eq("id", unitId).single(),
      serviceClient.from("unit_sale_attempts").select("*").eq("unit_id", unitId).eq("is_active", true).single(),
    ]);
    if (unitResult.error) throw unitResult.error;
    if (attemptResult.error) throw attemptResult.error;
    const attempt = attemptResult.data;

    const [termsResult, scheduleResult, documentsResult, invoicesResult, paymentsResult, notesResult, eventsResult, auditsResult, workflowResult] = await Promise.all([
      serviceClient.from("unit_sale_terms").select("*").eq("sale_attempt_id", attempt.id).order("version_number"),
      serviceClient.from("unit_sale_payment_schedule").select("*").eq("sale_attempt_id", attempt.id).order("sequence_no"),
      serviceClient.from("unit_sale_documents").select("*").eq("sale_attempt_id", attempt.id),
      serviceClient.from("unit_sale_invoices").select("*").eq("sale_attempt_id", attempt.id),
      serviceClient.from("unit_sale_invoice_payments").select("*").eq("sale_attempt_id", attempt.id),
      serviceClient.from("unit_sale_notes").select("*").eq("sale_attempt_id", attempt.id),
      serviceClient.from("unit_sale_workflow_events").select("*").eq("sale_attempt_id", attempt.id),
      serviceClient.from("audit_events").select("*").eq("entity_id", unitId),
      serviceClient.rpc("get_unit_allocation_sale_workflows", { p_actor_user_id: userId }),
    ]);
    for (const result of [termsResult, scheduleResult, documentsResult, invoicesResult, paymentsResult, notesResult, eventsResult, auditsResult, workflowResult]) {
      if (result.error) throw result.error;
    }

    expect(unitResult.data.sale_status).toBe("not_released");
    expect(unitResult.data.rental_portfolio_status).toBe("not_in_portfolio");
    expect(attempt.workflow_status).toBe("draft");
    expect(attempt.is_active).toBe(true);
    expect(attempt.is_system_baseline).toBe(true);
    expect(attempt.created_by_user_id).toBe(userId);
    expect(attempt.updated_by_user_id).toBe(userId);
    expect(termsResult.data).toHaveLength(1);
    expect(termsResult.data?.[0]).toMatchObject({
      status: "draft",
      is_current: true,
      list_price_at_offer: unitPrice,
      contract_price: unitPrice,
      developer_contribution: 0,
      agent_contribution: 0,
      other_concessions: 0,
      created_by_user_id: userId,
      updated_by_user_id: userId,
    });
    expect(scheduleResult.data?.length).toBeGreaterThan(0);
    expect(scheduleResult.data?.every((row: { status: string; created_by_user_id: string | null; updated_by_user_id: string | null }) => row.status === "pending" && row.created_by_user_id === userId && row.updated_by_user_id === userId)).toBe(true);
    expect(documentsResult.data).toEqual([]);
    expect(invoicesResult.data).toEqual([]);
    expect(paymentsResult.data).toEqual([]);
    expect(notesResult.data).toEqual([]);
    expect(eventsResult.data).toEqual([]);
    expect(auditsResult.data).toEqual([]);
    expect(workflowResult.data?.find((row: { unit_id: string }) => row.unit_id === unitId)).toMatchObject({
      workflow_status: "draft",
      is_active: true,
      blocks_allocation: false,
    });

    console.log("UNIT_ALLOCATION_RUNTIME_TRACE", JSON.stringify({
      unit: {
        id: unitResult.data.id,
        unit_number: unitResult.data.unit_number,
        sale_status: unitResult.data.sale_status,
        rental_portfolio_status: unitResult.data.rental_portfolio_status,
      },
      attempt: {
        id: attempt.id,
        workflow_status: attempt.workflow_status,
        is_active: attempt.is_active,
        is_system_baseline: attempt.is_system_baseline,
        created_by_user_id: attempt.created_by_user_id,
        updated_by_user_id: attempt.updated_by_user_id,
      },
      terms: termsResult.data?.map((term: Record<string, unknown>) => ({
        status: term.status,
        is_current: term.is_current,
        list_price_at_offer: term.list_price_at_offer,
        contract_price: term.contract_price,
        parking_value: term.parking_value,
        reservation_fee: term.reservation_fee,
        reservation_fee_holder: term.reservation_fee_holder,
        agent_fee_percent: term.agent_fee_percent,
        exchange_agent_fee_percent: term.exchange_agent_fee_percent,
        completion_agent_fee_percent: term.completion_agent_fee_percent,
        vat_rate: term.vat_rate,
        solicitor_fee: term.solicitor_fee,
        exchange_deposit_percent: term.exchange_deposit_percent,
        second_deposit_enabled: term.second_deposit_enabled,
        completion_balance_percent: term.completion_balance_percent,
        deposit_summary: term.deposit_summary,
        developer_contribution: term.developer_contribution,
        agent_contribution: term.agent_contribution,
        parking_contribution_value: term.parking_contribution_value,
        other_concessions: term.other_concessions,
        created_by_user_id: term.created_by_user_id,
        updated_by_user_id: term.updated_by_user_id,
      })),
      payment_schedule: scheduleResult.data?.map((row: Record<string, unknown>) => ({
        sequence_no: row.sequence_no,
        payment_stage: row.payment_stage,
        label: row.label,
        due_event: row.due_event,
        percent_of_contract_price: row.percent_of_contract_price,
        expected_amount: row.expected_amount,
        status: row.status,
        created_by_user_id: row.created_by_user_id,
        updated_by_user_id: row.updated_by_user_id,
      })),
      related_counts: {
        documents: documentsResult.data?.length ?? 0,
        invoices: invoicesResult.data?.length ?? 0,
        invoice_payments: paymentsResult.data?.length ?? 0,
        notes: notesResult.data?.length ?? 0,
        workflow_events: eventsResult.data?.length ?? 0,
        audit_events: auditsResult.data?.length ?? 0,
      },
    }));

    const { data: companionUnit, error: companionError } = await serviceClient.from("units").insert({
      building_id: unitResult.data.building_id,
      unit_number: companionUnitNumber,
      floor: unitResult.data.floor,
      unit_type_id: unitResult.data.unit_type_id,
      unit_type: unitResult.data.unit_type,
      size_sqm: unitResult.data.size_sqm,
      parking_bays: [],
      sale_status: "for_sale",
      rental_portfolio_status: "active",
    }).select("id").single();
    if (companionError) throw companionError;
    companionUnitId = companionUnit.id;

    await openUnitAllocation(page, unitNumber);
    const unitRow = page.getByLabel(`Select unit ${unitNumber}`).locator("xpath=ancestor::tr[1]");
    await expect(unitRow.getByText("Not released", { exact: true }).first()).toBeVisible();
    await expect(unitRow.getByText("Not started", { exact: true })).toBeVisible();

    const rowAvailabilityMenu = unitRow.getByRole("button", { name: `Sales availability for unit ${unitNumber}` });
    await rowAvailabilityMenu.click();
    await expect(unitRow.getByRole("menu")).toBeVisible();
    await page.getByRole("heading", { name: "Unit allocation", exact: true }).click();
    await expect(unitRow.getByRole("menu")).toBeHidden();

    await rowAvailabilityMenu.click();
    await unitRow.getByRole("menuitem", { name: "Retained / not for sale", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Confirm allocation change" })).toBeVisible();
    await expect(unitRow.getByRole("menu")).toBeHidden();
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(unitRow.getByRole("menu")).toBeHidden();

    await selectTestUnit(page, unitNumber);
    await expect(page.getByRole("button", { name: "Not released", exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Not released", exact: true })).toHaveAttribute("title", "Already not released.");
    await expect(page.getByRole("button", { name: "Retained / not for sale", exact: true })).toBeEnabled();
    await expect(page.getByRole("button", { name: "For sale", exact: true })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Add to rental", exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Remove from rental", exact: true })).toBeDisabled();
    await applyToolbarAction(page, "For sale");
    await expect.poll(async () => (await serviceClient.from("units").select("sale_status").eq("id", unitId).single()).data?.sale_status).toBe("for_sale");

    await selectTestUnit(page, unitNumber);
    await applyToolbarAction(page, "Retained / not for sale");
    await expect.poll(async () => (await serviceClient.from("units").select("sale_status").eq("id", unitId).single()).data?.sale_status).toBe("not_for_sale");

    await selectTestUnit(page, unitNumber);
    await applyToolbarAction(page, "For sale");
    await selectTestUnit(page, unitNumber);
    await expect(page.getByRole("button", { name: "Add to rental", exact: true })).toBeEnabled();
    await applyToolbarAction(page, "Add to rental");
    await expect.poll(async () => (await serviceClient.from("units").select("sale_status,rental_portfolio_status").eq("id", unitId).single()).data).toMatchObject({
      sale_status: "for_sale",
      rental_portfolio_status: "active",
    });

    await selectTestUnit(page, unitNumber);
    await expect(page.getByRole("button", { name: "Add to rental", exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Remove from rental", exact: true })).toBeEnabled();
    await applyToolbarAction(page, "Remove from rental");
    await expect.poll(async () => (await serviceClient.from("units").select("sale_status,rental_portfolio_status").eq("id", unitId).single()).data).toMatchObject({
      sale_status: "for_sale",
      rental_portfolio_status: "exited",
    });

    await page.getByLabel("Unit number").fill(unitPrefix);
    await expect(page.getByLabel(`Select unit ${companionUnitNumber}`)).toBeVisible();
    await page.getByLabel(`Select unit ${unitNumber}`).check();
    await page.getByLabel(`Select unit ${companionUnitNumber}`).check();
    await expect(page.getByRole("button", { name: "For sale", exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: "For sale", exact: true })).toHaveAttribute("title", "Already for sale.");
    await expect(page.getByRole("button", { name: "Add to rental", exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Add to rental", exact: true })).toHaveAttribute("title", "Selection includes units already in the rental portfolio.");
    await expect(page.getByRole("button", { name: "Remove from rental", exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Remove from rental", exact: true })).toHaveAttribute("title", "Selection includes units not in the rental portfolio.");
    await page.getByLabel(`Select unit ${companionUnitNumber}`).uncheck();
    await page.getByLabel("Unit number").fill(unitNumber);

    const commercialResponse = await request.post("/api/sales/reservations", {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        action: "save_commercial_model",
        unitId,
        saleAttemptId: attempt.id,
        listPriceAtOffer: unitPrice,
        contractPrice: unitPrice,
      },
    });
    expect(commercialResponse.ok(), await commercialResponse.text()).toBe(true);

    const progressedAttempt = await serviceClient.from("unit_sale_attempts").select("is_system_baseline").eq("id", attempt.id).single();
    if (progressedAttempt.error) throw progressedAttempt.error;
    expect(progressedAttempt.data.is_system_baseline).toBe(false);
    const progressedEvents = await serviceClient.from("unit_sale_workflow_events").select("event_type").eq("sale_attempt_id", attempt.id);
    if (progressedEvents.error) throw progressedEvents.error;
    expect(progressedEvents.data).toContainEqual({ event_type: "commercial_model_saved" });

    await openUnitAllocation(page, unitNumber);
    await selectTestUnit(page, unitNumber);
    await expect(page.getByRole("button", { name: "Not released", exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Not released", exact: true })).toHaveAttribute("title", "Sales workflow in progress.");
    await expect(unitRow.getByText("Sale preparation", { exact: true })).toBeVisible();

    const blockedWithdrawal = await allocationMutation(request, token, {
      action: "set_sales_availability",
      unitId,
      target: "not_for_sale",
    });
    expect(blockedWithdrawal.status()).toBe(400);
    await expect(blockedWithdrawal.json()).resolves.toMatchObject({ error: expect.stringContaining("sales workflow in progress") });

    const directHeaders = { apikey: requiredEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"), Authorization: `Bearer ${token}` };
    const directSaleTamper = await request.patch(`${requiredEnv("NEXT_PUBLIC_SUPABASE_URL")}/rest/v1/units?id=eq.${unitId}`, {
      headers: directHeaders,
      data: { sale_status: "not_for_sale" },
    });
    const directRentalTamper = await request.patch(`${requiredEnv("NEXT_PUBLIC_SUPABASE_URL")}/rest/v1/units?id=eq.${unitId}`, {
      headers: directHeaders,
      data: { rental_portfolio_status: "active" },
    });
    expect(directSaleTamper.status()).toBeGreaterThanOrEqual(400);
    expect(directRentalTamper.status()).toBeGreaterThanOrEqual(400);
  } finally {
    if (companionUnitId) {
      await serviceClient.from("audit_events").delete().eq("entity_id", companionUnitId);
      const { error } = await serviceClient.from("units").delete().eq("id", companionUnitId);
      if (error) throw error;
    }
    if (createdUnitId) {
      await serviceClient.from("audit_events").delete().eq("entity_id", createdUnitId);
      const { error } = await serviceClient.from("units").delete().eq("id", createdUnitId);
      if (error) throw error;
    }
  }
});
