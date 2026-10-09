import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { dashboardRoleAllowed, deriveDashboard } from "@/lib/dashboard/model";
import { DashboardAccessError, dashboardAccessKey, loadDashboardInput } from "@/lib/dashboard/read";
import { DashboardReadDiagnostics } from "@/lib/dashboard/read-diagnostics";
import { SalesServerTiming } from "@/lib/sales/server-performance";
import { requiredEnv } from "@/lib/supabase/admin";

const headers = { "Cache-Control": "private, no-store, max-age=0", Vary: "Authorization" };
export async function GET(request: Request) {
  const timing = new SalesServerTiming();
  const trace = new DashboardReadDiagnostics(request, "dashboard", timing.fetch);
  const respond = (body: unknown, status = 200) => trace.response(timing.response(NextResponse.json(body, { status, headers })));
  const token = request.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
  if (!token) return respond({ error: "Sign in to see your organisation’s work." }, 401);
  const params = new URL(request.url).searchParams;
  const building = params.get("building") ?? "all";
  if (building !== "all" && !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(building)) return respond({ error: "Invalid building scope." }, 400);
  // Reject unsupported record parameters rather than letting a URL act as an access grant.
  if ([...params.keys()].some(key => key !== "building")) return respond({ error: "Unsupported dashboard filter." }, 400);
  try {
    const client = createClient(requiredEnv("NEXT_PUBLIC_SUPABASE_URL"), requiredEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"), {
      auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: trace.fetch, headers: { Authorization: `Bearer ${token}` } },
    });
    const auth = await client.auth.getUser(token);
    if (auth.error || !auth.data.user) return respond({ error: "Your session has expired. Sign in again." }, 401);
    trace.setStage("profile.initial");
    const profile = await client.from("profiles").select("id,role,organisation_id,active").eq("id", auth.data.user.id).single();
    if (profile.error || profile.data.active !== true || !dashboardRoleAllowed(profile.data.role)) return respond({ error: "This account cannot open an organisation worklist." }, 403);
    trace.authorize(profile.data.role);
    trace.setStage("access.initial");
    const accessBefore = await dashboardAccessKey(client, profile.data);
    trace.setStage("data");
    const input = await loadDashboardInput(client, profile.data, building === "all" ? "" : building);
    // Recheck active profile after reads; no response is reused across identities or requests.
    trace.setStage("profile.final");
    const current = await client.from("profiles").select("id,role,organisation_id,active").eq("id", auth.data.user.id).single();
    if (current.error || JSON.stringify(current.data) !== JSON.stringify(profile.data)) return respond({ error: "Your access changed. Reload the portal." }, 403);
    trace.setStage("access.final");
    if (accessBefore !== await dashboardAccessKey(client, current.data)) return respond({ error: "Your building or unit access changed. Reload the portal." }, 403);
    trace.setStage("derive");
    return respond(deriveDashboard(input));
  } catch (error) {
    if (error instanceof DashboardAccessError) return respond({ error: error.message }, 403);
    return respond({ error: "Your worklist is unavailable. Refresh to retry." }, 503);
  }
}
