import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import type { AppRole } from "@/lib/data/production";

type CreateUserBody = {
  email?: string;
  password?: string;
  fullName?: string;
  role?: AppRole;
  organisationId?: string;
  buildingIds?: string[];
  unitAccess?: { unitId: string; accessType: "leaseholder" | "agent" | "representative" }[];
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

  const { data: requester } = await adminClient
    .from("profiles")
    .select("role")
    .eq("id", userData.user.id)
    .single();

  if (requester?.role !== "admin") {
    return { response: NextResponse.json({ error: "Only admins can manage users." }, { status: 403 }) };
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
    const role = body.role ?? "user";
    const unitAccess = body.unitAccess ?? [];
    let buildingIds = body.buildingIds ?? [];

    if (!email || !password) {
      return NextResponse.json({ error: "Email and password are required." }, { status: 400 });
    }

    if (role === "leaseholder" && unitAccess.length === 0) {
      return NextResponse.json({ error: "Leaseholders must be assigned to at least one unit." }, { status: 400 });
    }

    if ((role === "agent" || role === "contractor" || role === "trade") && !body.organisationId) {
      return NextResponse.json({ error: "Agents, contractors and trades must be linked to an organisation." }, { status: 400 });
    }

    if ((role === "agent" || role === "contractor" || role === "trade") && buildingIds.length === 0) {
      return NextResponse.json({ error: "Agents, contractors and trades must be assigned to at least one building." }, { status: 400 });
    }

    if (role === "leaseholder" && unitAccess.length > 0) {
      const { data: accessUnits, error: accessUnitsError } = await adminClient
        .from("units")
        .select("building_id")
        .in("id", unitAccess.map((access) => access.unitId));

      if (accessUnitsError) {
        return NextResponse.json({ error: accessUnitsError.message }, { status: 400 });
      }

      buildingIds = Array.from(new Set((accessUnits ?? []).map((unit) => unit.building_id)));
    }

    const { data, error } = await adminClient.auth.admin.createUser({
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
      organisation_id: body.organisationId || null,
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

    return NextResponse.json({ id: data.user.id, email, role });
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
    const unitAccess = body.unitAccess ?? [];
    let buildingIds = body.buildingIds ?? [];

    if (!userId) {
      return NextResponse.json({ error: "User is required." }, { status: 400 });
    }

    if (role === "leaseholder" && unitAccess.length === 0) {
      return NextResponse.json({ error: "Leaseholders must be assigned to at least one unit." }, { status: 400 });
    }

    if ((role === "agent" || role === "contractor" || role === "trade") && !body.organisationId) {
      return NextResponse.json({ error: "Agents, contractors and trades must be linked to an organisation." }, { status: 400 });
    }

    if ((role === "agent" || role === "contractor" || role === "trade") && buildingIds.length === 0) {
      return NextResponse.json({ error: "Agents, contractors and trades must be assigned to at least one building." }, { status: 400 });
    }

    if (role === "leaseholder" && unitAccess.length > 0) {
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
      organisation_id: body.organisationId || null,
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
