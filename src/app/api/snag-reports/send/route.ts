import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import type { AppRole } from "@/lib/data/production";

export const dynamic = "force-dynamic";

type LocationType = "unit" | "communal";

type SendSnagReportBody = {
  action?: "preview" | "prepare_upload" | "send";
  buildingId?: string;
  locationType?: LocationType;
  unitId?: string | null;
  communalAreaId?: string | null;
  locationLabel?: string;
  includePhotos?: boolean;
  includeClosedSnags?: boolean;
  snagIds?: string[];
  filePath?: string;
  filename?: string;
};

type RequesterProfile = {
  id: string;
  email: string | null;
  name: string | null;
  full_name: string | null;
  role: AppRole | string | null;
  organisation_id: string | null;
  active: boolean | null;
};

type ContractorRecipient = {
  id: string;
  email: string;
  name: string | null;
  full_name: string | null;
  organisation_id: string | null;
};

type EmailPayload = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

function env(name: string) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is not configured.`);
  }

  return value;
}

function normalizeEmail(value?: string | null) {
  return value?.trim().toLowerCase() ?? "";
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function pluralise(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function safeFilename(value?: string | null) {
  return (value ?? "snag-report").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "snag-report";
}

function createServiceClient() {
  const url = env("NEXT_PUBLIC_SUPABASE_URL");
  const anonKey = env("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const serviceRoleKey = env("SUPABASE_SERVICE_ROLE_KEY");

  if (serviceRoleKey === anonKey || serviceRoleKey.startsWith("sb_publishable_")) {
    throw new Error("Server is not configured with a Supabase service role key.");
  }

  return {
    adminClient: createClient(url, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    }),
    authClient: createClient(url, anonKey),
  };
}

async function getRequester(request: Request) {
  const token = request.headers.get("authorization")?.replace("Bearer ", "");

  if (!token) {
    return { response: NextResponse.json({ error: "Missing session token." }, { status: 401 }) };
  }

  const { adminClient, authClient } = createServiceClient();
  const { data: userData, error: userError } = await authClient.auth.getUser(token);

  if (userError || !userData.user) {
    return { response: NextResponse.json({ error: "Invalid session." }, { status: 401 }) };
  }

  const { data: requesterById, error: requesterError } = await adminClient
    .from("profiles")
    .select("id,email,name,full_name,role,organisation_id,active")
    .eq("id", userData.user.id)
    .maybeSingle();

  if (requesterError) {
    return { response: NextResponse.json({ error: requesterError.message }, { status: 403 }) };
  }

  const requester = requesterById as RequesterProfile | null;
  const requesterRole = requester?.role?.trim().toLowerCase();
  const requesterActive = requester?.active !== false;

  if (!["admin", "developer", "developer_representative"].includes(requesterRole ?? "") || !requesterActive) {
    return {
      response: NextResponse.json({
        error: "Only active admins, developers or developer representatives can send snag reports.",
      }, { status: 403 }),
    };
  }

  if (!requester?.id) {
    return { response: NextResponse.json({ error: "Portal profile not found." }, { status: 403 }) };
  }

  return { adminClient, requester };
}

async function requesterCanSendForBuilding(adminClient: SupabaseClient, requester: RequesterProfile, buildingId: string) {
  const role = requester.role?.trim().toLowerCase();
  if (role === "admin" || role === "developer") return true;
  if (role !== "developer_representative") return false;

  const [{ data: directAccess, error: directAccessError }, { data: organisationAccess, error: organisationAccessError }] = await Promise.all([
    adminClient
      .from("user_building_access")
      .select("building_id")
      .eq("user_id", requester.id)
      .eq("building_id", buildingId)
      .maybeSingle(),
    requester.organisation_id
      ? adminClient
        .from("building_organisations")
        .select("id")
        .eq("building_id", buildingId)
        .eq("organisation_id", requester.organisation_id)
        .eq("role_on_project", "developer_representative")
        .neq("active", false)
        .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);

  if (directAccessError || organisationAccessError) {
    throw new Error(directAccessError?.message ?? organisationAccessError?.message ?? "Could not verify building access.");
  }

  return Boolean(directAccess || organisationAccess);
}

async function contractorRecipientsForBuilding(adminClient: SupabaseClient, buildingId: string) {
  const [{ data: links, error: linksError }, { data: accessRows, error: accessError }, { data: profiles, error: profilesError }] = await Promise.all([
    adminClient
      .from("building_organisations")
      .select("organisation_id")
      .eq("building_id", buildingId)
      .eq("role_on_project", "main_contractor")
      .neq("active", false),
    adminClient
      .from("user_building_access")
      .select("user_id,building_id")
      .eq("building_id", buildingId),
    adminClient
      .from("profiles")
      .select("id,email,name,full_name,role,organisation_id,active")
      .eq("role", "contractor")
      .neq("active", false),
  ]);

  if (linksError || accessError || profilesError) {
    throw new Error(linksError?.message ?? accessError?.message ?? profilesError?.message ?? "Could not load contractor recipients.");
  }

  const mainContractorOrganisationIds = new Set((links ?? []).map((link) => link.organisation_id).filter(Boolean));
  const directBuildingUserIds = new Set((accessRows ?? []).map((access) => access.user_id).filter(Boolean));
  const recipients = ((profiles ?? []) as ContractorRecipient[])
    .filter((profile) => normalizeEmail(profile.email))
    .filter((profile) => {
      if (profile.organisation_id && mainContractorOrganisationIds.has(profile.organisation_id)) return true;
      return directBuildingUserIds.has(profile.id);
    });

  const unique = new Map<string, ContractorRecipient>();
  recipients.forEach((recipient) => unique.set(normalizeEmail(recipient.email), recipient));
  return Array.from(unique.values());
}

function buildEmail(params: {
  appUrl: string;
  buildingName: string;
  locationLabel: string;
  reportUrl: string;
  snagCount: number;
}) {
  const subject = `Bunnywell snag report: ${params.buildingName} / ${params.locationLabel}`;
  const safeBuilding = escapeHtml(params.buildingName);
  const safeLocation = escapeHtml(params.locationLabel);
  const safeReportUrl = escapeHtml(params.reportUrl);
  const safeAppUrl = escapeHtml(params.appUrl);
  const snagCountText = pluralise(params.snagCount, "snag");

  return {
    subject,
    html: `
      <div style="margin:0;padding:24px;background:#f5f2ea;font-family:Arial,sans-serif;color:#0f3d31;">
        <div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #ded8c9;border-radius:12px;padding:28px;">
          <p style="margin:0 0 10px;font-size:12px;letter-spacing:4px;color:#d6a23a;font-weight:700;">BUNNYWELL PORTAL</p>
          <h1 style="margin:0 0 16px;font-size:28px;line-height:1.2;color:#0f3d31;">Snag report</h1>
          <p style="margin:0 0 18px;color:#617169;font-size:15px;line-height:1.5;">A snag report has been issued for <strong>${safeBuilding}</strong>.</p>
          <div style="border:1px solid #d8ded8;border-radius:10px;padding:16px;margin:0 0 22px;background:#f8faf7;">
            <p style="margin:0 0 8px;"><strong>Area:</strong> ${safeLocation}</p>
            <p style="margin:0;"><strong>Included:</strong> ${snagCountText}</p>
          </div>
          <p style="margin:0 0 18px;color:#617169;font-size:14px;line-height:1.5;">Use the button below to open the PDF report. The link is secure and time limited.</p>
          <p style="margin:0 0 20px;"><a href="${safeReportUrl}" style="display:inline-block;background:#0f3d31;color:#ffffff;text-decoration:none;border-radius:10px;padding:12px 18px;font-weight:700;">Open PDF report</a></p>
          <p style="margin:0;color:#617169;font-size:13px;">You can also open the portal here: <a href="${safeAppUrl}" style="color:#0f3d31;">${safeAppUrl}</a></p>
        </div>
      </div>
    `,
    text: [
      "Bunnywell Portal snag report",
      "",
      `Building: ${params.buildingName}`,
      `Area: ${params.locationLabel}`,
      `Included: ${snagCountText}`,
      "",
      `Open PDF report: ${params.reportUrl}`,
      `Open portal: ${params.appUrl}`,
    ].join("\n"),
  };
}

async function sendResendEmail(email: EmailPayload) {
  const resendApiKey = process.env.RESEND_API_KEY;
  const dryRunTo = normalizeEmail(process.env.DIGEST_DRY_RUN_EMAIL);
  const to = dryRunTo || email.to;

  if (!resendApiKey) {
    throw new Error("RESEND_API_KEY is not configured.");
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: process.env.DIGEST_FROM_EMAIL || "Bunnywell Portal <no-reply@bunnywell.co.uk>",
      to,
      subject: dryRunTo ? `[Dry run for ${email.to}] ${email.subject}` : email.subject,
      html: dryRunTo ? email.html.replace("<div ", `<div data-dry-run="for-${escapeHtml(email.to)}" `) : email.html,
      text: dryRunTo ? `Dry run for ${email.to}\n\n${email.text}` : email.text,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Resend email failed: ${response.status} ${body}`);
  }
}

