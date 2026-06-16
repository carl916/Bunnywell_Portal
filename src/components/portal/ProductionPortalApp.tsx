"use client";

import { BarChart3, Building2, Camera, ChevronDown, ChevronRight, ClipboardList, Download, FileText, Home, LogIn, Menu, Plus, RefreshCw, Shield, UserRound, UsersRound, X } from "lucide-react";
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
  type HandoverKeyItem,
  type HandoverPhoto,
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
  floor: string;
  locationType: "unit" | "communal";
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
  floor: "",
  locationType: "unit",
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

function formatParkingBays(parkingBays?: number[] | null) {
  return parkingBays && parkingBays.length > 0 ? parkingBays.join(", ") : "None";
}

function parseParkingBays(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return [];

  return trimmed
    .split(",")
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isInteger(item) && item > 0);
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
  if (["closed", "resolved", "resolved_by_contractor", "handed_over"].includes(status)) return "status-badge bg-[#e7f3ea] text-[#147A4D]";
  if (["rejected", "rejected_back_to_contractor", "needs_more_info"].includes(status)) return "status-badge bg-[#fff4df] text-[#8a5a12]";
  if (["P1", "open", "submitted"].includes(status)) return "status-badge bg-[#eef5f1] text-[#0F3D2E]";
  return "status-badge bg-[#f3f0e8] text-[#66736B]";
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
  const [handoverKeyItems, setHandoverKeyItems] = useState<HandoverKeyItem[]>([]);
  const [handoverPhotos, setHandoverPhotos] = useState<HandoverPhoto[]>([]);
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
      handoverKeyItemsResult,
      handoverPhotosResult,
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
      supabase.from("handover_key_items").select("*").order("sort_order"),
      supabase.from("handover_photos").select("*").order("created_at", { ascending: false }),
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
    setHandoverKeyItems((handoverKeyItemsResult.data ?? []) as HandoverKeyItem[]);
    setHandoverPhotos((handoverPhotosResult.data ?? []) as HandoverPhoto[]);
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
          events={events}
          handovers={handovers}
          profile={profile}
          snags={visibleSnags}
          trades={trades}
          units={units}
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
          buildingFloors={buildingFloors}
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
          handoverKeyItems={handoverKeyItems}
          handoverPhotos={handoverPhotos}
          meterReadings={meterReadings}
          onNotice={setNotice}
          recordAudit={recordAudit}
          reload={loadAll}
          uploadFile={uploadFile}
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
          meterReadings={meterReadings}
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
  const [moreOpen, setMoreOpen] = useState(false);
  const coreTabs: Tab[] = ["dashboard", "snags", "add_snag", "handover"];
  const visibleCoreTabs = coreTabs.filter((item) => tabs.includes(item));
  const moreTabs = tabs.filter((item) => !visibleCoreTabs.includes(item));
  const mobileNavItems: Array<{ tab?: Tab; label: string; icon: React.ReactNode; isMore?: boolean }> = [
    ...(tabs.includes("dashboard") ? [{ tab: "dashboard" as Tab, label: "Home", icon: <Home size={19} aria-hidden /> }] : []),
    ...(tabs.includes("snags") ? [{ tab: "snags" as Tab, label: "Snags", icon: <ClipboardList size={19} aria-hidden /> }] : []),
    ...(tabs.includes("add_snag") ? [{ tab: "add_snag" as Tab, label: "Add", icon: <Plus size={22} aria-hidden /> }] : []),
    ...(tabs.includes("handover") ? [{ tab: "handover" as Tab, label: "Handover", icon: <Building2 size={19} aria-hidden /> }] : []),
    { label: "More", icon: <Menu size={20} aria-hidden />, isMore: true },
  ].slice(0, 5);

  function chooseTab(nextTab: Tab) {
    setTab(nextTab);
    setMoreOpen(false);
  }

  function tabIcon(item: Tab) {
    const icons: Partial<Record<Tab, React.ReactNode>> = {
      dashboard: <Home size={17} aria-hidden />,
      admin: <Building2 size={17} aria-hidden />,
      users: <UsersRound size={17} aria-hidden />,
      add_snag: <Plus size={18} aria-hidden />,
      snags: <ClipboardList size={17} aria-hidden />,
      handover: <Building2 size={17} aria-hidden />,
      leaseholder: <UserRound size={17} aria-hidden />,
      reports: <FileText size={17} aria-hidden />,
      audit: <BarChart3 size={17} aria-hidden />,
    };
    return icons[item] ?? <ChevronRight size={17} aria-hidden />;
  }

  return (
    <main className="app-shell pb-24 md:pb-0">
      <header className="app-header">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <img src="/bunnywell-logo-icon.jpg" alt="Bunnywell Homes" className="h-11 w-auto shrink-0 object-contain sm:h-12" />
              <div>
                <p className="text-[0.65rem] font-semibold uppercase tracking-[0.24em] text-[#D6A23A] sm:text-xs">Bunnywell</p>
                <h1 className="truncate text-lg font-bold text-[#0F3D2E] sm:text-2xl">Portal</h1>
              </div>
            </div>
            <div className="hidden flex-wrap items-center gap-2 md:flex">
              <span className="account-pill max-w-72">
                <Shield size={16} aria-hidden />
                <span className="truncate">{profile?.email ?? "Not signed in"}</span>
              </span>
              {onRefresh && (
                <button onClick={onRefresh} className="secondary min-h-10 px-3 text-sm">
                  <RefreshCw size={16} aria-hidden />
                  Refresh
                </button>
              )}
              {profile && (
                <button
                  onClick={() => createSupabaseBrowserClient().auth.signOut()}
                  className="secondary min-h-10 px-3 text-sm"
                >
                  <LogIn size={16} aria-hidden />
                  Sign out
                </button>
              )}
            </div>
            <button className="secondary min-h-10 px-3 md:hidden" onClick={() => setMoreOpen(true)} aria-label="Open menu">
              <Menu size={18} aria-hidden />
            </button>
          </div>
          {tabs.length > 0 && (
            <nav className="hidden gap-2 overflow-x-auto pb-1 md:flex">
              {tabs.map((item) => (
                <button
                  key={item}
                  onClick={() => chooseTab(item)}
                  className={`nav-pill ${tab === item ? "nav-pill-active" : ""}`}
                >
                  {tabIcon(item)}
                  {tabLabel(item)}
                </button>
              ))}
            </nav>
          )}
        </div>
      </header>
      {notice && (
        <div className="mx-auto max-w-7xl px-4 pt-4 sm:px-6 lg:px-8">
          <div className="rounded-xl border border-[#e2c8a6] bg-[#fff8ec] px-4 py-3 text-sm font-medium text-[#735327] shadow-sm">{notice}</div>
        </div>
      )}
      <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 md:py-7 lg:px-8">{children}</div>
      {tabs.length > 0 && (
        <nav className="mobile-bottom-nav md:hidden" aria-label="Primary mobile navigation">
          {mobileNavItems.map((item) => (
            <button
              key={item.isMore ? "more" : item.tab}
              className={`mobile-nav-item ${(!item.isMore && item.tab === tab) || (item.isMore && moreOpen) ? "mobile-nav-item-active" : ""}`}
              onClick={() => item.isMore ? setMoreOpen(true) : item.tab && chooseTab(item.tab)}
              type="button"
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
      )}
      {moreOpen && (
        <div className="mobile-menu-backdrop md:hidden" onClick={() => setMoreOpen(false)}>
          <aside className="mobile-menu-panel" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between gap-3 border-b border-[#E2DED3] pb-3">
              <div className="min-w-0">
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#D6A23A]">Account</p>
                <p className="mt-1 truncate text-sm text-[#66736B]">{profile?.email ?? "Not signed in"}</p>
              </div>
              <button className="secondary h-9 min-h-9 w-9 px-0" onClick={() => setMoreOpen(false)} aria-label="Close menu">
                <X size={16} aria-hidden />
              </button>
            </div>
            <div className="mt-4 grid gap-2">
              {moreTabs.map((item) => (
                <button key={item} className={`menu-row ${tab === item ? "menu-row-active" : ""}`} onClick={() => chooseTab(item)}>
                  {tabIcon(item)}
                  <span>{tabLabel(item)}</span>
                </button>
              ))}
              {visibleCoreTabs.map((item) => (
                <button key={`core-${item}`} className={`menu-row ${tab === item ? "menu-row-active" : ""}`} onClick={() => chooseTab(item)}>
                  {tabIcon(item)}
                  <span>{tabLabel(item)}</span>
                </button>
              ))}
            </div>
            <div className="mt-4 grid gap-2 border-t border-[#E2DED3] pt-4">
              {onRefresh && (
                <button className="menu-row" onClick={() => {
                  onRefresh();
                  setMoreOpen(false);
                }}>
                  <RefreshCw size={17} aria-hidden />
                  <span>Refresh</span>
                </button>
              )}
              {profile && (
                <button className="menu-row" onClick={() => createSupabaseBrowserClient().auth.signOut()}>
                  <LogIn size={17} aria-hidden />
                  <span>Sign out</span>
                </button>
              )}
            </div>
          </aside>
        </div>
      )}
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
    <section className="panel mx-auto max-w-md">
      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#D6A23A]">Secure access</p>
      <h2 className="mt-1 text-2xl font-bold text-[#0F3D2E]">Sign in</h2>
      <div className="mt-5 space-y-4">
        <label className="field-label">
          Email
          <input className="field" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@example.com" />
        </label>
        <label className="field-label">
          Password
          <input className="field" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Password" type="password" />
        </label>
        <button onClick={login} className="primary w-full">Sign in</button>
      </div>
    </section>
  );
}

function Dashboard({
  buildings,
  events,
  handovers,
  profile,
  snags,
  trades,
  units,
  setTab,
}: {
  buildings: Building[];
  events: SnagEvent[];
  handovers: Handover[];
  profile: Profile | null;
  snags: ProductionSnag[];
  trades: Trade[];
  units: Unit[];
  setTab: (tab: Tab) => void;
}) {
  const model = buildDashboardModel({ buildings, events, handovers, snags, trades, units });
  const isContractor = profile?.role === "contractor";
  const attentionItems = isContractor
    ? model.attention.filter((item) => ["needs_trade", "overdue", "due_soon", "recent"].includes(item.id))
    : model.attention;

  return (
    <div className="grid gap-5">
      <section className="dashboard-hero">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#D6A23A]">Action centre</p>
          <h2 className="mt-1 text-2xl font-bold text-[#0F3D2E]">What needs attention</h2>
          <p className="mt-2 max-w-2xl text-sm text-[#66736B]">A live overview of visible snags, SLA risk, trade allocation, project health and recent activity.</p>
        </div>
        <div className="grid grid-cols-3 gap-2 text-center">
          <HeroCount label="Total" value={model.total} />
          <HeroCount label="Open" value={model.open} />
          <HeroCount label="Closed" value={model.closed} />
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {attentionItems.map((item) => (
          <ActionCard key={item.id} item={item} onClick={() => setTab("snags")} />
        ))}
      </section>

      <section className="panel">
        <SectionHeader title="Construction progress" subtitle="Unit completion and handover position, kept separate from defect resolution." />
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <Metric label="Total units" value={model.lifecycle.totalUnits} />
          <Metric label="Completed" value={model.lifecycle.completedUnits} />
          <Metric label="Awaiting handover" value={model.lifecycle.awaitingHandover} onClick={() => setTab("handover")} />
          <Metric label="Handed over" value={model.lifecycle.handedOver} />
          <Metric label="This month" value={model.lifecycle.handoversThisMonth} />
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {model.lifecycle.byBuilding.map((building) => (
            <button key={building.id} className="dashboard-project-card" onClick={() => setTab("handover")}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-bold text-[#1F2A24]">{building.name}</p>
                  <p className="mt-1 text-sm text-[#66736B]">{building.awaitingHandover} awaiting handover</p>
                </div>
                <span className={statusTone(building.handoverPercent >= 80 ? "closed" : "open")}>{building.handoverPercent}% handed over</span>
              </div>
              <div className="mt-4 h-2 overflow-hidden rounded-full bg-[#ede8dc]">
                <div className="h-full rounded-full bg-[#D6A23A]" style={{ width: `${building.handoverPercent}%` }} />
              </div>
              <div className="mt-4 grid grid-cols-4 gap-2 text-center text-xs">
                <MiniStat label="Units" value={building.totalUnits} />
                <MiniStat label="Complete" value={building.completedUnits} />
                <MiniStat label="Handed" value={building.handedOver} />
                <MiniStat label="In progress" value={building.inProgress} />
              </div>
            </button>
          ))}
          {model.lifecycle.byBuilding.length === 0 && <p className="mobile-empty md:col-span-2">No unit lifecycle data to show.</p>}
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(360px,0.8fr)]">
        <section className="panel">
          <SectionHeader title="Project health" subtitle="Building-level progress and risk." />
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {model.buildingHealth.map((building) => (
              <button key={building.id} className="dashboard-project-card" onClick={() => setTab("snags")}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-bold text-[#1F2A24]">{building.name}</p>
                    <p className="mt-1 text-sm text-[#66736B]">{building.total} snag{building.total === 1 ? "" : "s"} logged</p>
                  </div>
                  <span className={statusTone(building.overdue > 0 ? "needs_more_info" : "closed")}>{building.closedPercent}% closed</span>
                </div>
                <div className="mt-4 h-2 overflow-hidden rounded-full bg-[#ede8dc]">
                  <div className="h-full rounded-full bg-[#0F3D2E]" style={{ width: `${building.closedPercent}%` }} />
                </div>
                <div className="mt-4 grid grid-cols-4 gap-2 text-center text-xs">
                  <MiniStat label="Open" value={building.open} />
                  <MiniStat label="Closed" value={building.closed} />
                  <MiniStat label="Overdue" value={building.overdue} />
                  <MiniStat label="High" value={building.highPriority} />
                </div>
              </button>
            ))}
            {model.buildingHealth.length === 0 && <p className="mobile-empty md:col-span-2">No building data to show.</p>}
          </div>
        </section>

        <section className="panel">
          <SectionHeader title="SLA overview" subtitle="Risk based on existing due dates." />
          <div className="mt-4 grid gap-3">
            {model.sla.map((item) => (
              <button key={item.label} className="dashboard-row-card" onClick={() => setTab("snags")}>
                <span>{item.label}</span>
                <strong>{item.value}</strong>
              </button>
            ))}
          </div>
        </section>
      </div>

      <div className="grid gap-5 xl:grid-cols-3">
        <BreakdownPanel title="Priority breakdown" items={model.priorityBreakdown} onClick={() => setTab("snags")} />
        <BreakdownPanel title="Status breakdown" items={model.statusBreakdown} onClick={() => setTab("snags")} />
        <BreakdownPanel title="Trade breakdown" items={model.tradeBreakdown} onClick={() => setTab("snags")} />
      </div>

      <section className="panel">
        <SectionHeader title="Recent activity" subtitle="Latest comments, status changes, photos and allocation updates." />
        <div className="mt-4 grid gap-3">
          {model.recentActivity.map((activity) => (
            <button key={activity.id} className="dashboard-activity-card" onClick={() => setTab("snags")}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-bold text-[#1F2A24]">{activity.title}</p>
                  <p className="mt-1 text-sm text-[#66736B]">{activity.meta}</p>
                </div>
                <span className="text-xs font-semibold text-[#66736B]">{formatDate(activity.createdAt)}</span>
              </div>
              {activity.comment && <p className="mt-2 text-sm text-[#34413a]">{activity.comment}</p>}
            </button>
          ))}
          {model.recentActivity.length === 0 && <p className="mobile-empty">No recent activity yet.</p>}
        </div>
      </section>
    </div>
  );
}

function buildDashboardModel({
  buildings,
  events,
  handovers,
  snags,
  trades,
  units,
}: {
  buildings: Building[];
  events: SnagEvent[];
  handovers: Handover[];
  snags: ProductionSnag[];
  trades: Trade[];
  units: Unit[];
}) {
  const now = new Date();
  const in7 = new Date(now);
  in7.setDate(in7.getDate() + 7);
  const in14 = new Date(now);
  in14.setDate(in14.getDate() + 14);
  const isClosed = (snag: ProductionSnag) => ["closed", "resolved"].includes(snag.status);
  const openSnags = snags.filter((snag) => !isClosed(snag));
  const overdue = openSnags.filter((snag) => snag.sla_due_date && new Date(snag.sla_due_date) < now);
  const dueWithin7 = openSnags.filter((snag) => snag.sla_due_date && new Date(snag.sla_due_date) >= now && new Date(snag.sla_due_date) <= in7);
  const dueWithin14 = openSnags.filter((snag) => snag.sla_due_date && new Date(snag.sla_due_date) > in7 && new Date(snag.sla_due_date) <= in14);
  const needsTrade = openSnags.filter((snag) => !snag.trade_id);
  const readyForReview = snags.filter((snag) => snag.status === "resolved_by_contractor");
  const rejectedByContractor = snags.filter((snag) => snag.status === "needs_more_info");
  const rejectedByDeveloper = snags.filter((snag) => snag.status === "rejected_back_to_contractor" || snag.status === "rejected");
  const recentlyUpdated = snags.filter((snag) => {
    const updated = new Date(snag.updated_at || snag.created_at);
    const sevenDaysAgo = new Date(now);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    return updated >= sevenDaysAgo;
  });
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - now.getDay() + 1);
  startOfWeek.setHours(0, 0, 0, 0);
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const handoverUnitIds = new Set(handovers.map((handover) => handover.unit_id));
  const isHandedOver = (unit: Unit) => unit.sale_status === "handed_over" || handoverUnitIds.has(unit.id);
  const completedUnits = units.filter((unit) => unit.sale_status === "completed");
  const handedOverUnits = units.filter(isHandedOver);
  const awaitingHandoverUnits = units.filter((unit) => unit.sale_status === "completed" && !handoverUnitIds.has(unit.id));
  const handoverDate = (handover: Handover) => new Date(handover.handover_datetime ?? handover.created_at ?? handover.handover_date);
  const lifecycleByBuilding = buildings.map((building) => {
    const buildingUnits = units.filter((unit) => unit.building_id === building.id);
    const handedOver = buildingUnits.filter(isHandedOver).length;
    const completed = buildingUnits.filter((unit) => unit.sale_status === "completed" || isHandedOver(unit)).length;
    const total = buildingUnits.length;
    return {
      id: building.id,
      name: building.name,
      totalUnits: total,
      completedUnits: completed,
      handedOver,
      awaitingHandover: buildingUnits.filter((unit) => unit.sale_status === "completed" && !handoverUnitIds.has(unit.id)).length,
      inProgress: buildingUnits.filter((unit) => !["completed", "handed_over"].includes(unit.sale_status)).length,
      handoverPercent: total === 0 ? 0 : Math.round((handedOver / total) * 100),
    };
  }).filter((building) => building.totalUnits > 0);

  const countBy = <T,>(items: T[], keyFn: (item: T) => string) => {
    const counts = new Map<string, number>();
    items.forEach((item) => counts.set(keyFn(item), (counts.get(keyFn(item)) ?? 0) + 1));
    return Array.from(counts.entries()).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
  };

  const buildingHealth = buildings.map((building) => {
    const buildingSnags = snags.filter((snag) => snag.building_id === building.id);
    const closed = buildingSnags.filter(isClosed).length;
    const total = buildingSnags.length;
    return {
      id: building.id,
      name: building.name,
      total,
      open: buildingSnags.filter((snag) => !isClosed(snag)).length,
      closed,
      overdue: overdue.filter((snag) => snag.building_id === building.id).length,
      highPriority: buildingSnags.filter((snag) => snag.priority_code === "P1").length,
      closedPercent: total === 0 ? 0 : Math.round((closed / total) * 100),
    };
  }).filter((building) => building.total > 0 || buildings.length <= 4);

  const recentActivity = events.slice(0, 8).map((event) => {
    const snag = snags.find((item) => item.id === event.snag_id);
    const unit = units.find((item) => item.id === snag?.unit_id);
    return {
      id: event.id,
      title: `${eventLabel(event.event_type)}${snag ? `: ${snag.title}` : ""}`,
      meta: `${unit ? `Unit ${unit.unit_number}` : "Communal or unknown"} / ${event.new_value ? statusLabel(event.new_value) : "Activity"}`,
      comment: event.comment,
      createdAt: event.created_at,
    };
  });

  return {
    total: snags.length,
    open: openSnags.length,
    closed: snags.filter(isClosed).length,
    lifecycle: {
      totalUnits: units.length,
      completedUnits: completedUnits.length,
      awaitingHandover: awaitingHandoverUnits.length,
      handedOver: handedOverUnits.length,
      handoversThisWeek: handovers.filter((handover) => handoverDate(handover) >= startOfWeek).length,
      handoversThisMonth: handovers.filter((handover) => handoverDate(handover) >= startOfMonth).length,
      byBuilding: lifecycleByBuilding,
    },
    attention: [
      { id: "needs_trade", label: "Needs trade allocation", value: needsTrade.length, tone: "warning", helper: "Open snags without a trade." },
      { id: "overdue", label: "Overdue SLA", value: overdue.length, tone: overdue.length ? "danger" : "good", helper: "Past due and not closed." },
      { id: "due_soon", label: "Due within 7 days", value: dueWithin7.length, tone: "warning", helper: "Upcoming SLA risk." },
      { id: "review", label: "Ready for review", value: readyForReview.length, tone: "good", helper: "Resolved by contractor." },
      { id: "contractor_reject", label: "Needs more info", value: rejectedByContractor.length, tone: "warning", helper: "Returned to developer." },
      { id: "developer_reject", label: "Rejected/disputed", value: rejectedByDeveloper.length, tone: "danger", helper: "Returned or rejected." },
      { id: "recent", label: "Recently updated", value: recentlyUpdated.length, tone: "neutral", helper: "Changed in the last 7 days." },
    ],
    buildingHealth,
    sla: [
      { label: "Already overdue", value: overdue.length },
      { label: "Due within 7 days", value: dueWithin7.length },
      { label: "Due within 14 days", value: dueWithin14.length },
    ],
    priorityBreakdown: ["P1", "P2", "P3", "No priority"].map((label) => ({
      label,
      value: label === "No priority" ? snags.filter((snag) => !snag.priority_code).length : snags.filter((snag) => snag.priority_code === label).length,
    })),
    statusBreakdown: countBy(snags, (snag) => statusLabel(snag.status)),
    tradeBreakdown: countBy(openSnags, (snag) => trades.find((trade) => trade.id === snag.trade_id)?.name ?? "No trade"),
    recentActivity,
  };
}

function HeroCount({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-[#E2DED3] bg-white/70 p-3">
      <p className="text-2xl font-bold text-[#0F3D2E]">{value}</p>
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#66736B]">{label}</p>
    </div>
  );
}

function ActionCard({ item, onClick }: { item: { label: string; value: number; tone: string; helper: string }; onClick: () => void }) {
  const toneClass = item.tone === "danger" ? "dashboard-action-danger" : item.tone === "good" ? "dashboard-action-good" : item.tone === "warning" ? "dashboard-action-warning" : "";
  return (
    <button className={`dashboard-action-card ${toneClass}`} onClick={onClick}>
      <p className="text-sm font-bold text-[#1F2A24]">{item.label}</p>
      <p className="mt-3 text-3xl font-bold text-[#0F3D2E]">{item.value}</p>
      <p className="mt-2 text-xs text-[#66736B]">{item.helper}</p>
    </button>
  );
}

function SectionHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div>
      <h3 className="text-lg font-bold text-[#0F3D2E]">{title}</h3>
      <p className="mt-1 text-sm text-[#66736B]">{subtitle}</p>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-[#FBFAF6] p-2">
      <p className="font-bold text-[#0F3D2E]">{value}</p>
      <p className="text-[#66736B]">{label}</p>
    </div>
  );
}

function BreakdownPanel({ title, items, onClick }: { title: string; items: Array<{ label: string; value: number }>; onClick: () => void }) {
  const max = Math.max(1, ...items.map((item) => item.value));
  return (
    <section className="panel">
      <SectionHeader title={title} subtitle="Current visible snags." />
      <div className="mt-4 grid gap-3">
        {items.map((item) => (
          <button key={item.label} className="dashboard-breakdown-row" onClick={onClick}>
            <div className="flex items-center justify-between gap-3">
              <span>{item.label}</span>
              <strong>{item.value}</strong>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-[#ede8dc]">
              <div className="h-full rounded-full bg-[#D6A23A]" style={{ width: `${Math.round((item.value / max) * 100)}%` }} />
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}

function Metric({ label, value, onClick }: { label: string; value: number; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      className="card-surface p-4 text-left transition enabled:cursor-pointer enabled:hover:-translate-y-0.5 enabled:hover:border-[#D6A23A] enabled:hover:shadow-[0_14px_28px_rgba(15,61,46,0.10)] disabled:cursor-default"
      disabled={!onClick}
    >
      <p className="text-xs font-bold uppercase tracking-[0.12em] text-[#66736B]">{label}</p>
      <p className="mt-2 text-3xl font-bold text-[#0F3D2E]">{value}</p>
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
  const [communalFloor, setCommunalFloor] = useState("");
  const [floorSorts, setFloorSorts] = useState<Record<string, string>>({});
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

  useEffect(() => {
    setFloorSorts(Object.fromEntries(floors.map((floor) => [floor.id, String(floor.sort_order)])));
  }, [buildingId, buildingFloors]);

  async function updateFloorSort(floor: BuildingFloor) {
    const nextSort = Number(floorSorts[floor.id]);
    if (!Number.isFinite(nextSort) || nextSort === floor.sort_order) return;
    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.from("building_floors").update({ sort_order: nextSort }).eq("id", floor.id);
    if (error) onNotice(error.message);
    else await reload();
  }

  async function addCommunalArea() {
    if (!building || !communalName) return;
    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.from("areas").insert({
      building_id: building.id,
      unit_id: null,
      area_type: "communal_area",
      name: communalName,
      floor: communalFloor || null,
      sort_order: communalAreas.length + 1,
    });
    if (error) onNotice(error.message);
    else {
      setCommunalName("");
      setCommunalFloor("");
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
            <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {floors.map((floor) => (
                <div key={floor.id} className="grid gap-2 rounded-md border border-[#cbd4ce] bg-white px-3 py-2 text-sm">
                  <span className="font-medium">{floor.name}</span>
                  <label className="grid gap-1 text-xs text-[#617169]">
                    Sort order
                    <input
                      className="field py-1 text-sm"
                      value={floorSorts[floor.id] ?? String(floor.sort_order)}
                      onBlur={() => updateFloorSort(floor)}
                      onChange={(event) => setFloorSorts((current) => ({ ...current, [floor.id]: event.target.value }))}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") void updateFloorSort(floor);
                      }}
                      type="number"
                    />
                  </label>
                </div>
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
            <div className="mt-3 grid gap-2 lg:grid-cols-[minmax(0,1fr)_220px_auto]">
              <input
                className="field"
                value={communalName}
                onChange={(event) => setCommunalName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void addCommunalArea();
                }}
                placeholder="Add communal area"
              />
              <select className="field" value={communalFloor} onChange={(event) => setCommunalFloor(event.target.value)}>
                <option value="">No floor / external</option>
                {floors.map((floor) => <option key={floor.id} value={floor.name}>{floor.name}</option>)}
              </select>
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
  const [unitParkingBays, setUnitParkingBays] = useState("");
  const [unitTypeId, setUnitTypeId] = useState("");
  const [collapsed, setCollapsed] = useState(!warning);

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
      parking_bays: parseParkingBays(unitParkingBays),
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
    setUnitParkingBays("");
    setUnitTypeId("");
    await reload();
  }

  return (
    <div className={`rounded-md border p-4 ${warning ? "border-[#e2c8a6] bg-[#fff8ec]" : "border-[#c4ccc6] bg-[#f8faf7]"}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          className="inline-flex items-center gap-2 rounded-full px-1 py-1 text-left font-semibold text-[#0F3D2E] transition hover:text-[#0B2E23]"
          onClick={() => setCollapsed((current) => !current)}
          aria-expanded={!collapsed}
        >
          {collapsed ? <ChevronRight size={18} aria-hidden /> : <ChevronDown size={18} aria-hidden />}
          <span>{floorName}</span>
        </button>
        <div className="flex items-center gap-2">
          <span className="text-sm text-[#617169]">{units.length} unit{units.length === 1 ? "" : "s"}</span>
          <button
            className="secondary h-8 min-h-8 w-8 px-0 py-0"
            onClick={() => setCollapsed((current) => !current)}
            aria-label={collapsed ? `Expand ${floorName}` : `Collapse ${floorName}`}
            title={collapsed ? `Expand ${floorName}` : `Collapse ${floorName}`}
          >
            {collapsed ? <ChevronRight size={16} aria-hidden /> : <ChevronDown size={16} aria-hidden />}
          </button>
        </div>
      </div>
      {!collapsed && (
        <>
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
            <div className="mt-4 grid gap-2 rounded-md border border-dashed border-[#cbd4ce] bg-white p-3 lg:grid-cols-[1fr_1fr_1fr_1fr_auto]">
              <input className="field" value={unitNumber} onChange={(event) => setUnitNumber(event.target.value)} placeholder={`Add unit to ${floorName}`} />
              <input className="field" value={unitSizeSqm} onChange={(event) => setUnitSizeSqm(event.target.value)} placeholder="Size sqm" type="number" min="0" step="0.1" />
              <input className="field" value={unitParkingBays} onChange={(event) => setUnitParkingBays(event.target.value)} placeholder="Parking bays, e.g. 12, 13" />
              <select className="field" value={unitTypeId} onChange={(event) => setUnitTypeId(event.target.value)}>
                <option value="">Unit type</option>
                {unitTypes.map((unitType) => <option key={unitType.id} value={unitType.id}>{unitType.name}</option>)}
              </select>
              <button className="secondary" onClick={addUnitToFloor} disabled={!unitNumber || !unitSizeSqm || !unitTypeId}>Add unit</button>
            </div>
          )}
        </>
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
  const [editParkingBays, setEditParkingBays] = useState(formatParkingBays(unit.parking_bays) === "None" ? "" : formatParkingBays(unit.parking_bays));
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
    setEditParkingBays(formatParkingBays(unit.parking_bays) === "None" ? "" : formatParkingBays(unit.parking_bays));
    setEditUnitTypeId(unit.unit_type_id ?? "");
    setEditSaleStatus(unit.sale_status);
    setAreasToRemove([]);
    setPendingRooms([]);
    setPendingAmenity(false);
  }, [unit.floor, unit.parking_bays, unit.sale_status, unit.size_sqm, unit.unit_number, unit.unit_type_id]);

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
      parking_bays: parseParkingBays(editParkingBays),
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
    setEditParkingBays(formatParkingBays(unit.parking_bays) === "None" ? "" : formatParkingBays(unit.parking_bays));
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
                    <input className="field" value={editParkingBays} onChange={(event) => setEditParkingBays(event.target.value)} placeholder="Parking bays, e.g. 12, 13" />
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <select className="field" value={editUnitTypeId} onChange={(event) => setEditUnitTypeId(event.target.value)}>
                      <option value="">Unit type</option>
                      {unitTypes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                    </select>
                    <select className="field" value={editSaleStatus} onChange={(event) => setEditSaleStatus(event.target.value as Unit["sale_status"])}>
                      {unitSaleStatuses.map((status) => <option key={status.value} value={status.value}>{status.label}</option>)}
                    </select>
                  </div>
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
                    <p className="text-xs text-[#617169]">Parking: {formatParkingBays(unit.parking_bays)}</p>
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
  const [photoUrl, setPhotoUrl] = useState("");
  const [documentsUrl, setDocumentsUrl] = useState("");
  const [homeUserGuideUrl, setHomeUserGuideUrl] = useState("");

  async function createBuilding() {
    const supabase = createSupabaseBrowserClient();
    const defectsEnd = pcDate ? new Date(new Date(pcDate).setFullYear(new Date(pcDate).getFullYear() + 1)).toISOString().slice(0, 10) : null;
    const { data, error } = await supabase.from("buildings").insert({
      name: buildingName,
      address_line_1: addressLine1,
      address_line_2: addressLine2,
      town,
      postcode,
      photo_url: photoUrl || null,
      documents_url: documentsUrl || null,
      home_user_guide_url: homeUserGuideUrl || null,
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
      setPhotoUrl("");
      setDocumentsUrl("");
      setHomeUserGuideUrl("");
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
        <input className="field" value={photoUrl} onChange={(event) => setPhotoUrl(event.target.value)} placeholder="Building photo URL" />
        <input className="field" value={documentsUrl} onChange={(event) => setDocumentsUrl(event.target.value)} placeholder="Building documents link" />
        <input className="field" value={homeUserGuideUrl} onChange={(event) => setHomeUserGuideUrl(event.target.value)} placeholder="Home user guide link" />
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
  buildingFloors,
  units,
  areas,
  trades,
  onNotice,
  reload,
  uploadFile,
}: {
  user: User;
  buildings: Building[];
  buildingFloors: BuildingFloor[];
  units: Unit[];
  areas: Area[];
  trades: Trade[];
  onNotice: (notice: string) => void;
  reload: () => Promise<void>;
  uploadFile: (dataUrl: string, folder: string) => Promise<string>;
}) {
  const [draft, setDraft] = useState<SnagDraft>(emptySnagDraft);
  const selectedUnit = units.find((unit) => unit.id === draft.unitId);
  const selectedArea = areas.find((area) => area.id === draft.areaId);
  const selectedBuilding = buildings.find((building) => building.id === (draft.buildingId || selectedUnit?.building_id || selectedArea?.building_id));
  const availableFloors = buildingFloors
    .filter((floor) => floor.building_id === selectedBuilding?.id)
    .sort((a, b) => a.sort_order - b.sort_order);
  const buildingUnits = units
    .filter((unit) => draft.buildingId && unit.building_id === draft.buildingId)
    .filter((unit) => !draft.floor || unit.floor === draft.floor);
  const unitAreas = areas.filter((area) => area.unit_id === draft.unitId);
  const communalAreas = areas
    .filter((area) => area.area_type === "communal_area")
    .filter((area) => draft.buildingId && area.building_id === draft.buildingId)
    .filter((area) => !draft.floor || area.floor === draft.floor);
  const areaOptions = draft.locationType === "unit" ? unitAreas : communalAreas;
  const snagBuildingId = draft.locationType === "unit" ? selectedUnit?.building_id : selectedArea?.building_id ?? draft.buildingId;
  const snagUnitId = draft.locationType === "unit" ? draft.unitId : null;

  async function createDeveloperSnag() {
    if (!draft.title || !draft.photoDataUrl || !draft.areaId || !snagBuildingId) {
      onNotice("Developer snags need a location, title and photo.");
      return;
    }

    if (draft.locationType === "unit" && !draft.unitId) {
      onNotice("Select a unit before adding a unit snag.");
      return;
    }

    const supabase = createSupabaseBrowserClient();
    const photoUrl = await uploadFile(draft.photoDataUrl, "snags");
    const { data, error } = await supabase.from("snags").insert({
      building_id: snagBuildingId,
      unit_id: snagUnitId,
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
    setDraft({
      ...emptySnagDraft,
      buildingId: draft.buildingId,
      floor: draft.floor,
      locationType: draft.locationType,
      unitId: draft.unitId,
      areaId: draft.areaId,
    });
    onNotice("");
    await reload();
  }

  return (
    <div className="max-w-xl">
      <FormPanel title="Add developer snag">
        <select className="field" value={draft.buildingId} onChange={(event) => setDraft({ ...draft, buildingId: event.target.value, floor: "", unitId: "", areaId: "" })}>
          <option value="">Select building</option>
          {buildings.map((building) => <option key={building.id} value={building.id}>{building.name}</option>)}
        </select>
        <select className={`field ${draft.floor ? "filter-active" : ""}`} value={draft.floor} onChange={(event) => setDraft({ ...draft, floor: event.target.value, unitId: "", areaId: "" })} disabled={!draft.buildingId}>
          <option value="">All floors</option>
          {availableFloors.map((floor) => <option key={floor.id} value={floor.name}>{floor.name}</option>)}
        </select>
        <div className="grid grid-cols-2 gap-2">
          <button
            className={draft.locationType === "unit" ? "primary" : "secondary"}
            onClick={() => setDraft({ ...draft, locationType: "unit", areaId: "" })}
            disabled={!draft.buildingId}
            type="button"
          >
            Unit
          </button>
          <button
            className={draft.locationType === "communal" ? "primary" : "secondary"}
            onClick={() => setDraft({ ...draft, locationType: "communal", unitId: "", areaId: "" })}
            disabled={!draft.buildingId}
            type="button"
          >
            Communal
          </button>
        </div>
        {draft.locationType === "unit" && (
          <select className="field" value={draft.unitId} onChange={(event) => setDraft({ ...draft, unitId: event.target.value, areaId: "" })} disabled={!draft.buildingId}>
            <option value="">Select unit</option>
            {buildingUnits.map((unit) => <option key={unit.id} value={unit.id}>{unit.unit_number}{unit.floor ? ` / ${unit.floor}` : ""}</option>)}
          </select>
        )}
        <select className="field" value={draft.areaId} onChange={(event) => setDraft({ ...draft, areaId: event.target.value })} disabled={!draft.buildingId || (draft.locationType === "unit" && !draft.unitId)}>
          <option value="">{draft.locationType === "unit" ? "Select room / private area" : "Select communal area"}</option>
          {areaOptions.map((area) => (
            <option key={area.id} value={area.id}>
              {area.name}{area.floor && draft.locationType === "communal" ? ` / ${area.floor}` : ""}
            </option>
          ))}
        </select>
        <input className="field" value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} maxLength={50} placeholder="Title" disabled={!draft.buildingId} />
        <textarea className="field min-h-24 py-3" value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} placeholder="Description" disabled={!draft.buildingId} />
        <select className="field" value={draft.tradeId} onChange={(event) => setDraft({ ...draft, tradeId: event.target.value })} disabled={!draft.buildingId}>
          <option value="">Trade</option>
          {trades.map((trade) => <option key={trade.id} value={trade.id}>{trade.name}</option>)}
        </select>
        <PhotoInput value={draft.photoDataUrl} onChange={(photoDataUrl) => setDraft({ ...draft, photoDataUrl })} disabled={!draft.buildingId} />
        <button className="primary" onClick={createDeveloperSnag} disabled={!draft.buildingId || !draft.areaId || !draft.title || !draft.photoDataUrl}><Plus size={16} /> Save and add another</button>
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
    <section className="panel p-0">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#d9ded6] px-4 py-3">
        <div>
          <h2 className="text-lg font-bold text-[#0F3D2E]">Users</h2>
          <p className="text-sm text-[#617169]">Roles, allocation and account dates.</p>
        </div>
        <button className="primary min-h-9 px-3 py-1.5 text-sm" onClick={onAddUser}>
          <Plus size={16} /> Add user
        </button>
      </div>
      <div className="grid gap-3 bg-[#F7F5EF] p-3 md:hidden">
        {profiles.map((profile) => {
          const isEditing = profile.id === editingUserId;

          return (
            <article key={profile.id} className={`mobile-card ${isEditing ? "mobile-card-active" : ""}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-bold text-[#1F2A24]">{profile.full_name || profile.name || "No name"}</p>
                  <p className="mt-0.5 truncate text-sm text-[#66736B]">{profile.email}</p>
                </div>
                <span className={statusTone(profile.role)}>{statusLabel(profile.role)}</span>
              </div>
              <div className="mt-3 grid gap-2 text-sm">
                <div className="flex justify-between gap-3">
                  <span className="text-[#66736B]">Resident type</span>
                  <span className="font-medium">{profile.role === "resident" && profile.resident_type ? statusLabel(profile.resident_type) : "None"}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-[#66736B]">Organisation</span>
                  <span className="max-w-[58%] truncate font-medium">{organisationName(profile) || "None"}</span>
                </div>
                <div>
                  <span className="text-[#66736B]">Allocation</span>
                  <p className="mt-1 text-[#1F2A24]">{allocationLabel(profile)}</p>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-[#66736B]">Created</span>
                  <span className="font-medium">{profile.created_at ? formatDate(profile.created_at) : "Unknown"}</span>
                </div>
              </div>
              <button className="secondary mt-3 w-full min-h-10" onClick={() => onEditUser(isEditing ? "" : profile.id)}>
                {isEditing ? "Close" : "Edit user"}
              </button>
              {isEditing && (
                <div className="mt-3 border-t border-[#E2DED3] pt-3">
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
                </div>
              )}
            </article>
          );
        })}
        {profiles.length === 0 && <p className="mobile-empty">No users yet.</p>}
      </div>
      <div className="hidden overflow-x-auto md:block">
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
    <div className="form-section mt-4">
      <p className="text-sm font-bold text-[#0F3D2E]">Building access</p>
      <p className="mt-1 text-sm text-[#66736B]">Choose the buildings this user can work with.</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {buildings.map((building) => (
          <label key={building.id} className={`option-card ${selectedBuildingIds.includes(building.id) ? "option-card-selected" : ""}`}>
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
  function toggleFloor(unitIds: string[]) {
    const allSelected = unitIds.every((unitId) => selectedUnitIds.includes(unitId));
    unitIds.forEach((unitId) => {
      if (allSelected || !selectedUnitIds.includes(unitId)) onToggle(unitId);
    });
  }

  return (
    <div className="form-section mt-4">
      <p className="text-sm font-bold text-[#0F3D2E]">Unit access</p>
      <p className="mt-1 text-sm text-[#66736B]">Residents can be linked to one or more flats across one or more buildings.</p>
      <div className="mt-3 grid gap-3">
        {buildings.map((building) => {
          const buildingUnits = units.filter((unit) => unit.building_id === building.id);
          const unitsByFloor = buildingUnits.reduce<Record<string, Unit[]>>((groups, unit) => {
            const floor = unit.floor || "No floor";
            groups[floor] = [...(groups[floor] ?? []), unit];
            return groups;
          }, {});
          return (
            <div key={building.id} className="card-surface p-3">
              <p className="text-sm font-bold text-[#1F2A24]">{building.name}</p>
              <div className="mt-3 grid gap-3">
                {Object.entries(unitsByFloor).map(([floorName, floorUnits]) => {
                  const floorUnitIds = floorUnits.map((unit) => unit.id);
                  const allSelected = floorUnitIds.length > 0 && floorUnitIds.every((unitId) => selectedUnitIds.includes(unitId));
                  return (
                    <div key={floorName} className="rounded-xl border border-[#E2DED3] bg-[#FBFAF6] p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-xs font-bold uppercase tracking-[0.12em] text-[#66736B]">{floorName}</p>
                        <button className="secondary min-h-8 px-3 py-1 text-xs" type="button" onClick={() => toggleFloor(floorUnitIds)}>
                          {allSelected ? "Clear floor" : "Select floor"}
                        </button>
                      </div>
                      <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                        {floorUnits.map((unit) => (
                          <label key={unit.id} className={`option-card ${selectedUnitIds.includes(unit.id) ? "option-card-selected" : ""}`}>
                            <input checked={selectedUnitIds.includes(unit.id)} onChange={() => onToggle(unit.id)} type="checkbox" />
                            <span>Unit {unit.unit_number}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  );
                })}
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
    <section className="panel">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#D6A23A]">Account setup</p>
          <h2 className="mt-1 text-xl font-bold text-[#0F3D2E]">Add user</h2>
          <p className="text-sm text-[#617169]">Create the account and assign access.</p>
        </div>
        <button className="secondary min-h-8 px-2 py-1 text-xs" onClick={onCancel}>Back to users</button>
      </div>
      <div className="mt-5 grid gap-4">
        <div className="form-section">
          <h3 className="text-sm font-bold text-[#0F3D2E]">Account details</h3>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <label className="field-label">Name<input className="field" value={fullName} onChange={(event) => setFullName(event.target.value)} placeholder="Full name" /></label>
            <label className="field-label">Email<input className="field" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@example.com" type="email" /></label>
            <label className="field-label md:col-span-2">Temporary password<input className="field" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Temporary password" type="password" /></label>
          </div>
        </div>
        <div className="form-section">
          <h3 className="text-sm font-bold text-[#0F3D2E]">Role and access</h3>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <label className="field-label">
              Role
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
            </label>
            {isResident && (
              <label className="field-label">
                Resident type
                <select className="field" value={residentType} onChange={(event) => setResidentType(event.target.value as ResidentType)}>
                  {residentTypes.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                </select>
              </label>
            )}
            {needsOrganisationAndBuilding && (
              <label className="field-label">
                Organisation
                <select className="field" value={organisationId} onChange={(event) => setOrganisationId(event.target.value)}>
                  <option value="">Organisation</option>
                  {organisationsForRole.map((organisation) => (
                    <option key={organisation.id} value={organisation.id}>{organisation.name}</option>
                  ))}
                </select>
              </label>
            )}
          </div>
        </div>
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
  const normaliseOrganisationName = (value: string) => value.trim().replace(/\s+/g, " ").toLowerCase();
  const organisationNameExists = (value: string, excludeId?: string) => {
    const normalised = normaliseOrganisationName(value);
    return organisations.some((organisation) => organisation.id !== excludeId && normaliseOrganisationName(organisation.name) === normalised);
  };

  async function createOrganisation() {
    if (!name) return;
    const trimmedName = name.trim().replace(/\s+/g, " ");
    if (organisationNameExists(trimmedName)) {
      onNotice(`An organisation called "${trimmedName}" already exists.`);
      return;
    }
    const supabase = createSupabaseBrowserClient();
    const { data, error } = await supabase.from("organisations").insert({ name: trimmedName, type }).select("id").single();
    if (error) onNotice(error.message);
    else {
      await recordAudit({
        event_type: "organisation_created",
        entity_type: "organisation",
        entity_id: data.id,
        summary: `Organisation created: ${trimmedName}`,
        metadata: { name: trimmedName, type },
      });
      setName("");
      setType("contractor");
      onNotice("");
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
    const trimmedName = editName.trim().replace(/\s+/g, " ");
    if (organisationNameExists(trimmedName, editingId)) {
      onNotice(`An organisation called "${trimmedName}" already exists.`);
      return;
    }
    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.from("organisations").update({ name: trimmedName, type: editType }).eq("id", editingId);
    if (error) onNotice(error.message);
    else {
      await recordAudit({
        event_type: "organisation_updated",
        entity_type: "organisation",
        entity_id: editingId,
        summary: `Organisation updated: ${trimmedName}`,
        metadata: { name: trimmedName, type: editType },
      });
      setEditingId("");
      setEditName("");
      setEditType("contractor");
      onNotice("");
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
  meterReadings,
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
  meterReadings: MeterReading[];
  photos: SnagPhoto[];
  events: SnagEvent[];
  profiles: Profile[];
  accessibleUnitIds: string[];
  onNotice: (notice: string) => void;
  reload: () => Promise<void>;
  uploadFile: (dataUrl: string, folder: string) => Promise<string>;
}) {
  const userUnits = profile?.role === "resident" ? units.filter((unit) => accessibleUnitIds.includes(unit.id)) : units;
  const residentFloors = Array.from(new Set(userUnits.map((unit) => unit.floor).filter(Boolean) as string[])).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const [floor, setFloor] = useState("");
  const filteredUserUnits = userUnits.filter((unit) => !floor || unit.floor === floor);
  const [unitId, setUnitId] = useState(userUnits[0]?.id ?? "");
  const [areaId, setAreaId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [photo, setPhoto] = useState("");
  const [defectStatusFilter, setDefectStatusFilter] = useState("");
  const [defectPriorityFilter, setDefectPriorityFilter] = useState("");
  const [meterType, setMeterType] = useState<"water" | "electricity">("water");
  const [meterReading, setMeterReading] = useState("");
  const [meterPhoto, setMeterPhoto] = useState("");
  const selectedUnit = units.find((unit) => unit.id === unitId);
  const selectedBuilding = buildings.find((building) => building.id === selectedUnit?.building_id);
  const selectedUnitAreas = areas.filter((area) => area.unit_id === unitId);
  const selectedUnitDefects = snags.filter((snag) => snag.unit_id === unitId);
  const filteredDefects = selectedUnitDefects
    .filter((snag) => !defectStatusFilter || snag.status === defectStatusFilter)
    .filter((snag) => !defectPriorityFilter || snag.priority_code === defectPriorityFilter);
  const selectedMeterReadings = meterReadings
    .filter((reading) => reading.unit_id === unitId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const activeDefectCount = selectedUnitDefects.filter((snag) => !["closed", "rejected"].includes(snag.status)).length;
  const closedDefectCount = selectedUnitDefects.filter((snag) => snag.status === "closed").length;

  useEffect(() => {
    if (filteredUserUnits.length > 0 && !filteredUserUnits.some((unit) => unit.id === unitId)) {
      setUnitId(filteredUserUnits[0].id);
      setAreaId("");
    }
  }, [filteredUserUnits, unitId]);

  async function createDefect() {
    if (!title || !photo || !selectedUnit) {
      onNotice("Defects need a title and photo.");
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
    onNotice("");
    await reload();
  }

  async function createMeterReading() {
    if (!selectedUnit || !meterReading || !meterPhoto) {
      onNotice("Meter readings need a type, reading and photo.");
      return;
    }

    const parsedReading = Number(meterReading);
    if (!Number.isFinite(parsedReading) || parsedReading < 0) {
      onNotice("Enter a valid meter reading.");
      return;
    }

    const supabase = createSupabaseBrowserClient();
    const photoUrl = await uploadFile(meterPhoto, "meter-readings");
    const { error } = await supabase.from("meter_readings").insert({
      building_id: selectedUnit.building_id,
      unit_id: selectedUnit.id,
      meter_type: meterType,
      reading_value: parsedReading,
      reading_date: new Date().toISOString().slice(0, 10),
      photo_url: photoUrl,
      created_by_user_id: user.id,
    });

    if (error) {
      onNotice(error.message);
      return;
    }

    setMeterType("water");
    setMeterReading("");
    setMeterPhoto("");
    onNotice("");
    await reload();
  }

  return (
    <div className="grid gap-5">
      <section className="rounded-md border border-[#d9ded6] bg-white p-4">
        <div className="grid gap-3 md:grid-cols-[220px_minmax(0,1fr)]">
          <div className="grid gap-3">
            {residentFloors.length > 0 && (
              <select className={`field ${floor ? "filter-active" : ""}`} value={floor} onChange={(event) => {
                setFloor(event.target.value);
                setAreaId("");
              }}>
                <option value="">All floors</option>
                {residentFloors.map((floorName) => <option key={floorName} value={floorName}>{floorName}</option>)}
              </select>
            )}
            <select className="field" value={unitId} onChange={(event) => {
              setUnitId(event.target.value);
              setAreaId("");
            }}>
              {filteredUserUnits.map((unit) => <option key={unit.id} value={unit.id}>{unit.unit_number}{unit.floor ? ` / ${unit.floor}` : ""}</option>)}
            </select>
          </div>
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#0F3D31]">{selectedBuilding?.name ?? "No building"}</p>
            <h2 className="mt-1 text-2xl font-semibold">Unit {selectedUnit?.unit_number ?? "-"}</h2>
            <p className="mt-1 text-sm text-[#617169]">
              Parking bay{(selectedUnit?.parking_bays?.length ?? 0) === 1 ? "" : "s"}: {formatParkingBays(selectedUnit?.parking_bays)}
            </p>
          </div>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <SummaryTile label="Open defects" value={activeDefectCount} />
          <SummaryTile label="Closed defects" value={closedDefectCount} />
          <SummaryTile label="Meter readings" value={selectedMeterReadings.length} />
          <SummaryTile label="Rooms" value={selectedUnitAreas.length} />
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {selectedBuilding?.documents_url && (
            <a className="secondary min-h-9 px-3 py-1.5 text-sm" href={selectedBuilding.documents_url} target="_blank" rel="noreferrer">Building documents</a>
          )}
          {selectedBuilding?.home_user_guide_url && (
            <a className="secondary min-h-9 px-3 py-1.5 text-sm" href={selectedBuilding.home_user_guide_url} target="_blank" rel="noreferrer">Home user guide</a>
          )}
        </div>
      </section>
      <div className="grid gap-5 lg:grid-cols-[360px_minmax(0,1fr)]">
        <div className="grid gap-5 content-start">
          <FormPanel title="Add defect">
            <select className="field" value={areaId} onChange={(event) => setAreaId(event.target.value)}>
              <option value="">Room / area</option>
              {selectedUnitAreas.map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}
            </select>
            <input className="field" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={50} placeholder="Title" disabled={!selectedUnit} />
            <textarea className="field min-h-24 py-3" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Description" disabled={!selectedUnit} />
            <PhotoInput value={photo} onChange={setPhoto} disabled={!selectedUnit} />
            <button className="primary" onClick={createDefect} disabled={!selectedUnit || !title || !photo}>Submit defect</button>
          </FormPanel>
          <FormPanel title="Meter reading">
            <select className="field" value={meterType} onChange={(event) => setMeterType(event.target.value as "water" | "electricity")} disabled={!selectedUnit}>
              <option value="water">Water</option>
              <option value="electricity">Electricity</option>
            </select>
            <input className="field" value={meterReading} onChange={(event) => setMeterReading(event.target.value)} placeholder="Reading" inputMode="decimal" disabled={!selectedUnit} />
            <PhotoInput value={meterPhoto} onChange={setMeterPhoto} disabled={!selectedUnit} />
            <button className="primary" onClick={createMeterReading} disabled={!selectedUnit || !meterReading || !meterPhoto}>Submit reading</button>
          </FormPanel>
        </div>
        <div className="grid gap-5 content-start">
          <section className="rounded-md border border-[#d9ded6] bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">Defects</h2>
              <div className="grid gap-2 sm:grid-cols-2">
                <select className={`field min-w-40 ${defectStatusFilter ? "filter-active" : ""}`} value={defectStatusFilter} onChange={(event) => setDefectStatusFilter(event.target.value)}>
                  <option value="">All statuses</option>
                  {["submitted", "accepted", "needs_more_info", "resolved_by_contractor", "closed", "rejected"].map((status) => (
                    <option key={status} value={status}>{statusLabel(status)}</option>
                  ))}
                </select>
                <select className={`field min-w-40 ${defectPriorityFilter ? "filter-active" : ""}`} value={defectPriorityFilter} onChange={(event) => setDefectPriorityFilter(event.target.value)}>
                  <option value="">All priorities</option>
                  <option value="P1">P1</option>
                  <option value="P2">P2</option>
                  <option value="P3">P3</option>
                </select>
              </div>
            </div>
          </section>
          <SnagList
            title="Defect list"
            buildings={buildings}
            snags={filteredDefects}
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
          <section className="rounded-md border border-[#d9ded6] bg-white p-4">
            <h2 className="text-lg font-semibold">Meter readings</h2>
            <div className="mt-3 divide-y divide-[#e5e9e4]">
              {selectedMeterReadings.map((reading) => (
                <div key={reading.id} className="grid gap-2 py-3 sm:grid-cols-[1fr_auto] sm:items-center">
                  <div>
                    <p className="font-medium">{statusLabel(reading.meter_type)}: {reading.reading_value}</p>
                    <p className="text-sm text-[#617169]">{formatDateTime(reading.created_at)}</p>
                  </div>
                  <button
                    className="secondary min-h-9 px-3 py-1.5 text-sm"
                    onClick={() => {
                      if (reading.photo_url) window.open(reading.photo_url, "_blank", "noopener,noreferrer");
                    }}
                    disabled={!reading.photo_url}
                  >
                    View photo
                  </button>
                </div>
              ))}
              {selectedMeterReadings.length === 0 && <p className="py-3 text-sm text-[#617169]">No meter readings yet.</p>}
            </div>
          </section>
        </div>
      </div>
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

function SummaryTile({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md border border-[#d9ded6] bg-[#f8faf7] p-3">
      <p className="text-xs font-semibold uppercase text-[#617169]">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-[#0F3D31]">{value}</p>
    </div>
  );
}

function HandoverAndMeters({
  user,
  buildings,
  units,
  handovers,
  handoverKeyItems,
  handoverPhotos,
  meterReadings,
  onNotice,
  recordAudit,
  reload,
  uploadFile,
}: {
  user: User;
  buildings: Building[];
  units: Unit[];
  handovers: Handover[];
  handoverKeyItems: HandoverKeyItem[];
  handoverPhotos: HandoverPhoto[];
  meterReadings: MeterReading[];
  onNotice: (notice: string) => void;
  recordAudit: (event: Omit<AuditEvent, "id" | "created_at" | "created_by_user_id">) => Promise<void>;
  reload: () => Promise<void>;
  uploadFile: (dataUrl: string, folder: string) => Promise<string>;
}) {
  const [buildingId, setBuildingId] = useState(buildings[0]?.id ?? "");
  const buildingUnits = units.filter((unit) => unit.building_id === buildingId).sort((a, b) => a.unit_number.localeCompare(b.unit_number, undefined, { numeric: true }));
  const [unitId, setUnitId] = useState(buildingUnits[0]?.id ?? "");
  const selectedUnit = units.find((unit) => unit.id === unitId);
  const selectedBuilding = buildings.find((building) => building.id === selectedUnit?.building_id);
  const existingHandover = handovers.find((handover) => handover.unit_id === unitId);
  const selectedHandoverKeys = handoverKeyItems.filter((item) => item.handover_id === existingHandover?.id);
  const selectedHandoverPhotos = handoverPhotos.filter((photo) => photo.handover_id === existingHandover?.id);
  const selectedMeterReadings = meterReadings.filter((reading) => reading.handover_id === existingHandover?.id || (!existingHandover && reading.unit_id === unitId));
  const [step, setStep] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [recipientName, setRecipientName] = useState("");
  const [recipientEmail, setRecipientEmail] = useState("");
  const [recipientPhone, setRecipientPhone] = useState("");
  const [relationship, setRelationship] = useState("Buyer");
  const [relationshipOther, setRelationshipOther] = useState("");
  const [keyItems, setKeyItems] = useState<Array<{ key_type: string; quantity: number; notes: string }>>([{ key_type: "Front Door Key", quantity: 2, notes: "" }]);
  const [keyPhoto, setKeyPhoto] = useState("");
  const [electricityReading, setElectricityReading] = useState("");
  const [electricityPhoto, setElectricityPhoto] = useState("");
  const [waterReading, setWaterReading] = useState("");
  const [waterPhoto, setWaterPhoto] = useState("");
  const [meterNotes, setMeterNotes] = useState("");
  const [signature, setSignature] = useState("");
  const [handoverDateTime, setHandoverDateTime] = useState(() => new Date().toISOString().slice(0, 16));
  const handoverAllowed = selectedUnit?.sale_status === "completed" && !existingHandover;
  const currentStatus = selectedUnit ? statusLabel(selectedUnit.sale_status) : "Unknown";
  const steps = ["Recipient", "Keys", "Meters", "Signature", "Review"];
  const totalKeys = keyItems.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);

  useEffect(() => {
    const nextUnits = units.filter((unit) => unit.building_id === buildingId).sort((a, b) => a.unit_number.localeCompare(b.unit_number, undefined, { numeric: true }));
    if (nextUnits.length > 0 && !nextUnits.some((unit) => unit.id === unitId)) {
      setUnitId(nextUnits[0].id);
    }
  }, [buildingId, unitId, units]);

  function resetDraft() {
    setStep(0);
    setRecipientName("");
    setRecipientEmail("");
    setRecipientPhone("");
    setRelationship("Buyer");
    setRelationshipOther("");
    setKeyItems([{ key_type: "Front Door Key", quantity: 2, notes: "" }]);
    setKeyPhoto("");
    setElectricityReading("");
    setElectricityPhoto("");
    setWaterReading("");
    setWaterPhoto("");
    setMeterNotes("");
    setSignature("");
    setHandoverDateTime(new Date().toISOString().slice(0, 16));
  }

  function stepIsValid(targetStep = step): boolean {
    if (!handoverAllowed) return false;
    if (targetStep === 0) return Boolean(recipientName.trim() && recipientEmail.trim() && recipientPhone.trim() && relationship && (relationship !== "Other" || relationshipOther.trim()));
    if (targetStep === 1) return keyItems.some((item) => item.key_type.trim() && Number(item.quantity) > 0) && Boolean(keyPhoto);
    if (targetStep === 2) return Boolean(electricityReading.trim() && electricityPhoto && waterReading.trim() && waterPhoto);
    if (targetStep === 3) return Boolean(signature && handoverDateTime);
    return [0, 1, 2, 3].every((index) => stepIsValid(index));
  }

  function updateKeyItem(index: number, patch: Partial<{ key_type: string; quantity: number; notes: string }>) {
    setKeyItems((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
  }

  async function submitHandover() {
    if (!selectedUnit || !stepIsValid(4)) return;
    setIsSubmitting(true);
    const supabase = createSupabaseBrowserClient();
    try {
      const [keyPhotoUrl, electricityPhotoUrl, waterPhotoUrl, signatureUrl] = await Promise.all([
        uploadFile(keyPhoto, "handover-keys"),
        uploadFile(electricityPhoto, "meter-readings"),
        uploadFile(waterPhoto, "meter-readings"),
        uploadFile(signature, "handover-signatures"),
      ]);
      const { data: handover, error: handoverError } = await supabase.from("handovers").insert({
        unit_id: selectedUnit.id,
        handover_by_user_id: user.id,
        recipient_name: recipientName.trim(),
        recipient_email: recipientEmail.trim(),
        recipient_phone: recipientPhone.trim(),
        recipient_capacity: relationship === "Other" ? relationshipOther.trim() : relationship,
        recipient_relationship: relationship,
        recipient_relationship_other: relationship === "Other" ? relationshipOther.trim() : null,
        number_of_keys: totalKeys,
        signature_url: signatureUrl,
        handover_date: handoverDateTime.slice(0, 10),
        handover_datetime: new Date(handoverDateTime).toISOString(),
        declaration_accepted: true,
        notes: meterNotes.trim() || null,
      }).select("*").single();
      if (handoverError) throw handoverError;
      const handoverId = (handover as Handover).id;
      const keyRows = keyItems.filter((item) => item.key_type.trim() && Number(item.quantity) > 0).map((item, index) => ({
        handover_id: handoverId,
        key_type: item.key_type.trim(),
        quantity: Number(item.quantity),
        notes: item.notes.trim() || null,
        sort_order: index,
      }));
      const { error: keysError } = await supabase.from("handover_key_items").insert(keyRows);
      if (keysError) throw keysError;
      const { error: photoError } = await supabase.from("handover_photos").insert({
        handover_id: handoverId,
        file_url: keyPhotoUrl,
        photo_type: "keys",
        caption: "Keys and fobs handed over",
        uploaded_by_user_id: user.id,
      });
      if (photoError) throw photoError;
      const { error: meterError } = await supabase.from("meter_readings").insert([
        {
          building_id: selectedUnit.building_id,
          unit_id: selectedUnit.id,
          handover_id: handoverId,
          meter_type: "electricity",
          reading_value: electricityReading.trim(),
          reading_date: handoverDateTime.slice(0, 10),
          photo_url: electricityPhotoUrl,
          created_by_user_id: user.id,
          notes: meterNotes.trim() || null,
        },
        {
          building_id: selectedUnit.building_id,
          unit_id: selectedUnit.id,
          handover_id: handoverId,
          meter_type: "water",
          reading_value: waterReading.trim(),
          reading_date: handoverDateTime.slice(0, 10),
          photo_url: waterPhotoUrl,
          created_by_user_id: user.id,
          notes: meterNotes.trim() || null,
        },
      ]);
      if (meterError) throw meterError;
      await recordAudit({
        event_type: "handover_completed",
        entity_type: "unit",
        entity_id: selectedUnit.id,
        summary: `Handover completed for unit ${selectedUnit.unit_number}`,
        metadata: { unit_number: selectedUnit.unit_number, building: selectedBuilding?.name, recipient_relationship: relationship, total_keys: totalKeys },
      });
      onNotice(`Handover completed for unit ${selectedUnit.unit_number}.`);
      resetDraft();
      await reload();
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Unable to complete handover.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="grid gap-5">
      <section className="panel">
        <SectionHeader title="Flat handover" subtitle="Create a permanent record for keys, meters and recipient signature." />
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <label className="field-label">
            Building
            <select className="field" value={buildingId} onChange={(event) => setBuildingId(event.target.value)}>
              {buildings.map((building) => <option key={building.id} value={building.id}>{building.name}</option>)}
            </select>
          </label>
          <label className="field-label">
            Unit
            <select className="field" value={unitId} onChange={(event) => setUnitId(event.target.value)}>
              {buildingUnits.map((unit) => <option key={unit.id} value={unit.id}>{unit.unit_number} - {statusLabel(unit.sale_status)}</option>)}
            </select>
          </label>
        </div>
        {selectedUnit && !handoverAllowed && !existingHandover && (
          <div className="mt-4 rounded-xl border border-[#D6A23A] bg-[#fff8e7] p-4 text-sm text-[#5c4a1f]">
            Handover unavailable. This flat is currently marked as {currentStatus}. Handover can only take place once the flat is marked Completed.
          </div>
        )}
        {existingHandover && (
          <div className="mt-4 rounded-xl border border-[#d9ded6] bg-[#f8faf7] p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-bold text-[#0F3D2E]">Handover completed</p>
                <p className="text-sm text-[#617169]">{formatDateTime(existingHandover.handover_datetime ?? existingHandover.created_at ?? existingHandover.handover_date)}</p>
              </div>
              <span className={statusTone("closed")}>Handed Over</span>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <SummaryTile label="Recipient" value={existingHandover.recipient_name} />
              <SummaryTile label="Keys/fobs" value={selectedHandoverKeys.reduce((sum, item) => sum + item.quantity, 0) || existingHandover.number_of_keys} />
              <SummaryTile label="Meter readings" value={selectedMeterReadings.length} />
              <SummaryTile label="Photos" value={selectedHandoverPhotos.length + selectedMeterReadings.filter((reading) => reading.photo_url).length + (existingHandover.signature_url ? 1 : 0)} />
            </div>
          </div>
        )}
      </section>

      <section className={`panel ${!handoverAllowed ? "opacity-70" : ""}`}>
        <div className="handover-steps">
          {steps.map((label, index) => (
            <button key={label} className={`handover-step ${step === index ? "handover-step-active" : ""} ${stepIsValid(index) ? "handover-step-complete" : ""}`} onClick={() => setStep(index)} disabled={!handoverAllowed}>
              <span>{index + 1}</span>
              {label}
            </button>
          ))}
        </div>

        <div className="mt-5">
          {step === 0 && (
            <div className="grid gap-4">
              <SectionHeader title="Recipient details" subtitle="Who is receiving the flat today?" />
              <div className="grid gap-3 md:grid-cols-2">
                <label className="field-label">Full name<input className="field" value={recipientName} onChange={(event) => setRecipientName(event.target.value)} disabled={!handoverAllowed} /></label>
                <label className="field-label">Email address<input className="field" value={recipientEmail} onChange={(event) => setRecipientEmail(event.target.value)} disabled={!handoverAllowed} type="email" /></label>
                <label className="field-label">Phone number<input className="field" value={recipientPhone} onChange={(event) => setRecipientPhone(event.target.value)} disabled={!handoverAllowed} /></label>
                <label className="field-label">Relationship to flat
                  <select className="field" value={relationship} onChange={(event) => setRelationship(event.target.value)} disabled={!handoverAllowed}>
                    {["Buyer", "Tenant", "Family Member", "Letting Agent", "Other"].map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                </label>
                {relationship === "Other" && <label className="field-label md:col-span-2">Relationship details<input className="field" value={relationshipOther} onChange={(event) => setRelationshipOther(event.target.value)} disabled={!handoverAllowed} /></label>}
              </div>
            </div>
          )}
          {step === 1 && (
            <div className="grid gap-4">
              <SectionHeader title="Keys and fobs" subtitle="Record every item handed over, then photograph the set." />
              <div className="grid gap-3">
                {keyItems.map((item, index) => (
                  <div key={index} className="grid gap-2 rounded-xl border border-[#E2DED3] bg-[#FBFAF6] p-3 md:grid-cols-[1.4fr_110px_1fr_auto]">
                    <select className="field" value={item.key_type} onChange={(event) => updateKeyItem(index, { key_type: event.target.value })} disabled={!handoverAllowed}>
                      {["Front Door Key", "Post Box Key", "Window Key", "Meter Cupboard Key", "Communal Entrance Fob", "Parking Fob", "Other"].map((option) => <option key={option} value={option}>{option}</option>)}
                    </select>
                    <input className="field" type="number" min={1} value={item.quantity} onChange={(event) => updateKeyItem(index, { quantity: Number(event.target.value) })} disabled={!handoverAllowed} />
                    <input className="field" value={item.notes} onChange={(event) => updateKeyItem(index, { notes: event.target.value })} placeholder="Optional notes" disabled={!handoverAllowed} />
                    <button className="secondary px-3" onClick={() => setKeyItems((current) => current.filter((_, itemIndex) => itemIndex !== index))} disabled={!handoverAllowed || keyItems.length === 1}>Remove</button>
                  </div>
                ))}
              </div>
              <button className="secondary w-fit" onClick={() => setKeyItems((current) => [...current, { key_type: "Other", quantity: 1, notes: "" }])} disabled={!handoverAllowed}>Add key/fob</button>
              <PhotoInput value={keyPhoto} onChange={setKeyPhoto} disabled={!handoverAllowed} />
            </div>
          )}
          {step === 2 && (
            <div className="grid gap-4">
              <SectionHeader title="Meter readings" subtitle="Electricity and water readings need a value and photograph." />
              <div className="grid gap-4 md:grid-cols-2">
                <div className="grid gap-3 rounded-xl border border-[#E2DED3] bg-[#FBFAF6] p-3">
                  <label className="field-label">Electricity reading<input className="field" value={electricityReading} onChange={(event) => setElectricityReading(event.target.value)} disabled={!handoverAllowed} /></label>
                  <PhotoInput value={electricityPhoto} onChange={setElectricityPhoto} disabled={!handoverAllowed} />
                </div>
                <div className="grid gap-3 rounded-xl border border-[#E2DED3] bg-[#FBFAF6] p-3">
                  <label className="field-label">Water reading<input className="field" value={waterReading} onChange={(event) => setWaterReading(event.target.value)} disabled={!handoverAllowed} /></label>
                  <PhotoInput value={waterPhoto} onChange={setWaterPhoto} disabled={!handoverAllowed} />
                </div>
              </div>
              <label className="field-label">Meter notes<input className="field" value={meterNotes} onChange={(event) => setMeterNotes(event.target.value)} placeholder="Optional notes if a meter is difficult to access" disabled={!handoverAllowed} /></label>
            </div>
          )}
          {step === 3 && (
            <div className="grid gap-4">
              <SectionHeader title="Declaration and signature" subtitle="The recipient confirms receipt and responsibility from the handover time." />
              <div className="rounded-xl border border-[#E2DED3] bg-[#FBFAF6] p-4 text-sm text-[#34413a]">
                The listed keys/fobs have been received. The meter readings recorded are correct to the best of the recipient's knowledge. The recipient accepts responsibility for the property from the handover date.
              </div>
              <label className="field-label">Handover date/time<input className="field" type="datetime-local" value={handoverDateTime} onChange={(event) => setHandoverDateTime(event.target.value)} disabled={!handoverAllowed} /></label>
              <SignaturePad value={signature} onChange={setSignature} disabled={!handoverAllowed} />
            </div>
          )}
          {step === 4 && (
            <div className="grid gap-4">
              <SectionHeader title="Review and submit" subtitle="Check the record before creating the permanent handover." />
              <div className="grid gap-3 md:grid-cols-2">
                <SummaryTile label="Building" value={selectedBuilding?.name ?? "-"} />
                <SummaryTile label="Unit" value={selectedUnit?.unit_number ?? "-"} />
                <SummaryTile label="Recipient" value={recipientName || "-"} />
                <SummaryTile label="Relationship" value={relationship === "Other" ? relationshipOther : relationship} />
                <SummaryTile label="Keys/fobs" value={totalKeys} />
                <SummaryTile label="Meters" value="Electricity and water" />
              </div>
            </div>
          )}
        </div>

        <div className="sticky-actions mt-5">
          <button className="secondary" onClick={() => setStep((current) => Math.max(0, current - 1))} disabled={step === 0 || !handoverAllowed}>Back</button>
          {step < steps.length - 1 ? (
            <button className="primary" onClick={() => setStep((current) => Math.min(steps.length - 1, current + 1))} disabled={!stepIsValid(step)}>Next</button>
          ) : (
            <button className="primary" onClick={submitHandover} disabled={!stepIsValid(4) || isSubmitting}>{isSubmitting ? "Submitting..." : "Complete handover"}</button>
          )}
        </div>
      </section>
    </div>
  );
}

function SignaturePad({ value, onChange, disabled = false }: { value: string; onChange: (value: string) => void; disabled?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [drawing, setDrawing] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = "#0F3D2E";
    context.lineWidth = 3;
    context.lineCap = "round";
  }, []);

  function point(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height,
    };
  }

  function start(event: React.PointerEvent<HTMLCanvasElement>) {
    if (disabled) return;
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    const { x, y } = point(event);
    context.beginPath();
    context.moveTo(x, y);
    setDrawing(true);
    canvas.setPointerCapture(event.pointerId);
  }

  function move(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing || disabled) return;
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    const { x, y } = point(event);
    context.lineTo(x, y);
    context.stroke();
    onChange(canvas.toDataURL("image/jpeg", 0.9));
  }

  function clear() {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = "#0F3D2E";
    context.lineWidth = 3;
    context.lineCap = "round";
    onChange("");
  }

  return (
    <div className="grid gap-2">
      <div className="signature-pad">
        <canvas
          ref={canvasRef}
          width={720}
          height={260}
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={() => setDrawing(false)}
          onPointerCancel={() => setDrawing(false)}
        />
      </div>
      <button className="secondary w-fit" onClick={clear} disabled={disabled}>Clear signature</button>
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
    <section className="panel p-0">
      <div className="border-b border-[#d9ded6] px-4 py-3">
        {title && <h2 className="text-lg font-bold text-[#0F3D2E]">{title}</h2>}
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
      <div className="bg-[#f1f4ef] p-3">
        {filtered.length > 0 && <div className="mb-3">{PaginationControls}</div>}
        <div className="grid gap-3 md:hidden">
          {pagedSnags.map((snag) => {
            const unit = units.find((item) => item.id === snag.unit_id);
            const area = areas.find((item) => item.id === snag.area_id);
            const trade = trades.find((item) => item.id === snag.trade_id);
            const photo = photos.find((item) => item.snag_id === snag.id && item.file_url);
            const rowActions = actions?.(snag);

            return (
              <article key={snag.id} className="mobile-card">
                <div className="grid grid-cols-[minmax(0,1fr)_72px] gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-base font-bold text-[#1F2A24]">{snag.title}</p>
                    <p className="mt-1 text-sm text-[#66736B]">{unit?.unit_number ? `Unit ${unit.unit_number}` : "Communal"} / {area?.name ?? "No area"}</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <span className={statusTone(snag.status)}>{statusLabel(snag.status)}</span>
                      {snag.priority_code && <span className={statusTone(snag.priority_code)}>{snag.priority_code}</span>}
                    </div>
                  </div>
                  <div className="h-16 w-16 justify-self-end overflow-hidden rounded-xl border border-[#E2DED3] bg-[#FBFAF6]">
                    {photo?.file_url ? (
                      <button className="block h-full w-full cursor-pointer" onClick={() => setPreviewPhoto(photo)}>
                        <img src={photo.file_url} alt="" className="h-full w-full object-cover" />
                      </button>
                    ) : (
                      <div className="grid h-full place-items-center text-xs text-[#9aa59f]">No photo</div>
                    )}
                  </div>
                </div>
                <div className="mt-3 grid gap-2 text-sm">
                  <div className="flex justify-between gap-3">
                    <span className="text-[#66736B]">Trade</span>
                    <span className="font-medium">{tradeControl ? tradeControl(snag, trade) : trade?.name ?? "No trade"}</span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-[#66736B]">Date</span>
                    <span className="font-medium">{formatDate(snag.created_at)}</span>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap justify-end gap-2 border-t border-[#E2DED3] pt-3">
                  {rowActions}
                  <button className="secondary min-h-9 px-3 py-1.5 text-sm" onClick={() => setSelectedSnagId(snag.id)}>Details</button>
                </div>
              </article>
            );
          })}
          {filtered.length === 0 && <p className="mobile-empty">No records to show.</p>}
        </div>
        <div className="hidden overflow-x-auto md:block">
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
    <section className="panel">
      <h2 className="text-lg font-bold text-[#0F3D2E]">{title}</h2>
      <div className="mt-4 grid gap-3">{children}</div>
    </section>
  );
}

function PhotoInput({ value, onChange, disabled = false }: { value: string; onChange: (value: string) => void; disabled?: boolean }) {
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
    if (!file || disabled) return;
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
      <label className={`camera-action ${disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}>
        <Camera size={18} aria-hidden />
        Add or take photo
        <input
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          disabled={disabled}
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
              if (disabled) return;
              event.currentTarget.setPointerCapture(event.pointerId);
              setDrawing(true);
              setStrokes((current) => [...current, [point(event)]]);
            }}
            onPointerMove={(event) => {
              if (!drawing || disabled) return;
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
            <button className="secondary" onClick={() => setStrokes((current) => current.slice(0, -1))} disabled={disabled}>Undo</button>
            <button className="secondary" onClick={() => setStrokes([])} disabled={disabled}>Clear</button>
            <button
              className="secondary"
              disabled={disabled}
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
