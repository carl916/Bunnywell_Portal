import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config({ path: ".env.local", quiet: true });

const BUILDING_NAME = "Forum House";
const BUILDING_ID = "e120ef73-a720-4a25-ab99-362f21612118";
const EXPECTED_UNIT_COUNT = 63;
const MIN_RATE = 6000;
const MAX_RATE = 7000;
const ROUND_TO = 500;
const DEFAULT_SEED = "forum-house-unit-prices-2026-07-23";

const mode = process.argv.includes("--apply") ? "apply" : "dry-run";
const seedArg = process.argv.find((arg) => arg.startsWith("--seed="));
const seed = seedArg ? seedArg.slice("--seed=".length) : DEFAULT_SEED;

const url = requiredEnv("NEXT_PUBLIC_SUPABASE_URL");
const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
const supabase = createClient(url, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function hashSeed(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(initialState) {
  let state = initialState >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function roundToNearest(value, nearest) {
  return Math.round(value / nearest) * nearest;
}

function money(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "-";
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 }).format(Number(value));
}

function number(value) {
  return Number(value).toLocaleString("en-GB", { maximumFractionDigits: 2 });
}

function average(values) {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

async function selectAll(query, label) {
  const { data, error } = await query;
  if (error) throw new Error(`${label}: ${error.message}`);
  return data ?? [];
}

async function main() {
  console.log(`Forum House unit price one-off (${mode})`);
  console.log(`Seed: ${seed}`);

  const buildings = await selectAll(
    supabase
      .from("buildings")
      .select("id,name,address_line_1,postcode")
      .eq("id", BUILDING_ID),
    "Could not identify Forum House",
  );

  if (buildings.length !== 1 || buildings[0].name !== BUILDING_NAME) {
    throw new Error(`Expected stable Forum House building ${BUILDING_ID}, found ${buildings.length === 1 ? buildings[0].name : buildings.length}. No changes made.`);
  }

  const building = buildings[0];
  console.log(`Building: ${building.name} (${building.id})`);
  console.log(`Address signal: ${[building.address_line_1, building.postcode].filter(Boolean).join(", ") || "-"}`);

  const units = await selectAll(
    supabase
      .from("units")
      .select("id,building_id,unit_number,floor,size_sqm,sale_status,completion_date,handover_date")
      .eq("building_id", building.id)
      .order("unit_number", { ascending: true }),
    "Could not load Forum House units",
  );

  if (units.length !== EXPECTED_UNIT_COUNT) {
    throw new Error(`Expected ${EXPECTED_UNIT_COUNT} Forum House units, found ${units.length}. No changes made.`);
  }

  const invalidUnits = units.filter((unit) => !Number.isFinite(Number(unit.size_sqm)) || Number(unit.size_sqm) <= 0);
  if (invalidUnits.length > 0) {
    throw new Error(`Units with missing, zero or invalid size: ${invalidUnits.map((unit) => unit.unit_number).join(", ")}. No changes made.`);
  }

  const unitIds = units.map((unit) => unit.id);
  const attempts = await selectAll(
    supabase
      .from("unit_sale_attempts")
      .select("id,building_id,unit_id,is_active,workflow_status,attempt_number,stage_entered_at,reservation_submitted_at,reservation_approved_at,commercial_approved_at,exchanged_at,completed_at")
      .eq("building_id", building.id)
      .eq("is_active", true)
      .in("unit_id", unitIds),
    "Could not load active sale attempts",
  );

  const attemptsByUnit = new Map(attempts.map((attempt) => [attempt.unit_id, attempt]));
  const missingAttemptUnits = units.filter((unit) => !attemptsByUnit.has(unit.id));

  const terms = await selectAll(
    supabase
      .from("unit_sale_terms")
      .select("id,sale_attempt_id,is_current,status,list_price_at_offer,contract_price,parking_value,developer_contribution,agent_contribution,reservation_fee,agent_fee_percent,vat_rate,solicitor_fee,created_at,updated_at")
      .eq("is_current", true)
      .in("sale_attempt_id", attempts.length > 0 ? attempts.map((attempt) => attempt.id) : ["00000000-0000-0000-0000-000000000000"]),
    "Could not load current unit sale terms",
  );

  const termsByAttempt = new Map(terms.map((term) => [term.sale_attempt_id, term]));
  const missingTermUnits = units.filter((unit) => !termsByAttempt.has(attemptsByUnit.get(unit.id)?.id));

  const rand = mulberry32(hashSeed(seed));
  const rows = units.map((unit) => {
    const rate = Math.round(MIN_RATE + rand() * (MAX_RATE - MIN_RATE));
    const size = Number(unit.size_sqm);
    const calculatedPrice = size * rate;
    const roundedPrice = roundToNearest(calculatedPrice, ROUND_TO);
    const attempt = attemptsByUnit.get(unit.id);
    const term = attempt ? termsByAttempt.get(attempt.id) : undefined;
    return {
      unit,
      attempt,
      term,
      rate,
      size,
      calculatedPrice,
      roundedPrice,
      existingPrice: term?.list_price_at_offer ?? term?.contract_price ?? null,
      storageStatus: !attempt ? "missing active attempt" : !term ? "missing current terms" : "ready",
      recordAction: !attempt ? "blocked - initialise attempt" : !term ? "blocked - initialise terms" : term.list_price_at_offer === null && term.contract_price === null ? "insert price" : "update price",
    };
  });

  const outOfRangeRows = rows.filter((row) => row.rate < MIN_RATE || row.rate > MAX_RATE);
  if (outOfRangeRows.length > 0) throw new Error("Generated rate outside allowed range. No changes made.");

  console.table(rows.map((row) => ({
    Unit: row.unit.unit_number,
    "Size m2": row.size,
    "Generated GBP/m2": row.rate,
    "Unrounded calculated price": Math.round(row.calculatedPrice),
    "Rounded unit price": row.roundedPrice,
    "Active sale-attempt ID": row.attempt?.id ?? "-",
    "Attempt status": row.attempt?.workflow_status ?? "-",
    "Current sale-terms ID": row.term?.id ?? "-",
    "Terms status": row.term?.status ?? "-",
    "Target database field": "unit_sale_terms.list_price_at_offer",
    "Records will be created": row.storageStatus === "ready" ? "no" : "run initialisation first",
    "Price action": row.recordAction,
  })));

  const proposedPrices = rows.map((row) => row.roundedPrice);
  const rates = rows.map((row) => row.rate);
  console.log("Summary");
  console.log(`Number of units: ${rows.length}`);
  console.log(`Lowest proposed unit price: ${money(Math.min(...proposedPrices))}`);
  console.log(`Highest proposed unit price: ${money(Math.max(...proposedPrices))}`);
  console.log(`Average proposed unit price: ${money(Math.round(average(proposedPrices)))}`);
  console.log(`Lowest generated price per m2: ${money(Math.min(...rates))}`);
  console.log(`Highest generated price per m2: ${money(Math.max(...rates))}`);
  console.log(`Average generated price per m2: ${money(Math.round(average(rates)))}`);
  console.log(`Active sale attempts found: ${attempts.length}`);
  console.log(`Sale attempts to create: ${missingAttemptUnits.length}`);
  console.log(`Current sale terms found: ${terms.length}`);
  console.log(`Current terms to create: ${missingTermUnits.length}`);
  console.log(`Prices to update: ${rows.filter((row) => row.recordAction === "update price").length}`);
  console.log(`Prices to insert: ${rows.filter((row) => row.recordAction === "insert price").length}`);
  if (missingAttemptUnits.length > 0) {
    console.log(`Missing active sale attempts: ${missingAttemptUnits.map((unit) => unit.unit_number).join(", ")}`);
  }
  if (missingTermUnits.length > 0) {
    console.log(`Missing current sale terms: ${missingTermUnits.map((unit) => unit.unit_number).join(", ")}`);
  }

  if (mode !== "apply") {
    console.log("Dry run complete. No changes made.");
    return;
  }

  if (missingAttemptUnits.length > 0) {
    throw new Error(`Apply blocked: missing active sale attempts for units ${missingAttemptUnits.map((unit) => unit.unit_number).join(", ")}. No changes made.`);
  }
  if (missingTermUnits.length > 0) {
    throw new Error(`Apply blocked: missing current sale terms for units ${missingTermUnits.map((unit) => unit.unit_number).join(", ")}. No changes made.`);
  }

  const termsBeforeById = new Map(rows.map((row) => [row.term.id, row.term]));
  const updates = rows.map((row) => ({
    id: row.term.id,
    sale_attempt_id: row.term.sale_attempt_id,
    list_price_at_offer: row.roundedPrice,
    contract_price: row.roundedPrice,
  }));

  const { error: updateError } = await supabase
    .from("unit_sale_terms")
    .upsert(updates, { onConflict: "id" });
  if (updateError) throw new Error(`Transactional bulk price update failed: ${updateError.message}`);

  const updatedTerms = await selectAll(
    supabase
      .from("unit_sale_terms")
      .select("id,sale_attempt_id,is_current,list_price_at_offer,contract_price")
      .eq("is_current", true)
      .in("id", updates.map((row) => row.id)),
    "Could not verify updated terms",
  );

  const updatedById = new Map(updatedTerms.map((term) => [term.id, term]));
  const updatedCount = rows.filter((row) => {
    const updated = updatedById.get(row.term.id);
    const before = termsBeforeById.get(row.term.id);
    return updated
      && Number(updated.list_price_at_offer) === row.roundedPrice
      && Number(updated.contract_price) === row.roundedPrice
      && (before.list_price_at_offer !== updated.list_price_at_offer || before.contract_price !== updated.contract_price);
  }).length;

  const notDivisible = rows.filter((row) => row.roundedPrice % ROUND_TO !== 0);
  if (updatedTerms.length !== EXPECTED_UNIT_COUNT) throw new Error(`Verification failed: expected ${EXPECTED_UNIT_COUNT} updated terms, found ${updatedTerms.length}.`);
  if (notDivisible.length > 0) throw new Error(`Verification failed: prices not divisible by ${ROUND_TO}: ${notDivisible.map((row) => row.unit.unit_number).join(", ")}.`);

  const otherBuildingTerms = await selectAll(
    supabase
      .from("unit_sale_attempts")
      .select("id,building_id")
      .neq("building_id", building.id)
      .in("id", attempts.map((attempt) => attempt.id)),
    "Could not verify building scope",
  );
  if (otherBuildingTerms.length > 0) throw new Error("Verification failed: update attempt set included another building.");

  console.log("Apply complete.");
  console.log(`Exactly ${updatedTerms.length} Forum House current unit price records verified.`);
  console.log(`Rows with changed price values: ${updatedCount}`);
  console.log(`All proposed prices are divisible by ${money(ROUND_TO)}.`);
  console.log(`All generated rates were between ${money(MIN_RATE)} and ${money(MAX_RATE)} per m2.`);
  console.log("Only current unit_sale_terms.list_price_at_offer and unit_sale_terms.contract_price were included in the write payload changes.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
