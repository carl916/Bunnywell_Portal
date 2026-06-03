import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import type { UserRole } from "@/lib/data/demo";

type CreateUserBody = {
  email?: string;
  password?: string;
  fullName?: string;
  role?: UserRole;
};

function env(name: string) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is not configured.`);
  }

  return value;
}

export async function POST(request: Request) {
  try {
    const token = request.headers.get("authorization")?.replace("Bearer ", "");

    if (!token) {
      return NextResponse.json({ error: "Missing session token." }, { status: 401 });
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
      return NextResponse.json({ error: "Invalid session." }, { status: 401 });
    }

    const { data: requester } = await adminClient
      .from("profiles")
      .select("role")
      .eq("id", userData.user.id)
      .single();

    if (requester?.role !== "admin") {
      return NextResponse.json({ error: "Only admins can create users." }, { status: 403 });
    }

    const body = (await request.json()) as CreateUserBody;
    const email = body.email?.trim();
    const password = body.password?.trim();
    const role = body.role ?? "user";

    if (!email || !password) {
      return NextResponse.json({ error: "Email and password are required." }, { status: 400 });
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
      role,
    });

    return NextResponse.json({ id: data.user.id, email, role });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unexpected error." },
      { status: 500 },
    );
  }
}
