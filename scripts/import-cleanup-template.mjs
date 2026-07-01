import dotenv from "dotenv";
import ExcelJS from "exceljs";
import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";
import process from "node:process";

dotenv.config({ path: ".env.local", quiet: true });

const args = new Set(process.argv.slice(2));
const prodMode = args.has("--prod");
const workbookPath = valueArg("--file") ?? "docs/bunnywell-database-cleanup-template-v2.xlsx";

const supabase = createClient(requiredEnv("NEXT_PUBLIC_SUPABASE_URL"), requiredEnv("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { autoRefreshToken: false, persistSession: false },
});

const validSaleStatuses = new Set(["for_sale", "reserved", "exchanged", "completed", "handed_over"]);
const validRoles = new Set(["admin", "developer", "developer_representative", "contractor", "resident", "user"]);
const generatedPasswords = [];

async function main() {
  console.log(`Importing ${workbookPath}`);
  console.log(prodMode ? "Mode: production-safe, user changes skipped." : "Mode: dev/staging, users may be created or updated.");

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(workbookPath);
  const data = readWorkbook(workbook);
  validateData(data);

  const buildingByCode = await importBuildings(data.buildings);
  await importBuildingFloors(data.units, data.communalAreas, buildingByCode);
  const unitTypeByName = await importUnitTypes(data.unitTypes, data.unitTypeRooms);
  const unitByRef = await importUnits(data.units, buildingByCode, unitTypeByName);
  await importUnitRooms(data.units, data.unitTypes, data.unitTypeRooms, buildingByCode, unitByRef);
  const communalSummary = await importCommunalAreas(data.communalAreas, buildingByCode);
  const organisationByName = await importOrganisations(data.organisations);
  await importBuildingOrganisations(data.buildingOrganisations, buildingByCode, organisationByName);

  if (!prodMode) {
    await importUsers(data.usersAccess, buildingByCode, unitByRef, organisationByName);
  }

  console.log("Import complete.");
  console.log(`Buildings: ${data.buildings.length}`);
  console.log(`Units: ${data.units.length}`);
  console.log(`Communal areas: ${data.communalAreas.length}`);
  for (const [key, count] of communalSummary.entries()) console.log(`- ${key}: ${count} communal areas`);
  console.log(`Organisations: ${data.organisations.length}`);
  if (prodMode) console.log("Users: skipped in production-safe mode.");
  if (generatedPasswords.length) {
    console.log("Generated user passwords:");
    for (const item of generatedPasswords) console.log(`- ${item.email}: ${item.password}`);
  }
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
  return {
    buildings: readSheet(workbook, "Buildings"),
    unitTypes: readSheet(workbook, "Unit Types"),
    unitTypeRooms: readSheet(workbook, "Unit Type Rooms"),
    units: readSheet(workbook, "Units"),
    communalAreas: readSheet(workbook, "Communal Areas"),
    organisations: readSheet(workbook, "Organisations"),
    buildingOrganisations: readSheet(workbook, "Building Organisations"),
    usersAccess: readSheet(workbook, "Users Access"),
  };
}

