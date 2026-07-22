import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import type { AppRole, ResidentType } from "@/lib/data/production";

type CreateUserBody = {
  email?: string;
  password?: string;
  fullName?: string;
  phone?: string;
  role?: AppRole;
  residentType?: ResidentType | null;
  organisationId?: string;
  buildingIds?: string[];
  unitAccess?: { unitId: string; accessType: ResidentType | "representative" }[];
  sendInviteEmail?: boolean;
};

type UpdateUserBody = Omit<CreateUserBody, "email" | "password"> & {
  userId?: string;
  action?: "update" | "status" | "send_login_reminder" | "send_password_reset";
  active?: boolean;
};

type DeleteUserBody = {
  userId?: string;
};

function env(name: string) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is not configured.`);
  }

  return value;
}

const validRoles: AppRole[] = ["admin", "developer", "developer_representative", "sales_agent", "conveyancer", "contractor", "resident", "user"];
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

  if (serviceRoleKey === anonKey || serviceRoleKey.startsWith("sb_publishable_")) {
    return {
      response: NextResponse.json({
        error: "Server is not configured with a Supabase service role key. Update SUPABASE_SERVICE_ROLE_KEY in the deployment environment.",
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

  const { data: requesterById, error: requesterByIdError } = await adminClient
    .from("profiles")
    .select("email,role,active")
    .eq("id", userData.user.id)
    .maybeSingle();

  const normalizedUserEmail = normalizeEmail(userData.user.email);
  let requesterByEmail = null as { email: string | null; role: string | null; active: boolean | null } | null;
  let requesterByEmailError = null as { message: string } | null;

  if (!requesterById && normalizedUserEmail) {
    const { data: profilesByEmail, error } = await adminClient
      .from("profiles")
      .select("email,role,active");

    requesterByEmailError = error;
    if (!error && (profilesByEmail ?? []).length === 0) {
      return {
        response: NextResponse.json({
          error: "Server could not read any profiles with its Supabase admin key. Check SUPABASE_SERVICE_ROLE_KEY in the staging deployment.",
        }, { status: 500 }),
      };
    }
    requesterByEmail = (profilesByEmail ?? []).find((profile) => normalizeEmail(profile.email) === normalizedUserEmail) ?? null;
  }

  const requester = requesterById ?? requesterByEmail;
  const requesterRole = requester?.role?.trim().toLowerCase();
  const requesterActive = requester?.active !== false;

  if (requesterByIdError || requesterByEmailError) {
    return {
      response: NextResponse.json({
        error: requesterByIdError?.message ?? requesterByEmailError?.message ?? "Could not verify admin profile.",
      }, { status: 403 }),
    };
  }

  if (!["admin", "developer"].includes(requesterRole ?? "") || !requesterActive) {
    return {
      response: NextResponse.json({
        error: `Only active admins or developers can manage users. Signed in as ${userData.user.email ?? userData.user.id}; portal role is ${requester?.role ?? "not found"}.`,
      }, { status: 403 }),
    };
  }

  return { adminClient, user: userData.user };
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
      phone: body.phone?.trim() || null,
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
    const { adminClient, response, user } = await getAdminClientForRequest(request);
    if (response || !adminClient) return response;

    const body = (await request.json()) as UpdateUserBody;
    const userId = body.userId;
    const action = body.action ?? "update";

    if (action !== "update") {
      if (!userId) {
        return NextResponse.json({ error: "User is required." }, { status: 400 });
      }

      const { data: profile, error: profileError } = await adminClient
        .from("profiles")
        .select("id,email,role,active")
        .eq("id", userId)
        .maybeSingle();

      if (profileError) {
        return NextResponse.json({ error: profileError.message }, { status: 400 });
      }

      if (!profile) {
        return NextResponse.json({ error: "User profile not found." }, { status: 404 });
      }

      if (action === "status") {
        if (typeof body.active !== "boolean") {
          return NextResponse.json({ error: "User status is required." }, { status: 400 });
        }

        if (user?.id === userId && body.active === false) {
          return NextResponse.json({ error: "You cannot deactivate your own user account while signed in." }, { status: 400 });
        }

        const { error: authError } = await adminClient.auth.admin.updateUserById(userId, {
          ban_duration: body.active ? "none" : "876000h",
        });

        if (authError) {
          return NextResponse.json({ error: authError.message }, { status: 400 });
        }

        const { error: statusError } = await adminClient
          .from("profiles")
          .update({ active: body.active })
          .eq("id", userId);

        if (statusError) {
          return NextResponse.json({ error: statusError.message }, { status: 400 });
        }

        return NextResponse.json({ id: userId, email: profile.email, active: body.active });
      }

      if (!profile.email) {
        return NextResponse.json({ error: "This user does not have an email address." }, { status: 400 });
      }

      const redirectTo = request.headers.get("origin") ?? undefined;

      if (action === "send_login_reminder") {
        const { error } = await adminClient.auth.signInWithOtp({
          email: profile.email,
          options: {
            emailRedirectTo: redirectTo,
            shouldCreateUser: false,
          },
        });

        if (error) {
          return NextResponse.json({ error: error.message }, { status: 400 });
        }

        return NextResponse.json({ id: userId, email: profile.email, sent: "login_reminder" });
      }

      if (action === "send_password_reset") {
        const { error } = await adminClient.auth.resetPasswordForEmail(profile.email, { redirectTo });

        if (error) {
          return NextResponse.json({ error: error.message }, { status: 400 });
        }

        return NextResponse.json({ id: userId, email: profile.email, sent: "password_reset" });
      }

      return NextResponse.json({ error: "Unsupported user action." }, { status: 400 });
    }

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
      phone: body.phone?.trim() || null,
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

export async function DELETE(request: Request) {
  try {
    const { adminClient, response, user } = await getAdminClientForRequest(request);
    if (response || !adminClient) return response;

    const body = (await request.json()) as DeleteUserBody;
    const userId = body.userId;

    if (!userId) {
      return NextResponse.json({ error: "User is required." }, { status: 400 });
    }

    if (user?.id === userId) {
      return NextResponse.json({ error: "You cannot delete your own user account while signed in." }, { status: 400 });
    }

    const { data: profile, error: profileError } = await adminClient
      .from("profiles")
      .select("id,email,role")
      .eq("id", userId)
      .maybeSingle();

    if (profileError) {
      return NextResponse.json({ error: profileError.message }, { status: 400 });
    }

    if (!profile) {
      return NextResponse.json({ error: "User profile not found." }, { status: 404 });
    }

    const activityChecks = [
      ["snags created by this user", adminClient.from("snags").select("id", { count: "exact", head: true }).eq("created_by_user_id", userId)],
      ["snags assigned to this user", adminClient.from("snags").select("id", { count: "exact", head: true }).eq("assigned_to_user_id", userId)],
      ["snag photos uploaded by this user", adminClient.from("snag_photos").select("id", { count: "exact", head: true }).eq("uploaded_by_user_id", userId)],
      ["snag events created by this user", adminClient.from("snag_events").select("id", { count: "exact", head: true }).eq("created_by_user_id", userId)],
      ["handovers by this user", adminClient.from("handovers").select("id", { count: "exact", head: true }).eq("handover_by_user_id", userId)],
      ["meter readings created by this user", adminClient.from("meter_readings").select("id", { count: "exact", head: true }).eq("created_by_user_id", userId)],
      ["reports generated by this user", adminClient.from("reports").select("id", { count: "exact", head: true }).eq("generated_by_user_id", userId)],
      ["audit events created by this user", adminClient.from("audit_events").select("id", { count: "exact", head: true }).eq("created_by_user_id", userId)],
    ] as const;

    const results = await Promise.all(activityChecks.map(async ([label, query]) => {
      const { count, error } = await query;
      return { label, count: count ?? 0, error };
    }));
    const firstError = results.find((item) => item.error)?.error;

    if (firstError) {
      return NextResponse.json({ error: firstError.message }, { status: 400 });
    }

    const blockers = results.filter((item) => item.count > 0);

    if (blockers.length > 0) {
      return NextResponse.json({
        error: `Cannot delete ${profile.email}. Linked activity exists: ${blockers.map((item) => `${item.count} ${item.label}`).join(", ")}.`,
      }, { status: 400 });
    }

    const { data: linkedAccessRequests, error: linkedAccessRequestsError } = await adminClient
      .from("resident_access_requests")
      .select("id,full_name,email,phone,resident_type,requested_units,notes,status,admin_notes,reviewed_by_user_id,reviewed_at,created_at")
      .ilike("email", profile.email);

    if (linkedAccessRequestsError) {
      return NextResponse.json({ error: linkedAccessRequestsError.message }, { status: 400 });
    }

    await Promise.all([
      adminClient.from("user_building_access").delete().eq("user_id", userId),
      adminClient.from("user_unit_access").delete().eq("user_id", userId),
      adminClient.from("resident_access_requests").delete().ilike("email", profile.email),
    ]);

    const { error: deleteProfileError } = await adminClient.from("profiles").delete().eq("id", userId);
    if (deleteProfileError) {
      return NextResponse.json({ error: deleteProfileError.message }, { status: 400 });
    }

    const { error: deleteAuthError } = await adminClient.auth.admin.deleteUser(userId);
    if (deleteAuthError && !deleteAuthError.message.toLowerCase().includes("not found")) {
      return NextResponse.json({ error: deleteAuthError.message }, { status: 400 });
    }

    return NextResponse.json({
      id: userId,
      email: profile.email,
      role: profile.role,
      deletedAccessRequests: linkedAccessRequests ?? [],
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unexpected error." },
      { status: 500 },
    );
  }
}
