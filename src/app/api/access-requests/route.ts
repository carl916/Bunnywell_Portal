import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import type { ResidentType } from "@/lib/data/production";

type RequestedUnitInput = {
  buildingId?: string;
  unitId?: string;
};

type AccessRequestBody = {
  fullName?: string;
  email?: string;
  phone?: string;
  residentType?: ResidentType;
  requestedUnits?: RequestedUnitInput[];
  notes?: string;
  consent?: boolean;
  website?: string;
};

type AccessRequestActionBody = {
  requestId?: string;
  action?: "approve" | "reject" | "save_notes";
  adminNotes?: string;
};

type AccessRequestUnit = {
  building_id: string;
  building_name?: string;
  unit_id: string;
  unit_number?: string;
  floor?: string | null;
};

const validResidentTypes: ResidentType[] = ["leaseholder", "tenant", "letting_agent", "managing_agent"];

type RequestableBuilding = {
  id: string;
  name?: string | null;
  status?: string | null;
  allow_resident_access_requests?: boolean | null;
};

function isResidentRequestableBuilding(building?: RequestableBuilding | null) {
  if (!building) return false;
  if (building.status === "archived" || building.allow_resident_access_requests === false) return false;
  return true;
}

function env(name: string) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is not configured.`);
  }

  return value;
}

function createAdminClient() {
  const url = env("NEXT_PUBLIC_SUPABASE_URL");
  const anonKey = env("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const serviceRoleKey = env("SUPABASE_SERVICE_ROLE_KEY");

  if (serviceRoleKey === anonKey || serviceRoleKey.startsWith("sb_publishable_")) {
    throw new Error("Server is not configured with a Supabase service role key.");
  }

  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

async function getAdminClientForRequest(request: Request) {
  const token = request.headers.get("authorization")?.replace("Bearer ", "");

  if (!token) {
    return { response: NextResponse.json({ error: "Missing session token." }, { status: 401 }) };
  }

  const url = env("NEXT_PUBLIC_SUPABASE_URL");
  const anonKey = env("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const serviceRoleKey = env("SUPABASE_SERVICE_ROLE_KEY");

  if (serviceRoleKey === anonKey || serviceRoleKey.startsWith("sb_publishable_")) {
    return {
      response: NextResponse.json({
        error: "Server is not configured with a Supabase service role key.",
      }, { status: 500 }),
    };
  }

  const authClient = createClient(url, anonKey);
  const adminClient = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: userData, error: userError } = await authClient.auth.getUser(token);

  if (userError || !userData.user) {
    return { response: NextResponse.json({ error: "Invalid session." }, { status: 401 }) };
  }

  const { data: requesterById, error: requesterError } = await adminClient
    .from("profiles")
    .select("id,email,role,active")
    .eq("id", userData.user.id)
    .maybeSingle();

  if (requesterError) {
    return { response: NextResponse.json({ error: requesterError.message }, { status: 403 }) };
  }

  const requesterRole = requesterById?.role?.trim().toLowerCase();
  const requesterActive = requesterById?.active !== false;

  if (!["admin", "developer"].includes(requesterRole ?? "") || !requesterActive) {
    return {
      response: NextResponse.json({
        error: `Only active admins or developers can manage access requests. Signed in as ${userData.user.email ?? userData.user.id}; portal role is ${requesterById?.role ?? "not found"}.`,
      }, { status: 403 }),
    };
  }

  if (!requesterById?.id) {
    return { response: NextResponse.json({ error: "Portal profile not found." }, { status: 403 }) };
  }

  return { adminClient, user: userData.user, requesterProfileId: requesterById.id as string };
}

export async function GET() {
  try {
    const supabase = createAdminClient();
    const [{ data: buildings, error: buildingsError }, { data: units, error: unitsError }] = await Promise.all([
      supabase
        .from("buildings")
        .select("id,name,status,allow_resident_access_requests")
        .order("name"),
      supabase
        .from("units")
        .select("id,building_id,unit_number,floor,sale_status")
        .order("unit_number"),
    ]);

    if (buildingsError || unitsError) {
      return NextResponse.json({ error: buildingsError?.message ?? unitsError?.message ?? "Could not load buildings." }, { status: 500 });
    }

    return NextResponse.json({
      buildings: (buildings ?? [])
        .filter(isResidentRequestableBuilding)
        .map((building) => ({ id: building.id, name: building.name })),
      units: (units ?? [])
        .filter((unit) => (buildings ?? []).some((building) => building.id === unit.building_id && isResidentRequestableBuilding(building)))
        .map((unit) => ({
        id: unit.id,
        buildingId: unit.building_id,
        unitNumber: unit.unit_number,
        floor: unit.floor,
      })),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unexpected error." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as AccessRequestBody;

    if (body.website) {
      return NextResponse.json({ ok: true });
    }

    const fullName = body.fullName?.trim() ?? "";
    const email = normalizeEmail(body.email ?? "");
    const phone = body.phone?.trim() ?? "";
    const residentType = body.residentType;
    const notes = body.notes?.trim() || null;
    const requestedUnitInputs = body.requestedUnits ?? [];

    if (!fullName) return NextResponse.json({ error: "Name is required." }, { status: 400 });
    if (!email || !isValidEmail(email)) return NextResponse.json({ error: "A valid email address is required." }, { status: 400 });
    if (!phone) return NextResponse.json({ error: "Phone number is required." }, { status: 400 });
    if (!residentType || !validResidentTypes.includes(residentType)) return NextResponse.json({ error: "Resident type is required." }, { status: 400 });
    if (!body.consent) return NextResponse.json({ error: "Consent is required before submitting." }, { status: 400 });

    const cleanRequestedUnits = requestedUnitInputs
      .map((item) => ({
        buildingId: item.buildingId?.trim() ?? "",
        unitId: item.unitId?.trim() ?? "",
      }))
      .filter((item) => item.buildingId && item.unitId);

    if (cleanRequestedUnits.length === 0) {
      return NextResponse.json({ error: "Choose at least one flat." }, { status: 400 });
    }

    const unitIds = Array.from(new Set(cleanRequestedUnits.map((item) => item.unitId)));
    const supabase = createAdminClient();
    const { data: unitRows, error: unitsError } = await supabase
      .from("units")
      .select("id,building_id,unit_number,floor,buildings(id,name,status,allow_resident_access_requests)")
      .in("id", unitIds);

    if (unitsError) {
      return NextResponse.json({ error: unitsError.message }, { status: 400 });
    }

    const requestedUnits = cleanRequestedUnits.map((requestedUnit) => {
      const unit = (unitRows ?? []).find((item) => item.id === requestedUnit.unitId && item.building_id === requestedUnit.buildingId);
      const building = Array.isArray(unit?.buildings) ? unit?.buildings[0] : unit?.buildings;

      if (!unit) return null;
      if (!isResidentRequestableBuilding(building)) {
        return {
          blocked: true,
          building_name: building?.name ?? "Unknown building",
        };
      }

      return {
        building_id: unit.building_id,
        building_name: building?.name ?? "Unknown building",
        unit_id: unit.id,
        unit_number: unit.unit_number,
        floor: unit.floor,
      };
    });

    if (requestedUnits.some((item) => item === null)) {
      return NextResponse.json({ error: "One or more selected flats could not be found." }, { status: 400 });
    }

    const blockedUnit = requestedUnits.find((item) => item && "blocked" in item);
    if (blockedUnit && "building_name" in blockedUnit) {
      return NextResponse.json({ error: `${blockedUnit.building_name} is not accepting new resident access requests.` }, { status: 400 });
    }
    const accessRequestUnits = requestedUnits.flatMap((item) => {
      if (!item || "blocked" in item) return [];
      return [item];
    });

    const { data, error } = await supabase
      .from("resident_access_requests")
      .insert({
        full_name: fullName,
        email,
        phone,
        resident_type: residentType,
        requested_units: accessRequestUnits,
        notes,
        status: "pending",
      })
      .select("id")
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ id: data.id });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unexpected error." },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const { adminClient, response, user, requesterProfileId } = await getAdminClientForRequest(request);
    if (response || !adminClient || !user || !requesterProfileId) return response;

    const body = (await request.json()) as AccessRequestActionBody;
    const requestId = body.requestId;
    const action = body.action;
    const adminNotes = body.adminNotes?.trim() || null;

    if (!requestId) return NextResponse.json({ error: "Access request is required." }, { status: 400 });
    if (action !== "approve" && action !== "reject" && action !== "save_notes") {
      return NextResponse.json({ error: "Choose approve, reject or save notes." }, { status: 400 });
    }

    const { data: accessRequest, error: requestError } = await adminClient
      .from("resident_access_requests")
      .select("*")
      .eq("id", requestId)
      .maybeSingle();

    if (requestError) {
      return NextResponse.json({ error: requestError.message }, { status: 400 });
    }

    if (!accessRequest) {
      return NextResponse.json({ error: "Access request not found." }, { status: 404 });
    }

    if (action === "save_notes") {
      const { error } = await adminClient
        .from("resident_access_requests")
        .update({ admin_notes: adminNotes })
        .eq("id", requestId);

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }

      return NextResponse.json({ id: requestId, status: accessRequest.status, adminNotes });
    }

    if (accessRequest.status !== "pending") {
      return NextResponse.json({ error: "This access request has already been reviewed." }, { status: 400 });
    }

    if (action === "reject") {
      const { error } = await adminClient
        .from("resident_access_requests")
        .update({
          status: "rejected",
          admin_notes: adminNotes,
          reviewed_by_user_id: requesterProfileId,
          reviewed_at: new Date().toISOString(),
        })
        .eq("id", requestId);

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }

      return NextResponse.json({ id: requestId, status: "rejected" });
    }

    const requestedUnits = (Array.isArray(accessRequest.requested_units) ? accessRequest.requested_units : []) as AccessRequestUnit[];
    const cleanRequestedUnits = requestedUnits.filter((item) => item.unit_id && item.building_id);

    if (cleanRequestedUnits.length === 0) {
      return NextResponse.json({ error: "This request does not include any flats." }, { status: 400 });
    }

    const email = normalizeEmail(accessRequest.email ?? "");
    const residentType = accessRequest.resident_type as ResidentType;

    if (!email || !isValidEmail(email)) {
      return NextResponse.json({ error: "The access request does not have a valid email address." }, { status: 400 });
    }

    if (!validResidentTypes.includes(residentType)) {
      return NextResponse.json({ error: "The access request does not have a valid resident type." }, { status: 400 });
    }

    const { data: existingProfiles, error: profileLookupError } = await adminClient
      .from("profiles")
      .select("id,email,role")
      .ilike("email", email);

    if (profileLookupError) {
      return NextResponse.json({ error: profileLookupError.message }, { status: 400 });
    }

    const existingProfile = (existingProfiles ?? [])[0] as { id: string; email: string; role: string | null } | undefined;
    let targetUserId = existingProfile?.id;
    let invited = false;

    if (!targetUserId) {
      const redirectTo = request.headers.get("origin") ?? undefined;
      const { data, error } = await adminClient.auth.admin.inviteUserByEmail(email, {
        data: { full_name: accessRequest.full_name ?? "" },
        redirectTo,
      });

      if (error || !data.user) {
        return NextResponse.json({ error: error?.message ?? "Could not invite user." }, { status: 400 });
      }

      targetUserId = data.user.id;
      invited = true;
    } else {
      const { error: unbanError } = await adminClient.auth.admin.updateUserById(targetUserId, {
        ban_duration: "none",
      });

      if (unbanError && !unbanError.message.toLowerCase().includes("not found")) {
        return NextResponse.json({ error: unbanError.message }, { status: 400 });
      }
    }

    const shouldSetResidentRole = !existingProfile?.role || existingProfile.role === "user" || existingProfile.role === "resident";
    const profileRole = shouldSetResidentRole ? "resident" : existingProfile.role;

    const { error: upsertProfileError } = await adminClient.from("profiles").upsert({
      id: targetUserId,
      email,
      full_name: accessRequest.full_name ?? null,
      name: accessRequest.full_name ?? null,
      phone: accessRequest.phone ?? null,
      role: profileRole,
      resident_type: profileRole === "resident" ? residentType : null,
      active: true,
    });

    if (upsertProfileError) {
      return NextResponse.json({ error: upsertProfileError.message }, { status: 400 });
    }

    const buildingIds = Array.from(new Set(cleanRequestedUnits.map((item) => item.building_id)));
    const unitRows = cleanRequestedUnits.map((item) => ({
      user_id: targetUserId,
      unit_id: item.unit_id,
      access_type: residentType,
    }));
    const buildingRows = buildingIds.map((buildingId) => ({
      user_id: targetUserId,
      building_id: buildingId,
      role_on_building: "resident",
    }));

    const { data: existingUnitAccess, error: existingUnitAccessError } = await adminClient
      .from("user_unit_access")
      .select("unit_id")
      .eq("user_id", targetUserId)
      .in("unit_id", cleanRequestedUnits.map((item) => item.unit_id));

    if (existingUnitAccessError) {
      return NextResponse.json({ error: existingUnitAccessError.message }, { status: 400 });
    }

    const existingUnitIds = new Set((existingUnitAccess ?? []).map((item) => item.unit_id));
    const newUnitRows = unitRows.filter((item) => !existingUnitIds.has(item.unit_id));

    if (newUnitRows.length === 0) {
      return NextResponse.json({ error: "This user already has access to all flats on this request." }, { status: 400 });
    }

    const [{ error: unitAccessError }, { error: buildingAccessError }] = await Promise.all([
      adminClient.from("user_unit_access").upsert(newUnitRows, { onConflict: "user_id,unit_id,access_type" }),
      adminClient.from("user_building_access").upsert(buildingRows, { onConflict: "user_id,building_id" }),
    ]);

    if (unitAccessError || buildingAccessError) {
      return NextResponse.json({ error: unitAccessError?.message ?? buildingAccessError?.message ?? "Could not assign access." }, { status: 400 });
    }

    const { error: approveError } = await adminClient
      .from("resident_access_requests")
      .update({
        status: "approved",
        admin_notes: adminNotes,
        reviewed_by_user_id: requesterProfileId,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", requestId);

    if (approveError) {
      return NextResponse.json({ error: approveError.message }, { status: 400 });
    }

    return NextResponse.json({ id: requestId, status: "approved", userId: targetUserId, email, invited });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unexpected error." },
      { status: 500 },
    );
  }
}
