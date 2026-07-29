import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config({ path: ".env.local", quiet: true });

const BUILDING_NAME = "Forum House";
const EXPECTED_UNIT_COUNT = 63;
const mode = process.argv.includes("--apply") ? "apply" : "dry-run";

const supabase = createClient(requiredEnv("NEXT_PUBLIC_SUPABASE_URL"), requiredEnv("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { autoRefreshToken: false, persistSession: false },
});

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

async function selectAll(query, label) {
  const { data, error } = await query;
  if (error) throw new Error(`${label}: ${error.message}`);
  return data ?? [];
}

function buildDepositStructure(input) {
  const exchangeDepositPercent = Number(input.exchange_deposit_percent ?? 10);
  const secondDepositEnabled = Boolean(input.second_deposit_enabled);
  const secondDepositPercent = secondDepositEnabled ? Number(input.second_deposit_percent ?? 0) : 0;
  const secondDepositMonthsAfterExchange = secondDepositEnabled
    ? Math.max(0, Math.floor(Number(input.second_deposit_months_after_exchange ?? 0)))
    : null;
  const completionBalancePercent = Math.round((100 - exchangeDepositPercent - secondDepositPercent) * 10_000) / 10_000;
  if (exchangeDepositPercent <= 0 || completionBalancePercent < 0 || (secondDepositEnabled && secondDepositPercent <= 0)) {
    throw new Error("Forum House sale defaults produce an invalid deposit structure. No changes made.");
  }
  return {
    exchangeDepositPercent,
    secondDepositEnabled,
    secondDepositPercent,
    secondDepositMonthsAfterExchange,
    completionBalancePercent,
  };
}

function paymentScheduleRows(defaults, contractPrice) {
  const structure = buildDepositStructure(defaults);
  const rows = [
    {
      sequenceNo: 1,
      paymentStage: "exchange",
      label: `${structure.exchangeDepositPercent}% exchange deposit`,
      dueEvent: "exchange",
      dueOffsetDays: 0,
      percentOfContractPrice: structure.exchangeDepositPercent,
      fixedAmount: null,
      expectedAmount: contractPrice === null ? null : contractPrice * (structure.exchangeDepositPercent / 100),
      includesReservationFee: true,
    },
  ];

  if (structure.secondDepositEnabled) {
    rows.push({
      sequenceNo: rows.length + 1,
      paymentStage: "delayed_deposit",
      label: `${structure.secondDepositPercent}% second deposit`,
      dueEvent: "manual_date",
      dueOffsetDays: (structure.secondDepositMonthsAfterExchange ?? 0) * 31,
      percentOfContractPrice: structure.secondDepositPercent,
      fixedAmount: null,
      expectedAmount: contractPrice === null ? null : contractPrice * (structure.secondDepositPercent / 100),
      includesReservationFee: false,
    });
  }

  rows.push({
    sequenceNo: rows.length + 1,
    paymentStage: "completion",
    label: `${structure.completionBalancePercent}% balance on completion`,
    dueEvent: "completion",
    dueOffsetDays: 0,
    percentOfContractPrice: structure.completionBalancePercent,
    fixedAmount: null,
    expectedAmount: contractPrice === null ? null : contractPrice * (structure.completionBalancePercent / 100),
    includesReservationFee: false,
  });

  return rows;
}

function depositSummary(defaults) {
  const structure = buildDepositStructure(defaults);
  return [
    `${structure.exchangeDepositPercent}% on exchange`,
    structure.secondDepositEnabled
      ? `${structure.secondDepositPercent}% ${structure.secondDepositMonthsAfterExchange ?? 0} months after exchange`
      : null,
    `${structure.completionBalancePercent}% on completion`,
  ].filter(Boolean).join(", ");
}

