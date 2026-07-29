import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config({ path: ".env.local", quiet: true });

const BUILDING_ID = "e120ef73-a720-4a25-ab99-362f21612118";
const BUILDING_NAME = "Forum House";
const EXPECTED_UNIT_COUNT = 63;
const MIN_RATE = 6000;
const MAX_RATE = 7000;
const ROUND_TO = 500;
const SEED = "forum-house-unit-prices-2026-07-23";

const mode = process.argv.includes("--apply") ? "apply" : "dry-run";

const supabase = createClient(requiredEnv("NEXT_PUBLIC_SUPABASE_URL"), requiredEnv("SUPABASE_SERVICE_ROLE_KEY"), {
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

function roundPrice(value) {
  return Math.round(value / ROUND_TO) * ROUND_TO;
}

async function selectAll(query, label) {
  const { data, error } = await query;
  if (error) throw new Error(`${label}: ${error.message}`);
  return data ?? [];
}

async function loadState() {
  const buildings = await selectAll(
    supabase.from("buildings").select("id,name,address_line_1,postcode").eq("id", BUILDING_ID),
    "Could not identify Forum House",
  );
  if (buildings.length !== 1 || buildings[0].name !== BUILDING_NAME) {
    throw new Error(`Expected ${BUILDING_NAME} at ${BUILDING_ID}. Found ${buildings.length === 1 ? buildings[0].name : buildings.length}.`);
  }

  const units = await selectAll(
    supabase
      .from("units")
      .select("id,building_id,unit_number,size_sqm,sale_status")
      .eq("building_id", BUILDING_ID)
      .order("unit_number", { ascending: true }),
    "Could not load Forum House units",
  );
  if (units.length !== EXPECTED_UNIT_COUNT) throw new Error(`Expected ${EXPECTED_UNIT_COUNT} units, found ${units.length}.`);
  const invalidUnits = units.filter((unit) => !Number.isFinite(Number(unit.size_sqm)) || Number(unit.size_sqm) <= 0);
  if (invalidUnits.length > 0) throw new Error(`Units with invalid size: ${invalidUnits.map((unit) => unit.unit_number).join(", ")}`);

  const attempts = await selectAll(
    supabase
      .from("unit_sale_attempts")
      .select("id,building_id,unit_id,is_active,workflow_status,attempt_number")
      .eq("building_id", BUILDING_ID)
      .in("unit_id", units.map((unit) => unit.id)),
    "Could not load sale attempts",
  );

  const activeAttempts = attempts.filter((attempt) => attempt.is_active);
  const duplicateActive = units.filter((unit) => activeAttempts.filter((attempt) => attempt.unit_id === unit.id).length > 1);
  if (duplicateActive.length > 0) throw new Error(`Duplicate active attempts found: ${duplicateActive.map((unit) => unit.unit_number).join(", ")}`);

  const currentTerms = await selectAll(
    supabase
      .from("unit_sale_terms")
      .select("id,sale_attempt_id,is_current,status,list_price_at_offer,contract_price")
      .in("sale_attempt_id", activeAttempts.length > 0 ? activeAttempts.map((attempt) => attempt.id) : ["00000000-0000-0000-0000-000000000000"])
      .eq("is_current", true),
    "Could not load current sale terms",
  );

  const duplicateTerms = activeAttempts.filter((attempt) => currentTerms.filter((term) => term.sale_attempt_id === attempt.id).length > 1);
  if (duplicateTerms.length > 0) throw new Error(`Duplicate current terms found for attempts: ${duplicateTerms.map((attempt) => attempt.id).join(", ")}`);

  return { building: buildings[0], units, attempts, activeAttempts, currentTerms };
}

function buildRows(state) {
  const activeByUnit = new Map(state.activeAttempts.map((attempt) => [attempt.unit_id, attempt]));
  const termsByAttempt = new Map(state.currentTerms.map((term) => [term.sale_attempt_id, term]));
  const rand = mulberry32(hashSeed(SEED));

  return state.units.map((unit) => {
    const rate = Math.round(MIN_RATE + rand() * (MAX_RATE - MIN_RATE));
    const size = Number(unit.size_sqm);
    const calculatedPrice = size * rate;
    const roundedPrice = roundPrice(calculatedPrice);
    const attempt = activeByUnit.get(unit.id);
    const term = attempt ? termsByAttempt.get(attempt.id) : null;
    return {
      unit,
      attempt,
      term,
      rate,
      size,
      calculatedPrice,
      roundedPrice,
      existingPrice: term?.list_price_at_offer ?? term?.contract_price ?? null,
      action: !attempt ? "create attempt + terms + price" : !term ? "create terms + price" : "update price",
    };
  });
}

function report(state, rows) {
  console.log(`Forum House direct staging dummy prices (${mode})`);
  console.log(`Seed: ${SEED}`);
  console.log(`Building: ${state.building.name} (${state.building.id})`);
  console.log(`Address signal: ${[state.building.address_line_1, state.building.postcode].filter(Boolean).join(", ") || "-"}`);
  console.table(rows.map((row) => ({
    Unit: row.unit.unit_number,
    "Size m2": row.size,
    "GBP/m2": row.rate,
    "Rounded price": row.roundedPrice,
    "Active attempt": row.attempt?.id ?? "-",
    "Current terms": row.term?.id ?? "-",
    "Existing price": row.existingPrice,
    Action: row.action,
  })));
  const prices = rows.map((row) => row.roundedPrice);
  const rates = rows.map((row) => row.rate);
  console.log("Summary");
  console.log(`Units: ${rows.length}`);
  console.log(`Existing active attempts: ${rows.filter((row) => row.attempt).length}`);
  console.log(`Attempts to create: ${rows.filter((row) => !row.attempt).length}`);
  console.log(`Existing current terms: ${rows.filter((row) => row.term).length}`);
  console.log(`Terms to create: ${rows.filter((row) => !row.term).length}`);
  console.log(`Prices to update: ${rows.filter((row) => row.term).length}`);
  console.log(`Prices to insert: ${rows.filter((row) => !row.term).length}`);
  console.log(`Lowest price: ${Math.min(...prices)}`);
  console.log(`Highest price: ${Math.max(...prices)}`);
  console.log(`Lowest rate: ${Math.min(...rates)}`);
  console.log(`Highest rate: ${Math.max(...rates)}`);
}

async function applyRows(rows) {
  for (const row of rows) {
    let attempt = row.attempt;
    if (!attempt) {
      const maxAttemptNumber = Math.max(0, ...rows
        .filter((item) => item.unit.id === row.unit.id && item.attempt)
        .map((item) => Number(item.attempt.attempt_number) || 0));
      const { data, error } = await supabase
        .from("unit_sale_attempts")
        .insert({
          building_id: BUILDING_ID,
          unit_id: row.unit.id,
          attempt_number: maxAttemptNumber + 1,
          workflow_status: "draft",
          is_active: true,
        })
        .select("id,building_id,unit_id,is_active,workflow_status,attempt_number")
        .single();
      if (error) throw new Error(`Could not create draft sale attempt for unit ${row.unit.unit_number}: ${error.message}`);
      attempt = data;
    }

    if (row.term) {
      const { error } = await supabase
        .from("unit_sale_terms")
        .update({
          list_price_at_offer: row.roundedPrice,
          contract_price: row.roundedPrice,
        })
        .eq("id", row.term.id);
      if (error) throw new Error(`Could not update price for unit ${row.unit.unit_number}: ${error.message}`);
    } else {
      const { error } = await supabase
        .from("unit_sale_terms")
        .insert({
          sale_attempt_id: attempt.id,
          version_number: 1,
          is_current: true,
          status: "draft",
          list_price_at_offer: row.roundedPrice,
          contract_price: row.roundedPrice,
        });
      if (error) throw new Error(`Could not create sale terms for unit ${row.unit.unit_number}: ${error.message}`);
    }
  }
}

async function verify() {
  const state = await loadState();
  const rows = buildRows(state);
  const missingAttempt = rows.filter((row) => !row.attempt);
  const missingTerms = rows.filter((row) => !row.term);
  const badPrice = rows.filter((row) => Number(row.term?.list_price_at_offer) !== row.roundedPrice || Number(row.term?.contract_price) !== row.roundedPrice);
  const notForSale = rows.filter((row) => row.unit.sale_status !== "for_sale");
  const notDivisible = rows.filter((row) => row.roundedPrice % ROUND_TO !== 0);

  if (missingAttempt.length > 0) throw new Error(`Verification failed, missing active attempts: ${missingAttempt.map((row) => row.unit.unit_number).join(", ")}`);
  if (missingTerms.length > 0) throw new Error(`Verification failed, missing current terms: ${missingTerms.map((row) => row.unit.unit_number).join(", ")}`);
  if (badPrice.length > 0) throw new Error(`Verification failed, incorrect prices: ${badPrice.map((row) => row.unit.unit_number).join(", ")}`);
  if (notForSale.length > 0) throw new Error(`Verification failed, units not For Sale: ${notForSale.map((row) => row.unit.unit_number).join(", ")}`);
  if (notDivisible.length > 0) throw new Error(`Verification failed, prices not divisible by ${ROUND_TO}: ${notDivisible.map((row) => row.unit.unit_number).join(", ")}`);

  console.log("Verification complete.");
  console.log("Exactly 63 Forum House units have active draft/base sales records, current terms, and seeded dummy prices.");
}

async function main() {
  const state = await loadState();
  const rows = buildRows(state);
  report(state, rows);

  if (mode !== "apply") {
    console.log("Dry run complete. No changes made.");
    return;
  }

  await applyRows(rows);
  await verify();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
