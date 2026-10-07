import { createClient } from "@supabase/supabase-js";

export function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

export function createSupabaseServiceRoleClient(diagnosticFetch?: typeof fetch, verifiedActorId?: string) {
  const url = requiredEnv("NEXT_PUBLIC_SUPABASE_URL");
  const anonKey = requiredEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");

  if (serviceRoleKey === anonKey || serviceRoleKey.startsWith("sb_publishable_")) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY must be a private Supabase service role key.");
  }

  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: {
      ...(diagnosticFetch ? { fetch: diagnosticFetch } : {}),
      // Callers must obtain this ID from auth.getUser(), never request payloads.
      ...(verifiedActorId ? { headers: { "x-bunnywell-audit-actor": verifiedActorId } } : {}),
    },
  });
}

export function createSupabaseAdminClient() {
  return createSupabaseServiceRoleClient();
}