async function loadForumHouse() {
  const buildings = await selectAll(
    supabase.from("buildings").select("id,name,address_line_1,postcode").eq("name", BUILDING_NAME),
    "Could not identify Forum House",
  );
  if (buildings.length !== 1) throw new Error(`Expected exactly one building named ${BUILDING_NAME}, found ${buildings.length}. No changes made.`);
  const building = buildings[0];

  const units = await selectAll(
    supabase
      .from("units")
      .select("id,building_id,unit_number,floor,size_sqm,sale_status")
      .eq("building_id", building.id)
      .order("unit_number", { ascending: true }),
    "Could not load Forum House units",
  );
  if (units.length !== EXPECTED_UNIT_COUNT) throw new Error(`Expected ${EXPECTED_UNIT_COUNT} Forum House units, found ${units.length}. No changes made.`);

  const unitIds = units.map((unit) => unit.id);
  const attempts = await selectAll(
    supabase
      .from("unit_sale_attempts")
      .select("id,building_id,unit_id,is_active,workflow_status,attempt_number,stage_entered_at,reservation_submitted_at,reservation_approved_at,exchanged_at,completed_at")
      .eq("building_id", building.id)
      .in("unit_id", unitIds),
    "Could not load sale attempts",
  );
  const activeAttempts = attempts.filter((attempt) => attempt.is_active);
  const duplicateActiveUnits = units.filter((unit) => activeAttempts.filter((attempt) => attempt.unit_id === unit.id).length > 1);
  if (duplicateActiveUnits.length > 0) {
    throw new Error(`Duplicate active sale attempts found for units ${duplicateActiveUnits.map((unit) => unit.unit_number).join(", ")}. No changes made.`);
  }

  const activeAttemptIds = activeAttempts.map((attempt) => attempt.id);
  const terms = await selectAll(
    supabase
      .from("unit_sale_terms")
      .select("id,sale_attempt_id,is_current,status,list_price_at_offer,contract_price,parking_value,developer_contribution,agent_contribution,reservation_fee,reservation_fee_holder,agent_fee_percent,vat_rate,solicitor_fee")
      .in("sale_attempt_id", activeAttemptIds.length > 0 ? activeAttemptIds : ["00000000-0000-0000-0000-000000000000"]),
    "Could not load sale terms",
  );
  const currentTerms = terms.filter((term) => term.is_current);
  const duplicateCurrentTerms = activeAttempts.filter((attempt) => currentTerms.filter((term) => term.sale_attempt_id === attempt.id).length > 1);
  if (duplicateCurrentTerms.length > 0) {
    throw new Error(`Duplicate current sale terms found for sale attempts ${duplicateCurrentTerms.map((attempt) => attempt.id).join(", ")}. No changes made.`);
  }

  const { data: defaults, error: defaultsError } = await supabase
    .from("building_sale_defaults")
    .select("*")
    .eq("building_id", building.id)
    .maybeSingle();
  if (defaultsError) throw new Error(`Could not load Forum House sales defaults: ${defaultsError.message}`);

  return { building, units, activeAttempts, currentTerms, defaults: defaults ?? {} };
}

