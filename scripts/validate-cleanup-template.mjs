import ExcelJS from "exceljs";
import process from "node:process";

const workbookPath = valueArg("--file") ?? "docs/bunnywell-database-cleanup-template-v2.xlsx";
const focusBuilding = valueArg("--building");

const requiredSheets = [
  "Buildings",
  "Unit Types",
  "Unit Type Rooms",
  "Units",
  "Communal Areas",
  "Organisations",
  "Building Organisations",
  "Users Access",
];

const validSaleStatuses = new Set(["for_sale", "reserved", "exchanged", "completed", "handed_over"]);
const validRoles = new Set(["admin", "developer", "developer_representative", "contractor", "resident", "sales_agent", "conveyancer", "user"]);
const validOrganisationTypes = new Set(["developer_representative", "contractor", "supporting_trade", "sales_agent", "conveyancer"]);
const validBuildingOrganisationRoles = new Set(["main_contractor", "developer_representative", "supporting_trade", "sales_agent", "conveyancer"]);
const validBuildingStatuses = new Set(["active", "inactive", "archived"]);
const expectedAdminEmail = "carl.gilbert@gmail.com";

const workbook = new ExcelJS.Workbook();
await workbook.xlsx.readFile(workbookPath);

const data = {};
const errors = [];
const warnings = [];

for (const sheetName of requiredSheets) {
  try {
    data[toKey(sheetName)] = readSheet(workbook, sheetName);
  } catch (error) {
    errors.push(error.message);
    data[toKey(sheetName)] = [];
  }
}

validateData(data, errors, warnings);

const buildingByCode = new Map(data.buildings.map((row) => [clean(row.building_code), row]));
const detailCodes = focusBuilding
  ? data.buildings
    .filter((row) => clean(row.building_name).toLowerCase() === focusBuilding.toLowerCase() || clean(row.building_code).toLowerCase() === focusBuilding.toLowerCase())
    .map((row) => clean(row.building_code))
  : data.buildings.map((row) => clean(row.building_code));

const summary = {
  workbookPath,
  focusBuilding: focusBuilding ?? "all buildings",
  sheets: Object.fromEntries(requiredSheets.map((name) => [name, data[toKey(name)].length])),
  buildings: data.buildings.map((row) => ({
    code: clean(row.building_code),
    name: clean(row.building_name),
    units: data.units.filter((unit) => clean(unit.building_code) === clean(row.building_code)).length,
    communalAreas: data.communalAreas.filter((area) => clean(area.building_code) === clean(row.building_code)).length,
    organisations: data.buildingOrganisations.filter((item) => clean(item.building_code) === clean(row.building_code)).length,
  })),
  buildingDetails: detailCodes.map((code) => ({
    code,
    name: clean(buildingByCode.get(code)?.building_name),
    units: data.units.filter((unit) => clean(unit.building_code) === code).length,
    unitFloors: countBy(data.units.filter((unit) => clean(unit.building_code) === code), "floor"),
    communalAreas: data.communalAreas.filter((area) => clean(area.building_code) === code).length,
    communalAreaFloors: countBy(data.communalAreas.filter((area) => clean(area.building_code) === code), "floor"),
    organisations: data.buildingOrganisations
      .filter((item) => clean(item.building_code) === code)
      .map((item) => clean(item.organisation_name)),
  })),
  usersAccess: {
    total: data.usersAccess.length,
    adminEmails: data.usersAccess.filter((row) => clean(row.role) === "admin").map((row) => clean(row.email).toLowerCase()),
  },
  unitSaleStatuses: countBy(data.units, "sale_status"),
  generatedWorkflowData: {
    reservationRecordsCreatedByImporter: 0,
    handoverRecordsCreatedByImporter: data.units.filter((row) => clean(row.sale_status) === "handed_over").length,
  },
  errors,
  warnings,
};

console.log(JSON.stringify(summary, null, 2));
process.exit(errors.length ? 1 : 0);

