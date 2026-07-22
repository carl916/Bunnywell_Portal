import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { POC_SALES_SOLICITOR_FEE, calculateSchemeSales, canEditIncentiveModel, unitNetSalesProceeds, type SalesUnitInput } from "@/lib/sales/calculations";

type RequesterProfile = {
  id: string;
  email: string | null;
  role: string | null;
  active: boolean | null;
  organisation_id: string | null;
};

type SalesSettingsRow = {
  building_id: string;
  total_development_cost: number | null;
  total_debt: number | null;
};

type UnitRow = {
  id: string;
  building_id: string;
  unit_number: string;
  floor: string | null;
  sale_status: string;
  completion_date: string | null;
  handover_date: string | null;
};

type SaleRecordRow = {
  id: string;
  building_id: string;
  unit_id: string;
  buyer_name: string | null;
  reservation_date: string | null;
  contract_price: number | null;
  estimated_list_price: number | null;
  list_price: number | null;
  reservation_fee: number | null;
  agent_fee_amount: number | null;
  agent_fee_percent: number | null;
  parking_value: number | null;
  solicitor_fee_amount: number | null;
  developer_contribution_value: number | null;
  agent_contribution_value: number | null;
  completion_funds_adjustment: number | null;
  agent_invoice_deduction_value: number | null;
  reservation_form_status: string | null;
  exchange_approval_status: string | null;
  agent_invoice_status: string | null;
  incentives_approval_status: string | null;
  updated_at: string;
};

function env(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

function createClients() {
  const url = env("NEXT_PUBLIC_SUPABASE_URL");
  const anonKey = env("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const serviceRoleKey = env("SUPABASE_SERVICE_ROLE_KEY");

  return {
    adminClient: createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } }),
    authClient: createClient(url, anonKey),
  };
}

async function requesterForRequest(request: Request) {
  const token = request.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) return { response: NextResponse.json({ error: "Missing session token." }, { status: 401 }) };

  const { adminClient, authClient } = createClients();
  const { data: userData, error: userError } = await authClient.auth.getUser(token);
  if (userError || !userData.user) return { response: NextResponse.json({ error: "Invalid session." }, { status: 401 }) };

  const { data: profile, error: profileError } = await adminClient
    .from("profiles")
    .select("id,email,role,active,organisation_id")
    .eq("id", userData.user.id)
    .maybeSingle();

  if (profileError || !profile || profile.active === false) {
    return { response: NextResponse.json({ error: "Sales workspace access denied." }, { status: 403 }) };
  }

  return { adminClient, requester: profile as RequesterProfile };
}

function canOpenSalesWorkspace(role?: string | null) {
  return role === "admin" || role === "developer" || role === "developer_representative" || role === "sales_agent" || role === "conveyancer";
}

function canViewCommercialScheme(role?: string | null) {
  return role === "admin" || role === "developer";
}

async function accessibleBuildingIds(adminClient: SupabaseClient, requester: RequesterProfile) {
  if (canViewCommercialScheme(requester.role)) return null;

  const directAccess = await adminClient
    .from("user_building_access")
    .select("building_id")
    .eq("user_id", requester.id);

  const organisationAccess = requester.organisation_id
    ? await adminClient
      .from("building_organisations")
      .select("building_id")
      .eq("organisation_id", requester.organisation_id)
      .neq("active", false)
    : { data: [], error: null };

  if (directAccess.error || organisationAccess.error) throw directAccess.error ?? organisationAccess.error;
  return Array.from(new Set([
    ...(directAccess.data ?? []).map((row) => row.building_id),
    ...(organisationAccess.data ?? []).map((row) => row.building_id),
  ]));
}

function saleRecordForUnit(records: SaleRecordRow[], unitId: string) {
  return records.find((record) => record.unit_id === unitId);
}

function salesInputForUnit(unit: UnitRow, record?: SaleRecordRow): SalesUnitInput {
  const listPrice = record?.list_price ?? record?.estimated_list_price ?? null;
  const contractPrice = record?.contract_price ?? null;
  const feeBase = contractPrice ?? listPrice;
  const parkingValue = record?.parking_value ?? 0;
  const agentFeePercent = record?.agent_fee_percent ?? 9;
  const calculatedAgentFee = feeBase !== null ? Math.round((feeBase + parkingValue) * (agentFeePercent / 100) * 100) / 100 : null;

  return {
    id: unit.id,
    agentContribution: record?.agent_contribution_value ?? record?.agent_invoice_deduction_value ?? 0,
    agentFee: record?.agent_fee_amount ?? calculatedAgentFee,
    contractPrice,
    developerContribution: record?.developer_contribution_value ?? record?.completion_funds_adjustment ?? 0,
    listPrice,
    reservationPrice: contractPrice,
    saleStatus: unit.sale_status,
    solicitorFee: POC_SALES_SOLICITOR_FEE,
  };
}