async function main() {
  console.log(`Forum House sales-record initialisation (${mode})`);
  const { building, units, activeAttempts, currentTerms, defaults } = await loadForumHouse();
  console.log(`Building: ${building.name} (${building.id})`);
  console.log(`Address signal: ${[building.address_line_1, building.postcode].filter(Boolean).join(", ") || "-"}`);

  const attemptsByUnit = new Map(activeAttempts.map((attempt) => [attempt.unit_id, attempt]));
  const termsByAttempt = new Map(currentTerms.map((term) => [term.sale_attempt_id, term]));
  const rows = units.map((unit) => {
    const attempt = attemptsByUnit.get(unit.id);
    const term = attempt ? termsByAttempt.get(attempt.id) : null;
    return {
      unit,
      attempt,
      term,
      createAttempt: !attempt,
      createTerms: !term,
    };
  });

  console.table(rows.map((row) => ({
    Unit: row.unit.unit_number,
    Status: row.unit.sale_status,
    "Active sale-attempt ID": row.attempt?.id ?? "-",
    "Attempt status": row.attempt?.workflow_status ?? "-",
    "Current sale-terms ID": row.term?.id ?? "-",
    "Terms status": row.term?.status ?? "-",
    "Create attempt": row.createAttempt,
    "Create terms": row.createTerms,
  })));

  console.log("Summary");
  console.log(`Number of units: ${rows.length}`);
  console.log(`Existing active sale attempts: ${rows.filter((row) => row.attempt).length}`);
  console.log(`Sale attempts to create: ${rows.filter((row) => row.createAttempt).length}`);
  console.log(`Existing current terms: ${rows.filter((row) => row.term).length}`);
  console.log(`Current terms to create: ${rows.filter((row) => row.createTerms).length}`);

  if (mode !== "apply") {
    console.log("Dry run complete. No changes made.");
    return;
  }

  for (const row of rows.filter((item) => item.createAttempt || item.createTerms)) {
    const existingPrice = row.term?.list_price_at_offer ?? row.term?.contract_price ?? null;
    const structure = buildDepositStructure(defaults);
    const { error } = await supabase.rpc("save_unit_commercial_model", {
      p_unit_id: row.unit.id,
      p_requester_id: null,
      p_list_price_at_offer: existingPrice,
      p_contract_price: existingPrice,
      p_parking_value: row.term?.parking_value ?? 0,
      p_developer_contribution: row.term?.developer_contribution ?? 0,
      p_agent_contribution: row.term?.agent_contribution ?? 0,
      p_reservation_fee: row.term?.reservation_fee ?? defaults.reservation_fee ?? null,
      p_reservation_fee_holder: row.term?.reservation_fee_holder ?? defaults.reservation_fee_holder_default ?? "sales_agent",
      p_agent_fee_percent: row.term?.agent_fee_percent ?? defaults.default_agent_fee_percent ?? null,
      p_vat_rate: row.term?.vat_rate ?? defaults.default_vat_rate ?? 20,
      p_solicitor_fee: row.term?.solicitor_fee ?? defaults.default_sales_solicitor_fee ?? 882,
      p_exchange_deposit_percent: structure.exchangeDepositPercent,
      p_second_deposit_enabled: structure.secondDepositEnabled,
      p_second_deposit_percent: structure.secondDepositEnabled ? structure.secondDepositPercent : null,
      p_second_deposit_months_after_exchange: structure.secondDepositEnabled ? structure.secondDepositMonthsAfterExchange : null,
      p_completion_balance_percent: structure.completionBalancePercent,
      p_deposit_summary: depositSummary(defaults),
      p_commercial_summary: null,
      p_payment_schedule: paymentScheduleRows(defaults, existingPrice),
    });
    if (error) throw new Error(`Initialisation failed for unit ${row.unit.unit_number}: ${error.message}`);
  }

  const after = await loadForumHouse();
  const afterAttemptsByUnit = new Map(after.activeAttempts.map((attempt) => [attempt.unit_id, attempt]));
  const afterTermsByAttempt = new Map(after.currentTerms.map((term) => [term.sale_attempt_id, term]));
  const missing = after.units.filter((unit) => !afterTermsByAttempt.has(afterAttemptsByUnit.get(unit.id)?.id));
  if (after.activeAttempts.length !== EXPECTED_UNIT_COUNT || after.currentTerms.length !== EXPECTED_UNIT_COUNT || missing.length > 0) {
    throw new Error(`Verification failed after initialisation. Active attempts: ${after.activeAttempts.length}; current terms: ${after.currentTerms.length}; missing units: ${missing.map((unit) => unit.unit_number).join(", ") || "-"}.`);
  }

  const changedSaleStatusUnits = after.units.filter((unit) => unit.sale_status !== "for_sale");
  if (changedSaleStatusUnits.length > 0) {
    throw new Error(`Verification failed: units no longer For Sale: ${changedSaleStatusUnits.map((unit) => unit.unit_number).join(", ")}.`);
  }

  console.log("Apply complete.");
  console.log("Exactly 63 Forum House units now have one active sale attempt and one current sale-terms record.");
  console.log("Units remain For Sale; no reservation dates or buyer details were written by this script.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