function readSheet(workbook, name) {
  const sheet = workbook.getWorksheet(name);
  if (!sheet) throw new Error(`Missing sheet: ${name}`);

  const headerValues = sheet.getRow(3).values.slice(1);
  const headers = headerValues.map((value) => clean(cellValue(value))).filter(Boolean);
  if (!headers?.length) throw new Error(`Missing header row in sheet: ${name}`);

  const records = [];
  for (let rowNumber = 4; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const record = Object.fromEntries(headers.map((header, index) => [header, normalizeCell(cellValue(row.getCell(index + 1).value))]));
    if (Object.values(record).some((value) => clean(value))) records.push(record);
  }

  return records;
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

function validateData(data) {
  const errors = [];
  const buildingCodes = new Set();
  const unitTypes = new Set();
  const baseSets = new Set();
  const organisations = new Set();
  const units = new Set();

  for (const [index, row] of data.buildings.entries()) {
    if (!clean(row.building_code)) errors.push(`Buildings row ${index + 4}: missing building_code`);
    if (!clean(row.building_name)) errors.push(`Buildings row ${index + 4}: missing building_name`);
    if (!["active", "inactive", "archived"].includes(clean(row.status))) errors.push(`Buildings row ${index + 4}: invalid status`);
    if (buildingCodes.has(clean(row.building_code))) errors.push(`Duplicate building_code: ${row.building_code}`);
    buildingCodes.add(clean(row.building_code));
  }

  for (const [index, row] of data.unitTypes.entries()) {
    const unitType = clean(row.unit_type);
    const baseSet = clean(row.base_room_set);
    if (!unitType) errors.push(`Unit Types row ${index + 4}: missing unit_type`);
    if (!baseSet) errors.push(`Unit Types row ${index + 4}: missing base_room_set`);
    unitTypes.add(unitType);
    baseSets.add(baseSet);
  }

  for (const [index, row] of data.unitTypeRooms.entries()) {
    if (!baseSets.has(clean(row.base_room_set))) errors.push(`Unit Type Rooms row ${index + 4}: unknown base_room_set`);
    if (!clean(row.room_name)) errors.push(`Unit Type Rooms row ${index + 4}: missing room_name`);
  }

  for (const [index, row] of data.units.entries()) {
    const ref = `${clean(row.building_code)}:${clean(row.unit_number)}`;
    if (!buildingCodes.has(clean(row.building_code))) errors.push(`Units row ${index + 4}: unknown building_code`);
    if (!clean(row.unit_number)) errors.push(`Units row ${index + 4}: missing unit_number`);
    if (!unitTypes.has(clean(row.unit_type))) errors.push(`Units row ${index + 4}: unknown unit_type ${row.unit_type}`);
    if (!validSaleStatuses.has(clean(row.sale_status))) errors.push(`Units row ${index + 4}: invalid sale_status ${row.sale_status}`);
    if (units.has(ref)) errors.push(`Duplicate unit: ${ref}`);
    units.add(ref);
  }

  for (const [index, row] of data.communalAreas.entries()) {
    if (!buildingCodes.has(clean(row.building_code))) errors.push(`Communal Areas row ${index + 4}: unknown building_code`);
    if (!clean(row.area_name)) errors.push(`Communal Areas row ${index + 4}: missing area_name`);
  }

  for (const [index, row] of data.organisations.entries()) {
    if (!clean(row.organisation_name)) errors.push(`Organisations row ${index + 4}: missing organisation_name`);
    if (!["developer_representative", "contractor"].includes(clean(row.organisation_type))) errors.push(`Organisations row ${index + 4}: invalid organisation_type`);
    organisations.add(clean(row.organisation_name));
  }

  for (const [index, row] of data.buildingOrganisations.entries()) {
    if (!buildingCodes.has(clean(row.building_code))) errors.push(`Building Organisations row ${index + 4}: unknown building_code`);
    if (!organisations.has(clean(row.organisation_name))) errors.push(`Building Organisations row ${index + 4}: unknown organisation_name`);
  }

  for (const [index, row] of data.usersAccess.entries()) {
    if (!clean(row.email)) errors.push(`Users Access row ${index + 4}: missing email`);
    if (!validRoles.has(clean(row.role))) errors.push(`Users Access row ${index + 4}: invalid role`);
    if (clean(row.organisation_name) && !organisations.has(clean(row.organisation_name))) errors.push(`Users Access row ${index + 4}: unknown organisation_name`);
  }

  if (errors.length) throw new Error(`Workbook validation failed:\n${errors.join("\n")}`);
}

async function importBuildings(rows) {
  const result = new Map();
  for (const row of rows) {
    const pcDate = dateOrNull(row.pc_date) || dateOrNull(row.practical_completion_date);
    const pcConfirmed = yesOrDefault(row.pc_confirmed, false);
    const payload = {
      name: clean(row.building_name),
      address_line_1: clean(row.address_line_1) || null,
      address_line_2: clean(row.address_line_2) || null,
      town: clean(row.town) || null,
      postcode: clean(row.postcode) || null,
      status: clean(row.status),
      allow_resident_access_requests: yesOrDefault(row.allow_resident_access_requests, true),
      pc_date: pcDate,
      pc_confirmed: pcConfirmed,
      practical_completion_date: pcDate,
      defects_liability_end_date: pcConfirmed && pcDate ? addYears(pcDate, 1) : null,
      notes: clean(row.notes) || null,
    };

    const existing = await findFirst("buildings", "name", payload.name);
    const building = existing ? await updateAndReturn("buildings", existing.id, payload) : await insertAndReturn("buildings", payload);
    result.set(clean(row.building_code), building);
  }
  return result;
}

async function importBuildingFloors(units, communalAreas, buildingByCode) {
  const floorsByBuilding = new Map();

  for (const row of [...units, ...communalAreas]) {
    const buildingCode = clean(row.building_code);
    const floor = clean(row.floor);
    if (!buildingCode || !floor) continue;
    if (!floorsByBuilding.has(buildingCode)) floorsByBuilding.set(buildingCode, new Set());
    floorsByBuilding.get(buildingCode).add(floor);
  }

  for (const [buildingCode, floors] of floorsByBuilding.entries()) {
    const building = buildingByCode.get(buildingCode);
    if (!building) continue;

    for (const [index, floor] of [...floors].sort(compareFloors).entries()) {
      const { error } = await supabase.from("building_floors").upsert({
        building_id: building.id,
        name: floor,
        sort_order: (index + 1) * 10,
      }, { onConflict: "building_id,name" });
      if (error) throw error;
    }
  }
}

async function importUnitTypes(unitTypes, unitTypeRooms) {
  const result = new Map();
  for (const row of unitTypes) {
    const { data, error } = await supabase.from("unit_types").upsert({
      name: clean(row.unit_type),
      description: clean(row.description) || null,
    }, { onConflict: "name" }).select("*").single();
    if (error) throw error;
    result.set(clean(row.unit_type), data);
  }

  for (const row of unitTypeRooms) {
    const matchingTypes = unitTypes.filter((type) => clean(type.base_room_set) === clean(row.base_room_set));
    for (const type of matchingTypes) {
      const unitType = result.get(clean(type.unit_type));
      const { error } = await supabase.from("unit_type_areas").upsert({
        unit_type_id: unitType.id,
        name: clean(row.room_name),
        sort_order: numberOrDefault(row.sort_order, 0),
        optional: !yes(row.default_for_all_units),
      }, { onConflict: "unit_type_id,name" });
      if (error) throw error;
    }
  }
  return result;
}

async function importUnits(units, buildingByCode, unitTypeByName) {
  const result = new Map();
  for (const row of units) {
    const building = buildingByCode.get(clean(row.building_code));
    const unitType = unitTypeByName.get(clean(row.unit_type));
    const requestedStatus = clean(row.sale_status);
    const insertStatus = requestedStatus === "handed_over" ? "completed" : requestedStatus;

    const { data, error } = await supabase.from("units").upsert({
      building_id: building.id,
      unit_number: clean(row.unit_number),
      floor: clean(row.floor) || null,
      unit_type: clean(row.unit_type),
      unit_type_id: unitType.id,
      size_sqm: numberOrNull(row.size_sqm),
      sale_status: insertStatus,
      completion_date: dateOrNull(row.completion_date),
      handover_date: null,
      parking_bays: intArrayOrNull(row.parking_bays),
      notes: clean(row.notes) || null,
    }, { onConflict: "building_id,unit_number" }).select("*").single();
    if (error) throw error;

    result.set(`${clean(row.building_code)}:${clean(row.unit_number)}`, data);

    if (requestedStatus === "handed_over") {
      await ensureHandover(data.id, row);
    }
  }
  return result;
}

async function ensureHandover(unitId, row) {
  const existing = await supabase.from("handovers").select("id").eq("unit_id", unitId).maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) return;

  const { error } = await supabase.from("handovers").insert({
    unit_id: unitId,
    recipient_name: "Imported handover",
    recipient_email: null,
    recipient_capacity: "Imported",
    recipient_relationship: "Imported",
    number_of_keys: 0,
    handover_date: dateOrNull(row.handover_date) ?? dateOrNull(row.completion_date) ?? new Date().toISOString().slice(0, 10),
    handover_datetime: `${dateOrNull(row.handover_date) ?? dateOrNull(row.completion_date) ?? new Date().toISOString().slice(0, 10)}T12:00:00.000Z`,
    declaration_accepted: true,
    notes: "Created by cleanup template import.",
  });
  if (error) throw error;
}