function nextAction(unit: UnitRow, record?: SaleRecordRow) {
  if (!record) return unit.sale_status === "for_sale" ? "Ready to reserve" : "Sale record missing";
  if (!record.list_price && !record.estimated_list_price) return "List price missing";
  if (unit.sale_status === "for_sale") return "Reserve unit";
  if (unit.sale_status === "reserved" && record.reservation_form_status !== "approved") return "Approve reservation pack";
  if (unit.sale_status === "reserved" && !record.exchange_approval_status) return "Request exchange approval";
  if (unit.sale_status === "exchanged" && record.agent_invoice_status !== "paid") return "Check agent invoice";
  if (unit.sale_status === "completed") return "Completion recorded";
  return "Review sale file";
}

function moneyInput(value: unknown, label: string) {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`Enter a valid ${label}.`);
  }
  return value;
}

export async function GET(request: Request) {
  try {
    const requesterResult = await requesterForRequest(request);
    if ("response" in requesterResult) return requesterResult.response;
    const { adminClient, requester } = requesterResult;

    if (!canOpenSalesWorkspace(requester.role)) {
      return NextResponse.json({ error: "Sales workspace access denied." }, { status: 403 });
    }

    const url = new URL(request.url);
    const requestedBuildingId = url.searchParams.get("buildingId");
    const canViewSchemeFinancials = canViewCommercialScheme(requester.role);
    const buildingIds = await accessibleBuildingIds(adminClient, requester);

    let buildingsQuery = adminClient.from("buildings").select("id,name,status,pc_date").order("name");
    if (buildingIds) buildingsQuery = buildingsQuery.in("id", buildingIds.length ? buildingIds : ["00000000-0000-0000-0000-000000000000"]);
    const { data: buildings, error: buildingsError } = await buildingsQuery;
    if (buildingsError) throw buildingsError;

    const selectedBuilding = (buildings ?? []).find((building) => building.id === requestedBuildingId) ?? buildings?.[0] ?? null;
    if (!selectedBuilding) return NextResponse.json({ buildings: [], selectedBuilding: null, permissions: { canModelIncentives: false, canViewSchemeFinancials: false, canViewUnitCommercials: false } });

    const [{ data: units, error: unitsError }, { data: records, error: recordsError }, settingsResult] = await Promise.all([
      adminClient.from("units").select("id,building_id,unit_number,floor,sale_status,completion_date,handover_date").eq("building_id", selectedBuilding.id).order("unit_number"),
      adminClient.from("unit_sale_records").select("*").eq("building_id", selectedBuilding.id),
      canViewSchemeFinancials
        ? adminClient.from("building_sales_settings").select("*").eq("building_id", selectedBuilding.id).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);
    if (unitsError || recordsError || settingsResult.error) throw unitsError ?? recordsError ?? settingsResult.error;

    const saleRecords = (records ?? []) as SaleRecordRow[];
    const salesInputs = ((units ?? []) as UnitRow[]).map((unit) => salesInputForUnit(unit, saleRecordForUnit(saleRecords, unit.id)));
    const settings = (settingsResult.data ?? null) as SalesSettingsRow | null;
    const scheme = calculateSchemeSales(salesInputs, {
      totalDebt: settings?.total_debt ?? null,
      totalDevelopmentCost: settings?.total_development_cost ?? null,
    });

    const responseUnits = ((units ?? []) as UnitRow[]).map((unit) => {
      const record = saleRecordForUnit(saleRecords, unit.id);
      const salesInput = salesInputForUnit(unit, record);
      return {
        id: unit.id,
        agentContribution: canViewSchemeFinancials ? salesInput.agentContribution : null,
        agentFee: canViewSchemeFinancials ? salesInput.agentFee : null,
        buyerName: record?.buyer_name ?? null,
        contractPrice: salesInput.contractPrice,
        currentExpectedSalePrice: salesInput.saleStatus === "for_sale" ? salesInput.listPrice : salesInput.contractPrice ?? salesInput.listPrice,
        developerContribution: canViewSchemeFinancials ? salesInput.developerContribution : null,
        floor: unit.floor,
        listPrice: salesInput.listPrice,
        netProceeds: canViewSchemeFinancials ? unitNetSalesProceeds(salesInput) : null,
        nextAction: nextAction(unit, record),
        saleRecordId: record?.id ?? null,
        saleStatus: unit.sale_status,
        solicitorFee: canViewSchemeFinancials ? salesInput.solicitorFee : null,
        timeInStage: record?.updated_at ?? null,
        unitNumber: unit.unit_number,
      };
    });

    return NextResponse.json({
      buildings: buildings ?? [],
      permissions: {
        canEditSettings: canViewSchemeFinancials,
        canModelIncentives: canViewSchemeFinancials,
        canViewSchemeFinancials,
        canViewUnitCommercials: canViewSchemeFinancials,
      },
      scheme: canViewSchemeFinancials
        ? scheme
        : {
          baselineGdv: scheme.baselineGdv,
          currentForecastRevenue: scheme.currentForecastRevenue,
          missingListPriceCount: scheme.missingListPriceCount,
          unitCount: scheme.unitCount,
        },
      selectedBuilding,
      settings: canViewSchemeFinancials ? {
        totalDebt: settings?.total_debt ?? null,
        totalDevelopmentCost: settings?.total_development_cost ?? null,
      } : null,
      units: responseUnits,
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load sales workspace." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const requesterResult = await requesterForRequest(request);
    if ("response" in requesterResult) return requesterResult.response;
    const { adminClient, requester } = requesterResult;
    if (!canViewCommercialScheme(requester.role)) return NextResponse.json({ error: "Commercial edit access denied." }, { status: 403 });

    const body = await request.json() as {
      action?: "settings" | "unit_incentive";
      buildingId?: string;
      unitId?: string;
      totalDebt?: number | null;
      totalDevelopmentCost?: number | null;
      developerContribution?: number | null;
      agentContribution?: number | null;
      contractPrice?: number | null;
      estimatedListPrice?: number | null;
      parkingValue?: number | null;
      otherConcessionsValue?: number | null;
      agentFeePercent?: number | null;
    };

    if (!body.buildingId) return NextResponse.json({ error: "Building is required." }, { status: 400 });

    if (body.action === "settings") {
      const payload = {
        building_id: body.buildingId,
        total_debt: body.totalDebt ?? null,
        total_development_cost: body.totalDevelopmentCost ?? null,
        updated_by: requester.id,
        created_by: requester.id,
      };
      const { error } = await adminClient.from("building_sales_settings").upsert(payload, { onConflict: "building_id" });
      if (error) throw error;
      await adminClient.from("audit_events").insert({
        created_by_user_id: requester.id,
        entity_id: body.buildingId,
        entity_type: "building",
        event_type: "building_sales_settings_updated",
        metadata: payload,
        summary: "Building sales settings updated.",
      });
      return NextResponse.json({ ok: true });
    }

    if (body.action === "unit_incentive") {
      if (!body.unitId) return NextResponse.json({ error: "Unit is required." }, { status: 400 });

      const { data: unit, error: unitError } = await adminClient
        .from("units")
        .select("id,building_id,sale_status")
        .eq("id", body.unitId)
        .eq("building_id", body.buildingId)
        .maybeSingle();
      if (unitError) throw unitError;
      if (!unit) return NextResponse.json({ error: "Unit was not found for this building." }, { status: 404 });
      if (!canEditIncentiveModel(unit.sale_status)) {
        return NextResponse.json({ error: "Deal modelling is locked once a unit is reserved." }, { status: 409 });
      }

      const developerContribution = moneyInput(body.developerContribution, "developer contribution");
      const agentContribution = moneyInput(body.agentContribution, "agent contribution");
      const contractPrice = moneyInput(body.contractPrice, "contract price");
      const estimatedListPrice = moneyInput(body.estimatedListPrice, "list price");
      const parkingValue = moneyInput(body.parkingValue, "parking value");
      const otherConcessionsValue = moneyInput(body.otherConcessionsValue, "other concessions");
      const agentFeePercent = moneyInput(body.agentFeePercent, "agent fee percentage");

      const payload: Record<string, string | number | null | undefined> = {
        building_id: body.buildingId,
        unit_id: body.unitId,
        updated_by: requester.id,
        created_by: requester.id,
      };
      if (agentContribution !== undefined) {
        payload.agent_contribution_value = agentContribution;
        payload.agent_invoice_deduction_value = agentContribution;
      }
      if (developerContribution !== undefined) {
        payload.completion_funds_adjustment = developerContribution;
        payload.developer_contribution_value = developerContribution;
      }
      if (contractPrice !== undefined) payload.contract_price = contractPrice;
      if (estimatedListPrice !== undefined) {
        payload.estimated_list_price = estimatedListPrice;
        payload.list_price = estimatedListPrice;
      }
      if (parkingValue !== undefined) payload.parking_value = parkingValue;
      if (otherConcessionsValue !== undefined) payload.other_concessions_value = otherConcessionsValue;
      if (agentFeePercent !== undefined) payload.agent_fee_percent = agentFeePercent;
      if (developerContribution !== undefined || otherConcessionsValue !== undefined) {
        payload.incentives_value = (developerContribution ?? 0) + (otherConcessionsValue ?? 0);
      }

      const { error } = await adminClient.from("unit_sale_records").upsert(payload, { onConflict: "unit_id" });
      if (error) throw error;
      await adminClient.from("audit_events").insert({
        created_by_user_id: requester.id,
        entity_id: body.unitId,
        entity_type: "unit",
        event_type: "unit_incentive_updated",
        metadata: payload,
        summary: "Unit incentive saved.",
      });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not save sales workspace change." }, { status: 500 });
  }
}