function validateData(data, errors, warnings) {
  const buildingCodes = new Set();
  const buildingNames = new Set();
  const unitTypes = new Set();
  const baseSets = new Set();
  const organisations = new Set();
  const units = new Set();
  const unitRooms = new Set();
  const communalAreas = new Set();
  const buildingOrganisations = new Set();
  const userEmails = new Set();

  for (const [index, row] of data.buildings.entries()) {
    const code = clean(row.building_code);
    const name = clean(row.building_name);
    const pcDate = dateOrNull(row.pc_date) || dateOrNull(row.practical_completion_date);
    const pcConfirmed = yesOrDefault(row.pc_confirmed, Boolean(pcDate && pcDate <= todayIso()));
    if (!code) errors.push(`Buildings row ${index + 4}: missing building_code`);
    if (!name) errors.push(`Buildings row ${index + 4}: missing building_name`);
    if (!validBuildingStatuses.has(clean(row.status))) errors.push(`Buildings row ${index + 4}: invalid status ${row.status}`);
    if (pcConfirmed && !pcDate) errors.push(`Buildings row ${index + 4}: pc_confirmed requires pc_date or practical_completion_date`);
    if (pcConfirmed && pcDate > todayIso()) errors.push(`Buildings row ${index + 4}: pc_confirmed cannot be true for a future PC date`);
    if (buildingCodes.has(code)) errors.push(`Duplicate building_code: ${code}`);
    if (buildingNames.has(name.toLowerCase())) warnings.push(`Duplicate building_name: ${name}`);
    buildingCodes.add(code);
    buildingNames.add(name.toLowerCase());
  }

  for (const [index, row] of data.unitTypes.entries()) {
    const unitType = clean(row.unit_type);
    const baseSet = clean(row.base_room_set);
    if (!unitType) errors.push(`Unit Types row ${index + 4}: missing unit_type`);
    if (!baseSet) errors.push(`Unit Types row ${index + 4}: missing base_room_set`);
    if (unitTypes.has(unitType)) errors.push(`Duplicate unit_type: ${unitType}`);
    unitTypes.add(unitType);
    baseSets.add(baseSet);
  }

  for (const [index, row] of data.unitTypeRooms.entries()) {
    const key = `${clean(row.base_room_set)}:${clean(row.room_name).toLowerCase()}`;
    if (!baseSets.has(clean(row.base_room_set))) errors.push(`Unit Type Rooms row ${index + 4}: unknown base_room_set ${row.base_room_set}`);
    if (!clean(row.room_name)) errors.push(`Unit Type Rooms row ${index + 4}: missing room_name`);
    if (unitRooms.has(key)) warnings.push(`Duplicate room in base set: ${key}`);
    unitRooms.add(key);
  }

  for (const [index, row] of data.units.entries()) {
    const ref = `${clean(row.building_code)}:${clean(row.unit_number)}`;
    const building = data.buildings.find((item) => clean(item.building_code) === clean(row.building_code));
    const pcDate = dateOrNull(building?.pc_date) || dateOrNull(building?.practical_completion_date);
    const pcConfirmed = yesOrDefault(building?.pc_confirmed, Boolean(pcDate && pcDate <= todayIso()));
    if (!buildingCodes.has(clean(row.building_code))) errors.push(`Units row ${index + 4}: unknown building_code ${row.building_code}`);
    if (!clean(row.unit_number)) errors.push(`Units row ${index + 4}: missing unit_number`);
    if (!unitTypes.has(clean(row.unit_type))) errors.push(`Units row ${index + 4}: unknown unit_type ${row.unit_type}`);
    if (!validSaleStatuses.has(clean(row.sale_status))) errors.push(`Units row ${index + 4}: invalid sale_status ${row.sale_status}`);
    if (clean(row.sale_status) === "handed_over" && (!pcConfirmed || !pcDate || pcDate > todayIso())) {
      errors.push(`Units row ${index + 4}: handed_over requires building PC to be confirmed with today or past PC date`);
    }
    if (units.has(ref)) errors.push(`Duplicate unit: ${ref}`);
    units.add(ref);
  }

  for (const [index, row] of data.communalAreas.entries()) {
    const key = `${clean(row.building_code)}:${clean(row.floor)}:${clean(row.area_name).toLowerCase()}`;
    if (!buildingCodes.has(clean(row.building_code))) errors.push(`Communal Areas row ${index + 4}: unknown building_code ${row.building_code}`);
    if (!clean(row.area_name)) errors.push(`Communal Areas row ${index + 4}: missing area_name`);
    if (communalAreas.has(key)) warnings.push(`Duplicate communal area name/floor: ${key}`);
    communalAreas.add(key);
  }

  for (const [index, row] of data.organisations.entries()) {
    const name = clean(row.organisation_name);
    const type = clean(row.organisation_type);
    if (!name) errors.push(`Organisations row ${index + 4}: missing organisation_name`);
    if (!validOrganisationTypes.has(type)) errors.push(`Organisations row ${index + 4}: invalid organisation_type ${type}`);
    if (organisations.has(name)) errors.push(`Duplicate organisation_name: ${name}`);
    organisations.add(name);
  }

  for (const [index, row] of data.buildingOrganisations.entries()) {
    const roleOnProject = normalizeBuildingOrganisationRole(row.role_on_project);
    const key = `${clean(row.building_code)}:${clean(row.organisation_name)}:${roleOnProject}`;
    if (!buildingCodes.has(clean(row.building_code))) errors.push(`Building Organisations row ${index + 4}: unknown building_code ${row.building_code}`);
    if (!organisations.has(clean(row.organisation_name))) errors.push(`Building Organisations row ${index + 4}: unknown organisation_name ${row.organisation_name}`);
    if (!validBuildingOrganisationRoles.has(roleOnProject)) errors.push(`Building Organisations row ${index + 4}: invalid role_on_project ${row.role_on_project}`);
    if (buildingOrganisations.has(key)) warnings.push(`Duplicate building organisation link: ${key}`);
    buildingOrganisations.add(key);
  }

  for (const [index, row] of data.usersAccess.entries()) {
    const email = clean(row.email).toLowerCase();
    if (!email) errors.push(`Users Access row ${index + 4}: missing email`);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push(`Users Access row ${index + 4}: invalid email ${row.email}`);
    if (!validRoles.has(clean(row.role))) errors.push(`Users Access row ${index + 4}: invalid role ${row.role}`);
    if (clean(row.organisation_name) && !organisations.has(clean(row.organisation_name))) errors.push(`Users Access row ${index + 4}: unknown organisation_name ${row.organisation_name}`);
    for (const code of splitList(row.building_codes)) {
      if (!buildingCodes.has(code)) errors.push(`Users Access row ${index + 4}: unknown building code in building_codes ${code}`);
    }
    for (const ref of splitList(row.unit_refs)) {
      if (!units.has(ref)) errors.push(`Users Access row ${index + 4}: unknown unit ref in unit_refs ${ref}`);
    }
    if (userEmails.has(email)) warnings.push(`Duplicate user email in Users Access: ${email}`);
    userEmails.add(email);
  }

  if (!userEmails.has(expectedAdminEmail)) {
    warnings.push(`Users Access does not include expected admin ${expectedAdminEmail}; production importer skips users, but dev/staging imports may not recreate this profile.`);
  }

  if (userEmails.has("carl.gilbert@gmaill.com")) {
    warnings.push("Users Access contains carl.gilbert@gmaill.com. The repo env and docs use carl.gilbert@gmail.com.");
  }
}

