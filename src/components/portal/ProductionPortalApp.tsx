"use client";

import { Download, LogIn, Plus, RefreshCw, Shield, X } from "lucide-react";
import { jsPDF } from "jspdf";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent } from "react";
import type { User } from "@supabase/supabase-js";
import { createSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";
import {
  type AppRole,
  type Area,
  type Building,
  type BuildingFloor,
  type Handover,
  type MeterReading,
  type Organisation,
  type ProductionSnag,
  type ResidentType,
  type SnagEvent,
  type SnagPhoto,
  type Trade,
  type Unit,
  type UnitType,
  type UnitTypeArea,
  slaForPriority,
} from "@/lib/data/production";

type Profile = {
  id: string;
  email: string;
  name: string | null;
  full_name: string | null;
  role: AppRole;
  resident_type: ResidentType | null;
  organisation_id: string | null;
  created_at?: string | null;
};

type UserBuildingAccess = {
  user_id: string;
  building_id: string;
  role_on_building: string | null;
};

type UserUnitAccess = {
  user_id: string;
  unit_id: string;
  access_type: ResidentType | "representative";
};

type AuditEvent = {
  id: string;
  event_type: string;
  entity_type: string;
  entity_id: string | null;
  summary: string;
  metadata: Record<string, unknown>;
  created_by_user_id: string | null;
  created_at: string;
};

type Tab = "dashboard" | "admin" | "users" | "add_snag" | "snags" | "handover" | "leaseholder" | "reports" | "audit";

type SnagDraft = {
  buildingId: string;
  unitId: string;
  areaId: string;
  title: string;
  description: string;
  tradeId: string;
  priority: "P1" | "P2" | "P3";
  photoDataUrl: string;
};

const emptySnagDraft: SnagDraft = {
  buildingId: "",
  unitId: "",
  areaId: "",
  title: "",
  description: "",
  tradeId: "",
  priority: "P2",
  photoDataUrl: "",
};

const unitSaleStatuses: Array<{ value: Unit["sale_status"]; label: string }> = [
  { value: "for_sale", label: "For Sale" },
  { value: "reserved", label: "Reserved" },
  { value: "exchanged", label: "Exchanged" },
  { value: "completed", label: "Completed" },
  { value: "handed_over", label: "Handed Over" },
];

const appRoles: Array<{ value: AppRole; label: string }> = [
  { value: "admin", label: "Admin" },
  { value: "developer", label: "Developer" },
  { value: "developer_representative", label: "Developer Representative" },
  { value: "contractor", label: "Contractor" },
  { value: "resident", label: "Resident" },
];

const residentTypes: Array<{ value: ResidentType; label: string }> = [
  { value: "leaseholder", label: "Leaseholder" },
  { value: "tenant", label: "Tenant" },
  { value: "letting_agent", label: "Letting Agent" },
  { value: "managing_agent", label: "Managing Agent" },
];

const organisationTypes = [
  { value: "developer_representative", label: "Developer Representative" },
  { value: "contractor", label: "Contractor" },
];

const brand = {
  green: "#0F3D31",
  gold: "#D4A645",
  background: "#f7f8f5",
  border: "#d8ded8",
  muted: "#617169",
};

function formatDate(value?: string | null) {
  if (!value) return "-";

  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function formatDateTime(value?: string | null) {
  if (!value) return "-";

  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function roleTabs(role: AppRole): Tab[] {
  if (role === "admin") return ["dashboard", "admin", "users", "add_snag", "snags", "handover", "leaseholder", "reports", "audit"];
  if (role === "developer" || role === "developer_representative") return ["dashboard", "add_snag", "snags", "handover", "leaseholder", "reports"];
  if (role === "resident") return ["leaseholder"];
  if (role === "contractor") return ["dashboard", "snags"];

  return ["dashboard"];
}

function tabLabel(tab: Tab) {
  const labels: Record<Tab, string> = {
    dashboard: "Dashboard",
    admin: "Admin",
    users: "Users",
    add_snag: "Add snag",
    snags: "Snags",
    handover: "Handover",
    leaseholder: "Resident",
    reports: "Reports",
    audit: "Audit",
  };

  return labels[tab];
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    open: "Open",
    resolved_by_contractor: "Resolved by contractor",
    rejected_back_to_contractor: "Rejected back to contractor",
    closed: "Closed",
    submitted: "Submitted",
    needs_more_info: "Needs more info",
    rejected: "Rejected",
    accepted: "Accepted",
    assigned_to_contractor: "Assigned to contractor",
    in_progress: "In progress",
    resolved: "Resolved",
    for_sale: "For Sale",
    reserved: "Reserved",
    exchanged: "Exchanged",
    completed: "Completed",
    handed_over: "Handed Over",
    developer_representative: "Developer Representative",
    resident: "Resident",
    leaseholder: "Leaseholder",
    tenant: "Tenant",
    letting_agent: "Letting Agent",
    managing_agent: "Managing Agent",
    Open: "Open",
    Resolved: "Resolved",
  };

  return labels[status] ?? status.replaceAll("_", " ");
}

function entityLabel(entityType: string) {
  const labels: Record<string, string> = {
    area: "Area",
    building: "Building",
    organisation: "Organisation",
    report: "Report",
    snag: "Snag",
    unit: "Unit",
    user: "User",
  };

  return labels[entityType] ?? entityType
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function eventLabel(eventType: string) {
  const labels: Record<string, string> = {
    access_note: "Note",
    assigned: "Assigned",
    created: "Created",
    note: "Note",
    photo_added: "Photo Added",
    priority_changed: "Priority Changed",
    report_generated: "Report Generated",
    status_change: "Status Change",
    submitted: "Submitted",
    trade_changed: "Trade Changed",
    triage: "Triage",
    user_created: "User Created",
    user_updated: "User Updated",
    building_created: "Building Created",
    building_updated: "Building Updated",
    building_deleted: "Building Deleted",
    organisation_created: "Organisation Created",
    organisation_updated: "Organisation Updated",
    organisation_delete_blocked: "Organisation Delete Blocked",
    organisation_deleted: "Organisation Deleted",
  };

  return labels[eventType] ?? eventType.split("_").map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
}

function statusTone(status: string) {
  if (["closed", "resolved", "resolved_by_contractor", "handed_over"].includes(status)) return "bg-[#e7f3ea] text-[#2f623c]";
  if (["rejected", "rejected_back_to_contractor", "needs_more_info"].includes(status)) return "bg-[#f5eee3] text-[#735327]";
  return "bg-[#edf1f7] text-[#354f75]";
}

export function ProductionPortalApp() {
  const supabaseEnabled = isSupabaseConfigured();
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [tab, setTab] = useState<Tab>("dashboard");
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [areas, setAreas] = useState<Area[]>([]);
  const [buildingFloors, setBuildingFloors] = useState<BuildingFloor[]>([]);
  const [unitTypes, setUnitTypes] = useState<UnitType[]>([]);
  const [unitTypeAreas, setUnitTypeAreas] = useState<UnitTypeArea[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [organisations, setOrganisations] = useState<Organisation[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [userBuildingAccess, setUserBuildingAccess] = useState<UserBuildingAccess[]>([]);
  const [userUnitAccess, setUserUnitAccess] = useState<UserUnitAccess[]>([]);
  const [snags, setSnags] = useState<ProductionSnag[]>([]);
  const [photos, setPhotos] = useState<SnagPhoto[]>([]);
  const [events, setEvents] = useState<SnagEvent[]>([]);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [handovers, setHandovers] = useState<Handover[]>([]);
  const [meterReadings, setMeterReadings] = useState<MeterReading[]>([]);
  const [accessibleUnitIds, setAccessibleUnitIds] = useState<string[]>([]);
  const [accessibleBuildingIds, setAccessibleBuildingIds] = useState<string[]>([]);
  const [notice, setNotice] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  const role = profile?.role ?? "user";
  const tabs = roleTabs(role);
  const visibleSnags = useMemo(() => filterSnagsForRole(snags, profile, accessibleUnitIds, accessibleBuildingIds), [accessibleBuildingIds, accessibleUnitIds, profile, snags]);
  const developerSnags = visibleSnags.filter((snag) => snag.source_type === "developer_snag");
  const residentDefects = visibleSnags.filter((snag) => snag.source_type === "leaseholder_defect");
  const openCount = visibleSnags.filter((snag) => !["closed", "resolved", "resolved_by_contractor"].includes(snag.status)).length;
  const resolvedCount = visibleSnags.filter((snag) => ["resolved", "resolved_by_contractor"].includes(snag.status)).length;
  const closedCount = visibleSnags.filter((snag) => snag.status === "closed").length;
  const overdueCount = visibleSnags.filter((snag) => snag.sla_due_date && new Date(snag.sla_due_date) < new Date() && snag.status !== "closed").length;

  useEffect(() => {
    if (!supabaseEnabled) {
      setNotice("Supabase is not configured. Add environment variables to use the production schema UI.");
      setIsLoading(false);
      return;
    }

    const supabase = createSupabaseBrowserClient();

    supabase.auth.getUser().then(async ({ data }) => {
      setUser(data.user);
      if (data.user) await loadAll(data.user.id);
      setIsLoading(false);
    });

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      if (session?.user) {
        setNotice("");
        void loadAll(session.user.id);
      }
    });

    return () => data.subscription.unsubscribe();
  }, [supabaseEnabled]);

  useEffect(() => {
    if (!tabs.includes(tab)) setTab(tabs[0] ?? "dashboard");
  }, [tab, tabs]);

  useEffect(() => {
    setNotice("");
  }, [tab]);

  useEffect(() => {
    if (!notice || notice === "Loading Bunnywell Portal...") return;
    if (notice.startsWith("Supabase is not configured") || notice.startsWith("Production schema is not ready")) return;
    const timer = window.setTimeout(() => setNotice(""), 7000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  async function loadAll(userId = user?.id) {
    if (!userId) return;

    const supabase = createSupabaseBrowserClient();
    const [
      profileResult,
      buildingsResult,
      unitsResult,
      areasResult,
      floorsResult,
      unitTypesResult,
      unitTypeAreasResult,
      tradesResult,
      orgsResult,
      profilesResult,
      allBuildingAccessResult,
      allUnitAccessResult,
      snagsResult,
      photosResult,
      eventsResult,
      auditEventsResult,
      handoversResult,
      metersResult,
      accessResult,
      buildingAccessResult,
    ] = await Promise.all([
      supabase.from("profiles").select("id,email,name,full_name,role,resident_type,organisation_id,created_at").eq("id", userId).single(),
      supabase.from("buildings").select("*").order("name"),
      supabase.from("units").select("*").order("unit_number"),
      supabase.from("areas").select("*").order("sort_order"),
      supabase.from("building_floors").select("*").order("sort_order"),
      supabase.from("unit_types").select("*").order("name"),
      supabase.from("unit_type_areas").select("*").order("sort_order"),
      supabase.from("trades").select("*").order("sort_order"),
      supabase.from("organisations").select("*").order("name"),
      supabase.from("profiles").select("id,email,name,full_name,role,resident_type,organisation_id,created_at").order("email"),
      supabase.from("user_building_access").select("user_id,building_id,role_on_building"),
      supabase.from("user_unit_access").select("user_id,unit_id,access_type"),
      supabase.from("snags").select("*").order("created_at", { ascending: false }),
      supabase.from("snag_photos").select("*").order("created_at", { ascending: false }),
      supabase.from("snag_events").select("*").order("created_at", { ascending: false }),
      supabase.from("audit_events").select("*").order("created_at", { ascending: false }).limit(200),
      supabase.from("handovers").select("*").order("created_at", { ascending: false }),
      supabase.from("meter_readings").select("*").order("created_at", { ascending: false }),
      supabase.from("user_unit_access").select("unit_id").eq("user_id", userId),
      supabase.from("user_building_access").select("building_id").eq("user_id", userId),
    ]);

    const firstError = [
      buildingsResult.error,
      unitsResult.error,
      areasResult.error,
      snagsResult.error,
    ].find(Boolean);

    if (firstError) {
      setNotice(`Production schema is not ready yet: ${firstError.message}`);
    } else {
      setNotice("");
    }

    const loadedProfile = profileResult.data as Profile | null;
    setProfile(loadedProfile);
    setBuildings((buildingsResult.data ?? []) as Building[]);
    setUnits((unitsResult.data ?? []) as Unit[]);
    setAreas((areasResult.data ?? []) as Area[]);
    setBuildingFloors((floorsResult.data ?? []) as BuildingFloor[]);
    setUnitTypes((unitTypesResult.data ?? []) as UnitType[]);
    setUnitTypeAreas((unitTypeAreasResult.data ?? []) as UnitTypeArea[]);
    setTrades((tradesResult.data ?? []) as Trade[]);
    setOrganisations((orgsResult.data ?? []) as Organisation[]);
    setProfiles((profilesResult.data ?? []) as Profile[]);
    setUserBuildingAccess((allBuildingAccessResult.data ?? []) as UserBuildingAccess[]);
    setUserUnitAccess((allUnitAccessResult.data ?? []) as UserUnitAccess[]);
    setSnags((snagsResult.data ?? []) as ProductionSnag[]);
    setPhotos((photosResult.data ?? []) as SnagPhoto[]);
    setEvents((eventsResult.data ?? []) as SnagEvent[]);
    setAuditEvents((auditEventsResult.data ?? []) as AuditEvent[]);
    setHandovers((handoversResult.data ?? []) as Handover[]);
    setMeterReadings((metersResult.data ?? []) as MeterReading[]);
    setAccessibleUnitIds((accessResult.data ?? []).map((row) => row.unit_id));
    setAccessibleBuildingIds(Array.from(new Set([
      ...(buildingAccessResult.data ?? []).map((row) => row.building_id),
      ...(loadedProfile?.role === "contractor" ? (buildingsResult.data ?? []).map((building) => building.id) : []),
    ])));
  }

  async function uploadFile(dataUrl: string, folder: string) {
    const supabase = createSupabaseBrowserClient();
    const blob = await (await fetch(dataUrl)).blob();
    const path = `${folder}/${crypto.randomUUID()}.jpg`;
    const { error } = await supabase.storage.from("snag-images").upload(path, blob, {
      contentType: "image/jpeg",
      upsert: false,
    });

    if (error) throw error;

    return supabase.storage.from("snag-images").getPublicUrl(path).data.publicUrl;
  }

  async function recordAudit(event: Omit<AuditEvent, "id" | "created_at" | "created_by_user_id">) {
    if (!user?.id) return;
    const supabase = createSupabaseBrowserClient();
    const { data } = await supabase.from("audit_events").insert({
      ...event,
      created_by_user_id: user.id,
    }).select("*").single();
    if (data) {
      setAuditEvents((current) => [data as AuditEvent, ...current.filter((item) => item.id !== data.id)].slice(0, 200));
    }
  }

  if (isLoading) {
    return <Shell profile={profile} tab={tab} tabs={tabs} setTab={setTab} notice="Loading Bunnywell Portal..." />;
  }

  if (!user) {
    return (
      <Shell profile={profile} tab={tab} tabs={[]} setTab={setTab} notice={notice}>
        <LoginPanel onNotice={setNotice} />
      </Shell>
    );
  }

  return (
    <Shell profile={profile} tab={tab} tabs={tabs} setTab={setTab} notice={notice} onRefresh={() => loadAll()}>
      {tab === "dashboard" && (
        <Dashboard
          buildings={buildings}
          total={visibleSnags.length}
          open={openCount}
          resolved={resolvedCount}
          closed={closedCount}
          overdue={overdueCount}
          leaseholderDefects={residentDefects}
          setTab={setTab}
        />
      )}
      {tab === "admin" && (
        <AdminSetup
          buildings={buildings}
          units={units}
          areas={areas}
          buildingFloors={buildingFloors}
          unitTypes={unitTypes}
          unitTypeAreas={unitTypeAreas}
          recordAudit={recordAudit}
          onNotice={setNotice}
          reload={loadAll}
        />
      )}
      {tab === "users" && (
        <UserAdmin
          buildings={buildings}
          units={units}
          organisations={organisations}
          profiles={profiles}
          userBuildingAccess={userBuildingAccess}
          userUnitAccess={userUnitAccess}
          recordAudit={recordAudit}
          onNotice={setNotice}
          reload={loadAll}
        />
      )}
      {tab === "add_snag" && (
        <DeveloperSnagging
          user={user}
          buildings={buildings}
          units={units}
          areas={areas}
          trades={trades}
          onNotice={setNotice}
          reload={loadAll}
          uploadFile={uploadFile}
        />
      )}
      {tab === "snags" && (
        <SnagWorkflow
          user={user}
          profile={profile}
          buildings={buildings}
          snags={visibleSnags}
          units={units}
          areas={areas}
          trades={trades}
          photos={photos}
          events={events}
          profiles={profiles}
          onNotice={setNotice}
          reload={loadAll}
          uploadFile={uploadFile}
        />
      )}
      {tab === "handover" && (
        <HandoverAndMeters
          user={user}
          buildings={buildings}
          units={units}
          handovers={handovers}
          meterReadings={meterReadings}
          onNotice={setNotice}
          reload={loadAll}
        />
      )}
      {tab === "leaseholder" && (
        <LeaseholderDefects
          user={user}
          profile={profile}
          buildings={buildings}
          units={units}
          areas={areas}
          snags={residentDefects}
          photos={photos}
          events={events}
          profiles={profiles}
          accessibleUnitIds={accessibleUnitIds}
          onNotice={setNotice}
          reload={loadAll}
          uploadFile={uploadFile}
        />
      )}
      {tab === "reports" && (
        <ReportsPanel buildings={buildings} units={units} areas={areas} trades={trades} snags={developerSnags} photos={photos} recordAudit={recordAudit} />
      )}
      {tab === "audit" && (
        <AuditPanel auditEvents={auditEvents} profiles={profiles} />
      )}
    </Shell>
  );
}

function Shell({
  profile,
  tab,
  tabs,
  setTab,
  notice,
  onRefresh,
  children,
}: {
  profile: Profile | null;
  tab: Tab;
  tabs: Tab[];
  setTab: (tab: Tab) => void;
  notice?: string;
  onRefresh?: () => void;
  children?: React.ReactNode;
}) {
  return (
    <main className="min-h-screen bg-[#f7f8f5] text-[#18201c]">
      <header className="border-b border-[#d9ded6] bg-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-4">
              <img src="/bunnywell-logo-icon.jpg" alt="Bunnywell Homes" className="h-14 w-auto object-contain sm:h-16" />
              <div>
                <p className="text-sm font-medium tracking-[0.2em] text-[#0F3D31]">PORTAL</p>
                <h1 className="text-2xl font-semibold text-[#0F3D31]">Bunnywell Portal</h1>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex h-10 items-center gap-2 rounded-md border border-[#cbd4ce] bg-[#f6f7f4] px-3 text-sm">
                <Shield size={16} aria-hidden />
                {profile?.email ?? "Not signed in"}
              </span>
              {onRefresh && (
                <button onClick={onRefresh} className="inline-flex h-10 items-center gap-2 rounded-md border border-[#cbd4ce] bg-white px-3 text-sm">
                  <RefreshCw size={16} aria-hidden />
                  Refresh
                </button>
              )}
              {profile && (
                <button
                  onClick={() => createSupabaseBrowserClient().auth.signOut()}
                  className="inline-flex h-10 items-center gap-2 rounded-md bg-[#0F3D31] px-4 text-sm font-semibold text-white"
                >
                  <LogIn size={16} aria-hidden />
                  Sign out
                </button>
              )}
            </div>
          </div>
          {tabs.length > 0 && (
            <nav className="flex gap-2 overflow-x-auto pb-1">
              {tabs.map((item) => (
                <button
                  key={item}
                  onClick={() => setTab(item)}
                  className={`h-10 shrink-0 rounded-md px-3 text-sm font-medium capitalize ${
                    tab === item ? "bg-[#0F3D31] text-white shadow-[inset_0_-3px_0_#D4A645]" : "border border-[#cbd4ce] bg-white text-[#34413a]"
                  }`}
                >
                  {tabLabel(item)}
                </button>
              ))}
            </nav>
          )}
        </div>
      </header>
      {notice && (
        <div className="mx-auto max-w-7xl px-4 pt-4 sm:px-6 lg:px-8">
          <div className="rounded-md border border-[#e2c8a6] bg-[#fff8ec] px-4 py-3 text-sm text-[#735327]">{notice}</div>
        </div>
      )}
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">{children}</div>
    </main>
  );
}

function LoginPanel({ onNotice }: { onNotice: (notice: string) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  async function login() {
    onNotice("");
    const { error } = await createSupabaseBrowserClient().auth.signInWithPassword({ email, password });
    if (error) onNotice(error.message);
  }

  return (
    <section className="mx-auto max-w-md rounded-md border border-[#d9ded6] bg-white p-5">
      <h2 className="text-lg font-semibold">Sign in</h2>
      <div className="mt-4 space-y-3">
        <input className="h-11 w-full rounded-md border border-[#cbd4ce] px-3 text-sm" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Email" />
        <input className="h-11 w-full rounded-md border border-[#cbd4ce] px-3 text-sm" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Password" type="password" />
        <button onClick={login} className="h-11 w-full rounded-md bg-[#0F3D31] text-sm font-semibold text-white">Sign in</button>
      </div>
    </section>
  );
}

function Dashboard({
  buildings,
  total,
  open,
  resolved,
  closed,
  overdue,
  leaseholderDefects,
  setTab,
}: {
  buildings: Building[];
  total: number;
  open: number;
  resolved: number;
  closed: number;
  overdue: number;
  leaseholderDefects: ProductionSnag[];
  setTab: (tab: Tab) => void;
}) {
  const p1 = leaseholderDefects.filter((snag) => snag.priority_code === "P1").length;
  const p2 = leaseholderDefects.filter((snag) => snag.priority_code === "P2").length;
  const p3 = leaseholderDefects.filter((snag) => snag.priority_code === "P3").length;

  return (
    <div className="grid gap-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Metric label="Buildings" value={buildings.length} onClick={() => setTab("admin")} />
        <Metric label="Total snags" value={total} onClick={() => setTab("snags")} />
        <Metric label="Open" value={open} />
        <Metric label="Resolved" value={resolved} />
        <Metric label="Closed" value={closed} />
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        <Metric label="Overdue SLA" value={overdue} />
        <Metric label="Resident P1" value={p1} onClick={() => setTab("leaseholder")} />
        <Metric label="Resident P2" value={p2} onClick={() => setTab("leaseholder")} />
        <Metric label="Resident P3" value={p3} onClick={() => setTab("leaseholder")} />
      </div>
      <section className="rounded-md border border-[#d9ded6] bg-white p-4">
        <h2 className="text-lg font-semibold">Buildings</h2>
        <div className="mt-3 divide-y divide-[#e5e9e4]">
          {buildings.map((building) => (
            <div key={building.id} className="py-3 text-sm">
              <span className="font-medium">{building.name}</span>
              <span className="ml-2 text-[#617169]">{building.postcode}</span>
            </div>
          ))}
          {buildings.length === 0 && <p className="py-4 text-sm text-[#617169]">No buildings yet.</p>}
        </div>
      </section>
    </div>
  );
}

function Metric({ label, value, onClick }: { label: string; value: number; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      className="rounded-md border border-[#d9ded6] bg-white p-4 text-left transition hover:border-[#9dafaa] hover:bg-[#f8faf7] enabled:cursor-pointer disabled:cursor-default"
      disabled={!onClick}
    >
      <p className="text-sm text-[#617169]">{label}</p>
      <p className="mt-2 text-3xl font-semibold">{value}</p>
    </button>
  );
}

function BuildingStructureView({
  buildings,
  buildingFloors,
  units,
  areas,
  unitTypes,
  unitTypeAreas,
  onNotice,
  reload,
}: {
  buildings: Building[];
  buildingFloors: BuildingFloor[];
  units: Unit[];
  areas: Area[];
  unitTypes: UnitType[];
  unitTypeAreas: UnitTypeArea[];
  onNotice: (notice: string) => void;
  reload: () => Promise<void>;
}) {
  const [buildingId, setBuildingId] = useState(buildings[0]?.id ?? "");
  const [floorName, setFloorName] = useState("");
  const [communalName, setCommunalName] = useState("");
  const building = buildings.find((item) => item.id === buildingId) ?? buildings[0];
  const floors = buildingFloors
    .filter((floor) => floor.building_id === building?.id)
    .sort((a, b) => a.sort_order - b.sort_order);
  const buildingUnits = units.filter((unit) => unit.building_id === building?.id);
  const communalAreas = areas
    .filter((area) => area.building_id === building?.id && area.area_type === "communal_area")
    .sort((a, b) => a.sort_order - b.sort_order);
  const unmatchedUnits = buildingUnits.filter((unit) => unit.floor && !floors.some((floor) => floor.name === unit.floor));
  const noFloorUnits = buildingUnits.filter((unit) => !unit.floor);

  useEffect(() => {
    if (!buildingId && buildings[0]) setBuildingId(buildings[0].id);
  }, [buildingId, buildings]);

  async function addCommunalArea() {
    if (!building || !communalName) return;
    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.from("areas").insert({
      building_id: building.id,
      unit_id: null,
      area_type: "communal_area",
      name: communalName,
      sort_order: communalAreas.length + 1,
    });
    if (error) onNotice(error.message);
    else {
      setCommunalName("");
      await reload();
    }
  }

  async function addFloor() {
    if (!building || !floorName) return;
    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.from("building_floors").insert({
      building_id: building.id,
      name: floorName,
      sort_order: floors.length + 1,
    });
    if (error) onNotice(error.message);
    else {
      setFloorName("");
      await reload();
    }
  }

  return (
    <section className="rounded-md border border-[#d9ded6] bg-white p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold">Building structure</h2>
          <p className="text-sm text-[#617169]">Review floors, units, rooms, private amenities and communal areas.</p>
        </div>
        <select className="field sm:w-72" value={building?.id ?? ""} onChange={(event) => setBuildingId(event.target.value)}>
          {buildings.map((building) => <option key={building.id} value={building.id}>{building.name}</option>)}
        </select>
      </div>

      {!building && <p className="mt-4 text-sm text-[#617169]">No buildings have been created yet.</p>}

      {building && (
        <div className="mt-5 grid gap-4">
          <div className="rounded-md border border-dashed border-[#cbd4ce] bg-[#f8faf7] p-3">
            <h3 className="font-semibold">Floors</h3>
            <div className="mt-3 flex flex-wrap gap-2">
              {floors.map((floor) => (
                <span key={floor.id} className="rounded-md border border-[#cbd4ce] bg-white px-3 py-2 text-sm">
                  {floor.name}
                </span>
              ))}
              {floors.length === 0 && <p className="text-sm text-[#617169]">No floors yet.</p>}
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
              <input
                className="field"
                value={floorName}
                onChange={(event) => setFloorName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void addFloor();
                }}
                placeholder="Add floor, e.g. Ground"
              />
              <button className="secondary" onClick={addFloor} disabled={!floorName}>Add floor</button>
            </div>
          </div>
          {floors.map((floor) => (
            <FloorBlock
              key={floor.id}
              floorName={floor.name}
              units={buildingUnits.filter((unit) => unit.floor === floor.name)}
              areas={areas}
              buildingFloors={buildingFloors}
              unitTypes={unitTypes}
              unitTypeAreas={unitTypeAreas}
              buildingId={building.id}
              onNotice={onNotice}
              reload={reload}
            />
          ))}
          {unmatchedUnits.length > 0 && (
            <FloorBlock
              floorName="Units with floor not in building floor list"
              units={unmatchedUnits}
              areas={areas}
              buildingFloors={buildingFloors}
              unitTypes={unitTypes}
              unitTypeAreas={unitTypeAreas}
              buildingId={building.id}
              onNotice={onNotice}
              reload={reload}
              warning
            />
          )}
          {noFloorUnits.length > 0 && (
            <FloorBlock
              floorName="Units without floor"
              units={noFloorUnits}
              areas={areas}
              buildingFloors={buildingFloors}
              unitTypes={unitTypes}
              unitTypeAreas={unitTypeAreas}
              buildingId={building.id}
              onNotice={onNotice}
              reload={reload}
              warning
            />
          )}
          <div className="rounded-md border border-[#c4ccc6] bg-[#f8faf7] p-4">
            <h3 className="font-semibold">Communal areas</h3>
            <div className="mt-3 flex flex-wrap gap-2">
              {communalAreas.map((area) => <AreaChip key={area.id} area={area} onNotice={onNotice} reload={reload} />)}
              {communalAreas.length === 0 && <p className="text-sm text-[#617169]">No communal areas yet.</p>}
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
              <input
                className="field"
                value={communalName}
                onChange={(event) => setCommunalName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void addCommunalArea();
                }}
                placeholder="Add communal area"
              />
              <button className="secondary" onClick={addCommunalArea} disabled={!communalName}>Add communal</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function FloorBlock({
  buildingId,
  floorName,
  units,
  areas,
  buildingFloors,
  unitTypes,
  unitTypeAreas,
  onNotice,
  reload,
  warning = false,
}: {
  buildingId: string;
  floorName: string;
  units: Unit[];
  areas: Area[];
  buildingFloors: BuildingFloor[];
  unitTypes: UnitType[];
  unitTypeAreas: UnitTypeArea[];
  onNotice: (notice: string) => void;
  reload: () => Promise<void>;
  warning?: boolean;
}) {
  const [unitNumber, setUnitNumber] = useState("");
  const [unitSizeSqm, setUnitSizeSqm] = useState("");
  const [unitTypeId, setUnitTypeId] = useState("");

  async function addUnitToFloor() {
    if (!unitNumber || !unitSizeSqm || !unitTypeId) {
      onNotice("Unit number, size and unit type are required.");
      return;
    }
    const duplicateUnit = units.some((unit) => unit.building_id === buildingId && unit.unit_number.toLowerCase() === unitNumber.trim().toLowerCase());
    if (duplicateUnit) {
      onNotice(`Unit ${unitNumber.trim()} already exists in this building.`);
      return;
    }
    const supabase = createSupabaseBrowserClient();
    const { data, error } = await supabase.from("units").insert({
      building_id: buildingId,
      unit_number: unitNumber.trim(),
      floor: floorName,
      unit_type_id: unitTypeId,
      unit_type: unitTypes.find((type) => type.id === unitTypeId)?.name ?? null,
      size_sqm: Number(unitSizeSqm),
      sale_status: "for_sale",
    }).select("id,building_id").single();
    if (error) {
      onNotice(error.code === "23505" ? `Unit ${unitNumber.trim()} already exists in this building.` : error.message);
      return;
    }
    const templateAreas = unitTypeAreas.filter((area) => area.unit_type_id === unitTypeId && !area.optional);
    if (templateAreas.length > 0) {
      const { error: areaError } = await supabase.from("areas").insert(templateAreas.map((area) => ({
        building_id: data.building_id,
        unit_id: data.id,
        area_type: "unit_room",
        name: area.name,
        sort_order: area.sort_order,
      })));
      if (areaError) onNotice(areaError.message);
    }
    setUnitNumber("");
    setUnitSizeSqm("");
    setUnitTypeId("");
    await reload();
  }

  return (
    <div className={`rounded-md border p-4 ${warning ? "border-[#e2c8a6] bg-[#fff8ec]" : "border-[#c4ccc6] bg-[#f8faf7]"}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">{floorName}</h3>
        <span className="text-sm text-[#617169]">{units.length} unit{units.length === 1 ? "" : "s"}</span>
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {units.map((unit) => {
          const unitType = unitTypes.find((type) => type.id === unit.unit_type_id)?.name ?? unit.unit_type ?? "No type";

          return (
            <UnitStructureCard
              key={unit.id}
              unit={unit}
              areas={areas}
              buildingFloors={buildingFloors}
              unitTypes={unitTypes}
              unitType={unitType}
              onNotice={onNotice}
              reload={reload}
            />
          );
        })}
        {units.length === 0 && <p className="text-sm text-[#617169]">No units on this floor.</p>}
      </div>
      {!warning && (
        <div className="mt-4 grid gap-2 rounded-md border border-dashed border-[#cbd4ce] bg-white p-3 lg:grid-cols-[1fr_1fr_1fr_auto]">
          <input className="field" value={unitNumber} onChange={(event) => setUnitNumber(event.target.value)} placeholder={`Add unit to ${floorName}`} />
          <input className="field" value={unitSizeSqm} onChange={(event) => setUnitSizeSqm(event.target.value)} placeholder="Size sqm" type="number" min="0" step="0.1" />
          <select className="field" value={unitTypeId} onChange={(event) => setUnitTypeId(event.target.value)}>
            <option value="">Unit type</option>
            {unitTypes.map((unitType) => <option key={unitType.id} value={unitType.id}>{unitType.name}</option>)}
          </select>
          <button className="secondary" onClick={addUnitToFloor} disabled={!unitNumber || !unitSizeSqm || !unitTypeId}>Add unit</button>
        </div>
      )}
    </div>
  );
}

function UnitStructureCard({
  unit,
  areas,
  buildingFloors,
  unitTypes,
  unitType,
  onNotice,
  reload,
}: {
  unit: Unit;
  areas: Area[];
  buildingFloors: BuildingFloor[];
  unitTypes: UnitType[];
  unitType: string;
  onNotice: (notice: string) => void;
  reload: () => Promise<void>;
}) {
  const [roomName, setRoomName] = useState("");
  const [editing, setEditing] = useState(false);
  const [editNumber, setEditNumber] = useState(unit.unit_number);
  const [editFloor, setEditFloor] = useState(unit.floor ?? "");
  const [editSizeSqm, setEditSizeSqm] = useState(unit.size_sqm?.toString() ?? "");
  const [editUnitTypeId, setEditUnitTypeId] = useState(unit.unit_type_id ?? "");
  const [editSaleStatus, setEditSaleStatus] = useState<Unit["sale_status"]>(unit.sale_status);
  const [areasToRemove, setAreasToRemove] = useState<string[]>([]);
  const [pendingRooms, setPendingRooms] = useState<string[]>([]);
  const [pendingAmenity, setPendingAmenity] = useState(false);
  const unitAreas = areas
    .filter((area) => area.unit_id === unit.id)
    .sort((a, b) => a.sort_order - b.sort_order);
  const rooms = unitAreas.filter((area) => area.area_type === "unit_room");
  const amenities = unitAreas.filter((area) => area.area_type === "private_amenity");
  const visibleRooms = rooms.filter((area) => !areasToRemove.includes(area.id));
  const visibleAmenities = amenities.filter((area) => !areasToRemove.includes(area.id));
  const floors = buildingFloors
    .filter((floor) => floor.building_id === unit.building_id)
    .sort((a, b) => a.sort_order - b.sort_order);

  useEffect(() => {
    setEditNumber(unit.unit_number);
    setEditFloor(unit.floor ?? "");
    setEditSizeSqm(unit.size_sqm?.toString() ?? "");
    setEditUnitTypeId(unit.unit_type_id ?? "");
    setEditSaleStatus(unit.sale_status);
    setAreasToRemove([]);
    setPendingRooms([]);
    setPendingAmenity(false);
  }, [unit.floor, unit.sale_status, unit.size_sqm, unit.unit_number, unit.unit_type_id]);

  function stageRoom() {
    const trimmed = roomName.trim();
    if (!trimmed) return;
    const roomAlreadyExists = visibleRooms.some((area) => area.name.toLowerCase() === trimmed.toLowerCase())
      || pendingRooms.some((name) => name.toLowerCase() === trimmed.toLowerCase());
    if (roomAlreadyExists) {
      onNotice(`${trimmed} already exists for this unit.`);
      return;
    }
    setPendingRooms((current) => [...current, trimmed]);
    setRoomName("");
  }

  function removeAreaFromEdit(areaId: string) {
    setAreasToRemove((current) => current.includes(areaId) ? current : [...current, areaId]);
  }

  async function saveUnit() {
    if (!editNumber || !editFloor || !editSizeSqm || !editUnitTypeId) {
      onNotice("Unit number, floor, size and unit type are required.");
      return;
    }
    const supabase = createSupabaseBrowserClient();
    if (areasToRemove.length > 0) {
      const { data: linkedSnags, error: linkedSnagsError } = await supabase
        .from("snags")
        .select("area_id")
        .in("area_id", areasToRemove);
      if (linkedSnagsError) {
        onNotice(linkedSnagsError.message);
        return;
      }
      if ((linkedSnags ?? []).length > 0) {
        const blockedAreaIds = new Set((linkedSnags ?? []).map((snag) => snag.area_id));
        const blockedNames = unitAreas
          .filter((area) => blockedAreaIds.has(area.id))
          .map((area) => area.area_type === "private_amenity" ? "Private Amenity" : area.name)
          .join(", ");
        onNotice(`Cannot remove ${blockedNames}. Move or close the linked snags first.`);
        return;
      }
    }

    const { error } = await supabase.from("units").update({
      unit_number: editNumber,
      floor: editFloor,
      size_sqm: Number(editSizeSqm),
      unit_type_id: editUnitTypeId,
      unit_type: unitTypes.find((type) => type.id === editUnitTypeId)?.name ?? null,
      sale_status: editSaleStatus,
    }).eq("id", unit.id);
    if (error) onNotice(error.message);
    else {
      if (areasToRemove.length > 0) {
        const { error: removeError } = await supabase.from("areas").delete().in("id", areasToRemove);
        if (removeError) {
          onNotice(removeError.message);
          return;
        }
      }
      const areasToAdd = [
        ...pendingRooms.map((name, index) => ({
          building_id: unit.building_id,
          unit_id: unit.id,
          area_type: "unit_room",
          name,
          sort_order: unitAreas.length + index + 1,
        })),
        ...(pendingAmenity && visibleAmenities.length === 0 ? [{
          building_id: unit.building_id,
          unit_id: unit.id,
          area_type: "private_amenity",
          name: "Private Amenity",
          sort_order: unitAreas.length + pendingRooms.length + 1,
        }] : []),
      ];
      if (areasToAdd.length > 0) {
        const { error: addError } = await supabase.from("areas").insert(areasToAdd);
        if (addError) {
          onNotice(addError.message);
          return;
        }
      }
      setAreasToRemove([]);
      setPendingRooms([]);
      setPendingAmenity(false);
      setEditing(false);
      await reload();
    }
  }

  function cancelEdit() {
    setEditNumber(unit.unit_number);
    setEditFloor(unit.floor ?? "");
    setEditSizeSqm(unit.size_sqm?.toString() ?? "");
    setEditUnitTypeId(unit.unit_type_id ?? "");
    setEditSaleStatus(unit.sale_status);
    setAreasToRemove([]);
    setPendingRooms([]);
    setPendingAmenity(false);
    setRoomName("");
    setEditing(false);
  }

  return (
    <article className="rounded-md border border-[#d9ded6] bg-white p-3">
              {editing ? (
                <div className="grid gap-2 rounded-md border border-dashed border-[#cbd4ce] bg-[#f8faf7] p-3">
                  <div className="grid gap-2 sm:grid-cols-2">
                    <input className="field" value={editNumber} onChange={(event) => setEditNumber(event.target.value)} placeholder="Unit number" />
                    <select className="field" value={editFloor} onChange={(event) => setEditFloor(event.target.value)}>
                      <option value="">Floor</option>
                      {floors.map((floor) => <option key={floor.id} value={floor.name}>{floor.name}</option>)}
                    </select>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <input className="field" value={editSizeSqm} onChange={(event) => setEditSizeSqm(event.target.value)} placeholder="Size sqm" type="number" min="0" step="0.1" />
                    <select className="field" value={editUnitTypeId} onChange={(event) => setEditUnitTypeId(event.target.value)}>
                      <option value="">Unit type</option>
                      {unitTypes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                    </select>
                  </div>
                  <select className="field" value={editSaleStatus} onChange={(event) => setEditSaleStatus(event.target.value as Unit["sale_status"])}>
                    {unitSaleStatuses.map((status) => <option key={status.value} value={status.value}>{status.label}</option>)}
                  </select>
                  <div className="flex flex-wrap gap-2">
                    <button className="primary" onClick={saveUnit} disabled={!editNumber || !editFloor || !editSizeSqm || !editUnitTypeId}>Save unit</button>
                    <button className="secondary" onClick={cancelEdit}>Cancel</button>
                  </div>
                  <div className="rounded-md border border-[#d9ded6] bg-white p-3">
                    <p className="text-xs font-semibold uppercase text-[#617169]">Rooms</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {visibleRooms.map((area) => <AreaChip key={area.id} area={area} canRemove onRemove={() => removeAreaFromEdit(area.id)} />)}
                      {pendingRooms.map((name) => (
                        <span key={name} className="inline-flex items-center gap-2 rounded-md bg-[#edf4f1] px-2 py-1 text-xs text-[#0F3D31]">
                          {name}
                          <button
                            aria-label={`Remove pending ${name}`}
                            className="rounded-full p-0.5 text-[#b42318] transition hover:bg-[#fee4e2]"
                            onClick={() => setPendingRooms((current) => current.filter((item) => item !== name))}
                            title={`Remove ${name}`}
                          >
                            <X size={13} strokeWidth={2.5} />
                          </button>
                        </span>
                      ))}
                      {visibleRooms.length === 0 && pendingRooms.length === 0 && <span className="text-sm text-[#a15b3d]">No rooms</span>}
                    </div>
                    <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                      <input
                        className="field"
                        value={roomName}
                        onChange={(event) => setRoomName(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") stageRoom();
                        }}
                        placeholder="Add room"
                      />
                      <button className="secondary" onClick={stageRoom} disabled={!roomName.trim()}>Add room</button>
                    </div>
                  </div>
                  <div className="rounded-md border border-[#d9ded6] bg-white p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-xs font-semibold uppercase text-[#617169]">Private amenity</p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {visibleAmenities.map((area) => <AreaChip key={area.id} area={area} canRemove onRemove={() => removeAreaFromEdit(area.id)} />)}
                          {pendingAmenity && (
                            <span className="inline-flex items-center gap-2 rounded-md bg-[#f5eee3] px-2 py-1 text-xs text-[#735327]">
                              Private Amenity
                              <button
                                aria-label="Remove pending Private Amenity"
                                className="rounded-full p-0.5 text-[#b42318] transition hover:bg-[#fee4e2]"
                                onClick={() => setPendingAmenity(false)}
                                title="Remove Private Amenity"
                              >
                                <X size={13} strokeWidth={2.5} />
                              </button>
                            </span>
                          )}
                          {visibleAmenities.length === 0 && !pendingAmenity && <span className="text-sm text-[#617169]">None</span>}
                        </div>
                      </div>
                      {visibleAmenities.length === 0 && !pendingAmenity && (
                        <button className="secondary" onClick={() => setPendingAmenity(true)}>Add amenity</button>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h4 className="font-semibold">Unit {unit.unit_number}</h4>
                    <p className="text-sm text-[#617169]">{unitType}{unit.size_sqm ? ` / ${unit.size_sqm} sqm` : ""}</p>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <span className={`rounded-md px-2 py-1 text-xs font-semibold ${statusTone(unit.sale_status)}`}>{statusLabel(unit.sale_status)}</span>
                    <button className="secondary px-2 py-1 text-xs" onClick={() => setEditing(true)}>Edit</button>
                  </div>
                </div>
              )}
              <div className="mt-3">
                <p className="text-xs font-semibold uppercase text-[#617169]">Rooms</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {rooms.map((area) => <AreaChip key={area.id} area={area} canRemove={false} onNotice={onNotice} reload={reload} />)}
                  {rooms.length === 0 && <span className="text-sm text-[#a15b3d]">No rooms</span>}
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[#edf0ec] pt-3">
                <div>
                  <p className="text-xs font-semibold uppercase text-[#617169]">Private amenity</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {amenities.length > 0 ? (
                      amenities.map((area) => <AreaChip key={area.id} area={area} canRemove={false} onNotice={onNotice} reload={reload} />)
                    ) : (
                      <span className="text-sm text-[#617169]">None</span>
                    )}
                  </div>
                </div>
              </div>
            </article>
  );
}

function AreaChip({
  area,
  canRemove = true,
  onRemove,
  onNotice,
  reload,
}: {
  area: Area;
  canRemove?: boolean;
  onRemove?: () => void;
  onNotice?: (notice: string) => void;
  reload?: () => Promise<void>;
}) {
  const tone = area.area_type === "private_amenity"
    ? "bg-[#f5eee3] text-[#735327]"
    : area.area_type === "communal_area"
      ? "border border-[#cbd4ce] bg-white text-[#34413a]"
      : "bg-[#edf4f1] text-[#0F3D31]";
  const label = area.area_type === "private_amenity" ? "Private Amenity" : area.name;

  async function deleteArea() {
    if (onRemove) {
      onRemove();
      return;
    }
    if (!onNotice || !reload) return;
    const supabase = createSupabaseBrowserClient();
    const { count, error: countError } = await supabase
      .from("snags")
      .select("id", { count: "exact", head: true })
      .eq("area_id", area.id);
    if (countError) {
      onNotice(countError.message);
      return;
    }
    if ((count ?? 0) > 0) {
      onNotice(`This area has ${count} snag${count === 1 ? "" : "s"}. Move or close those snags before removing it.`);
      return;
    }
    const confirmed = window.confirm(`Remove ${label}?`);
    if (!confirmed) return;
    const { error } = await supabase.from("areas").delete().eq("id", area.id);
    if (error) onNotice(error.message);
    else await reload();
  }

  return (
    <span className={`inline-flex items-center gap-2 rounded-md px-2 py-1 text-xs ${tone}`}>
      {label}{area.floor ? ` / ${area.floor}` : ""}
      {canRemove && (
        <button
          aria-label={`Remove ${label}`}
          className="rounded-full p-0.5 text-[#b42318] transition hover:bg-[#fee4e2]"
          onClick={deleteArea}
          title={`Remove ${label}`}
        >
          <X size={13} strokeWidth={2.5} />
        </button>
      )}
    </span>
  );
}

function AdminSetup({
  buildings,
  units,
  areas,
  buildingFloors,
  unitTypes,
  unitTypeAreas,
  recordAudit,
  onNotice,
  reload,
}: {
  buildings: Building[];
  units: Unit[];
  areas: Area[];
  buildingFloors: BuildingFloor[];
  unitTypes: UnitType[];
  unitTypeAreas: UnitTypeArea[];
  recordAudit: (event: Omit<AuditEvent, "id" | "created_at" | "created_by_user_id">) => Promise<void>;
  onNotice: (notice: string) => void;
  reload: () => Promise<void>;
}) {
  const [buildingName, setBuildingName] = useState("");
  const [addressLine1, setAddressLine1] = useState("");
  const [addressLine2, setAddressLine2] = useState("");
  const [town, setTown] = useState("");
  const [postcode, setPostcode] = useState("");
  const [pcDate, setPcDate] = useState("");

  async function createBuilding() {
    const supabase = createSupabaseBrowserClient();
    const defectsEnd = pcDate ? new Date(new Date(pcDate).setFullYear(new Date(pcDate).getFullYear() + 1)).toISOString().slice(0, 10) : null;
    const { data, error } = await supabase.from("buildings").insert({
      name: buildingName,
      address_line_1: addressLine1,
      address_line_2: addressLine2,
      town,
      postcode,
      practical_completion_date: pcDate || null,
      defects_liability_end_date: defectsEnd,
      status: "active",
    }).select("id").single();
    if (error) onNotice(error.message);
    else {
      await recordAudit({
        event_type: "building_created",
        entity_type: "building",
        entity_id: data.id,
        summary: `Building created: ${buildingName}`,
        metadata: { name: buildingName, postcode },
      });
      setBuildingName("");
      setAddressLine1("");
      setAddressLine2("");
      setTown("");
      setPostcode("");
      setPcDate("");
      await reload();
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <div className="lg:col-span-3">
        <BuildingStructureView
          buildings={buildings}
          buildingFloors={buildingFloors}
          units={units}
          areas={areas}
          unitTypes={unitTypes}
          unitTypeAreas={unitTypeAreas}
          onNotice={onNotice}
          reload={reload}
        />
      </div>
      <FormPanel title="Building">
        <input className="field" value={buildingName} onChange={(event) => setBuildingName(event.target.value)} placeholder="Building name" />
        <input className="field" value={addressLine1} onChange={(event) => setAddressLine1(event.target.value)} placeholder="Address line 1" />
        <input className="field" value={addressLine2} onChange={(event) => setAddressLine2(event.target.value)} placeholder="Address line 2" />
        <div className="grid gap-3 sm:grid-cols-2">
          <input className="field" value={town} onChange={(event) => setTown(event.target.value)} placeholder="Town" />
          <input className="field" value={postcode} onChange={(event) => setPostcode(event.target.value)} placeholder="Postcode" />
        </div>
        <label className="grid gap-1 text-sm font-medium text-[#34413a]">
          Practical completion date
          <input className="field" value={pcDate} onChange={(event) => setPcDate(event.target.value)} type="date" />
        </label>
        <button className="primary" onClick={createBuilding} disabled={!buildingName}>Create building</button>
      </FormPanel>
      <section className="rounded-md border border-[#d9ded6] bg-white p-4 lg:col-span-3">
        <h2 className="text-lg font-semibold">Current setup</h2>
        <p className="mt-2 text-sm text-[#617169]">{buildings.length} buildings, {buildingFloors.length} floors, {units.length} units, {areas.length} areas.</p>
      </section>
    </div>
  );
}

function DeveloperSnagging({
  user,
  buildings,
  units,
  areas,
  trades,
  onNotice,
  reload,
  uploadFile,
}: {
  user: User;
  buildings: Building[];
  units: Unit[];
  areas: Area[];
  trades: Trade[];
  onNotice: (notice: string) => void;
  reload: () => Promise<void>;
  uploadFile: (dataUrl: string, folder: string) => Promise<string>;
}) {
  const [draft, setDraft] = useState<SnagDraft>(emptySnagDraft);
  const selectedUnit = units.find((unit) => unit.id === draft.unitId);
  const selectedBuilding = buildings.find((building) => building.id === (draft.buildingId || selectedUnit?.building_id));
  const unitAreas = areas.filter((area) => area.unit_id === draft.unitId || (!draft.unitId && area.area_type === "communal_area"));

  async function createDeveloperSnag() {
    if (!draft.title || !draft.photoDataUrl || !draft.areaId) {
      onNotice("Developer snags need a room/area, title and photo.");
      return;
    }

    const supabase = createSupabaseBrowserClient();
    const photoUrl = await uploadFile(draft.photoDataUrl, "snags");
    const { data, error } = await supabase.from("snags").insert({
      building_id: draft.buildingId || selectedUnit?.building_id,
      unit_id: draft.unitId || null,
      area_id: draft.areaId || null,
      source_type: "developer_snag",
      created_by: user.id,
      created_by_user_id: user.id,
      title: draft.title,
      description: draft.description,
      trade_id: draft.tradeId || null,
      priority: null,
      priority_code: null,
      status: "open",
      sla_due_date: null,
    }).select("id").single();

    if (error) {
      onNotice(error.message);
      return;
    }

    await supabase.from("snag_photos").insert({ snag_id: data.id, file_url: photoUrl, photo_type: "annotated", uploaded_by_user_id: user.id });
    await supabase.from("snag_events").insert({ snag_id: data.id, event_type: "created", new_value: "open", created_by_user_id: user.id });
    setDraft({ ...emptySnagDraft, buildingId: draft.buildingId, unitId: draft.unitId, areaId: draft.areaId });
    onNotice("");
    await reload();
  }

  return (
    <div className="max-w-xl">
      <FormPanel title="Add developer snag">
        <select className="field" value={draft.buildingId} onChange={(event) => setDraft({ ...draft, buildingId: event.target.value, unitId: "" })}>
          <option value="">Select building</option>
          {buildings.map((building) => <option key={building.id} value={building.id}>{building.name}</option>)}
        </select>
        <select className="field" value={draft.unitId} onChange={(event) => setDraft({ ...draft, unitId: event.target.value, areaId: "" })}>
          <option value="">Communal / no unit</option>
          {units.filter((unit) => !draft.buildingId || unit.building_id === draft.buildingId).map((unit) => <option key={unit.id} value={unit.id}>{unit.unit_number}</option>)}
        </select>
        <select className="field" value={draft.areaId} onChange={(event) => setDraft({ ...draft, areaId: event.target.value })}>
          <option value="">Select room / area</option>
          {unitAreas.map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}
        </select>
        <input className="field" value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} maxLength={50} placeholder="Title" />
        <textarea className="field min-h-24 py-3" value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} placeholder="Description" />
        <select className="field" value={draft.tradeId} onChange={(event) => setDraft({ ...draft, tradeId: event.target.value })}>
          <option value="">Trade</option>
          {trades.map((trade) => <option key={trade.id} value={trade.id}>{trade.name}</option>)}
        </select>
        <PhotoInput value={draft.photoDataUrl} onChange={(photoDataUrl) => setDraft({ ...draft, photoDataUrl })} />
        <button className="primary" onClick={createDeveloperSnag} disabled={!draft.areaId || !draft.title || !draft.photoDataUrl}><Plus size={16} /> Save and add another</button>
      </FormPanel>
    </div>
  );
}

function UserAdmin({
  buildings,
  units,
  organisations,
  profiles,
  userBuildingAccess,
  userUnitAccess,
  recordAudit,
  onNotice,
  reload,
}: {
  buildings: Building[];
  units: Unit[];
  organisations: Organisation[];
  profiles: Profile[];
  userBuildingAccess: UserBuildingAccess[];
  userUnitAccess: UserUnitAccess[];
  recordAudit: (event: Omit<AuditEvent, "id" | "created_at" | "created_by_user_id">) => Promise<void>;
  onNotice: (notice: string) => void;
  reload: () => Promise<void>;
}) {
  const [mode, setMode] = useState<"list" | "add">("list");
  const [editingUserId, setEditingUserId] = useState("");

  return (
    <div className="grid gap-5">
      {mode === "add" ? (
        <UserEnrolment
          buildings={buildings}
          units={units}
          organisations={organisations}
          onCancel={() => setMode("list")}
          recordAudit={recordAudit}
          onNotice={onNotice}
          reload={reload}
        />
      ) : (
        <UserDirectory
          buildings={buildings}
          units={units}
          organisations={organisations}
          profiles={profiles}
          userBuildingAccess={userBuildingAccess}
          userUnitAccess={userUnitAccess}
          editingUserId={editingUserId}
          recordAudit={recordAudit}
          onAddUser={() => setMode("add")}
          onEditUser={setEditingUserId}
          onNotice={onNotice}
          reload={reload}
        />
      )}
      <OrganisationManagement organisations={organisations} profiles={profiles} recordAudit={recordAudit} onNotice={onNotice} reload={reload} />
    </div>
  );
}

function UserDirectory({
  buildings,
  units,
  organisations,
  profiles,
  userBuildingAccess,
  userUnitAccess,
  editingUserId,
  recordAudit,
  onAddUser,
  onEditUser,
  onNotice,
  reload,
}: {
  buildings: Building[];
  units: Unit[];
  organisations: Organisation[];
  profiles: Profile[];
  userBuildingAccess: UserBuildingAccess[];
  userUnitAccess: UserUnitAccess[];
  editingUserId: string;
  recordAudit: (event: Omit<AuditEvent, "id" | "created_at" | "created_by_user_id">) => Promise<void>;
  onAddUser: () => void;
  onEditUser: (userId: string) => void;
  onNotice: (notice: string) => void;
  reload: () => Promise<void>;
}) {
  function organisationName(profile: Profile) {
    return organisations.find((organisation) => organisation.id === profile.organisation_id)?.name ?? "";
  }

  function allocationLabel(profile: Profile) {
    if (profile.role === "admin" || profile.role === "developer") return "All buildings";

    const unitIds = userUnitAccess.filter((access) => access.user_id === profile.id).map((access) => access.unit_id);
    const buildingIds = userBuildingAccess.filter((access) => access.user_id === profile.id).map((access) => access.building_id);

    if (profile.role === "resident") {
      const labels = unitIds.map((unitId) => {
        const unit = units.find((item) => item.id === unitId);
        const building = buildings.find((item) => item.id === unit?.building_id);
        return unit ? `${building?.name ?? "Building"} ${unit.unit_number}` : "";
      }).filter(Boolean);
      return labels.length > 0 ? labels.join(", ") : "No units assigned";
    }

    const labels = buildingIds.map((buildingId) => buildings.find((building) => building.id === buildingId)?.name).filter(Boolean);
    return labels.length > 0 ? labels.join(", ") : "No buildings assigned";
  }

  return (
    <section className="rounded-md border border-[#d9ded6] bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#d9ded6] px-4 py-3">
        <div>
          <h2 className="text-lg font-semibold">Users</h2>
          <p className="text-sm text-[#617169]">Roles, allocation and account dates.</p>
        </div>
        <button className="primary min-h-9 px-3 py-1.5 text-sm" onClick={onAddUser}>
          <Plus size={16} /> Add user
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-[980px] w-full border-separate border-spacing-0 text-sm">
          <thead>
            <tr className="text-left text-xs font-semibold uppercase text-[#617169]">
              <th className="border-b border-[#d9ded6] px-3 py-2">User</th>
              <th className="border-b border-[#d9ded6] px-3 py-2">Role</th>
              <th className="border-b border-[#d9ded6] px-3 py-2">Resident Type</th>
              <th className="border-b border-[#d9ded6] px-3 py-2">Organisation</th>
              <th className="border-b border-[#d9ded6] px-3 py-2">Allocation</th>
              <th className="border-b border-[#d9ded6] px-3 py-2">Created</th>
              <th className="border-b border-[#d9ded6] px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {profiles.map((profile) => {
              const isEditing = profile.id === editingUserId;

              return (
                <Fragment key={profile.id}>
                  <tr className={isEditing ? "bg-[#fff8ec]" : ""}>
                    <td className="border-b border-[#e5e9e4] px-3 py-3 align-middle">
                      <p className="font-medium">{profile.full_name || profile.name || "No name"}</p>
                      <p className="text-xs text-[#617169]">{profile.email}</p>
                    </td>
                    <td className="border-b border-[#e5e9e4] px-3 py-3 align-middle">{statusLabel(profile.role)}</td>
                    <td className="border-b border-[#e5e9e4] px-3 py-3 align-middle">
                      {profile.role === "resident" && profile.resident_type ? statusLabel(profile.resident_type) : <span className="text-xs text-[#9aa59f]">None</span>}
                    </td>
                    <td className="border-b border-[#e5e9e4] px-3 py-3 align-middle">{organisationName(profile) || <span className="text-xs text-[#9aa59f]">None</span>}</td>
                    <td className="border-b border-[#e5e9e4] px-3 py-3 align-middle">
                      <p className="max-w-md truncate">{allocationLabel(profile)}</p>
                    </td>
                    <td className="border-b border-[#e5e9e4] px-3 py-3 align-middle whitespace-nowrap">{profile.created_at ? formatDate(profile.created_at) : "Unknown"}</td>
                    <td className="border-b border-[#e5e9e4] px-3 py-3 align-middle text-right">
                      <button className="secondary min-h-8 px-2 py-1 text-xs" onClick={() => onEditUser(isEditing ? "" : profile.id)}>
                        {isEditing ? "Close" : "Edit"}
                      </button>
                    </td>
                  </tr>
                  {isEditing && (
                    <tr>
                      <td colSpan={7} className="border-b border-[#d9ded6] bg-[#fff8ec] p-3">
                        <UserEditPanel
                          profile={profile}
                          buildings={buildings}
                          units={units}
                          organisations={organisations}
                          userBuildingAccess={userBuildingAccess.filter((access) => access.user_id === profile.id)}
                          userUnitAccess={userUnitAccess.filter((access) => access.user_id === profile.id)}
                          recordAudit={recordAudit}
                          onClose={() => onEditUser("")}
                          onNotice={onNotice}
                          reload={reload}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
        {profiles.length === 0 && <p className="p-4 text-sm text-[#617169]">No users yet.</p>}
      </div>
    </section>
  );
}

function UserEditPanel({
  profile,
  buildings,
  units,
  organisations,
  userBuildingAccess,
  userUnitAccess,
  recordAudit,
  onClose,
  onNotice,
  reload,
}: {
  profile: Profile;
  buildings: Building[];
  units: Unit[];
  organisations: Organisation[];
  userBuildingAccess: UserBuildingAccess[];
  userUnitAccess: UserUnitAccess[];
  recordAudit: (event: Omit<AuditEvent, "id" | "created_at" | "created_by_user_id">) => Promise<void>;
  onClose: () => void;
  onNotice: (notice: string) => void;
  reload: () => Promise<void>;
}) {
  const [fullName, setFullName] = useState(profile.full_name || profile.name || "");
  const [role, setRole] = useState<AppRole>(profile.role);
  const [residentType, setResidentType] = useState<ResidentType>(profile.resident_type ?? "leaseholder");
  const [organisationId, setOrganisationId] = useState(profile.organisation_id ?? "");
  const [selectedBuildingIds, setSelectedBuildingIds] = useState<string[]>(userBuildingAccess.map((access) => access.building_id));
  const [selectedUnitIds, setSelectedUnitIds] = useState<string[]>(userUnitAccess.map((access) => access.unit_id));
  const [isSaving, setIsSaving] = useState(false);
  const isResident = role === "resident";
  const needsOrganisationAndBuilding = role === "developer_representative" || role === "contractor";
  const organisationsForRole = organisations.filter((organisation) => organisation.type === role);
  const selectedUnits = units.filter((unit) => selectedUnitIds.includes(unit.id));
  const selectedResidentBuildingIds = Array.from(new Set(selectedUnits.map((unit) => unit.building_id)));
  const buildingIdsForSave = isResident ? selectedResidentBuildingIds : selectedBuildingIds;
  const canSave = Boolean(
    fullName &&
    (!isResident || (residentType && selectedUnitIds.length > 0)) &&
    (!needsOrganisationAndBuilding || (organisationId && selectedBuildingIds.length > 0)),
  );

  function toggleBuilding(buildingId: string) {
    setSelectedBuildingIds((current) => (
      current.includes(buildingId) ? current.filter((item) => item !== buildingId) : [...current, buildingId]
    ));
  }

  function toggleUnit(unitId: string) {
    setSelectedUnitIds((current) => (
      current.includes(unitId) ? current.filter((item) => item !== unitId) : [...current, unitId]
    ));
  }

  async function saveUser() {
    if (!canSave) return;
    setIsSaving(true);
    onNotice("");

    try {
      const supabase = createSupabaseBrowserClient();
      const { data } = await supabase.auth.getSession();
      const response = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${data.session?.access_token ?? ""}`,
        },
        body: JSON.stringify({
          userId: profile.id,
          fullName,
          role,
          residentType: isResident ? residentType : null,
          organisationId: needsOrganisationAndBuilding ? organisationId : undefined,
          buildingIds: buildingIdsForSave,
          unitAccess: isResident ? selectedUnitIds.map((unitId) => ({ unitId, accessType: residentType })) : [],
        }),
      });
      const payload = (await response.json()) as { error?: string };

      if (!response.ok) {
        onNotice(payload.error ?? "Could not update user.");
        return;
      }

      await recordAudit({
        event_type: "user_updated",
        entity_type: "user",
        entity_id: profile.id,
        summary: `User updated: ${profile.email}`,
        metadata: {
          email: profile.email,
          role,
          residentType: isResident ? residentType : null,
          organisationId: needsOrganisationAndBuilding ? organisationId : null,
          buildingIds: buildingIdsForSave,
          unitIds: selectedUnitIds,
        },
      });
      onNotice("");
      onClose();
      await reload();
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="bg-[#fff8ec] p-1">
      <div className="rounded-md border border-[#d9ded6] bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-semibold">Edit user</h3>
            <p className="text-sm text-[#617169]">{profile.email}</p>
          </div>
          <button className="secondary min-h-8 px-2 py-1 text-xs" onClick={onClose}>Cancel</button>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <input className="field" value={fullName} onChange={(event) => setFullName(event.target.value)} placeholder="Name" />
          <select
            className="field"
            value={role}
            onChange={(event) => {
              setRole(event.target.value as AppRole);
              if (event.target.value !== "resident") setResidentType("leaseholder");
              setOrganisationId("");
              setSelectedBuildingIds([]);
              setSelectedUnitIds([]);
            }}
          >
            {appRoles.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
          {isResident && (
            <select className="field" value={residentType} onChange={(event) => setResidentType(event.target.value as ResidentType)}>
              {residentTypes.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          )}
          {needsOrganisationAndBuilding && (
            <select className="field" value={organisationId} onChange={(event) => setOrganisationId(event.target.value)}>
              <option value="">Organisation</option>
              {organisationsForRole.map((organisation) => (
                <option key={organisation.id} value={organisation.id}>{organisation.name}</option>
              ))}
            </select>
          )}
        </div>
        {needsOrganisationAndBuilding && (
          <AccessBuildingPicker buildings={buildings} selectedBuildingIds={selectedBuildingIds} onToggle={toggleBuilding} />
        )}
        {isResident && (
          <AccessUnitPicker buildings={buildings} units={units} selectedUnitIds={selectedUnitIds} onToggle={toggleUnit} />
        )}
        <button className="primary mt-4 w-full" onClick={saveUser} disabled={isSaving || !canSave}>
          {isSaving ? "Saving user" : "Save user"}
        </button>
      </div>
    </div>
  );
}

function AccessBuildingPicker({ buildings, selectedBuildingIds, onToggle }: { buildings: Building[]; selectedBuildingIds: string[]; onToggle: (buildingId: string) => void }) {
  return (
    <div className="mt-4 rounded-md border border-[#d9ded6] bg-[#f8faf7] p-3">
      <p className="text-sm font-semibold">Building access</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {buildings.map((building) => (
          <label key={building.id} className="flex items-center gap-2 rounded-md border border-[#d9ded6] bg-white px-3 py-2 text-sm">
            <input checked={selectedBuildingIds.includes(building.id)} onChange={() => onToggle(building.id)} type="checkbox" />
            {building.name}
          </label>
        ))}
        {buildings.length === 0 && <p className="text-sm text-[#617169]">No buildings yet.</p>}
      </div>
    </div>
  );
}

function AccessUnitPicker({ buildings, units, selectedUnitIds, onToggle }: { buildings: Building[]; units: Unit[]; selectedUnitIds: string[]; onToggle: (unitId: string) => void }) {
  return (
    <div className="mt-4 rounded-md border border-[#d9ded6] bg-[#f8faf7] p-3">
      <p className="text-sm font-semibold">Unit access</p>
      <div className="mt-3 grid gap-3">
        {buildings.map((building) => {
          const buildingUnits = units.filter((unit) => unit.building_id === building.id);
          return (
            <div key={building.id} className="rounded-md border border-[#d9ded6] bg-white p-3">
              <p className="text-sm font-semibold">{building.name}</p>
              <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {buildingUnits.map((unit) => (
                  <label key={unit.id} className="flex items-center gap-2 rounded-md bg-[#f8faf7] px-3 py-2 text-sm">
                    <input checked={selectedUnitIds.includes(unit.id)} onChange={() => onToggle(unit.id)} type="checkbox" />
                    {unit.unit_number}
                  </label>
                ))}
                {buildingUnits.length === 0 && <p className="text-sm text-[#617169]">No units yet.</p>}
              </div>
            </div>
          );
        })}
        {buildings.length === 0 && <p className="text-sm text-[#617169]">No buildings yet.</p>}
      </div>
    </div>
  );
}

function UserEnrolment({
  buildings,
  units,
  organisations,
  onCancel,
  recordAudit,
  onNotice,
  reload,
}: {
  buildings: Building[];
  units: Unit[];
  organisations: Organisation[];
  onCancel: () => void;
  recordAudit: (event: Omit<AuditEvent, "id" | "created_at" | "created_by_user_id">) => Promise<void>;
  onNotice: (notice: string) => void;
  reload: () => Promise<void>;
}) {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<AppRole>("resident");
  const [residentType, setResidentType] = useState<ResidentType>("leaseholder");
  const [organisationId, setOrganisationId] = useState("");
  const [selectedBuildingIds, setSelectedBuildingIds] = useState<string[]>([]);
  const [selectedUnitIds, setSelectedUnitIds] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isResident = role === "resident";
  const needsOrganisationAndBuilding = role === "developer_representative" || role === "contractor";
  const organisationsForRole = organisations.filter((organisation) => organisation.type === role);
  const selectedUnits = units.filter((unit) => selectedUnitIds.includes(unit.id));
  const selectedResidentBuildingIds = Array.from(new Set(selectedUnits.map((unit) => unit.building_id)));
  const selectedBuildingAccessIds = isResident ? selectedResidentBuildingIds : selectedBuildingIds;
  const canCreateUser = Boolean(
    fullName &&
    email &&
    password &&
    (!isResident || (residentType && selectedUnitIds.length > 0)) &&
    (!needsOrganisationAndBuilding || (organisationId && selectedBuildingIds.length > 0)),
  );

  function toggleBuilding(buildingId: string) {
    setSelectedBuildingIds((current) => (
      current.includes(buildingId) ? current.filter((item) => item !== buildingId) : [...current, buildingId]
    ));
  }

  function toggleUnit(unitId: string) {
    setSelectedUnitIds((current) => (
      current.includes(unitId) ? current.filter((item) => item !== unitId) : [...current, unitId]
    ));
  }

  async function enrolUser() {
    if (!email || !password || !fullName) {
      onNotice("Name, email and temporary password are required.");
      return;
    }

    if (isResident && selectedUnitIds.length === 0) {
      onNotice("Assign at least one unit for residents.");
      return;
    }

    if (needsOrganisationAndBuilding && !organisationId) {
      onNotice("Assign an organisation.");
      return;
    }

    setIsSubmitting(true);
    onNotice("");

    try {
      const supabase = createSupabaseBrowserClient();
      const { data } = await supabase.auth.getSession();
      const response = await fetch("/api/admin/users", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${data.session?.access_token ?? ""}`,
        },
        body: JSON.stringify({
          email,
          password,
          fullName,
          role,
          residentType: isResident ? residentType : null,
          organisationId: needsOrganisationAndBuilding ? organisationId : undefined,
          buildingIds: selectedBuildingAccessIds,
          unitAccess: isResident
            ? selectedUnitIds.map((unitId) => ({ unitId, accessType: residentType }))
            : [],
        }),
      });
      const payload = (await response.json()) as { error?: string; id?: string; email?: string };

      if (!response.ok) {
        onNotice(payload.error ?? "Could not enrol user.");
        return;
      }

      setFullName("");
      setEmail("");
      setPassword("");
      setRole("resident");
      setResidentType("leaseholder");
      setOrganisationId("");
      setSelectedBuildingIds([]);
      setSelectedUnitIds([]);
      await recordAudit({
        event_type: "user_created",
        entity_type: "user",
        entity_id: payload.id ?? null,
        summary: `User created: ${payload.email}`,
        metadata: {
          email: payload.email,
          role,
          residentType: isResident ? residentType : null,
          organisationId: needsOrganisationAndBuilding ? organisationId : null,
          buildingIds: selectedBuildingAccessIds,
          unitIds: selectedUnitIds,
        },
      });
      onNotice(`Enrolled ${payload.email}.`);
      await reload();
      onCancel();
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="rounded-md border border-[#d9ded6] bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Add user</h2>
          <p className="text-sm text-[#617169]">Create the account and assign access.</p>
        </div>
        <button className="secondary min-h-8 px-2 py-1 text-xs" onClick={onCancel}>Back to users</button>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <input className="field" value={fullName} onChange={(event) => setFullName(event.target.value)} placeholder="Name" />
        <input className="field" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Email" type="email" />
        <input className="field" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Temporary password" type="password" />
        <select
          className="field"
          value={role}
          onChange={(event) => {
            setRole(event.target.value as AppRole);
            if (event.target.value !== "resident") setResidentType("leaseholder");
            setOrganisationId("");
            setSelectedBuildingIds([]);
            setSelectedUnitIds([]);
          }}
        >
          {appRoles.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select>
        {isResident && (
          <select className="field" value={residentType} onChange={(event) => setResidentType(event.target.value as ResidentType)}>
            {residentTypes.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        )}
        {needsOrganisationAndBuilding && (
          <select className="field" value={organisationId} onChange={(event) => setOrganisationId(event.target.value)}>
            <option value="">Organisation</option>
            {organisationsForRole.map((organisation) => (
              <option key={organisation.id} value={organisation.id}>{organisation.name}</option>
            ))}
          </select>
        )}
      </div>
      {needsOrganisationAndBuilding && (
        <AccessBuildingPicker buildings={buildings} selectedBuildingIds={selectedBuildingIds} onToggle={toggleBuilding} />
      )}
      {isResident && (
        <AccessUnitPicker buildings={buildings} units={units} selectedUnitIds={selectedUnitIds} onToggle={toggleUnit} />
      )}
      <button className="primary mt-4 w-full" onClick={enrolUser} disabled={isSubmitting || !canCreateUser}>
        {isSubmitting ? "Enrolling user" : "Create user and assign access"}
      </button>
      <p className="mt-3 text-sm text-[#617169]">
        This currently creates the account with a temporary password. Invite email delivery can be added next using Supabase invite links.
      </p>
    </section>
  );
}

function OrganisationManagement({
  organisations,
  profiles,
  recordAudit,
  onNotice,
  reload,
}: {
  organisations: Organisation[];
  profiles: Profile[];
  recordAudit: (event: Omit<AuditEvent, "id" | "created_at" | "created_by_user_id">) => Promise<void>;
  onNotice: (notice: string) => void;
  reload: () => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState("contractor");
  const [editingId, setEditingId] = useState("");
  const [editName, setEditName] = useState("");
  const [editType, setEditType] = useState("contractor");
  const organisationTypeLabel = (value: string) => organisationTypes.find((item) => item.value === value)?.label ?? statusLabel(value);

  async function createOrganisation() {
    if (!name) return;
    const supabase = createSupabaseBrowserClient();
    const { data, error } = await supabase.from("organisations").insert({ name, type }).select("id").single();
    if (error) onNotice(error.message);
    else {
      await recordAudit({
        event_type: "organisation_created",
        entity_type: "organisation",
        entity_id: data.id,
        summary: `Organisation created: ${name}`,
        metadata: { name, type },
      });
      setName("");
      setType("contractor");
      await reload();
    }
  }

  function startEdit(organisation: Organisation) {
    setEditingId(organisation.id);
    setEditName(organisation.name);
    setEditType(organisation.type);
  }

  async function saveOrganisation() {
    if (!editingId || !editName) return;
    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.from("organisations").update({ name: editName, type: editType }).eq("id", editingId);
    if (error) onNotice(error.message);
    else {
      await recordAudit({
        event_type: "organisation_updated",
        entity_type: "organisation",
        entity_id: editingId,
        summary: `Organisation updated: ${editName}`,
        metadata: { name: editName, type: editType },
      });
      setEditingId("");
      setEditName("");
      setEditType("contractor");
      await reload();
    }
  }

  async function deleteOrganisation(organisation: Organisation) {
    const supabase = createSupabaseBrowserClient();
    const linkedUsers = profiles.filter((profile) => profile.organisation_id === organisation.id);
    const [{ count: userCount, error: userError }, { count: snagCount, error: snagError }] = await Promise.all([
      supabase.from("profiles").select("id", { count: "exact", head: true }).eq("organisation_id", organisation.id),
      supabase.from("snags").select("id", { count: "exact", head: true }).eq("assigned_to_organisation_id", organisation.id),
    ]);
    if (userError || snagError) {
      onNotice(userError?.message ?? snagError?.message ?? "Could not check organisation links.");
      return;
    }
    if ((userCount ?? 0) > 0 || (snagCount ?? 0) > 0) {
      const userNames = linkedUsers
        .slice(0, 3)
        .map((profile) => profile.full_name || profile.name || profile.email)
        .join(", ");
      const extraUsers = (userCount ?? linkedUsers.length) > 3 ? ` and ${(userCount ?? linkedUsers.length) - 3} more` : "";
      const userText = (userCount ?? 0) > 0 ? ` Linked users: ${userNames}${extraUsers}.` : "";
      const snagText = (snagCount ?? 0) > 0 ? ` Linked snags: ${snagCount}.` : "";
      await recordAudit({
        event_type: "organisation_delete_blocked",
        entity_type: "organisation",
        entity_id: organisation.id,
        summary: `Organisation delete blocked: ${organisation.name}`,
        metadata: { name: organisation.name, linkedUsers: userCount ?? 0, linkedSnags: snagCount ?? 0 },
      });
      onNotice(`This organisation cannot be deleted.${userText}${snagText}`);
      return;
    }
    const confirmed = window.confirm(`Delete ${organisation.name}?`);
    if (!confirmed) return;
    const { error } = await supabase.from("organisations").delete().eq("id", organisation.id);
    if (error) onNotice(error.message);
    else {
      await recordAudit({
        event_type: "organisation_deleted",
        entity_type: "organisation",
        entity_id: organisation.id,
        summary: `Organisation deleted: ${organisation.name}`,
        metadata: { name: organisation.name, type: organisation.type },
      });
      await reload();
    }
  }

  return (
    <section className="rounded-md border border-[#d9ded6] bg-white p-4">
      <h2 className="text-lg font-semibold">Organisations</h2>
      <div className="mt-4 grid gap-2">
        <input className="field" value={name} onChange={(event) => setName(event.target.value)} placeholder="Organisation name" />
        <select className="field" value={type} onChange={(event) => setType(event.target.value)}>
          {organisationTypes.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select>
        <button className="primary" onClick={createOrganisation} disabled={!name}>Create organisation</button>
      </div>
      <div className="mt-4 divide-y divide-[#e5e9e4]">
        {organisations.map((organisation) => (
          <div key={organisation.id} className="grid gap-2 py-3 text-sm">
            {editingId === organisation.id ? (
              <>
                <input className="field" value={editName} onChange={(event) => setEditName(event.target.value)} />
                <select className="field" value={editType} onChange={(event) => setEditType(event.target.value)}>
                  {organisationTypes.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                </select>
                <div className="flex flex-wrap gap-2">
                  <button className="secondary" onClick={saveOrganisation} disabled={!editName}>Save</button>
                  <button className="secondary" onClick={() => setEditingId("")}>Cancel</button>
                </div>
              </>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-medium">{organisation.name}</p>
                  <p className="text-xs text-[#617169]">{organisationTypeLabel(organisation.type)}</p>
                </div>
                <div className="flex gap-2">
                  <button className="secondary px-2 py-1 text-xs" onClick={() => startEdit(organisation)}>Edit</button>
                  <button
                    aria-label={`Delete ${organisation.name}`}
                    className="rounded-md border border-[#f1b8b2] p-2 text-[#b42318] transition hover:bg-[#fee4e2]"
                    onClick={() => deleteOrganisation(organisation)}
                    title={`Delete ${organisation.name}`}
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
        {organisations.length === 0 && <p className="py-4 text-sm text-[#617169]">No organisations yet.</p>}
      </div>
    </section>
  );
}

function SnagWorkflow({
  user,
  profile,
  buildings,
  snags,
  units,
  areas,
  trades,
  photos,
  events,
  profiles,
  onNotice,
  reload,
  uploadFile,
}: {
  user: User;
  profile: Profile | null;
  buildings: Building[];
  snags: ProductionSnag[];
  units: Unit[];
  areas: Area[];
  trades: Trade[];
  photos: SnagPhoto[];
  events: SnagEvent[];
  profiles: Profile[];
  onNotice: (notice: string) => void;
  reload: () => Promise<void>;
  uploadFile: (dataUrl: string, folder: string) => Promise<string>;
}) {
  const isContractorRole = profile?.role === "contractor";
  const canUseDeveloperActions = !isContractorRole;

  return (
    <SnagList
      title="Snags"
      buildings={buildings}
      snags={snags}
      units={units}
      areas={areas}
      trades={trades}
      photos={photos}
      events={events}
      profiles={profiles}
      user={user}
      onNotice={onNotice}
      reload={reload}
      uploadFile={uploadFile}
      showFilters
      canReject={canUseDeveloperActions}
      tradeControl={(snag, trade) => <ContractorTradeControl user={user} snag={snag} trade={trade} trades={trades} onNotice={onNotice} reload={reload} />}
      actions={(snag) => {
        const canClose = canUseDeveloperActions && snag.status === "resolved_by_contractor";
        const canRespondToInfoRequest = canUseDeveloperActions && snag.status === "needs_more_info";
        const canResolve = isContractorRole && !["closed", "resolved_by_contractor", "needs_more_info"].includes(snag.status);
        if (!canClose && !canRespondToInfoRequest && !canResolve) return null;

        return (
          <>
            {(canClose || canRespondToInfoRequest) && <DeveloperActions user={user} snag={snag} onNotice={onNotice} reload={reload} />}
            {canResolve && <ContractorActions user={user} snag={snag} onNotice={onNotice} reload={reload} />}
          </>
        );
      }}
    />
  );
}

function DeveloperActions({
  user,
  snag,
  onNotice,
  reload,
}: {
  user: User;
  snag: ProductionSnag;
  onNotice: (notice: string) => void;
  reload: () => Promise<void>;
}) {
  const isContractorResolved = snag.status === "resolved_by_contractor";
  const needsMoreInfo = snag.status === "needs_more_info";
  const [responseNote, setResponseNote] = useState("");

  async function updateStatus(status: string, comment?: string) {
    const supabase = createSupabaseBrowserClient();
    await supabase.from("snags").update({ status, closed_at: status === "closed" ? new Date().toISOString() : null }).eq("id", snag.id);
    await supabase.from("snag_events").insert({ snag_id: snag.id, event_type: "status_change", old_value: snag.status, new_value: status, comment: comment ?? null, created_by_user_id: user.id });
    onNotice("");
    await reload();
  }

  if (!isContractorResolved && !needsMoreInfo) return null;

  return (
    <div className="grid gap-2">
      {isContractorResolved && (
        <div className="flex flex-wrap justify-end gap-2">
          <button className="secondary min-h-9 px-3 py-1.5 text-sm" onClick={() => updateStatus("closed")}>Close</button>
        </div>
      )}
      {needsMoreInfo && (
        <div className="grid gap-2 rounded-md border border-[#e2c8a6] bg-[#fff8ec] p-2">
          <input className="field" value={responseNote} onChange={(event) => setResponseNote(event.target.value)} placeholder="Information for contractor" />
          <button className="secondary min-h-9 justify-self-end px-3 py-1.5 text-sm" onClick={() => updateStatus("open", responseNote)} disabled={!responseNote.trim()}>Send info</button>
        </div>
      )}
    </div>
  );
}

function ContractorTradeControl({ user, snag, trade, trades, onNotice, reload }: { user: User; snag: ProductionSnag; trade?: Trade; trades: Trade[]; onNotice: (notice: string) => void; reload: () => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [tradeId, setTradeId] = useState(snag.trade_id ?? "");

  async function save(nextTradeId: string) {
    if ((snag.trade_id ?? "") === nextTradeId) {
      setEditing(false);
      return;
    }
    setTradeId(nextTradeId);
    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.from("snags").update({ trade_id: nextTradeId || null }).eq("id", snag.id);
    if (error) onNotice(error.message);
    else {
      const oldTrade = trades.find((item) => item.id === snag.trade_id)?.name ?? "No trade";
      const newTrade = trades.find((item) => item.id === nextTradeId)?.name ?? "No trade";
      await supabase.from("snag_events").insert({
        snag_id: snag.id,
        event_type: "trade_changed",
        old_value: oldTrade,
        new_value: newTrade,
        comment: `Trade changed from ${oldTrade} to ${newTrade}`,
        created_by_user_id: user.id,
      });
      setEditing(false);
      await reload();
    }
  }

  if (editing) {
    return (
      <select className="field min-w-36 py-1 text-sm" value={tradeId} onChange={(event) => save(event.target.value)} onBlur={() => setEditing(false)}>
        <option value="">No trade</option>
        {trades.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select>
    );
  }

  return (
    <button
      className={`text-left underline underline-offset-2 ${trade ? "text-sm text-[#34413a] hover:text-[#0F3D31]" : "text-xs text-[#9aa59f] hover:text-[#617169]"}`}
      onClick={() => setEditing(true)}
      title="Change trade"
    >
      {trade?.name ?? "No trade"}
    </button>
  );
}

function ContractorActions({ user, snag, onNotice, reload }: { user: User; snag: ProductionSnag; onNotice: (notice: string) => void; reload: () => Promise<void> }) {
  const [showInfoRequest, setShowInfoRequest] = useState(false);
  const [infoRequest, setInfoRequest] = useState("");

  async function save(status?: string, comment?: string) {
    const supabase = createSupabaseBrowserClient();
    await supabase.from("snags").update({ status: status ?? snag.status }).eq("id", snag.id);
    await supabase.from("snag_events").insert({ snag_id: snag.id, event_type: "status_change", old_value: snag.status, new_value: status ?? snag.status, comment: comment ?? null, created_by_user_id: user.id });
    onNotice("");
    await reload();
  }

  if (snag.status === "closed" || snag.status === "resolved_by_contractor" || snag.status === "needs_more_info") return null;

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap justify-end gap-2">
        <button className="secondary min-h-9 px-3 py-1.5 text-sm" onClick={() => setShowInfoRequest((current) => !current)}>Request info</button>
        <button className="primary min-h-9 px-3 py-1.5 text-sm" onClick={() => save("resolved_by_contractor")}>Mark as Resolved</button>
      </div>
      {showInfoRequest && (
        <div className="grid gap-2 rounded-md border border-[#e2c8a6] bg-[#fff8ec] p-2">
          <input className="field" value={infoRequest} onChange={(event) => setInfoRequest(event.target.value)} placeholder="What information is needed?" />
          <button className="secondary min-h-9 justify-self-end px-3 py-1.5 text-sm" onClick={() => save("needs_more_info", infoRequest)} disabled={!infoRequest.trim()}>Send request</button>
        </div>
      )}
    </div>
  );
}

function LeaseholderDefects({
  user,
  profile,
  buildings,
  units,
  areas,
  snags,
  photos,
  events,
  profiles,
  accessibleUnitIds,
  onNotice,
  reload,
  uploadFile,
}: {
  user: User;
  profile: Profile | null;
  buildings: Building[];
  units: Unit[];
  areas: Area[];
  snags: ProductionSnag[];
  photos: SnagPhoto[];
  events: SnagEvent[];
  profiles: Profile[];
  accessibleUnitIds: string[];
  onNotice: (notice: string) => void;
  reload: () => Promise<void>;
  uploadFile: (dataUrl: string, folder: string) => Promise<string>;
}) {
  const userUnits = profile?.role === "resident" ? units.filter((unit) => accessibleUnitIds.includes(unit.id)) : units;
  const [unitId, setUnitId] = useState(userUnits[0]?.id ?? "");
  const [areaId, setAreaId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [photo, setPhoto] = useState("");
  const selectedUnit = units.find((unit) => unit.id === unitId);

  async function createDefect() {
    if (!title || !photo || !selectedUnit) {
      onNotice("Resident defects need a title and photo.");
      return;
    }

    const supabase = createSupabaseBrowserClient();
    const photoUrl = await uploadFile(photo, "defects");
    const { data, error } = await supabase.from("snags").insert({
      building_id: selectedUnit.building_id,
      unit_id: selectedUnit.id,
      area_id: areaId || null,
      source_type: "leaseholder_defect",
      created_by: user.id,
      created_by_user_id: user.id,
      title,
      description,
      priority: null,
      priority_code: null,
      status: "submitted",
    }).select("id").single();

    if (error) {
      onNotice(error.message);
      return;
    }

    await supabase.from("snag_photos").insert({ snag_id: data.id, file_url: photoUrl, photo_type: "annotated", uploaded_by_user_id: user.id });
    await supabase.from("snag_events").insert({ snag_id: data.id, event_type: "submitted", new_value: "submitted", created_by_user_id: user.id });
    setTitle("");
    setDescription("");
    setPhoto("");
    await reload();
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[360px_minmax(0,1fr)]">
      <FormPanel title={userUnits.length > 1 ? "Log defect" : `Log defect ${userUnits[0]?.unit_number ?? ""}`}>
        <select className="field" value={unitId} onChange={(event) => setUnitId(event.target.value)}>
          {userUnits.map((unit) => <option key={unit.id} value={unit.id}>{unit.unit_number}</option>)}
        </select>
        <select className="field" value={areaId} onChange={(event) => setAreaId(event.target.value)}>
          <option value="">Room / area</option>
          {areas.filter((area) => area.unit_id === unitId).map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}
        </select>
        <input className="field" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={50} placeholder="Title" />
        <textarea className="field min-h-24 py-3" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Description" />
        <PhotoInput value={photo} onChange={setPhoto} />
        <button className="primary" onClick={createDefect}>Submit defect</button>
      </FormPanel>
      <SnagList
        title="Resident defects"
        buildings={buildings}
        snags={snags}
        units={units}
        areas={areas}
        trades={[]}
        photos={photos}
        events={events}
        profiles={profiles}
        user={user}
        onNotice={onNotice}
        reload={reload}
        uploadFile={uploadFile}
        actions={(snag) => <TriageActions user={user} snag={snag} buildings={buildings} organisations={[]} onNotice={onNotice} reload={reload} />}
      />
    </div>
  );
}

function TriageActions({ user, snag, buildings, organisations, onNotice, reload }: { user: User; snag: ProductionSnag; buildings: Building[]; organisations: Organisation[]; onNotice: (notice: string) => void; reload: () => Promise<void> }) {
  const [priority, setPriority] = useState<"P1" | "P2" | "P3">(snag.priority_code ?? "P2");
  const [comment, setComment] = useState("");
  const building = buildings.find((item) => item.id === snag.building_id);

  async function triage(status: string) {
    if ((status === "rejected" || status === "needs_more_info") && !comment) {
      onNotice("Please add a reason.");
      return;
    }

    const supabase = createSupabaseBrowserClient();
    await supabase.from("snags").update({
      status,
      priority_code: status === "accepted" ? priority : snag.priority_code,
      sla_due_date: status === "accepted" ? slaForPriority(priority, building?.defects_liability_end_date) : snag.sla_due_date,
    }).eq("id", snag.id);
    await supabase.from("snag_events").insert({ snag_id: snag.id, event_type: "triage", old_value: snag.status, new_value: status, comment, created_by_user_id: user.id });
    if (status === "accepted" && snag.priority_code !== priority) {
      await supabase.from("snag_events").insert({
        snag_id: snag.id,
        event_type: "priority_changed",
        old_value: snag.priority_code,
        new_value: priority,
        comment: `Priority changed from ${snag.priority_code ?? "None"} to ${priority}`,
        created_by_user_id: user.id,
      });
    }
    setComment("");
    await reload();
  }

  return (
    <div className="grid gap-2">
      <select className="field" value={priority} onChange={(event) => setPriority(event.target.value as "P1" | "P2" | "P3")}>
        <option value="P1">P1</option>
        <option value="P2">P2</option>
        <option value="P3">P3</option>
      </select>
      <input className="field" value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Reason / request for info" />
      <div className="grid grid-cols-3 gap-2">
        <button className="secondary" onClick={() => triage("needs_more_info")}>More info</button>
        <button className="secondary" onClick={() => triage("rejected")}>Reject</button>
        <button className="secondary" onClick={() => triage("accepted")}>Accept</button>
      </div>
      {organisations.length > 0 && <p className="text-xs text-[#617169]">Contractor assignment is available in the developer snag list.</p>}
    </div>
  );
}

function HandoverAndMeters({
  user,
  buildings,
  units,
  handovers,
  meterReadings,
  onNotice,
  reload,
}: {
  user: User;
  buildings: Building[];
  units: Unit[];
  handovers: Handover[];
  meterReadings: MeterReading[];
  onNotice: (notice: string) => void;
  reload: () => Promise<void>;
}) {
  const completedUnits = units.filter((unit) => unit.sale_status === "completed");
  const [unitId, setUnitId] = useState(completedUnits[0]?.id ?? "");
  const [recipient, setRecipient] = useState("");
  const [keys, setKeys] = useState(2);
  const [meterType, setMeterType] = useState<"electricity" | "water" | "heat">("electricity");
  const [reading, setReading] = useState("");
  const selectedUnit = units.find((unit) => unit.id === unitId);

  async function createHandover() {
    if (!selectedUnit || !recipient) return;
    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.from("handovers").insert({
      unit_id: selectedUnit.id,
      handover_by_user_id: user.id,
      recipient_name: recipient,
      number_of_keys: keys,
      recipient_capacity: "resident",
    });
    if (error) onNotice(error.message);
    else {
      setRecipient("");
      await reload();
    }
  }

  async function createMeter() {
    if (!selectedUnit || !reading) return;
    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.from("meter_readings").insert({
      building_id: selectedUnit.building_id,
      unit_id: selectedUnit.id,
      meter_type: meterType,
      reading_value: reading,
      created_by_user_id: user.id,
    });
    if (error) onNotice(error.message);
    else {
      setReading("");
      await reload();
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <FormPanel title="Handover">
        <select className="field" value={unitId} onChange={(event) => setUnitId(event.target.value)}>
          {completedUnits.map((unit) => <option key={unit.id} value={unit.id}>{unit.unit_number}</option>)}
        </select>
        <input className="field" value={recipient} onChange={(event) => setRecipient(event.target.value)} placeholder="Recipient name" />
        <input className="field" value={keys} onChange={(event) => setKeys(Number(event.target.value))} type="number" />
        <button className="primary" onClick={createHandover} disabled={!unitId || !recipient}>Complete handover</button>
      </FormPanel>
      <FormPanel title="Meter reading">
        <select className="field" value={unitId} onChange={(event) => setUnitId(event.target.value)}>
          {units.map((unit) => <option key={unit.id} value={unit.id}>{unit.unit_number}</option>)}
        </select>
        <select className="field" value={meterType} onChange={(event) => setMeterType(event.target.value as "electricity" | "water" | "heat")}>
          <option value="electricity">Electricity</option>
          <option value="water">Water</option>
          <option value="heat">Heat</option>
        </select>
        <input className="field" value={reading} onChange={(event) => setReading(event.target.value)} placeholder="Reading value" />
        <button className="primary" onClick={createMeter}>Add meter reading</button>
      </FormPanel>
      <section className="rounded-md border border-[#d9ded6] bg-white p-4 lg:col-span-2">
        <h2 className="text-lg font-semibold">Records</h2>
        <p className="mt-2 text-sm text-[#617169]">{handovers.length} handovers, {meterReadings.length} meter readings across {buildings.length} buildings.</p>
      </section>
    </div>
  );
}

function AuditPanel({ auditEvents, profiles }: { auditEvents: AuditEvent[]; profiles: Profile[] }) {
  const [entityFilter, setEntityFilter] = useState("");
  const [eventFilter, setEventFilter] = useState("");
  const entityTypes = Array.from(new Set(auditEvents.map((event) => event.entity_type))).sort();
  const eventTypes = Array.from(new Set(auditEvents.map((event) => event.event_type))).sort();
  const filtered = auditEvents
    .filter((event) => !entityFilter || event.entity_type === entityFilter)
    .filter((event) => !eventFilter || event.event_type === eventFilter)
    .slice(0, 100);

  function authorName(userId?: string | null) {
    if (!userId) return "System";
    const profile = profiles.find((item) => item.id === userId);
    return profile?.full_name || profile?.name || profile?.email || "Unknown user";
  }

  return (
    <section className="rounded-md border border-[#d9ded6] bg-white">
      <div className="border-b border-[#d9ded6] px-4 py-3">
        <h2 className="text-lg font-semibold">Audit trail</h2>
        <p className="text-sm text-[#617169]">Recent admin, setup and report events.</p>
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          <select className={`field ${entityFilter ? "filter-active" : ""}`} value={entityFilter} onChange={(event) => setEntityFilter(event.target.value)}>
            <option value="">All areas</option>
            {entityTypes.map((entityType) => <option key={entityType} value={entityType}>{entityLabel(entityType)}</option>)}
          </select>
          <select className={`field ${eventFilter ? "filter-active" : ""}`} value={eventFilter} onChange={(event) => setEventFilter(event.target.value)}>
            <option value="">All events</option>
            {eventTypes.map((eventType) => <option key={eventType} value={eventType}>{eventLabel(eventType)}</option>)}
          </select>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-[920px] w-full border-separate border-spacing-0 text-sm">
          <thead>
            <tr className="text-left text-xs font-semibold uppercase text-[#617169]">
              <th className="border-b border-[#d9ded6] px-3 py-2">Date</th>
              <th className="border-b border-[#d9ded6] px-3 py-2">Event</th>
              <th className="border-b border-[#d9ded6] px-3 py-2">Area</th>
              <th className="border-b border-[#d9ded6] px-3 py-2">Summary</th>
              <th className="border-b border-[#d9ded6] px-3 py-2">User</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((event) => (
              <tr key={event.id}>
                <td className="border-b border-[#e5e9e4] px-3 py-3 align-middle whitespace-nowrap">{formatDateTime(event.created_at)}</td>
                <td className="border-b border-[#e5e9e4] px-3 py-3 align-middle">{eventLabel(event.event_type)}</td>
                <td className="border-b border-[#e5e9e4] px-3 py-3 align-middle">{entityLabel(event.entity_type)}</td>
                <td className="border-b border-[#e5e9e4] px-3 py-3 align-middle">{event.summary}</td>
                <td className="border-b border-[#e5e9e4] px-3 py-3 align-middle">{authorName(event.created_by_user_id)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && <p className="p-4 text-sm text-[#617169]">No audit events to show.</p>}
      </div>
    </section>
  );
}

function ReportsPanel({
  buildings,
  units,
  areas,
  trades,
  snags,
  photos,
  recordAudit,
}: {
  buildings: Building[];
  units: Unit[];
  areas: Area[];
  trades: Trade[];
  snags: ProductionSnag[];
  photos: SnagPhoto[];
  recordAudit: (event: Omit<AuditEvent, "id" | "created_at" | "created_by_user_id">) => Promise<void>;
}) {
  const [buildingId, setBuildingId] = useState(buildings[0]?.id ?? "");
  const buildingUnits = units.filter((unit) => !buildingId || unit.building_id === buildingId);
  const [unitId, setUnitId] = useState(buildingUnits[0]?.id ?? "");
  const reportSnags = snags.filter((snag) => snag.unit_id === unitId);
  const unit = units.find((item) => item.id === unitId);
  const building = buildings.find((item) => item.id === buildingId);

  useEffect(() => {
    if (!buildingUnits.some((unit) => unit.id === unitId)) {
      setUnitId(buildingUnits[0]?.id ?? "");
    }
  }, [buildingId, buildingUnits, unitId]);

  async function download() {
    const pdf = new jsPDF({ unit: "pt", format: "a4" });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 42;
    const green = brand.green;
    const gold = brand.gold;
    const logoData = await imageUrlToDataUrl("/bunnywell-report-logo.png");
    let y = 120;

    function imageFormat(dataUrl: string) {
      return dataUrl.startsWith("data:image/png") ? "PNG" : "JPEG";
    }

    function addFittedImage(dataUrl: string, x: number, imageY: number, maxWidth: number, maxHeight: number) {
      const props = pdf.getImageProperties(dataUrl);
      const ratio = props.width / props.height;
      let width = maxWidth;
      let height = width / ratio;
      if (height > maxHeight) {
        height = maxHeight;
        width = height * ratio;
      }
      pdf.addImage(dataUrl, imageFormat(dataUrl), x, imageY, width, height);
      return { width, height };
    }

    function fittedImageSize(dataUrl: string, maxWidth: number, maxHeight: number) {
      const props = pdf.getImageProperties(dataUrl);
      const ratio = props.width / props.height;
      let width = maxWidth;
      let height = width / ratio;
      if (height > maxHeight) {
        height = maxHeight;
        width = height * ratio;
      }
      return { width, height };
    }

    function addLogo(x: number, logoY: number, width: number) {
      const props = pdf.getImageProperties(logoData);
      const height = width / (props.width / props.height);
      pdf.addImage(logoData, "PNG", x, logoY, width, height);
      return height;
    }

    function addPageHeader() {
      addLogo(margin, 18, 72);
      pdf.setDrawColor(gold);
      pdf.setLineWidth(1.4);
      pdf.line(margin, 86, pageWidth - margin, 86);
      pdf.setTextColor(green);
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(10);
      pdf.text("SNAGGING REPORT", pageWidth - margin, 47, { align: "right" });
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(9);
      pdf.text(`${building?.name ?? ""} / Unit ${unit?.unit_number ?? ""}`, pageWidth - margin, 63, { align: "right" });
      pdf.setTextColor(24, 32, 28);
    }

    function addFooter() {
      const pages = pdf.getNumberOfPages();
      for (let page = 1; page <= pages; page += 1) {
        pdf.setPage(page);
        pdf.setDrawColor(216, 222, 216);
        pdf.setLineWidth(0.6);
        pdf.line(margin, pageHeight - 36, pageWidth - margin, pageHeight - 36);
        pdf.setTextColor(97, 113, 105);
        pdf.setFontSize(8);
        pdf.text("Bunnywell Homes", margin, pageHeight - 20);
        pdf.text(`Page ${page} of ${pages}`, pageWidth - margin, pageHeight - 20, { align: "right" });
      }
    }

    addLogo((pageWidth - 250) / 2, 72, 250);
    pdf.setDrawColor(gold);
    pdf.setLineWidth(1.5);
    pdf.line(margin, 330, pageWidth - margin, 330);
    pdf.setTextColor(green);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(22);
    pdf.text("SNAGGING REPORT", pageWidth / 2, 382, { align: "center" });
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(14);
    pdf.text(`${building?.name ?? ""}`, pageWidth / 2, 411, { align: "center" });
    pdf.setFontSize(12);
    pdf.setTextColor(97, 113, 105);
    pdf.text(`Unit ${unit?.unit_number ?? ""}`, pageWidth / 2, 435, { align: "center" });

    const summaryTop = 520;
    const summaryWidth = (pageWidth - margin * 2 - 18) / 2;
    const summaryItems = [
      ["Generated", formatDateTime(new Date().toISOString())],
      ["Total snags", String(reportSnags.length)],
      ["Open", String(reportSnags.filter((snag) => snag.status === "open" || snag.status === "rejected_back_to_contractor").length)],
      ["Closed", String(reportSnags.filter((snag) => snag.status === "closed").length)],
    ];
    summaryItems.forEach(([label, value], index) => {
      const x = margin + (index % 2) * (summaryWidth + 18);
      const itemY = summaryTop + Math.floor(index / 2) * 70;
      pdf.setDrawColor(216, 222, 216);
      pdf.setFillColor(248, 250, 247);
      pdf.roundedRect(x, itemY, summaryWidth, 48, 4, 4, "FD");
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(8);
      pdf.setTextColor(green);
      pdf.text(label.toUpperCase(), x + 14, itemY + 17);
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(12);
      pdf.setTextColor(24, 32, 28);
      pdf.text(value, x + 14, itemY + 35);
    });

    const sorted = [...reportSnags].sort((a, b) => {
      const tradeA = trades.find((trade) => trade.id === a.trade_id)?.name ?? "";
      const tradeB = trades.find((trade) => trade.id === b.trade_id)?.name ?? "";
      const areaA = areas.find((area) => area.id === a.area_id)?.name ?? "";
      const areaB = areas.find((area) => area.id === b.area_id)?.name ?? "";
      return `${tradeA}-${areaA}`.localeCompare(`${tradeB}-${areaB}`);
    });

    pdf.addPage();
    addPageHeader();
    y = 102;

    for (const [index, snag] of sorted.entries()) {
      const description = snag.description?.trim() || "No description";
      const descriptionLines = pdf.splitTextToSize(description, 290).slice(0, 3);
      const textHeight = 72 + descriptionLines.length * 11;
      const photo = photos.find((item) => item.snag_id === snag.id && item.file_url);
      let imageData = "";
      let imageSize = { width: 0, height: 0 };
      if (photo) {
        try {
          imageData = await imageUrlToDataUrl(photo.file_url);
          imageSize = fittedImageSize(imageData, 146, 108);
        } catch {
          imageData = "";
        }
      }
      const imageHeight = imageData ? imageSize.height + 36 : 0;
      const cardHeight = Math.max(128, textHeight, imageHeight);
      if (y + cardHeight > pageHeight - 60) {
        pdf.addPage();
        addPageHeader();
        y = 102;
      }
      const trade = trades.find((item) => item.id === snag.trade_id)?.name ?? "No trade";
      const area = areas.find((item) => item.id === snag.area_id)?.name ?? "No area";

      pdf.setDrawColor(216, 222, 216);
      pdf.setFillColor(255, 255, 255);
      pdf.roundedRect(margin, y, pageWidth - margin * 2, cardHeight - 8, 5, 5, "FD");

      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(10);
      pdf.setTextColor(green);
      pdf.text(`${index + 1}. ${snag.title}`, margin + 12, y + 20, { maxWidth: 310 });

      const badgeText = statusLabel(snag.status);
      pdf.setFillColor(239, 246, 241);
      pdf.setDrawColor(212, 166, 69);
      pdf.setFontSize(8);
      const badgeWidth = Math.min(150, Math.max(92, pdf.getTextWidth(badgeText) + 28));
      const badgeX = margin + 12;
      pdf.roundedRect(badgeX, y + 34, badgeWidth, 18, 4, 4, "FD");
      pdf.setTextColor(green);
      pdf.text(badgeText, badgeX + badgeWidth / 2, y + 46, { align: "center" });

      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(8);
      pdf.setTextColor(97, 113, 105);
      pdf.text(`Area: ${area}`, margin + 12, y + 66);
      pdf.text(`Trade: ${trade}`, margin + 12, y + 80);
      pdf.text(`Created: ${formatDate(snag.created_at)}`, margin + 12, y + 94);

      pdf.setTextColor(24, 32, 28);
      pdf.text(descriptionLines, margin + 12, y + 114);

      if (imageData) {
        const imageX = pageWidth - margin - 18 - imageSize.width;
        pdf.addImage(imageData, imageFormat(imageData), imageX, y + 18, imageSize.width, imageSize.height);
      } else if (photo) {
        pdf.setTextColor(97, 113, 105);
        pdf.text("Photo could not be added.", pageWidth - margin - 168, y + 72);
      } else {
        pdf.setTextColor(151, 163, 156);
        pdf.text("No photo", pageWidth - margin - 95, y + 72, { align: "center" });
      }

      y += cardHeight;
    }

    addFooter();
    pdf.save(`unit-${unit?.unit_number ?? "snags"}-report.pdf`);
    await recordAudit({
      event_type: "report_generated",
      entity_type: "unit",
      entity_id: unit?.id ?? null,
      summary: `Snagging report generated: ${building?.name ?? "Building"} / Unit ${unit?.unit_number ?? ""}`,
      metadata: {
        buildingId,
        buildingName: building?.name,
        unitId,
        unitNumber: unit?.unit_number,
        snagCount: reportSnags.length,
      },
    });
  }

  return (
    <FormPanel title="PDF snag report">
      <select className="field" value={buildingId} onChange={(event) => setBuildingId(event.target.value)}>
        {buildings.map((building) => <option key={building.id} value={building.id}>{building.name}</option>)}
      </select>
      <select className="field" value={unitId} onChange={(event) => setUnitId(event.target.value)}>
        {buildingUnits.map((unit) => <option key={unit.id} value={unit.id}>{unit.unit_number}</option>)}
      </select>
      <p className="text-sm text-[#617169]">{reportSnags.length} developer snag{reportSnags.length === 1 ? "" : "s"} will be included.</p>
      <button className="primary" onClick={download} disabled={reportSnags.length === 0}><Download size={16} /> Download PDF</button>
    </FormPanel>
  );
}

function SnagList({
  title,
  buildings,
  snags,
  units,
  areas,
  trades,
  photos,
  events,
  profiles,
  user,
  onNotice,
  reload,
  uploadFile,
  actions,
  canReject = false,
  tradeControl,
  showFilters = false,
}: {
  title: string;
  buildings: Building[];
  snags: ProductionSnag[];
  units: Unit[];
  areas: Area[];
  trades: Trade[];
  photos: SnagPhoto[];
  events: SnagEvent[];
  profiles: Profile[];
  user: User;
  onNotice: (notice: string) => void;
  reload: () => Promise<void>;
  uploadFile: (dataUrl: string, folder: string) => Promise<string>;
  actions?: (snag: ProductionSnag) => React.ReactNode;
  canReject?: boolean;
  tradeControl?: (snag: ProductionSnag, trade?: Trade) => React.ReactNode;
  showFilters?: boolean;
}) {
  const [buildingFilter, setBuildingFilter] = useState("");
  const [unitFilter, setUnitFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [tradeFilter, setTradeFilter] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [previewPhoto, setPreviewPhoto] = useState<SnagPhoto | null>(null);
  const [selectedSnagId, setSelectedSnagId] = useState("");
  const availableBuildingIds = Array.from(new Set(snags.map((snag) => snag.building_id).filter(Boolean))) as string[];
  const availableBuildings = buildings.filter((building) => availableBuildingIds.includes(building.id));
  const selectedBuildingId = buildingFilter || availableBuildings[0]?.id || "";
  const buildingUnits = units.filter((unit) => unit.building_id === selectedBuildingId);
  const buildingSnags = snags.filter((snag) => snag.building_id === selectedBuildingId);
  const statuses = Array.from(new Set(buildingSnags.map((snag) => snag.status)))
    .filter((status) => status.toLowerCase() !== "pending")
    .sort();
  const filtered = snags
    .filter((snag) => snag.building_id === selectedBuildingId)
    .filter((snag) => !unitFilter || snag.unit_id === unitFilter)
    .filter((snag) => !statusFilter || snag.status === statusFilter)
    .filter((snag) => !tradeFilter || snag.trade_id === tradeFilter)
    .sort((a, b) => {
      const unitA = units.find((unit) => unit.id === a.unit_id)?.unit_number ?? "Communal";
      const unitB = units.find((unit) => unit.id === b.unit_id)?.unit_number ?? "Communal";
      const unitCompare = unitA.localeCompare(unitB, undefined, { numeric: true });
      if (unitCompare !== 0) return unitCompare;
      const areaA = areas.find((area) => area.id === a.area_id)?.name ?? "";
      const areaB = areas.find((area) => area.id === b.area_id)?.name ?? "";
      const areaCompare = areaA.localeCompare(areaB);
      if (areaCompare !== 0) return areaCompare;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageStart = filtered.length === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const pageEnd = Math.min(currentPage * pageSize, filtered.length);
  const pagedSnags = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const grouped = pagedSnags.reduce<Array<{ unitId: string; unitLabel: string; snags: ProductionSnag[] }>>((groups, snag) => {
    const unit = units.find((item) => item.id === snag.unit_id);
    const unitId = unit?.id ?? "communal";
    const unitLabel = unit ? `Unit ${unit.unit_number}` : "Communal";
    const group = groups.find((item) => item.unitId === unitId);
    if (group) group.snags.push(snag);
    else groups.push({ unitId, unitLabel, snags: [snag] });
    return groups;
  }, []);

  useEffect(() => {
    if (!selectedBuildingId || buildingFilter) return;
    setBuildingFilter(selectedBuildingId);
  }, [buildingFilter, selectedBuildingId]);

  useEffect(() => {
    setUnitFilter("");
  }, [selectedBuildingId]);

  useEffect(() => {
    setPage(1);
  }, [selectedBuildingId, unitFilter, statusFilter, tradeFilter, pageSize]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const PaginationControls = (
    <div className="flex flex-col gap-3 rounded-md border border-[#d9ded6] bg-white p-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm text-[#617169]">
        Showing <span className="font-semibold text-[#18201c]">{pageStart}-{pageEnd}</span> of <span className="font-semibold text-[#18201c]">{filtered.length}</span> snags
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-sm text-[#617169]">
          Page size
          <select className="field h-9 min-h-9 w-24" value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))}>
            {[25, 50, 100].map((size) => <option key={size} value={size}>{size}</option>)}
          </select>
        </label>
        <span className="text-sm text-[#617169]">Page {currentPage} of {totalPages}</span>
        <button className="secondary h-9 min-h-9 w-9 px-0 py-0 text-base font-semibold leading-none" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={currentPage <= 1} aria-label="Previous page" title="Previous page">{"<"}</button>
        <button className="secondary h-9 min-h-9 w-9 px-0 py-0 text-base font-semibold leading-none" onClick={() => setPage((current) => Math.min(totalPages, current + 1))} disabled={currentPage >= totalPages} aria-label="Next page" title="Next page">{">"}</button>
      </div>
    </div>
  );

  const selectedSnag = snags.find((snag) => snag.id === selectedSnagId);
  if (selectedSnag) {
    const selectedIndex = filtered.findIndex((snag) => snag.id === selectedSnag.id);
    const previousSnag = selectedIndex > 0 ? filtered[selectedIndex - 1] : null;
    const nextSnag = selectedIndex >= 0 && selectedIndex < filtered.length - 1 ? filtered[selectedIndex + 1] : null;

    return (
      <SnagDetailPage
        actions={actions?.(selectedSnag)}
        areas={areas}
        canReject={canReject}
        events={events.filter((event) => event.snag_id === selectedSnag.id)}
        onBack={() => setSelectedSnagId("")}
        onNext={nextSnag ? () => setSelectedSnagId(nextSnag.id) : undefined}
        onNotice={onNotice}
        onOpenPhoto={setPreviewPhoto}
        onPrevious={previousSnag ? () => setSelectedSnagId(previousSnag.id) : undefined}
        photos={photos.filter((photo) => photo.snag_id === selectedSnag.id && photo.file_url)}
        profiles={profiles}
        previewPhoto={previewPhoto}
        reload={reload}
        setPreviewPhoto={setPreviewPhoto}
        snag={selectedSnag}
        trade={trades.find((trade) => trade.id === selectedSnag.trade_id)}
        tradeControl={tradeControl?.(selectedSnag, trades.find((trade) => trade.id === selectedSnag.trade_id))}
        unit={units.find((unit) => unit.id === selectedSnag.unit_id)}
        uploadFile={uploadFile}
        user={user}
      />
    );
  }

  return (
    <section className="rounded-md border border-[#d9ded6] bg-white">
      <div className="border-b border-[#d9ded6] px-4 py-3">
        <h2 className="text-lg font-semibold">{title}</h2>
        {showFilters && (
          <div className="mt-3 grid gap-2 md:grid-cols-4">
            <select className="field" value={selectedBuildingId} onChange={(event) => setBuildingFilter(event.target.value)}>
              {availableBuildings.map((building) => <option key={building.id} value={building.id}>{building.name}</option>)}
            </select>
            <select className={`field ${unitFilter ? "filter-active" : ""}`} value={unitFilter} onChange={(event) => setUnitFilter(event.target.value)}>
              <option value="">All units</option>
              {buildingUnits.map((unit) => <option key={unit.id} value={unit.id}>{unit.unit_number}</option>)}
            </select>
            <select className={`field ${tradeFilter ? "filter-active" : ""}`} value={tradeFilter} onChange={(event) => setTradeFilter(event.target.value)}>
              <option value="">All trades</option>
              {trades.map((trade) => <option key={trade.id} value={trade.id}>{trade.name}</option>)}
            </select>
            <select className={`field ${statusFilter ? "filter-active" : ""}`} value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="">All statuses</option>
              {statuses.map((status) => <option key={status} value={status}>{statusLabel(status)}</option>)}
            </select>
          </div>
        )}
      </div>
      <div className="overflow-x-auto bg-[#f1f4ef] p-3">
        {filtered.length > 0 && <div className="mb-3">{PaginationControls}</div>}
        <table className="min-w-[980px] w-full border-separate border-spacing-0 text-sm">
          <thead>
            <tr className="text-left text-xs font-semibold uppercase text-[#617169]">
              <th className="border-b border-[#d9ded6] bg-white px-3 py-2">Title</th>
              <th className="border-b border-[#d9ded6] bg-white px-3 py-2">Unit</th>
              <th className="border-b border-[#d9ded6] bg-white px-3 py-2">Area</th>
              <th className="border-b border-[#d9ded6] bg-white px-3 py-2">Trade</th>
              <th className="border-b border-[#d9ded6] bg-white px-3 py-2">Status</th>
              <th className="border-b border-[#d9ded6] bg-white px-3 py-2">Date</th>
              <th className="border-b border-[#d9ded6] bg-white px-3 py-2">Photo</th>
              <th className="border-b border-[#d9ded6] bg-white px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {grouped.map((group) => (
              <Fragment key={group.unitId}>
                <tr>
                  <td colSpan={8} className="border-b border-[#d9ded6] bg-[#f8faf7] px-3 py-2 text-sm font-semibold">
                    {group.unitLabel} <span className="font-normal text-[#617169]">({group.snags.length})</span>
                  </td>
                </tr>
                {group.snags.map((snag) => {
                  const unit = units.find((item) => item.id === snag.unit_id);
                  const area = areas.find((item) => item.id === snag.area_id);
                  const trade = trades.find((item) => item.id === snag.trade_id);
                  const snagPhotos = photos.filter((item) => item.snag_id === snag.id && item.file_url);
                  const photo = snagPhotos[0];
                  const rowActions = actions?.(snag);

                  return (
                    <tr key={snag.id} className="align-middle">
                      <td className="border-b border-[#e5e9e4] bg-white px-3 py-2 align-middle">
                        <p className="max-w-xs truncate font-medium">{snag.title}</p>
                        {snag.description && <p className="mt-0.5 max-w-xs truncate text-xs text-[#617169]">{snag.description}</p>}
                      </td>
                      <td className="border-b border-[#e5e9e4] bg-white px-3 py-2 align-middle">{unit?.unit_number ?? "Communal"}</td>
                      <td className="border-b border-[#e5e9e4] bg-white px-3 py-2 align-middle">{area?.name ?? "No area"}</td>
                      <td className="border-b border-[#e5e9e4] bg-white px-3 py-2 align-middle">{tradeControl ? tradeControl(snag, trade) : trade?.name ?? "No trade"}</td>
                      <td className="border-b border-[#e5e9e4] bg-white px-3 py-2 align-middle">
                        <span className={`rounded-md px-2 py-1 text-xs font-semibold ${statusTone(snag.status)}`}>{statusLabel(snag.status)}</span>
                      </td>
                      <td className="border-b border-[#e5e9e4] bg-white px-3 py-2 align-middle whitespace-nowrap">{formatDate(snag.created_at)}</td>
                      <td className="border-b border-[#e5e9e4] bg-white px-3 py-2 align-middle">
                        {photo?.file_url ? (
                          <PhotoThumb photo={photo} onOpen={setPreviewPhoto} />
                        ) : (
                          <span className="text-xs text-[#9aa59f]">None</span>
                        )}
                      </td>
                      <td className="border-b border-[#e5e9e4] bg-white px-3 py-2 align-middle">
                        <div className="flex min-w-44 flex-wrap justify-end gap-2">
                          {rowActions}
                          <button className="secondary min-h-8 px-2 py-1 text-xs" onClick={() => setSelectedSnagId(snag.id)}>Details</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </Fragment>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && <p className="rounded-md bg-white p-4 text-sm text-[#617169]">No records to show.</p>}
        {filtered.length > pageSize && <div className="mt-3">{PaginationControls}</div>}
      </div>
      {previewPhoto && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4" onClick={() => setPreviewPhoto(null)}>
          <div className="max-h-[90vh] max-w-5xl rounded-md bg-white p-3 shadow-xl" onClick={(event) => event.stopPropagation()}>
            <img src={previewPhoto.file_url} alt="" className="max-h-[78vh] w-auto rounded-md object-contain" />
            <div className="mt-3 flex justify-end">
              <button className="secondary" onClick={() => setPreviewPhoto(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function PhotoThumb({ photo, onOpen }: { photo: SnagPhoto; onOpen: (photo: SnagPhoto) => void }) {
  const [failed, setFailed] = useState(false);

  if (failed || !photo.file_url) {
    return <span className="text-xs text-[#9aa59f]">None</span>;
  }

  return (
    <button className="cursor-pointer" onClick={() => onOpen(photo)} title="View photo">
      <img
        src={photo.file_url}
        alt=""
        className="h-10 w-14 cursor-pointer rounded border border-[#d9ded6] object-cover transition hover:opacity-80"
        onError={() => setFailed(true)}
      />
    </button>
  );
}

function SnagDetailPage({
  actions,
  areas,
  canReject,
  events,
  onBack,
  onNext,
  onNotice,
  onOpenPhoto,
  onPrevious,
  photos,
  profiles,
  previewPhoto,
  reload,
  setPreviewPhoto,
  snag,
  trade,
  tradeControl,
  unit,
  uploadFile,
  user,
}: {
  actions?: React.ReactNode;
  areas: Area[];
  canReject: boolean;
  events: SnagEvent[];
  onBack: () => void;
  onNext?: () => void;
  onNotice: (notice: string) => void;
  onPrevious?: () => void;
  photos: SnagPhoto[];
  profiles: Profile[];
  onOpenPhoto: (photo: SnagPhoto) => void;
  previewPhoto: SnagPhoto | null;
  reload: () => Promise<void>;
  setPreviewPhoto: (photo: SnagPhoto | null) => void;
  snag: ProductionSnag;
  trade?: Trade;
  tradeControl?: React.ReactNode;
  unit?: Unit;
  uploadFile: (dataUrl: string, folder: string) => Promise<string>;
  user: User;
}) {
  const [note, setNote] = useState("");
  const [photo, setPhoto] = useState("");
  const [rejectNote, setRejectNote] = useState("");
  const [rejectPhoto, setRejectPhoto] = useState("");
  const [showReject, setShowReject] = useState(false);
  const [showPhotoInput, setShowPhotoInput] = useState(false);
  const primaryPhoto = photos[0];
  const area = areas.find((item) => item.id === snag.area_id);

  function authorName(userId?: string | null) {
    if (!userId) return "System";
    const profile = profiles.find((item) => item.id === userId);
    return profile?.full_name || profile?.name || profile?.email || "Unknown user";
  }

  async function addNote() {
    if (!note.trim()) return;
    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.from("snag_events").insert({
      snag_id: snag.id,
      event_type: "note",
      new_value: snag.status,
      comment: note,
      created_by_user_id: user.id,
    });
    if (error) onNotice(error.message);
    else {
      setNote("");
      await reload();
    }
  }

  async function addPhoto() {
    if (!photo) return;
    const photoUrl = await uploadFile(photo, "snag-updates");
    const supabase = createSupabaseBrowserClient();
    const { error: photoError } = await supabase.from("snag_photos").insert({
      snag_id: snag.id,
      file_url: photoUrl,
      photo_type: "resolution_photo",
      uploaded_by_user_id: user.id,
    });
    const { error: eventError } = await supabase.from("snag_events").insert({
      snag_id: snag.id,
      event_type: "photo_added",
      new_value: snag.status,
      comment: "Photo added",
      created_by_user_id: user.id,
    });
    if (photoError || eventError) onNotice(photoError?.message ?? eventError?.message ?? "Could not add photo.");
    else {
      setPhoto("");
      setShowPhotoInput(false);
      await reload();
    }
  }

  async function rejectBack() {
    if (!rejectNote.trim()) {
      return;
    }
    const supabase = createSupabaseBrowserClient();
    const { error: statusError } = await supabase.from("snags").update({ status: "rejected_back_to_contractor" }).eq("id", snag.id);
    let photoErrorMessage = "";
    if (rejectPhoto) {
      const photoUrl = await uploadFile(rejectPhoto, "rejections");
      const { error: photoError } = await supabase.from("snag_photos").insert({ snag_id: snag.id, file_url: photoUrl, photo_type: "annotated", uploaded_by_user_id: user.id });
      photoErrorMessage = photoError?.message ?? "";
    }
    const { error: eventError } = await supabase.from("snag_events").insert({
      snag_id: snag.id,
      event_type: "status_change",
      old_value: snag.status,
      new_value: "rejected_back_to_contractor",
      comment: rejectNote,
      created_by_user_id: user.id,
    });
    if (statusError || eventError || photoErrorMessage) onNotice(statusError?.message ?? eventError?.message ?? photoErrorMessage);
    else {
      setRejectNote("");
      setRejectPhoto("");
      setShowReject(false);
      await reload();
    }
  }

  return (
    <section className="rounded-md border border-[#d9ded6] bg-white">
      <div className="border-b border-[#d9ded6] px-4 py-3">
        <div className="flex w-full items-center gap-3">
            <button className="secondary min-h-9 px-3 py-1.5 text-sm" onClick={onBack}>Back</button>
          <span className={`ml-auto rounded-md px-2 py-1 text-xs font-semibold ${statusTone(snag.status)}`}>{statusLabel(snag.status)}</span>
          <div className="flex shrink-0 gap-2">
              <button className="secondary h-9 min-h-9 w-9 px-0 py-0 text-base font-semibold leading-none" onClick={onPrevious} disabled={!onPrevious} aria-label="Previous snag" title="Previous snag">
                {"<"}
              </button>
              <button className="secondary h-9 min-h-9 w-9 px-0 py-0 text-base font-semibold leading-none" onClick={onNext} disabled={!onNext} aria-label="Next snag" title="Next snag">
                {">"}
              </button>
            </div>
        </div>
        <h2 className="mt-3 text-xl font-semibold">{snag.title}</h2>
        <p className="text-sm text-[#617169]">{unit?.unit_number ?? "Communal"} / {area?.name ?? "No area"}</p>
      </div>
      <div className="grid gap-5 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(460px,1.1fr)]">
        <div className="grid gap-4">
          <div className="rounded-md border border-[#d9ded6] bg-[#f8faf7] p-3">
            {primaryPhoto ? (
              <button className="block w-full cursor-pointer" onClick={() => onOpenPhoto(primaryPhoto)}>
                <img src={primaryPhoto.file_url} alt="" className="max-h-[520px] w-full cursor-pointer rounded-md object-contain" />
              </button>
            ) : (
              <div className="grid min-h-56 place-items-center rounded-md border border-dashed border-[#cbd4ce] bg-white text-sm text-[#9aa59f]">No photo</div>
            )}
          </div>
          <div className="grid gap-3 rounded-md border border-[#d9ded6] p-3 text-sm sm:grid-cols-2">
            <DetailField label="Unit" value={unit?.unit_number ?? "Communal"} />
            <DetailField label="Area" value={area?.name ?? "No area"} />
            <div>
              <p className="text-xs font-semibold uppercase text-[#617169]">Trade</p>
              <div className="mt-1">{tradeControl ?? trade?.name ?? <span className="text-xs text-[#9aa59f]">No trade</span>}</div>
            </div>
            <DetailField label="Created" value={formatDateTime(snag.created_at)} />
            <div className="sm:col-span-2">
              <p className="text-xs font-semibold uppercase text-[#617169]">Description</p>
              <p className="mt-1 text-[#34413a]">{snag.description || "No description"}</p>
            </div>
          </div>
          {(actions || (canReject && snag.status === "resolved_by_contractor")) && (
            <div className="rounded-md border border-[#d9ded6] p-3">
              <div className="flex flex-wrap items-center gap-2">
                {actions}
                {canReject && snag.status === "resolved_by_contractor" && (
                  <button className="secondary min-h-9 px-3 py-1.5 text-sm" onClick={() => setShowReject((current) => !current)}>Reject back to contractor</button>
                )}
              </div>
              {canReject && showReject && (
                <div className="mt-3 grid gap-2 rounded-md border border-[#e2c8a6] bg-[#fff8ec] p-2">
                  <input className="field" value={rejectNote} onChange={(event) => setRejectNote(event.target.value)} placeholder="Reason for rejection" />
                  <PhotoInput value={rejectPhoto} onChange={setRejectPhoto} />
                  <button className="secondary min-h-9 justify-self-end px-3 py-1.5 text-sm" onClick={rejectBack} disabled={!rejectNote.trim()}>Reject</button>
                </div>
              )}
            </div>
          )}
          <div className="rounded-md border border-[#d9ded6] p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold">Photos</p>
              <button className="secondary min-h-9 px-3 py-1.5 text-sm" onClick={() => setShowPhotoInput((current) => !current)}>Add photo</button>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {photos.length > 0 ? photos.map((photo) => <PhotoThumb key={photo.id} photo={photo} onOpen={onOpenPhoto} />) : <span className="text-sm text-[#9aa59f]">None</span>}
            </div>
            {showPhotoInput && (
              <div className="mt-3 grid gap-2 border-t border-[#e5e9e4] pt-3">
                <PhotoInput value={photo} onChange={setPhoto} />
                <button className="secondary min-h-9 justify-self-end px-3 py-1.5 text-sm" onClick={addPhoto} disabled={!photo}>Save photo</button>
              </div>
            )}
          </div>
        </div>
        <aside className="rounded-md border border-[#d9ded6] bg-[#f8faf7] p-4">
          <h3 className="font-semibold">Comments and audit trail</h3>
          <div className="mt-3 grid gap-3">
            {events.map((event) => (
              <div key={event.id} className="rounded-md border border-[#d9ded6] bg-white p-3 text-sm">
                <p className="font-semibold">{eventLabel(event.event_type)} <span className="font-normal text-[#617169]">{formatDateTime(event.created_at)} / {authorName(event.created_by_user_id)}</span></p>
                {event.comment && <p className="mt-2 text-[#34413a]">{event.comment}</p>}
                {event.new_value && <p className="mt-2 text-xs text-[#617169]">{statusLabel(event.new_value)}</p>}
              </div>
            ))}
            {events.length === 0 && <p className="text-sm text-[#617169]">No comments or audit entries yet.</p>}
          </div>
          <div className="mt-4 grid gap-2 rounded-md border border-[#d9ded6] bg-white p-3">
            <p className="text-sm font-semibold">Add note</p>
            <input
              className="field py-2 text-sm"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && note.trim()) void addNote();
              }}
              placeholder="Type a note and press Enter"
            />
            <div className="flex flex-wrap justify-end gap-2">
              <button className="secondary min-h-9 px-3 py-1.5 text-sm" onClick={addNote} disabled={!note.trim()}>Save note</button>
            </div>
          </div>
        </aside>
      </div>
      {previewPhoto && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4" onClick={() => setPreviewPhoto(null)}>
          <div className="max-h-[90vh] max-w-5xl rounded-md bg-white p-3 shadow-xl" onClick={(event) => event.stopPropagation()}>
            <img src={previewPhoto.file_url} alt="" className="max-h-[78vh] w-auto rounded-md object-contain" />
            <div className="mt-3 flex justify-end">
              <button className="secondary" onClick={() => setPreviewPhoto(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function DetailField({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase text-[#617169]">{label}</p>
      <p className="mt-1 text-[#34413a]">{value}</p>
    </div>
  );
}

function FormPanel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-md border border-[#d9ded6] bg-white p-4">
      <h2 className="text-lg font-semibold">{title}</h2>
      <div className="mt-4 grid gap-3">{children}</div>
    </section>
  );
}

function PhotoInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [baseImage, setBaseImage] = useState("");
  const [strokes, setStrokes] = useState<{ x: number; y: number }[][]>([]);
  const [drawing, setDrawing] = useState(false);

  useEffect(() => {
    if (!baseImage) return;

    const image = new Image();
    image.onload = () => {
      imageRef.current = image;
      redraw(strokes, image);
    };
    image.src = baseImage;
  }, [baseImage]);

  useEffect(() => {
    redraw(strokes);
  }, [strokes]);

  function point(event: PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();

    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height,
    };
  }

  function redraw(nextStrokes = strokes, image = imageRef.current) {
    const canvas = canvasRef.current;
    if (!canvas || !image) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    canvas.width = 720;
    canvas.height = Math.max(360, Math.round((image.height / image.width) * canvas.width));
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    context.strokeStyle = "#d33f2f";
    context.lineWidth = 8;
    context.lineCap = "round";
    context.lineJoin = "round";

    for (const stroke of nextStrokes) {
      context.beginPath();
      stroke.forEach((item, index) => {
        if (index === 0) context.moveTo(item.x, item.y);
        else context.lineTo(item.x, item.y);
      });
      context.stroke();
    }

    onChange(canvas.toDataURL("image/jpeg", 0.82));
  }

  function loadFile(file?: File) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setStrokes([]);
      setBaseImage(String(reader.result));
      onChange(String(reader.result));
    };
    reader.readAsDataURL(file);
  }

  return (
    <div className="grid gap-2">
      <label className="inline-flex h-11 cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-[#9dafaa] bg-[#f6f7f4] px-4 text-sm font-medium">
        Add or take photo
        <input
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          onChange={(event) => {
            loadFile(event.target.files?.[0]);
          }}
        />
      </label>
      {value && (
        <div className="grid gap-2">
          <canvas
            ref={canvasRef}
            className="aspect-video w-full rounded-md border border-[#d9ded6] bg-[#eef1ec]"
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              setDrawing(true);
              setStrokes((current) => [...current, [point(event)]]);
            }}
            onPointerMove={(event) => {
              if (!drawing) return;
              setStrokes((current) => {
                const next = [...current];
                const latest = next[next.length - 1] ?? [];
                next[next.length - 1] = [...latest, point(event)];
                return next;
              });
            }}
            onPointerUp={() => setDrawing(false)}
            onPointerCancel={() => setDrawing(false)}
          />
          <div className="grid grid-cols-3 gap-2">
            <button className="secondary" onClick={() => setStrokes((current) => current.slice(0, -1))}>Undo</button>
            <button className="secondary" onClick={() => setStrokes([])}>Clear</button>
            <button
              className="secondary"
              onClick={() => {
                setBaseImage("");
                setStrokes([]);
                onChange("");
              }}
            >
              Remove
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

async function imageUrlToDataUrl(url: string) {
  const response = await fetch(url);
  const blob = await response.blob();

  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function filterSnagsForRole(snags: ProductionSnag[], profile: Profile | null, accessibleUnitIds: string[], accessibleBuildingIds: string[]) {
  if (!profile) return [];
  if (profile.role === "resident") {
    return snags.filter((snag) => snag.source_type === "leaseholder_defect" && snag.unit_id && accessibleUnitIds.includes(snag.unit_id));
  }
  if (profile.role === "contractor") {
    if (accessibleBuildingIds.length === 0 && !profile.organisation_id) return snags;
    return snags.filter((snag) => (
      Boolean(snag.building_id && accessibleBuildingIds.includes(snag.building_id))
      || Boolean(profile.organisation_id && snag.assigned_to_organisation_id === profile.organisation_id)
    ));
  }
  return snags;
}