export async function POST(request: Request) {
  try {
    const requesterResult = await getRequester(request);
    if (requesterResult.response || !requesterResult.adminClient || !requesterResult.requester) return requesterResult.response;

    const { adminClient, requester } = requesterResult;
    const body = (await request.json()) as SendSnagReportBody;
    const action = body.action ?? "send";
    const buildingId = body.buildingId?.trim();
    const locationType = body.locationType;
    const locationLabel = body.locationLabel?.trim() || "Selected area";
    const includePhotos = body.includePhotos ?? true;
    const includeClosedSnags = body.includeClosedSnags ?? false;
    const snagIds = Array.from(new Set((body.snagIds ?? []).filter(Boolean)));
    const filename = `${safeFilename(body.filename)}.pdf`;

    if (!buildingId) return NextResponse.json({ error: "Choose a building." }, { status: 400 });
    if (action !== "preview" && action !== "prepare_upload" && action !== "send") return NextResponse.json({ error: "Unsupported report action." }, { status: 400 });

    const canSend = await requesterCanSendForBuilding(adminClient, requester, buildingId);
    if (!canSend) {
      return NextResponse.json({ error: "You do not have access to send reports for this building." }, { status: 403 });
    }

    const recipients = await contractorRecipientsForBuilding(adminClient, buildingId);
    if (recipients.length === 0) {
      return NextResponse.json({ error: "No contractor users are linked to this building." }, { status: 400 });
    }

    if (action === "preview") {
      return NextResponse.json({
        recipients: recipients.map((recipient) => ({
          id: recipient.id,
          email: recipient.email,
          name: recipient.full_name || recipient.name,
        })),
      });
    }

    if (action === "prepare_upload") {
      const filePath = `reports/${buildingId}/${crypto.randomUUID()}-${filename}`;
      const { data: uploadData, error: uploadError } = await adminClient.storage.from("snag-reports").createSignedUploadUrl(filePath);

      if (uploadError || !uploadData?.token) {
        return NextResponse.json({
          error: `Could not prepare report upload. Run the snag reports migration if this is the first report being sent. ${uploadError?.message ?? ""}`.trim(),
        }, { status: 400 });
      }

      return NextResponse.json({
        filePath,
        token: uploadData.token,
      });
    }

    if (locationType !== "unit" && locationType !== "communal") return NextResponse.json({ error: "Choose a flat or communal report." }, { status: 400 });
    if (locationType === "unit" && !body.unitId) return NextResponse.json({ error: "Choose a flat." }, { status: 400 });
    if (snagIds.length === 0) return NextResponse.json({ error: "There are no snags to send." }, { status: 400 });
    const filePath = body.filePath?.trim();
    if (!filePath || !filePath.startsWith(`reports/${buildingId}/`)) return NextResponse.json({ error: "Stored report PDF is missing." }, { status: 400 });

    const [{ data: building, error: buildingError }, { data: communalAreas, error: communalAreasError }] = await Promise.all([
      adminClient.from("buildings").select("id,name").eq("id", buildingId).maybeSingle(),
      adminClient.from("areas").select("id").eq("building_id", buildingId).eq("area_type", "communal_area"),
    ]);

    if (buildingError || communalAreasError) {
      return NextResponse.json({ error: buildingError?.message ?? communalAreasError?.message ?? "Could not verify report location." }, { status: 400 });
    }

    if (!building) {
      return NextResponse.json({ error: "Building not found." }, { status: 404 });
    }

    const { data: snags, error: snagsError } = await adminClient
      .from("snags")
      .select("id,building_id,unit_id,area_id,status")
      .in("id", snagIds);

    if (snagsError) {
      return NextResponse.json({ error: snagsError.message }, { status: 400 });
    }

    const communalAreaIds = new Set((communalAreas ?? []).map((area) => area.id));
    const validSnagIds = new Set(
      (snags ?? [])
        .filter((snag) => snag.building_id === buildingId)
        .filter((snag) => includeClosedSnags || snag.status !== "closed")
        .filter((snag) => {
          if (locationType === "unit") return snag.unit_id === body.unitId;
          if (body.communalAreaId) return !snag.unit_id && snag.area_id === body.communalAreaId;
          return !snag.unit_id && snag.area_id && communalAreaIds.has(snag.area_id);
        })
        .map((snag) => snag.id),
    );

    if (validSnagIds.size !== snagIds.length) {
      return NextResponse.json({ error: "The selected snags no longer match the report filters. Reload and try again." }, { status: 400 });
    }

    const { data: signedUrlData, error: signedUrlError } = await adminClient.storage.from("snag-reports").createSignedUrl(filePath, 60 * 60 * 24 * 14);
    if (signedUrlError || !signedUrlData?.signedUrl) {
      return NextResponse.json({ error: signedUrlError?.message ?? "Could not create secure report link." }, { status: 400 });
    }

    const { data: report, error: reportError } = await adminClient
      .from("snag_reports")
      .insert({
        building_id: buildingId,
        unit_id: locationType === "unit" ? body.unitId : null,
        communal_area_id: locationType === "communal" ? body.communalAreaId || null : null,
        location_type: locationType,
        location_label: locationLabel,
        include_photos: includePhotos,
        include_closed_snags: includeClosedSnags,
        snag_count: snagIds.length,
        file_path: filePath,
        file_url: signedUrlData.signedUrl,
        sent_by_user_id: requester.id,
        sent_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (reportError || !report?.id) {
      return NextResponse.json({ error: reportError?.message ?? "Could not record snag report." }, { status: 400 });
    }

    const reportId = report.id as string;
    const itemRows = snagIds.map((snagId, index) => ({
      report_id: reportId,
      snag_id: snagId,
      sort_order: index + 1,
    }));
    const { error: itemsError } = await adminClient.from("snag_report_items").insert(itemRows);

    if (itemsError) {
      return NextResponse.json({ error: itemsError.message }, { status: 400 });
    }

    const recipientRows = recipients.map((recipient) => ({
      report_id: reportId,
      user_id: recipient.id,
      email: normalizeEmail(recipient.email),
      name: recipient.full_name || recipient.name,
      organisation_id: recipient.organisation_id,
      delivery_status: "pending",
    }));
    const { data: insertedRecipients, error: recipientsError } = await adminClient
      .from("snag_report_recipients")
      .insert(recipientRows)
      .select("id,email,name,user_id,organisation_id");

    if (recipientsError) {
      return NextResponse.json({ error: recipientsError.message }, { status: 400 });
    }

    const appUrl = process.env.DIGEST_APP_URL || new URL(request.url).origin;
    const emailBody = buildEmail({
      appUrl,
      buildingName: String(building.name ?? "Building"),
      locationLabel,
      reportUrl: signedUrlData.signedUrl,
      snagCount: snagIds.length,
    });
    const failedRecipients: { email: string; error: string }[] = [];
    const sentRecipientEmails: string[] = [];

    for (const recipient of insertedRecipients ?? []) {
      try {
        await sendResendEmail({
          to: recipient.email,
          subject: emailBody.subject,
          html: emailBody.html,
          text: emailBody.text,
        });
        sentRecipientEmails.push(recipient.email);
        await adminClient
          .from("snag_report_recipients")
          .update({ delivery_status: "sent", sent_at: new Date().toISOString(), error_message: null })
          .eq("id", recipient.id);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Email could not be sent.";
        failedRecipients.push({ email: recipient.email, error: message });
        await adminClient
          .from("snag_report_recipients")
          .update({ delivery_status: "failed", error_message: message })
          .eq("id", recipient.id);
      }
    }

    await adminClient.from("audit_events").insert({
      event_type: "report_sent",
      entity_type: "report",
      entity_id: reportId,
      summary: `Snag report sent: ${building.name ?? "Building"} / ${locationLabel}`,
      metadata: {
        buildingId,
        buildingName: building.name,
        locationType,
        locationLabel,
        unitId: locationType === "unit" ? body.unitId : null,
        communalAreaId: locationType === "communal" ? body.communalAreaId || null : null,
        snagCount: snagIds.length,
        recipients: (insertedRecipients ?? []).map((recipient) => recipient.email),
        failedRecipients,
      },
      created_by_user_id: requester.id,
    });

    return NextResponse.json({
      reportId,
      recipients: (insertedRecipients ?? []).map((recipient) => ({
        email: recipient.email,
        name: recipient.name,
      })),
      sentCount: sentRecipientEmails.length,
      failedRecipients,
      reportUrl: signedUrlData.signedUrl,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not send snag report." },
      { status: 500 },
    );
  }
}
