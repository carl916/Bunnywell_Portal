import { expect, test, type Locator, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

type SnagStatus = "open" | "needs_more_info" | "resolved_by_contractor" | "rejected_back_to_contractor" | "closed";

type SnagLocation = {
  type: "unit" | "communal";
  preferredUnits?: string[];
  preferredAreas: string[];
};

type SnagDraftSpec = {
  title: string;
  description?: string;
  location: SnagLocation;
  preferredTrades?: string[];
  photoIndex: number;
};

type CreatedSnag = SnagDraftSpec & {
  areaLabel: string;
  unitLabel?: string;
  tradeLabel: string;
};

const photoFixtureDir = path.join(process.cwd(), "tests", "fixtures", "snag-photos");
const photoFixtures = fs.existsSync(photoFixtureDir)
  ? fs.readdirSync(photoFixtureDir)
    .filter((file) => /\.(jpe?g|png|webp)$/i.test(file))
    .sort()
  : [];

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function missingEnv(names: string[]) {
  return names.filter((name) => !process.env[name]);
}

function desktopNavigation(page: Page) {
  return page.locator("header nav").first();
}

async function signIn(page: Page, email: string, password: string) {
  await page.context().clearCookies();
  await page.goto("/");
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
}

async function openSnags(page: Page) {
  await desktopNavigation(page).getByRole("button", { name: "Snags", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Snags", exact: true })).toBeVisible();
}

async function optionsFor(select: Locator) {
  return select.locator("option").evaluateAll((items) => items.map((item) => {
    const option = item as HTMLOptionElement;
    return {
      disabled: option.disabled,
      label: option.textContent?.trim().replace(/\s+/g, " ") ?? "",
      value: option.value,
    };
  }));
}

function normaliseOption(value: string) {
  return value.trim().toLowerCase();
}

function optionMatches(optionLabel: string, preferredLabel: string) {
  const option = normaliseOption(optionLabel);
  const preferred = normaliseOption(preferredLabel);
  return option === preferred || option.startsWith(`${preferred} /`) || option.includes(preferred);
}

async function selectPreferredOption(select: Locator, preferredLabels: string[], context: string) {
  const options = (await optionsFor(select)).filter((option) => option.value && !option.disabled);
  const preferred = preferredLabels.filter(Boolean);
  const match = options.find((option) => preferred.some((label) => optionMatches(option.label, label))) ?? options[0];

  if (!match) {
    throw new Error(`No selectable option found for ${context}.`);
  }

  await select.selectOption(match.value);
  return match.label;
}

async function maybeSelectPreferredOption(select: Locator, preferredLabels: string[]) {
  const options = (await optionsFor(select)).filter((option) => option.value && !option.disabled);
  const preferred = preferredLabels.filter(Boolean);
  const match = options.find((option) => preferred.some((label) => optionMatches(option.label, label)));

  if (!match) return "";
  await select.selectOption(match.value);
  return match.label;
}

function cleanAreaFilterLabel(label: string) {
  return label.split(" / ")[0]?.trim() ?? label;
}

function listStatusLabel(status: SnagStatus) {
  const labels: Record<SnagStatus, string> = {
    open: "Open",
    needs_more_info: "More info",
    resolved_by_contractor: "Resolved",
    rejected_back_to_contractor: "Rejected back",
    closed: "Closed",
  };
  return labels[status];
}

function detailStatusLabel(status: SnagStatus) {
  const labels: Record<SnagStatus, string> = {
    open: "Open",
    needs_more_info: "Needs more info",
    resolved_by_contractor: "Resolved by contractor",
    rejected_back_to_contractor: "Rejected back to contractor",
    closed: "Closed",
  };
  return labels[status];
}

function snagRow(page: Page, title: string) {
  return page.locator("tbody tr", { hasText: title }).first();
}

function snagDetail(page: Page, title: string) {
  return page.locator("section", { has: page.getByRole("heading", { name: title, exact: true }) }).first();
}

function photoPath(index: number) {
  if (photoFixtures.length === 0) throw new Error("No snag photo fixtures were found.");
  const file = photoFixtures[index % photoFixtures.length];
  return path.join(photoFixtureDir, file);
}

async function setPageSizeToLargestIfAvailable(page: Page) {
  const pageSize = page.getByLabel("Snags per page");
  if (await pageSize.count()) {
    await pageSize.selectOption("100");
  }
}

async function setStatusFilter(page: Page, status: SnagStatus | "") {
  const statusFilter = page.getByLabel("Status filter");
  await statusFilter.selectOption(status);
  await expect(statusFilter).toHaveValue(status);
}

async function applySnagFilters(page: Page, snag: CreatedSnag, status: SnagStatus | "") {
  await selectPreferredOption(page.getByLabel("Building filter"), ["Forum House"], "snag building filter");
  await setStatusFilter(page, status);

  const unitFilter = page.getByLabel("Unit filter");
  if (snag.location.type === "unit") {
    await selectPreferredOption(unitFilter, [snag.unitLabel ?? "", ...(snag.location.preferredUnits ?? [])], "snag unit filter");
  } else {
    const selected = await maybeSelectPreferredOption(unitFilter, [cleanAreaFilterLabel(snag.areaLabel), ...snag.location.preferredAreas]);
    if (!selected) await selectPreferredOption(unitFilter, ["All communal spaces"], "snag communal filter");
  }

  await setPageSizeToLargestIfAvailable(page);
}

async function expectSnagInList(page: Page, snag: CreatedSnag, status: SnagStatus) {
  await applySnagFilters(page, snag, status);
  const row = snagRow(page, snag.title);
  await expect(row).toBeVisible();
  await expect(row).toContainText(listStatusLabel(status));
}

async function openSnagDetail(page: Page, snag: CreatedSnag, status: SnagStatus) {
  await applySnagFilters(page, snag, status);
  const row = snagRow(page, snag.title);
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: /Details/ }).click();
  await expect(page.getByRole("heading", { name: snag.title, exact: true })).toBeVisible();
  await expect(snagDetail(page, snag.title)).toContainText(detailStatusLabel(status));
}

async function backToSnagList(page: Page) {
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByLabel("Status filter")).toBeVisible();
}

