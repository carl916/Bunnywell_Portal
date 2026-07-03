import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppRole, Area, Building, BuildingOrganisation, ProductionSnag, SnagEvent, Trade, Unit } from "@/lib/data/production";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type DigestProfile = {
  id: string;
  email: string | null;
  name: string | null;
  full_name: string | null;
  role: AppRole | string | null;
  organisation_id: string | null;
  active: boolean | null;
};

type UserBuildingAccess = {
  user_id: string;
  building_id: string;
};

type DigestData = {
  areas: Area[];
  buildings: Building[];
  buildingOrganisations: BuildingOrganisation[];
  events: SnagEvent[];
  profiles: DigestProfile[];
  snags: ProductionSnag[];
  trades: Trade[];
  units: Unit[];
  userBuildingAccess: UserBuildingAccess[];
};

type DigestRecipient = {
  id: string;
  email: string;
  name: string;
  role: AppRole;
  organisationId: string | null;
  buildingIds: Set<string>;
  allBuildings: boolean;
};

type DigestSnagItem = {
  id: string;
  title: string;
  building: string;
  location: string;
  trade: string;
  status: string;
  updatedAt: string;
};

type DigestSection = {
  id: string;
  title: string;
  count: number;
  description: string;
  items: DigestSnagItem[];
};

type RecipientDigest = {
  recipient: DigestRecipient;
  dailySections: DigestSection[];
  weeklySections: DigestSection[];
  dailyCount: number;
  weeklyCount: number;
};

type SendableDigest = {
  recipient: DigestRecipient;
  subject: string;
  html: string;
  text: string;
};

export type SnagDigestResult = {
  status: "sent" | "skipped" | "failed";
  reason?: string;
  digestKey?: string;
  localDate?: string;
  weeklyIncluded?: boolean;
  recipients?: number;
  dryRunTo?: string | null;
  sent?: { to: string; subject: string }[];
};

type RunDigestOptions = {
  force?: boolean;
  origin?: string;
  now?: Date;
};

const digestTimeZone = "Europe/London";
const logoUrl = "https://defects.bunnywell.co.uk/bunnywell-logo-icon.jpg";
const portalFromEmail = "Bunnywell Portal <no-reply@bunnywell.co.uk>";
const maxSnagsPerSection = 6;
const finalStatuses = new Set(["closed", "resolved"]);
const digestRoles = new Set<AppRole>(["admin", "developer", "developer_representative", "contractor"]);

const statusLabels: Record<string, string> = {
  open: "Open",
  resolved_by_contractor: "Ready for review",
  rejected_back_to_contractor: "Rejected back to contractor",
  closed: "Closed",
  needs_more_info: "Needs more info",
};

