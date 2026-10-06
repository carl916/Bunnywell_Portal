import { createSupabaseServiceRoleClient } from "@/lib/supabase/admin";
import { cleanCompletionUploads } from "@/lib/sales/completion-upload-server";

export const maxDuration = 300;
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return Response.json({ error: "Unauthorised." }, { status: 401 });
  try { return Response.json(await cleanCompletionUploads(createSupabaseServiceRoleClient())); }
  catch { return Response.json({ error: "Upload cleanup failed. Retry the cleanup job." }, { status: 500 }); }
}