async function importUnitRooms(units, unitTypes, unitTypeRooms, buildingByCode, unitByRef) {
  const typeToBase = new Map(unitTypes.map((row) => [clean(row.unit_type), clean(row.base_room_set)]));
  const roomsByBase = new Map();
  for (const room of unitTypeRooms) {
    const base = clean(room.base_room_set);
    if (!roomsByBase.has(base)) roomsByBase.set(base, []);
    roomsByBase.get(base).push(room);
  }

  for (const row of units) {
    const building = buildingByCode.get(clean(row.building_code));
    const unit = unitByRef.get(`${clean(row.building_code)}:${clean(row.unit_number)}`);
    const base = typeToBase.get(clean(row.unit_type));
    const rooms = [...(roomsByBase.get(base) ?? [])]
      .map((room) => ({ name: clean(room.room_name), sort: numberOrDefault(room.sort_order, 0), type: "unit_room" }));

    if (yes(row.has_ensuite)) rooms.push({ name: "Ensuite", sort: 70, type: "unit_room" });
    if (yes(row.has_private_amenity)) rooms.push({ name: clean(row.private_amenity_name) || "Private Amenity", sort: 80, type: "private_amenity" });
    if (yes(row.has_mep_store)) rooms.push({ name: "MEP Store", sort: 90, type: "unit_room" });

    for (const room of rooms) {
      const existing = await supabase.from("areas").select("id").eq("unit_id", unit.id).eq("name", room.name).maybeSingle();
      if (existing.error) throw existing.error;

      const payload = {
        building_id: building.id,
        unit_id: unit.id,
        area_type: room.type,
        name: room.name,
        floor: clean(row.floor) || null,
        sort_order: room.sort,
      };

      const query = existing.data
        ? supabase.from("areas").update(payload).eq("id", existing.data.id)
        : supabase.from("areas").insert(payload);
      const { error } = await query;
      if (error) throw error;
    }
  }
}

