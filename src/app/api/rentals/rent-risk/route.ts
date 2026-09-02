import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { createSupabaseServiceRoleClient, requiredEnv } from "@/lib/supabase/admin";

async function getRentalRiskReader(request: Request) {
  const token = request.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) return { response: NextResponse.json({ error: "Missing session token." }, { status: 401 }) };

  const adminClient = createSupabaseServiceRoleClient();
  const { data: userData, error: userError } = await adminClient.auth.getUser(token);
  if (userError || !userData.user) return { response: NextResponse.json({ error: "Invalid session." }, { status: 401 }) };
  const { data: profile, error: profileError } = await adminClient
    .from("profiles")
    .select("role,active")
    .eq("id", userData.user.id)
    .maybeSingle();
  if (profileError) return { response: NextResponse.json({ error: profileError.message }, { status: 403 }) };
  const role = profile?.role?.trim().toLowerCase();
  if (profile?.active === false || (role !== "admin" && role !== "developer")) {
    return { response: NextResponse.json({ error: "Only administrators or developers can view rental risk." }, { status: 403 }) };
  }

  const userClient = createClient(requiredEnv("NEXT_PUBLIC_SUPABASE_URL"), requiredEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"), {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  return { userClient };
}

function numberOrNull(value: unknown) {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function GET(request: Request) {
  const { userClient, response } = await getRentalRiskReader(request);
  if (response || !userClient) return response;

  const [episodesResult, eventsResult, importResult] = await Promise.all([
    userClient
      .from("rental_arrears_episodes")
      .select("id,tenancy_id,agent_tenancy_reference,first_reported_at,last_reported_at,cleared_at,initial_reported_amount,maximum_reported_amount,latest_reported_amount,status,intervention_level,owner_action_required,resolution_basis,management_summary,source_reference,created_at,updated_at")
      .eq("attribution_status", "matched")
      .order("first_reported_at", { ascending: false }),
    userClient
      .from("rental_arrears_events")
      .select("id,episode_id,event_at,event_type,reported_amount,summary,source_reference,source_kind,evidence_confidence,created_at")
      .order("event_at", { ascending: false }),
    userClient
      .from("rental_import_runs")
      .select("id,building_id,source_reference,status,started_at,completed_at,data_as_of,episodes_imported,events_imported,error_count,errors,data_quality_issue_count,data_quality_issues,created_at,updated_at")
      .eq("status", "succeeded")
      .order("completed_at", { ascending: false })
      .limit(20),
  ]);

  const error = episodesResult.error ?? eventsResult.error ?? importResult.error;
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const episodes = (episodesResult.data ?? []).map((episode) => ({
    ...episode,
    initial_reported_amount: numberOrNull(episode.initial_reported_amount) ?? 0,
    maximum_reported_amount: numberOrNull(episode.maximum_reported_amount) ?? 0,
    latest_reported_amount: numberOrNull(episode.latest_reported_amount),
  }));
  const matchedEpisodeIds = new Set(episodes.map((episode) => episode.id));

  return NextResponse.json({
    episodes,
    events: (eventsResult.data ?? [])
      .filter((event) => matchedEpisodeIds.has(event.episode_id))
      .map((event) => ({
        ...event,
        reported_amount: numberOrNull(event.reported_amount),
      })),
    imports: importResult.data ?? [],
  });
}
