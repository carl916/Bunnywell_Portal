import { basename } from "node:path";
import { readFile } from "node:fs/promises";
import dotenv from "dotenv";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { createClient } from "@supabase/supabase-js";
import { attributeArrearsEpisode } from "./lib/rent-risk-attribution.mjs";

dotenv.config({ path: ".env.local", quiet: true });

const EXPECTED_PROJECT_HOST = "vxkpvdtrldwwqiddoyof.supabase.co";
const BUILDING = { name: "Trinity Point", addressLine1: "New Road", postcode: "DA11 0FD" };
const EXPECTED_EPISODE_COUNT = 13;
const EXPECTED_EVENT_COUNT = 32;
const apply = process.argv.includes("--apply");
const sourceOnly = process.argv.includes("--source-only");
const workbookPath = argumentValue("--workbook=") ?? process.env.RENT_ARREARS_WORKBOOK;
const actorEmail = argumentValue("--actor-email=");
const projectConfirmation = argumentValue("--confirm-project=");

if (!workbookPath) throw new Error("Pass --workbook=<path> or set RENT_ARREARS_WORKBOOK. No changes made.");
if (!sourceOnly && !actorEmail) throw new Error("Pass --actor-email=<active admin/developer email>. No changes made.");
if (apply && sourceOnly) throw new Error("Choose either --source-only or --apply, not both.");

