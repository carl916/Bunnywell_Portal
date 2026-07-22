import crypto from "node:crypto";
import process from "node:process";
import dotenv from "dotenv";
import ExcelJS from "exceljs";
import { createClient } from "@supabase/supabase-js";

dotenv.config({ path: ".env.local", quiet: true });

const args = new Set(process.argv.slice(2));
const applyMode = args.has("--apply");
const checkSchemaMode = args.has("--check-schema");
const updateUnitStatus = !args.has("--skip-unit-status");
const workbookPath = valueArg("--file") ?? "C:/Users/carlg/Downloads/converyanving data.xlsx";
const buildingFilter = clean(valueArg("--building"));
const spreadsheetSource = clean(valueArg("--source")) || "converyanving data.xlsx";

const supabase = createClient(requiredEnv("NEXT_PUBLIC_SUPABASE_URL"), requiredEnv("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  console.log(`Conveyancing workbook: ${workbookPath}`);
  console.log(applyMode ? "Mode: apply changes to Supabase." : "Mode: dry run. Add --apply to write changes.");

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(workbookPath);
  const rows = readWorkbook(workbook);
  if (!rows.length) throw new Error("No conveyancing rows found.");

  const unitIndex = await loadUnitIndex();
  const planned = buildImportPlan(rows, unitIndex);

  printPlan(planned);

  if (checkSchemaMode || applyMode) await checkImportSchema();

  if (!applyMode) {
    console.log("Dry run complete. No database changes were made.");
    return;
  }

  await applyImportPlan(planned);
  console.log("Conveyancing import complete.");
}

function valueArg(name) {
  const prefix = `${name}=`;
  return process.argv.slice(2).find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function readWorkbook(workbook) {
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error("Workbook does not contain any sheets.");

  const headers = [];
  for (let column = 1; column <= sheet.columnCount; column += 1) {
    headers.push(headerKey(cellText(sheet.getRow(1).getCell(column).value)));
  }

  const rows = [];
  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const record = { __rowNumber: rowNumber };
    for (let column = 1; column <= sheet.columnCount; column += 1) {
      const key = headers[column - 1];
      if (key) record[key] = cellValue(row.getCell(column).value);
    }
    if (clean(record.unit_number)) rows.push(record);
  }
  return rows;
}

function headerKey(value) {
  return clean(value)
    .toLowerCase()
    .replace(/%/g, " percent ")
    .replace(/\u00a3/g, " gbp ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function cellValue(value) {
  if (value && typeof value === "object") {
    if (value instanceof Date) return value;
    if (value.result !== undefined) return cellValue(value.result);
    if (value.text !== undefined) return value.text;
    if (value.richText) return value.richText.map((part) => part.text).join("");
    if (value.hyperlink && value.text) return value.text;
  }
  return value;
}

function cellText(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return clean(cellValue(value));
}

async function loadUnitIndex() {
  const { data: buildings, error: buildingsError } = await supabase.from("buildings").select("id,name");
  if (buildingsError) throw buildingsError;

  const buildingById = new Map((buildings ?? []).map((building) => [building.id, building]));
  const buildingIds = buildingFilter
    ? new Set((buildings ?? []).filter((building) => normalizedKey(building.name) === normalizedKey(buildingFilter)).map((building) => building.id))
    : null;

  if (buildingFilter && !buildingIds.size) throw new Error(`No building matched --building=${buildingFilter}`);

  const { data: units, error: unitsError } = await supabase
    .from("units")
    .select("id,building_id,unit_number,sale_status")
    .order("unit_number", { ascending: true });
  if (unitsError) throw unitsError;

  const byUnitNumber = new Map();
  for (const unit of units ?? []) {
    if (buildingIds && !buildingIds.has(unit.building_id)) continue;
    const building = buildingById.get(unit.building_id);
    const key = normalizedUnitNumber(unit.unit_number);
    const existing = byUnitNumber.get(key);
    if (existing) existing.duplicates.push({ ...unit, building_name: building?.name ?? "" });
    else byUnitNumber.set(key, { unit: { ...unit, building_name: building?.name ?? "" }, duplicates: [] });
  }

  return { byUnitNumber };
}

function buildImportPlan(rows, unitIndex) {
  const records = [];
  const unmatchedRows = [];
  const duplicateRows = [];
  const unitStatusUpdates = [];
  const notes = [];
  const warnings = [];

  for (const row of rows) {
    const unitNumber = clean(row.unit_number);
    const match = unitIndex.byUnitNumber.get(normalizedUnitNumber(unitNumber));
    if (!match) {
      unmatchedRows.push({ rowNumber: row.__rowNumber, unitNumber });
      continue;
    }
    if (match.duplicates.length) {
      duplicateRows.push({ rowNumber: row.__rowNumber, unitNumber, matches: [match.unit, ...match.duplicates] });
      continue;
    }

    const unit = match.unit;
    const listPrice = moneyOrNull(row.list_price);
    const incentiveText = clean(row.incentive);
    const contractPrice = extractContractPrice(incentiveText) ?? listPrice;
    const incentive = parseIncentive(incentiveText, contractPrice);
    const parkingSpaces = integerOrNull(row.parking_spaces);
    const parkingCost = moneyOrNull(row.parking_cost_inc_in_price);
    const amountPermitted = moneyOrNull(row.amount_permitted_to_be_released);
    const amountPaidFirst = moneyOrNull(row.amount_paid_from_payment_1);
    const inferredReservationFee = amountPermitted !== null && amountPaidFirst !== null ? Math.max(0, amountPermitted - amountPaidFirst) : null;
    const invoiceReference = clean(row.invoice_ref);
    const status = determineSaleStatus(row);
    const nowIso = new Date().toISOString();

    const saleRecord = stripUndefined({
      building_id: unit.building_id,
      unit_id: unit.id,
      buyer_name: nullableText(row.buyer_name),
      buyer_email: nullableText(row.buyer_email),
      buyer_phone: nullableText(row.buyer_phone),
      reservation_date: dateOrNull(row.reservation_date),
      target_exchange_date: dateOrNull(row.target_exchange_date),
      actual_exchange_date: dateOrNull(row.exchange_date),
      contract_price: contractPrice,
      estimated_list_price: listPrice,
      reservation_fee: inferredReservationFee,
      reservation_fee_holder: inferredReservationFee ? "Sales agent" : null,
      deposit_amount: moneyOrNull(row.deposit),
      incentives_value: sumMoney(incentive.developerContribution, incentive.agentContribution, incentive.otherConcessions),
      parking_value: parkingCost ?? incentive.parkingValue,
      other_concessions_value: incentive.otherConcessions,
      sales_agent: "Queensbridge",
      buyer_solicitor: nullableText(row.solicitor),
      developer_solicitor: "Herrington Carmichael",
      key_risks: incentive.warnings.length ? incentive.warnings.join("; ") : null,
      spreadsheet_source: spreadsheetSource,
      source_row_number: row.__rowNumber,
      expected_exchange_label: nullableText(row.expected_exchange_date),
      parking_spaces_count: parkingSpaces,
      parking_allocation: buildParkingAllocation(parkingSpaces, parkingCost, incentiveText),
      agent_fee_percent: percentOrNull(row.agent_fee_percent),
      agent_fee_amount: moneyOrNull(row.agent_fee_gbp),
      agent_gross_invoice_amount: moneyOrNull(row.gross_invoice_amount),
      agent_invoice_reference: invoiceReference || null,
      agent_invoice_date: dateOrNull(row.invoice_date),
      agent_invoice_status: invoiceReference ? "recorded" : "not_uploaded",
      amount_permitted_to_release: amountPermitted,
      amount_paid_from_first_payment: amountPaidFirst,
      first_payment_made_at: dateOrNull(row.date_first_payment_made),
      invoice_shortfall_amount: moneyOrNull(row.invoice_shortfall),
      invoice_shortfall_paid_at: dateOrNull(row.date_final_payment_made),
      developer_contribution_value: incentive.developerContribution,
      agent_contribution_value: incentive.agentContribution,
      completion_funds_adjustment: incentive.developerContribution,
      agent_invoice_deduction_value: incentive.agentContribution,
      incentive_summary: incentiveText || null,
      imported_at: nowIso,
    });

    records.push({ rowNumber: row.__rowNumber, unitNumber, unit, saleRecord, status });
    if (updateUnitStatus) {
      const nextStatus = nextUnitStatus(unit.sale_status, status);
      if (nextStatus !== unit.sale_status) unitStatusUpdates.push({ unitId: unit.id, unitNumber, from: unit.sale_status, to: nextStatus });
    }

    notes.push(...noteRows(row, unit, unitNumber, incentiveText));
    warnings.push(...incentive.warnings.map((warning) => ({ rowNumber: row.__rowNumber, unitNumber, warning })));
  }

  return { rows, records, notes, unmatchedRows, duplicateRows, unitStatusUpdates, warnings };
}

function noteRows(row, unit, unitNumber, incentiveText) {
  const items = [];
  const sources = [
    { label: "Incentive", category: "financial", text: incentiveText },
    { label: "Queensbridge", category: "solicitor_update", text: row.queensbridge_notes },
    { label: "Herrington", category: "solicitor_update", text: row.herrington_notes },
  ];

  for (const source of sources) {
    for (const [index, body] of splitNotes(source.text).entries()) {
      const keySource = `${spreadsheetSource}:${unitNumber}:${row.__rowNumber}:${source.label}:${index}:${body}`;
      items.push({
        building_id: unit.building_id,
        unit_id: unit.id,
        category: source.category,
        body,
        visibility: "admin_developer",
        source_label: source.label,
        source_row_number: row.__rowNumber,
        source_import_key: `conveyancing-xlsx:${hash(keySource)}`,
      });
    }
  }

  return items;
}

function splitNotes(value) {
  const text = clean(value);
  if (!text || text.toLowerCase() === "none") return [];

  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\s+(?=\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\s*[-\u2013])/g, "\n")
    .replace(/\s+(?=Requested update\b)/gi, "\n")
    .split(/\n+|(?:\s+-\s+(?=[A-Z]))/g)
    .map((item) => item.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function parseIncentive(value, contractPrice) {
  const text = clean(value);
  if (!text || text.toLowerCase() === "none") {
    return { developerContribution: null, agentContribution: null, parkingValue: null, otherConcessions: null, warnings: [] };
  }

  const result = { developerContribution: 0, agentContribution: 0, parkingValue: 0, otherConcessions: 0, warnings: [] };
  const contractBase = contractPrice ?? 0;
  const percentMatches = [...text.matchAll(/(\d+(?:\.\d+)?)\s*%/g)];

  for (const [index, match] of percentMatches.entries()) {
    if (!contractBase) {
      result.warnings.push(`Could not value ${match[0]} incentive without a contract price.`);
      continue;
    }
    const nextIndex = percentMatches[index + 1]?.index ?? nextSentenceBreak(text, match.index ?? 0);
    const context = text.slice(match.index ?? 0, nextIndex);
    assignIncentiveValue(result, context, (Number(match[1]) / 100) * contractBase, { preferContributor: true });
  }

  const moneyMatches = [...text.matchAll(/\u00a3\s*([\d,]+(?:\.\d+)?)(k)?/gi)];
  const labelledMoneyTotal = moneyMatches.reduce((total, match) => {
    const context = moneyContext(text, match, moneyMatches);
    if (/\b(agent|agency|qb|queensbridge|developer|developers)\b/i.test(context)) return total + moneyMatchValue(match);
    return total;
  }, 0);
  const unlabelledMoneyTotal = moneyMatches.reduce((total, match) => {
    const context = moneyContext(text, match, moneyMatches);
    if (/\b(agent|agency|qb|queensbridge|developer|developers)\b/i.test(context)) return total;
    if (/contract\s+(?:purchase\s+)?price/i.test(context)) return total;
    return total + moneyMatchValue(match);
  }, 0);
  const hasComponentBreakdown = labelledMoneyTotal > 0 && Math.abs(labelledMoneyTotal - unlabelledMoneyTotal) < 0.01;

  for (const match of moneyMatches) {
    const context = moneyContext(text, match, moneyMatches);
    if (/contract\s+(?:purchase\s+)?price/i.test(context)) continue;
    if (hasComponentBreakdown && !/\b(agent|agency|qb|queensbridge|developer|developers)\b/i.test(context)) continue;

    const valueNumber = moneyMatchValue(match);
    if (Number.isFinite(valueNumber)) assignIncentiveValue(result, context, valueNumber);
  }

  if (!result.developerContribution && !result.agentContribution && !result.parkingValue && !result.otherConcessions) {
    result.warnings.push("Incentive text needs manual classification.");
  }

  return {
    developerContribution: zeroToNull(result.developerContribution),
    agentContribution: zeroToNull(result.agentContribution),
    parkingValue: zeroToNull(result.parkingValue),
    otherConcessions: zeroToNull(result.otherConcessions),
    warnings: result.warnings,
  };
}

function assignIncentiveValue(result, clause, value, options = {}) {
  if (!Number.isFinite(value) || value <= 0) return;
  if (options.preferContributor && /\b(agent|agency|qb|queensbridge|invoice|deducted)\b/i.test(clause)) {
    result.agentContribution += value;
  } else if (options.preferContributor && /\b(developer|developers|completion|cashback|stamp duty)\b/i.test(clause)) {
    result.developerContribution += value;
  } else if (options.preferContributor && /parking/i.test(clause)) {
    result.parkingValue += value;
  } else if (/parking/i.test(clause)) {
    result.parkingValue += value;
  } else if (/\b(agent|agency|qb|queensbridge|invoice|deducted)\b/i.test(clause)) {
    result.agentContribution += value;
  } else if (/\b(developer|developers|completion|cashback|stamp duty)\b/i.test(clause)) {
    result.developerContribution += value;
  } else {
    result.otherConcessions += value;
  }
}

function nextSentenceBreak(text, start) {
  const rest = text.slice(start);
  const match = rest.match(/[.]\s+/);
  return match?.index === undefined ? text.length : start + match.index;
}

function moneyContext(text, match, matches) {
  const currentIndex = match.index ?? 0;
  const currentMatchIndex = matches.indexOf(match);
  const nextIndex = matches[currentMatchIndex + 1]?.index ?? text.length;
  const sentenceEnd = nextSentenceBreak(text, currentIndex);
  const end = Math.min(nextIndex, sentenceEnd === currentIndex ? text.length : sentenceEnd);
  const start = Math.max(0, currentIndex - 55);
  return text.slice(start, end);
}

function moneyMatchValue(match) {
  return Number(match[1].replace(/,/g, "")) * (match[2] ? 1000 : 1);
}

function extractContractPrice(value) {
  const match = clean(value).match(/contract\s+(?:purchase\s+)?price\s+(?:is\s+)?\u00a3?\s*([\d,]+(?:\.\d+)?)(k)?/i);
  if (!match) return null;
  const parsed = Number(match[1].replace(/,/g, "")) * (match[2] ? 1000 : 1);
  return Number.isFinite(parsed) ? parsed : null;
}

function determineSaleStatus(row) {
  if (dateOrNull(row.exchange_date)) return "exchanged";
  if (dateOrNull(row.reservation_date) || clean(row.buyer_name)) return "reserved";
  return "for_sale";
}

function nextUnitStatus(current, imported) {
  const rank = { for_sale: 1, reserved: 2, exchanged: 3, completed: 4, handed_over: 5 };
  if ((rank[current] ?? 0) >= 4) return current;
  return (rank[imported] ?? 0) > (rank[current] ?? 0) ? imported : current;
}

function buildParkingAllocation(spaces, cost, incentiveText) {
  const parts = [];
  if (spaces !== null) parts.push(`${spaces} space${spaces === 1 ? "" : "s"}`);
  if (cost !== null) parts.push(`parking cost included: ${cost}`);
  if (/parking/i.test(clean(incentiveText))) parts.push(clean(incentiveText));
  return parts.length ? parts.join(" | ") : null;
}

async function applyImportPlan(plan) {
  const saleRecordIdByUnitId = new Map();

  for (const item of plan.records) {
    const { data, error } = await supabase
      .from("unit_sale_records")
      .upsert(item.saleRecord, { onConflict: "unit_id" })
      .select("id,unit_id")
      .single();
    if (error) throw new Error(`Unit ${item.unitNumber}: ${error.message}`);
    saleRecordIdByUnitId.set(data.unit_id, data.id);
  }

  for (const update of plan.unitStatusUpdates) {
    const { error } = await supabase.from("units").update({ sale_status: update.to }).eq("id", update.unitId);
    if (error) throw new Error(`Unit ${update.unitNumber} status update failed: ${error.message}`);
  }

  const notePayloads = plan.notes
    .map((note) => ({ ...note, sale_record_id: saleRecordIdByUnitId.get(note.unit_id) }))
    .filter((note) => note.sale_record_id);

  for (const chunk of chunks(notePayloads, 100)) {
    const { error } = await supabase.from("unit_sale_notes").upsert(chunk, { onConflict: "source_import_key" });
    if (error) throw new Error(`Note import failed: ${error.message}`);
  }
}

async function checkImportSchema() {
  const saleRecordColumns = [
    "id",
    "spreadsheet_source",
    "agent_fee_percent",
    "agent_gross_invoice_amount",
    "amount_permitted_to_release",
    "developer_contribution_value",
    "agent_invoice_deduction_value",
    "reservation_fee_holder",
  ].join(",");
  const noteColumns = ["id", "source_label", "source_row_number", "source_import_key"].join(",");

  const saleRecordCheck = await supabase.from("unit_sale_records").select(saleRecordColumns).limit(1);
  if (saleRecordCheck.error) {
    throw new Error(`Import schema is not ready for unit_sale_records: ${saleRecordCheck.error.message}`);
  }

  const noteCheck = await supabase.from("unit_sale_notes").select(noteColumns).limit(1);
  if (noteCheck.error) {
    throw new Error(`Import schema is not ready for unit_sale_notes: ${noteCheck.error.message}`);
  }

  console.log("Import schema check passed.");
}

function printPlan(plan) {
  const statuses = countBy(plan.records, (item) => item.status);
  const noteSources = countBy(plan.notes, (note) => note.source_label);
  const invoiceRefs = plan.records.filter((item) => item.saleRecord.agent_invoice_reference).length;

  console.log(`Workbook rows: ${plan.rows.length}`);
  console.log(`Matched units: ${plan.records.length}`);
  console.log(`Unmatched units: ${plan.unmatchedRows.length}`);
  console.log(`Duplicate unit matches skipped: ${plan.duplicateRows.length}`);
  console.log(`Sale statuses from workbook: ${JSON.stringify(statuses)}`);
  console.log(`Invoice references: ${invoiceRefs}`);
  console.log(`Exploded notes: ${plan.notes.length} ${JSON.stringify(noteSources)}`);
  console.log(`Unit status updates planned: ${plan.unitStatusUpdates.length}`);
  console.log(`Incentive warnings: ${plan.warnings.length}`);

  for (const row of plan.unmatchedRows.slice(0, 10)) console.log(`Unmatched row ${row.rowNumber}: ${row.unitNumber}`);
  for (const row of plan.duplicateRows.slice(0, 5)) console.log(`Duplicate row ${row.rowNumber}: ${row.unitNumber}`);
  for (const warning of plan.warnings.slice(0, 10)) console.log(`Warning row ${warning.rowNumber} unit ${warning.unitNumber}: ${warning.warning}`);

  const samples = plan.records.slice(0, 3).map((item) => ({
    unit: item.unitNumber,
    contract_price: item.saleRecord.contract_price,
    agent_fee_percent: item.saleRecord.agent_fee_percent,
    agent_fee_amount: item.saleRecord.agent_fee_amount,
    developer_contribution_value: item.saleRecord.developer_contribution_value,
    agent_contribution_value: item.saleRecord.agent_contribution_value,
    parking_value: item.saleRecord.parking_value,
    invoice_shortfall_amount: item.saleRecord.invoice_shortfall_amount,
  }));
  console.log(`Sample mapped records: ${JSON.stringify(samples, null, 2)}`);
}

function countBy(items, keyFn) {
  return items.reduce((counts, item) => {
    const key = keyFn(item) ?? "unknown";
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
}

function chunks(items, size) {
  const result = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

function nullableText(value) {
  const text = clean(value);
  return text ? text : null;
}

function clean(value) {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).trim();
}

function moneyOrNull(value) {
  if (value === null || value === undefined || clean(value) === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const text = clean(value).replace(/,/g, "");
  const match = text.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0]) * (/k\b/i.test(text) ? 1000 : 1);
  return Number.isFinite(parsed) ? parsed : null;
}

function percentOrNull(value) {
  const parsed = moneyOrNull(value);
  if (parsed === null) return null;
  return parsed > 0 && parsed <= 1 ? parsed * 100 : parsed;
}

function integerOrNull(value) {
  const parsed = moneyOrNull(value);
  return parsed === null ? null : Math.trunc(parsed);
}

function dateOrNull(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  if (typeof value === "number" && Number.isFinite(value)) {
    const date = new Date(Math.round((value - 25569) * 86400 * 1000));
    return date.toISOString().slice(0, 10);
  }

  const text = clean(value);
  if (!text) return null;
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const slash = text.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
  if (slash) {
    const day = slash[1].padStart(2, "0");
    const month = slash[2].padStart(2, "0");
    let year = slash[3] ?? "2026";
    if (year.length === 2) year = `20${year}`;
    return `${year}-${month}-${day}`;
  }

  return null;
}

function normalizedUnitNumber(value) {
  return normalizedKey(value).replace(/^UNIT/, "");
}

function normalizedKey(value) {
  return clean(value).toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function zeroToNull(value) {
  return value ? roundMoney(value) : null;
}

function sumMoney(...values) {
  const total = values.reduce((sum, value) => sum + (value ?? 0), 0);
  return total ? roundMoney(total) : null;
}

function roundMoney(value) {
  return Math.round(value * 100) / 100;
}

function stripUndefined(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

function hash(value) {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 32);
}

main().catch((error) => {
  console.error("Conveyancing import failed.");
  console.error(error);
  process.exit(1);
});