async function createDeveloperSnag(page: Page, spec: SnagDraftSpec, saveAndClose = false): Promise<CreatedSnag> {
  const form = page.locator("section.panel", { hasText: "Add developer snag" }).first();
  await expect(form).toBeVisible();

  const buildingSelect = form.locator("select").nth(0);
  await selectPreferredOption(buildingSelect, ["Forum House"], "developer snag building");

  if (spec.location.type === "communal") {
    await form.getByRole("button", { name: "Communal", exact: true }).click();
  } else {
    await form.getByRole("button", { name: "Unit", exact: true }).click();
  }

  let unitLabel = "";
  let areaLabel = "";
  let tradeLabel = "No trade";

  if (spec.location.type === "unit") {
    unitLabel = await selectPreferredOption(form.locator("select").nth(2), spec.location.preferredUnits ?? [], "developer snag unit");
    areaLabel = await selectPreferredOption(form.locator("select").nth(3), spec.location.preferredAreas, "developer snag unit area");
    if (spec.preferredTrades?.length) {
      tradeLabel = await selectPreferredOption(form.locator("select").nth(4), spec.preferredTrades, "developer snag trade");
    }
  } else {
    areaLabel = await selectPreferredOption(form.locator("select").nth(2), spec.location.preferredAreas, "developer snag communal area");
    if (spec.preferredTrades?.length) {
      tradeLabel = await selectPreferredOption(form.locator("select").nth(3), spec.preferredTrades, "developer snag trade");
    }
  }

  await form.getByPlaceholder("Title").fill(spec.title);
  if (spec.description) {
    await form.getByPlaceholder("Description").fill(spec.description);
  } else {
    await form.getByPlaceholder("Description").fill("");
  }

  await form.locator("input[type='file']").last().setInputFiles(photoPath(spec.photoIndex));
  await expect(form.getByRole("button", { name: /Annotate photo/i })).toBeVisible();

  if (saveAndClose) {
    await form.getByRole("button", { name: "Save and close" }).click();
    await expect(page.getByRole("button", { name: "Add snag", exact: true })).toBeVisible({ timeout: 30_000 });
  } else {
    await form.getByRole("button", { name: "Save and add another" }).click();
    await expect(form.getByPlaceholder("Title")).toHaveValue("", { timeout: 30_000 });
  }

  return { ...spec, areaLabel, tradeLabel, unitLabel };
}