function statusLabel(value?: string | null) {
  if (!value) return "Unknown";
  return statusLabels[value] ?? value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function normalizeEmail(value?: string | null) {
  return value?.trim().toLowerCase() ?? "";
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function envBoolean(name: string, fallback = false) {
  const value = process.env[name];
  if (value == null || value.trim() === "") return fallback;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function commaList(value?: string | null) {
  return (value ?? "")
    .split(",")
    .map((item) => normalizeEmail(item))
    .filter(Boolean);
}

function localParts(date: Date) {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: digestTimeZone,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));

  return {
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
    dayName: parts.weekday,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

function appUrl(origin?: string) {
  const configured =
    process.env.DIGEST_APP_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    origin;

  if (!configured) return "https://staging.bunnywell.co.uk";
  if (configured.startsWith("http://") || configured.startsWith("https://")) return configured.replace(/\/$/, "");
  return `https://${configured.replace(/\/$/, "")}`;
}

function snagsUrl(origin?: string) {
  return `${appUrl(origin)}?screen=snags`;
}

function isStatusEvent(event: SnagEvent) {
  return ["status_change", "triage"].includes(event.event_type);
}

function isInfoSuppliedEvent(event: SnagEvent) {
  return isStatusEvent(event) && event.old_value === "needs_more_info" && event.new_value === "open";
}

function isFinalSnag(snag: ProductionSnag) {
  return finalStatuses.has(snag.status);
}

function isAfter(value: string | null | undefined, since: Date) {
  return Boolean(value && new Date(value) >= since);
}

function uniqueSnags(snags: ProductionSnag[]) {
  const seen = new Set<string>();
  return snags.filter((snag) => {
    if (seen.has(snag.id)) return false;
    seen.add(snag.id);
    return true;
  });
}

function sortedSnags(snags: ProductionSnag[]) {
  return [...snags].sort((a, b) => new Date(b.updated_at || b.created_at).getTime() - new Date(a.updated_at || a.created_at).getTime());
}

function labelForLocation(snag: ProductionSnag, data: DigestData) {
  const unit = data.units.find((item) => item.id === snag.unit_id);
  const area = data.areas.find((item) => item.id === snag.area_id);
  const unitLabel = unit ? `Flat ${unit.unit_number}` : "Communal";

  return [unitLabel, area?.name].filter(Boolean).join(" / ");
}

function snagItem(snag: ProductionSnag, data: DigestData): DigestSnagItem {
  const building = data.buildings.find((item) => item.id === snag.building_id);
  const trade = data.trades.find((item) => item.id === snag.trade_id);

  return {
    id: snag.id,
    title: snag.title,
    building: building?.name ?? "Unknown building",
    location: labelForLocation(snag, data),
    trade: trade?.name ?? "No trade",
    status: statusLabel(snag.status),
    updatedAt: snag.updated_at || snag.created_at,
  };
}

function sectionFromSnags(id: string, title: string, description: string, snags: ProductionSnag[], data: DigestData): DigestSection {
  const unique = sortedSnags(uniqueSnags(snags));

  return {
    id,
    title,
    count: unique.length,
    description,
    items: unique.slice(0, maxSnagsPerSection).map((snag) => snagItem(snag, data)),
  };
}

function snagsFromEvents(events: SnagEvent[], snagsById: Map<string, ProductionSnag>) {
  return events.map((event) => snagsById.get(event.snag_id)).filter((snag): snag is ProductionSnag => Boolean(snag));
}

function buildRecipients(data: DigestData) {
  const allBuildingIds = new Set(data.buildings.map((building) => building.id));
  const buildingAccessByUser = new Map<string, Set<string>>();
  const buildingAccessByOrganisation = new Map<string, Set<string>>();

  data.userBuildingAccess.forEach((access) => {
    const current = buildingAccessByUser.get(access.user_id) ?? new Set<string>();
    current.add(access.building_id);
    buildingAccessByUser.set(access.user_id, current);
  });

  data.buildingOrganisations
    .filter((link) => link.active !== false)
    .forEach((link) => {
      const current = buildingAccessByOrganisation.get(link.organisation_id) ?? new Set<string>();
      current.add(link.building_id);
      buildingAccessByOrganisation.set(link.organisation_id, current);
    });

  const recipientsByEmail = new Map<string, DigestRecipient>();

  data.profiles.forEach((profile) => {
    const role = profile.role as AppRole;
    const email = normalizeEmail(profile.email);
    if (!digestRoles.has(role) || profile.active === false || !isValidEmail(email)) return;

    const allBuildings = role === "admin" || role === "developer";
    const buildingIds = allBuildings ? new Set(allBuildingIds) : new Set([
      ...Array.from(buildingAccessByUser.get(profile.id) ?? []),
      ...Array.from(profile.organisation_id ? buildingAccessByOrganisation.get(profile.organisation_id) ?? [] : []),
    ]);
    if (!allBuildings && buildingIds.size === 0) return;

    const current = recipientsByEmail.get(email);
    if (current) {
      buildingIds.forEach((buildingId) => current.buildingIds.add(buildingId));
      current.allBuildings = current.allBuildings || allBuildings;
      return;
    }

    recipientsByEmail.set(email, {
      id: profile.id,
      email,
      name: profile.name || profile.full_name || email,
      role,
      organisationId: profile.organisation_id,
      allBuildings,
      buildingIds,
    });
  });

  const allowlist = new Set(commaList(process.env.DIGEST_RECIPIENT_ALLOWLIST));
  return Array.from(recipientsByEmail.values())
    .filter((recipient) => allowlist.size === 0 || allowlist.has(recipient.email))
    .sort((a, b) => a.email.localeCompare(b.email));
}

function buildRecipientDigest(data: DigestData, recipient: DigestRecipient, dailySince: Date, weeklyIncluded: boolean): RecipientDigest {
  const scopedSnags = data.snags.filter((snag) => (
    snag.source_type === "developer_snag" &&
    snag.building_id &&
    recipient.buildingIds.has(snag.building_id) &&
    (recipient.role !== "contractor" || contractorCanReceiveSnag(snag, recipient, data.buildingOrganisations))
  ));
  const scopedSnagIds = new Set(scopedSnags.map((snag) => snag.id));
  const scopedEvents = data.events.filter((event) => scopedSnagIds.has(event.snag_id));
  const snagsById = new Map(scopedSnags.map((snag) => [snag.id, snag]));
  const dailyStatusEvents = scopedEvents.filter(isStatusEvent).filter((event) => isAfter(event.created_at, dailySince));

  const dailySections = [
    sectionFromSnags("created", "New developer snags", "Developer snags created in the last 24 hours.", scopedSnags.filter((snag) => isAfter(snag.created_at, dailySince)), data),
    sectionFromSnags("resolved", "Ready for review", "Snags moved to resolved by contractor in the last 24 hours.", snagsFromEvents(dailyStatusEvents.filter((event) => event.new_value === "resolved_by_contractor"), snagsById), data),
    sectionFromSnags("closed", "Closed", "Snags closed in the last 24 hours.", uniqueSnags([
      ...snagsFromEvents(dailyStatusEvents.filter((event) => event.new_value === "closed"), snagsById),
      ...scopedSnags.filter((snag) => snag.status === "closed" && isAfter(snag.closed_at, dailySince)),
    ]), data),
    sectionFromSnags("rejected", "Rejected back to contractor", "Snags returned to the contractor in the last 24 hours.", snagsFromEvents(dailyStatusEvents.filter((event) => event.new_value === "rejected_back_to_contractor"), snagsById), data),
    sectionFromSnags("more_info", "More info requested", "Snags returned to the developer for more information in the last 24 hours.", snagsFromEvents(dailyStatusEvents.filter((event) => event.new_value === "needs_more_info"), snagsById), data),
    sectionFromSnags("info_supplied", "Information supplied", "Snags reopened after more information was supplied in the last 24 hours.", snagsFromEvents(scopedEvents.filter(isInfoSuppliedEvent).filter((event) => isAfter(event.created_at, dailySince)), snagsById), data),
  ].filter((section) => section.count > 0);

  const infoSuppliedIds = new Set(scopedEvents.filter(isInfoSuppliedEvent).map((event) => event.snag_id));
  const activeSnags = scopedSnags.filter((snag) => !isFinalSnag(snag));
  const weeklySections = weeklyIncluded ? [
    sectionFromSnags("weekly_review", "Ready for review", "Resolved snags waiting for developer review.", scopedSnags.filter((snag) => snag.status === "resolved_by_contractor"), data),
    sectionFromSnags("weekly_more_info", "Needs more information", "Snags waiting for the developer to provide more information.", scopedSnags.filter((snag) => snag.status === "needs_more_info"), data),
    sectionFromSnags("weekly_info_supplied", "Information supplied", "Snags reopened after more information was supplied.", scopedSnags.filter((snag) => snag.status === "open" && infoSuppliedIds.has(snag.id)), data),
    sectionFromSnags("weekly_rejected", "Rejected back to contractor", "Snags returned to the contractor for further work.", scopedSnags.filter((snag) => snag.status === "rejected_back_to_contractor"), data),
    sectionFromSnags("weekly_trade", "Needs trade allocation", "Active developer snags without a trade.", activeSnags.filter((snag) => !snag.trade_id), data),
  ].filter((section) => section.count > 0) : [];

  return {
    recipient,
    dailySections,
    weeklySections,
    dailyCount: dailySections.reduce((total, section) => total + section.count, 0),
    weeklyCount: weeklySections.reduce((total, section) => total + section.count, 0),
  };
}

function mainContractorOrganisationIdForBuilding(buildingOrganisations: BuildingOrganisation[], buildingId: string | null | undefined) {
  if (!buildingId) return null;
  return buildingOrganisations.find((link) => (
    link.building_id === buildingId
    && link.role_on_project === "main_contractor"
    && link.active !== false
  ))?.organisation_id ?? null;
}

function contractorCanReceiveSnag(snag: ProductionSnag, recipient: DigestRecipient, buildingOrganisations: BuildingOrganisation[]) {
  if (!recipient.organisationId) return false;
  const mainContractorId = mainContractorOrganisationIdForBuilding(buildingOrganisations, snag.building_id);
  if (mainContractorId !== recipient.organisationId) return false;
  return !snag.assigned_to_organisation_id || snag.assigned_to_organisation_id === recipient.organisationId;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#039;");
}

function renderSection(section: DigestSection) {
  const extraCount = Math.max(section.count - section.items.length, 0);

  return `
    <tr>
      <td style="padding:18px 0 0;">
        <table role="presentation" width="100%" style="border:1px solid #e2ded3;border-radius:10px;border-collapse:separate;background:#ffffff;">
          <tr>
            <td style="padding:16px 18px;">
              <p style="margin:0;color:#0f3d2e;font-size:17px;font-weight:700;">${escapeHtml(section.title)} <span style="color:#d49a2d;">${section.count}</span></p>
              <p style="margin:5px 0 0;color:#637067;font-size:13px;">${escapeHtml(section.description)}</p>
              <table role="presentation" width="100%" style="margin-top:12px;border-collapse:collapse;">
                ${section.items.map((item) => `
                  <tr>
                    <td style="padding:10px 0;border-top:1px solid #edf0ec;">
                      <p style="margin:0;color:#1f2a24;font-size:14px;font-weight:700;">${escapeHtml(item.title)}</p>
                      <p style="margin:4px 0 0;color:#637067;font-size:12px;">${escapeHtml(item.building)} / ${escapeHtml(item.location)}</p>
                    </td>
                    <td align="right" style="padding:10px 0;border-top:1px solid #edf0ec;color:#1f2a24;font-size:12px;white-space:nowrap;">
                      <span style="display:inline-block;margin-bottom:4px;padding:4px 8px;border-radius:999px;background:#eef7f1;color:#0f6b3d;font-weight:700;">${escapeHtml(item.status)}</span><br>
                      <span>${escapeHtml(item.trade)}</span>
                    </td>
                  </tr>
                `).join("")}
              </table>
              ${extraCount > 0 ? `<p style="margin:8px 0 0;color:#637067;font-size:12px;">Plus ${extraCount} more.</p>` : ""}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  `;
}

function renderDigestHtml(digest: RecipientDigest, origin?: string) {
  const link = snagsUrl(origin);
  const hasDaily = digest.dailySections.length > 0;
  const hasWeekly = digest.weeklySections.length > 0;

  return `
    <!doctype html>
    <html>
      <body style="margin:0;padding:0;background:#f6f1e7;font-family:Arial,Helvetica,sans-serif;color:#1f2a24;">
        <table role="presentation" width="100%" style="border-collapse:collapse;background:#f6f1e7;">
          <tr>
            <td align="center" style="padding:28px 14px;">
              <table role="presentation" width="620" style="max-width:620px;width:100%;border-collapse:collapse;">
                <tr>
                  <td style="padding:0 0 18px;">
                    <table role="presentation" style="border-collapse:collapse;">
                      <tr>
                        <td style="padding-right:14px;"><img src="${logoUrl}" alt="Bunnywell" width="56" height="56" style="display:block;border:0;border-radius:4px;"></td>
                        <td>
                          <p style="margin:0;color:#d49a2d;font-size:14px;letter-spacing:6px;font-weight:700;">BUNNYWELL</p>
                          <p style="margin:2px 0 0;color:#0f3d2e;font-size:30px;font-weight:800;">Portal</p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="padding:26px;border:1px solid #e2ded3;border-radius:14px;background:#ffffff;">
                    <p style="margin:0;color:#d49a2d;font-size:13px;font-weight:700;letter-spacing:4px;">DEVELOPER SNAGS</p>
                    <h1 style="margin:8px 0 8px;color:#0f3d2e;font-size:28px;line-height:1.2;">${hasWeekly ? "Daily digest and weekly reminder" : "Daily digest"}</h1>
                    <p style="margin:0;color:#637067;font-size:15px;line-height:1.5;">Hi ${escapeHtml(digest.recipient.name)}, here is the developer snag activity for the buildings you can access.</p>
                    <table role="presentation" style="margin-top:18px;border-collapse:separate;border-spacing:8px 0;">
                      <tr>
                        <td style="padding:12px 16px;border-radius:10px;background:#eef7f1;text-align:center;">
                          <p style="margin:0;color:#0f3d2e;font-size:24px;font-weight:800;">${digest.dailyCount}</p>
                          <p style="margin:2px 0 0;color:#637067;font-size:11px;font-weight:700;letter-spacing:1px;">24H UPDATES</p>
                        </td>
                        ${hasWeekly ? `
                        <td style="padding:12px 16px;border-radius:10px;background:#fff8e7;text-align:center;">
                          <p style="margin:0;color:#0f3d2e;font-size:24px;font-weight:800;">${digest.weeklyCount}</p>
                          <p style="margin:2px 0 0;color:#637067;font-size:11px;font-weight:700;letter-spacing:1px;">OUTSTANDING</p>
                        </td>` : ""}
                      </tr>
                    </table>
                    ${hasDaily ? `<table role="presentation" width="100%" style="margin-top:10px;border-collapse:collapse;">${digest.dailySections.map(renderSection).join("")}</table>` : ""}
                    ${hasWeekly ? `
                      <h2 style="margin:26px 0 0;color:#0f3d2e;font-size:20px;">Weekly outstanding actions</h2>
                      <p style="margin:6px 0 0;color:#637067;font-size:13px;">A quieter weekly reminder of action buckets that may take a few days to resolve.</p>
                      <table role="presentation" width="100%" style="margin-top:0;border-collapse:collapse;">${digest.weeklySections.map(renderSection).join("")}</table>
                    ` : ""}
                    <p style="margin:24px 0 0;"><a href="${link}" style="display:inline-block;padding:12px 18px;border-radius:8px;background:#0f3d2e;color:#ffffff;text-decoration:none;font-weight:700;">Open snags</a></p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>
  `;
}

function renderDigestText(digest: RecipientDigest, origin?: string) {
  const lines = [
    "Bunnywell Portal - Developer snags",
    "",
    `Hi ${digest.recipient.name},`,
    `24h updates: ${digest.dailyCount}`,
    digest.weeklySections.length > 0 ? `Outstanding weekly actions: ${digest.weeklyCount}` : "",
    "",
  ].filter(Boolean);

  const appendSection = (heading: string, sections: DigestSection[]) => {
    if (sections.length === 0) return;
    lines.push(heading, "");
    sections.forEach((section) => {
      lines.push(`${section.title}: ${section.count}`);
      section.items.forEach((item) => lines.push(`- ${item.title} (${item.building} / ${item.location} / ${item.trade} / ${item.status})`));
      lines.push("");
    });
  };

  appendSection("Daily updates", digest.dailySections);
  appendSection("Weekly outstanding actions", digest.weeklySections);
  lines.push(`Open snags: ${snagsUrl(origin)}`);

  return lines.join("\n");
}

function buildEmail(digest: RecipientDigest, origin?: string): SendableDigest {
  const subject = digest.weeklySections.length > 0
    ? `Bunnywell digest: ${digest.dailyCount} updates, ${digest.weeklyCount} outstanding actions`
    : `Bunnywell daily digest: ${digest.dailyCount} developer snag update${digest.dailyCount === 1 ? "" : "s"}`;

  return {
    recipient: digest.recipient,
    subject,
    html: renderDigestHtml(digest, origin),
    text: renderDigestText(digest, origin),
  };
}

async function loadDigestData(adminClient: SupabaseClient): Promise<DigestData> {
  const [
    buildingsResult,
    profilesResult,
    buildingAccessResult,
    buildingOrganisationsResult,
    unitsResult,
    areasResult,
    tradesResult,
    snagsResult,
    eventsResult,
  ] = await Promise.all([
    adminClient.from("buildings").select("*"),
    adminClient.from("profiles").select("id,email,name,full_name,role,organisation_id,active"),
    adminClient.from("user_building_access").select("user_id,building_id"),
    adminClient.from("building_organisations").select("*"),
    adminClient.from("units").select("*"),
    adminClient.from("areas").select("*"),
    adminClient.from("trades").select("*"),
    adminClient.from("snags").select("*").eq("source_type", "developer_snag"),
    adminClient.from("snag_events").select("*").order("created_at", { ascending: false }),
  ]);

  const firstError = [
    buildingsResult.error,
    profilesResult.error,
    buildingAccessResult.error,
    buildingOrganisationsResult.error,
    unitsResult.error,
    areasResult.error,
    tradesResult.error,
    snagsResult.error,
    eventsResult.error,
  ].find(Boolean);

  if (firstError) {
    throw new Error(firstError.message);
  }

  return {
    areas: (areasResult.data ?? []) as Area[],
    buildings: (buildingsResult.data ?? []) as Building[],
    buildingOrganisations: (buildingOrganisationsResult.data ?? []) as BuildingOrganisation[],
    events: (eventsResult.data ?? []) as SnagEvent[],
    profiles: (profilesResult.data ?? []) as DigestProfile[],
    snags: (snagsResult.data ?? []) as ProductionSnag[],
    trades: (tradesResult.data ?? []) as Trade[],
    units: (unitsResult.data ?? []) as Unit[],
    userBuildingAccess: (buildingAccessResult.data ?? []) as UserBuildingAccess[],
  };
}

async function reserveDigestRun(adminClient: SupabaseClient, digestKey: string, scheduledFor: Date, weeklyIncluded: boolean) {
  const { data, error } = await adminClient
    .from("digest_runs")
    .insert({
      digest_key: digestKey,
      digest_type: "snag_digest",
      scheduled_for: scheduledFor.toISOString(),
      status: "started",
      metadata: { weeklyIncluded },
    })
    .select("id")
    .single();

  if (!error) return { id: data?.id as string | undefined, duplicate: false, unavailable: false };
  if (error.code === "23505") return { duplicate: true, unavailable: false };
  if (error.code === "42P01") return { duplicate: false, unavailable: true };
  throw new Error(error.message);
}

async function updateDigestRun(adminClient: SupabaseClient, runId: string | undefined, status: "sent" | "skipped" | "failed", recipientsCount: number, metadata: Record<string, unknown>) {
  if (!runId) return;

  await adminClient
    .from("digest_runs")
    .update({
      status,
      recipients_count: recipientsCount,
      metadata,
      updated_at: new Date().toISOString(),
    })
    .eq("id", runId);
}

async function recordDigestAudit(adminClient: SupabaseClient, recipientsCount: number, metadata: Record<string, unknown>) {
  await adminClient.from("audit_events").insert({
    event_type: "digest_sent",
    entity_type: "digest",
    summary: `Snag digest sent to ${recipientsCount} recipient${recipientsCount === 1 ? "" : "s"}.`,
    metadata,
    created_by_user_id: null,
  });
}

async function sendResendEmail(email: SendableDigest) {
  const resendApiKey = process.env.RESEND_API_KEY;
  const dryRunTo = normalizeEmail(process.env.DIGEST_DRY_RUN_EMAIL);
  const to = dryRunTo || email.recipient.email;

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
      from: process.env.DIGEST_FROM_EMAIL || portalFromEmail,
      to,
      subject: dryRunTo ? `[Dry run for ${email.recipient.email}] ${email.subject}` : email.subject,
      html: dryRunTo ? email.html.replace("<body ", `<body data-dry-run="for-${escapeHtml(email.recipient.email)}" `) : email.html,
      text: dryRunTo ? `Dry run for ${email.recipient.email}\n\n${email.text}` : email.text,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Resend email failed: ${response.status} ${body}`);
  }

  return { to, subject: dryRunTo ? `[Dry run for ${email.recipient.email}] ${email.subject}` : email.subject };
}

export async function runSnagDigest(options: RunDigestOptions = {}): Promise<SnagDigestResult> {
  const now = options.now ?? new Date();
  const parts = localParts(now);
  const isScheduledLocalTime = parts.hour === 7;
  const weeklyIncluded = parts.dayName === "Mon";
  const dryRunTo = normalizeEmail(process.env.DIGEST_DRY_RUN_EMAIL) || null;
  const digestKey = `snag-digest:${parts.dateKey}:0730`;

  if (!options.force && !isScheduledLocalTime) {
    return { status: "skipped", reason: `Not in the 07:00 digest window for ${digestTimeZone}.`, digestKey, localDate: parts.dateKey, weeklyIncluded };
  }

  if (!envBoolean("DIGEST_EMAILS_ENABLED")) {
    return { status: "skipped", reason: "Digest emails are disabled. Set DIGEST_EMAILS_ENABLED=true to send.", digestKey, localDate: parts.dateKey, weeklyIncluded };
  }

  const adminClient = createSupabaseAdminClient();
  const reservation = await reserveDigestRun(adminClient, digestKey, now, weeklyIncluded);

  if (reservation.duplicate) {
    return { status: "skipped", reason: "Digest already ran for this local date/time.", digestKey, localDate: parts.dateKey, weeklyIncluded };
  }

  try {
    const data = await loadDigestData(adminClient);
    const recipients = buildRecipients(data);
    const dailySince = new Date(now.getTime() - (24 * 60 * 60 * 1000));
    const digests = recipients
      .map((recipient) => buildRecipientDigest(data, recipient, dailySince, weeklyIncluded))
      .filter((digest) => digest.dailyCount > 0 || digest.weeklyCount > 0)
      .map((digest) => buildEmail(digest, options.origin));

    if (digests.length === 0) {
      await updateDigestRun(adminClient, reservation.id, "skipped", 0, {
        reason: "No digest-worthy developer snag updates or outstanding actions.",
        weeklyIncluded,
        dryRunTo,
      });
      return { status: "skipped", reason: "No digest-worthy developer snag updates or outstanding actions.", digestKey, localDate: parts.dateKey, weeklyIncluded, recipients: 0, dryRunTo };
    }

    const sent = [];
    for (const email of digests) {
      sent.push(await sendResendEmail(email));
    }

    const metadata = {
      digestKey,
      localDate: parts.dateKey,
      weeklyIncluded,
      dryRunTo,
      recipients: sent.map((item) => item.to),
    };
    await updateDigestRun(adminClient, reservation.id, "sent", sent.length, metadata);
    await recordDigestAudit(adminClient, sent.length, metadata);

    return { status: "sent", digestKey, localDate: parts.dateKey, weeklyIncluded, recipients: sent.length, dryRunTo, sent };
  } catch (error) {
    await updateDigestRun(adminClient, reservation.id, "failed", 0, {
      error: error instanceof Error ? error.message : "Unexpected error.",
      weeklyIncluded,
      dryRunTo,
    });
    throw error;
  }
}
