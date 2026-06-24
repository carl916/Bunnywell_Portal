import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config({ path: ".env.local", quiet: true });

const url = requiredEnv("NEXT_PUBLIC_SUPABASE_URL");
const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");

const supabase = createClient(url, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

const users = {
  admin: {
    email: requiredEnv("PLAYWRIGHT_ADMIN_EMAIL"),
    password: requiredEnv("PLAYWRIGHT_ADMIN_PASSWORD"),
    name: "Playwright Admin",
    role: "admin",
    residentType: null,
  },
  contractor: {
    email: requiredEnv("PLAYWRIGHT_CONTRACTOR_EMAIL"),
    password: requiredEnv("PLAYWRIGHT_CONTRACTOR_PASSWORD"),
    name: "Playwright Contractor",
    role: "contractor",
    residentType: null,
  },
  resident: {
    email: requiredEnv("PLAYWRIGHT_RESIDENT_EMAIL"),
    password: requiredEnv("PLAYWRIGHT_RESIDENT_PASSWORD"),
    name: "Playwright Resident",
    role: "resident",
    residentType: "leaseholder",
  },
};

const E2E_PREFIX = "[E2E]";

async function main() {
  console.log("Seeding Bunnywell staging data...");

  const building = await upsertBuilding();
  const contractorOrg = await upsertOrganisation({
    name: "E2E Contractor Ltd",
    type: "contractor",
    email: users.contractor.email,
  });

  await upsertBuildingOrganisation(building.id, contractorOrg.id);

  const seededUsers = {
    admin: await upsertAuthUser(users.admin),
    contractor: await upsertAuthUser({ ...users.contractor, organisationId: contractorOrg.id }),
    resident: await upsertAuthUser(users.resident),
  };

  const units = await upsertUnits(building.id);
  const areas = await upsertAreas(building.id, units);
  const trades = await upsertTrades();

  await upsertBuildingAccess(seededUsers.admin.id, building.id, "admin");
  await upsertBuildingAccess(seededUsers.contractor.id, building.id, "contractor");
  await upsertUnitAccess(seededUsers.resident.id, units["101"].id, "leaseholder");

  await recreateE2ESnags({
    admin: seededUsers.admin,
    resident: seededUsers.resident,
    contractorOrg,
    building,
    units,
    areas,
    trades,
  });

  console.log("Staging seed complete.");
  console.log(`Admin: ${users.admin.email}`);
  console.log(`Contractor: ${users.contractor.email}`);
  console.log(`Resident: ${users.resident.email}`);
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

async function upsertAuthUser(user) {
  const existing = await findAuthUserByEmail(user.email);
  const payload = {
    email: user.email,
    password: user.password,
    email_confirm: true,
    user_metadata: { full_name: user.name },
  };

  const authResult = existing
    ? await supabase.auth.admin.updateUserById(existing.id, payload)
    : await supabase.auth.admin.createUser(payload);

  if (authResult.error) throw authResult.error;
  const authUser = authResult.data.user;

  await upsert("profiles", {
    id: authUser.id,
    email: user.email,
    full_name: user.name,
    name: user.name,
    role: user.role,
    resident_type: user.residentType,
    organisation_id: user.organisationId ?? null,
    active: true,
  }, "id");

  return authUser;
}

async function findAuthUserByEmail(email) {
  let page = 1;
  const perPage = 100;

  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) throw error;

    const match = data.users.find((user) => user.email?.toLowerCase() === email.toLowerCase());
    if (match) return match;
    if (data.users.length < perPage) return null;
    page += 1;
  }
}

async function upsertBuilding() {
  const existing = await findOne("buildings", "name", "Forum House");
  if (existing) {
    await updateById("buildings", existing.id, {
      address_line_1: "E2E Staging Estate",
      town: "London",
      postcode: "E2E 1AA",
      status: "active",
      notes: "Seeded staging building for automated tests.",
    });
    return { ...existing, name: "Forum House" };
  }

  return insertOne("buildings", {
    name: "Forum House",
    address_line_1: "E2E Staging Estate",
    town: "London",
    postcode: "E2E 1AA",
    status: "active",
    notes: "Seeded staging building for automated tests.",
  });
}

async function upsertOrganisation(values) {
  const existing = await findOne("organisations", "name", values.name);
  if (existing) {
    await updateById("organisations", existing.id, values);
    return { ...existing, ...values };
  }
  return insertOne("organisations", values);
}

async function upsertBuildingOrganisation(buildingId, organisationId) {
  const { error } = await supabase
    .from("building_organisations")
    .upsert({
      building_id: buildingId,
      organisation_id: organisationId,
      role_on_project: "contractor",
    }, { onConflict: "building_id,organisation_id,role_on_project" });
  if (error) throw error;
}

async function upsertUnits(buildingId) {
  const unitNumbers = ["101", "102", "201"];
  const result = {};

  for (const [index, unitNumber] of unitNumbers.entries()) {
    const { data, error } = await supabase
      .from("units")
      .upsert({
        building_id: buildingId,
        unit_number: unitNumber,
        floor: unitNumber.startsWith("1") ? "First" : "Second",
        unit_type: index === 2 ? "Two bedroom" : "One bedroom",
        size_sqm: index === 2 ? 72 : 55,
        sale_status: index === 0 ? "completed" : "for_sale",
      }, { onConflict: "building_id,unit_number" })
      .select("*")
      .single();
    if (error) throw error;
    result[unitNumber] = data;
  }

  return result;
}