async function quickListAction(page: Page, snag: CreatedSnag, fromStatus: SnagStatus, actionName: string, toStatus: SnagStatus) {
  await applySnagFilters(page, snag, fromStatus);
  const row = snagRow(page, snag.title);
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: actionName, exact: true }).click();
  await expect(row).toHaveCount(0, { timeout: 30_000 });
  await expectSnagInList(page, snag, toStatus);
}

test.describe.serial("developer snagging workflow", () => {
  test.setTimeout(180_000);

  test("developer representative and contractor can move snags through the full workflow", async ({ page }, testInfo) => {
    const requiredWorkflowEnv = [
      "PLAYWRIGHT_DEVELOPER_REPRESENTATIVE_EMAIL",
      "PLAYWRIGHT_DEVELOPER_REPRESENTATIVE_PASSWORD",
      "PLAYWRIGHT_CONTRACTOR_EMAIL",
      "PLAYWRIGHT_CONTRACTOR_PASSWORD",
    ];
    const missingWorkflowEnv = missingEnv(requiredWorkflowEnv);
    test.skip(missingWorkflowEnv.length > 0, `Snagging workflow credentials are not configured: ${missingWorkflowEnv.join(", ")}`);
    test.skip(photoFixtures.length === 0, "Snag photo fixtures are required for the snagging workflow test.");

    const runId = `${Date.now().toString(36).slice(-6)}-${testInfo.retry}`;
    const snagSpecs: Record<string, SnagDraftSpec> = {
      listClose: {
        title: `[E2E ${runId}] List close`,
        location: { type: "unit", preferredUnits: ["101"], preferredAreas: ["Bathroom"] },
        preferredTrades: ["Electrical"],
        photoIndex: 0,
      },
      infoLoop: {
        title: `[E2E ${runId}] Info loop`,
        description: "Please confirm the visible damage before this is progressed.",
        location: { type: "unit", preferredUnits: ["201", "101"], preferredAreas: ["Kitchen", "Living Room"] },
        photoIndex: 1,
      },
      detailReject: {
        title: `[E2E ${runId}] Reject detail`,
        description: "Communal area issue logged by the developer representative.",
        location: { type: "communal", preferredAreas: ["Bin Store", "Car Park", "Corridor"] },
        preferredTrades: ["Cleaning"],
        photoIndex: 2,
      },
      finalClose: {
        title: `[E2E ${runId}] Final close`,
        location: { type: "communal", preferredAreas: ["Car Park", "Bin Store", "Corridor"] },
        photoIndex: 3,
      },
    };

    await signIn(
      page,
      requiredEnv("PLAYWRIGHT_DEVELOPER_REPRESENTATIVE_EMAIL"),
      requiredEnv("PLAYWRIGHT_DEVELOPER_REPRESENTATIVE_PASSWORD"),
    );
    await openSnags(page);
    await page.getByRole("button", { name: "Add snag", exact: true }).click();

    const created = {
      listClose: await createDeveloperSnag(page, snagSpecs.listClose),
      infoLoop: await createDeveloperSnag(page, snagSpecs.infoLoop),
      detailReject: await createDeveloperSnag(page, snagSpecs.detailReject),
      finalClose: await createDeveloperSnag(page, snagSpecs.finalClose, true),
    };

    await expectSnagInList(page, created.listClose, "open");
    await openSnagDetail(page, created.infoLoop, "open");
    await expect(snagDetail(page, created.infoLoop.title)).toContainText(created.infoLoop.areaLabel);
    await backToSnagList(page);

    await signIn(
      page,
      requiredEnv("PLAYWRIGHT_CONTRACTOR_EMAIL"),
      requiredEnv("PLAYWRIGHT_CONTRACTOR_PASSWORD"),
    );
    await openSnags(page);
    await quickListAction(page, created.listClose, "open", "Resolve", "resolved_by_contractor");
    await quickListAction(page, created.detailReject, "open", "Resolve", "resolved_by_contractor");
    await openSnagDetail(page, created.infoLoop, "open");
    await page.getByRole("button", { name: "Request info", exact: true }).click();
    await page.getByPlaceholder("What information is needed?").fill("Please provide a wider photo showing the full location.");
    await page.getByRole("button", { name: "Send request", exact: true }).click();
    await expect(snagDetail(page, created.infoLoop.title)).toContainText(detailStatusLabel("needs_more_info"));
    await backToSnagList(page);

    await signIn(
      page,
      requiredEnv("PLAYWRIGHT_DEVELOPER_REPRESENTATIVE_EMAIL"),
      requiredEnv("PLAYWRIGHT_DEVELOPER_REPRESENTATIVE_PASSWORD"),
    );
    await openSnags(page);
    await quickListAction(page, created.listClose, "resolved_by_contractor", "Close", "closed");
    await openSnagDetail(page, created.detailReject, "resolved_by_contractor");
    await page.getByRole("button", { name: "Reject back to contractor", exact: true }).click();
    await page.getByPlaceholder("Reason for rejection").fill("The item is still visible after the reported fix.");
    await page.getByRole("button", { name: "Reject", exact: true }).click();
    await expect(snagDetail(page, created.detailReject.title)).toContainText(detailStatusLabel("rejected_back_to_contractor"));
    await backToSnagList(page);
    await openSnagDetail(page, created.infoLoop, "needs_more_info");
    await page.getByPlaceholder("Information for contractor").fill("Wider context photo supplied by the developer representative.");
    await page.getByRole("button", { name: "Send info", exact: true }).click();
    await expect(snagDetail(page, created.infoLoop.title)).toContainText(detailStatusLabel("open"));
    await backToSnagList(page);

    await signIn(
      page,
      requiredEnv("PLAYWRIGHT_CONTRACTOR_EMAIL"),
      requiredEnv("PLAYWRIGHT_CONTRACTOR_PASSWORD"),
    );
    await openSnags(page);
    await quickListAction(page, created.detailReject, "rejected_back_to_contractor", "Resolve", "resolved_by_contractor");
    await openSnagDetail(page, created.infoLoop, "open");
    await page.getByRole("button", { name: "Resolve", exact: true }).click();
    await expect(snagDetail(page, created.infoLoop.title)).toContainText(detailStatusLabel("resolved_by_contractor"));
    await backToSnagList(page);
    await quickListAction(page, created.finalClose, "open", "Resolve", "resolved_by_contractor");

    await signIn(
      page,
      requiredEnv("PLAYWRIGHT_DEVELOPER_REPRESENTATIVE_EMAIL"),
      requiredEnv("PLAYWRIGHT_DEVELOPER_REPRESENTATIVE_PASSWORD"),
    );
    await openSnags(page);
    await quickListAction(page, created.detailReject, "resolved_by_contractor", "Close", "closed");
    await openSnagDetail(page, created.infoLoop, "resolved_by_contractor");
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await expect(snagDetail(page, created.infoLoop.title)).toContainText(detailStatusLabel("closed"));
    await backToSnagList(page);
    await quickListAction(page, created.finalClose, "resolved_by_contractor", "Close", "closed");

    await expectSnagInList(page, created.listClose, "closed");
    await expectSnagInList(page, created.infoLoop, "closed");
    await expectSnagInList(page, created.detailReject, "closed");
    await expectSnagInList(page, created.finalClose, "closed");
  });
});
