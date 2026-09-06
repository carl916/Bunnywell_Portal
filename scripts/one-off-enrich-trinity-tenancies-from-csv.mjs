import { readFileSync } from "node:fs";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config({ path: ".env.local", quiet: true });

const EXPECTED_PROJECT_HOST = "vxkpvdtrldwwqiddoyof.supabase.co";
const BUILDING_NAME = "Trinity Point";
const BUILDING_ADDRESS = "New Road";
const BUILDING_POSTCODE = "DA11 0FD";
const IMPORT_REFERENCE_PREFIX = "trinity-point-tenancies-2026-08-31";
const DEFAULT_ACTOR_EMAIL = "carl.gilbert@gmail.com";
const DEFAULT_CSV = "C:/Users/carlg/Downloads/trinity_point_tenancies_import.csv";

const apply = process.argv.includes("--apply");
const direct = process.argv.includes("--direct");
const actorEmail = argumentValue("--actor-email=") ?? DEFAULT_ACTOR_EMAIL;
const csvPath = argumentValue("--csv=") ?? DEFAULT_CSV;
const projectConfirmation = argumentValue("--confirm-project=");

const url = requiredEnv("NEXT_PUBLIC_SUPABASE_URL");
const projectHost = new URL(url).hostname;
if (projectHost !== EXPECTED_PROJECT_HOST) {
  throw new Error(`Refusing to run against ${projectHost}; expected staging project ${EXPECTED_PROJECT_HOST}.`);
}
if (apply && projectConfirmation !== EXPECTED_PROJECT_HOST) {
  throw new Error(`Apply requires --confirm-project=${EXPECTED_PROJECT_HOST}. No changes made.`);
}

const supabase = createClient(url, requiredEnv("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { autoRefreshToken: false, persistSession: false },
});

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function argumentValue(prefix) {
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length) || null;
}