async function importCommunalAreas(rows, buildingByCode) {
  const summary = new Map();

  for (const row of rows) {
    const building = buildingByCode.get(clean(row.building_code));
    const floor = clean(row.floor) || null;
    const name = clean(row.area_name);
    const key = `${clean(row.building_code)} / ${floor ?? "No floor"}`;

    let query = supabase
      .from("areas")
      .select("id")
      .eq("building_id", building.id)
      .is("unit_id", null)
      .eq("name", name);

    query = floor ? query.eq("floor", floor) : query.is("floor", null);

    const existing = await query.limit(1).maybeSingle();
    if (existing.error) throw existing.error;

    const payload = {
      building_id: building.id,
      unit_id: null,
      area_type: "communal_area",
      name,
      floor,
      sort_order: numberOrDefault(row.sort_order, 0),
    };

    const writeQuery = existing.data
      ? supabase.from("areas").update(payload).eq("id", existing.data.id)
      : supabase.from("areas").insert(payload);
    const { error } = await writeQuery;
    if (error) throw error;
    summary.set(key, (summary.get(key) ?? 0) + 1);
  }

  return summary;
}

async function importOrganisations(rows) {
  const result = new Map();
  for (const row of rows) {
    const payload = {
      name: clean(row.organisation_name),
      type: clean(row.organisation_type),
      main_contact_name: clean(row.main_contact_name) || null,
      email: clean(row.email) || null,
      phone: clean(row.phone) || null,
      notes: clean(row.notes) || null,
    };

    const existing = await findFirst("organisations", "name", payload.name);
    const organisation = existing ? await updateAndReturn("organisations", existing.id, payload) : await insertAndReturn("organisations", payload);
    result.set(clean(row.organisation_name), organisation);
  }
  return result;
}

async function importBuildingOrganisations(rows, buildingByCode, organisationByName) {
  for (const row of rows) {
    const building = buildingByCode.get(clean(row.building_code));
    const organisation = organisationByName.get(clean(row.organisation_name));
    const { error } = await supabase.from("building_organisations").upsert({
      building_id: building.id,
      organisation_id: organisation.id,
      role_on_project: clean(row.role_on_project),
    }, { onConflict: "building_id,organisation_id,role_on_project" });
    if (error) throw error;
  }
}

async function importUsers(rows, buildingByCode, unitByRef, organisationByName) {
  for (const row of rows) {
    const email = clean(row.email).toLowerCase();
    const authUser = await upsertAuthUser(row);
    const organisation = clean(row.organisation_name) ? organisationByName.get(clean(row.organisation_name)) : null;

    await upsert("profiles", {
      id: authUser.id,
      email,
      full_name: clean(row.name) || email,
      name: clean(row.name) || email,
      role: clean(row.role),
      resident_type: clean(row.resident_type) || null,
      organisation_id: organisation?.id ?? null,
      active: true,
    }, "id");

    for (const code of splitList(row.building_codes)) {
      const building = buildingByCode.get(code);
      if (!building) continue;
      await upsert("user_building_access", {
        user_id: authUser.id,
        building_id: building.id,
        role_on_building: clean(row.role),
      }, "user_id,building_id");
    }

    for (const ref of splitList(row.unit_refs)) {
      const unit = unitByRef.get(ref);
      if (!unit) continue;
      await upsert("user_unit_access", {
        user_id: authUser.id,
        unit_id: unit.id,
        access_type: clean(row.resident_type) || "leaseholder",
      }, "user_id,unit_id,access_type");
    }
  }
}