async function upsertAreas(buildingId, units) {
  const roomNames = ["Entrance / Hallway", "Kitchen", "Living Room", "Bathroom"];
  const result = {};

  for (const unit of Object.values(units)) {
    result[unit.unit_number] = {};

    for (const [index, name] of roomNames.entries()) {
      const existing = await supabase
        .from("areas")
        .select("*")
        .eq("unit_id", unit.id)
        .eq("name", name)
        .maybeSingle();
      if (existing.error) throw existing.error;

      if (existing.data) {
        await updateById("areas", existing.data.id, {
          building_id: buildingId,
          area_type: "unit_room",
          floor: unit.floor,
          sort_order: (index + 1) * 10,
        });
        result[unit.unit_number][name] = existing.data;
      } else {
        result[unit.unit_number][name] = await insertOne("areas", {
          building_id: buildingId,
          unit_id: unit.id,
          area_type: "unit_room",
          name,
          floor: unit.floor,
          sort_order: (index + 1) * 10,
        });
      }
    }
  }

  return result;
}

async function upsertTrades() {
  const tradeNames = ["Decorating", "Electrical", "Plumbing"];
  const result = {};

  for (const [index, name] of tradeNames.entries()) {
    const { data, error } = await supabase
      .from("trades")
      .upsert({ name, sort_order: (index + 1) * 10, active: true }, { onConflict: "name" })
      .select("*")
      .single();
    if (error) throw error;
    result[name] = data;
  }

  return result;
}

async function upsertBuildingAccess(userId, buildingId, roleOnBuilding) {
  const { error } = await supabase
    .from("user_building_access")
    .upsert({
      user_id: userId,
      building_id: buildingId,
      role_on_building: roleOnBuilding,
    }, { onConflict: "user_id,building_id" });
  if (error) throw error;
}

async function upsertUnitAccess(userId, unitId, accessType) {
  const { error } = await supabase
    .from("user_unit_access")
    .upsert({
      user_id: userId,
      unit_id: unitId,
      access_type: accessType,
    }, { onConflict: "user_id,unit_id,access_type" });
  if (error) throw error;
}

async function recreateE2ESnags({ admin, resident, contractorOrg, building, units, areas, trades }) {
  const existing = await supabase
    .from("snags")
    .select("id")
    .ilike("title", `${E2E_PREFIX}%`);
  if (existing.error) throw existing.error;

  if (existing.data.length > 0) {
    const { error } = await supabase
      .from("snags")
      .delete()
      .in("id", existing.data.map((snag) => snag.id));
    if (error) throw error;
  }

  const snags = [
    {
      title: `${E2E_PREFIX} Kitchen paint touch-up`,
      description: "Seeded developer snag assigned to the staging contractor.",
      status: "open",
      priority: 2,
      priority_code: "P2",
      source_type: "developer_snag",
      created_by: admin.id,
      created_by_user_id: admin.id,
      building_id: building.id,
      unit_id: units["101"].id,
      area_id: areas["101"].Kitchen.id,
      trade_id: trades.Decorating.id,
      assigned_to_organisation_id: contractorOrg.id,
      sla_due_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    },
    {
      title: `${E2E_PREFIX} Bathroom tap pressure`,
      description: "Seeded resident defect visible to the staging resident.",
      status: "submitted",
      priority: 3,
      priority_code: "P3",
      source_type: "leaseholder_defect",
      created_by: resident.id,
      created_by_user_id: resident.id,
      building_id: building.id,
      unit_id: units["101"].id,
      area_id: areas["101"].Bathroom.id,
      trade_id: trades.Plumbing.id,
      assigned_to_organisation_id: contractorOrg.id,
    },
    {
      title: `${E2E_PREFIX} Living room socket check`,
      description: "Seeded resolved snag for report and dashboard coverage.",
      status: "resolved_by_contractor",
      priority: 1,
      priority_code: "P1",
      source_type: "developer_snag",
      created_by: admin.id,
      created_by_user_id: admin.id,
      building_id: building.id,
      unit_id: units["102"].id,
      area_id: areas["102"]["Living Room"].id,
      trade_id: trades.Electrical.id,
      assigned_to_organisation_id: contractorOrg.id,
    },
  ];

  const { data, error } = await supabase.from("snags").insert(snags).select("*");
  if (error) throw error;

  const events = data.map((snag) => ({
    snag_id: snag.id,
    event_type: "created",
    new_value: snag.status,
    comment: "Seeded for Bunnywell Playwright e2e tests.",
    created_by_user_id: snag.created_by_user_id,
  }));

  const { error: eventError } = await supabase.from("snag_events").insert(events);
  if (eventError) throw eventError;
}

async function findOne(table, column, value) {
  const { data, error } = await supabase
    .from(table)
    .select("*")
    .eq(column, value)
    .order("created_at", { ascending: true })
    .limit(1);
  if (error) throw error;
  return data[0] ?? null;
}

async function insertOne(table, values) {
  const { data, error } = await supabase.from(table).insert(values).select("*").single();
  if (error) throw error;
  return data;
}

async function updateById(table, id, values) {
  const { error } = await supabase.from(table).update(values).eq("id", id);
  if (error) throw error;
}

async function upsert(table, values, onConflict) {
  const { error } = await supabase.from(table).upsert(values, { onConflict });
  if (error) throw error;
}

main().catch((error) => {
  console.error("Staging seed failed.");
  console.error(error);
  process.exit(1);
});
