import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/admin";
import {
  StructuralUnitUpdateError,
  type StructuralUnitRepository,
  updateUnitStructure,
} from "@/lib/units/structural-update";

async function getStructuralUnitAdmin(request: Request) {
  const token = request.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) {
    return { response: NextResponse.json({ error: "Missing session token." }, { status: 401 }) };
  }

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

  if (profileError) {
    return { response: NextResponse.json({ error: profileError.message }, { status: 403 }) };
  }

  const role = profile?.role?.trim().toLowerCase();
  if (!profile || profile.active === false || !["admin", "developer"].includes(role ?? "")) {
    return {
      response: NextResponse.json(
        { error: "Only active admins or developers can update building structure." },
        { status: 403 },
      ),
    };
  }

  return { adminClient };
}

function structuralUnitRepository(adminClient: SupabaseClient): StructuralUnitRepository {
  return {
    async findUnitTypeName(unitTypeId) {
      const { data, error } = await adminClient
        .from("unit_types")
        .select("name")
        .eq("id", unitTypeId)
        .maybeSingle();
      if (error) throw error;
      return data?.name?.trim() || null;
    },
    async updateUnit(unitId, payload) {
      const { data, error } = await adminClient
        .from("units")
        .update({
          unit_number: payload.unit_number,
          floor: payload.floor,
          size_sqm: payload.size_sqm,
          parking_bays: payload.parking_bays,
          unit_type_id: payload.unit_type_id,
          unit_type: payload.unit_type,
        })
        .eq("id", unitId)
        .select("id,building_id,unit_number,floor,size_sqm,parking_bays,unit_type_id,unit_type,sale_status")
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  };
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ unitId: string }> },
) {
  try {
    const { adminClient, response } = await getStructuralUnitAdmin(request);
    if (response || !adminClient) return response;

    const { unitId } = await params;
    const unit = await updateUnitStructure(
      structuralUnitRepository(adminClient),
      unitId,
      await request.json(),
    );
    return NextResponse.json({ unit });
  } catch (error) {
    if (error instanceof StructuralUnitUpdateError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unit structure could not be updated." },
      { status: 500 },
    );
  }
}
