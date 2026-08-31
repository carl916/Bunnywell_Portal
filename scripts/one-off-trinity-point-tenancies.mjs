import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config({ path: ".env.local", quiet: true });

const BUILDING = {
  name: "Trinity Point",
  addressLine1: "New Road",
  postcode: "DA11 0FD",
};
const SOURCE_REFERENCE_PREFIX = "trinity-point-tenancies-2026-08-31";
const SOURCE_FILES = [
  "Copy of Trinity Point - Information details (previous rent) (1).xlsx",
  "Trinity Point - Information details (1).xlsx",
];
const DEFAULT_ACTOR_EMAIL = "carl.gilbert@gmail.com";

const rows = [
  tenancy("69", 1, "2025-05-16", "2026-06-23", 1250),
  tenancy("69", 2, "2026-07-09", null, 1250, 9),
  tenancy("70", 1, "2025-06-20", null, 1200, 1),
  tenancy("71", 1, "2025-05-15", "2026-05-14", 1225),
  tenancy("71", 2, "2026-05-30", null, 1200, 30),
  tenancy("72", 1, "2025-05-15", "2026-05-15", 1200),
  tenancy("72", 2, "2026-08-28", null, 1200, 28),
  tenancy("73", 1, "2025-05-15", "2025-08-29", 1200),
  tenancy("73", 2, "2025-08-30", null, 1200, 30),
  tenancy("74", 1, "2025-05-15", null, 1250, 15),
  tenancy("75", 1, "2025-05-17", null, 1200, 17),
  tenancy("76", 1, "2025-05-15", null, 1250, 15),
  tenancy("77", 1, "2025-05-31", "2026-05-31", 1225),
  tenancy("77", 2, "2026-06-25", null, 1200, 25),
  tenancy("78", 1, "2025-05-31", "2026-05-28", 1300),
  tenancy("78", 2, "2026-05-29", "2026-07-28", 1225),
  tenancy("78", 3, "2026-08-06", null, 1225, 6),
  tenancy("79", 1, "2026-05-16", "2026-08-01", 1225),
  tenancy("79", 2, "2026-08-26", null, 1100, 26),
  tenancy("80", 1, "2025-05-23", null, 1250, 23),
  tenancy("81", 1, "2025-06-13", null, 1200, 13),
  tenancy("82", 1, "2025-06-13", null, 1200, 13),
  tenancy("83", 1, "2025-05-21", null, 1200, 21),
  tenancy("84", 1, "2025-05-13", "2025-12-16", 1200),
  tenancy("84", 2, "2025-12-18", "2026-06-17", 1200),
  tenancy("84", 3, "2026-06-24", null, 1200, 24),
  tenancy("85", 1, "2025-05-30", null, 1225, 30),
  tenancy("86", 1, "2025-05-16", "2026-06-16", 1200),
  tenancy("86", 2, "2026-06-24", null, 1200, 24),
];

const apply = process.argv.includes("--apply");
const allowUnallocatedUnits = process.argv.includes("--allow-unallocated-units");
const actorArg = process.argv.find((argument) => argument.startsWith("--actor-email="));
const actorEmail = actorArg?.slice("--actor-email=".length) || DEFAULT_ACTOR_EMAIL;

const supabase = createClient(requiredEnv("NEXT_PUBLIC_SUPABASE_URL"), requiredEnv("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { autoRefreshToken: false, persistSession: false },
});