function parseCsv(content) {
  const records = [];
  let row = [];
  let field = "";
  let quoted = false;
  const input = content.replace(/^\uFEFF/, "");
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (quoted) {
      if (character === '"' && input[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field.replace(/\r$/, ""));
      records.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }
  if (quoted) throw new Error("CSV ended inside a quoted field.");
  if (field || row.length) {
    row.push(field.replace(/\r$/, ""));
    records.push(row);
  }
  const [headers, ...values] = records.filter((record) => record.some((value) => value !== ""));
  if (!headers) return [];
  return values.map((record, index) => {
    if (record.length !== headers.length) throw new Error(`CSV row ${index + 2} has ${record.length} fields; expected ${headers.length}.`);
    return Object.fromEntries(headers.map((header, column) => [header, record[column].trim()]));
  });
}

function nullable(value) {
  return value === "" ? null : value;
}

function nullableNumber(value, label) {
  if (value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label} is not a number: ${value}`);
  return parsed;
}

function sourceReference(row) {
  return `${IMPORT_REFERENCE_PREFIX}:unit-${row.unit_number}:tenant-${Number(row.tenancy_sequence)}`;
}

function normaliseRow(row) {
  return {
    ...row,
    tenancy_sequence: Number(row.tenancy_sequence),
    fixed_term_end_date: nullable(row.fixed_term_end_date),
    tenancy_end_date: nullable(row.tenancy_end_date),
    monthly_rent: nullableNumber(row.monthly_rent, `${row.import_key} monthly_rent`),
    rent_due_day: nullableNumber(row.rent_due_day, `${row.import_key} rent_due_day`),
    deposit_amount: nullableNumber(row.deposit_amount, `${row.import_key} deposit_amount`),
  };
}

function overlaps(left, right) {
  const leftEnd = left.tenancy_end_date ?? "9999-12-31";
  const rightEnd = right.tenancy_end_date ?? "9999-12-31";
  return left.tenancy_start_date <= rightEnd && right.tenancy_start_date <= leftEnd;
}

function validateRows(rows) {
  const requiredHeaders = [
    "import_key", "building_name", "unit_number", "tenancy_sequence", "record_status", "tenant_name",
    "tenancy_start_date", "fixed_term_end_date", "tenancy_end_date", "monthly_rent", "rent_due_day",
    "deposit_amount", "letting_agent_name", "source_type", "source_reference", "notes",
  ];
  const missingHeaders = requiredHeaders.filter((header) => !(header in (rows[0] ?? {})));
  if (missingHeaders.length) throw new Error(`CSV is missing columns: ${missingHeaders.join(", ")}.`);
  if (rows.length !== 29) throw new Error(`Expected 29 CSV tenancies, found ${rows.length}.`);
  const unitNumbers = [...new Set(rows.map((row) => row.unit_number))].sort((left, right) => Number(left) - Number(right));
  const expectedUnits = Array.from({ length: 18 }, (_, index) => String(index + 69));
  if (JSON.stringify(unitNumbers) !== JSON.stringify(expectedUnits)) throw new Error(`Expected Units 69–86, found ${unitNumbers.join(", ")}.`);
  if (new Set(rows.map((row) => row.import_key)).size !== rows.length) throw new Error("CSV import keys are not unique.");
  for (const row of rows) {
    if (row.building_name !== BUILDING_NAME) throw new Error(`${row.import_key} is not for ${BUILDING_NAME}.`);
    if (!row.tenant_name) throw new Error(`${row.import_key} has no tenant name.`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.tenancy_start_date)) throw new Error(`${row.import_key} has an invalid tenancy start date.`);
    if (row.fixed_term_end_date && row.fixed_term_end_date < row.tenancy_start_date) throw new Error(`${row.import_key} has a fixed term ending before its start.`);
    if (row.tenancy_end_date && row.tenancy_end_date < row.tenancy_start_date) throw new Error(`${row.import_key} has an actual end before its start.`);
    if (!row.monthly_rent || row.monthly_rent < 0) throw new Error(`${row.import_key} has invalid monthly rent.`);
    if (row.rent_due_day !== null && (row.rent_due_day < 1 || row.rent_due_day > 31)) throw new Error(`${row.import_key} has an invalid rent due day.`);
    if (row.letting_agent_name !== "Robinson Jackson") throw new Error(`${row.import_key} has an unexpected letting agent.`);
    if (row.source_type !== "spreadsheet_import") throw new Error(`${row.import_key} has an unexpected source type.`);
  }
  for (const unitNumber of unitNumbers) {
    const unitRows = rows.filter((row) => row.unit_number === unitNumber).sort((left, right) => left.tenancy_start_date.localeCompare(right.tenancy_start_date));
    for (let index = 1; index < unitRows.length; index += 1) {
      if (overlaps(unitRows[index - 1], unitRows[index])) throw new Error(`CSV tenancies overlap for Unit ${unitNumber}.`);
    }
  }
}

async function select(query, label) {
  const { data, error } = await query;
  if (error) throw new Error(`${label}: ${error.message}`);
  return data ?? [];
}

function money(value) {
  return value === null ? "-" : new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(value);
}

function valuesMatch(current, desired) {
  return current.tenant_name === desired.tenant_name
    && current.tenancy_start_date === desired.tenancy_start_date
    && current.fixed_term_end_date === desired.fixed_term_end_date
    && current.tenancy_end_date === desired.tenancy_end_date
    && Number(current.monthly_rent) === desired.monthly_rent
    && current.rent_due_day === desired.rent_due_day
    && (current.deposit_amount === null ? null : Number(current.deposit_amount)) === desired.deposit_amount
    && current.letting_agent_organisation_id === desired.letting_agent_organisation_id
    && current.notes === desired.notes;
}

function wasUpdatedAfterImport(record) {
  return new Date(record.updated_at).valueOf() - new Date(record.created_at).valueOf() > 1_000;
}

async function main() {
  const rows = parseCsv(readFileSync(csvPath, "utf8")).map(normaliseRow);
  validateRows(rows);

  const buildings = await select(
    supabase.from("buildings").select("id,name,address_line_1,postcode").eq("name", BUILDING_NAME),
    "Could not identify Trinity Point",
  );
  if (buildings.length !== 1) throw new Error(`Expected one ${BUILDING_NAME} building, found ${buildings.length}. No changes made.`);
  const building = buildings[0];
  if (building.address_line_1 !== BUILDING_ADDRESS || building.postcode !== BUILDING_POSTCODE) {
    throw new Error(`Trinity Point address did not match ${BUILDING_ADDRESS}, ${BUILDING_POSTCODE}. No changes made.`);
  }

  const actors = await select(
    supabase.from("profiles").select("id,email,name,role,active").eq("email", actorEmail),
    "Could not identify import actor",
  );
  if (actors.length !== 1 || actors[0].active !== true || !["admin", "developer"].includes(actors[0].role)) {
    throw new Error(`Import actor ${actorEmail} must be one active administrator or developer. No changes made.`);
  }
  const actor = actors[0];

  const agents = await select(
    supabase.from("organisations").select("id,name,type").ilike("name", "RMJ"),
    "Could not identify RMJ",
  );
  if (agents.length !== 1 || agents[0].type !== "letting_agent") {
    throw new Error(`Expected one letting-agent organisation named RMJ, found ${agents.length}. No changes made.`);
  }
  const agent = agents[0];

  const units = await select(
    supabase.from("units").select("id,building_id,unit_number,rental_portfolio_status").eq("building_id", building.id).in("unit_number", [...new Set(rows.map((row) => row.unit_number))]),
    "Could not load Trinity Point units",
  );
  const unitsByNumber = new Map(units.map((unit) => [unit.unit_number, unit]));
  const missingUnits = rows.map((row) => row.unit_number).filter((unitNumber, index, all) => !unitsByNumber.has(unitNumber) && all.indexOf(unitNumber) === index);
  if (missingUnits.length) throw new Error(`Missing Trinity Point units: ${missingUnits.join(", ")}. No changes made.`);
  const inactiveUnits = units.filter((unit) => unit.rental_portfolio_status !== "active");
  if (inactiveUnits.length) throw new Error(`Units not active in the rental portfolio: ${inactiveUnits.map((unit) => unit.unit_number).join(", ")}. No changes made.`);

  const references = rows.map(sourceReference);
  const existing = await select(
    supabase.from("unit_tenancies").select("*").in("source_reference", references),
    "Could not load prior Trinity tenancy imports",
  );
  if (existing.length !== rows.length) throw new Error(`Expected ${rows.length} prior import records, found ${existing.length}. No changes made.`);
  const existingByReference = new Map(existing.map((record) => [record.source_reference, record]));
  const duplicateReferences = references.filter((reference, index) => references.indexOf(reference) !== index);
  if (duplicateReferences.length) throw new Error("Calculated source references are not unique. No changes made.");

  const conflicts = [];
  const updates = [];
  const unchanged = [];
  for (const row of rows) {
    const current = existingByReference.get(sourceReference(row));
    const unit = unitsByNumber.get(row.unit_number);
    if (!current || current.unit_id !== unit.id || current.building_id !== building.id) {
      conflicts.push(`${row.import_key}: prior import is missing or linked to the wrong unit.`);
      continue;
    }
    const desired = {
      tenant_name: row.tenant_name,
      tenancy_start_date: row.tenancy_start_date,
      fixed_term_end_date: row.fixed_term_end_date,
      tenancy_end_date: row.tenancy_end_date,
      monthly_rent: row.monthly_rent,
      rent_due_day: row.rent_due_day,
      deposit_amount: row.deposit_amount,
      letting_agent_organisation_id: agent.id,
      notes: `${row.notes}\nSources: ${row.source_reference}.\nImport key: ${row.import_key}.`,
      source_type: row.source_type,
      source_reference: current.source_reference,
    };
    if (valuesMatch(current, desired)) {
      unchanged.push({ row, current, desired });
    } else if (wasUpdatedAfterImport(current) && !/^Tenant \d+ \(name not supplied\)$/.test(current.tenant_name)) {
      conflicts.push(`${row.import_key}: record ${current.id} was edited after the original import and differs from this CSV.`);
    } else {
      updates.push({ row, current, desired });
    }
  }
  if (conflicts.length) throw new Error(`Import conflicts:\n- ${conflicts.join("\n- ")}\nNo changes made.`);

  console.log(`Trinity Point CSV enrichment (${apply ? "apply" : "dry-run"})`);
  console.log(`Target: ${EXPECTED_PROJECT_HOST}`);
  console.log(`Building: ${building.name}, ${building.address_line_1}, ${building.postcode}`);
  console.log(`Actor: ${actor.name ?? actor.email} (${actor.role})`);
  console.log(`Letting agent: Robinson Jackson → ${agent.name}`);
  console.log(`CSV rows validated: ${rows.length}`);
  console.log(`Rows to update: ${updates.length}`);
  console.log(`Rows already current: ${unchanged.length}`);
  console.table(updates.map(({ row, current, desired }) => ({
    Key: row.import_key,
    Unit: row.unit_number,
    "Current tenant": current.tenant_name,
    "CSV tenant": desired.tenant_name,
    Start: desired.tenancy_start_date,
    "Fixed end": desired.fixed_term_end_date ?? "-",
    "Actual end": desired.tenancy_end_date ?? "open",
    Rent: money(desired.monthly_rent),
    Deposit: money(desired.deposit_amount),
  })));

  if (!apply) {
    console.log("Dry run complete. No changes made.");
    return;
  }

  if (direct) {
    const appliedAt = new Date().toISOString();
    const updateRows = updates.map(({ current, desired }) => ({
      ...current,
      ...desired,
      updated_by_user_id: actor.id,
    }));
    const { data: updatedRows, error: updateError } = await supabase
      .from("unit_tenancies")
      .upsert(updateRows, { onConflict: "id" })
      .select("*");
    if (updateError) throw new Error(`Atomic tenancy update failed: ${updateError.message}. No changes made.`);

    const updatedById = new Map((updatedRows ?? []).map((record) => [record.id, record]));
    const unitNumberById = new Map(units.map((unit) => [unit.id, unit.unit_number]));
    const auditRows = updates.map(({ current }) => ({
      event_type: "tenancy_updated",
      entity_type: "unit_tenancy",
      entity_id: current.id,
      summary: `Tenancy enriched from reconciled source data for Unit ${unitNumberById.get(current.unit_id)}.`,
      metadata: {
        old: current,
        new: updatedById.get(current.id),
        building_id: current.building_id,
        unit_id: current.unit_id,
        source: "trinity_point_tenancies_import.csv",
        enrichment: ["tenant_name", "fixed_term_end_date", "deposit_amount", "letting_agent", "source_notes", "corrected_chronology"],
      },
      created_by_user_id: actor.id,
    }));
    const { error: auditError } = await supabase.from("audit_events").insert(auditRows);
    if (auditError) {
      const { error: rollbackError } = await supabase.from("unit_tenancies").upsert(updates.map(({ current }) => current), { onConflict: "id" });
      throw new Error(`Audit insert failed: ${auditError.message}. ${rollbackError ? `Automatic data rollback also failed: ${rollbackError.message}` : "Tenancy values were restored."}`);
    }
    const auditEvents = await select(
      supabase.from("audit_events").select("id,entity_id").eq("event_type", "tenancy_updated").gte("created_at", appliedAt).in("entity_id", updates.map(({ current }) => current.id)),
      "Could not verify enrichment audit events",
    );
    if (auditEvents.length !== updates.length) throw new Error(`Audit verification failed: expected ${updates.length} events, found ${auditEvents.length}.`);
  } else {
    for (const { current, desired } of updates) {
      const { error } = await supabase.rpc("update_unit_tenancy", {
        p_actor_user_id: actor.id,
        p_tenancy_id: current.id,
        p_tenant_name: desired.tenant_name,
        p_tenancy_start_date: desired.tenancy_start_date,
        p_fixed_term_end_date: desired.fixed_term_end_date,
        p_tenancy_end_date: desired.tenancy_end_date,
        p_monthly_rent: desired.monthly_rent,
        p_rent_due_day: desired.rent_due_day,
        p_deposit_amount: desired.deposit_amount,
        p_letting_agent_organisation_id: desired.letting_agent_organisation_id,
        p_notes: desired.notes,
        p_source_type: desired.source_type,
        p_source_reference: desired.source_reference,
      });
      if (error) throw new Error(`Update failed for ${current.source_reference}: ${error.message}. Re-run safely after resolving the error; completed rows are idempotent.`);
    }
  }

  const verified = await select(
    supabase.from("unit_tenancies").select("*").in("source_reference", references),
    "Could not verify enriched tenancies",
  );
  const verifiedByReference = new Map(verified.map((record) => [record.source_reference, record]));
  const verificationFailures = updates.filter(({ current, desired }) => !valuesMatch(verifiedByReference.get(current.source_reference), desired));
  if (verificationFailures.length) throw new Error(`Verification failed for: ${verificationFailures.map(({ row }) => row.import_key).join(", ")}.`);
  console.log(`Apply complete. ${updates.length} tenancy records updated and verified; ${unchanged.length} were already current.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