let supabase = null;
if (!sourceOnly) {
  const url = requiredEnv("NEXT_PUBLIC_SUPABASE_URL");
  const projectHost = new URL(url).hostname;
  if (projectHost !== EXPECTED_PROJECT_HOST) {
    throw new Error(`Refusing to run against ${projectHost}; expected staging project ${EXPECTED_PROJECT_HOST}.`);
  }
  if (apply && projectConfirmation !== EXPECTED_PROJECT_HOST) {
    throw new Error(`Apply requires --confirm-project=${EXPECTED_PROJECT_HOST}. No changes made.`);
  }
  supabase = createClient(url, requiredEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function argumentValue(prefix) {
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length) || null;
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function cellValue(cell) {
  const value = cell.value;
  if (value && typeof value === "object" && !(value instanceof Date) && "result" in value) return value.result;
  return value;
}

function rowsFromSheet(sheet, headerRowNumber = 1) {
  const headers = sheet.getRow(headerRowNumber).values.slice(1).map((value) => String(value ?? "").trim());
  const rows = [];
  for (let rowNumber = headerRowNumber + 1; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const record = Object.fromEntries(headers.map((header, index) => [header, cellValue(row.getCell(index + 1))]));
    if (Object.values(record).some((value) => value !== null && value !== undefined && value !== "")) rows.push(record);
  }
  return rows;
}

function requireHeaders(rows, headers, sheetName) {
  const first = rows[0] ?? {};
  const missing = headers.filter((header) => !(header in first));
  if (missing.length) throw new Error(`${sheetName} is missing columns: ${missing.join(", ")}.`);
}

function excelDate(value, label) {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) return `${value.slice(0, 10)}T00:00:00.000Z`;
  if (typeof value === "number" && Number.isFinite(value)) return new Date(Math.round((value - 25_569) * 86_400_000)).toISOString();
  throw new Error(`${label} is not a valid Excel date.`);
}

function optionalDate(value, label) {
  return value === null || value === undefined || value === "" ? null : excelDate(value, label);
}

function money(value, label, nullable = false) {
  if (nullable && (value === null || value === undefined || value === "")) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${label} must be a non-negative amount.`);
  return parsed;
}

function text(value, label, nullable = false) {
  const parsed = typeof value === "string" ? value.trim() : value === null || value === undefined ? "" : String(value).trim();
  if (!parsed && !nullable) throw new Error(`${label} is required.`);
  return parsed || null;
}

function booleanValue(value) {
  if (typeof value === "boolean") return value;
  if (value === 1 || String(value).toLowerCase() === "true" || String(value).toLowerCase() === "yes") return true;
  if (value === 0 || value === null || value === undefined || String(value).toLowerCase() === "false" || String(value).toLowerCase() === "no") return false;
  throw new Error(`Unexpected boolean value: ${String(value)}`);
}

function canonicalEventType(value) {
  const mapping = {
    arrears_reported: "first_arrears_notification",
    arrears_update: "balance_changed",
    receipt_statement: "payment_or_clearance_evidence",
    partial_receipt_statement: "payment_or_clearance_evidence",
    arrears_cleared: "payment_or_clearance_evidence",
    tenancy_relet: "tenancy_ended_or_relet",
    recovery_outcome: "recovery_outcome",
    owner_decision_requested: "owner_decision_requested",
  };
  const mapped = mapping[value];
  if (!mapped) throw new Error(`Unsupported material event type: ${String(value)}`);
  return mapped;
}

function dateOnly(value) {
  return value.slice(0, 10);
}

async function select(query, label) {
  const { data, error } = await query;
  if (error) throw new Error(`${label}: ${error.message}`);
  return data ?? [];
}

function comparableEpisodeContent(record) {
  return {
    agent_tenancy_reference: record.agent_tenancy_reference,
    first_reported_at: dateOnly(record.first_reported_at),
    last_reported_at: dateOnly(record.last_reported_at),
    cleared_at: record.cleared_at ? dateOnly(record.cleared_at) : null,
    initial_reported_amount: Number(record.initial_reported_amount),
    maximum_reported_amount: Number(record.maximum_reported_amount),
    latest_reported_amount: record.latest_reported_amount === null ? null : Number(record.latest_reported_amount),
    status: record.status,
    intervention_level: record.intervention_level,
    owner_action_required: record.owner_action_required,
    resolution_basis: record.resolution_basis,
    management_summary: record.management_summary,
    source_reference: record.source_reference,
    source_import_key: record.source_import_key,
  };
}

function comparableEvent(record) {
  return {
    episode_id: record.episode_id,
    event_at: dateOnly(record.event_at),
    event_type: record.event_type,
    reported_amount: record.reported_amount === null ? null : Number(record.reported_amount),
    summary: record.summary,
    source_reference: record.source_reference,
    source_kind: record.source_kind,
    evidence_confidence: record.evidence_confidence,
    source_import_key: record.source_import_key,
  };
}

function sameRecord(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function loadWorkbook(sourcePath) {
  const source = await readFile(sourcePath);
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(source);
    return workbook;
  } catch (error) {
    // Some generated OOXML uses an explicit x: prefix that Excel accepts but
    // ExcelJS does not. Normalise only that namespace in memory; never write a
    // repaired workbook or copy the sensitive source into the repository.
    if (!(error instanceof TypeError) || !error.message.includes("reading 'sheets'")) throw error;
    const archive = await JSZip.loadAsync(source);
    for (const [path, entry] of Object.entries(archive.files)) {
      if (entry.dir || !path.endsWith(".xml")) continue;
      const xml = await entry.async("string");
      if (!xml.includes("<x:") && !xml.includes("</x:")) continue;
      archive.file(path, xml
        .replace(/(<\/?)(x):/g, "$1")
        .replace(/xmlns:x="http:\/\/schemas\.openxmlformats\.org\/spreadsheetml\/2006\/main"/g, "xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\"")
        .replace(/<tableParts\b[\s\S]*?<\/tableParts>/g, ""));
    }
    const normalised = await archive.generateAsync({ type: "nodebuffer" });
    const compatibleWorkbook = new ExcelJS.Workbook();
    await compatibleWorkbook.xlsx.load(normalised);
    return compatibleWorkbook;
  }
}

function episodeDatabaseRecord(episode, tenancyId) {
  return {
    tenancy_id: tenancyId,
    attribution_status: "matched",
    attribution_review_reason: null,
    agent_tenancy_reference: episode.agent_tenancy_reference,
    first_reported_at: episode.first_reported_at,
    last_reported_at: episode.last_reported_at,
    cleared_at: episode.cleared_at,
    initial_reported_amount: episode.initial_reported_amount,
    maximum_reported_amount: episode.maximum_reported_amount,
    latest_reported_amount: episode.latest_reported_amount,
    status: episode.status,
    intervention_level: episode.intervention_level,
    owner_action_required: episode.owner_action_required,
    resolution_basis: episode.resolution_basis,
    management_summary: episode.management_summary,
    source_reference: episode.source_reference,
    source_import_key: episode.source_import_key,
  };
}

function eventDatabaseRecord(event, episodeId) {
  return {
    episode_id: episodeId,
    event_at: event.event_at,
    event_type: event.event_type,
    reported_amount: event.reported_amount,
    summary: event.summary,
    source_reference: event.source_reference,
    source_kind: event.source_kind,
    evidence_confidence: event.evidence_confidence,
    source_import_key: event.source_import_key,
  };
}

async function main() {
  const workbook = await loadWorkbook(workbookPath);
  const episodeSheet = workbook.getWorksheet("Arrears Episodes");
  const eventSheet = workbook.getWorksheet("Arrears Events");
  const coverageSheet = workbook.getWorksheet("Coverage");
  if (!episodeSheet || !eventSheet) throw new Error("Workbook must contain Arrears Episodes and Arrears Events sheets.");

  const rawEpisodes = rowsFromSheet(episodeSheet);
  const rawEvents = rowsFromSheet(eventSheet);
  requireHeaders(rawEpisodes, [
    "episode_import_key", "building_name", "unit_number", "agent_tenancy_reference", "opened_at", "closed_at",
    "initial_reported_amount", "maximum_reported_amount", "latest_reported_amount", "status", "resolution_basis",
    "intervention_level", "owner_action_required", "episode_summary", "first_source_document_key",
  ], "Arrears Episodes");
  requireHeaders(rawEvents, [
    "event_import_key", "episode_import_key", "building_name", "unit_number", "event_at", "event_type",
    "reported_amount", "source_kind", "source_reference", "evidence_confidence", "event_summary",
  ], "Arrears Events");
  if (rawEpisodes.length !== EXPECTED_EPISODE_COUNT) throw new Error(`Expected ${EXPECTED_EPISODE_COUNT} episode rows, found ${rawEpisodes.length}.`);
  if (rawEvents.length !== EXPECTED_EVENT_COUNT) throw new Error(`Expected ${EXPECTED_EVENT_COUNT} material event rows, found ${rawEvents.length}.`);

  const events = rawEvents.map((row) => ({
    source_import_key: text(row.event_import_key, "Event import key"),
    episode_import_key: text(row.episode_import_key, "Episode import key"),
    building_name: text(row.building_name, "Event building"),
    unit_number: text(row.unit_number, "Event unit number"),
    event_at: excelDate(row.event_at, `${row.event_import_key} event date`),
    event_type: canonicalEventType(row.event_type),
    reported_amount: money(row.reported_amount, `${row.event_import_key} reported amount`, true),
    source_kind: text(row.source_kind, `${row.event_import_key} source kind`, true),
    source_reference: text(row.source_reference, `${row.event_import_key} source reference`),
    evidence_confidence: text(row.evidence_confidence, `${row.event_import_key} evidence confidence`),
    summary: text(row.event_summary, `${row.event_import_key} summary`),
  }));
  if (new Set(events.map((event) => event.source_import_key)).size !== events.length) throw new Error("Material event import keys are not unique.");
  if (events.some((event) => !["low", "medium", "high"].includes(event.evidence_confidence))) throw new Error("Evidence confidence must be low, medium or high.");

  const eventsByEpisode = Map.groupBy(events, (event) => event.episode_import_key);
  const episodes = rawEpisodes.map((row) => {
    const sourceImportKey = text(row.episode_import_key, "Episode import key");
    const episodeEvents = eventsByEpisode.get(sourceImportKey) ?? [];
    if (episodeEvents.length === 0) throw new Error(`${sourceImportKey} has no material events.`);
    const firstReportedAt = excelDate(row.opened_at, `${sourceImportKey} opened date`);
    const lastReportedAt = [...episodeEvents].sort((left, right) => right.event_at.localeCompare(left.event_at))[0].event_at;
    const status = text(row.status, `${sourceImportKey} status`);
    if (!["open", "cleared", "closed_reconciliation_review", "ended_unreconciled"].includes(status)) throw new Error(`${sourceImportKey} has an unsupported status.`);
    const interventionLevel = text(row.intervention_level, `${sourceImportKey} intervention level`);
    if (!["information", "watch", "action_required"].includes(interventionLevel)) throw new Error(`${sourceImportKey} has an unsupported intervention level.`);
    const summary = text(row.episode_summary, `${sourceImportKey} summary`);
    if (summary.length > 600) throw new Error(`${sourceImportKey} summary is too long for a concise management record.`);
    return {
      source_import_key: sourceImportKey,
      building_name: text(row.building_name, `${sourceImportKey} building`),
      unit_number: text(row.unit_number, `${sourceImportKey} unit number`),
      tenancy_import_key: text(row.tenancy_import_key, `${sourceImportKey} tenancy import key`, true),
      tenant_name_evidence: text(row.tenant_name_evidence ?? row.tenant_name, `${sourceImportKey} tenant evidence`, true),
      agent_tenancy_reference: text(row.agent_tenancy_reference, `${sourceImportKey} agent reference`, true),
      first_reported_at: firstReportedAt,
      last_reported_at: lastReportedAt,
      cleared_at: status === "cleared" ? optionalDate(row.closed_at, `${sourceImportKey} cleared date`) : null,
      initial_reported_amount: money(row.initial_reported_amount, `${sourceImportKey} initial amount`),
      maximum_reported_amount: money(row.maximum_reported_amount, `${sourceImportKey} maximum amount`),
      latest_reported_amount: money(row.latest_reported_amount, `${sourceImportKey} latest amount`, true),
      status,
      intervention_level: interventionLevel,
      owner_action_required: booleanValue(row.owner_action_required),
      resolution_basis: text(row.resolution_basis, `${sourceImportKey} resolution basis`, true),
      management_summary: summary,
      source_reference: text(row.first_source_document_key, `${sourceImportKey} source reference`, true) ?? sourceImportKey,
    };
  });
  if (new Set(episodes.map((episode) => episode.source_import_key)).size !== episodes.length) throw new Error("Episode import keys are not unique.");
  if (episodes.some((episode) => episode.building_name !== BUILDING.name) || events.some((event) => event.building_name !== BUILDING.name)) {
    throw new Error(`Every normalized row must belong to ${BUILDING.name}.`);
  }

  // Coverage is read only to record import/data-quality health. It never creates arrears domain rows.
  const coverage = coverageSheet ? rowsFromSheet(coverageSheet, 5) : [];
  const coverageDataQualityIssues = coverage
    .filter((row) => text(row.data_quality_flag, "Coverage issue", true))
    .map((row) => ({ building_name: row.building_name, unit_number: String(row.unit_number), issue: String(row.data_quality_flag).trim() }));

  if (sourceOnly) {
    const dataAsOf = [...events].sort((left, right) => right.event_at.localeCompare(left.event_at))[0].event_at;
    console.log(`Validated ${episodes.length} normalized episodes and ${events.length} material events from ${basename(workbookPath)}.`);
    console.log(`Data as at: ${dateOnly(dataAsOf)}. Data-quality issues: ${coverageDataQualityIssues.length}. No database queries or changes made.`);
    return;
  }

  const buildings = await select(
    supabase.from("buildings").select("id,name,address_line_1,postcode").eq("name", BUILDING.name),
    "Could not identify Trinity Point",
  );
  if (buildings.length !== 1) throw new Error(`Expected one ${BUILDING.name} building, found ${buildings.length}. No changes made.`);
  const building = buildings[0];
  if (building.address_line_1 !== BUILDING.addressLine1 || building.postcode !== BUILDING.postcode) {
    throw new Error(`Trinity Point address did not match ${BUILDING.addressLine1}, ${BUILDING.postcode}. No changes made.`);
  }

  const actors = await select(
    supabase.from("profiles").select("id,email,name,role,active").eq("email", actorEmail),
    "Could not identify import actor",
  );
  if (actors.length !== 1 || actors[0].active !== true || !["admin", "developer"].includes(actors[0].role)) {
    throw new Error(`Import actor ${actorEmail} must be one active administrator or developer. No changes made.`);
  }
  const actor = actors[0];

  const unitNumbers = [...new Set(episodes.map((episode) => episode.unit_number))];
  const units = await select(
    supabase.from("units").select("id,building_id,unit_number").eq("building_id", building.id).in("unit_number", unitNumbers),
    "Could not load Trinity Point units",
  );
  const unitsByNumber = new Map(units.map((unit) => [unit.unit_number, unit]));
  const missingUnits = unitNumbers.filter((unitNumber) => !unitsByNumber.has(unitNumber));
  if (missingUnits.length) throw new Error(`Missing Trinity Point units: ${missingUnits.join(", ")}. No changes made.`);

  const tenancies = await select(
    supabase.from("unit_tenancies").select("id,building_id,unit_id,tenant_name,tenancy_start_date,tenancy_end_date,source_reference").in("unit_id", units.map((unit) => unit.id)),
    "Could not load Trinity Point tenancies",
  );
  const attributedEpisodes = episodes.map((episode) => {
    const unit = unitsByNumber.get(episode.unit_number);
    const attribution = attributeArrearsEpisode(episode, unit, tenancies);
    return { episode, attribution };
  });
  const attributionIssues = attributedEpisodes
    .filter(({ attribution }) => attribution.status === "review_required")
    .map(({ episode, attribution }) => ({
      kind: "arrears_tenancy_attribution",
      building_name: episode.building_name,
      unit_number: episode.unit_number,
      source_import_key: episode.source_import_key,
      episode_date: dateOnly(episode.first_reported_at),
      candidate_tenancy_ids: attribution.candidateTenancyIds,
      issue: attribution.reason,
    }));
  const dataQualityIssues = [...coverageDataQualityIssues, ...attributionIssues];
  const desiredEpisodes = attributedEpisodes
    .filter(({ attribution }) => attribution.status === "matched")
    .map(({ episode, attribution }) => episodeDatabaseRecord(episode, attribution.tenancy.id));
  const matchedEpisodeKeys = new Set(desiredEpisodes.map((episode) => episode.source_import_key));
  const desiredEvents = events.filter((event) => matchedEpisodeKeys.has(event.episode_import_key));

  const existingEpisodes = await select(
    supabase.from("rental_arrears_episodes").select("*").in("source_import_key", episodes.map((episode) => episode.source_import_key)),
    "Could not check existing arrears episodes",
  );
  const existingEpisodesByKey = new Map(existingEpisodes.map((episode) => [episode.source_import_key, episode]));
  const episodeConflicts = desiredEpisodes.filter((desired) => {
    const existing = existingEpisodesByKey.get(desired.source_import_key);
    return existing && !sameRecord(comparableEpisodeContent(existing), comparableEpisodeContent(desired));
  });
  if (episodeConflicts.length) throw new Error(`Existing episodes differ from the workbook: ${episodeConflicts.map((episode) => episode.source_import_key).join(", ")}. No changes made.`);
  const tenancyCorrections = desiredEpisodes.filter((desired) => {
    const existing = existingEpisodesByKey.get(desired.source_import_key);
    return existing && existing.tenancy_id !== desired.tenancy_id;
  });

  const existingEvents = desiredEvents.length === 0 ? [] : await select(
    supabase.from("rental_arrears_events").select("episode_id,event_at,event_type,reported_amount,summary,source_reference,source_kind,evidence_confidence,source_import_key").in("source_import_key", desiredEvents.map((event) => event.source_import_key)),
    "Could not check existing arrears events",
  );
  const existingEventsByKey = new Map(existingEvents.map((event) => [event.source_import_key, event]));
  const eventConflicts = desiredEvents.filter((event) => {
    const existing = existingEventsByKey.get(event.source_import_key);
    if (!existing) return false;
    const expectedEpisodeId = existingEpisodesByKey.get(event.episode_import_key)?.id;
    return !expectedEpisodeId || !sameRecord(comparableEvent(existing), comparableEvent({ ...event, episode_id: expectedEpisodeId }));
  });
  if (eventConflicts.length) throw new Error(`Existing append-only events differ from the workbook: ${eventConflicts.map((event) => event.source_import_key).join(", ")}. No changes made.`);
  const existingEventKeys = new Set(existingEvents.map((event) => event.source_import_key));
  const dataAsOf = [...events].sort((left, right) => right.event_at.localeCompare(left.event_at))[0].event_at;

  console.log(`Trinity Point rent-risk import (${apply ? "apply" : "dry-run"})`);
  console.log(`Target: ${EXPECTED_PROJECT_HOST}`);
  console.log(`Workbook: ${basename(workbookPath)}`);
  console.log(`Actor: ${actor.name ?? actor.email} (${actor.role})`);
  console.log(`Normalized episodes: ${desiredEpisodes.length} matched${attributionIssues.length ? ` (${attributionIssues.length} excluded for attribution review)` : ""} (${existingEpisodes.length} already present)`);
  console.log(`Normalized material events: ${desiredEvents.length} matched (${events.length - desiredEvents.length} excluded with an episode; ${existingEventKeys.size} already present)`);
  console.log(`Tenancy attribution corrections ready: ${tenancyCorrections.length}`);
  console.log(`Data as at: ${dateOnly(dataAsOf)}`);
  console.log(`Data-quality issues: ${dataQualityIssues.length}`);
  if (!apply) {
    console.log("Dry run complete. No changes made. Statement Lines, Statements, emails and source documents were not imported.");
    return;
  }

  let importRunId = null;
  try {
    const { data: importRun, error: importStartError } = await supabase.from("rental_import_runs").insert({
      building_id: building.id,
      source_reference: basename(workbookPath),
      status: "started",
      created_by_user_id: actor.id,
    }).select("id").single();
    if (importStartError) throw new Error(`Could not start import health record: ${importStartError.message}`);
    importRunId = importRun.id;

    for (const issue of attributionIssues) {
      if (!existingEpisodesByKey.has(issue.source_import_key)) continue;
      const { error: reviewError } = await supabase.from("rental_arrears_episodes").update({
        attribution_status: "review_required",
        attribution_review_reason: issue.issue,
      }).eq("source_import_key", issue.source_import_key);
      if (reviewError) throw new Error(`Could not quarantine ${issue.source_import_key} for attribution review: ${reviewError.message}`);
    }

    const appliedEpisodes = desiredEpisodes.length === 0 ? [] : await (async () => {
      const { data, error } = await supabase
        .from("rental_arrears_episodes")
        .upsert(desiredEpisodes, { onConflict: "source_import_key" })
        .select("id,source_import_key");
      if (error) throw new Error(`Episode import failed: ${error.message}`);
      return data ?? [];
    })();
    const episodeIdByKey = new Map(appliedEpisodes.map((episode) => [episode.source_import_key, episode.id]));
    const newEvents = desiredEvents.filter((event) => !existingEventKeys.has(event.source_import_key)).map((event) => {
      const episodeId = episodeIdByKey.get(event.episode_import_key);
      if (!episodeId) throw new Error(`Could not resolve imported episode ${event.episode_import_key}.`);
      return eventDatabaseRecord(event, episodeId);
    });
    if (newEvents.length > 0) {
      const { error: eventError } = await supabase.from("rental_arrears_events").insert(newEvents);
      if (eventError) throw new Error(`Material event import failed: ${eventError.message}`);
    }

    const completedAt = new Date().toISOString();
    const { error: healthError } = await supabase.from("rental_import_runs").update({
      status: "succeeded",
      completed_at: completedAt,
      data_as_of: dataAsOf,
      episodes_imported: desiredEpisodes.length,
      events_imported: desiredEvents.length,
      error_count: 0,
      errors: [],
      data_quality_issue_count: dataQualityIssues.length,
      data_quality_issues: dataQualityIssues,
    }).eq("id", importRunId);
    if (healthError) throw new Error(`Import health update failed: ${healthError.message}`);

    const { error: auditError } = await supabase.from("audit_events").insert({
      event_type: "rental_arrears_import_succeeded",
      entity_type: "rental_import_run",
      entity_id: importRunId,
      summary: `Imported ${desiredEpisodes.length} tenancy-attributed arrears episodes and ${desiredEvents.length} material events for Trinity Point.`,
      category: "rentals",
      building_id: building.id,
      source: basename(workbookPath),
      metadata: {
        data_as_of: dataAsOf,
        episodes_imported: desiredEpisodes.length,
        events_imported: desiredEvents.length,
        data_quality_issue_count: dataQualityIssues.length,
        attribution_review_count: attributionIssues.length,
        tenancy_correction_count: tenancyCorrections.length,
      },
      created_by_user_id: actor.id,
    });
    if (auditError) throw new Error(`Audit insert failed: ${auditError.message}`);
    console.log(`Apply complete. ${desiredEpisodes.length} tenancy-attributed episodes and ${desiredEvents.length} material events verified; ${tenancyCorrections.length} tenancy attribution correction(s) and ${newEvents.length} newly appended event(s).`);
  } catch (error) {
    if (importRunId) {
      await supabase.from("rental_import_runs").update({
        status: "failed",
        completed_at: new Date().toISOString(),
        error_count: 1,
        errors: [{ message: error instanceof Error ? error.message : String(error) }],
        data_quality_issue_count: dataQualityIssues.length,
        data_quality_issues: dataQualityIssues,
      }).eq("id", importRunId);
    }
    throw error;
  }
}

main().catch((error) => {
  console.error(process.argv.includes("--debug") && error instanceof Error ? error.stack : error instanceof Error ? error.message : error);
  process.exit(1);
});
