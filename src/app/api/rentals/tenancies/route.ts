import { NextResponse } from "next/server";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/admin";
import type { TenancySourceType } from "@/lib/rentals/tenancies";

const sourceTypes = new Set<TenancySourceType>(["manual", "spreadsheet_import", "document", "email"]);

type TenancyPayload = {
  tenancyId?: string;
  buildingId?: string;
  unitId?: string;
  tenantName?: string;
  tenancyStartDate?: string;
  fixedTermEndDate?: string | null;
  tenancyEndDate?: string | null;
  monthlyRent?: number | string;
  rentDueDay?: number | string | null;
  depositAmount?: number | string | null;
  lettingAgentOrganisationId?: string | null;
  notes?: string | null;
  sourceType?: TenancySourceType;
  sourceReference?: string | null;
  reason?: string;
};

async function getTenancyManager(request: Request, adminOnly = false) {
  const token = request.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) return { response: NextResponse.json({ error: "Missing session token." }, { status: 401 }) };
  const adminClient = createSupabaseServiceRoleClient();
  const { data: userData, error: userError } = await adminClient.auth.getUser(token);
  if (userError || !userData.user) return { response: NextResponse.json({ error: "Invalid session." }, { status: 401 }) };
  const { data: profile, error } = await adminClient.from("profiles").select("role,active").eq("id", userData.user.id).maybeSingle();
  if (error) return { response: NextResponse.json({ error: error.message }, { status: 403 }) };
  const role = profile?.role?.trim().toLowerCase();
  const allowed = profile?.active !== false && (adminOnly ? role === "admin" : role === "admin" || role === "developer");
  if (!allowed) return { response: NextResponse.json({ error: adminOnly ? "Only administrators can delete tenancies." : "Only administrators or developers can manage tenancies." }, { status: 403 }) };
  return { adminClient, actorUserId: userData.user.id };
}

function optionalText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function requiredDate(value: unknown, label: string) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${label} is required.`);
  return value;
}

function optionalDate(value: unknown, label: string) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${label} must be a valid date.`);
  return value;
}

function requiredMoney(value: unknown, label: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${label} must be zero or more.`);
  return parsed;
}

function optionalNumber(value: unknown, label: string, minimum: number, maximum?: number) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < minimum || (maximum !== undefined && parsed > maximum)) throw new Error(`${label} is invalid.`);
  return parsed;
}

function tenancyArguments(payload: TenancyPayload) {
  const tenantName = optionalText(payload.tenantName);
  if (!tenantName) throw new Error("Tenant name is required.");
  const start = requiredDate(payload.tenancyStartDate, "Tenancy start date");
  const fixedEnd = optionalDate(payload.fixedTermEndDate, "Fixed-term end date");
  const actualEnd = optionalDate(payload.tenancyEndDate, "Actual tenancy end date");
  if (fixedEnd && fixedEnd < start) throw new Error("Fixed-term end date cannot be before the tenancy start date.");
  if (actualEnd && actualEnd < start) throw new Error("Actual tenancy end date cannot be before the tenancy start date.");
  const sourceType = payload.sourceType ?? "manual";
  if (!sourceTypes.has(sourceType)) throw new Error("Choose a valid tenancy source.");
  return {
    p_tenant_name: tenantName,
    p_tenancy_start_date: start,
    p_fixed_term_end_date: fixedEnd,
    p_tenancy_end_date: actualEnd,
    p_monthly_rent: requiredMoney(payload.monthlyRent, "Monthly rent"),
    p_rent_due_day: optionalNumber(payload.rentDueDay, "Rent due day", 1, 31),
    p_deposit_amount: optionalNumber(payload.depositAmount, "Deposit amount", 0),
    p_letting_agent_organisation_id: optionalText(payload.lettingAgentOrganisationId),
    p_notes: optionalText(payload.notes),
    p_source_type: sourceType,
    p_source_reference: optionalText(payload.sourceReference),
  };
}

function errorMessage(error: unknown) {
  if (error && typeof error === "object" && "code" in error && error.code === "23P01") return "This tenancy overlaps another tenancy for the unit.";
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") return error.message;
  return "Tenancy could not be saved.";
}

export async function GET(request: Request) {
  const { adminClient, response } = await getTenancyManager(request);
  if (response || !adminClient) return response;
  const { data, error } = await adminClient.from("unit_tenancies").select("*").order("tenancy_start_date", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ tenancies: data ?? [] });
}

export async function POST(request: Request) {
  try {
    const { adminClient, actorUserId, response } = await getTenancyManager(request);
    if (response || !adminClient || !actorUserId) return response;
    const payload = await request.json() as TenancyPayload;
    if (!payload.buildingId || !payload.unitId) throw new Error("Building and unit are required.");
    const { data, error } = await adminClient.rpc("create_unit_tenancy", {
      p_actor_user_id: actorUserId,
      p_building_id: payload.buildingId,
      p_unit_id: payload.unitId,
      ...tenancyArguments(payload),
    });
    if (error) throw error;
    return NextResponse.json({ tenancy: data });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 400 });
  }
}

export async function PATCH(request: Request) {
  try {
    const { adminClient, actorUserId, response } = await getTenancyManager(request);
    if (response || !adminClient || !actorUserId) return response;
    const payload = await request.json() as TenancyPayload;
    if (!payload.tenancyId) throw new Error("Tenancy is required.");
    const { data, error } = await adminClient.rpc("update_unit_tenancy", {
      p_actor_user_id: actorUserId,
      p_tenancy_id: payload.tenancyId,
      ...tenancyArguments(payload),
    });
    if (error) throw error;
    return NextResponse.json({ tenancy: data });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  try {
    const { adminClient, actorUserId, response } = await getTenancyManager(request, true);
    if (response || !adminClient || !actorUserId) return response;
    const payload = await request.json() as TenancyPayload;
    if (!payload.tenancyId || !optionalText(payload.reason)) throw new Error("Tenancy and deletion reason are required.");
    const { data, error } = await adminClient.rpc("delete_unit_tenancy", { p_actor_user_id: actorUserId, p_tenancy_id: payload.tenancyId, p_reason: payload.reason });
    if (error) throw error;
    return NextResponse.json({ deletedTenancyId: data });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 400 });
  }
}