async function upsertAuthUser(row) {
  const email = clean(row.email).toLowerCase();
  const existing = await findAuthUserByEmail(email);
  const password = passwordForEmail(email);
  const payload = {
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: clean(row.name) || email },
  };

  const result = existing
    ? await supabase.auth.admin.updateUserById(existing.id, payload)
    : await supabase.auth.admin.createUser(payload);
  if (result.error) throw result.error;

  if (!existing && !knownPasswordFromEnv(email)) generatedPasswords.push({ email, password });
  return result.data.user;
}

async function findAuthUserByEmail(email) {
  let page = 1;
  const perPage = 100;
  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const found = data.users.find((user) => user.email?.toLowerCase() === email);
    if (found) return found;
    if (data.users.length < perPage) return null;
    page += 1;
  }
}

function passwordForEmail(email) {
  const known = knownPasswordFromEnv(email);
  if (known) return known;
  if (process.env.IMPORT_DEFAULT_USER_PASSWORD) return process.env.IMPORT_DEFAULT_USER_PASSWORD;
  return `Bunnywell-${crypto.randomBytes(9).toString("base64url")}!`;
}

function knownPasswordFromEnv(email) {
  const mappings = [
    ["PLAYWRIGHT_ADMIN_EMAIL", "PLAYWRIGHT_ADMIN_PASSWORD"],
    ["PLAYWRIGHT_CONTRACTOR_EMAIL", "PLAYWRIGHT_CONTRACTOR_PASSWORD"],
    ["PLAYWRIGHT_RESIDENT_EMAIL", "PLAYWRIGHT_RESIDENT_PASSWORD"],
  ];
  for (const [emailKey, passwordKey] of mappings) {
    if (process.env[emailKey]?.toLowerCase() === email) return process.env[passwordKey];
  }
  return "";
}

async function upsert(table, values, onConflict) {
  const { error } = await supabase.from(table).upsert(values, { onConflict });
  if (error) throw error;
}

async function findFirst(table, column, value) {
  const { data, error } = await supabase
    .from(table)
    .select("*")
    .eq(column, value)
    .order("created_at", { ascending: true })
    .limit(1);
  if (error) throw error;
  return data[0] ?? null;
}

async function insertAndReturn(table, values) {
  const { data, error } = await supabase.from(table).insert(values).select("*").single();
  if (error) throw error;
  return data;
}

async function updateAndReturn(table, id, values) {
  const { data, error } = await supabase.from(table).update(values).eq("id", id).select("*").single();
  if (error) throw error;
  return data;
}

function splitList(value) {
  return clean(value).split(",").map((item) => item.trim()).filter(Boolean);
}

function dateOrNull(value) {
  const text = clean(value);
  return text ? text.slice(0, 10) : null;
}

function addYears(value, years) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCFullYear(date.getUTCFullYear() + years);
  return date.toISOString().slice(0, 10);
}

function numberOrNull(value) {
  const text = clean(value);
  if (!text) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

function numberOrDefault(value, fallback) {
  return numberOrNull(value) ?? fallback;
}

function intArrayOrNull(value) {
  const items = splitList(value).map((item) => Number.parseInt(item, 10)).filter(Number.isFinite);
  return items.length ? items : null;
}

function compareFloors(a, b) {
  return floorRank(a) - floorRank(b) || a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

function floorRank(value) {
  const floor = clean(value).toLowerCase();
  const known = new Map([
    ["basement", -20],
    ["lower ground", -10],
    ["lower ground floor", -10],
    ["ground", 0],
    ["ground floor", 0],
    ["first", 10],
    ["first floor", 10],
    ["second", 20],
    ["second floor", 20],
    ["third", 30],
    ["third floor", 30],
    ["fourth", 40],
    ["fourth floor", 40],
    ["fifth", 50],
    ["fifth floor", 50],
    ["roof", 1000],
  ]);
  if (known.has(floor)) return known.get(floor);

  const numberMatch = floor.match(/-?\d+/);
  if (numberMatch) return Number(numberMatch[0]) * 10;
  return 500;
}

main().catch((error) => {
  console.error("Template import failed.");
  console.error(error);
  process.exit(1);
});
