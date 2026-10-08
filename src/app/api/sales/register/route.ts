import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { DashboardAccessError, dashboardAccessKey, loadDashboardInput } from "@/lib/dashboard/read";
import { deriveSalesRegister } from "@/lib/sales/register";
import { SalesServerTiming } from "@/lib/sales/server-performance";
import { requiredEnv } from "@/lib/supabase/admin";

const headers = { "Cache-Control": "private, no-store, max-age=0", Vary: "Authorization" };
export async function GET(request: Request) {
  const timing = new SalesServerTiming();
  const respond = (body: unknown, status = 200) => timing.response(NextResponse.json(body, { status, headers }));
  const token = request.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
  if (!token) return respond({ error: "Sign in to see Sales." }, 401);
  const params = new URL(request.url).searchParams;
  const building = params.get("building") ?? "all";
  if ([...params.keys()].some(key => key !== "building") || building !== "all" && !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(building)) return respond({ error: "Invalid Sales scope." }, 400);
  try {
    const client = createClient(requiredEnv("NEXT_PUBLIC_SUPABASE_URL"), requiredEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"), {
      auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: timing.fetch, headers: { Authorization: `Bearer ${token}` } },
    });
    const auth = await client.auth.getUser(token);
    if (auth.error || !auth.data.user) return respond({ error: "Your session has expired. Sign in again." }, 401);
    const profile = await client.from("profiles").select("id,role,organisation_id,active").eq("id", auth.data.user.id).single();
    if (profile.error || !profile.data?.active || profile.data.role !== "conveyancer") return respond({ error: "This account cannot open this Sales register." }, 403);
    const accessBefore = await dashboardAccessKey(client, profile.data);
    const input = await loadDashboardInput(client, profile.data, building === "all" ? "" : building, Date.now(), "sales-register");
    const current = await client.from("profiles").select("id,role,organisation_id,active").eq("id", auth.data.user.id).single();
    if (current.error || JSON.stringify(current.data) !== JSON.stringify(profile.data) || accessBefore !== await dashboardAccessKey(client, current.data)) return respond({ error: "Your access changed. Reload the portal." }, 403);
    return respond(deriveSalesRegister(input));
  } catch (error) {
    if (error instanceof DashboardAccessError) return respond({ error: error.message }, 403);
    return respond({ error: "Sales information is unavailable. Use Refresh to retry." }, 503);
  }
}