function tenancy(unitNumber, tenantSequence, startDate, endDate, monthlyRent, rentDueDay = null) {
  return { unitNumber, tenantSequence, startDate, endDate, monthlyRent, rentDueDay };
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

async function select(query, label) {
  const { data, error } = await query;
  if (error) throw new Error(`${label}: ${error.message}`);
  return data ?? [];
}

function sourceReference(row) {
  return `${SOURCE_REFERENCE_PREFIX}:unit-${row.unitNumber}:tenant-${row.tenantSequence}`;
}

function overlaps(left, right) {
  const leftEnd = left.endDate ?? "9999-12-31";
  const rightEnd = right.endDate ?? "9999-12-31";
  return left.startDate <= rightEnd && right.startDate <= leftEnd;
}

function validateDataset() {
  if (rows.length !== 29) throw new Error(`Expected 29 tenancy rows, found ${rows.length}.`);
  const grouped = Map.groupBy(rows, (row) => row.unitNumber);
  if (grouped.size !== 18) throw new Error(`Expected 18 units, found ${grouped.size}.`);
  for (const [unitNumber, unitRows] of grouped) {
    const ordered = [...unitRows].sort((left, right) => left.startDate.localeCompare(right.startDate));
    for (let index = 0; index < ordered.length; index += 1) {
      const row = ordered[index];
      if (row.endDate && row.endDate < row.startDate) throw new Error(`Unit ${unitNumber} has an end date before its start date.`);
      if (index > 0 && overlaps(ordered[index - 1], row)) throw new Error(`Unit ${unitNumber} has overlapping source tenancy periods.`);
    }
  }
}

async function main() {
  validateDataset();

  const buildings = await select(
    supabase.from("buildings").select("id,name,address_line_1,postcode").eq("name", BUILDING.name),
    "Could not identify Trinity Point",
  );
  if (buildings.length !== 1) throw new Error(`Expected one ${BUILDING.name} building, found ${buildings.length}. No changes made.`);
  const building = buildings[0];
  if (building.address_line_1 !== BUILDING.addressLine1 || building.postcode !== BUILDING.postcode) {
    throw new Error(`Trinity Point address did not match ${BUILDING.addressLine1}, ${BUILDING.postcode}. No changes made.`);
  }

  const actorProfiles = await select(
    supabase.from("profiles").select("id,email,name,role,active").eq("email", actorEmail),
    "Could not identify import actor",
  );
  if (actorProfiles.length !== 1 || actorProfiles[0].active !== true || !["admin", "developer"].includes(actorProfiles[0].role)) {
    throw new Error(`Import actor ${actorEmail} must resolve to one active administrator or developer. No changes made.`);
  }
  const actor = actorProfiles[0];

  const requestedUnitNumbers = [...new Set(rows.map((row) => row.unitNumber))].sort((left, right) => Number(left) - Number(right));
  const units = await select(
    supabase.from("units").select("id,building_id,unit_number,sale_status,rental_portfolio_status").eq("building_id", building.id).in("unit_number", requestedUnitNumbers),
    "Could not load Trinity Point units",
  );
  const unitsByNumber = new Map(units.map((unit) => [unit.unit_number, unit]));
  const missingUnits = requestedUnitNumbers.filter((unitNumber) => !unitsByNumber.has(unitNumber));
  if (missingUnits.length > 0) throw new Error(`Missing Trinity Point units: ${missingUnits.join(", ")}. No changes made.`);

  const unitIds = units.map((unit) => unit.id);
  const existing = await select(
    supabase.from("unit_tenancies").select("id,unit_id,tenant_name,tenancy_start_date,tenancy_end_date,monthly_rent,rent_due_day,source_reference").in("unit_id", unitIds),
    "Could not check existing tenancies",
  );
  const existingByReference = new Map(existing.filter((row) => row.source_reference).map((row) => [row.source_reference, row]));
  const conflicts = [];
  const inserts = [];

  for (const row of rows) {
    const unit = unitsByNumber.get(row.unitNumber);
    const reference = sourceReference(row);
    const exact = existingByReference.get(reference);
    if (exact) {
      const matches = exact.unit_id === unit.id
        && exact.tenant_name === `Tenant ${row.tenantSequence} (name not supplied)`
        && exact.tenancy_start_date === row.startDate
        && exact.tenancy_end_date === row.endDate
        && Number(exact.monthly_rent) === row.monthlyRent
        && exact.rent_due_day === row.rentDueDay;
      if (!matches) conflicts.push(`Source reference ${reference} already exists with different tenancy values.`);
      continue;
    }
    const overlapping = existing.find((current) => current.unit_id === unit.id && overlaps(
      { startDate: current.tenancy_start_date, endDate: current.tenancy_end_date },
      row,
    ));
    if (overlapping) {
      conflicts.push(`Unit ${row.unitNumber} ${row.startDate} overlaps existing tenancy ${overlapping.id}.`);
      continue;
    }
    inserts.push({
      building_id: building.id,
      unit_id: unit.id,
      tenant_name: `Tenant ${row.tenantSequence} (name not supplied)`,
      tenancy_start_date: row.startDate,
      fixed_term_end_date: null,
      tenancy_end_date: row.endDate,
      monthly_rent: row.monthlyRent,
      rent_due_day: row.rentDueDay,
      deposit_amount: null,
      letting_agent_organisation_id: null,
      notes: `Tenant name was not supplied in the source workbooks. Source files: ${SOURCE_FILES.join("; ")}.`,
      source_type: "spreadsheet_import",
      source_reference: reference,
      created_by_user_id: actor.id,
      updated_by_user_id: actor.id,
    });
  }

  if (conflicts.length > 0) throw new Error(`Import conflicts:\n- ${conflicts.join("\n- ")}\nNo changes made.`);

  const unallocated = units.filter((unit) => !["active", "exited"].includes(unit.rental_portfolio_status));
  console.log(`${BUILDING.name} tenancy import (${apply ? "apply" : "dry-run"})`);
  console.log(`Building: ${building.name}, ${building.address_line_1}, ${building.postcode}`);
  console.log(`Actor: ${actor.name ?? actor.email} (${actor.role})`);
  console.log(`Source tenancy rows: ${rows.length}`);
  console.log(`Units represented: ${requestedUnitNumbers.length}`);
  console.log(`Existing exact imported rows: ${rows.length - inserts.length}`);
  console.log(`Rows to insert: ${inserts.length}`);
  console.log(`Ended tenancies: ${rows.filter((row) => row.endDate).length}`);
  console.log(`Open-ended tenancies: ${rows.filter((row) => !row.endDate).length}`);
  console.log(`Units outside the rental portfolio: ${unallocated.length}`);
  console.table(rows.map((row) => ({
    Unit: row.unitNumber,
    Tenant: row.tenantSequence,
    Start: row.startDate,
    End: row.endDate ?? "open",
    "Monthly rent": row.monthlyRent,
    "Rent due day": row.rentDueDay ?? "not supplied for historical tenancy",
    Action: existingByReference.has(sourceReference(row)) ? "already imported" : "insert",
  })));

  if (!apply) {
    console.log("Dry run complete. No changes made.");
    return;
  }
  if (unallocated.length > 0 && !allowUnallocatedUnits) {
    throw new Error(`Apply blocked: ${unallocated.length} source units are not active or exited rental-portfolio units. Re-run with --allow-unallocated-units only if importing the records while leaving unit allocation unchanged is intentional. No changes made.`);
  }
  if (inserts.length === 0) {
    console.log("All source rows were already imported exactly. No changes made.");
    return;
  }

  const { data: inserted, error: insertError } = await supabase.from("unit_tenancies").insert(inserts).select("id,unit_id,source_reference");
  if (insertError) throw new Error(`Tenancy insert failed: ${insertError.message}`);

  const unitNumberById = new Map(units.map((unit) => [unit.id, unit.unit_number]));
  const auditRows = inserted.map((record) => ({
    event_type: "tenancy_created",
    entity_type: "unit_tenancy",
    entity_id: record.id,
    summary: `Tenancy imported for Unit ${unitNumberById.get(record.unit_id)}.`,
    metadata: {
      source_type: "spreadsheet_import",
      source_reference: record.source_reference,
      source_files: SOURCE_FILES,
      tenant_name_missing_from_source: true,
    },
    created_by_user_id: actor.id,
  }));
  const { error: auditError } = await supabase.from("audit_events").insert(auditRows);
  if (auditError) {
    const insertedIds = inserted.map((record) => record.id);
    const { error: rollbackError } = await supabase.from("unit_tenancies").delete().in("id", insertedIds);
    throw new Error(`Audit insert failed: ${auditError.message}. ${rollbackError ? `Automatic tenancy rollback also failed: ${rollbackError.message}` : "Inserted tenancy rows were rolled back."}`);
  }

  const verified = await select(
    supabase.from("unit_tenancies").select("id,source_reference").in("source_reference", rows.map(sourceReference)),
    "Could not verify imported tenancies",
  );
  if (verified.length !== rows.length) throw new Error(`Verification failed: expected ${rows.length} source references, found ${verified.length}.`);
  const auditEvents = await select(
    supabase.from("audit_events").select("id,entity_id,event_type").eq("event_type", "tenancy_created").in("entity_id", verified.map((row) => row.id)),
    "Could not verify tenancy audit events",
  );
  if (auditEvents.length !== rows.length) throw new Error(`Verification failed: expected ${rows.length} tenancy audit events, found ${auditEvents.length}.`);
  console.log(`Apply complete. Exactly ${verified.length} Trinity Point tenancy records and ${auditEvents.length} audit events verified.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
