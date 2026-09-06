import { NextResponse } from "next/server";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/admin";

export async function POST(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) {
    return NextResponse.json({ error: "Missing session token." }, { status: 401 });
  }

  const adminClient = createSupabaseServiceRoleClient();
  const { data: userData, error: userError } = await adminClient.auth.getUser(token);

  if (userError || !userData.user) {
    return NextResponse.json({ error: "Invalid session." }, { status: 401 });
  }

  const { data: profile, error: profileError } = await adminClient
    .from("profiles")
    .select("active")
    .eq("id", userData.user.id)
    .maybeSingle();

  if (profileError) {
    return NextResponse.json({ error: profileError.message }, { status: 400 });
  }

  if (!profile) {
    return NextResponse.json({ error: "Portal profile not found." }, { status: 404 });
  }

  if (profile.active === false) {
    return NextResponse.json({ error: "Portal account is deactivated." }, { status: 403 });
  }

  const lastActiveAt = new Date().toISOString();
  const { error: updateError } = await adminClient
    .from("profiles")
    .update({ last_active_at: lastActiveAt })
    .eq("id", userData.user.id);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 400 });
  }

  return NextResponse.json({ lastActiveAt });
}
