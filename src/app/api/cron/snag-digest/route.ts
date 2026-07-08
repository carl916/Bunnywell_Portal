import { NextResponse, type NextRequest } from "next/server";
import { runSnagDigest } from "@/lib/digests/snag-digest";

export const dynamic = "force-dynamic";

function cronAuthorized(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization");

  if (!secret && process.env.NODE_ENV !== "production") return true;
  if (!secret) return false;
  return authorization === `Bearer ${secret}`;
}

export async function GET(request: NextRequest) {
  if (!cronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorised cron request." }, { status: 401 });
  }

  try {
    const result = await runSnagDigest({
      force: request.nextUrl.searchParams.get("force") === "1",
      origin: request.nextUrl.origin,
    });

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { status: "failed", error: error instanceof Error ? error.message : "Unexpected error." },
      { status: 500 },
    );
  }
}
