import { NextResponse } from "next/server";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/admin";
import {
  parseUnitAllocationMutation,
  UnitAllocationMutationError,
} from "@/lib/units/allocation-mutation";

function allocationErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    return error.message;
  }
  return fallback;
}

async function getAllocationAdmin(request: Request) {
  const token = request.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) return { response: NextResponse.json({ error: "Missing session token." }, { status: 401 }) };

  const adminClient = createSupabaseServiceRoleClient();
  const { data: userData, error: userError } = await adminClient.auth.getUser(token);
  if (userError || !userData.user) {
    return { response: NextResponse.json({ error: "Invalid session." }, { status: 401 }) };
  }

  const { data: profile, error: profileError } = await adminClient
    .from("profiles")
    .select("role,active")
    .eq("id", userData.user.id)
    .maybeSingle();
  if (profileError) return { response: NextResponse.json({ error: profileError.message }, { status: 403 }) };

  const role = profile?.role?.trim().toLowerCase();
  if (!profile || profile.active === false || !["admin", "developer"].includes(role ?? "")) {
    return {
      response: NextResponse.json(
        { error: "Only active admins or developers can change unit allocation." },
        { status: 403 },
      ),
    };
  }
  return { adminClient, actorUserId: userData.user.id };
}

export async function GET(request: Request) {
  try {
    const { adminClient, actorUserId, response } = await getAllocationAdmin(request);
    if (response || !adminClient || !actorUserId) return response;

    const { data, error } = await adminClient.rpc("get_unit_allocation_sale_workflows", {
      p_actor_user_id: actorUserId,
    });
    if (error) throw error;

    return NextResponse.json({ workflows: data ?? [] });
  } catch (error) {
    return NextResponse.json(
      { error: allocationErrorMessage(error, "Sale workflow status could not be loaded.") },
      { status: 400 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const { adminClient, actorUserId, response } = await getAllocationAdmin(request);
    if (response || !adminClient || !actorUserId) return response;

    const mutation = parseUnitAllocationMutation(await request.json());
    const rpcName = mutation.action === "set_sales_availability"
      ? "set_unit_sales_availability"
      : "set_unit_rental_portfolio_status";
    const { data, error } = await adminClient.rpc(rpcName, {
      p_unit_ids: mutation.unitIds,
      p_target_status: mutation.target,
      p_actor_user_id: actorUserId,
      p_source: "unit_allocation",
    });
    if (error) throw error;

    return NextResponse.json({ changed: Number(data ?? 0) });
  } catch (error) {
    if (error instanceof UnitAllocationMutationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: allocationErrorMessage(error, "Unit allocation could not be changed.") },
      { status: 400 },
    );
  }
}
