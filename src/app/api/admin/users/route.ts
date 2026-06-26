import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import type { AppRole, ResidentType } from "@/lib/data/production";

type CreateUserBody = {
  email?: string;
  password?: string;
  fullName?: string;
  role?: AppRole;
  residentType?: ResidentType | null;
  organisationId?: string;
  buildingIds?: string[];
  unitAccess?: { unitId: string; accessType: ResidentType | "representative" }[];
  sendInviteEmail?: boolean;
};

type UpdateUserBody = Omit<CreateUserBody, "email" | "password"> & {
  userId?: string;
};

function env(name: string) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is not configured.`);
  }

  return value;
}

const validRoles: AppRole[] = ["admin", "developer", "developer_representative", "contractor", "resident", "user"];
const validResidentTypes: ResidentType[] = ["leaseholder", "tenant", "letting_agent", "managing_agent"];

function isValidRole(role: AppRole) {
  return validRoles.includes(role);
}

function isValidResidentType(value?: ResidentType | null) {
  return Boolean(value && validResidentTypes.includes(value));
}

function normalizeEmail(value?: string | null) {
  return value?.trim().toLowerCase() ?? "";
}

async function getAdminClientForRequest(request: Request) {
  const token = request.headers.get("authorization")?.replace("Bearer ", "");

  if (!token) {
    return { response: NextResponse.json({ error: "Missing session token." }, { status: 401 }) };
  }

  const url = env("NEXT_PUBLIC_SUPABASE_URL");
  const anonKey = env("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const serviceRoleKey = env("SUPABASE_SERVICE_ROLE_KEY");
  const authClient = createClient(url, anonKey);
  const adminClient = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: userData, error: userError } = await authClient.auth.getUser(token);

  if (userError || !userData.user) {
    return { response: NextResponse.json({ error: "Invalid session." }, { status: 401 }) };
  }

  const { data: requesterById, error: requesterByIdError } = await adminClient
    .from("profiles")
    .select("email,role")
    .eq("id", userData.user.id)
    .maybeSingle();

  const normalizedUserEmail = normalizeEmail(userData.user.email);
  let requesterByEmail = null as { email: string | null; role: string | null } | null;
  let requesterByEmailError = null as { message: string } | null;

  if (!requesterById && normalizedUserEmail) {
    const { data: profilesByEmail, error } = await adminClient
      .from("profiles")
      .select("email,role");

    requesterByEmailError = error;
    requesterByEmail = (profilesByEmail ?? []).find((profile) => normalizeEmail(profile.email) === normalizedUserEmail) ?? null;
  }

  const requester = requesterById ?? requesterByEmail;
  const requesterRole = requester?.role?.trim().toLowerCase();

  if (requesterByIdError || requesterByEmailError) {
    return {
      response: NextResponse.json({
        error: requesterByIdError?.message ?? requesterByEmailError?.message ?? "Could not verify admin profile.",
      }, { status: 403 }),
    };
  }

  if (requesterRole !== "admin") {
    return {
      response: NextResponse.json({
        error: `Only admins can manage users. Signed in as ${userData.user.email ?? userData.user.id}; portal role is ${requester?.role ?? "not found"}.`,
      }, { status: 403 }),
    };
  }

  return { adminClient };
}

export async function POST(request: Request) {
  try {
    const { adminClient, response } = await getAdminClientForRequest(request);
    if (response || !adminClient) return response;

    const body = (await request.json()) as CreateUserBody;
    const email = body.email?.trim();
    const password = body.password?.trim();
    const sendInviteEmail = body.sendInviteEmail ?? false;
    const role = body.role ?? "user";
    const residentType = body.residentType ?? null;
    const unitAccess = body.unitAccess ?? [];
    let buildingIds = body.buildingIds ?? [];

    if (!email) {
      return NextResponse.json({ error: "Email is required." }, { status: 400 });
    }

    if (!sendInviteEmail && !password) {
      return NextResponse.json({ error: "Temporary password is required unless sending an invite email." }, { status: 400 });
    }

    if (!isValidRole(role) || role === "user") {
      return NextResponse.json({ error: "Choose a valid user role." }, { status: 400 });
    }

    if (role === "resident" && unitAccess.length === 0) {
      return NextResponse.json({ error: "Residents must be assigned to at least one unit." }, { status: 400 });
    }

    if (role === "resident" && !isValidResidentType(residentType)) {
      return NextResponse.json({ error: "Resident type is required for resident users." }, { status: 400 });
    }

    if ((role === "developer_representative" || role === "contractor") && !body.organisationId) {
      return NextResponse.json({ error: "Developer representatives and contractors must be linked to an organisation." }, { status: 400 });
    }

    if ((role === "developer_representative" || role === "contractor") && buildingIds.length === 0) {
      return NextResponse.json({ error: "Developer representatives and contractors must be assigned to at least one building." }, { status: 400 });
    }

    if (role === "resident" && unitAccess.length > 0) {
      const { data: accessUnits, error: accessUnitsError } = await adminClient
        .from("units")
        .select("building_id")
        .in("id", unitAccess.map((access) => access.unitId));

      if (accessUnitsError) {
        return NextResponse.json({ error: accessUnitsError.message }, { status: 400 });
      }

      buildingIds = Array.from(new Set((accessUnits ?? []).map((unit) => unit.building_id)));
    }

    const redirectTo = request.headers.get("origin") ?? undefined;
    const { data, error } = sendInviteEmail
      ? await adminClient.auth.admin.inviteUserByEmail(email, {
        data: { full_name: body.fullName ?? "" },
        redirectTo,
      })
      : await adminClient.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: body.fullName ?? "" },
      });

    if (error || !data.user) {
      return NextResponse.json({ error: error?.message ?? "Could not create user." }, { status: 400 });
    }

    await adminClient.from("profiles").upsert({
      id: data.user.id,
      email,
      full_name: body.fullName ?? null,
      name: body.fullName ?? null,
      role,
      resident_type: role === "resident" ? residentType : null,
      organisation_id: role === "developer_representative" || role === "contractor" ? body.organisationId || null : null,
      active: true,
    });

    if (buildingIds.length > 0) {
      await adminClient.from("user_building_access").upsert(
        buildingIds.map((buildingId) => ({
          user_id: data.user.id,
          building_id: buildingId,
          role_on_building: role,
        })),
        { onConflict: "user_id,building_id" },
      );
    }

    if (unitAccess.length > 0) {
      await adminClient.from("user_unit_access").upsert(
        unitAccess.map((access) => ({
          user_id: data.user.id,
          unit_id: access.unitId,
          access_type: access.accessType,
        })),
        { onConflict: "user_id,unit_id,access_type" },
      );
    }

    return NextResponse.json({ id: data.user.id, email, role, invited: sendInviteEmail });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unexpected error." },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const { adminClient, response } = await getAdminClientForRequest(request);
    if (response || !adminClient) return response;

    const body = (await request.json()) as UpdateUserBody;
    const userId = body.userId;
    const role = body.role ?? "user";
    const residentType = body.residentType ?? null;
    const unitAccess = body.unitAccess ?? [];
    let buildingIds = body.buildingIds ?? [];

    if (!userId) {
      return NextResponse.json({ error: "User is required." }, { status: 400 });
    }

    if (!isValidRole(role) || role === "user") {
      return NextResponse.json({ error: "Choose a valid user role." }, { status: 400 });
    }

    if (role === "resident" && unitAccess.length === 0) {
      return NextResponse.json({ error: "Residents must be assigned to at least one unit." }, { status: 400 });
    }

    if (role === "resident" && !isValidResidentType(residentType)) {
      return NextResponse.json({ error: "Resident type is required for resident users." }, { status: 400 });
    }

    if ((role === "developer_representative" || role === "contractor") && !body.organisationId) {
      return NextResponse.json({ error: "Developer representatives and contractors must be linked to an organisation." }, { status: 400 });
    }

    if ((role === "developer_representative" || role === "contractor") && buildingIds.length === 0) {
      return NextResponse.json({ error: "Developer representatives and contractors must be assigned to at least one building." }, { status: 400 });
    }

    if (role === "resident" && unitAccess.length > 0) {
      const { data: accessUnits, error: accessUnitsError } = await adminClient
        .from("units")
        .select("building_id")
        .in("id", unitAccess.map((access) => access.unitId));

      if (accessUnitsError) {
        return NextResponse.json({ error: accessUnitsError.message }, { status: 400 });
      }

      buildingIds = Array.from(new Set((accessUnits ?? []).map((unit) => unit.building_id)));
    }

    const { error: profileError } = await adminClient.from("profiles").update({
      full_name: body.fullName ?? null,
      name: body.fullName ?? null,
      role,
      resident_type: role === "resident" ? residentType : null,
      organisation_id: role === "developer_representative" || role === "contractor" ? body.organisationId || null : null,
    }).eq("id", userId);

    if (profileError) {
      return NextResponse.json({ error: profileError.message }, { status: 400 });
    }

    await Promise.all([
      adminClient.from("user_building_access").delete().eq("user_id", userId),
      adminClient.from("user_unit_access").delete().eq("user_id", userId),
    ]);

    if (buildingIds.length > 0) {
      await adminClient.from("user_building_access").upsert(
        buildingIds.map((buildingId) => ({
          user_id: userId,
          building_id: buildingId,
          role_on_building: role,
        })),
        { onConflict: "user_id,building_id" },
      );
    }

    if (unitAccess.length > 0) {
      await adminClient.from("user_unit_access").upsert(
        unitAccess.map((access) => ({
          user_id: userId,
          unit_id: access.unitId,
          access_type: access.accessType,
        })),
        { onConflict: "user_id,unit_id,access_type" },
      );
    }

    return NextResponse.json({ id: userId, role });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unexpected error." },
      { status: 500 },
    );
  }
}
