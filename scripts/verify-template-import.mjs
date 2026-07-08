import dotenv from "dotenv";
import ExcelJS from "exceljs";
import { createClient } from "@supabase/supabase-js";
import process from "node:process";

dotenv.config({ path: ".env.local", quiet: true });

const workbookPath = valueArg("--file") ?? "docs/bunnywell-database-cleanup-template-v2.xlsx";
const supabase = createClient(requiredEnv("NEXT_PUBLIC_SUPABASE_URL"), requiredEnv("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { autoRefreshToken: false, persistSession: false },
});

const workbook = new ExcelJS.Workbook();
await workbook.xlsx.readFile(workbookPath);

const expected = expectedCommunalCounts(readSheet(workbook, "Communal Areas"));
const { data: buildings, error: buildingsError } = await supabase.from("buildings").select("id,name");
if (buildingsError) throw buildingsError;

const buildingNameById = new Map(buildings.map((building) => [building.id, building.name]));
const { data: areas, error: areasError } = await supabase
  .from("areas")
  .select("building_id,floor,area_type")
  .is("unit_id", null)
  .eq("area_type", "communal_area");
if (areasError) throw areasError;

const actual = new Map();
for (const area of areas) {
  const key = `${buildingNameById.get(area.building_id) ?? area.building_id} / ${area.floor ?? "No floor"}`;
  actual.set(key, (actual.get(key) ?? 0) + 1);
}

console.log("Communal area counts from workbook:");
for (const [key, count] of [...expected.entries()].sort()) console.log(`- ${key}: ${count}`);

console.log("\nCommunal area counts in database:");
for (const [key, count] of [...actual.entries()].sort()) console.log(`- ${key}: ${count}`);

function expectedCommunalCounts(rows) {
  const counts = new Map();
  for (const row of rows) {
    const key = `${clean(row.building_code)} / ${clean(row.floor) || "No floor"}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function readSheet(workbook, name) {
  const sheet = workbook.getWorksheet(name);
  if (!sheet) throw new Error(`Missing sheet: ${name}`);
  const headers = sheet.getRow(3).values.slice(1).map((value) => clean(cellValue(value))).filter(Boolean);
  const records = [];
  for (let rowNumber = 4; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const record = Object.fromEntries(headers.map((header, index) => [header, normalizeCell(cellValue(row.getCell(index + 1).value))]));
    if (Object.values(record).some((value) => clean(value))) records.push(record);
  }
  return records;
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

function normalizeCell(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return typeof value === "string" ? value.trim() : value;
}

function cellValue(value) {
  if (value && typeof value === "object") {
    if (value.result !== undefined) return value.result;
    if (value.text !== undefined) return value.text;
    if (value.richText) return value.richText.map((part) => part.text).join("");
    if (value.hyperlink && value.text) return value.text;
  }
  return value;
}

function clean(value) {
  return value === null || value === undefined ? "" : String(value).trim();
}