function readSheet(workbook, name) {
  const sheet = workbook.getWorksheet(name);
  if (!sheet) throw new Error(`Missing sheet: ${name}`);

  const headerValues = sheet.getRow(3).values.slice(1);
  const headers = headerValues.map((value) => clean(cellValue(value))).filter(Boolean);
  if (!headers.length) throw new Error(`Missing header row in sheet: ${name}`);
  assertUniqueHeaders(name, headers);

  const records = [];
  for (let rowNumber = 4; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const record = Object.fromEntries(headers.map((header, index) => [header, normalizeCell(cellValue(row.getCell(index + 1).value))]));
    if (Object.values(record).some((value) => clean(value))) records.push(record);
  }
  return records;
}

function assertUniqueHeaders(sheetName, headers) {
  const seen = new Set();
  const duplicates = [];
  for (const header of headers) {
    const key = header.toLowerCase();
    if (seen.has(key)) duplicates.push(header);
    seen.add(key);
  }
  if (duplicates.length) {
    throw new Error(`Duplicate header(s) in sheet "${sheetName}": ${[...new Set(duplicates)].join(", ")}`);
  }
}

function valueArg(name) {
  const prefix = `${name}=`;
  return process.argv.slice(2).find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
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

function yes(value) {
  return ["yes", "y", "true", "1"].includes(clean(value).toLowerCase());
}

function yesOrDefault(value, fallback) {
  const text = clean(value);
  return text ? yes(text) : fallback;
}

function splitList(value) {
  return clean(value).split(",").map((item) => item.trim()).filter(Boolean);
}

function normalizeBuildingOrganisationRole(value) {
  const role = clean(value);
  if (role === "contractor" || role === "main contractor") return "main_contractor";
  if (role === "developer representative") return "developer_representative";
  if (role === "supporting trade" || role === "trade") return "supporting_trade";
  return role;
}

function dateOrNull(value) {
  const text = clean(value);
  return text ? text.slice(0, 10) : null;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function countBy(rows, field) {
  return Object.fromEntries([...rows.reduce((map, row) => {
    const key = clean(row[field]) || "No floor";
    map.set(key, (map.get(key) ?? 0) + 1);
    return map;
  }, new Map()).entries()].sort());
}

function toKey(sheetName) {
  return sheetName.replace(/\s+([a-z])/gi, (_, letter) => letter.toUpperCase()).replace(/\s/g, "").replace(/^./, (letter) => letter.toLowerCase());
}
