"use client";

import { Building2, Camera, CheckCircle2, ChevronDown, ChevronRight, ChevronUp, CircleHelp, ClipboardCheck, ClipboardList, Download, Home, LogIn, Menu, Pencil, Plus, RefreshCw, Shield, Trash2, X } from "lucide-react";
import { jsPDF } from "jspdf";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent } from "react";
import type { User } from "@supabase/supabase-js";
import { snagResultsSummary } from "@/lib/snag-pagination";
import {
  buildingAllowsFlatHandover,
  buildingAllowsResidentRoutineSnags,
  closingNoticeStartDate,
  dateOnly,
  derivedBuildingLifecycleStatus,
  expectedPcDate,
  hasPassedExpectedPcWarning,
  initialDefectsReportingEndDate,
  lifecycleEffectSummary,
  lifecycleLabel,
  pcConfirmationError,
} from "@/lib/building-lifecycle";
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
  phone: string | null;
  role: AppRole;
  resident_type: ResidentType | null;
  organisation_id: string | null;
  active?: boolean | null;
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

type FlatAccessDraft = {
  id: string;
  buildingId: string;
  unitId: string;
};

type AccessRequestUnit = {
  building_id: string;
  building_name: string;
  unit_id: string;
  unit_number: string;
  floor: string | null;
};

type ResidentAccessRequest = {
  id: string;
  full_name: string;
  email: string;
  phone: string;
  resident_type: ResidentType;
  requested_units: AccessRequestUnit[];
  notes: string | null;
  status: "pending" | "approved" | "rejected";
  admin_notes: string | null;
  reviewed_by_user_id: string | null;
  reviewed_at: string | null;
  created_at: string;
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

type Tab = "dashboard" | "snags" | "units" | "setup_buildings" | "setup_people" | "setup_activity" | "resident_home" | "resident_snags" | "resident_help";
type PrimaryNavKey = "dashboard" | "snags" | "units" | "setup" | "resident_home" | "resident_snags" | "resident_help";

type PortalScreenDefinition = {
  label: string;
  roles: AppRole[];
  section: "internal" | "setup" | "resident";
};

type SnagQuickFilter =
  | "overdue"
  | "due_soon"
  | "recent"
  | "created_today"
  | "resolved_today"
  | "closed_today"
  | "rejected_today"
  | "more_info_today"
  | "info_supplied"
  | "info_supplied_today";

type SnagListFilters = {
  buildingId?: string;
  unitFilter?: string;
  statusFilter?: string;
  tradeFilter?: string;
  quickFilter?: SnagQuickFilter;
};

type AuthRedirectState = {
  type: "invite" | "recovery";
  error?: string;
  description?: string;
};

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
const adminEditableUnitSaleStatuses = unitSaleStatuses.filter((status) => status.value !== "handed_over");

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

const portalScreens: Record<Tab, PortalScreenDefinition> = {
  dashboard: {
    label: "Dashboard",
    roles: ["admin", "developer", "developer_representative", "contractor"],
    section: "internal",
  },
  snags: {
    label: "Snags",
    roles: ["admin", "developer", "developer_representative", "contractor"],
    section: "internal",
  },
  units: {
    label: "Units",
    roles: ["admin", "developer", "developer_representative"],
    section: "internal",
  },
  setup_buildings: {
    label: "Buildings",
    roles: ["admin", "developer"],
    section: "setup",
  },
  setup_people: {
    label: "People & access",
    roles: ["admin", "developer"],
    section: "setup",
  },
  setup_activity: {
    label: "Activity log",
    roles: ["admin", "developer"],
    section: "setup",
  },
  resident_home: {
    label: "My home",
    roles: ["resident"],
    section: "resident",
  },
  resident_snags: {
    label: "Snags",
    roles: ["resident"],
    section: "resident",
  },
  resident_help: {
    label: "Documents",
    roles: ["resident"],
    section: "resident",
  },
};

const legacyScreenAliases: Record<string, Tab> = {
  admin: "setup_buildings",
  buildings: "setup_buildings",
  setup: "setup_buildings",
  users: "setup_people",
  people: "setup_people",
  people_access: "setup_people",
  audit: "setup_activity",
  activity: "setup_activity",
  activity_log: "setup_activity",
  add_snag: "snags",
  reports: "snags",
  handover: "units",
  leaseholder: "resident_home",
  resident: "resident_home",
  my_home: "resident_home",
  my_snags: "resident_snags",
  snags: "resident_snags",
  documents: "resident_help",
  home_documents: "resident_help",
};

const brand = {
  green: "#0F3D31",
  gold: "#D4A645",
  background: "#f7f8f5",
  border: "#d8ded8",
  muted: "#617169",
};

async function fetchAllAreas(supabase: ReturnType<typeof createSupabaseBrowserClient>) {
  const pageSize = 1000;
  const rows: Area[] = [];

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("areas")
      .select("*")
      .order("sort_order")
      .order("id")
      .range(from, from + pageSize - 1);

    if (error) return { data: null, error };

    rows.push(...((data ?? []) as Area[]));
    if ((data ?? []).length < pageSize) return { data: rows, error: null };
  }
}

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

function normalizeScreen(value?: string | null): Tab | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase().replace(/-/g, "_");
  if (normalized in portalScreens) return normalized as Tab;
  return legacyScreenAliases[normalized] ?? null;
}

function screenFromUrl() {
  if (typeof window === "undefined") return null;
  return normalizeScreen(new URLSearchParams(window.location.search).get("screen"));
}

function writeScreenToUrl(tab: Tab, replace = false) {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams(window.location.search);
  params.set("screen", tab);
  const query = params.toString();
  const nextUrl = `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`;
  if (replace) window.history.replaceState(null, "", nextUrl);
  else window.history.pushState(null, "", nextUrl);
}

function clearScreenFromUrl() {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams(window.location.search);
  params.delete("screen");
  const query = params.toString();
  const nextUrl = `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`;
  window.history.replaceState(null, "", nextUrl);
}

function canAccessScreen(role: AppRole, tab: Tab) {
  return portalScreens[tab].roles.includes(role);
}

function roleTabs(role: AppRole): Tab[] {
  return (Object.keys(portalScreens) as Tab[]).filter((tab) => canAccessScreen(role, tab));
}

function defaultTabForRole(role: AppRole): Tab {
  if (role === "resident") return "resident_home";
  if (role === "contractor") return "snags";
  return roleTabs(role)[0] ?? "dashboard";
}

function tabLabel(tab: Tab) {
  return portalScreens[tab].label;
}

function setupTabsForRole(role: AppRole) {
  return roleTabs(role).filter((tab) => portalScreens[tab].section === "setup");
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
    admin: "Admin",
    developer: "Developer",
    developer_representative: "Developer Representative",
    contractor: "Contractor",
    resident: "Resident",
    leaseholder: "Leaseholder",
    tenant: "Tenant",
    letting_agent: "Letting Agent",
    managing_agent: "Managing Agent",
    pre_pc: "Pre-PC",
    dlp_active: "DLP active",
    dlp_closing: "Closing soon",
    post_dlp_readonly: "Post-DLP read-only",
    archived: "Archived",
    electricity: "Electricity",
    water: "Water",
    Open: "Open",
    Resolved: "Resolved",
  };

  return labels[status] ?? status
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function residentSnagStatusLabel(status: string) {
  const labels: Record<string, string> = {
    open: "Reported",
    submitted: "Reported",
    accepted: "Being reviewed",
    assigned_to_contractor: "In progress",
    in_progress: "In progress",
    needs_more_info: "Waiting for you",
    resolved_by_contractor: "Resolved",
    rejected_back_to_contractor: "Follow-up sent",
    resolved: "Resolved",
    closed: "Closed",
    rejected: "Closed",
  };

  return labels[status] ?? statusLabel(status);
}

function snagListStatusLabel(status: string) {
  const labels: Record<string, string> = {
    needs_more_info: "More info",
    rejected_back_to_contractor: "Rejected back",
    resolved_by_contractor: "Resolved",
  };

  return labels[status] ?? statusLabel(status);
}

function residentSnagIsOpen(snag: ProductionSnag) {
  return !["closed", "resolved", "rejected"].includes(snag.status);
}

function residentSnagIsResolved(snag: ProductionSnag) {
  return ["closed", "resolved", "resolved_by_contractor"].includes(snag.status);
}

function photoCreatedTime(photo: SnagPhoto) {
  const time = new Date(photo.created_at).getTime();
  return Number.isNaN(time) ? 0 : time;
}

function primarySnagPhoto(photos: SnagPhoto[]) {
  const usablePhotos = photos.filter((photo) => photo.file_url);
  const originalPhotos = usablePhotos.filter((photo) => photo.photo_type === "original" || photo.photo_type === "annotated");
  const candidates = originalPhotos.length > 0 ? originalPhotos : usablePhotos;

  return [...candidates].sort((a, b) => photoCreatedTime(a) - photoCreatedTime(b))[0];
}

function supabaseStorageThumbnailUrl(fileUrl: string, width: number, height: number) {
  try {
    const url = new URL(fileUrl);
    const publicPath = "/storage/v1/object/public/";
    const signedPath = "/storage/v1/object/sign/";
    if (url.pathname.includes(publicPath)) {
      url.pathname = url.pathname.replace(publicPath, "/storage/v1/render/image/public/");
    } else if (url.pathname.includes(signedPath)) {
      url.pathname = url.pathname.replace(signedPath, "/storage/v1/render/image/sign/");
    } else {
      return "";
    }
    url.searchParams.set("width", String(width));
    url.searchParams.set("height", String(height));
    url.searchParams.set("resize", "cover");
    url.searchParams.set("quality", "70");
    return url.toString();
  } catch {
    return "";
  }
}

function readableError(error: unknown, fallback = "Please try again or contact support.") {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "object" && error && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }

  return fallback;
}

function buildingSchemaNotice(message: string) {
  const lowerMessage = message.toLowerCase();
  const missingBuildingLifecycleColumn = ["pc_confirmed", "pc_date", "allow_resident_access_requests"].some((column) => lowerMessage.includes(column));

  if (!missingBuildingLifecycleColumn) return message;

  return "The database is missing the latest building lifecycle fields. Run the building lifecycle migration in Supabase, then reload the portal.";
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

function sortUnitsByFloorOrder(units: Unit[], buildingFloors: BuildingFloor[], buildingId?: string) {
  const floorOrder = new Map(
    buildingFloors
      .filter((floor) => !buildingId || floor.building_id === buildingId)
      .map((floor, index) => [floor.name.trim().toLowerCase(), floor.sort_order ?? index]),
  );

  return [...units].sort((a, b) => {
    const aFloorOrder = floorOrder.get((a.floor ?? "").trim().toLowerCase()) ?? Number.MAX_SAFE_INTEGER;
    const bFloorOrder = floorOrder.get((b.floor ?? "").trim().toLowerCase()) ?? Number.MAX_SAFE_INTEGER;
    if (aFloorOrder !== bFloorOrder) return aFloorOrder - bFloorOrder;
    return a.unit_number.localeCompare(b.unit_number, undefined, { numeric: true });
  });
}

function sortAreasByFloorOrder(areas: Area[], buildingFloors: BuildingFloor[], buildingId?: string) {
  const floorOrder = new Map(
    buildingFloors
      .filter((floor) => !buildingId || floor.building_id === buildingId)
      .map((floor, index) => [floor.name.trim().toLowerCase(), floor.sort_order ?? index]),
  );

  return [...areas].sort((a, b) => {
    const aFloorOrder = floorOrder.get((a.floor ?? "").trim().toLowerCase()) ?? Number.MAX_SAFE_INTEGER;
    const bFloorOrder = floorOrder.get((b.floor ?? "").trim().toLowerCase()) ?? Number.MAX_SAFE_INTEGER;
    if (aFloorOrder !== bFloorOrder) return aFloorOrder - bFloorOrder;
    if ((a.sort_order ?? 0) !== (b.sort_order ?? 0)) return (a.sort_order ?? 0) - (b.sort_order ?? 0);
    return a.name.localeCompare(b.name, undefined, { numeric: true });
  });
}

function filenameSafe(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "report";
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
  if (status === "active") return "status-badge bg-[#e7f3ea] text-[#147A4D]";
  if (status === "deactivated") return "status-badge bg-[#ecefeb] text-[#66736B]";
  if (status === "pending") return "status-badge bg-[#fff4df] text-[#8a5a12]";
  if (status === "approved") return "status-badge bg-[#e7f3ea] text-[#147A4D]";
  if (["closed", "resolved", "resolved_by_contractor", "handed_over"].includes(status)) return "status-badge bg-[#e7f3ea] text-[#147A4D]";
  if (["rejected", "rejected_back_to_contractor", "needs_more_info"].includes(status)) return "status-badge bg-[#fff4df] text-[#8a5a12]";
  if (["P1", "open", "submitted"].includes(status)) return "status-badge bg-[#eef5f1] text-[#0F3D2E]";
  return "status-badge bg-[#f3f0e8] text-[#66736B]";
}

function isStaleRefreshTokenError(error: unknown) {
  if (!error || typeof error !== "object" || !("message" in error)) return false;
  const message = String(error.message).toLowerCase();
  return message.includes("refresh token") && (message.includes("not found") || message.includes("invalid"));
}

function isMissingSessionError(error: unknown) {
  if (!error || typeof error !== "object" || !("message" in error)) return false;
  return String(error.message).toLowerCase().includes("auth session missing");
}

function friendlyAuthMessage(error: unknown) {
  if (!error || typeof error !== "object" || !("message" in error)) return "Something went wrong. Please try again.";
  const message = String(error.message);
  const normalised = message.toLowerCase();

  if (normalised.includes("user is banned") || normalised.includes("banned")) {
    return "This portal account has been deactivated. Contact Bunnywell if you need access restored.";
  }

  return message;
}

function readAuthRedirectState(): AuthRedirectState | null {
  if (typeof window === "undefined" || !window.location.hash) return null;

  const params = new URLSearchParams(window.location.hash.slice(1));
  const error = params.get("error") ?? params.get("error_code");
  const description = params.get("error_description") ?? undefined;
  const type = params.get("type");

  if (error) {
    return {
      type: type === "recovery" ? "recovery" : "invite",
      error,
      description,
    };
  }

  if (type === "invite" || type === "recovery") return { type };
  return null;
}

function clearUrlHash() {
  if (typeof window === "undefined" || !window.location.hash) return;
  window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
}

function readAuthRedirectTokens() {
  if (typeof window === "undefined" || !window.location.hash) return null;

  const params = new URLSearchParams(window.location.hash.slice(1));
  const accessToken = params.get("access_token");
  const refreshToken = params.get("refresh_token");

  if (!accessToken || !refreshToken) return null;
  return { accessToken, refreshToken };
}

export function ProductionPortalApp() {
  const supabaseEnabled = isSupabaseConfigured();
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [tab, setActiveTab] = useState<Tab>(() => screenFromUrl() ?? "dashboard");
  const [snagListFilters, setSnagListFilters] = useState<SnagListFilters>({});
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
  const [accessRequests, setAccessRequests] = useState<ResidentAccessRequest[]>([]);
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
  const [authRedirect, setAuthRedirect] = useState<AuthRedirectState | null>(null);

  const role = profile?.role ?? "user";
  const tabs = roleTabs(role);
  const scopedBuildings = useMemo(() => filterBuildingsForRole(buildings, units, profile, accessibleUnitIds, accessibleBuildingIds), [accessibleBuildingIds, accessibleUnitIds, buildings, profile, units]);
  const scopedUnits = useMemo(() => filterUnitsForRole(units, profile, accessibleUnitIds, accessibleBuildingIds), [accessibleBuildingIds, accessibleUnitIds, profile, units]);
  const scopedAreas = useMemo(() => filterAreasForRole(areas, profile, scopedBuildings, scopedUnits), [areas, profile, scopedBuildings, scopedUnits]);
  const scopedHandovers = useMemo(() => filterUnitLinkedRows(handovers, scopedUnits, (handover) => handover.unit_id), [handovers, scopedUnits]);
  const scopedMeterReadings = useMemo(() => filterUnitLinkedRows(meterReadings, scopedUnits, (reading) => reading.unit_id), [meterReadings, scopedUnits]);
  const visibleSnags = useMemo(() => filterSnagsForRole(snags, profile, accessibleUnitIds, accessibleBuildingIds), [accessibleBuildingIds, accessibleUnitIds, profile, snags]);
  const residentDefects = visibleSnags.filter((snag) => snag.source_type === "leaseholder_defect");

  function setTab(nextTab: Tab, options?: { replace?: boolean }) {
    setNotice("");
    setActiveTab(nextTab);
    writeScreenToUrl(nextTab, options?.replace);
  }

  function clearPortalState() {
    setUser(null);
    setProfile(null);
    setActiveTab("dashboard");
    clearScreenFromUrl();
    setSnagListFilters({});
    setBuildings([]);
    setUnits([]);
    setAreas([]);
    setBuildingFloors([]);
    setUnitTypes([]);
    setUnitTypeAreas([]);
    setTrades([]);
    setOrganisations([]);
    setProfiles([]);
    setUserBuildingAccess([]);
    setUserUnitAccess([]);
    setAccessRequests([]);
    setSnags([]);
    setPhotos([]);
    setEvents([]);
    setAuditEvents([]);
    setHandovers([]);
    setHandoverKeyItems([]);
    setHandoverPhotos([]);
    setMeterReadings([]);
    setAccessibleUnitIds([]);
    setAccessibleBuildingIds([]);
  }

  async function signOut() {
    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.auth.signOut();
    if (error) {
      if (isStaleRefreshTokenError(error)) {
        await supabase.auth.signOut({ scope: "local" });
      } else {
        setNotice(error.message);
      }
    }
    clearPortalState();
    setNotice("");
  }

  useEffect(() => {
    if (!supabaseEnabled) {
      setNotice("Supabase is not configured. Add environment variables to use the production schema UI.");
      setIsLoading(false);
      return;
    }

    const supabase = createSupabaseBrowserClient();
    const redirectState = readAuthRedirectState();

    if (redirectState) {
      setAuthRedirect(redirectState);
      clearPortalState();

      if (redirectState.error) {
        void supabase.auth.signOut({ scope: "local" });
        clearUrlHash();
        setNotice(redirectState.description ?? "This invite link is invalid or has expired. Ask an admin to send a new invite.");
        setIsLoading(false);
        return;
      }
    }

    const redirectTokens = redirectState && !redirectState.error ? readAuthRedirectTokens() : null;
    const sessionReady = redirectTokens
      ? supabase.auth.setSession({
        access_token: redirectTokens.accessToken,
        refresh_token: redirectTokens.refreshToken,
      })
      : Promise.resolve({ error: null });

    sessionReady
      .then(async ({ error: sessionError }) => {
        if (sessionError) throw sessionError;
        return supabase.auth.getUser();
      })
      .then(async ({ data, error }) => {
        if (error) {
          if (isStaleRefreshTokenError(error)) {
            await supabase.auth.signOut({ scope: "local" });
          } else if (!isMissingSessionError(error)) {
            setNotice(error.message);
          } else {
            setNotice("");
          }
          clearPortalState();
          return;
        }

        setUser(data.user);
        if (data.user) await loadAll(data.user.id, data.user.email);
        else clearPortalState();
      })
      .catch(async (error: unknown) => {
        if (isStaleRefreshTokenError(error)) {
          await supabase.auth.signOut({ scope: "local" });
          clearPortalState();
        } else if (isMissingSessionError(error)) {
          clearPortalState();
          setNotice("");
        } else {
          setNotice(error instanceof Error ? error.message : "Could not restore session.");
        }
      })
      .finally(() => setIsLoading(false));

    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      setUser(session?.user ?? null);
      if (session?.user) {
        setNotice("");
        void loadAll(session.user.id, session.user.email);
      } else if (event === "SIGNED_OUT") {
        clearPortalState();
      }
    });

    return () => data.subscription.unsubscribe();
  }, [supabaseEnabled]);

  useEffect(() => {
    function handleRouteChange() {
      setActiveTab(screenFromUrl() ?? defaultTabForRole(role));
      setNotice("");
    }

    window.addEventListener("popstate", handleRouteChange);
    return () => window.removeEventListener("popstate", handleRouteChange);
  }, [role]);

  useEffect(() => {
    if (!profile) return;
    let timer: number | undefined;
    const requestedScreen = screenFromUrl();
    const defaultTab = defaultTabForRole(role);
    const nextTab = requestedScreen && canAccessScreen(role, requestedScreen)
      ? requestedScreen
      : canAccessScreen(role, tab)
        ? tab
        : defaultTab;

    if (requestedScreen !== nextTab || tab !== nextTab) {
      timer = window.setTimeout(() => {
        setActiveTab(nextTab);
        if (requestedScreen !== nextTab) writeScreenToUrl(nextTab, true);
        setNotice("");
      }, 0);
    }

    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [profile, role, tab]);

  useEffect(() => {
    if (!notice || notice === "Loading Bunnywell Portal...") return;
    if (notice.startsWith("Supabase is not configured") || notice.startsWith("Production schema is not ready")) return;
    const timer = window.setTimeout(() => setNotice(""), 12000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  async function loadAll(userId = user?.id, userEmail = user?.email) {
    if (!userId) return;

    const supabase = createSupabaseBrowserClient();
    const profileSelect = "id,email,name,full_name,role,resident_type,organisation_id,active,created_at";
    let profileResult = await supabase
      .from("profiles")
      .select(profileSelect)
      .eq("id", userId)
      .maybeSingle();

    if (!profileResult.data && userEmail) {
      profileResult = await supabase
        .from("profiles")
        .select(profileSelect)
        .eq("email", userEmail)
        .maybeSingle();
    }

    const loadedProfile = profileResult.data as Profile | null;

    if (loadedProfile?.active === false) {
      await supabase.auth.signOut({ scope: "local" });
      clearPortalState();
      setNotice("This portal account has been deactivated. Contact Bunnywell if you need access restored.");
      return;
    }

    const profileIdForAccess = loadedProfile?.id ?? userId;
    const [
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
      accessRequestsResult,
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
      supabase.from("buildings").select("*").order("name"),
      supabase.from("units").select("*").order("unit_number"),
      fetchAllAreas(supabase),
      supabase.from("building_floors").select("*").order("sort_order"),
      supabase.from("unit_types").select("*").order("name"),
      supabase.from("unit_type_areas").select("*").order("sort_order"),
      supabase.from("trades").select("*").order("sort_order"),
      supabase.from("organisations").select("*").order("name"),
      supabase.from("profiles").select("id,email,name,full_name,phone,role,resident_type,organisation_id,active,created_at").order("email"),
      supabase.from("user_building_access").select("user_id,building_id,role_on_building"),
      supabase.from("user_unit_access").select("user_id,unit_id,access_type"),
      supabase.from("resident_access_requests").select("*").order("created_at", { ascending: false }).limit(100),
      supabase.from("snags").select("*").order("created_at", { ascending: false }),
      supabase.from("snag_photos").select("*").order("created_at", { ascending: false }),
      supabase.from("snag_events").select("*").order("created_at", { ascending: false }),
      supabase.from("audit_events").select("*").order("created_at", { ascending: false }).limit(200),
      supabase.from("handovers").select("*").order("created_at", { ascending: false }),
      supabase.from("handover_key_items").select("*").order("sort_order"),
      supabase.from("handover_photos").select("*").order("created_at", { ascending: false }),
      supabase.from("meter_readings").select("*").order("created_at", { ascending: false }),
      supabase.from("user_unit_access").select("unit_id").eq("user_id", profileIdForAccess),
      supabase.from("user_building_access").select("building_id").eq("user_id", profileIdForAccess),
    ]);

    const firstError = [
      buildingsResult.error,
      unitsResult.error,
      areasResult.error,
      accessRequestsResult.error,
      snagsResult.error,
    ].find(Boolean);

    if (firstError) {
      setNotice(`Production schema is not ready yet: ${firstError.message}`);
    } else {
      setNotice((current) => current.startsWith("Production schema is not ready") ? "" : current);
    }

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
    setAccessRequests((accessRequestsResult.data ?? []) as ResidentAccessRequest[]);
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

  if (authRedirect && !authRedirect.error) {
    return (
      <Shell profile={null} tab={tab} tabs={[]} setTab={setTab} notice={notice}>
        <InvitePasswordPanel
          email={user?.email ?? ""}
          mode={authRedirect.type}
          onComplete={async () => {
            if (user) await loadAll(user.id, user.email);
            clearUrlHash();
            setAuthRedirect(null);
            setNotice("Password set. Welcome to Bunnywell Portal.");
          }}
          onNotice={setNotice}
        />
      </Shell>
    );
  }

  if (!user) {
    return (
      <Shell profile={null} tab={tab} tabs={[]} setTab={setTab} notice={notice}>
        <LoginPanel onNotice={setNotice} />
      </Shell>
    );
  }

  const activeTab = profile && !canAccessScreen(role, tab) ? defaultTabForRole(role) : tab;

  return (
    <Shell profile={profile} tab={activeTab} tabs={tabs} setTab={setTab} notice={notice} onRefresh={() => loadAll()} onSignOut={signOut}>
      {activeTab === "dashboard" && (
        <Dashboard
          buildings={scopedBuildings}
          events={events}
          profile={profile}
          snags={visibleSnags}
          setTab={setTab}
          setSnagFilters={setSnagListFilters}
        />
      )}
      {portalScreens[activeTab].section === "setup" && (
        <SetupSection
          activeTab={activeTab}
          setTab={setTab}
          availableTabs={setupTabsForRole(role)}
          buildings={buildings}
          units={units}
          areas={areas}
          buildingFloors={buildingFloors}
          unitTypes={unitTypes}
          unitTypeAreas={unitTypeAreas}
          organisations={organisations}
          profiles={profiles}
          accessRequests={accessRequests}
          userBuildingAccess={userBuildingAccess}
          userUnitAccess={userUnitAccess}
          auditEvents={auditEvents}
          recordAudit={recordAudit}
          onNotice={setNotice}
          reload={loadAll}
        />
      )}
      {activeTab === "snags" && (
        <SnagWorkflow
          user={user}
          profile={profile}
          buildings={scopedBuildings}
          buildingFloors={buildingFloors}
          snags={visibleSnags}
          units={scopedUnits}
          areas={scopedAreas}
          trades={trades}
          photos={photos}
          events={events}
          profiles={profiles}
          onNotice={setNotice}
          reload={loadAll}
          uploadFile={uploadFile}
          recordAudit={recordAudit}
          requestedFilters={snagListFilters}
        />
      )}
      {activeTab === "units" && (
        <UnitsSection
          user={user}
          profile={profile}
          buildings={scopedBuildings}
          buildingFloors={buildingFloors}
          units={scopedUnits}
          areas={scopedAreas}
          snags={visibleSnags}
          handovers={scopedHandovers}
          handoverKeyItems={handoverKeyItems}
          meterReadings={scopedMeterReadings}
          photos={photos}
          events={events}
          profiles={profiles}
          userUnitAccess={userUnitAccess}
          accessibleUnitIds={accessibleUnitIds}
          onNotice={setNotice}
          recordAudit={recordAudit}
          reload={loadAll}
          uploadFile={uploadFile}
        />
      )}
      {(activeTab === "resident_home" || activeTab === "resident_snags") && (
        <LeaseholderDefects
          user={user}
          profile={profile}
          buildings={scopedBuildings}
          units={scopedUnits}
          areas={scopedAreas}
          snags={residentDefects}
          handovers={scopedHandovers}
          handoverKeyItems={handoverKeyItems}
          meterReadings={scopedMeterReadings}
          photos={photos}
          events={events}
          profiles={profiles}
          accessibleUnitIds={accessibleUnitIds}
          onNotice={setNotice}
          recordAudit={recordAudit}
          reload={loadAll}
          uploadFile={uploadFile}
          onGoToSnags={() => setTab("resident_snags")}
          residentView={activeTab === "resident_home" ? "home" : "snags"}
        />
      )}
      {activeTab === "resident_help" && (
        <ResidentHelp buildings={scopedBuildings} units={scopedUnits} />
      )}
    </Shell>
  );
}

function primaryNavItemsForTabs(tabs: Tab[]): Array<{ key: PrimaryNavKey; label: string; tab: Tab; activeTabs: Tab[]; icon: React.ReactNode }> {
  const items: Array<{ key: PrimaryNavKey; label: string; tab: Tab; activeTabs: Tab[]; icon: React.ReactNode }> = [];
  const setupTabs = tabs.filter((item) => portalScreens[item].section === "setup");

  if (tabs.includes("dashboard")) items.push({ key: "dashboard", label: "Dashboard", tab: "dashboard", activeTabs: ["dashboard"], icon: <Home size={17} aria-hidden /> });
  if (tabs.includes("snags")) items.push({ key: "snags", label: "Snags", tab: "snags", activeTabs: ["snags"], icon: <ClipboardList size={17} aria-hidden /> });
  if (tabs.includes("units")) items.push({ key: "units", label: "Units", tab: "units", activeTabs: ["units"], icon: <Building2 size={17} aria-hidden /> });
  if (setupTabs.length > 0) items.push({ key: "setup", label: "Setup", tab: setupTabs[0], activeTabs: setupTabs, icon: <Building2 size={17} aria-hidden /> });
  if (tabs.includes("resident_home")) items.push({ key: "resident_home", label: "My home", tab: "resident_home", activeTabs: ["resident_home"], icon: <Home size={17} aria-hidden /> });
  if (tabs.includes("resident_snags")) items.push({ key: "resident_snags", label: "Snags", tab: "resident_snags", activeTabs: ["resident_snags"], icon: <ClipboardList size={17} aria-hidden /> });
  if (tabs.includes("resident_help")) items.push({ key: "resident_help", label: "Documents", tab: "resident_help", activeTabs: ["resident_help"], icon: <ClipboardList size={17} aria-hidden /> });

  return items;
}

function Shell({
  profile,
  tab,
  tabs,
  setTab,
  notice,
  onRefresh,
  onSignOut,
  children,
}: {
  profile: Profile | null;
  tab: Tab;
  tabs: Tab[];
  setTab: (tab: Tab) => void;
  notice?: string;
  onRefresh?: () => void;
  onSignOut?: () => Promise<void>;
  children?: React.ReactNode;
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  const navItems = primaryNavItemsForTabs(tabs);
  const mobilePrimaryItems = navItems.slice(0, 4);
  const mobileMoreItems = navItems.slice(4);
  const mobileNavItems: Array<{ tab?: Tab; label: string; icon: React.ReactNode; isMore?: boolean; activeTabs?: Tab[] }> = [
    ...mobilePrimaryItems.map((item) => ({
      tab: item.tab,
      label: item.label,
      icon: item.icon,
      activeTabs: item.activeTabs,
    })),
    ...(mobileMoreItems.length > 0 ? [{ label: "More", icon: <Menu size={20} aria-hidden />, isMore: true }] : []),
  ];
  const hasMobileMenu = Boolean(profile && (mobileNavItems.length > 0 || onRefresh || onSignOut));

  function chooseTab(nextTab: Tab) {
    setTab(nextTab);
    setMoreOpen(false);
  }

  async function handleSignOut() {
    setMoreOpen(false);
    await onSignOut?.();
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
              {onSignOut && (
                <button
                  onClick={() => void onSignOut()}
                  className="secondary min-h-10 px-3 text-sm"
                >
                  <LogIn size={16} aria-hidden />
                  Sign out
                </button>
              )}
            </div>
            {hasMobileMenu && (
              <button className="secondary min-h-10 px-3 md:hidden" onClick={() => setMoreOpen(true)} aria-label="Open menu">
                <Menu size={18} aria-hidden />
              </button>
            )}
          </div>
          {tabs.length > 0 && (
            <nav className="hidden gap-2 overflow-x-auto pb-1 md:flex">
              {navItems.map((item) => (
                <button
                  key={item.key}
                  onClick={() => chooseTab(item.tab)}
                  className={`nav-pill ${item.activeTabs.includes(tab) ? "nav-pill-active" : ""}`}
                >
                  {item.icon}
                  {item.label}
                </button>
              ))}
            </nav>
          )}
        </div>
      </header>
      {notice && (
        <div
          className={`fixed inset-x-4 bottom-24 z-50 mx-auto max-w-xl rounded-xl border px-4 py-3 text-sm font-medium shadow-[0_18px_40px_rgba(15,61,46,0.18)] md:bottom-6 ${positiveNotice(notice) ? "border-[#bcdcc7] bg-[#f0f8f3] text-[#0F3D2E]" : "border-[#e2c8a6] bg-[#fff8ec] text-[#735327]"}`}
          role="status"
          aria-live="polite"
        >
          <span className="flex items-center gap-2">
            {positiveNotice(notice) && <CheckCircle2 size={16} aria-hidden />}
            {notice}
          </span>
        </div>
      )}
      <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 md:py-7 lg:px-8">{children}</div>
      {tabs.length > 0 && (
        <nav className="mobile-bottom-nav md:hidden" aria-label="Primary mobile navigation">
          {mobileNavItems.map((item) => (
            <button
              key={item.isMore ? "more" : item.tab}
              className={`mobile-nav-item ${(!item.isMore && item.activeTabs?.includes(tab)) || (item.isMore && moreOpen) ? "mobile-nav-item-active" : ""}`}
              onClick={() => item.isMore ? setMoreOpen(true) : item.tab && chooseTab(item.tab)}
              type="button"
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
      )}
      {hasMobileMenu && moreOpen && (
        <div className="mobile-menu-backdrop md:hidden" onClick={() => setMoreOpen(false)}>
          <aside className="mobile-menu-panel" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between gap-3 border-b border-[#E2DED3] pb-3">
              <div className="min-w-0">
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#D6A23A]">Account</p>
                <p className="mt-1 truncate text-sm text-[#66736B]">{profile?.email ?? "Not signed in"}</p>
              </div>
              <button className="secondary icon-button" onClick={() => setMoreOpen(false)} aria-label="Close menu" title="Close menu">
                <X size={17} strokeWidth={2.5} aria-hidden />
              </button>
            </div>
            <div className="mt-4 grid gap-2">
              {[...mobileMoreItems, ...mobilePrimaryItems].map((item) => (
                <button key={item.key} className={`menu-row ${item.activeTabs.includes(tab) ? "menu-row-active" : ""}`} onClick={() => chooseTab(item.tab)}>
                  {item.icon}
                  <span>{item.label}</span>
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
              {onSignOut && (
                <button className="menu-row" onClick={() => void handleSignOut()}>
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

function positiveNotice(notice: string) {
  const lower = notice.toLowerCase();
  if (/(cannot|could not|error|failed|invalid|missing|unable)/.test(lower)) return false;
  return /(added|closed|completed|created|deleted|reactivated|reset|resolved|saved|sent|updated|welcome)/.test(lower);
}

function LoginPanel({ onNotice }: { onNotice: (notice: string) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  async function login() {
    onNotice("");
    const { error } = await createSupabaseBrowserClient().auth.signInWithPassword({ email: email.trim(), password });
    if (error) onNotice(friendlyAuthMessage(error));
  }

  return (
    <section className="panel mx-auto max-w-md">
      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#D6A23A]">Secure access</p>
      <h2 className="mt-1 text-2xl font-bold text-[#0F3D2E]">Sign in</h2>
      <form
        className="mt-5 space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void login();
        }}
      >
        <label className="field-label">
          Email
          <input
            autoComplete="username"
            className="field"
            name="username"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="name@example.com"
            type="email"
          />
        </label>
        <label className="field-label">
          Password
          <input
            autoComplete="current-password"
            className="field"
            name="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Password"
            type="password"
          />
        </label>
        <button type="submit" className="primary w-full">Sign in</button>
      </form>
    </section>
  );
}

function InvitePasswordPanel({
  email,
  mode,
  onComplete,
  onNotice,
}: {
  email: string;
  mode: AuthRedirectState["type"];
  onComplete: () => Promise<void>;
  onNotice: (notice: string) => void;
}) {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const passwordsMatch = password.length > 0 && password === confirmPassword;
  const canSubmit = Boolean(email) && password.length >= 8 && passwordsMatch && !isSaving;

  async function savePassword() {
    if (!canSubmit) {
      onNotice(!email ? "The invite session could not be restored. Ask an admin to send a fresh invite." : "Enter a matching password of at least 8 characters.");
      return;
    }

    setIsSaving(true);
    onNotice("");
    const { error } = await createSupabaseBrowserClient().auth.updateUser({ password });
    setIsSaving(false);

    if (error) {
      onNotice(friendlyAuthMessage(error));
      return;
    }

    await onComplete();
  }

  return (
    <section className="panel mx-auto max-w-md">
      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#D6A23A]">Secure access</p>
      <h2 className="mt-1 text-2xl font-bold text-[#0F3D2E]">{mode === "invite" ? "Set your password" : "Reset your password"}</h2>
      <p className="mt-3 text-sm text-[#66736B]">
        {email ? `Create a password for ${email}.` : "Completing your secure invite."}
      </p>
      <form
        className="mt-5 space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void savePassword();
        }}
      >
        <input
          autoComplete="username"
          className="sr-only"
          name="username"
          readOnly
          tabIndex={-1}
          type="email"
          value={email}
        />
        <label className="field-label">
          New password
          <input
            autoComplete="new-password"
            className="field"
            name="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="At least 8 characters"
            type="password"
          />
        </label>
        <label className="field-label">
          Confirm password
          <input
            autoComplete="new-password"
            className="field"
            name="confirm-new-password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            placeholder="Repeat password"
            type="password"
          />
        </label>
        <button type="submit" className="primary w-full" disabled={isSaving}>
          {isSaving ? "Saving password..." : "Set password"}
        </button>
      </form>
    </section>
  );
}

function SetupSection({
  activeTab,
  availableTabs,
  setTab,
  buildings,
  units,
  areas,
  buildingFloors,
  unitTypes,
  unitTypeAreas,
  organisations,
  profiles,
  accessRequests,
  userBuildingAccess,
  userUnitAccess,
  auditEvents,
  recordAudit,
  onNotice,
  reload,
}: {
  activeTab: Tab;
  availableTabs: Tab[];
  setTab: (tab: Tab) => void;
  buildings: Building[];
  units: Unit[];
  areas: Area[];
  buildingFloors: BuildingFloor[];
  unitTypes: UnitType[];
  unitTypeAreas: UnitTypeArea[];
  organisations: Organisation[];
  profiles: Profile[];
  accessRequests: ResidentAccessRequest[];
  userBuildingAccess: UserBuildingAccess[];
  userUnitAccess: UserUnitAccess[];
  auditEvents: AuditEvent[];
  recordAudit: (event: Omit<AuditEvent, "id" | "created_at" | "created_by_user_id">) => Promise<void>;
  onNotice: (notice: string) => void;
  reload: () => Promise<void>;
}) {
  return (
    <div className="grid gap-5">
      <section className="panel">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <SectionHeader title="Setup" subtitle="Building setup, people access and portal activity controls." />
          <div className="grid w-full grid-cols-1 gap-2 sm:w-auto sm:grid-cols-3 lg:flex lg:flex-wrap" role="tablist" aria-label="Setup sections">
            {availableTabs.map((item) => (
              <button
                key={item}
                className={`secondary min-h-9 w-full min-w-0 px-3 py-1.5 text-center text-sm leading-tight ${activeTab === item ? "nav-pill-active" : ""}`}
                onClick={() => setTab(item)}
                type="button"
              >
                {tabLabel(item)}
              </button>
            ))}
          </div>
        </div>
      </section>
      {activeTab === "setup_buildings" && (
        <AdminSetup
          buildings={buildings}
          units={units}
          areas={areas}
          buildingFloors={buildingFloors}
          unitTypes={unitTypes}
          unitTypeAreas={unitTypeAreas}
          recordAudit={recordAudit}
          onNotice={onNotice}
          reload={reload}
        />
      )}
      {activeTab === "setup_people" && (
        <UserAdmin
          buildings={buildings}
          units={units}
          organisations={organisations}
          profiles={profiles}
          accessRequests={accessRequests}
          userBuildingAccess={userBuildingAccess}
          userUnitAccess={userUnitAccess}
          recordAudit={recordAudit}
          onNotice={onNotice}
          reload={reload}
        />
      )}
      {activeTab === "setup_activity" && <AuditPanel auditEvents={auditEvents} profiles={profiles} />}
    </div>
  );
}

function Dashboard({
  buildings,
  events,
  profile,
  snags,
  setTab,
  setSnagFilters,
}: {
  buildings: Building[];
  events: SnagEvent[];
  profile: Profile | null;
  snags: ProductionSnag[];
  setTab: (tab: Tab) => void;
  setSnagFilters: (filters: SnagListFilters) => void;
}) {
  const model = buildDashboardModel({ buildings, events, snags });
  const actionItems = model.currentActions.filter((item) => item.value > 0);
  const movementItems = model.todayMovement.filter((item) => item.value > 0);
  const pcConfirmationWarnings = ["admin", "developer"].includes(profile?.role ?? "")
    ? buildings.filter((building) => hasPassedExpectedPcWarning(building))
    : [];
  function openSnags(filters: SnagListFilters = {}) {
    setSnagFilters(filters);
    setTab("snags");
  }

  return (
    <div className="grid gap-5">
      {pcConfirmationWarnings.length > 0 && (
        <section className="rounded-md border border-[#D6A23A] bg-[#fff8e7] p-4 text-[#5c4a1f]">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-bold">PC date requires confirmation</p>
              <div className="mt-2 grid gap-1 text-sm">
                {pcConfirmationWarnings.map((building) => (
                  <p key={building.id}>
                    {building.name} has an expected PC date of {formatDate(expectedPcDate(building))}, but PC has not been confirmed. The portal has not moved into the initial defects reporting period.
                  </p>
                ))}
              </div>
            </div>
            {profile?.role === "admin" && (
              <button className="secondary min-h-10 px-3 py-1.5 text-sm" type="button" onClick={() => setTab("setup_buildings")}>
                Review building settings
              </button>
            )}
          </div>
        </section>
      )}
      <section className="dashboard-hero">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#D6A23A]">Action centre</p>
          <h2 className="mt-1 text-2xl font-bold text-[#0F3D2E]">Developer snags</h2>
          <p className="mt-2 max-w-2xl text-sm text-[#66736B]">Current developer snag actions and today&apos;s movement across the buildings you can access.</p>
        </div>
        <div className="grid grid-cols-3 gap-2 text-center">
          <HeroCount label="Total" value={model.totalDeveloperSnags} />
          <HeroCount label="Active" value={model.activeDeveloperSnags} />
          <HeroCount label="Changed today" value={model.changedToday} />
        </div>
      </section>

      <section className="panel">
        <SectionHeader title="Needs attention" subtitle="Current developer snag actions with a non-zero count." />
        {actionItems.length > 0 ? (
          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {actionItems.map((item) => (
              <ActionCard key={item.id} item={item} onClick={() => openSnags(filtersForAttention(item.id))} />
            ))}
          </div>
        ) : (
          <p className="mobile-empty mt-4">No developer snag actions need attention.</p>
        )}
      </section>

      <section className="panel">
        <SectionHeader title="Today&apos;s movement" subtitle="Developer snag changes recorded today." />
        {movementItems.length > 0 ? (
          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {movementItems.map((item) => (
              <ActionCard key={item.id} item={item} onClick={() => openSnags(filtersForAttention(item.id))} />
            ))}
          </div>
        ) : (
          <p className="mobile-empty mt-4">No developer snag movement today yet.</p>
        )}
      </section>

      <section className="panel">
        <SectionHeader title="Building workload" subtitle="Open developer snag workload by building." />
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {model.buildingWorkload.map((building) => (
            <button key={building.id} className="dashboard-project-card" onClick={() => openSnags({ buildingId: building.id })}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-bold text-[#1F2A24]">{building.name}</p>
                  <p className="mt-1 text-sm text-[#66736B]">{building.active} active developer snag{building.active === 1 ? "" : "s"}</p>
                </div>
                <span className={statusTone(building.readyForReview > 0 ? "resolved_by_contractor" : building.rejectedBack > 0 ? "rejected_back_to_contractor" : "open")}>
                  {building.closedPercent}% closed
                </span>
              </div>
              <div className="mt-4 h-2 overflow-hidden rounded-full bg-[#ede8dc]">
                <div className="h-full rounded-full bg-[#0F3D2E]" style={{ width: `${building.closedPercent}%` }} />
              </div>
              <div className="mt-4 grid grid-cols-4 gap-2 text-center text-xs">
                <MiniStat label="Active" value={building.active} />
                <MiniStat label="Review" value={building.readyForReview} />
                <MiniStat label="Info" value={building.needsMoreInfo} />
                <MiniStat label="Rejected" value={building.rejectedBack} />
              </div>
            </button>
          ))}
          {model.buildingWorkload.length === 0 && <p className="mobile-empty md:col-span-2">No developer snag workload to show.</p>}
        </div>
      </section>
    </div>
  );
}

function filtersForAttention(id: string): SnagListFilters {
  if (id === "needs_trade") return { tradeFilter: "__none__" };
  if (id === "overdue") return { quickFilter: "overdue" };
  if (id === "due_soon") return { quickFilter: "due_soon" };
  if (id === "review") return { statusFilter: "resolved_by_contractor" };
  if (id === "contractor_reject") return { statusFilter: "needs_more_info" };
  if (id === "developer_reject") return { statusFilter: "rejected_back_to_contractor" };
  if (id === "info_supplied") return { quickFilter: "info_supplied" };
  if (id === "created_today") return { quickFilter: "created_today" };
  if (id === "resolved_today") return { quickFilter: "resolved_today" };
  if (id === "closed_today") return { quickFilter: "closed_today" };
  if (id === "rejected_today") return { quickFilter: "rejected_today" };
  if (id === "more_info_today") return { quickFilter: "more_info_today" };
  if (id === "info_supplied_today") return { quickFilter: "info_supplied_today" };
  if (id === "recent") return { quickFilter: "recent" };
  return {};
}

function quickFilterLabel(filter: SnagQuickFilter) {
  const labels: Record<SnagQuickFilter, string> = {
    overdue: "overdue SLA",
    due_soon: "due soon",
    recent: "recently updated",
    created_today: "created today",
    resolved_today: "resolved today",
    closed_today: "closed today",
    rejected_today: "rejected back today",
    more_info_today: "more information requested today",
    info_supplied: "information supplied",
    info_supplied_today: "information supplied today",
  };

  return labels[filter];
}

function buildDashboardModel({
  buildings,
  events,
  snags,
}: {
  buildings: Building[];
  events: SnagEvent[];
  snags: ProductionSnag[];
}) {
  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const isToday = (value?: string | null) => Boolean(value && new Date(value) >= todayStart);
  const isFinal = (snag: ProductionSnag) => ["closed", "resolved"].includes(snag.status);
  const isStatusEvent = (event: SnagEvent) => ["status_change", "triage"].includes(event.event_type);
  const isInfoSuppliedEvent = (event: SnagEvent) => isStatusEvent(event) && event.old_value === "needs_more_info" && event.new_value === "open";

  const developerSnags = snags.filter((snag) => snag.source_type === "developer_snag");
  const developerSnagIds = new Set(developerSnags.map((snag) => snag.id));
  const developerEvents = events.filter((event) => developerSnagIds.has(event.snag_id));
  const statusEventIds = (status: string, onlyToday = false) => new Set(developerEvents
    .filter((event) => isStatusEvent(event))
    .filter((event) => event.new_value === status)
    .filter((event) => !onlyToday || isToday(event.created_at))
    .map((event) => event.snag_id));
  const activeDeveloperSnags = developerSnags.filter((snag) => !isFinal(snag));
  const closedDeveloperSnags = developerSnags.filter(isFinal);
  const needsTrade = activeDeveloperSnags.filter((snag) => !snag.trade_id);
  const readyForReview = developerSnags.filter((snag) => snag.status === "resolved_by_contractor");
  const needsMoreInfo = developerSnags.filter((snag) => snag.status === "needs_more_info");
  const rejectedBackToContractor = developerSnags.filter((snag) => snag.status === "rejected_back_to_contractor");
  const infoSuppliedSnagIds = new Set(developerEvents.filter(isInfoSuppliedEvent).map((event) => event.snag_id));
  const infoSuppliedAwaitingReview = developerSnags.filter((snag) => snag.status === "open" && infoSuppliedSnagIds.has(snag.id));
  const todayEvents = developerEvents.filter((event) => isToday(event.created_at));
  const changedToday = new Set([
    ...developerSnags.filter((snag) => isToday(snag.created_at) || isToday(snag.updated_at)).map((snag) => snag.id),
    ...todayEvents.map((event) => event.snag_id),
  ]).size;
  const resolvedTodayIds = statusEventIds("resolved_by_contractor", true);
  const closedTodayIds = statusEventIds("closed", true);
  const rejectedTodayIds = statusEventIds("rejected_back_to_contractor", true);
  const moreInfoTodayIds = statusEventIds("needs_more_info", true);
  const infoSuppliedTodayIds = new Set(developerEvents.filter(isInfoSuppliedEvent).filter((event) => isToday(event.created_at)).map((event) => event.snag_id));

  const buildingWorkload = buildings.map((building) => {
    const buildingSnags = developerSnags.filter((snag) => snag.building_id === building.id);
    const closed = buildingSnags.filter(isFinal).length;
    const total = buildingSnags.length;
    return {
      id: building.id,
      name: building.name,
      total,
      active: buildingSnags.filter((snag) => !isFinal(snag)).length,
      readyForReview: buildingSnags.filter((snag) => snag.status === "resolved_by_contractor").length,
      needsMoreInfo: buildingSnags.filter((snag) => snag.status === "needs_more_info").length,
      rejectedBack: buildingSnags.filter((snag) => snag.status === "rejected_back_to_contractor").length,
      closedPercent: total === 0 ? 0 : Math.round((closed / total) * 100),
    };
  }).filter((building) => building.total > 0);

  return {
    totalDeveloperSnags: developerSnags.length,
    activeDeveloperSnags: activeDeveloperSnags.length,
    closedDeveloperSnags: closedDeveloperSnags.length,
    changedToday,
    currentActions: [
      { id: "review", label: "Ready for review", value: readyForReview.length, tone: "good", helper: "Resolved by contractor and waiting for developer review." },
      { id: "contractor_reject", label: "Needs more info", value: needsMoreInfo.length, tone: "warning", helper: "Returned to developer for more information." },
      { id: "info_supplied", label: "Information supplied", value: infoSuppliedAwaitingReview.length, tone: "warning", helper: "Reopened after more information was added." },
      { id: "developer_reject", label: "Rejected back to contractor", value: rejectedBackToContractor.length, tone: "danger", helper: "Returned to contractor for further work." },
      { id: "needs_trade", label: "Needs trade allocation", value: needsTrade.length, tone: "warning", helper: "Active developer snags without a trade." },
    ],
    todayMovement: [
      { id: "created_today", label: "Created today", value: developerSnags.filter((snag) => isToday(snag.created_at)).length, tone: "neutral", helper: "New developer snags logged today." },
      { id: "resolved_today", label: "Resolved today", value: resolvedTodayIds.size, tone: "good", helper: "Moved to resolved by contractor today." },
      { id: "closed_today", label: "Closed today", value: closedTodayIds.size + developerSnags.filter((snag) => snag.status === "closed" && isToday(snag.closed_at)).filter((snag) => !closedTodayIds.has(snag.id)).length, tone: "good", helper: "Closed by the developer today." },
      { id: "rejected_today", label: "Rejected back today", value: rejectedTodayIds.size, tone: "danger", helper: "Returned to contractor today." },
      { id: "more_info_today", label: "Info requested today", value: moreInfoTodayIds.size, tone: "warning", helper: "More information requested from the developer today." },
      { id: "info_supplied_today", label: "Info supplied today", value: infoSuppliedTodayIds.size, tone: "warning", helper: "More information was added today." },
    ],
    buildingWorkload,
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

function BuildingStructureView({
  buildings,
  selectedBuildingId,
  buildingFloors,
  units,
  areas,
  unitTypes,
  unitTypeAreas,
  onNotice,
  reload,
}: {
  buildings: Building[];
  selectedBuildingId: string;
  buildingFloors: BuildingFloor[];
  units: Unit[];
  areas: Area[];
  unitTypes: UnitType[];
  unitTypeAreas: UnitTypeArea[];
  onNotice: (notice: string) => void;
  reload: () => Promise<void>;
}) {
  const [floorName, setFloorName] = useState("");
  const [editingFloorOrder, setEditingFloorOrder] = useState(false);
  const building = buildings.find((item) => item.id === selectedBuildingId) ?? buildings[0];
  const buildingId = building?.id ?? "";
  const floors = buildingFloors
    .filter((floor) => floor.building_id === building?.id)
    .sort((a, b) => a.sort_order - b.sort_order);
  const buildingUnits = units.filter((unit) => unit.building_id === building?.id);
  const communalAreas = areas
    .filter((area) => area.building_id === building?.id && area.area_type === "communal_area")
    .sort((a, b) => a.sort_order - b.sort_order);
  const unassignedCommunalAreas = communalAreas.filter((area) => !area.floor || !floors.some((floor) => floor.name === area.floor));
  const unmatchedUnits = buildingUnits.filter((unit) => unit.floor && !floors.some((floor) => floor.name === unit.floor));
  const noFloorUnits = buildingUnits.filter((unit) => !unit.floor);

  async function moveFloor(floorId: string, direction: -1 | 1) {
    const currentIndex = floors.findIndex((floor) => floor.id === floorId);
    const nextIndex = currentIndex + direction;
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= floors.length) return;
    const reordered = [...floors];
    const [floor] = reordered.splice(currentIndex, 1);
    reordered.splice(nextIndex, 0, floor);
    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.from("building_floors").upsert(reordered.map((item, index) => ({
      ...item,
      sort_order: (index + 1) * 10,
    })));
    if (error) onNotice(error.message);
    else await reload();
  }

  async function addFloor() {
    if (!building || !floorName) return;
    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.from("building_floors").insert({
      building_id: building.id,
      name: floorName,
      sort_order: floors.length === 0 ? 10 : Math.max(...floors.map((floor) => floor.sort_order)) + 10,
    });
    if (error) onNotice(error.message);
    else {
      setFloorName("");
      await reload();
    }
  }

  return (
    <section className="grid gap-4" data-building-name={building?.name ?? ""} data-testid="building-structure-section">
      <div>
        <h2 className="text-lg font-semibold">Building structure</h2>
        <p className="text-sm text-[#617169]">Floors, units, rooms, private amenities and communal areas.</p>
      </div>

      {!building && <p className="text-sm text-[#617169]">No buildings have been created yet.</p>}

      {building && (
        <div className="grid gap-3">
          {editingFloorOrder && (
            <div className="grid gap-2 rounded-md border border-dashed border-[#cbd4ce] bg-[#f8faf7] p-3">
              {floors.map((floor, index) => (
                <div key={floor.id} className="flex items-center justify-between gap-3 rounded-md border border-[#cbd4ce] bg-white px-3 py-2 text-sm">
                  <span className="font-medium">{floor.name}</span>
                  <div className="flex gap-2">
                    <button className="secondary h-8 min-h-8 w-8 px-0" onClick={() => moveFloor(floor.id, -1)} disabled={index === 0} title="Move up">{"<"}</button>
                    <button className="secondary h-8 min-h-8 w-8 px-0" onClick={() => moveFloor(floor.id, 1)} disabled={index === floors.length - 1} title="Move down">{">"}</button>
                  </div>
                </div>
              ))}
              {floors.length === 0 && <p className="text-sm text-[#617169]">No floors yet.</p>}
            </div>
          )}
          {floors.map((floor) => (
            <FloorBlock
              key={floor.id}
              floor={floor}
              floorName={floor.name}
              units={buildingUnits.filter((unit) => unit.floor === floor.name)}
              areas={areas}
              communalAreas={communalAreas.filter((area) => area.floor === floor.name)}
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
              communalAreas={[]}
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
              communalAreas={[]}
              buildingFloors={buildingFloors}
              unitTypes={unitTypes}
              unitTypeAreas={unitTypeAreas}
              buildingId={building.id}
              onNotice={onNotice}
              reload={reload}
              warning
            />
          )}
          {unassignedCommunalAreas.length > 0 && (
            <div className="rounded-md border border-[#e2c8a6] bg-[#fff8ec] p-4">
              <h3 className="font-semibold">Unassigned / External communal areas</h3>
              <p className="mt-1 text-sm text-[#617169]">Assign these areas to a floor so they appear in the building hierarchy.</p>
              <div className="mt-3 grid gap-2">
                {unassignedCommunalAreas.map((area) => (
                  <CommunalAreaRow key={area.id} area={area} floors={floors} onNotice={onNotice} reload={reload} />
                ))}
              </div>
            </div>
          )}
          <div className="border-t border-[#e5e9e4] pt-4">
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
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
              <button className="secondary min-h-9 px-3 py-1.5 text-sm" onClick={() => setEditingFloorOrder((current) => !current)}>
                {editingFloorOrder ? "Done ordering" : "Edit floor order"}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function FloorBlock({
  floor,
  buildingId,
  floorName,
  units,
  areas,
  communalAreas,
  buildingFloors,
  unitTypes,
  unitTypeAreas,
  onNotice,
  reload,
  warning = false,
}: {
  floor?: BuildingFloor;
  buildingId: string;
  floorName: string;
  units: Unit[];
  areas: Area[];
  communalAreas: Area[];
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
  const [communalName, setCommunalName] = useState("");
  const [collapsed, setCollapsed] = useState(!warning);
  const canDeleteFloor = Boolean(floor && units.length === 0 && communalAreas.length === 0);
  const deleteFloorHelp = "Move or delete units and communal areas before deleting this floor.";

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

  async function addCommunalAreaToFloor() {
    if (!communalName.trim()) return;
    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.from("areas").insert({
      building_id: buildingId,
      unit_id: null,
      area_type: "communal_area",
      name: communalName.trim(),
      floor: floorName,
      sort_order: communalAreas.length + 1,
    });
    if (error) onNotice(error.message);
    else {
      setCommunalName("");
      await reload();
    }
  }

  async function deleteFloor() {
    if (!floor) return;
    if (!canDeleteFloor) {
      onNotice(deleteFloorHelp);
      return;
    }
    if (!window.confirm(`Delete floor ${floor.name}?`)) return;
    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.from("building_floors").delete().eq("id", floor.id);
    if (error) onNotice(error.message);
    else await reload();
  }

  return (
    <div className={`rounded-md border ${collapsed ? "px-3 py-2" : "p-4"} ${warning ? "border-[#e2c8a6] bg-[#fff8ec]" : "border-[#c4ccc6] bg-[#f8faf7]"}`}>
      <div
        className="grid min-h-[4.25rem] cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-md"
        onClick={() => setCollapsed((current) => !current)}
      >
        <div className="min-w-0 px-1 py-1">
          <div className="inline-flex max-w-full items-center gap-2 text-left font-semibold text-[#0F3D2E]">
            {collapsed ? <ChevronDown className="shrink-0" size={18} aria-hidden /> : <ChevronUp className="shrink-0" size={18} aria-hidden />}
            <span className="truncate" title={floorName}>{floorName}</span>
          </div>
          <span className="mt-1 block whitespace-nowrap text-sm text-[#617169]">{units.length} unit{units.length === 1 ? "" : "s"} &middot; {communalAreas.length} communal</span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {floor && (
            <button
              className="secondary icon-button text-[#b42318]"
              onClick={(event) => {
                event.stopPropagation();
                void deleteFloor();
              }}
              disabled={!canDeleteFloor}
              aria-label={`Delete floor ${floor.name}`}
              title={canDeleteFloor ? `Delete ${floor.name}` : deleteFloorHelp}
            >
              <Trash2 size={16} strokeWidth={2.25} aria-hidden />
            </button>
          )}
          <button
            className="secondary icon-button text-[#0F3D2E]"
            onClick={(event) => {
              event.stopPropagation();
              setCollapsed((current) => !current);
            }}
            aria-label={collapsed ? `Expand ${floorName}` : `Collapse ${floorName}`}
            title={collapsed ? `Expand ${floorName}` : `Collapse ${floorName}`}
          >
            {collapsed ? <ChevronDown size={17} strokeWidth={2.5} aria-hidden /> : <ChevronUp size={17} strokeWidth={2.5} aria-hidden />}
          </button>
        </div>
      </div>
      {!collapsed && (
        <>
          <div className="mt-4 rounded-md border border-[#d9ded6] bg-white p-3">
            <h4 className="font-semibold text-[#0F3D2E]">Units</h4>
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
              {units.length === 0 && <p className="rounded-md border border-dashed border-[#d9ded6] bg-[#f8faf7] p-3 text-sm text-[#617169]">No units added to this floor yet.</p>}
            </div>
            {!warning && (
              <div className="mt-4 grid gap-2 rounded-md border border-dashed border-[#cbd4ce] bg-[#f8faf7] p-3 lg:grid-cols-[1fr_1fr_1fr_1fr_auto]">
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
          </div>
          <div className="mt-4 rounded-md border border-[#d9ded6] bg-white p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h4 className="font-semibold text-[#0F3D2E]">Communal areas</h4>
                <p className="text-sm text-[#617169]">Shared areas on {floorName}.</p>
              </div>
            </div>
            <div className="mt-3 grid gap-2">
              {communalAreas.map((area) => (
                <CommunalAreaRow key={area.id} area={area} floors={buildingFloors.filter((item) => item.building_id === buildingId)} onNotice={onNotice} reload={reload} />
              ))}
              {communalAreas.length === 0 && <p className="rounded-md border border-dashed border-[#d9ded6] bg-[#f8faf7] p-3 text-sm text-[#617169]">No communal areas added to this floor yet.</p>}
            </div>
            {!warning && (
              <div className="mt-3 grid gap-2 lg:grid-cols-[minmax(0,1fr)_auto]">
                <input
                  className="field"
                  value={communalName}
                  onChange={(event) => setCommunalName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void addCommunalAreaToFloor();
                  }}
                  placeholder={`Add communal area to ${floorName}`}
                />
                <button className="secondary" onClick={addCommunalAreaToFloor} disabled={!communalName.trim()}>Add communal</button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function CommunalAreaRow({ area, floors, onNotice, reload }: { area: Area; floors: BuildingFloor[]; onNotice: (notice: string) => void; reload: () => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(area.name);
  const [floor, setFloor] = useState(area.floor ?? "");
  const [deleteWarning, setDeleteWarning] = useState("");
  const category = inferCommunalCategory(area.name);

  useEffect(() => {
    setName(area.name);
    setFloor(area.floor ?? "");
    setDeleteWarning("");
  }, [area.floor, area.name]);

  async function save() {
    if (!name.trim() || !floor) {
      onNotice("Communal area name and floor are required.");
      return;
    }
    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.from("areas").update({ name: name.trim(), floor }).eq("id", area.id);
    if (error) onNotice(error.message);
    else {
      setEditing(false);
      await reload();
    }
  }

  async function deleteCommunalArea() {
    const supabase = createSupabaseBrowserClient();
    const { count, error: countError } = await supabase
      .from("snags")
      .select("id", { count: "exact", head: true })
      .eq("area_id", area.id);
    if (countError) {
      setDeleteWarning(countError.message);
      return;
    }
    if ((count ?? 0) > 0) {
      setDeleteWarning(`Cannot remove ${area.name}. Move or close the linked snags first.`);
      return;
    }
    if (!window.confirm(`Delete communal area ${area.name}?`)) return;
    const { error } = await supabase.from("areas").delete().eq("id", area.id);
    if (error) setDeleteWarning(error.message);
    else {
      setDeleteWarning("");
      await reload();
    }
  }

  if (editing) {
    return (
      <div className="grid gap-2 rounded-md border border-[#d9ded6] bg-[#f8faf7] p-3 md:grid-cols-[minmax(0,1fr)_180px_auto]">
        <input className="field" value={name} onChange={(event) => setName(event.target.value)} placeholder="Communal area name" />
        <select className="field" value={floor} onChange={(event) => setFloor(event.target.value)}>
          <option value="">Assign floor</option>
          {floors.map((item) => <option key={item.id} value={item.name}>{item.name}</option>)}
        </select>
        <div className="flex gap-2">
          <button className="primary min-h-9 px-3 py-1.5 text-sm" onClick={save} disabled={!name.trim() || !floor}>Save</button>
          <button className="secondary min-h-9 px-3 py-1.5 text-sm" onClick={() => setEditing(false)}>Cancel</button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-md border border-[#d9ded6] bg-[#f8faf7] px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-medium text-[#1F2A24]">{area.name}</p>
          <p className="text-xs text-[#617169]">{category}</p>
        </div>
        <div className="flex gap-2">
          <button className="secondary icon-button" onClick={() => setEditing(true)} title={`Edit ${area.name}`} aria-label={`Edit ${area.name}`}>
            <Pencil size={16} strokeWidth={2.25} aria-hidden />
          </button>
          <button className="rounded-md border border-[#f1b8b2] p-2 text-[#b42318] transition hover:bg-[#fee4e2]" onClick={deleteCommunalArea} title={`Delete ${area.name}`} aria-label={`Delete ${area.name}`}>
            <Trash2 size={14} aria-hidden />
          </button>
        </div>
      </div>
      {deleteWarning && <p className="mt-2 rounded-md border border-[#f1b8b2] bg-[#fff4f2] px-3 py-2 text-sm text-[#b42318]">{deleteWarning}</p>}
    </div>
  );
}

function inferCommunalCategory(name: string) {
  const normalized = name.toLowerCase();
  if (normalized.includes("bin")) return "Bin store";
  if (normalized.includes("bike") || normalized.includes("cycle")) return "Bike store";
  if (normalized.includes("car") || normalized.includes("parking")) return "Car park";
  if (normalized.includes("plant")) return "Plant room";
  if (normalized.includes("store")) return "Store";
  if (normalized.includes("corridor")) return "Corridor";
  return "Communal area";
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
  const [deleteWarning, setDeleteWarning] = useState("");
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
    setDeleteWarning("");
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
    if (editSaleStatus === "handed_over" && unit.sale_status !== "handed_over") {
      onNotice("Handed Over can only be set by completing the handover workflow.");
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

  async function deleteUnit() {
    const supabase = createSupabaseBrowserClient();
    const { count, error: countError } = await supabase
      .from("snags")
      .select("id", { count: "exact", head: true })
      .eq("unit_id", unit.id);
    if (countError) {
      setDeleteWarning(countError.message);
      return;
    }
    if ((count ?? 0) > 0) {
      setDeleteWarning(`Cannot delete unit ${unit.unit_number}. Move or close the linked snags first.`);
      return;
    }
    if (!window.confirm(`Delete unit ${unit.unit_number}? This will also remove its rooms and private amenity records.`)) return;
    const { error: areaError } = await supabase.from("areas").delete().eq("unit_id", unit.id);
    if (areaError) {
      setDeleteWarning(areaError.message);
      return;
    }
    const { error } = await supabase.from("units").delete().eq("id", unit.id);
    if (error) setDeleteWarning(error.message);
    else {
      setDeleteWarning("");
      await reload();
    }
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
                    {unit.sale_status === "handed_over" ? (
                      <select className="field" value="handed_over" disabled title="Handed Over is controlled by the handover workflow">
                        <option value="handed_over">Handed Over</option>
                      </select>
                    ) : (
                      <select className="field" value={editSaleStatus} onChange={(event) => setEditSaleStatus(event.target.value as Unit["sale_status"])}>
                        {adminEditableUnitSaleStatuses.map((status) => <option key={status.value} value={status.value}>{status.label}</option>)}
                      </select>
                    )}
                  </div>
                  <div className="rounded-md border border-[#d9ded6] bg-white p-3">
                    <p className="text-xs font-semibold uppercase text-[#617169]">Rooms</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {visibleRooms.map((area) => <AreaChip key={area.id} area={area} canRemove showFloor={false} onRemove={() => removeAreaFromEdit(area.id)} />)}
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
                          {visibleAmenities.map((area) => <AreaChip key={area.id} area={area} canRemove showFloor={false} onRemove={() => removeAreaFromEdit(area.id)} />)}
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
                  <div className="flex flex-wrap gap-2 border-t border-[#d9ded6] pt-3">
                    <button className="primary" onClick={saveUnit} disabled={!editNumber || !editFloor || !editSizeSqm || !editUnitTypeId}>Save unit</button>
                    <button className="secondary" onClick={cancelEdit}>Cancel</button>
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
                    <div className="flex gap-2">
                      <button className="secondary icon-button" onClick={() => setEditing(true)} title={`Edit unit ${unit.unit_number}`} aria-label={`Edit unit ${unit.unit_number}`}>
                        <Pencil size={16} strokeWidth={2.25} aria-hidden />
                      </button>
                      <button
                        className="danger-icon-button"
                        onClick={deleteUnit}
                        title={`Delete unit ${unit.unit_number}`}
                        aria-label={`Delete unit ${unit.unit_number}`}
                      >
                        <Trash2 size={16} strokeWidth={2.25} aria-hidden />
                      </button>
                    </div>
                  </div>
                </div>
              )}
              {!editing && deleteWarning && <p className="mt-3 rounded-md border border-[#f1b8b2] bg-[#fff4f2] px-3 py-2 text-sm text-[#b42318]">{deleteWarning}</p>}
              {!editing && (
                <>
                  <div className="mt-3">
                    <p className="text-xs font-semibold uppercase text-[#617169]">Rooms</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {rooms.map((area) => <AreaChip key={area.id} area={area} canRemove={false} showFloor={false} onNotice={onNotice} reload={reload} />)}
                      {rooms.length === 0 && <span className="text-sm text-[#a15b3d]">No rooms</span>}
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[#edf0ec] pt-3">
                    <div>
                      <p className="text-xs font-semibold uppercase text-[#617169]">Private amenity</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {amenities.length > 0 ? (
                          amenities.map((area) => <AreaChip key={area.id} area={area} canRemove={false} showFloor={false} onNotice={onNotice} reload={reload} />)
                        ) : (
                          <span className="text-sm text-[#617169]">None</span>
                        )}
                      </div>
                    </div>
                  </div>
                </>
              )}
            </article>
  );
}

function AreaChip({
  area,
  canRemove = true,
  showFloor = true,
  onRemove,
  onNotice,
  reload,
}: {
  area: Area;
  canRemove?: boolean;
  showFloor?: boolean;
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
      {label}{showFloor && area.floor ? ` / ${area.floor}` : ""}
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
  const [allowResidentAccessRequests, setAllowResidentAccessRequests] = useState(true);
  const [buildingDrafts, setBuildingDrafts] = useState<Record<string, Partial<Building>>>({});
  const [editConfirmedPcBuildingIds, setEditConfirmedPcBuildingIds] = useState<Record<string, boolean>>({});
  const [confirmEditPcBuildingId, setConfirmEditPcBuildingId] = useState<string | null>(null);
  const [showCreateBuilding, setShowCreateBuilding] = useState(false);
  const [selectedBuildingId, setSelectedBuildingId] = useState(buildings[0]?.id ?? "");
  const selectedBuilding = buildings.find((building) => building.id === selectedBuildingId) ?? buildings[0];

  useEffect(() => {
    if (buildings.length === 0) return;
    if (selectedBuildingId && buildings.some((building) => building.id === selectedBuildingId)) return;
    const timer = window.setTimeout(() => setSelectedBuildingId(buildings[0].id), 0);
    return () => window.clearTimeout(timer);
  }, [buildings, selectedBuildingId]);

  async function createBuilding() {
    const supabase = createSupabaseBrowserClient();
    const { data, error } = await supabase.from("buildings").insert({
      name: buildingName,
      address_line_1: addressLine1,
      address_line_2: addressLine2,
      town,
      postcode,
      photo_url: photoUrl || null,
      documents_url: documentsUrl || null,
      home_user_guide_url: homeUserGuideUrl || null,
      pc_date: pcDate || null,
      pc_confirmed: false,
      practical_completion_date: pcDate || null,
      defects_liability_end_date: null,
      status: "active",
      allow_resident_access_requests: allowResidentAccessRequests,
    }).select("id").single();
    if (error) onNotice(buildingSchemaNotice(error.message));
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
      setAllowResidentAccessRequests(true);
      setShowCreateBuilding(false);
      setSelectedBuildingId(data.id);
      await reload();
    }
  }

  function buildingDraft(building: Building) {
    return buildingDrafts[building.id] ?? {};
  }

  function updateBuildingDraft(buildingId: string, updates: Partial<Building>) {
    setBuildingDrafts((current) => ({ ...current, [buildingId]: { ...(current[buildingId] ?? {}), ...updates } }));
  }

  function draftPcDate(building: Building) {
    const draft = buildingDraft(building);
    return (draft.pc_date ?? building.pc_date ?? building.practical_completion_date ?? "") as string;
  }

  function draftPcConfirmed(building: Building) {
    const draft = buildingDraft(building);
    return draft.pc_confirmed ?? building.pc_confirmed ?? false;
  }

  function draftAllowResidentRequests(building: Building) {
    const draft = buildingDraft(building);
    return draft.allow_resident_access_requests ?? building.allow_resident_access_requests ?? true;
  }

  function buildingHasUnsavedChanges(building: Building) {
    const currentPcDate = building.pc_date ?? building.practical_completion_date ?? "";
    return draftPcDate(building) !== currentPcDate
      || draftPcConfirmed(building) !== (building.pc_confirmed ?? false)
      || draftAllowResidentRequests(building) !== (building.allow_resident_access_requests ?? true);
  }

  function pcConfirmHelperText(pcDateValue: string, pcConfirmedValue: boolean) {
    if (pcConfirmedValue) return "PC confirmed. The resident portal lifecycle is calculated from this confirmed date.";
    if (!pcDateValue) return "Enter a Practical Completion date before confirming PC.";
    if (pcDateValue > dateOnly()) return "PC can only be confirmed using today's date or a past date.";
    return "Only confirm PC once Practical Completion has actually occurred.";
  }

  async function saveBuildingSettings(building: Building) {
    const pcDateValue = draftPcDate(building) || null;
    const pcConfirmedValue = draftPcConfirmed(building);
    const allowRequestsValue = draftAllowResidentRequests(building);

    if (pcConfirmedValue) {
      const errorMessage = pcConfirmationError(pcDateValue);
      if (errorMessage) {
        onNotice(errorMessage);
        return;
      }
    }

    const currentPcDate = building.pc_date ?? building.practical_completion_date ?? "";
    if (building.pc_confirmed && pcDateValue !== currentPcDate && !editConfirmedPcBuildingIds[building.id]) {
      onNotice("Use Edit confirmed PC date before changing the confirmed PC date.");
      return;
    }

    const payload = {
      pc_date: pcDateValue,
      pc_confirmed: pcConfirmedValue,
      practical_completion_date: pcDateValue,
      defects_liability_end_date: pcConfirmedValue && pcDateValue
        ? initialDefectsReportingEndDate({ pc_date: pcDateValue, pc_confirmed: true })
        : null,
      allow_resident_access_requests: allowRequestsValue,
    };
    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.from("buildings").update(payload).eq("id", building.id);

    if (error) {
      onNotice(buildingSchemaNotice(error.message));
      return;
    }

    await recordAudit({
      event_type: "building_updated",
      entity_type: "building",
      entity_id: building.id,
      summary: `Building settings updated: ${building.name}`,
      metadata: { building: building.name, ...payload },
    });
    setBuildingDrafts((current) => {
      const next = { ...current };
      delete next[building.id];
      return next;
    });
    setEditConfirmedPcBuildingIds((current) => ({ ...current, [building.id]: false }));
    setConfirmEditPcBuildingId(null);
    onNotice(`Building settings saved for ${building.name}.`);
    await reload();
  }

  const pcDateValue = selectedBuilding ? draftPcDate(selectedBuilding) : "";
  const pcConfirmedValue = selectedBuilding ? draftPcConfirmed(selectedBuilding) : false;
  const allowRequestsValue = selectedBuilding ? draftAllowResidentRequests(selectedBuilding) : true;
  const canEditConfirmedPc = selectedBuilding ? editConfirmedPcBuildingIds[selectedBuilding.id] === true : false;
  const portalMode = selectedBuilding ? derivedBuildingLifecycleStatus({ ...selectedBuilding, pc_date: pcDateValue || null, pc_confirmed: pcConfirmedValue }) : "pre_pc";
  const reportingEnd = selectedBuilding ? initialDefectsReportingEndDate({ pc_date: pcDateValue || null, pc_confirmed: pcConfirmedValue }) : null;
  const closingStart = selectedBuilding ? closingNoticeStartDate({ pc_date: pcDateValue || null, pc_confirmed: pcConfirmedValue }) : null;
  const confirmationIssue = pcConfirmationError(pcDateValue);
  const confirmDisabled = !pcDateValue || Boolean(confirmationIssue);
  const hasWarning = selectedBuilding ? hasPassedExpectedPcWarning({ ...selectedBuilding, pc_date: pcDateValue || null, pc_confirmed: pcConfirmedValue }) : false;
  const hasChanges = selectedBuilding ? buildingHasUnsavedChanges(selectedBuilding) : false;

  return (
    <section className="panel grid gap-6">
      <section
        className="rounded-xl border border-[#d9ded6] bg-[#f8faf7] p-4 shadow-[0_10px_24px_rgba(15,61,46,0.06)]"
        data-testid="working-building-context"
      >
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,28rem)] lg:items-end">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#D6A23A]">Working building</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <h2 className="text-2xl font-bold text-[#0F3D2E]">{selectedBuilding?.name ?? "No building selected"}</h2>
              {selectedBuilding && (
                <>
                  <span className={statusTone(pcConfirmedValue ? "closed" : "open")}>{pcConfirmedValue ? "PC confirmed" : "Not confirmed"}</span>
                  <span className={statusTone(portalMode === "post_dlp_readonly" ? "closed" : portalMode === "pre_pc" ? "open" : "in_progress")}>{lifecycleLabel(portalMode)}</span>
                  {hasChanges && <span className={statusTone("needs_more_info")}>Unsaved changes</span>}
                </>
              )}
            </div>
            <p className="mt-2 text-sm text-[#617169]">
              Lifecycle, resident access and building structure settings below apply to this building.
            </p>
          </div>
          <label className="field-label">
            Selected building
            <select className="field min-h-12 text-base font-semibold text-[#0F3D2E]" aria-label="Selected building" value={selectedBuilding?.id ?? ""} onChange={(event) => setSelectedBuildingId(event.target.value)}>
              {buildings.map((building) => <option key={building.id} value={building.id}>{building.name}</option>)}
            </select>
          </label>
        </div>
      </section>

      {!selectedBuilding && <p className="text-sm text-[#617169]">No buildings have been created yet.</p>}

      {selectedBuilding && (
        <>
          <section className="grid gap-4" data-testid="building-overview-section">
            <div>
              <h3 className="text-base font-semibold text-[#0F3D2E]">Building overview</h3>
              <p className="mt-1 text-sm text-[#617169]">Settings for {selectedBuilding.name}.</p>
              <p className="mt-1 text-sm text-[#617169]">{lifecycleEffectSummary(portalMode)}</p>
              {hasWarning && (
                <div className="mt-3 rounded-md border border-[#D6A23A] bg-[#fff8e7] p-3 text-sm text-[#5c4a1f]">
                  PC date requires confirmation: {selectedBuilding.name} has an expected PC date of {formatDate(pcDateValue)}, but PC has not been confirmed. The portal has not moved into the initial defects reporting period.
                </div>
              )}
            </div>

            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <div className="grid gap-3">
                <label className="field-label">
                  {pcConfirmedValue ? "Confirmed PC date" : "Expected PC date"}
                  <input
                    className="field min-h-10 py-2"
                    type="date"
                    value={pcDateValue}
                    disabled={pcConfirmedValue && !canEditConfirmedPc}
                    onChange={(event) => updateBuildingDraft(selectedBuilding.id, { pc_date: event.target.value || null })}
                  />
                </label>
                <p className="text-xs text-[#617169]">{pcConfirmHelperText(pcDateValue, pcConfirmedValue)}</p>
                {!pcConfirmedValue && (
                  <label className={`option-card min-h-10 px-3 py-2 text-sm ${confirmDisabled ? "opacity-60" : ""}`}>
                    <input
                      checked={pcConfirmedValue}
                      disabled={confirmDisabled}
                      onChange={(event) => updateBuildingDraft(selectedBuilding.id, { pc_confirmed: event.target.checked })}
                      type="checkbox"
                    />
                    PC confirmed
                  </label>
                )}
                {pcConfirmedValue && !canEditConfirmedPc && (
                  <button className="secondary w-fit" type="button" onClick={() => setConfirmEditPcBuildingId(selectedBuilding.id)}>
                    Edit confirmed PC date
                  </button>
                )}
                {confirmEditPcBuildingId === selectedBuilding.id && !canEditConfirmedPc && (
                  <div className="rounded-md border border-[#D6A23A] bg-[#fff8e7] p-3 text-sm text-[#5c4a1f]">
                    <p>Changing the confirmed PC date will recalculate the resident portal lifecycle, closing notice date and initial defects reporting end date.</p>
                    <button
                      className="secondary mt-3 min-h-9 px-3 py-1.5 text-sm"
                      type="button"
                      onClick={() => {
                        setEditConfirmedPcBuildingIds((current) => ({ ...current, [selectedBuilding.id]: true }));
                        setConfirmEditPcBuildingId(null);
                      }}
                    >
                      Allow PC date editing
                    </button>
                  </div>
                )}
              </div>

              <div className="grid gap-3 text-sm">
                <InfoRow label="Defects reporting closes" value={reportingEnd ? formatDate(reportingEnd) : "Calculated once PC is confirmed"} />
                <InfoRow label="Closing notice starts" value={closingStart ? formatDate(closingStart) : "Calculated once PC is confirmed"} />
                <InfoRow label="Current portal mode" value={lifecycleLabel(portalMode)} />
              </div>
            </div>

            <div className="grid gap-2 border-t border-[#e5e9e4] pt-4">
              <label className="option-card min-h-10 px-3 py-2 text-sm">
                <input checked={allowRequestsValue} onChange={(event) => updateBuildingDraft(selectedBuilding.id, { allow_resident_access_requests: event.target.checked })} type="checkbox" />
                Allow new resident access requests
              </label>
              <p className="text-xs text-[#617169]">Existing approved users can still log in. New residents cannot request access while access requests are disabled.</p>
              {!allowRequestsValue && <p className="text-xs text-[#7a5a15]">New residents cannot request access for this building. Existing approved users are not affected.</p>}
              <div className="flex justify-end">
                <button className="secondary min-h-10 px-3 py-1.5 text-sm" type="button" onClick={() => void saveBuildingSettings(selectedBuilding)} disabled={!hasChanges}>
                  Save building changes
                </button>
              </div>
            </div>
          </section>

          <div className="border-t border-[#e5e9e4] pt-5">
            <BuildingStructureView
              buildings={buildings}
              selectedBuildingId={selectedBuilding.id}
              buildingFloors={buildingFloors}
              units={units}
              areas={areas}
              unitTypes={unitTypes}
              unitTypeAreas={unitTypeAreas}
              onNotice={onNotice}
              reload={reload}
            />
          </div>
        </>
      )}

      <section className="grid gap-3 border-t border-[#e5e9e4] pt-5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-base font-semibold text-[#0F3D2E]">Other building actions</h3>
            <p className="text-sm text-[#617169]">Create another building when a new project needs to be added.</p>
          </div>
          <button className="secondary w-fit min-h-10 px-3 py-1.5 text-sm" type="button" onClick={() => setShowCreateBuilding((current) => !current)}>
            <Plus size={16} aria-hidden /> {showCreateBuilding ? "Hide add building" : "Add another building"}
          </button>
        </div>
        {showCreateBuilding && (
          <div className="grid gap-3 border-t border-[#e5e9e4] pt-4">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              <input className="field" value={buildingName} onChange={(event) => setBuildingName(event.target.value)} placeholder="Building name" />
              <input className="field" value={addressLine1} onChange={(event) => setAddressLine1(event.target.value)} placeholder="Address line 1" />
              <input className="field" value={addressLine2} onChange={(event) => setAddressLine2(event.target.value)} placeholder="Address line 2" />
              <input className="field" value={town} onChange={(event) => setTown(event.target.value)} placeholder="Town" />
              <input className="field" value={postcode} onChange={(event) => setPostcode(event.target.value)} placeholder="Postcode" />
              <label className="grid gap-1 text-sm font-medium text-[#34413a]">
                Expected PC date
                <input className="field" value={pcDate} onChange={(event) => setPcDate(event.target.value)} type="date" />
                <span className="text-xs font-normal text-[#617169]">Enter the expected Practical Completion date. The portal lifecycle will not start until PC is confirmed.</span>
              </label>
              <input className="field" value={photoUrl} onChange={(event) => setPhotoUrl(event.target.value)} placeholder="Building photo URL" />
              <input className="field" value={documentsUrl} onChange={(event) => setDocumentsUrl(event.target.value)} placeholder="Building documents link" />
              <input className="field" value={homeUserGuideUrl} onChange={(event) => setHomeUserGuideUrl(event.target.value)} placeholder="Home user guide link" />
              <label className="option-card min-h-11 px-3 py-2 md:col-span-2 xl:col-span-3">
                <input checked={allowResidentAccessRequests} onChange={(event) => setAllowResidentAccessRequests(event.target.checked)} type="checkbox" />
                Allow residents to request access for this building
              </label>
            </div>
            <button className="primary w-fit" onClick={createBuilding} disabled={!buildingName}>Create building</button>
          </div>
        )}
      </section>
    </section>
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
  onClose,
  onDirtyChange,
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
  onClose: () => void;
  onDirtyChange: (hasUnsavedChanges: boolean) => void;
}) {
  const [draft, setDraft] = useState<SnagDraft>(emptySnagDraft);
  const [isSaving, setIsSaving] = useState(false);
  const [cleanContextSignature, setCleanContextSignature] = useState(contextSignature(emptySnagDraft));
  const formRef = useRef<HTMLDivElement | null>(null);
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const selectedUnit = units.find((unit) => unit.id === draft.unitId);
  const selectedArea = areas.find((area) => area.id === draft.areaId);
  const selectedBuilding = buildings.find((building) => building.id === (draft.buildingId || selectedUnit?.building_id || selectedArea?.building_id));
  const availableFloors = buildingFloors
    .filter((floor) => floor.building_id === selectedBuilding?.id)
    .sort((a, b) => a.sort_order - b.sort_order);
  const buildingUnits = units
    .filter((unit) => draft.buildingId && unit.building_id === draft.buildingId)
    .filter((unit) => !draft.floor || unit.floor === draft.floor);
  const sortedBuildingUnits = sortUnitsByFloorOrder(buildingUnits, buildingFloors, draft.buildingId);
  const unitAreas = areas.filter((area) => area.unit_id === draft.unitId);
  const communalAreas = areas
    .filter((area) => area.area_type === "communal_area")
    .filter((area) => draft.buildingId && area.building_id === draft.buildingId)
    .filter((area) => !draft.floor || area.floor === draft.floor);
  const areaOptions = draft.locationType === "unit" ? unitAreas : communalAreas;
  const snagBuildingId = draft.locationType === "unit" ? selectedUnit?.building_id : selectedArea?.building_id ?? draft.buildingId;
  const snagUnitId = draft.locationType === "unit" ? draft.unitId : null;
  const hasUnsavedChanges = Boolean(
    draft.title.trim()
    || draft.description.trim()
    || draft.tradeId
    || draft.photoDataUrl
    || contextSignature(draft) !== cleanContextSignature,
  );

  useEffect(() => {
    onDirtyChange(hasUnsavedChanges);
  }, [hasUnsavedChanges, onDirtyChange]);

  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);

  function contextSignature(source: SnagDraft) {
    return [source.buildingId, source.floor, source.locationType, source.unitId, source.areaId].join("|");
  }

  function focusTitleWithoutJump(formTopBefore: number | null) {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        if (formRef.current && formTopBefore !== null) {
          const formTopAfter = formRef.current.getBoundingClientRect().top;
          window.scrollBy(0, formTopAfter - formTopBefore);
        }
        titleInputRef.current?.focus({ preventScroll: true });
      });
    });
  }

  function resetAndClose() {
    setCleanContextSignature(contextSignature(emptySnagDraft));
    setDraft(emptySnagDraft);
    onDirtyChange(false);
    onClose();
  }

  function cancelDraft() {
    if (hasUnsavedChanges && !window.confirm("Discard this unsaved snag?")) return;
    resetAndClose();
  }

  async function createDeveloperSnag(closeAfterSave: boolean) {
    if (isSaving) return;
    if (!draft.title || !draft.photoDataUrl || !draft.areaId || !snagBuildingId) {
      onNotice("Developer snags need a location, title and photo.");
      return;
    }

    if (draft.locationType === "unit" && !draft.unitId) {
      onNotice("Select a unit before adding a unit snag.");
      return;
    }

    setIsSaving(true);
    const savedDraft = draft;
    const formTopBefore = formRef.current?.getBoundingClientRect().top ?? null;
    const supabase = createSupabaseBrowserClient();
    try {
      const photoUrl = await uploadFile(savedDraft.photoDataUrl, "snags");
      const { data, error } = await supabase.from("snags").insert({
        building_id: snagBuildingId,
        unit_id: snagUnitId,
        area_id: savedDraft.areaId || null,
        source_type: "developer_snag",
        created_by: user.id,
        created_by_user_id: user.id,
        title: savedDraft.title.trim(),
        description: savedDraft.description.trim(),
        trade_id: savedDraft.tradeId || null,
        priority: null,
        priority_code: null,
        status: "open",
        sla_due_date: null,
      }).select("id").single();

      if (error) throw error;

      const { error: photoError } = await supabase.from("snag_photos").insert({ snag_id: data.id, file_url: photoUrl, photo_type: "annotated", uploaded_by_user_id: user.id });
      if (photoError) throw photoError;

      const { error: eventError } = await supabase.from("snag_events").insert({ snag_id: data.id, event_type: "created", new_value: "open", created_by_user_id: user.id });
      if (eventError) throw eventError;

      const nextDraft = {
        ...emptySnagDraft,
        buildingId: savedDraft.buildingId,
        floor: savedDraft.floor,
        locationType: savedDraft.locationType,
        unitId: savedDraft.unitId,
        areaId: savedDraft.areaId,
      };

      if (closeAfterSave) {
        setCleanContextSignature(contextSignature(emptySnagDraft));
        setDraft(emptySnagDraft);
        onDirtyChange(false);
        onNotice("Snag added.");
      } else {
        setCleanContextSignature(contextSignature(nextDraft));
        setDraft(nextDraft);
        onNotice("Snag added. Ready for the next one.");
      }

      await reload();
      if (closeAfterSave) {
        onClose();
      } else {
        focusTitleWithoutJump(formTopBefore);
      }
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Unable to add snag. Please try again.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div ref={formRef} className="max-w-xl">
      <FormPanel title="Add developer snag">
        <select className="field" value={draft.buildingId} onChange={(event) => setDraft({ ...draft, buildingId: event.target.value, floor: "", unitId: "", areaId: "" })} disabled={isSaving}>
          <option value="">Select building</option>
          {buildings.map((building) => <option key={building.id} value={building.id}>{building.name}</option>)}
        </select>
        <select className={`field ${draft.floor ? "filter-active" : ""}`} value={draft.floor} onChange={(event) => setDraft({ ...draft, floor: event.target.value, unitId: "", areaId: "" })} disabled={isSaving || !draft.buildingId}>
          <option value="">All floors</option>
          {availableFloors.map((floor) => <option key={floor.id} value={floor.name}>{floor.name}</option>)}
        </select>
        <div className="grid grid-cols-2 gap-2">
          <button
            className={draft.locationType === "unit" ? "primary" : "secondary"}
            onClick={() => setDraft({ ...draft, locationType: "unit", areaId: "" })}
            disabled={isSaving || !draft.buildingId}
            type="button"
          >
            Unit
          </button>
          <button
            className={draft.locationType === "communal" ? "primary" : "secondary"}
            onClick={() => setDraft({ ...draft, locationType: "communal", unitId: "", areaId: "" })}
            disabled={isSaving || !draft.buildingId}
            type="button"
          >
            Communal
          </button>
        </div>
        {draft.locationType === "unit" && (
          <select className="field" value={draft.unitId} onChange={(event) => setDraft({ ...draft, unitId: event.target.value, areaId: "" })} disabled={isSaving || !draft.buildingId}>
            <option value="">Select unit</option>
            {sortedBuildingUnits.map((unit) => <option key={unit.id} value={unit.id}>{unit.unit_number}</option>)}
          </select>
        )}
        <select className="field" value={draft.areaId} onChange={(event) => setDraft({ ...draft, areaId: event.target.value })} disabled={isSaving || !draft.buildingId || (draft.locationType === "unit" && !draft.unitId)}>
          <option value="">{draft.locationType === "unit" ? "Select room / private area" : "Select communal area"}</option>
          {areaOptions.map((area) => (
            <option key={area.id} value={area.id}>
              {area.name}{area.floor && draft.locationType === "communal" ? ` / ${area.floor}` : ""}
            </option>
          ))}
        </select>
        <input ref={titleInputRef} className="field" value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} maxLength={50} placeholder="Title" disabled={isSaving || !draft.buildingId} />
        <textarea className="field min-h-24 py-3" value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} placeholder="Description" disabled={isSaving || !draft.buildingId} />
        <select className="field" value={draft.tradeId} onChange={(event) => setDraft({ ...draft, tradeId: event.target.value })} disabled={isSaving || !draft.buildingId}>
          <option value="">Trade</option>
          {trades.length === 0 && <option value="" disabled>No trades configured</option>}
          {trades.map((trade) => <option key={trade.id} value={trade.id}>{trade.name}</option>)}
        </select>
        <PhotoInput value={draft.photoDataUrl} onChange={(photoDataUrl) => setDraft({ ...draft, photoDataUrl })} disabled={isSaving || !draft.buildingId} />
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <button className="primary" onClick={() => createDeveloperSnag(false)} disabled={isSaving || !draft.buildingId || !draft.areaId || !draft.title.trim() || !draft.photoDataUrl} type="button">
            <Plus size={16} aria-hidden /> {isSaving ? "Saving..." : "Save and add another"}
          </button>
          <button className="secondary" onClick={() => createDeveloperSnag(true)} disabled={isSaving || !draft.buildingId || !draft.areaId || !draft.title.trim() || !draft.photoDataUrl} type="button">
            Save and close
          </button>
          <button className="snag-action-link justify-center px-2" onClick={cancelDraft} disabled={isSaving} type="button">
            Cancel
          </button>
        </div>
      </FormPanel>
    </div>
  );
}

function UserAdmin({
  buildings,
  units,
  organisations,
  profiles,
  accessRequests,
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
  accessRequests: ResidentAccessRequest[];
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
          accessRequests={accessRequests}
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

function requestUnitsLabel(request: ResidentAccessRequest) {
  if (request.requested_units.length === 0) return "No flats";
  return request.requested_units
    .map((unit) => `${unit.building_name} ${unit.unit_number}`)
    .join(", ");
}

type AccessListFilter = "all" | "pending_requests" | "active_users" | "deactivated_users" | "rejected_requests";

type AccessListRow = {
  id: string;
  key: string;
  kind: "profile" | "request";
  name: string;
  email: string;
  typeLabel: string;
  status: "active" | "deactivated" | "pending" | "approved" | "rejected";
  roleLabel: string;
  phone: string;
  allocation: string;
  createdAt: string | null;
  sortRank: number;
  profile?: Profile;
  request?: ResidentAccessRequest;
};

function UserDirectory({
  buildings,
  units,
  organisations,
  profiles,
  accessRequests,
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
  accessRequests: ResidentAccessRequest[];
  userBuildingAccess: UserBuildingAccess[];
  userUnitAccess: UserUnitAccess[];
  editingUserId: string;
  recordAudit: (event: Omit<AuditEvent, "id" | "created_at" | "created_by_user_id">) => Promise<void>;
  onAddUser: () => void;
  onEditUser: (userId: string) => void;
  onNotice: (notice: string) => void;
  reload: () => Promise<void>;
}) {
  const [filter, setFilter] = useState<AccessListFilter>("all");
  const [selectedRequestId, setSelectedRequestId] = useState("");

  function userStatus(profile: Profile) {
    return profile.active === false ? "deactivated" : "active";
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

  function matchingProfile(request: ResidentAccessRequest) {
    return profiles.find((profile) => profile.email?.toLowerCase() === request.email.toLowerCase());
  }

  const rows: AccessListRow[] = (() => {
    const profileEmailSet = new Set(profiles.map((profile) => profile.email.toLowerCase()));
    const profileRows: AccessListRow[] = profiles.map((profile) => {
      const status = userStatus(profile);
      return {
        id: profile.id,
        key: `profile-${profile.id}`,
        kind: "profile",
        name: profile.full_name || profile.name || "No name",
        email: profile.email,
        typeLabel: "User",
        status,
        roleLabel: profile.role === "resident" && profile.resident_type ? statusLabel(profile.resident_type) : statusLabel(profile.role),
        phone: profile.phone || "",
        allocation: allocationLabel(profile),
        createdAt: profile.created_at ?? null,
        sortRank: status === "active" ? 1 : 2,
        profile,
      };
    });

    const requestRows: AccessListRow[] = accessRequests
      .filter((request) => request.status !== "approved" || !profileEmailSet.has(request.email.toLowerCase()))
      .map((request) => ({
      id: request.id,
      key: `request-${request.id}`,
      kind: "request",
      name: request.full_name,
      email: request.email,
      typeLabel: "Access request",
      status: request.status,
      roleLabel: statusLabel(request.resident_type),
      phone: request.phone,
      allocation: requestUnitsLabel(request),
      createdAt: request.created_at,
      sortRank: request.status === "pending" ? 0 : request.status === "approved" ? 3 : 4,
      request,
    }));

    return [...profileRows, ...requestRows].sort((a, b) => (
      a.sortRank - b.sortRank || new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime()
    ));
  })();

  const filteredRows = rows.filter((row) => {
    if (filter === "pending_requests") return row.kind === "request" && row.status === "pending";
    if (filter === "active_users") return row.kind === "profile" && row.status === "active";
    if (filter === "deactivated_users") return row.kind === "profile" && row.status === "deactivated";
    if (filter === "rejected_requests") return row.kind === "request" && row.status === "rejected";
    return true;
  });

  const filters: { value: AccessListFilter; label: string; count: number }[] = [
    { value: "all", label: "All", count: rows.length },
    { value: "pending_requests", label: "Pending requests", count: rows.filter((row) => row.kind === "request" && row.status === "pending").length },
    { value: "active_users", label: "Active users", count: profiles.filter((profile) => profile.active !== false).length },
    { value: "deactivated_users", label: "Deactivated users", count: profiles.filter((profile) => profile.active === false).length },
    { value: "rejected_requests", label: "Rejected requests", count: rows.filter((row) => row.kind === "request" && row.status === "rejected").length },
  ];

  function toggleProfile(profileId: string) {
    setSelectedRequestId("");
    onEditUser(editingUserId === profileId ? "" : profileId);
  }

  function toggleRequest(requestId: string) {
    onEditUser("");
    setSelectedRequestId(selectedRequestId === requestId ? "" : requestId);
  }

  function rowAction(row: AccessListRow) {
    if (row.kind === "profile") return editingUserId === row.id ? "Close" : "Edit";
    if (row.status === "pending") return selectedRequestId === row.id ? "Close" : "Review";
    return selectedRequestId === row.id ? "Close" : "View";
  }

  function rowActionIcon(row: AccessListRow, isOpen: boolean) {
    if (isOpen) return <X size={16} strokeWidth={2.25} aria-hidden />;
    if (row.kind === "profile") return <Pencil size={16} strokeWidth={2.25} aria-hidden />;
    if (row.status === "pending") return <ClipboardCheck size={16} strokeWidth={2.25} aria-hidden />;
    return <ClipboardList size={16} strokeWidth={2.25} aria-hidden />;
  }

  function requestPanel(request: ResidentAccessRequest) {
    return (
      <AccessRequestReviewPanel
        request={request}
        existingProfile={matchingProfile(request)}
        buildings={buildings}
        units={units}
        userBuildingAccess={userBuildingAccess}
        userUnitAccess={userUnitAccess}
        profiles={profiles}
        recordAudit={recordAudit}
        onClose={() => setSelectedRequestId("")}
        onNotice={onNotice}
        reload={reload}
      />
    );
  }

  return (
    <section className="panel min-w-0 overflow-hidden p-0">
      <div className="grid gap-3 border-b border-[#d9ded6] px-4 py-3 sm:flex sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-lg font-bold text-[#0F3D2E]">Access & users</h2>
          <p className="break-words text-sm text-[#617169]">Manage access requests, portal users and account status.</p>
        </div>
        <button className="primary min-h-9 w-full px-3 py-1.5 text-sm sm:w-auto" onClick={onAddUser}>
          <Plus size={16} /> Add user
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2 border-b border-[#e5e9e4] px-4 py-3 sm:flex sm:flex-wrap">
        {filters.map((item) => (
          <button
            key={item.value}
            className={`chip-button min-w-0 justify-center whitespace-normal text-center text-sm leading-tight ${filter === item.value ? "chip-button-active" : ""}`}
            onClick={() => {
              setFilter(item.value);
              setSelectedRequestId("");
              onEditUser("");
            }}
          >
            {item.label} ({item.count})
          </button>
        ))}
      </div>

      <div className="grid min-w-0 gap-3 bg-[#F7F5EF] p-3 md:hidden">
        {filteredRows.map((row) => {
          const isOpen = row.kind === "profile" ? editingUserId === row.id : selectedRequestId === row.id;
          const isMuted = row.status === "deactivated" || row.status === "rejected";

          return (
            <article key={row.key} className={`mobile-card ${isOpen ? "mobile-card-active" : ""} ${isMuted ? "opacity-60 grayscale" : ""}`}>
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
                <div className="min-w-0">
                  <p className="truncate font-bold text-[#1F2A24]">{row.name}</p>
                  <p className="mt-0.5 truncate text-sm text-[#66736B]">{row.email}</p>
                </div>
                <div className="flex max-w-[8.5rem] flex-col items-end gap-1">
                  <span className={statusTone(row.status)}>{statusLabel(row.status)}</span>
                  <span className="rounded-md bg-white px-2 py-1 text-right text-xs font-semibold leading-tight text-[#617169]">{row.typeLabel}</span>
                </div>
              </div>
              <div className="mt-3 grid gap-2 text-sm">
                <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-3"><span className="text-[#66736B]">Role/type</span><span className="min-w-0 break-words text-right font-medium">{row.roleLabel}</span></div>
                <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-3"><span className="text-[#66736B]">Phone</span><span className="min-w-0 break-words text-right font-medium">{row.phone || "None"}</span></div>
                <div><span className="text-[#66736B]">Allocation</span><p className="mt-1 break-words text-[#1F2A24]">{row.allocation}</p></div>
                <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-3"><span className="text-[#66736B]">Created/submitted</span><span className="min-w-0 text-right font-medium">{row.createdAt ? formatDate(row.createdAt) : "Unknown"}</span></div>
              </div>
              <div className="mt-3 flex justify-end gap-2">
                <button
                  className="secondary icon-button"
                  onClick={() => row.kind === "profile" ? toggleProfile(row.id) : toggleRequest(row.id)}
                  aria-label={`${rowAction(row)} ${row.email}`}
                  title={rowAction(row)}
                >
                  {rowActionIcon(row, isOpen)}
                </button>
              </div>
              {isOpen && row.profile && (
                <div className="mt-3 border-t border-[#E2DED3] pt-3">
                  <UserEditPanel
                    profile={row.profile}
                    buildings={buildings}
                    units={units}
                    organisations={organisations}
                    profiles={profiles}
                    accessRequests={accessRequests}
                    userBuildingAccess={userBuildingAccess.filter((access) => access.user_id === row.profile?.id)}
                    userUnitAccess={userUnitAccess.filter((access) => access.user_id === row.profile?.id)}
                    recordAudit={recordAudit}
                    onClose={() => onEditUser("")}
                    onNotice={onNotice}
                    reload={reload}
                  />
                </div>
              )}
              {isOpen && row.request && <div className="mt-3 border-t border-[#E2DED3] pt-3">{requestPanel(row.request)}</div>}
            </article>
          );
        })}
        {filteredRows.length === 0 && <p className="mobile-empty">No matching access records.</p>}
      </div>

      <div className="hidden overflow-x-auto md:block">
        <table className="min-w-[1120px] w-full border-separate border-spacing-0 text-sm">
          <thead>
            <tr className="text-left text-xs font-semibold uppercase text-[#617169]">
              <th className="border-b border-[#d9ded6] px-3 py-2">Person</th>
              <th className="border-b border-[#d9ded6] px-3 py-2">Type</th>
              <th className="border-b border-[#d9ded6] px-3 py-2">Status</th>
              <th className="border-b border-[#d9ded6] px-3 py-2">Role or resident type</th>
              <th className="border-b border-[#d9ded6] px-3 py-2">Phone</th>
              <th className="border-b border-[#d9ded6] px-3 py-2">Allocation / requested flats</th>
              <th className="border-b border-[#d9ded6] px-3 py-2">Created / submitted</th>
              <th className="border-b border-[#d9ded6] px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.map((row) => {
              const isOpen = row.kind === "profile" ? editingUserId === row.id : selectedRequestId === row.id;
              const isMuted = row.status === "deactivated" || row.status === "rejected";

              return (
                <Fragment key={row.key}>
                  <tr className={`${isOpen ? "bg-[#fff8ec]" : ""} ${isMuted ? "opacity-60 grayscale" : ""}`}>
                    <td className="border-b border-[#e5e9e4] px-3 py-3 align-middle">
                      <p className="font-medium">{row.name}</p>
                      <p className="text-xs text-[#617169]">{row.email}</p>
                    </td>
                    <td className="border-b border-[#e5e9e4] px-3 py-3 align-middle">{row.typeLabel}</td>
                    <td className="border-b border-[#e5e9e4] px-3 py-3 align-middle">
                      <span className={statusTone(row.status)}>{statusLabel(row.status)}</span>
                    </td>
                    <td className="border-b border-[#e5e9e4] px-3 py-3 align-middle">{row.roleLabel}</td>
                    <td className="border-b border-[#e5e9e4] px-3 py-3 align-middle">{row.phone || <span className="text-xs text-[#9aa59f]">None</span>}</td>
                    <td className="border-b border-[#e5e9e4] px-3 py-3 align-middle">
                      <p className="max-w-md truncate">{row.allocation}</p>
                    </td>
                    <td className="border-b border-[#e5e9e4] px-3 py-3 align-middle whitespace-nowrap">{row.createdAt ? formatDate(row.createdAt) : "Unknown"}</td>
                    <td className="border-b border-[#e5e9e4] px-3 py-3 align-middle">
                      <div className="flex justify-end gap-2">
                        <button
                          className="secondary icon-button"
                          onClick={() => row.kind === "profile" ? toggleProfile(row.id) : toggleRequest(row.id)}
                          aria-label={`${rowAction(row)} ${row.email}`}
                          title={rowAction(row)}
                        >
                          {rowActionIcon(row, isOpen)}
                        </button>
                      </div>
                    </td>
                  </tr>
                  {isOpen && row.profile && (
                    <tr>
                      <td colSpan={8} className="border-b border-[#d9ded6] bg-[#fff8ec] p-3">
                        <UserEditPanel
                          profile={row.profile}
                          buildings={buildings}
                          units={units}
                          organisations={organisations}
                          profiles={profiles}
                          accessRequests={accessRequests}
                          userBuildingAccess={userBuildingAccess.filter((access) => access.user_id === row.profile?.id)}
                          userUnitAccess={userUnitAccess.filter((access) => access.user_id === row.profile?.id)}
                          recordAudit={recordAudit}
                          onClose={() => onEditUser("")}
                          onNotice={onNotice}
                          reload={reload}
                        />
                      </td>
                    </tr>
                  )}
                  {isOpen && row.request && (
                    <tr>
                      <td colSpan={8} className="border-b border-[#d9ded6] bg-[#fff8ec] p-3">
                        {requestPanel(row.request)}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
        {filteredRows.length === 0 && <p className="p-4 text-sm text-[#617169]">No matching access records.</p>}
      </div>
    </section>
  );
}

function AccessRequestReviewPanel({
  request,
  existingProfile,
  buildings,
  units,
  userBuildingAccess,
  userUnitAccess,
  profiles,
  recordAudit,
  onClose,
  onNotice,
  reload,
}: {
  request: ResidentAccessRequest;
  existingProfile?: Profile;
  buildings: Building[];
  units: Unit[];
  userBuildingAccess: UserBuildingAccess[];
  userUnitAccess: UserUnitAccess[];
  profiles: Profile[];
  recordAudit: (event: Omit<AuditEvent, "id" | "created_at" | "created_by_user_id">) => Promise<void>;
  onClose: () => void;
  onNotice: (notice: string) => void;
  reload: () => Promise<void>;
}) {
  const [adminNotes, setAdminNotes] = useState(request.admin_notes ?? "");
  const [isSaving, setIsSaving] = useState<"approve" | "reject" | "notes" | null>(null);
  const reviewer = request.reviewed_by_user_id ? profiles.find((profile) => profile.id === request.reviewed_by_user_id) : undefined;
  const existingProfileLabel = existingProfile
    ? `Existing portal user found: ${existingProfile.active === false ? "Deactivated" : "Active"}`
    : "No existing portal user found";
  const isPending = request.status === "pending";
  const existingProfileUnitIds = new Set(
    existingProfile
      ? userUnitAccess.filter((access) => access.user_id === existingProfile.id).map((access) => access.unit_id)
      : [],
  );
  const existingProfileBuildingIds = existingProfile
    ? userBuildingAccess.filter((access) => access.user_id === existingProfile.id).map((access) => access.building_id)
    : [];
  const currentFlatLabels = existingProfile
    ? Array.from(existingProfileUnitIds).map((unitId) => {
      const unit = units.find((item) => item.id === unitId);
      const building = buildings.find((item) => item.id === unit?.building_id);
      return unit ? `${building?.name ?? "Building"} ${unit.unit_number}${unit.floor ? ` / ${unit.floor}` : ""}` : "";
    }).filter(Boolean)
    : [];
  const currentBuildingLabels = existingProfileBuildingIds
    .map((buildingId) => buildings.find((building) => building.id === buildingId)?.name)
    .filter(Boolean);
  const currentAllocation = existingProfile?.role === "admin" || existingProfile?.role === "developer"
    ? "All buildings"
    : currentFlatLabels.length > 0
      ? currentFlatLabels.join(", ")
      : currentBuildingLabels.length > 0
        ? currentBuildingLabels.join(", ")
        : "No access currently assigned";
  const duplicateRequestedUnits = request.requested_units.filter((unit) => existingProfileUnitIds.has(unit.unit_id));
  const allRequestedUnitsAreDuplicates = request.requested_units.length > 0 && duplicateRequestedUnits.length === request.requested_units.length;
  const approveButtonLabel = existingProfile ? "Approve and update user" : "Approve and create user";

  async function saveAdminNotes() {
    setIsSaving("notes");
    onNotice("");

    try {
      const supabase = createSupabaseBrowserClient();
      const { data } = await supabase.auth.getSession();
      const response = await fetch("/api/access-requests", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${data.session?.access_token ?? ""}`,
        },
        body: JSON.stringify({
          requestId: request.id,
          action: "save_notes",
          adminNotes,
        }),
      });
      const payload = (await response.json()) as { error?: string };

      if (!response.ok) {
        onNotice(payload.error ?? "Could not save notes.");
        return;
      }

      await recordAudit({
        event_type: "access_request_notes_updated",
        entity_type: "resident_access_request",
        entity_id: request.id,
        summary: `Access request notes updated: ${request.email}`,
        metadata: {
          email: request.email,
          status: request.status,
        },
      });
      onNotice(`Notes saved for ${request.email}.`);
      await reload();
    } finally {
      setIsSaving(null);
    }
  }

  async function reviewRequest(action: "approve" | "reject") {
    const verb = action === "approve" ? "approve" : "reject";
    if (!window.confirm(`${verb.charAt(0).toUpperCase()}${verb.slice(1)} access request for ${request.full_name}?`)) return;

    setIsSaving(action);
    onNotice("");

    try {
      const supabase = createSupabaseBrowserClient();
      const { data } = await supabase.auth.getSession();
      const response = await fetch("/api/access-requests", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${data.session?.access_token ?? ""}`,
        },
        body: JSON.stringify({
          requestId: request.id,
          action,
          adminNotes,
        }),
      });
      const payload = (await response.json()) as { error?: string; email?: string; invited?: boolean; userId?: string };

      if (!response.ok) {
        onNotice(payload.error ?? `Could not ${verb} request.`);
        return;
      }

      await recordAudit({
        event_type: action === "approve" ? "access_request_approved" : "access_request_rejected",
        entity_type: "resident_access_request",
        entity_id: request.id,
        summary: action === "approve" ? `Access request approved: ${request.email}` : `Access request rejected: ${request.email}`,
        metadata: {
          email: request.email,
          residentType: request.resident_type,
          requestedUnits: request.requested_units,
          invited: payload.invited ?? false,
          userId: payload.userId ?? null,
        },
      });
      onNotice(action === "approve"
        ? `${request.email} approved${payload.invited ? " and invited" : ""}.`
        : `${request.email} request rejected.`);
      onClose();
      await reload();
    } finally {
      setIsSaving(null);
    }
  }

  return (
    <div className="rounded-md border border-[#d9ded6] bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold">{isPending ? "Review access request" : "Access request"}</h3>
          <p className="text-sm text-[#617169]">{request.email}</p>
        </div>
        <span className={statusTone(request.status)}>{statusLabel(request.status)}</span>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <InfoRow label="Name" value={request.full_name} />
        <InfoRow label="Email" value={request.email} />
        <InfoRow label="Phone" value={request.phone} />
        <InfoRow label="Resident type" value={statusLabel(request.resident_type)} />
        <InfoRow label="Submitted" value={formatDate(request.created_at)} />
        <InfoRow label="Existing profile" value={existingProfileLabel} />
        {existingProfile && <InfoRow label="Existing role" value={statusLabel(existingProfile.role)} />}
        {existingProfile && <InfoRow label="Current access" value={currentAllocation} />}
        {!isPending && <InfoRow label="Reviewed" value={request.reviewed_at ? formatDate(request.reviewed_at) : "Not recorded"} />}
        {!isPending && <InfoRow label="Reviewer" value={reviewer?.full_name || reviewer?.name || reviewer?.email || "Not recorded"} />}
      </div>

      <div className="form-section mt-4">
        <h4 className="text-sm font-bold text-[#0F3D2E]">Requested flats</h4>
        <div className="mt-3 flex flex-wrap gap-2">
          {request.requested_units.map((unit) => (
            <span key={`${unit.building_id}-${unit.unit_id}`} className="rounded-md bg-[#edf4f1] px-2 py-1 text-xs font-medium text-[#0F3D2E]">
              {unit.building_name} {unit.unit_number}{unit.floor ? ` / ${unit.floor}` : ""}
              {existingProfileUnitIds.has(unit.unit_id) ? " - already assigned" : ""}
            </span>
          ))}
          {request.requested_units.length === 0 && <p className="text-sm text-[#617169]">No flats requested.</p>}
        </div>
        {duplicateRequestedUnits.length > 0 && (
          <p className="mt-3 rounded-md border border-[#E5C27B] bg-[#FFF8E8] px-3 py-2 text-sm text-[#7A5A1F]">
            {allRequestedUnitsAreDuplicates
              ? "This user already has access to every flat on this request."
              : "Some requested flats are already assigned to this user. Only new flats will be added."}
          </p>
        )}
      </div>

      {request.notes && (
        <div className="form-section mt-4">
          <h4 className="text-sm font-bold text-[#0F3D2E]">Requester notes</h4>
          <p className="mt-2 text-sm text-[#1F2A24]">{request.notes}</p>
        </div>
      )}

      <label className="field-label mt-4">
        Admin notes
        <textarea className="field min-h-20 py-3" value={adminNotes} onChange={(event) => setAdminNotes(event.target.value)} />
      </label>
      <div className="mt-3 flex justify-end">
        <button className="secondary" onClick={() => void saveAdminNotes()} disabled={Boolean(isSaving)}>
          {isSaving === "notes" ? "Saving notes" : "Save notes"}
        </button>
      </div>

      {isPending && (
        <div className="mt-3 flex flex-wrap justify-end gap-2">
          <button className="secondary" onClick={() => void reviewRequest("reject")} disabled={Boolean(isSaving)}>
            {isSaving === "reject" ? "Rejecting" : "Reject request"}
          </button>
          <button className="primary" onClick={() => void reviewRequest("approve")} disabled={Boolean(isSaving) || allRequestedUnitsAreDuplicates}>
            {isSaving === "approve" ? "Approving" : approveButtonLabel}
          </button>
        </div>
      )}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-bold uppercase tracking-[0.12em] text-[#66736B]">{label}</p>
      <p className="mt-1 text-sm font-medium text-[#1F2A24]">{value || "None"}</p>
    </div>
  );
}

function UserEditPanel({
  profile,
  buildings,
  units,
  organisations,
  profiles,
  accessRequests,
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
  profiles: Profile[];
  accessRequests: ResidentAccessRequest[];
  userBuildingAccess: UserBuildingAccess[];
  userUnitAccess: UserUnitAccess[];
  recordAudit: (event: Omit<AuditEvent, "id" | "created_at" | "created_by_user_id">) => Promise<void>;
  onClose: () => void;
  onNotice: (notice: string) => void;
  reload: () => Promise<void>;
}) {
  const [fullName, setFullName] = useState(profile.full_name || profile.name || "");
  const [phone, setPhone] = useState(profile.phone ?? "");
  const [role, setRole] = useState<AppRole>(profile.role);
  const [residentType, setResidentType] = useState<ResidentType>(profile.resident_type ?? "leaseholder");
  const [organisationId, setOrganisationId] = useState(profile.organisation_id ?? "");
  const [selectedBuildingIds, setSelectedBuildingIds] = useState<string[]>(userBuildingAccess.map((access) => access.building_id));
  const [flatAccessRows, setFlatAccessRows] = useState<FlatAccessDraft[]>(() => flatAccessRowsFromUnitIds(userUnitAccess.map((access) => access.unit_id), units));
  const [isSaving, setIsSaving] = useState(false);
  const [isSendingLoginReminder, setIsSendingLoginReminder] = useState(false);
  const [isSendingPasswordReset, setIsSendingPasswordReset] = useState(false);
  const [isStatusChanging, setIsStatusChanging] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const isResident = role === "resident";
  const isActive = profile.active !== false;
  const hasEmail = Boolean(profile.email?.trim());
  const needsOrganisationAndBuilding = role === "developer_representative" || role === "contractor";
  const organisationsForRole = organisations.filter((organisation) => organisation.type === role);
  const selectedUnitIds = selectedUnitIdsFromFlatRows(flatAccessRows);
  const selectedUnits = units.filter((unit) => selectedUnitIds.includes(unit.id));
  const selectedResidentBuildingIds = Array.from(new Set(selectedUnits.map((unit) => unit.building_id)));
  const buildingIdsForSave = isResident ? selectedResidentBuildingIds : selectedBuildingIds;
  const accessSummary = roleAccessSummary(role);
  const requestHistory = accessRequests.filter((request) => request.email.toLowerCase() === profile.email.toLowerCase());
  const canSave = Boolean(
    fullName &&
    (!isResident || residentType) &&
    (!needsOrganisationAndBuilding || (organisationId && selectedBuildingIds.length > 0)),
  );

  function toggleBuilding(buildingId: string) {
    setSelectedBuildingIds((current) => (
      current.includes(buildingId) ? current.filter((item) => item !== buildingId) : [...current, buildingId]
    ));
  }

  async function saveUser() {
    if (!canSave) {
      onNotice("Complete the required fields before saving.");
      return;
    }
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
          phone,
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
          phone,
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
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Could not update user.");
    } finally {
      setIsSaving(false);
    }
  }

  async function sendUserAction(action: "send_login_reminder" | "send_password_reset") {
    if (!hasEmail) {
      onNotice("This user does not have an email address.");
      return;
    }

    if (action === "send_login_reminder") setIsSendingLoginReminder(true);
    else setIsSendingPasswordReset(true);
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
        body: JSON.stringify({ userId: profile.id, action }),
      });
      const payload = (await response.json()) as { error?: string; email?: string };

      if (!response.ok) {
        onNotice(payload.error ?? "Could not send email.");
        return;
      }

      await recordAudit({
        event_type: action,
        entity_type: "user",
        entity_id: profile.id,
        summary: action === "send_login_reminder" ? `Login reminder sent: ${profile.email}` : `Password reset sent: ${profile.email}`,
        metadata: { email: profile.email },
      });
      onNotice(action === "send_login_reminder" ? `Login reminder sent to ${profile.email}.` : `Password reset link sent to ${profile.email}.`);
    } finally {
      if (action === "send_login_reminder") setIsSendingLoginReminder(false);
      else setIsSendingPasswordReset(false);
    }
  }

  async function changeUserStatus() {
    const nextActive = !isActive;
    const label = profile.full_name || profile.name || profile.email;
    const verb = nextActive ? "reactivate" : "deactivate";
    if (!window.confirm(`${verb.charAt(0).toUpperCase()}${verb.slice(1)} ${label}?`)) return;

    setIsStatusChanging(true);
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
        body: JSON.stringify({ userId: profile.id, action: "status", active: nextActive }),
      });
      const payload = (await response.json()) as { error?: string; email?: string; active?: boolean };

      if (!response.ok) {
        onNotice(payload.error ?? `Could not ${verb} user.`);
        return;
      }

      await recordAudit({
        event_type: nextActive ? "user_reactivated" : "user_deactivated",
        entity_type: "user",
        entity_id: profile.id,
        summary: nextActive ? `User reactivated: ${profile.email}` : `User deactivated: ${profile.email}`,
        metadata: { email: profile.email, active: nextActive },
      });
      onNotice(nextActive ? `${profile.email} reactivated.` : `${profile.email} deactivated.`);
      await reload();
    } finally {
      setIsStatusChanging(false);
    }
  }

  async function deleteUser() {
    const label = profile.full_name || profile.name || profile.email;
    if (!window.confirm(`Permanently delete user ${label}? This should only be used for mistaken or test accounts.`)) return;

    setIsDeleting(true);
    onNotice("");

    try {
      const supabase = createSupabaseBrowserClient();
      const { data } = await supabase.auth.getSession();
      const response = await fetch("/api/admin/users", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${data.session?.access_token ?? ""}`,
        },
        body: JSON.stringify({ userId: profile.id }),
      });
      const payload = (await response.json()) as { error?: string; id?: string; email?: string; deletedAccessRequests?: ResidentAccessRequest[] };

      if (!response.ok) {
        onNotice(payload.error ?? "Could not delete user.");
        return;
      }

      await recordAudit({
        event_type: "user_deleted",
        entity_type: "user",
        entity_id: profile.id,
        summary: `User deleted: ${profile.email}`,
        metadata: {
          email: profile.email,
          role: profile.role,
          deletedAccessRequests: payload.deletedAccessRequests ?? [],
        },
      });
      onNotice(`Deleted ${profile.email}.`);
      onClose();
      await reload();
    } finally {
      setIsDeleting(false);
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
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <label className="field-label">
            Name
            <input className="field" value={fullName} onChange={(event) => setFullName(event.target.value)} placeholder="Name" />
          </label>
          <label className="field-label">
            Email
            <input className="field" value={profile.email} disabled />
          </label>
          <label className="field-label">
            Phone
            <input className="field" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="Phone number" />
          </label>
          <label className="field-label">
            Role
            <select
              className="field"
              value={role}
              onChange={(event) => {
                const nextRole = event.target.value as AppRole;
                setRole(nextRole);
                if (nextRole !== "resident") {
                  setResidentType("leaseholder");
                  setFlatAccessRows(emptyFlatAccessRows());
                }
                if (nextRole === "resident") setFlatAccessRows((current) => current.length > 0 ? current : emptyFlatAccessRows());
                setOrganisationId("");
                setSelectedBuildingIds([]);
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
              <span className="text-xs font-normal normal-case tracking-normal text-[#617169]">Resident type is for admin context only. Access is controlled by the flats selected below.</span>
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
        {accessSummary && <AccessSummary message={accessSummary} />}
        {needsOrganisationAndBuilding && (
          <AccessBuildingPicker buildings={buildings} selectedBuildingIds={selectedBuildingIds} onToggle={toggleBuilding} />
        )}
        {isResident && (
          <FlatAccessRowsPicker buildings={buildings} units={units} rows={flatAccessRows} onChange={setFlatAccessRows} />
        )}
        <button className="primary mt-4 w-full" onClick={saveUser} disabled={isSaving || !canSave}>
          {isSaving ? "Saving changes" : "Save changes"}
        </button>

        <div className="form-section mt-4">
          <h4 className="text-sm font-bold text-[#0F3D2E]">Account access</h4>
          <div className="mt-3 flex flex-wrap gap-2">
            <button className="secondary" onClick={() => void sendUserAction("send_login_reminder")} disabled={!hasEmail || isSendingLoginReminder}>
              {isSendingLoginReminder ? "Sending reminder" : "Send login reminder"}
            </button>
            <button className="secondary" onClick={() => void sendUserAction("send_password_reset")} disabled={!hasEmail || isSendingPasswordReset}>
              {isSendingPasswordReset ? "Sending reset" : "Send password reset link"}
            </button>
          </div>
        </div>

        <div className="form-section mt-4">
          <h4 className="text-sm font-bold text-[#0F3D2E]">User status</h4>
          <p className="mt-1 text-sm text-[#617169]">Status: <span className="font-semibold text-[#1F2A24]">{isActive ? "Active" : "Deactivated"}</span></p>
          <button className="secondary mt-3" onClick={() => void changeUserStatus()} disabled={isStatusChanging}>
            {isStatusChanging ? "Updating status" : isActive ? "Deactivate user" : "Reactivate user"}
          </button>
        </div>

        <div className="form-section mt-4">
          <h4 className="text-sm font-bold text-[#0F3D2E]">Access request history</h4>
          <div className="mt-3 grid gap-3">
            {requestHistory.map((request) => {
              const reviewer = request.reviewed_by_user_id ? profiles.find((item) => item.id === request.reviewed_by_user_id) : undefined;
              return (
                <div key={request.id} className="rounded-md border border-[#e5e9e4] bg-[#FBFAF6] p-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <span className={statusTone(request.status)}>{statusLabel(request.status)}</span>
                      <p className="mt-2 text-sm font-semibold text-[#1F2A24]">{requestUnitsLabel(request)}</p>
                    </div>
                    <p className="text-xs text-[#617169]">Submitted {formatDate(request.created_at)}</p>
                  </div>
                  <div className="mt-3 grid gap-2 text-sm md:grid-cols-2">
                    <p><span className="font-semibold text-[#0F3D2E]">Phone:</span> {request.phone || "None"}</p>
                    <p><span className="font-semibold text-[#0F3D2E]">Reviewed:</span> {request.reviewed_at ? formatDate(request.reviewed_at) : "Not reviewed"}</p>
                    <p><span className="font-semibold text-[#0F3D2E]">Reviewer:</span> {reviewer?.full_name || reviewer?.name || reviewer?.email || "Not recorded"}</p>
                    <p><span className="font-semibold text-[#0F3D2E]">Resident type:</span> {statusLabel(request.resident_type)}</p>
                  </div>
                  {request.notes && <p className="mt-3 text-sm text-[#1F2A24]"><span className="font-semibold text-[#0F3D2E]">Requester notes:</span> {request.notes}</p>}
                  {request.admin_notes && <p className="mt-2 text-sm text-[#1F2A24]"><span className="font-semibold text-[#0F3D2E]">Admin notes:</span> {request.admin_notes}</p>}
                </div>
              );
            })}
            {requestHistory.length === 0 && <p className="text-sm text-[#617169]">No access requests found for this email address.</p>}
          </div>
        </div>

        <div className="form-section mt-4 border-[#f1b8b2] bg-[#fffafa]">
          <h4 className="text-sm font-bold text-[#b42318]">Danger zone</h4>
          <p className="mt-1 text-sm text-[#7a5b54]">Deleting a user should only be used for mistaken or test accounts. Deactivate users where history should be preserved.</p>
          <button className="danger-button mt-3" onClick={() => void deleteUser()} disabled={isDeleting}>
            <Trash2 size={16} aria-hidden />
            {isDeleting ? "Deleting user" : "Delete user permanently"}
          </button>
        </div>
      </div>
    </div>
  );
}

function AccessBuildingPicker({ buildings, selectedBuildingIds, onToggle }: { buildings: Building[]; selectedBuildingIds: string[]; onToggle: (buildingId: string) => void }) {
  return (
    <div className="form-section mt-4">
      <p className="text-sm font-bold text-[#0F3D2E]">Building access</p>
      <p className="mt-1 text-sm text-[#66736B]">Choose the buildings this user can work with.</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {buildings.map((building) => (
          <label key={building.id} className={`option-card min-h-11 px-3 py-2 ${selectedBuildingIds.includes(building.id) ? "option-card-selected" : ""}`}>
            <input checked={selectedBuildingIds.includes(building.id)} onChange={() => onToggle(building.id)} type="checkbox" />
            {building.name}
          </label>
        ))}
        {buildings.length === 0 && <p className="text-sm text-[#617169]">No buildings yet.</p>}
      </div>
    </div>
  );
}

function roleAccessSummary(role: AppRole) {
  if (role === "admin") return "Admins have access to all buildings.";
  if (role === "developer") return "Developers have access to all buildings.";
  return "";
}

function emptyFlatAccessRows(): FlatAccessDraft[] {
  return [{ id: "flat-0", buildingId: "", unitId: "" }];
}

function createFlatAccessRow(): FlatAccessDraft {
  return { id: `flat-${Date.now()}-${Math.random().toString(36).slice(2)}`, buildingId: "", unitId: "" };
}

function flatAccessRowsFromUnitIds(unitIds: string[], units: Unit[]): FlatAccessDraft[] {
  const rows = unitIds.map((unitId, index) => {
    const unit = units.find((item) => item.id === unitId);
    return {
      id: `${unitId || "flat"}-${index}`,
      buildingId: unit?.building_id ?? "",
      unitId,
    };
  });

  return rows.length > 0 ? rows : emptyFlatAccessRows();
}

function selectedUnitIdsFromFlatRows(rows: FlatAccessDraft[]) {
  return Array.from(new Set(rows.map((row) => row.unitId).filter(Boolean)));
}

function AccessSummary({ message }: { message: string }) {
  return (
    <div className="form-section mt-4">
      <p className="text-sm font-bold text-[#0F3D2E]">Access</p>
      <p className="mt-2 rounded-md border border-[#d9ded6] bg-[#FBFAF6] px-3 py-2 text-sm text-[#617169]">{message}</p>
    </div>
  );
}

function FlatAccessRowsPicker({
  buildings,
  units,
  rows,
  onChange,
}: {
  buildings: Building[];
  units: Unit[];
  rows: FlatAccessDraft[];
  onChange: (rows: FlatAccessDraft[]) => void;
}) {
  const unitOptionsByBuilding = useMemo(() => {
    return units.reduce<Record<string, Unit[]>>((groups, unit) => {
      groups[unit.building_id] = [...(groups[unit.building_id] ?? []), unit];
      return groups;
    }, {});
  }, [units]);

  function updateRow(rowId: string, updates: Partial<FlatAccessDraft>) {
    onChange(rows.map((row) => (row.id === rowId ? { ...row, ...updates } : row)));
  }

  function removeRow(rowId: string) {
    onChange(rows.filter((row) => row.id !== rowId));
  }

  return (
    <div className="form-section mt-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-bold text-[#0F3D2E]">Flat access</p>
          <p className="mt-1 text-sm text-[#66736B]">Add one or more flats across Bunnywell buildings.</p>
        </div>
        <button className="secondary min-h-9 px-3 py-1.5 text-sm" type="button" onClick={() => onChange([...rows, createFlatAccessRow()])}>
          <Plus size={16} aria-hidden />
          Add flat
        </button>
      </div>

      <div className="mt-3 grid gap-3">
        {rows.length === 0 && (
          <p className="rounded-md border border-[#d9ded6] bg-[#FBFAF6] px-3 py-2 text-sm text-[#617169]">
            No flats selected.
          </p>
        )}
        {rows.map((row) => {
          const buildingUnits = unitOptionsByBuilding[row.buildingId] ?? [];
          const selectedOtherUnitIds = new Set(rows.filter((item) => item.id !== row.id).map((item) => item.unitId).filter(Boolean));

          return (
            <div key={row.id} className="card-surface p-3">
              <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                <label className="field-label">
                  Building
                  <select
                    className="field min-h-11 py-2"
                    value={row.buildingId}
                    onChange={(event) => updateRow(row.id, { buildingId: event.target.value, unitId: "" })}
                  >
                    <option value="">Choose building</option>
                    {buildings.map((building) => <option key={building.id} value={building.id}>{building.name}</option>)}
                  </select>
                </label>
                <label className="field-label">
                  Flat
                  <select
                    className="field min-h-11 py-2"
                    value={row.unitId}
                    onChange={(event) => updateRow(row.id, { unitId: event.target.value })}
                    disabled={!row.buildingId}
                  >
                    <option value="">Choose flat</option>
                    {buildingUnits.map((unit) => (
                      <option key={unit.id} value={unit.id} disabled={selectedOtherUnitIds.has(unit.id)}>
                        {unit.unit_number}{unit.floor ? ` / ${unit.floor}` : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  className="danger-icon-button self-end"
                  type="button"
                  onClick={() => removeRow(row.id)}
                  aria-label="Remove flat"
                  title="Remove flat"
                >
                  <Trash2 size={16} aria-hidden />
                </button>
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
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [sendInviteEmail, setSendInviteEmail] = useState(true);
  const [role, setRole] = useState<AppRole>("resident");
  const [residentType, setResidentType] = useState<ResidentType>("leaseholder");
  const [organisationId, setOrganisationId] = useState("");
  const [selectedBuildingIds, setSelectedBuildingIds] = useState<string[]>([]);
  const [flatAccessRows, setFlatAccessRows] = useState<FlatAccessDraft[]>(() => emptyFlatAccessRows());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isResident = role === "resident";
  const needsOrganisationAndBuilding = role === "developer_representative" || role === "contractor";
  const organisationsForRole = organisations.filter((organisation) => organisation.type === role);
  const selectedUnitIds = selectedUnitIdsFromFlatRows(flatAccessRows);
  const selectedUnits = units.filter((unit) => selectedUnitIds.includes(unit.id));
  const selectedResidentBuildingIds = Array.from(new Set(selectedUnits.map((unit) => unit.building_id)));
  const selectedBuildingAccessIds = isResident ? selectedResidentBuildingIds : selectedBuildingIds;
  const accessSummary = roleAccessSummary(role);
  const canCreateUser = Boolean(
    fullName &&
    email &&
    (sendInviteEmail || password) &&
    (!isResident || (residentType && selectedUnitIds.length > 0)) &&
    (!needsOrganisationAndBuilding || (organisationId && selectedBuildingIds.length > 0)),
  );

  function toggleBuilding(buildingId: string) {
    setSelectedBuildingIds((current) => (
      current.includes(buildingId) ? current.filter((item) => item !== buildingId) : [...current, buildingId]
    ));
  }

  async function enrolUser() {
    if (!email || !fullName || (!sendInviteEmail && !password)) {
      onNotice(sendInviteEmail ? "Name and email are required." : "Name, email and temporary password are required.");
      return;
    }

    if (isResident && selectedUnitIds.length === 0) {
      onNotice("Assign at least one flat for residents.");
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
          phone,
          password,
          sendInviteEmail,
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
      setPhone("");
      setPassword("");
      setSendInviteEmail(true);
      setRole("resident");
      setResidentType("leaseholder");
      setOrganisationId("");
      setSelectedBuildingIds([]);
      setFlatAccessRows(emptyFlatAccessRows());
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
      onNotice(sendInviteEmail ? `Invite sent to ${payload.email}.` : `Enrolled ${payload.email}.`);
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
            <label className="field-label">Phone<input className="field" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="Phone number" /></label>
            <label className="option-card md:col-span-2">
              <input checked={sendInviteEmail} onChange={(event) => setSendInviteEmail(event.target.checked)} type="checkbox" />
              Send invite email
            </label>
            {!sendInviteEmail && (
              <label className="field-label md:col-span-2">Temporary password<input className="field" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Temporary password" type="password" /></label>
            )}
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
                  const nextRole = event.target.value as AppRole;
                  setRole(nextRole);
                  if (nextRole !== "resident") {
                    setResidentType("leaseholder");
                    setFlatAccessRows(emptyFlatAccessRows());
                  }
                  if (nextRole === "resident") setFlatAccessRows((current) => current.length > 0 ? current : emptyFlatAccessRows());
                  setOrganisationId("");
                  setSelectedBuildingIds([]);
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
                <span className="text-xs font-normal normal-case tracking-normal text-[#617169]">Resident type is for admin context only. Access is controlled by the flats selected below.</span>
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
      {accessSummary && <AccessSummary message={accessSummary} />}
      {needsOrganisationAndBuilding && (
        <AccessBuildingPicker buildings={buildings} selectedBuildingIds={selectedBuildingIds} onToggle={toggleBuilding} />
      )}
      {isResident && (
        <FlatAccessRowsPicker buildings={buildings} units={units} rows={flatAccessRows} onChange={setFlatAccessRows} />
      )}
      <button className="primary mt-4 w-full" onClick={enrolUser} disabled={isSubmitting || !canCreateUser}>
        {isSubmitting ? "Enrolling user" : sendInviteEmail ? "Send invite and assign access" : "Create user and assign access"}
      </button>
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
                  <button
                    className="secondary icon-button"
                    onClick={() => startEdit(organisation)}
                    aria-label={`Edit ${organisation.name}`}
                    title={`Edit ${organisation.name}`}
                  >
                    <Pencil size={16} strokeWidth={2.25} aria-hidden />
                  </button>
                  <button
                    aria-label={`Delete ${organisation.name}`}
                    className="danger-icon-button"
                    onClick={() => deleteOrganisation(organisation)}
                    title={`Delete ${organisation.name}`}
                  >
                    <Trash2 size={16} strokeWidth={2.25} aria-hidden />
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
  buildingFloors,
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
  recordAudit,
  requestedFilters,
}: {
  user: User;
  profile: Profile | null;
  buildings: Building[];
  buildingFloors: BuildingFloor[];
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
  recordAudit: (event: Omit<AuditEvent, "id" | "created_at" | "created_by_user_id">) => Promise<void>;
  requestedFilters?: SnagListFilters;
}) {
  const isContractorRole = profile?.role === "contractor";
  const canUseDeveloperActions = !isContractorRole;
  const canCreateSnag = profile?.role === "admin" || profile?.role === "developer" || profile?.role === "developer_representative";
  const canPrintReport = profile?.role === "admin" || profile?.role === "developer" || profile?.role === "developer_representative" || profile?.role === "contractor";
  const [showAddSnag, setShowAddSnag] = useState(false);
  const [addSnagHasUnsavedChanges, setAddSnagHasUnsavedChanges] = useState(false);
  const [showPrintReport, setShowPrintReport] = useState(false);
  const [isViewingSnagDetails, setIsViewingSnagDetails] = useState(false);

  function closeAddSnagForm() {
    if (addSnagHasUnsavedChanges && !window.confirm("Discard this unsaved snag?")) return;
    setAddSnagHasUnsavedChanges(false);
    setShowAddSnag(false);
  }

  function toggleAddSnagForm() {
    if (showAddSnag) {
      closeAddSnagForm();
      return;
    }
    setAddSnagHasUnsavedChanges(false);
    setShowAddSnag(true);
  }

  return (
    <div className="grid gap-5">
      <section className="panel">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <SectionHeader title="Snags" subtitle="Manage visible defects, trade updates and printable flat snag sheets." />
          {!isViewingSnagDetails && <div className="flex flex-wrap gap-2">
            {canCreateSnag && (
              <button className="primary min-h-10 px-3 py-1.5 text-sm" type="button" onClick={toggleAddSnagForm}>
                {!showAddSnag && <Plus size={16} aria-hidden />} {showAddSnag ? "Close form" : "Add snag"}
              </button>
            )}
            {canPrintReport && (
              <button className="secondary min-h-10 px-3 py-1.5 text-sm" type="button" onClick={() => setShowPrintReport((current) => !current)}>
                <Download size={16} aria-hidden /> {showPrintReport ? "Hide print sheet" : "Print snag sheet"}
              </button>
            )}
          </div>}
        </div>
      </section>
      {!isViewingSnagDetails && showAddSnag && canCreateSnag && (
        <DeveloperSnagging
          user={user}
          buildings={buildings}
          buildingFloors={buildingFloors}
          units={units}
          areas={areas}
          trades={trades}
          onNotice={onNotice}
          reload={reload}
          uploadFile={uploadFile}
          onClose={() => {
            setAddSnagHasUnsavedChanges(false);
            setShowAddSnag(false);
          }}
          onDirtyChange={setAddSnagHasUnsavedChanges}
        />
      )}
      {!isViewingSnagDetails && showPrintReport && canPrintReport && (
        <ReportsPanel buildings={buildings} buildingFloors={buildingFloors} units={units} areas={areas} trades={trades} snags={snags} photos={photos} recordAudit={recordAudit} />
      )}
      <SnagList
        title=""
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
        requestedFilters={requestedFilters}
        onDetailViewChange={setIsViewingSnagDetails}
        showFilters
        canReject={canUseDeveloperActions}
        tradeControl={(snag, trade) => <ContractorTradeControl user={user} snag={snag} trade={trade} trades={trades} onNotice={onNotice} reload={reload} />}
        listActions={(snag) => {
          const canResolve = isContractorRole && !["closed", "resolved_by_contractor", "needs_more_info"].includes(snag.status);
          const canClose = canUseDeveloperActions && snag.status === "resolved_by_contractor";

          return (
            <>
              {canClose && <DeveloperCloseAction user={user} snag={snag} onNotice={onNotice} reload={reload} />}
              {canResolve && <ContractorResolveAction user={user} snag={snag} onNotice={onNotice} reload={reload} />}
            </>
          );
        }}
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
    </div>
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
  const [isSaving, setIsSaving] = useState(false);

  async function updateStatus(status: string, comment?: string) {
    if (isSaving) return;
    setIsSaving(true);
    try {
      await saveSnagStatusChange({
        user,
        snag,
        nextStatus: status,
        comment,
        closedAt: status === "closed" ? new Date().toISOString() : null,
      });
      if (status === "open") setResponseNote("");
      onNotice(status === "closed" ? "Snag closed" : "Information sent and status updated");
      await reload();
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Could not update snag status.");
    } finally {
      setIsSaving(false);
    }
  }

  if (!isContractorResolved && !needsMoreInfo) return null;

  if (isContractorResolved) {
    return (
      <button className="snag-action-link snag-action-success" onClick={() => updateStatus("closed")} disabled={isSaving} type="button">
        <CheckCircle2 size={16} aria-hidden /> {isSaving ? "Updating..." : "Close"}
      </button>
    );
  }

  return (
    <div className="grid w-full gap-2 sm:w-auto sm:min-w-80" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
      {needsMoreInfo && (
        <div className="grid gap-2 rounded-md border border-[#e2c8a6] bg-[#fff8ec] p-2">
          <input className="field" value={responseNote} onChange={(event) => setResponseNote(event.target.value)} placeholder="Information for contractor" disabled={isSaving} />
          <button className="inline-flex min-h-9 items-center gap-1.5 justify-self-end rounded-md px-2 py-1 text-xs font-semibold text-[#0F3D2E] transition hover:bg-[#edf4f1] disabled:cursor-not-allowed disabled:opacity-60" onClick={() => updateStatus("open", responseNote)} disabled={isSaving || !responseNote.trim()}>{isSaving ? "Sending..." : "Send info"}</button>
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
      <select className="field min-w-36 py-1 text-sm" value={tradeId} onClick={(event) => event.stopPropagation()} onChange={(event) => save(event.target.value)} onBlur={() => setEditing(false)}>
        <option value="">No trade</option>
        {trades.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select>
    );
  }

  return (
    <button
      className={`text-left underline underline-offset-2 ${trade ? "text-sm text-[#34413a] hover:text-[#0F3D31]" : "text-xs text-[#9aa59f] hover:text-[#617169]"}`}
      onClick={(event) => {
        event.stopPropagation();
        setEditing(true);
      }}
      title="Change trade"
    >
      {trade?.name ?? "No trade"}
    </button>
  );
}

async function saveSnagStatusChange({
  user,
  snag,
  nextStatus,
  comment,
  closedAt,
}: {
  user: User;
  snag: ProductionSnag;
  nextStatus: string;
  comment?: string | null;
  closedAt?: string | null;
}) {
  if (snag.status === nextStatus) return;

  const supabase = createSupabaseBrowserClient();
  const updatePayload: { status: string; closed_at?: string | null } = { status: nextStatus };
  if (closedAt !== undefined) updatePayload.closed_at = closedAt;

  const { error: statusError } = await supabase
    .from("snags")
    .update(updatePayload)
    .eq("id", snag.id);

  if (statusError) throw new Error(statusError.message);

  const { error: eventError } = await supabase.from("snag_events").insert({
    snag_id: snag.id,
    event_type: "status_change",
    old_value: snag.status,
    new_value: nextStatus,
    comment: comment?.trim() || null,
    created_by_user_id: user.id,
  });

  if (eventError) throw new Error(`Status updated, but activity could not be recorded: ${eventError.message}`);
}

function DeveloperCloseAction({ user, snag, onNotice, reload }: { user: User; snag: ProductionSnag; onNotice: (notice: string) => void; reload: () => Promise<void> }) {
  const [isSaving, setIsSaving] = useState(false);

  async function closeSnag() {
    if (isSaving) return;
    setIsSaving(true);
    try {
      await saveSnagStatusChange({
        user,
        snag,
        nextStatus: "closed",
        closedAt: new Date().toISOString(),
      });
      onNotice("Snag closed");
      await reload();
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Could not close snag.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <button
      className="snag-action-link snag-action-success"
      onClick={(event) => {
        event.stopPropagation();
        void closeSnag();
      }}
      disabled={isSaving}
      type="button"
    >
      <CheckCircle2 size={16} aria-hidden /> {isSaving ? "Updating..." : "Close"}
    </button>
  );
}

function ContractorResolveAction({ user, snag, onNotice, reload }: { user: User; snag: ProductionSnag; onNotice: (notice: string) => void; reload: () => Promise<void> }) {
  const [isSaving, setIsSaving] = useState(false);

  async function markResolved() {
    if (isSaving) return;
    setIsSaving(true);
    try {
      await saveSnagStatusChange({ user, snag, nextStatus: "resolved_by_contractor" });
      onNotice("Snag marked as resolved");
      await reload();
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Could not mark snag as resolved.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <button
      className="snag-action-link snag-action-success"
      onClick={(event) => {
        event.stopPropagation();
        void markResolved();
      }}
      disabled={isSaving}
      type="button"
    >
      <CheckCircle2 size={16} aria-hidden /> {isSaving ? "Updating..." : "Resolve"}
    </button>
  );
}

function ContractorActions({ user, snag, onNotice, reload }: { user: User; snag: ProductionSnag; onNotice: (notice: string) => void; reload: () => Promise<void> }) {
  const [showInfoRequest, setShowInfoRequest] = useState(false);
  const [infoRequest, setInfoRequest] = useState("");
  const [isSaving, setIsSaving] = useState<"request" | "resolve" | null>(null);

  async function requestInfo() {
    const trimmed = infoRequest.trim();
    if (!trimmed || isSaving) return;
    setIsSaving("request");
    try {
      await saveSnagStatusChange({ user, snag, nextStatus: "needs_more_info", comment: trimmed });
      setInfoRequest("");
      setShowInfoRequest(false);
      onNotice("Request sent and status updated to Needs more info");
      await reload();
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Could not send request.");
    } finally {
      setIsSaving(null);
    }
  }

  async function markResolved() {
    if (isSaving) return;
    setIsSaving("resolve");
    try {
      await saveSnagStatusChange({ user, snag, nextStatus: "resolved_by_contractor" });
      onNotice("Snag marked as resolved");
      await reload();
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Could not mark snag as resolved.");
    } finally {
      setIsSaving(null);
    }
  }

  if (snag.status === "closed" || snag.status === "resolved_by_contractor" || snag.status === "needs_more_info") return null;

  return (
    <div className="grid w-full gap-2 sm:w-auto sm:min-w-80" onClick={(event) => event.stopPropagation()}>
      <div className="flex flex-wrap gap-2">
        <button className="snag-action-link snag-action-warning" onClick={() => setShowInfoRequest((current) => !current)} disabled={Boolean(isSaving)} type="button">
          <CircleHelp size={16} aria-hidden /> Request info
        </button>
        <button className="snag-action-link snag-action-success" onClick={markResolved} disabled={Boolean(isSaving)} type="button">
          <CheckCircle2 size={16} aria-hidden /> {isSaving === "resolve" ? "Updating..." : "Resolve"}
        </button>
      </div>
      {showInfoRequest && (
        <div className="grid gap-2 rounded-md border border-[#e2c8a6] bg-[#fff8ec] p-2">
          <input
            className="field"
            value={infoRequest}
            onChange={(event) => setInfoRequest(event.target.value)}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === "Enter") void requestInfo();
            }}
            placeholder="What information is needed?"
            disabled={Boolean(isSaving)}
          />
          <button className="inline-flex min-h-9 items-center gap-1.5 justify-self-end rounded-md px-2 py-1 text-xs font-semibold text-[#8a5a12] transition hover:bg-[#fff4df] disabled:cursor-not-allowed disabled:opacity-60" onClick={requestInfo} disabled={Boolean(isSaving) || !infoRequest.trim()}>
            <CircleHelp size={16} aria-hidden /> {isSaving === "request" ? "Sending..." : "Send request"}
          </button>
        </div>
      )}
    </div>
  );
}

function UnitsSection({
  user,
  profile,
  buildings,
  buildingFloors,
  units,
  areas,
  snags,
  handovers,
  handoverKeyItems,
  meterReadings,
  photos,
  events,
  profiles,
  userUnitAccess,
  accessibleUnitIds,
  onNotice,
  recordAudit,
  reload,
  uploadFile,
}: {
  user: User;
  profile: Profile | null;
  buildings: Building[];
  buildingFloors: BuildingFloor[];
  units: Unit[];
  areas: Area[];
  snags: ProductionSnag[];
  handovers: Handover[];
  handoverKeyItems: HandoverKeyItem[];
  meterReadings: MeterReading[];
  photos: SnagPhoto[];
  events: SnagEvent[];
  profiles: Profile[];
  userUnitAccess: UserUnitAccess[];
  accessibleUnitIds: string[];
  onNotice: (notice: string) => void;
  recordAudit: (event: Omit<AuditEvent, "id" | "created_at" | "created_by_user_id">) => Promise<void>;
  reload: () => Promise<void>;
  uploadFile: (dataUrl: string, folder: string) => Promise<string>;
}) {
  const [buildingId, setBuildingId] = useState(buildings[0]?.id ?? "");
  const handoverUnitIds = new Set(handovers.map((handover) => handover.unit_id));
  const buildingUnits = sortUnitsByFloorOrder(
    units.filter((unit) => !buildingId || unit.building_id === buildingId),
    buildingFloors,
    buildingId,
  );

  useEffect(() => {
    if (!buildingId && buildings[0]) setBuildingId(buildings[0].id);
    if (buildingId && !buildings.some((building) => building.id === buildingId)) setBuildingId(buildings[0]?.id ?? "");
  }, [buildingId, buildings]);

  return (
    <div className="grid gap-5">
      <section className="panel">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <SectionHeader title="Units" subtitle="Flat status, handover position, resident access and snag history." />
          <select className="field min-h-10 sm:w-72" value={buildingId} onChange={(event) => setBuildingId(event.target.value)}>
            {buildings.map((building) => <option key={building.id} value={building.id}>{building.name}</option>)}
          </select>
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-[840px] w-full table-fixed border-separate border-spacing-0 text-sm">
            <colgroup>
              <col className="w-[22%]" />
              <col className="w-[18%]" />
              <col className="w-[28%]" />
              <col className="w-[16%]" />
              <col className="w-[16%]" />
            </colgroup>
            <thead>
              <tr className="text-left text-xs font-semibold uppercase text-[#617169]">
                <th className="border-b border-[#d9ded6] px-3 py-2">Flat</th>
                <th className="border-b border-[#d9ded6] px-3 py-2">Sale status</th>
                <th className="border-b border-[#d9ded6] px-3 py-2">Handover</th>
                <th className="border-b border-[#d9ded6] px-3 py-2 text-right">Open snags</th>
                <th className="border-b border-[#d9ded6] px-3 py-2 text-right">Residents</th>
              </tr>
            </thead>
            <tbody>
              {buildingUnits.map((unit) => {
                const unitHandovers = handovers.filter((handover) => handover.unit_id === unit.id);
                const latestHandover = unitHandovers[0];
                const openSnagCount = snags.filter((snag) => snag.unit_id === unit.id && !["closed", "resolved"].includes(snag.status)).length;
                const residentUserIds = new Set(userUnitAccess.filter((access) => access.unit_id === unit.id).map((access) => access.user_id));
                const residentCount = profiles.filter((person) => person.role === "resident" && residentUserIds.has(person.id) && person.active !== false).length;
                const parkingLabel = unit.parking_bays?.length ? ` / Bay ${formatParkingBays(unit.parking_bays)}` : "";
                return (
                  <tr key={unit.id}>
                    <td className="border-b border-[#e5e9e4] px-3 py-2 align-middle">
                      <p className="font-semibold text-[#1F2A24]">{unit.unit_number}</p>
                      <p className="text-xs text-[#617169]">{unit.floor ?? "No floor"}{parkingLabel}</p>
                    </td>
                    <td className="border-b border-[#e5e9e4] px-3 py-2 align-middle"><span className={statusTone(unit.sale_status)}>{statusLabel(unit.sale_status)}</span></td>
                    <td className="border-b border-[#e5e9e4] px-3 py-2 align-middle">
                      {handoverUnitIds.has(unit.id) ? (
                        <span className="text-[#0F3D2E]">{formatDateTime(latestHandover?.handover_datetime ?? latestHandover?.created_at ?? latestHandover?.handover_date)}</span>
                      ) : (
                        <span className="text-[#617169]">Not handed over</span>
                      )}
                    </td>
                    <td className="border-b border-[#e5e9e4] px-3 py-2 text-right align-middle tabular-nums">{openSnagCount}</td>
                    <td className="border-b border-[#e5e9e4] px-3 py-2 text-right align-middle tabular-nums">{residentCount}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {buildingUnits.length === 0 && <p className="mt-3 rounded-md border border-dashed border-[#d9ded6] bg-[#f8faf7] p-3 text-sm text-[#617169]">No units are available for this building.</p>}
        </div>
      </section>
      <LeaseholderDefects
        user={user}
        profile={profile}
        buildings={buildings}
        units={units}
        areas={areas}
        snags={snags}
        handovers={handovers}
        handoverKeyItems={handoverKeyItems}
        meterReadings={meterReadings}
        photos={photos}
        events={events}
        profiles={profiles}
        accessibleUnitIds={accessibleUnitIds}
        onNotice={onNotice}
        recordAudit={recordAudit}
        reload={reload}
        uploadFile={uploadFile}
        residentView="internal"
      />
    </div>
  );
}

function ResidentHelp({ buildings, units }: { buildings: Building[]; units: Unit[] }) {
  const linkedBuildingIds = Array.from(new Set(units.map((unit) => unit.building_id)));
  const linkedBuildings = buildings.filter((building) => linkedBuildingIds.includes(building.id));

  return (
    <div className="grid gap-5">
      <section className="panel">
        <SectionHeader title="Documents" subtitle="Home user guides, warranty information and useful building links." />
        <div className="mt-4 grid gap-3">
          {linkedBuildings.map((building) => (
            <div key={building.id} className="rounded-md border border-[#d9ded6] bg-[#f8faf7] p-4">
              <h3 className="font-semibold text-[#0F3D2E]">{building.name}</h3>
              <div className="mt-3 flex flex-wrap gap-2">
                {building.home_user_guide_url && <a className="secondary min-h-9 px-3 py-1.5 text-sm" href={building.home_user_guide_url} target="_blank" rel="noreferrer">Home user guide</a>}
                {building.documents_url && <a className="secondary min-h-9 px-3 py-1.5 text-sm" href={building.documents_url} target="_blank" rel="noreferrer">Building documents</a>}
                {!building.home_user_guide_url && !building.documents_url && <p className="text-sm text-[#617169]">No document links have been added for this building yet.</p>}
              </div>
            </div>
          ))}
          {linkedBuildings.length === 0 && (
            <div className="rounded-md border border-dashed border-[#d9ded6] bg-[#f8faf7] p-4 text-sm text-[#617169]">
              <p className="font-semibold text-[#0F3D2E]">No documents added yet</p>
              <p className="mt-1">Home documents will appear here when they are available for your building.</p>
            </div>
          )}
        </div>
      </section>
      <section className="panel">
        <SectionHeader title="Support" subtitle="For portal access or home document queries, contact Bunnywell." />
        <a className="secondary mt-4 w-fit min-h-9 px-3 py-1.5 text-sm" href="mailto:info@bunnywell.co.uk">info@bunnywell.co.uk</a>
      </section>
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
  handovers,
  handoverKeyItems,
  meterReadings,
  photos,
  events,
  profiles,
  accessibleUnitIds,
  onNotice,
  recordAudit,
  reload,
  uploadFile,
  onGoToSnags,
  residentView = "internal",
}: {
  user: User;
  profile: Profile | null;
  buildings: Building[];
  units: Unit[];
  areas: Area[];
  snags: ProductionSnag[];
  handovers: Handover[];
  handoverKeyItems: HandoverKeyItem[];
  meterReadings: MeterReading[];
  photos: SnagPhoto[];
  events: SnagEvent[];
  profiles: Profile[];
  accessibleUnitIds: string[];
  onNotice: (notice: string) => void;
  recordAudit: (event: Omit<AuditEvent, "id" | "created_at" | "created_by_user_id">) => Promise<void>;
  reload: () => Promise<void>;
  uploadFile: (dataUrl: string, folder: string) => Promise<string>;
  onGoToSnags?: () => void;
  residentView?: "internal" | "home" | "snags";
}) {
  const userUnits = (profile?.role === "resident" ? units.filter((unit) => accessibleUnitIds.includes(unit.id)) : units)
    .sort((a, b) => a.unit_number.localeCompare(b.unit_number, undefined, { numeric: true }));
  const residentBuildingIds = Array.from(new Set(userUnits.map((unit) => unit.building_id)));
  const hasMultipleBuildings = residentBuildingIds.length > 1;
  const hasSingleUnit = userUnits.length === 1;
  const [buildingFilter, setBuildingFilter] = useState("");
  const filteredUserUnits = hasMultipleBuildings && buildingFilter
    ? userUnits.filter((unit) => unit.building_id === buildingFilter)
    : userUnits;
  const [unitId, setUnitId] = useState(userUnits[0]?.id ?? "");
  const [areaId, setAreaId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [photo, setPhoto] = useState("");
  const [isSubmittingDefect, setIsSubmittingDefect] = useState(false);
  const [defectStatusFilter, setDefectStatusFilter] = useState("");
  const [defectPriorityFilter, setDefectPriorityFilter] = useState("");
  const [meterType, setMeterType] = useState<"water" | "electricity">("water");
  const [meterReading, setMeterReading] = useState("");
  const [meterPhoto, setMeterPhoto] = useState("");
  const selectedUnit = units.find((unit) => unit.id === unitId);
  const selectedBuilding = buildings.find((building) => building.id === selectedUnit?.building_id);
  const selectedBuildingLifecycle = derivedBuildingLifecycleStatus(selectedBuilding);
  const selectedBuildingReportingEnd = initialDefectsReportingEndDate(selectedBuilding);
  const residentCanReportRoutineSnags = buildingAllowsResidentRoutineSnags(selectedBuilding);
  const existingHandover = handovers.find((handover) => handover.unit_id === unitId);
  const residentRoutineSnagAllowed = residentCanReportRoutineSnags && (profile?.role !== "resident" || Boolean(existingHandover));
  const selectedHandoverKeys = handoverKeyItems.filter((item) => item.handover_id === existingHandover?.id);
  const selectedUnitAreas = areas.filter((area) => area.unit_id === unitId);
  const selectedUnitDefects = snags.filter((snag) => snag.unit_id === unitId);
  const filteredDefects = selectedUnitDefects
    .filter((snag) => !defectStatusFilter || snag.status === defectStatusFilter)
    .filter((snag) => !defectPriorityFilter || snag.priority_code === defectPriorityFilter);
  const selectedMeterReadings = meterReadings
    .filter((reading) => reading.unit_id === unitId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const activeDefectCount = selectedUnitDefects.filter(residentSnagIsOpen).length;
  const closedDefectCount = selectedUnitDefects.filter(residentSnagIsResolved).length;
  const waitingForResidentDefects = selectedUnitDefects.filter((snag) => snag.status === "needs_more_info");
  const canSubmitDefect = Boolean(selectedUnit && areaId && title.trim() && photo && residentRoutineSnagAllowed);
  const showSnagTools = residentView !== "home";
  const showMeterTools = residentView === "internal";
  const isResidentPortalView = profile?.role === "resident" && residentView !== "internal";

  useEffect(() => {
    if (hasSingleUnit && userUnits[0]?.id && unitId !== userUnits[0].id) {
      setUnitId(userUnits[0].id);
      setAreaId("");
      return;
    }
    if (hasMultipleBuildings && !buildingFilter && residentBuildingIds[0]) {
      setBuildingFilter(residentBuildingIds[0]);
      return;
    }
    if (filteredUserUnits.length > 0 && !filteredUserUnits.some((unit) => unit.id === unitId)) {
      setUnitId(filteredUserUnits[0].id);
      setAreaId("");
    }
  }, [buildingFilter, filteredUserUnits, hasMultipleBuildings, hasSingleUnit, residentBuildingIds, unitId, userUnits]);

  async function createDefect() {
    if (isSubmittingDefect) return;
    if (!selectedUnit) {
      onNotice("Select a unit before submitting a defect.");
      return;
    }
    if (!residentCanReportRoutineSnags) {
      onNotice(selectedBuildingLifecycle === "pre_pc"
        ? "Residents cannot submit routine snags yet. Internal users can continue managing pre-PC snags where permitted."
        : "New routine snag reports can no longer be submitted through the portal.");
      return;
    }
    if (profile?.role === "resident" && !existingHandover) {
      onNotice("Routine snag reporting opens after handover.");
      return;
    }
    if (!accessibleUnitIds.includes(selectedUnit.id) && profile?.role === "resident") {
      onNotice("This unit is not linked to your account. Please contact support.");
      return;
    }
    if (!areaId || !title.trim() || !photo) return;

    const supabase = createSupabaseBrowserClient();
    setIsSubmittingDefect(true);
    try {
      const photoUrl = await uploadFile(photo, "defects");
      const { data, error } = await supabase.from("snags").insert({
        building_id: selectedUnit.building_id,
        unit_id: selectedUnit.id,
        area_id: areaId,
        source_type: "leaseholder_defect",
        created_by: user.id,
        created_by_user_id: user.id,
        title: title.trim(),
        description: description.trim() || null,
        priority: null,
        priority_code: null,
        status: "open",
      }).select("id").single();

      if (error) throw error;

      const { error: photoError } = await supabase.from("snag_photos").insert({ snag_id: data.id, file_url: photoUrl, photo_type: "annotated", uploaded_by_user_id: user.id });
      if (photoError) throw photoError;

      const { error: eventError } = await supabase.from("snag_events").insert({ snag_id: data.id, event_type: "created", new_value: "open", created_by_user_id: user.id });
      if (eventError) {
        console.warn("Defect activity history could not be recorded", eventError);
      }

      setAreaId("");
      setTitle("");
      setDescription("");
      setPhoto("");
      onNotice(eventError ? "Defect submitted, but the activity history could not be recorded." : "Defect submitted.");
      await reload();
    } catch (error) {
      onNotice(`Unable to submit defect. ${readableError(error)}`);
    } finally {
      setIsSubmittingDefect(false);
    }
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
    try {
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

      if (error) throw error;

      setMeterType("water");
      setMeterReading("");
      setMeterPhoto("");
      onNotice("");
      await reload();
    } catch {
      onNotice("Unable to submit meter reading. Please try again or contact support.");
    }
  }

  if (isResidentPortalView) {
    if (userUnits.length === 0) {
      return (
        <section className="panel">
          <SectionHeader title="My home" subtitle="No home has been linked to your portal account yet." />
          <p className="mt-3 text-sm text-[#617169]">Please contact <a className="font-semibold underline" href="mailto:info@bunnywell.co.uk">info@bunnywell.co.uk</a> if you think this is incorrect.</p>
        </section>
      );
    }

    const handoverReady = Boolean(selectedUnit && selectedUnit.sale_status === "completed" && !existingHandover && buildingAllowsFlatHandover(selectedBuilding));
    const handoverStatus = existingHandover ? "Complete" : handoverReady ? "Ready" : "Not ready";
    const recentSnags = [...selectedUnitDefects].sort((a, b) => new Date(b.updated_at || b.created_at).getTime() - new Date(a.updated_at || a.created_at).getTime()).slice(0, 4);
    const documentLinks = [
      selectedBuilding?.home_user_guide_url ? { label: "Home user guide", href: selectedBuilding.home_user_guide_url } : null,
      selectedBuilding?.documents_url ? { label: "Building documents", href: selectedBuilding.documents_url } : null,
    ].filter((item): item is { label: string; href: string } => Boolean(item));
    const action = waitingForResidentDefects.length > 0
      ? {
          title: "Reply needed",
          body: `${waitingForResidentDefects.length} snag${waitingForResidentDefects.length === 1 ? "" : "s"} need${waitingForResidentDefects.length === 1 ? "s" : ""} your response.`,
          button: "View snags",
          onClick: onGoToSnags,
        }
      : handoverReady
        ? {
            title: "Handover ready",
            body: "Your home is ready for handover. Complete the handover steps when you are ready.",
            button: null,
            onClick: undefined,
          }
        : !existingHandover
          ? {
              title: "No action yet",
              body: "Handover is not ready yet. Bunnywell will update the portal when there is something for you to do.",
              button: null,
              onClick: undefined,
            }
          : {
              title: "No action needed",
              body: "You are up to date for this home.",
              button: null,
              onClick: undefined,
            };
    const reportSnagUnavailableMessage = !existingHandover
      ? "Routine snag reporting opens after handover."
      : selectedBuildingLifecycle === "pre_pc"
        ? "Routine snag reporting opens after handover."
        : "New routine snag reports can no longer be submitted through the portal for this building.";

    return (
      <div className="grid gap-5">
        <section className="panel">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,360px)] lg:items-start">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#D6A23A]">Selected home</p>
              <h1 className="mt-1 text-2xl font-semibold text-[#0F3D2E]">{selectedBuilding?.name ?? "Building"} {selectedUnit?.unit_number ?? ""}</h1>
              <div className="mt-2 flex flex-wrap gap-2 text-sm text-[#617169]">
                <span>Flat {selectedUnit?.unit_number ?? "-"}</span>
                <span aria-hidden>/</span>
                <span>{selectedUnit?.floor || "Floor not set"}</span>
                <span aria-hidden>/</span>
                <span>Bay: {formatParkingBays(selectedUnit?.parking_bays)}</span>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <span className={statusTone(existingHandover ? "handed_over" : selectedUnit?.sale_status ?? "")}>{existingHandover ? "Handover complete" : handoverReady ? "Handover ready" : "Handover not ready"}</span>
                <span className={statusTone(selectedBuildingLifecycle)}>{statusLabel(selectedBuildingLifecycle)}</span>
              </div>
            </div>
            {!hasSingleUnit && (
              <div className="grid gap-2 rounded-md border border-[#d9ded6] bg-[#f8faf7] p-3">
                <p className="text-sm font-semibold text-[#0F3D2E]">Change home</p>
                {hasMultipleBuildings && (
                  <label className="field-label">
                    Building
                    <select className="field h-11 min-h-11" value={buildingFilter} onChange={(event) => {
                      setBuildingFilter(event.target.value);
                      setAreaId("");
                    }}>
                      {residentBuildingIds.map((buildingId) => {
                        const building = buildings.find((item) => item.id === buildingId);
                        return <option key={buildingId} value={buildingId}>{building?.name ?? "Building"}</option>;
                      })}
                    </select>
                  </label>
                )}
                <label className="field-label">
                  Flat
                  <select className="field h-11 min-h-11" value={unitId} onChange={(event) => {
                    setUnitId(event.target.value);
                    setAreaId("");
                  }}>
                    {filteredUserUnits.map((unit) => {
                      const building = buildings.find((item) => item.id === unit.building_id);
                      const includeBuilding = hasMultipleBuildings && !buildingFilter;
                      return <option key={unit.id} value={unit.id}>{includeBuilding ? `${building?.name ?? "Building"} ` : ""}{unit.unit_number} / {unit.floor || "No floor"}</option>;
                    })}
                  </select>
                </label>
              </div>
            )}
          </div>
        </section>

        <section className="rounded-md border border-[#d9ded6] bg-white p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#D6A23A]">Action required</p>
              <h2 className="mt-1 text-xl font-semibold text-[#0F3D2E]">{action.title}</h2>
              <p className="mt-1 text-sm text-[#617169]">{action.body}</p>
            </div>
            {action.button && action.onClick && (
              <button className="primary min-h-10 px-4 py-2 text-sm" type="button" onClick={action.onClick}>{action.button}</button>
            )}
          </div>
        </section>

        {residentView === "home" ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <SummaryTile label="Handover status" value={handoverStatus} />
              <SummaryTile label="Open snags" value={activeDefectCount} />
              <SummaryTile label="Waiting for your reply" value={waitingForResidentDefects.length} />
              <SummaryTile label="Resolved snags" value={closedDefectCount} />
            </div>
            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
              <section className="panel">
                <SectionHeader title="Handover" subtitle="Keys, meter photos and the handover record for this home." />
                {selectedUnit && (
                  <div className="mt-4">
                    <SelectedUnitHandover
                      building={selectedBuilding}
                      existingHandover={existingHandover}
                      existingKeyItems={selectedHandoverKeys}
                      profile={profile}
                      recordAudit={recordAudit}
                      reload={reload}
                      selectedUnit={selectedUnit}
                      onNotice={onNotice}
                      uploadFile={uploadFile}
                      user={user}
                    />
                  </div>
                )}
              </section>
              <div className="grid gap-5 content-start">
                <section className="panel">
                  <SectionHeader title="Recent snags" subtitle="Latest snag activity for this home." />
                  <div className="mt-3 divide-y divide-[#e5e9e4]">
                    {recentSnags.map((snag) => (
                      <div key={snag.id} className="flex items-center justify-between gap-3 py-3">
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-[#0F3D2E]">{snag.title}</p>
                          <p className="text-sm text-[#617169]">{areas.find((area) => area.id === snag.area_id)?.name ?? "No area"}</p>
                        </div>
                        <span className={statusTone(snag.status)}>{residentSnagStatusLabel(snag.status)}</span>
                      </div>
                    ))}
                    {recentSnags.length === 0 && <p className="py-3 text-sm text-[#617169]">No snags have been reported for this home.</p>}
                  </div>
                  <button className="secondary mt-3 min-h-9 px-3 py-1.5 text-sm" type="button" onClick={onGoToSnags}>View snags</button>
                </section>
                <section className="panel">
                  <SectionHeader title="Home documents" subtitle="Useful links for this home." />
                  <div className="mt-3 flex flex-wrap gap-2">
                    {documentLinks.map((link) => (
                      <a key={link.href} className="secondary min-h-9 px-3 py-1.5 text-sm" href={link.href} target="_blank" rel="noreferrer">{link.label}</a>
                    ))}
                    {documentLinks.length === 0 && <p className="text-sm text-[#617169]">No documents have been added for this building yet.</p>}
                  </div>
                </section>
              </div>
            </div>
          </>
        ) : (
          <div className="grid gap-5 lg:grid-cols-[360px_minmax(0,1fr)]">
            <div className="grid gap-5 content-start">
              {residentRoutineSnagAllowed ? (
                <FormPanel title="Report a snag">
                  <select className="field" value={areaId} onChange={(event) => setAreaId(event.target.value)}>
                    <option value="">Room / area</option>
                    {selectedUnitAreas.map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}
                  </select>
                  <input className="field" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={50} placeholder="Short title" disabled={isSubmittingDefect || !selectedUnit} />
                  <textarea className="field min-h-24 py-3" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="What needs attention?" disabled={isSubmittingDefect || !selectedUnit} />
                  <PhotoInput value={photo} onChange={setPhoto} disabled={isSubmittingDefect || !selectedUnit} />
                  <button className="primary" onClick={createDefect} disabled={isSubmittingDefect || !canSubmitDefect}>{isSubmittingDefect ? "Submitting..." : "Report a snag"}</button>
                </FormPanel>
              ) : (
                <FormPanel title="Report a snag">
                  <p className="text-sm text-[#617169]">{reportSnagUnavailableMessage}</p>
                  <button className="secondary" type="button" disabled>Report a snag</button>
                </FormPanel>
              )}
            </div>
            <div className="grid gap-5 content-start">
              <section className="rounded-md border border-[#d9ded6] bg-white p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold text-[#0F3D2E]">Snags</h2>
                    <p className="text-sm text-[#617169]">Track reported items and anything waiting for your reply.</p>
                  </div>
                  <button
                    className={`secondary min-h-9 px-3 py-1.5 text-sm ${defectStatusFilter === "needs_more_info" ? "filter-active" : ""}`}
                    type="button"
                    onClick={() => setDefectStatusFilter((current) => current === "needs_more_info" ? "" : "needs_more_info")}
                  >
                    Waiting for me
                  </button>
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <select className={`field min-w-40 ${defectStatusFilter ? "filter-active" : ""}`} value={defectStatusFilter} onChange={(event) => setDefectStatusFilter(event.target.value)} aria-label="Snag status">
                    <option value="">All statuses</option>
                    {["open", "accepted", "needs_more_info", "resolved_by_contractor", "closed", "rejected"].map((status) => (
                      <option key={status} value={status}>{residentSnagStatusLabel(status)}</option>
                    ))}
                  </select>
                  <select className={`field min-w-40 ${defectPriorityFilter ? "filter-active" : ""}`} value={defectPriorityFilter} onChange={(event) => setDefectPriorityFilter(event.target.value)} aria-label="Snag priority">
                    <option value="">All priorities</option>
                    <option value="P1">P1</option>
                    <option value="P2">P2</option>
                    <option value="P3">P3</option>
                  </select>
                </div>
              </section>
              <SnagList
                title="Snag history"
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
                actions={() => null}
                residentMode
              />
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="grid gap-5">
      <section className="rounded-md border border-[#d9ded6] bg-white p-4">
        <div className="grid gap-3 md:grid-cols-[260px_minmax(0,1fr)]">
          <div className="grid gap-3">
            {hasSingleUnit ? (
              <div className="rounded-xl border border-[#d9ded6] bg-[#f8faf7] p-3 text-sm">
                <p className="font-semibold text-[#0F3D2E]">{selectedBuilding?.name ?? "Building"}</p>
                <p className="mt-1 text-[#34413a]">Unit {selectedUnit?.unit_number ?? "-"}</p>
              </div>
            ) : (
              <>
                {hasMultipleBuildings && (
                  <select className="field" value={buildingFilter} onChange={(event) => {
                    setBuildingFilter(event.target.value);
                    setAreaId("");
                  }}>
                    {residentBuildingIds.map((buildingId) => {
                      const building = buildings.find((item) => item.id === buildingId);
                      return <option key={buildingId} value={buildingId}>{building?.name ?? "Building"}</option>;
                    })}
                  </select>
                )}
                <select className="field" value={unitId} onChange={(event) => {
                  setUnitId(event.target.value);
                  setAreaId("");
                }}>
                  {filteredUserUnits.map((unit) => {
                    const building = buildings.find((item) => item.id === unit.building_id);
                    const includeBuilding = hasMultipleBuildings && !buildingFilter;
                    return <option key={unit.id} value={unit.id}>{includeBuilding ? `${building?.name ?? "Building"}, ` : ""}Unit {unit.unit_number}</option>;
                  })}
                </select>
              </>
            )}
          </div>
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#0F3D31]">{selectedBuilding?.name ?? "No building"}</p>
            <h2 className="mt-1 text-2xl font-semibold">Unit {selectedUnit?.unit_number ?? "-"}</h2>
            <p className="mt-1 text-sm text-[#617169]">
              Parking bay{(selectedUnit?.parking_bays?.length ?? 0) === 1 ? "" : "s"}: {formatParkingBays(selectedUnit?.parking_bays)}
            </p>
            {selectedUnit && (
              <div className="mt-3 grid gap-3 rounded-xl border border-[#d9ded6] bg-[#f8faf7] p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-[#0F3D2E]">Flat status</p>
                  <span className={statusTone(existingHandover ? "handed_over" : selectedUnit.sale_status)}>{existingHandover ? "Handed Over" : statusLabel(selectedUnit.sale_status)}</span>
                </div>
                <SelectedUnitHandover
                  building={selectedBuilding}
                  existingHandover={existingHandover}
                  existingKeyItems={selectedHandoverKeys}
                  profile={profile}
                  recordAudit={recordAudit}
                  reload={reload}
                  selectedUnit={selectedUnit}
                  onNotice={onNotice}
                  uploadFile={uploadFile}
                  user={user}
                />
              </div>
            )}
          </div>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <SummaryTile label="Open defects" value={activeDefectCount} />
          <SummaryTile label="Closed defects" value={closedDefectCount} />
          <SummaryTile label="Meter readings" value={selectedMeterReadings.length} />
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {selectedBuilding?.documents_url && (
            <a className="secondary min-h-9 px-3 py-1.5 text-sm" href={selectedBuilding.documents_url} target="_blank" rel="noreferrer">Building documents</a>
          )}
          {selectedBuilding?.home_user_guide_url && (
            <a className="secondary min-h-9 px-3 py-1.5 text-sm" href={selectedBuilding.home_user_guide_url} target="_blank" rel="noreferrer">Home user guide</a>
          )}
        </div>
        {selectedBuildingLifecycle === "dlp_closing" && selectedBuildingReportingEnd && (
          <div className="mt-4 rounded-md border border-[#E5C27B] bg-[#FFF8E8] p-4 text-sm text-[#7A5A1F]">
            <p className="font-semibold text-[#5F4315]">The initial defects reporting period for this building is due to close on {formatDate(selectedBuildingReportingEnd)}.</p>
            <p className="mt-2">Please make sure any outstanding routine snagging items are submitted through the portal before this date.</p>
            <p className="mt-2">After this date, the portal will remain available as a record and document library, but new routine snag reports will no longer be accepted through the portal.</p>
          </div>
        )}
        {(selectedBuildingLifecycle === "post_dlp_readonly" || selectedBuildingLifecycle === "archived") && (
          <div className="mt-4 rounded-md border border-[#d9ded6] bg-[#F7F5EF] p-4 text-sm text-[#34413a]">
            <p className="font-semibold text-[#0F3D2E]">The initial defects reporting period for this building has now closed.</p>
            <p className="mt-2">The Bunnywell portal remains available for handover records, useful homeowner documents and previous snag history.</p>
            <p className="mt-2">New routine snag reports can no longer be submitted through the portal.</p>
            <p className="mt-2">For communal or building management matters, please contact the managing agent.</p>
            <p className="mt-2">For other queries, please refer to your Home User Guide and building documents, or contact <a className="font-semibold underline" href="mailto:info@bunnywell.co.uk">info@bunnywell.co.uk</a>.</p>
          </div>
        )}
        {selectedBuildingLifecycle === "pre_pc" && (
          <div className="mt-4 rounded-md border border-[#D6A23A] bg-[#fff8e7] p-4 text-sm text-[#5c4a1f]">
            Residents cannot submit routine snags yet. Internal users can continue managing pre-PC snags where permitted.
          </div>
        )}
      </section>
      <div className="grid gap-5 lg:grid-cols-[360px_minmax(0,1fr)]">
        <div className="grid gap-5 content-start">
          {showSnagTools && (residentCanReportRoutineSnags ? (
            <FormPanel title={profile?.role === "resident" ? "Report snag" : "Add defect"}>
              <select className="field" value={areaId} onChange={(event) => setAreaId(event.target.value)}>
                <option value="">Room / area</option>
                {selectedUnitAreas.map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}
              </select>
              <input className="field" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={50} placeholder="Title" disabled={isSubmittingDefect || !selectedUnit} />
              <textarea className="field min-h-24 py-3" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Description" disabled={isSubmittingDefect || !selectedUnit} />
              <PhotoInput value={photo} onChange={setPhoto} disabled={isSubmittingDefect || !selectedUnit} />
              <button className="primary" onClick={createDefect} disabled={isSubmittingDefect || !canSubmitDefect}>{isSubmittingDefect ? "Submitting..." : profile?.role === "resident" ? "Report snag" : "Submit defect"}</button>
            </FormPanel>
          ) : (
            <FormPanel title={selectedBuildingLifecycle === "pre_pc" ? "Routine snag reporting not open" : "Routine snag reporting closed"}>
              <p className="text-sm text-[#617169]">
                {selectedBuildingLifecycle === "pre_pc"
                  ? "Resident routine snag reporting will open once PC has been confirmed."
                  : "New routine snag reports can no longer be submitted through the portal for this building."}
              </p>
              <button className="secondary" type="button" onClick={() => onNotice(selectedBuildingLifecycle === "pre_pc" ? "Residents cannot submit routine snags yet. Internal users can continue managing pre-PC snags where permitted." : "New routine snag reports can no longer be submitted through the portal.")}>
                {selectedBuildingLifecycle === "pre_pc" ? "Routine snag reporting not open" : "Routine snag reporting closed"}
              </button>
            </FormPanel>
          ))}
          {showMeterTools && <FormPanel title="Meter reading">
            <select className="field" value={meterType} onChange={(event) => setMeterType(event.target.value as "water" | "electricity")} disabled={!selectedUnit}>
              <option value="water">Water</option>
              <option value="electricity">Electricity</option>
            </select>
            <input className="field" value={meterReading} onChange={(event) => setMeterReading(event.target.value)} placeholder="Reading" inputMode="decimal" disabled={!selectedUnit} />
            <SimplePhotoInput value={meterPhoto} onChange={setMeterPhoto} disabled={!selectedUnit} />
            <button className="primary" onClick={createMeterReading} disabled={!selectedUnit || !meterReading || !meterPhoto}>Submit reading</button>
          </FormPanel>}
        </div>
        <div className="grid gap-5 content-start">
          {showSnagTools && <section className="rounded-md border border-[#d9ded6] bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">{profile?.role === "resident" ? "My snags" : "Defects"}</h2>
              <div className="grid gap-2 sm:grid-cols-2">
                <select className={`field min-w-40 ${defectStatusFilter ? "filter-active" : ""}`} value={defectStatusFilter} onChange={(event) => setDefectStatusFilter(event.target.value)}>
                  <option value="">All statuses</option>
                  {["open", "accepted", "needs_more_info", "resolved_by_contractor", "closed", "rejected"].map((status) => (
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
          </section>}
          {showSnagTools && <SnagList
            title={profile?.role === "resident" ? "Snag history" : "Defect list"}
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
            actions={(snag) => profile?.role === "resident" ? null : <TriageActions user={user} snag={snag} buildings={buildings} organisations={[]} onNotice={onNotice} reload={reload} />}
          />}
          {showMeterTools && <section className="rounded-md border border-[#d9ded6] bg-white p-4">
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
          </section>}
        </div>
      </div>
    </div>
  );
}

function SelectedUnitHandover({
  building,
  existingHandover,
  existingKeyItems,
  profile,
  recordAudit,
  reload,
  selectedUnit,
  onNotice,
  uploadFile,
  user,
}: {
  building?: Building;
  existingHandover?: Handover;
  existingKeyItems: HandoverKeyItem[];
  profile: Profile | null;
  recordAudit: (event: Omit<AuditEvent, "id" | "created_at" | "created_by_user_id">) => Promise<void>;
  reload: () => Promise<void>;
  selectedUnit: Unit;
  onNotice: (notice: string) => void;
  uploadFile: (dataUrl: string, folder: string) => Promise<string>;
  user: User;
}) {
  const [showFlow, setShowFlow] = useState(false);
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
  const [signature, setSignature] = useState("");
  const [handoverDateTime, setHandoverDateTime] = useState(() => new Date().toISOString().slice(0, 16));
  const canManageHandover = profile?.role === "admin" || profile?.role === "developer";
  const canCompleteHandover = canManageHandover || profile?.role === "resident";
  const isResident = profile?.role === "resident";
  const handoverPcAllowed = buildingAllowsFlatHandover(building);
  const buildingLifecycle = derivedBuildingLifecycleStatus(building);
  const totalKeys = keyItems.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
  const formComplete = Boolean(
    selectedUnit.sale_status === "completed"
    && !existingHandover
    && handoverPcAllowed
    && recipientName.trim()
    && recipientEmail.trim()
    && recipientPhone.trim()
    && relationship
    && (relationship !== "Other" || relationshipOther.trim())
    && keyItems.some((item) => item.key_type.trim() && Number(item.quantity) > 0)
    && keyPhoto
    && electricityReading.trim()
    && electricityPhoto
    && waterReading.trim()
    && waterPhoto
    && signature
    && handoverDateTime,
  );

  function updateKeyItem(index: number, patch: Partial<{ key_type: string; quantity: number; notes: string }>) {
    setKeyItems((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
  }

  function resetDraft() {
    setShowFlow(false);
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
    setSignature("");
    setHandoverDateTime(new Date().toISOString().slice(0, 16));
  }

  async function submitHandover() {
    if (!formComplete) return;
    if (!handoverPcAllowed) {
      onNotice("Handover is available once PC has been confirmed.");
      return;
    }
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
        },
      ]);
      if (meterError) throw meterError;
      await recordAudit({
        event_type: "handover_completed",
        entity_type: "unit",
        entity_id: selectedUnit.id,
        summary: `Handover completed for unit ${selectedUnit.unit_number}`,
        metadata: { unit_number: selectedUnit.unit_number, building: building?.name, recipient_relationship: relationship, total_keys: totalKeys },
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

  if (existingHandover) {
    return (
      <div className="rounded-lg border border-[#d9ded6] bg-white p-3 text-sm">
        <p className="font-semibold text-[#0F3D2E]">Handover complete</p>
        <p className="mt-1 text-[#34413a]">Completed on {formatDateTime(existingHandover.handover_datetime ?? existingHandover.created_at ?? existingHandover.handover_date)}.</p>
        {isResident ? (
          <p className="mt-1 text-[#617169]">Completed by an authorised user.</p>
        ) : (
          <>
            <p className="mt-1 text-[#617169]">Keys collected by {existingHandover.recipient_name || "recipient"}.</p>
            {existingKeyItems.length > 0 && <p className="mt-1 text-xs text-[#617169]">{existingKeyItems.reduce((sum, item) => sum + item.quantity, 0)} key/fob item{existingKeyItems.length === 1 ? "" : "s"} recorded.</p>}
          </>
        )}
      </div>
    );
  }

  if (selectedUnit.sale_status !== "completed") {
    return (
      <div className="rounded-lg border border-[#D6A23A] bg-[#fff8e7] p-3 text-sm text-[#5c4a1f]">
        {isResident
          ? "Handover is not ready yet."
          : ["for_sale", "reserved", "exchanged"].includes(selectedUnit.sale_status)
            ? "Set the unit sale status to Completed before handover."
            : `Handover unavailable. This flat is currently marked as ${statusLabel(selectedUnit.sale_status)}.`}
      </div>
    );
  }

  if (!handoverPcAllowed) {
    return (
      <div className="rounded-lg border border-[#D6A23A] bg-[#fff8e7] p-3 text-sm text-[#5c4a1f]">
        {isResident ? "Handover is not ready yet." : "Handover is available once PC has been confirmed."}
      </div>
    );
  }

  if (!canCompleteHandover) {
    return <p className="text-sm text-[#617169]">Handover is ready once Bunnywell completes the appointment.</p>;
  }

  return (
    <div className="grid gap-3">
      {buildingLifecycle === "post_dlp_readonly" && (
        <div className="rounded-lg border border-[#d9ded6] bg-[#F7F5EF] p-3 text-sm text-[#34413a]">
          <p className="font-semibold text-[#0F3D2E]">This handover is taking place after the initial defects reporting period for the building has closed.</p>
          <p className="mt-2">Your handover record, key information, meter readings and useful documents will be available in the portal.</p>
          <p className="mt-2">New routine snag reports cannot be submitted through the portal. Please refer to the Home User Guide, building documents, managing agent or <a className="font-semibold underline" href="mailto:info@bunnywell.co.uk">info@bunnywell.co.uk</a> for guidance.</p>
        </div>
      )}
      {!showFlow ? (
        <button className="secondary min-h-10 justify-self-start px-3 py-1.5 text-sm" onClick={() => setShowFlow(true)}>{isResident ? "Complete handover" : "Start handover"}</button>
      ) : (
        <div className="grid gap-4 rounded-xl border border-[#d9ded6] bg-white p-3">
          <div className="grid gap-3 md:grid-cols-2">
            <label className="field-label">Full name<input className="field" value={recipientName} onChange={(event) => setRecipientName(event.target.value)} /></label>
            <label className="field-label">Email address<input className="field" value={recipientEmail} onChange={(event) => setRecipientEmail(event.target.value)} type="email" /></label>
            <label className="field-label">Phone number<input className="field" value={recipientPhone} onChange={(event) => setRecipientPhone(event.target.value)} /></label>
            <label className="field-label">Relationship to flat
              <select className="field" value={relationship} onChange={(event) => setRelationship(event.target.value)}>
                {["Buyer", "Tenant", "Family Member", "Letting Agent", "Other"].map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </label>
            {relationship === "Other" && <label className="field-label md:col-span-2">Relationship details<input className="field" value={relationshipOther} onChange={(event) => setRelationshipOther(event.target.value)} /></label>}
          </div>
          <div className="grid gap-2">
            <p className="text-sm font-semibold text-[#0F3D2E]">Keys and fobs</p>
            {keyItems.map((item, index) => (
              <div key={index} className="grid gap-2 rounded-xl border border-[#E2DED3] bg-[#FBFAF6] p-3 md:grid-cols-[1.4fr_110px_1fr_auto]">
                <select className="field" value={item.key_type} onChange={(event) => updateKeyItem(index, { key_type: event.target.value })}>
                  {["Front Door Key", "Post Box Key", "Window Key", "Meter Cupboard Key", "Communal Entrance Fob", "Parking Fob", "Other"].map((option) => <option key={option} value={option}>{option}</option>)}
                </select>
                <input className="field" type="number" min={1} value={item.quantity} onChange={(event) => updateKeyItem(index, { quantity: Number(event.target.value) })} />
                <input className="field" value={item.notes} onChange={(event) => updateKeyItem(index, { notes: event.target.value })} placeholder="Optional notes" />
                <button className="secondary px-3" onClick={() => setKeyItems((current) => current.filter((_, itemIndex) => itemIndex !== index))} disabled={keyItems.length === 1}>Remove</button>
              </div>
            ))}
            <button className="secondary w-fit" onClick={() => setKeyItems((current) => [...current, { key_type: "Other", quantity: 1, notes: "" }])}>Add key/fob</button>
            <SimplePhotoInput value={keyPhoto} onChange={setKeyPhoto} label="Add or take keys/fobs photo" />
          </div>
          <div className="grid items-stretch gap-4 md:grid-cols-2">
            <div className="grid h-full grid-rows-[auto_1fr] gap-3 rounded-xl border border-[#E2DED3] bg-[#FBFAF6] p-3">
              <label className="field-label">Electricity reading<input className="field" value={electricityReading} onChange={(event) => setElectricityReading(event.target.value)} /></label>
              <SimplePhotoInput value={electricityPhoto} onChange={setElectricityPhoto} label="Add or take electricity meter photo" />
            </div>
            <div className="grid h-full grid-rows-[auto_1fr] gap-3 rounded-xl border border-[#E2DED3] bg-[#FBFAF6] p-3">
              <label className="field-label">Water reading<input className="field" value={waterReading} onChange={(event) => setWaterReading(event.target.value)} /></label>
              <SimplePhotoInput value={waterPhoto} onChange={setWaterPhoto} label="Add or take water meter photo" />
            </div>
          </div>
          <label className="field-label">Handover date/time<input className="field" type="datetime-local" value={handoverDateTime} onChange={(event) => setHandoverDateTime(event.target.value)} /></label>
          <SignaturePad value={signature} onChange={setSignature} />
          <div className="flex flex-wrap justify-end gap-2">
            <button className="secondary" onClick={resetDraft}>Cancel</button>
            <button className="primary" onClick={submitHandover} disabled={!formComplete || isSubmitting}>{isSubmitting ? "Submitting..." : "Complete handover"}</button>
          </div>
        </div>
      )}
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
  const selectedBuildingLifecycle = derivedBuildingLifecycleStatus(selectedBuilding);
  const handoverAllowed = selectedUnit?.sale_status === "completed" && !existingHandover && buildingAllowsFlatHandover(selectedBuilding);
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
    if (!buildingAllowsFlatHandover(selectedBuilding)) {
      onNotice("Handover is available once PC has been confirmed.");
      return;
    }
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
            {!buildingAllowsFlatHandover(selectedBuilding)
              ? "Handover is available once PC has been confirmed."
              : `Handover unavailable. This flat is currently marked as ${currentStatus}. Handover can only take place once the flat is marked Completed.`}
          </div>
        )}
        {selectedUnit && !existingHandover && handoverAllowed && selectedBuildingLifecycle === "post_dlp_readonly" && (
          <div className="mt-4 rounded-xl border border-[#d9ded6] bg-[#F7F5EF] p-4 text-sm text-[#34413a]">
            <p className="font-semibold text-[#0F3D2E]">This handover is taking place after the initial defects reporting period for the building has closed.</p>
            <p className="mt-2">Your handover record, key information, meter readings and useful documents will be available in the portal.</p>
            <p className="mt-2">New routine snag reports cannot be submitted through the portal. Please refer to the Home User Guide, building documents, managing agent or <a className="font-semibold underline" href="mailto:info@bunnywell.co.uk">info@bunnywell.co.uk</a> for guidance.</p>
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
              <SimplePhotoInput value={keyPhoto} onChange={setKeyPhoto} disabled={!handoverAllowed} label="Add or take keys/fobs photo" />
            </div>
          )}
          {step === 2 && (
            <div className="grid gap-4">
              <SectionHeader title="Meter readings" subtitle="Electricity and water readings need a value and photograph." />
              <div className="grid items-stretch gap-4 md:grid-cols-2">
                <div className="grid h-full grid-rows-[auto_1fr] gap-3 rounded-xl border border-[#E2DED3] bg-[#FBFAF6] p-3">
                  <label className="field-label">Electricity reading<input className="field" value={electricityReading} onChange={(event) => setElectricityReading(event.target.value)} disabled={!handoverAllowed} /></label>
                  <SimplePhotoInput value={electricityPhoto} onChange={setElectricityPhoto} disabled={!handoverAllowed} label="Add or take electricity meter photo" />
                </div>
                <div className="grid h-full grid-rows-[auto_1fr] gap-3 rounded-xl border border-[#E2DED3] bg-[#FBFAF6] p-3">
                  <label className="field-label">Water reading<input className="field" value={waterReading} onChange={(event) => setWaterReading(event.target.value)} disabled={!handoverAllowed} /></label>
                  <SimplePhotoInput value={waterPhoto} onChange={setWaterPhoto} disabled={!handoverAllowed} label="Add or take water meter photo" />
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
    <section className="min-w-0 overflow-hidden rounded-md border border-[#d9ded6] bg-white">
      <div className="border-b border-[#d9ded6] px-4 py-3">
        <h2 className="text-lg font-semibold">Activity log</h2>
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
      <div className="grid gap-3 bg-[#F7F5EF] p-3 md:hidden">
        {filtered.map((event) => (
          <article key={event.id} className="mobile-card">
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
              <div className="min-w-0">
                <p className="break-words font-bold text-[#1F2A24]">{eventLabel(event.event_type)}</p>
                <p className="mt-0.5 text-xs text-[#617169]">{formatDateTime(event.created_at)}</p>
              </div>
              <span className="rounded-full bg-[#EEF6F1] px-2 py-1 text-right text-xs font-semibold leading-tight text-[#0F3D2E]">
                {entityLabel(event.entity_type)}
              </span>
            </div>
            <p className="mt-3 break-words text-sm text-[#34413a]">{event.summary}</p>
            <div className="mt-3 grid grid-cols-[4.5rem_minmax(0,1fr)] gap-3 text-sm">
              <span className="text-[#66736B]">User</span>
              <span className="min-w-0 break-words text-right font-medium">{authorName(event.created_by_user_id)}</span>
            </div>
          </article>
        ))}
        {filtered.length === 0 && <p className="mobile-empty">No audit events to show.</p>}
      </div>
      <div className="hidden overflow-x-auto md:block">
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
  buildingFloors,
  units,
  areas,
  trades,
  snags,
  photos,
  recordAudit,
}: {
  buildings: Building[];
  buildingFloors: BuildingFloor[];
  units: Unit[];
  areas: Area[];
  trades: Trade[];
  snags: ProductionSnag[];
  photos: SnagPhoto[];
  recordAudit: (event: Omit<AuditEvent, "id" | "created_at" | "created_by_user_id">) => Promise<void>;
}) {
  const reportBuildingIds = Array.from(new Set(snags.map((snag) => snag.building_id).filter(Boolean))) as string[];
  const reportUnitIds = Array.from(new Set(snags.map((snag) => snag.unit_id).filter(Boolean))) as string[];
  const reportCommunalAreaIds = Array.from(new Set(snags.filter((snag) => !snag.unit_id).map((snag) => snag.area_id).filter(Boolean))) as string[];
  const reportBuildings = buildings.filter((building) => reportBuildingIds.includes(building.id));
  const [buildingId, setBuildingId] = useState(reportBuildings[0]?.id ?? "");
  const [locationType, setLocationType] = useState<"unit" | "communal">("unit");
  const buildingUnits = units
    .filter((unit) => reportUnitIds.includes(unit.id))
    .filter((unit) => !buildingId || unit.building_id === buildingId);
  const sortedBuildingUnits = sortUnitsByFloorOrder(buildingUnits, buildingFloors, buildingId);
  const buildingCommunalAreas = sortAreasByFloorOrder(
    areas
      .filter((area) => reportCommunalAreaIds.includes(area.id))
      .filter((area) => area.area_type === "communal_area")
      .filter((area) => !buildingId || area.building_id === buildingId),
    buildingFloors,
    buildingId,
  );
  const [unitId, setUnitId] = useState(buildingUnits[0]?.id ?? "");
  const [communalAreaId, setCommunalAreaId] = useState("");
  const [includePhotos, setIncludePhotos] = useState(true);
  const [includeClosedSnags, setIncludeClosedSnags] = useState(false);
  const communalAreaIdsForReport = new Set(buildingCommunalAreas.map((area) => area.id));
  const reportSnags = snags
    .filter((snag) => {
      if (locationType === "unit") return snag.unit_id === unitId;
      if (communalAreaId) return !snag.unit_id && snag.area_id === communalAreaId;
      return !snag.unit_id && snag.area_id && communalAreaIdsForReport.has(snag.area_id);
    })
    .filter((snag) => includeClosedSnags || snag.status !== "closed");
  const unit = units.find((item) => item.id === unitId);
  const communalArea = areas.find((item) => item.id === communalAreaId);
  const building = buildings.find((item) => item.id === buildingId);
  const locationLabel = locationType === "unit"
    ? `Unit ${unit?.unit_number ?? ""}`.trim()
    : communalArea
      ? `${communalArea.name}${communalArea.floor ? ` / ${communalArea.floor}` : ""}`
      : "All communal areas";
  const locationSummaryLabel = locationType === "unit" ? "this flat" : communalArea ? "this communal area" : "all communal areas";

  useEffect(() => {
    if (!reportBuildings.some((building) => building.id === buildingId)) {
      setBuildingId(reportBuildings[0]?.id ?? "");
      return;
    }
    if (locationType === "unit") {
      if (!sortedBuildingUnits.some((unit) => unit.id === unitId)) {
        if (sortedBuildingUnits[0]) setUnitId(sortedBuildingUnits[0].id);
        else if (buildingCommunalAreas.length > 0) setLocationType("communal");
      }
    }
    if (locationType === "communal" && communalAreaId && !buildingCommunalAreas.some((area) => area.id === communalAreaId)) {
      setCommunalAreaId("");
    }
  }, [buildingCommunalAreas, buildingId, communalAreaId, locationType, reportBuildings, sortedBuildingUnits, unitId]);

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

    function reportChipColors(tone: "status" | "area" | "trade" | "missing_trade") {
      if (tone === "trade") {
        return {
          fill: [255, 248, 236],
          stroke: [214, 162, 58],
          label: [124, 91, 27],
          value: [15, 61, 46],
        };
      }
      if (tone === "missing_trade") {
        return {
          fill: [247, 247, 245],
          stroke: [216, 222, 216],
          label: [97, 113, 105],
          value: [97, 113, 105],
        };
      }
      if (tone === "area") {
        return {
          fill: [246, 250, 248],
          stroke: [210, 221, 216],
          label: [97, 113, 105],
          value: [15, 61, 46],
        };
      }
      return {
        fill: [239, 246, 241],
        stroke: [207, 225, 212],
        label: [97, 113, 105],
        value: [15, 61, 46],
      };
    }

    function measureReportChip(label: string, value: string, tone: "status" | "area" | "trade" | "missing_trade", maxWidth: number) {
      const labelText = label.toUpperCase();
      const safeValue = value.trim() || (label === "Trade" ? "No trade" : "Not set");
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(6.5);
      const labelWidth = pdf.getTextWidth(labelText);
      pdf.setFont("helvetica", tone === "trade" ? "bold" : "normal");
      pdf.setFontSize(8);
      const valueMaxWidth = Math.max(52, maxWidth - labelWidth - 30);
      const splitValue = pdf.splitTextToSize(safeValue, valueMaxWidth);
      const valueLines = (Array.isArray(splitValue) ? splitValue : [String(splitValue)]).slice(0, 2);
      const valueWidth = Math.max(...valueLines.map((line) => pdf.getTextWidth(line)), 34);
      return {
        height: valueLines.length > 1 ? 26 : 18,
        labelText,
        labelWidth,
        tone,
        valueLines,
        width: Math.min(maxWidth, Math.max(64, labelWidth + valueWidth + 26)),
      };
    }

    function layoutReportChips(
      chips: { label: string; value: string; tone: "status" | "area" | "trade" | "missing_trade" }[],
      maxWidth: number,
    ) {
      const gap = 6;
      let offsetX = 0;
      let offsetY = 0;
      let rowHeight = 0;
      const placed = chips.map((chip) => {
        const measured = measureReportChip(chip.label, chip.value, chip.tone, maxWidth);
        if (offsetX > 0 && offsetX + measured.width > maxWidth) {
          offsetX = 0;
          offsetY += rowHeight + 5;
          rowHeight = 0;
        }
        const current = { ...measured, offsetX, offsetY };
        offsetX += measured.width + gap;
        rowHeight = Math.max(rowHeight, measured.height);
        return current;
      });
      return { height: offsetY + rowHeight, placed };
    }

    function drawReportChip(chip: ReturnType<typeof measureReportChip> & { offsetX: number; offsetY: number }, x: number, chipY: number) {
      const colors = reportChipColors(chip.tone);
      pdf.setFillColor(colors.fill[0], colors.fill[1], colors.fill[2]);
      pdf.setDrawColor(colors.stroke[0], colors.stroke[1], colors.stroke[2]);
      pdf.setLineWidth(0.7);
      pdf.roundedRect(x, chipY, chip.width, chip.height, 4, 4, "FD");
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(6.5);
      pdf.setTextColor(colors.label[0], colors.label[1], colors.label[2]);
      pdf.text(chip.labelText, x + 7, chipY + 11);
      pdf.setFont("helvetica", chip.tone === "trade" ? "bold" : "normal");
      pdf.setFontSize(8);
      pdf.setTextColor(colors.value[0], colors.value[1], colors.value[2]);
      const valueX = x + 7 + chip.labelWidth + 6;
      chip.valueLines.forEach((line, lineIndex) => {
        pdf.text(line, valueX, chipY + 11 + lineIndex * 8);
      });
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
      pdf.text(`${building?.name ?? ""} / ${locationLabel}`, pageWidth - margin, 63, { align: "right" });
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
    pdf.text(locationLabel, pageWidth / 2, 435, { align: "center" });

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
      const trade = trades.find((item) => item.id === snag.trade_id)?.name ?? "No trade";
      const area = areas.find((item) => item.id === snag.area_id)?.name ?? "No area";
      const description = snag.description?.trim() || "No description";
      const photo = includePhotos ? primarySnagPhoto(photos.filter((item) => item.snag_id === snag.id)) : undefined;
      let imageData = "";
      let imageSize = { width: 0, height: 0 };
      if (photo) {
        try {
          imageData = await imageUrlToDataUrl(photo.file_url, { normalizeOrientation: true });
          imageSize = fittedImageSize(imageData, 130, 94);
        } catch {
          imageData = "";
        }
      }
      const imageHeight = imageData ? imageSize.height + 30 : 0;
      const textColumnWidth = 304;
      const chipTopOffset = 28;
      const chipLayout = layoutReportChips([
        { label: "Status", value: statusLabel(snag.status), tone: "status" },
        { label: "Area", value: area, tone: "area" },
        { label: "Trade", value: trade, tone: trade === "No trade" ? "missing_trade" : "trade" },
      ], textColumnWidth);
      const createdOffset = chipTopOffset + chipLayout.height + 12;
      const descriptionOffset = createdOffset + 17;
      const descriptionLines = pdf.splitTextToSize(description, textColumnWidth).slice(0, 3);
      const textHeight = descriptionOffset + descriptionLines.length * 10 + 14;
      const cardHeight = Math.max(124, textHeight, imageHeight);
      if (y + cardHeight > pageHeight - 60) {
        pdf.addPage();
        addPageHeader();
        y = 102;
      }

      pdf.setDrawColor(216, 222, 216);
      pdf.setFillColor(255, 255, 255);
      pdf.roundedRect(margin, y, pageWidth - margin * 2, cardHeight - 6, 5, 5, "FD");

      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(10);
      pdf.setTextColor(green);
      pdf.text(`${index + 1}. ${snag.title}`, margin + 12, y + 17, { maxWidth: 310 });

      chipLayout.placed.forEach((chip) => {
        drawReportChip(chip, margin + 12 + chip.offsetX, y + chipTopOffset + chip.offsetY);
      });

      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(8);
      pdf.setTextColor(97, 113, 105);
      pdf.text(`Created: ${formatDate(snag.created_at)}`, margin + 12, y + createdOffset);

      pdf.setTextColor(24, 32, 28);
      pdf.setFontSize(8.5);
      pdf.text(descriptionLines, margin + 12, y + descriptionOffset);

      if (imageData) {
        const imageX = pageWidth - margin - 14 - imageSize.width;
        pdf.addImage(imageData, imageFormat(imageData), imageX, y + 14, imageSize.width, imageSize.height);
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
    pdf.save(`${filenameSafe(`${building?.name ?? "building"}-${locationLabel}`)}-snagging-report.pdf`);
    await recordAudit({
      event_type: "report_generated",
      entity_type: locationType === "unit" ? "unit" : communalArea ? "area" : "building",
      entity_id: locationType === "unit" ? unit?.id ?? null : communalArea?.id ?? building?.id ?? null,
      summary: `Snagging report generated: ${building?.name ?? "Building"} / ${locationLabel}`,
      metadata: {
        buildingId,
        buildingName: building?.name,
        locationType,
        unitId: locationType === "unit" ? unitId : null,
        unitNumber: locationType === "unit" ? unit?.unit_number : null,
        communalAreaId: locationType === "communal" ? communalAreaId || null : null,
        communalAreaName: locationType === "communal" ? communalArea?.name ?? null : null,
        snagCount: reportSnags.length,
      },
    });
  }

  return (
    <FormPanel title="Print snag sheet">
      {snags.length === 0 && (
        <p className="rounded-md border border-dashed border-[#d9ded6] bg-[#f8faf7] p-3 text-sm text-[#617169]">No reportable snags are available for your account.</p>
      )}
      <select className="field" value={buildingId} onChange={(event) => setBuildingId(event.target.value)}>
        {reportBuildings.map((building) => <option key={building.id} value={building.id}>{building.name}</option>)}
      </select>
      <div className="grid grid-cols-2 gap-2">
        <button
          className={locationType === "unit" ? "primary" : "secondary"}
          type="button"
          onClick={() => setLocationType("unit")}
          disabled={sortedBuildingUnits.length === 0}
        >
          Flat
        </button>
        <button
          className={locationType === "communal" ? "primary" : "secondary"}
          type="button"
          onClick={() => setLocationType("communal")}
          disabled={buildingCommunalAreas.length === 0}
        >
          Communal
        </button>
      </div>
      {locationType === "unit" ? (
        <select className="field" value={unitId} onChange={(event) => setUnitId(event.target.value)} disabled={sortedBuildingUnits.length === 0}>
          {sortedBuildingUnits.length === 0 && <option value="">No flat snags available</option>}
          {sortedBuildingUnits.map((unit) => <option key={unit.id} value={unit.id}>{unit.unit_number}</option>)}
        </select>
      ) : (
        <select className="field" value={communalAreaId} onChange={(event) => setCommunalAreaId(event.target.value)} disabled={buildingCommunalAreas.length === 0}>
          <option value="">All communal areas</option>
          {buildingCommunalAreas.map((area) => (
            <option key={area.id} value={area.id}>
              {area.name}{area.floor ? ` / ${area.floor}` : ""}
            </option>
          ))}
        </select>
      )}
      <label className="option-card min-h-10 px-3 py-2 text-sm">
        <input checked={includePhotos} onChange={(event) => setIncludePhotos(event.target.checked)} type="checkbox" />
        Include photos
      </label>
      <label className="option-card min-h-10 px-3 py-2 text-sm">
        <input checked={includeClosedSnags} onChange={(event) => setIncludeClosedSnags(event.target.checked)} type="checkbox" />
        Include closed snags
      </label>
      <p className="text-sm text-[#617169]">{reportSnags.length} snag{reportSnags.length === 1 ? "" : "s"} will be included for {locationSummaryLabel}.</p>
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
  listActions,
  canReject = false,
  tradeControl,
  showFilters = false,
  requestedFilters,
  onDetailViewChange,
  residentMode = false,
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
  listActions?: (snag: ProductionSnag) => React.ReactNode;
  canReject?: boolean;
  tradeControl?: (snag: ProductionSnag, trade?: Trade) => React.ReactNode;
  showFilters?: boolean;
  requestedFilters?: SnagListFilters;
  onDetailViewChange?: (isOpen: boolean) => void;
  residentMode?: boolean;
}) {
  const [buildingFilter, setBuildingFilter] = useState("");
  const [unitFilter, setUnitFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [tradeFilter, setTradeFilter] = useState("");
  const [quickFilter, setQuickFilter] = useState<SnagListFilters["quickFilter"] | "">("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [previewPhoto, setPreviewPhoto] = useState<SnagPhoto | null>(null);
  const [selectedSnagId, setSelectedSnagId] = useState("");
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const availableBuildingIds = Array.from(new Set(snags.map((snag) => snag.building_id).filter(Boolean))) as string[];
  const availableBuildings = buildings.filter((building) => availableBuildingIds.includes(building.id));
  const selectedBuildingId = buildingFilter || availableBuildings[0]?.id || "";
  const buildingUnits = units.filter((unit) => unit.building_id === selectedBuildingId);
  const buildingCommunalAreas = areas
    .filter((area) => area.building_id === selectedBuildingId && area.area_type === "communal_area")
    .sort((a, b) => a.name.localeCompare(b.name));
  const buildingSnags = snags.filter((snag) => snag.building_id === selectedBuildingId);
  const workflowStatuses = ["open", "needs_more_info", "resolved_by_contractor", "rejected_back_to_contractor", "closed"];
  const statuses = workflowStatuses.filter((status) => buildingSnags.some((snag) => snag.status === status));
  const statusFilterStillAvailable = !statusFilter || statuses.includes(statusFilter);
  const activeStatusFilter = statusFilterStillAvailable ? statusFilter : "";
  const displayStatusLabel = residentMode ? residentSnagStatusLabel : statusLabel;
  const displayTableStatusLabel = residentMode ? residentSnagStatusLabel : snagListStatusLabel;
  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const in7 = new Date(now);
  in7.setDate(in7.getDate() + 7);
  const recentThreshold = new Date(now);
  recentThreshold.setDate(recentThreshold.getDate() - 7);
  const isToday = (value?: string | null) => Boolean(value && new Date(value) >= todayStart);
  const statusEventSnagIds = (status: string) => new Set(events
    .filter((event) => ["status_change", "triage"].includes(event.event_type))
    .filter((event) => event.new_value === status)
    .filter((event) => isToday(event.created_at))
    .map((event) => event.snag_id));
  const infoSuppliedSnagIds = new Set(events
    .filter((event) => ["status_change", "triage"].includes(event.event_type))
    .filter((event) => event.old_value === "needs_more_info" && event.new_value === "open")
    .map((event) => event.snag_id));
  const infoSuppliedTodaySnagIds = new Set(events
    .filter((event) => ["status_change", "triage"].includes(event.event_type))
    .filter((event) => event.old_value === "needs_more_info" && event.new_value === "open")
    .filter((event) => isToday(event.created_at))
    .map((event) => event.snag_id));
  const resolvedTodaySnagIds = statusEventSnagIds("resolved_by_contractor");
  const closedTodaySnagIds = statusEventSnagIds("closed");
  const rejectedTodaySnagIds = statusEventSnagIds("rejected_back_to_contractor");
  const moreInfoTodaySnagIds = statusEventSnagIds("needs_more_info");
  const filtered = snags
    .filter((snag) => snag.building_id === selectedBuildingId)
    .filter((snag) => {
      if (!unitFilter) return true;
      if (unitFilter === "__communal__") return !snag.unit_id;
      if (unitFilter.startsWith("area:")) return snag.area_id === unitFilter.replace("area:", "");
      return snag.unit_id === unitFilter;
    })
    .filter((snag) => {
      if (!activeStatusFilter) return true;
      return snag.status === activeStatusFilter;
    })
    .filter((snag) => {
      if (!tradeFilter) return true;
      if (tradeFilter === "__none__") return !snag.trade_id;
      return snag.trade_id === tradeFilter;
    })
    .filter((snag) => {
      if (quickFilter === "overdue") return Boolean(snag.sla_due_date && new Date(snag.sla_due_date) < now && !["closed", "resolved"].includes(snag.status));
      if (quickFilter === "due_soon") return Boolean(snag.sla_due_date && new Date(snag.sla_due_date) >= now && new Date(snag.sla_due_date) <= in7 && !["closed", "resolved"].includes(snag.status));
      if (quickFilter === "recent") return new Date(snag.updated_at || snag.created_at) >= recentThreshold;
      if (quickFilter === "created_today") return isToday(snag.created_at);
      if (quickFilter === "resolved_today") return resolvedTodaySnagIds.has(snag.id);
      if (quickFilter === "closed_today") return closedTodaySnagIds.has(snag.id) || Boolean(snag.status === "closed" && isToday(snag.closed_at));
      if (quickFilter === "rejected_today") return rejectedTodaySnagIds.has(snag.id);
      if (quickFilter === "more_info_today") return moreInfoTodaySnagIds.has(snag.id);
      if (quickFilter === "info_supplied") return infoSuppliedSnagIds.has(snag.id) && snag.status === "open";
      if (quickFilter === "info_supplied_today") return infoSuppliedTodaySnagIds.has(snag.id);
      return true;
    })
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
  const defaultBuildingId = availableBuildings[0]?.id ?? "";
  const hasActiveResultFilters = Boolean(
    (defaultBuildingId && selectedBuildingId !== defaultBuildingId) || unitFilter || activeStatusFilter || tradeFilter || quickFilter,
  );
  const showPaginationControls = filtered.length > 0 && totalPages > 1;
  const activeFilterCount = [
    defaultBuildingId && selectedBuildingId !== defaultBuildingId,
    unitFilter,
    activeStatusFilter,
    tradeFilter,
    quickFilter,
  ].filter(Boolean).length;
  const selectedBuildingName = buildings.find((building) => building.id === selectedBuildingId)?.name ?? "Building";
  const selectedLocationName = unitFilter
    ? unitFilter === "__communal__"
      ? "Communal"
      : unitFilter.startsWith("area:")
        ? buildingCommunalAreas.find((area) => area.id === unitFilter.replace("area:", ""))?.name ?? "Communal area"
        : `Unit ${buildingUnits.find((unit) => unit.id === unitFilter)?.unit_number ?? ""}`.trim()
    : "All locations";
  const selectedTradeName = residentMode
    ? ""
    : tradeFilter
      ? tradeFilter === "__none__" ? "No trade" : trades.find((trade) => trade.id === tradeFilter)?.name ?? "Trade"
      : "All trades";
  const selectedStatusName = activeStatusFilter ? displayStatusLabel(activeStatusFilter) : "All statuses";
  const selectedQuickFilterName = quickFilter ? quickFilterLabel(quickFilter) : "";
  const mobileFilterSummary = [selectedBuildingName, selectedLocationName, selectedTradeName, selectedStatusName, selectedQuickFilterName].filter(Boolean).join(" / ");
  const resultsSummary = snagResultsSummary({
    filtered: filtered.length,
    filtersActive: hasActiveResultFilters,
    pageEnd,
    pageStart,
    totalPages,
  });
  const pagedSnags = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const grouped = pagedSnags.reduce<Array<{ unitId: string; unitLabel: string; snags: ProductionSnag[] }>>((groups, snag) => {
    const unit = units.find((item) => item.id === snag.unit_id);
    const unitId = unit?.id ?? "communal";
    const unitLabel = unit ? `Unit ${unit.unit_number}` : "Communal";
    const group = groups.find((item) => item.unitId === unitId);
    if (group) group.snags.push(snag);
    else groups.push({ unitId, unitLabel: residentMode && unit ? `Flat ${unit.unit_number}` : unitLabel, snags: [snag] });
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
    if (!requestedFilters) return;
    if (requestedFilters.buildingId) setBuildingFilter(requestedFilters.buildingId);
    setUnitFilter(requestedFilters.unitFilter ?? "");
    setStatusFilter(requestedFilters.statusFilter ?? "");
    setTradeFilter(requestedFilters.tradeFilter ?? "");
    setQuickFilter(requestedFilters.quickFilter ?? "");
  }, [requestedFilters]);

  useEffect(() => {
    setPage(1);
  }, [selectedBuildingId, unitFilter, activeStatusFilter, tradeFilter, quickFilter, pageSize]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  useEffect(() => {
    onDetailViewChange?.(Boolean(selectedSnagId));
    if (!selectedSnagId || typeof window === "undefined") return;
    window.requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "auto" }));
  }, [onDetailViewChange, selectedSnagId]);

  function openSnagDetail(snagId: string) {
    onDetailViewChange?.(true);
    setSelectedSnagId(snagId);
  }

  function closeSnagDetail() {
    setSelectedSnagId("");
    onDetailViewChange?.(false);
  }

  const ResultsFooter = (
    <div className="flex flex-col gap-3 border-t border-[#d9ded6] bg-white px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm text-[#617169]" aria-live="polite">{resultsSummary}</p>
      {showPaginationControls && (
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-sm text-[#617169]">
            Snags per page
            <select
              className="field h-9 min-h-9 w-24"
              value={pageSize}
              onChange={(event) => {
                setPageSize(Number(event.target.value));
                setPage(1);
              }}
            >
              {[25, 50, 100].map((size) => <option key={size} value={size}>{size}</option>)}
            </select>
          </label>
          <span className="text-sm text-[#617169]">Page {currentPage} of {totalPages}</span>
          <button className="secondary h-9 min-h-9 w-9 px-0 py-0 text-base font-semibold leading-none" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={currentPage <= 1} aria-label="Previous page" title="Previous page">{"<"}</button>
          <button className="secondary h-9 min-h-9 w-9 px-0 py-0 text-base font-semibold leading-none" onClick={() => setPage((current) => Math.min(totalPages, current + 1))} disabled={currentPage >= totalPages} aria-label="Next page" title="Next page">{">"}</button>
        </div>
      )}
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
        onBack={closeSnagDetail}
        onNext={nextSnag ? () => openSnagDetail(nextSnag.id) : undefined}
        onNotice={onNotice}
        onOpenPhoto={setPreviewPhoto}
        onPrevious={previousSnag ? () => openSnagDetail(previousSnag.id) : undefined}
        photos={photos.filter((photo) => photo.snag_id === selectedSnag.id && photo.file_url)}
        profiles={profiles}
        previewPhoto={previewPhoto}
        reload={reload}
        residentMode={residentMode}
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
          <div className="mt-3 md:hidden">
            <button
              className="secondary flex w-full justify-between px-3"
              type="button"
              onClick={() => setMobileFiltersOpen((current) => !current)}
              aria-expanded={mobileFiltersOpen}
            >
              <span>Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}</span>
              <ChevronDown className={`transition ${mobileFiltersOpen ? "rotate-180" : ""}`} size={18} aria-hidden />
            </button>
            <p className="mt-2 truncate text-xs text-[#617169]">{mobileFilterSummary}</p>
          </div>
        )}
        {showFilters && (
          <div className={`${mobileFiltersOpen ? "grid" : "hidden"} mt-3 gap-2 md:grid ${residentMode ? "md:grid-cols-3" : "md:grid-cols-4"}`}>
            <select aria-label="Building filter" className="field" value={selectedBuildingId} onChange={(event) => setBuildingFilter(event.target.value)}>
              {availableBuildings.map((building) => <option key={building.id} value={building.id}>{building.name}</option>)}
            </select>
            <select aria-label="Unit filter" className={`field ${unitFilter ? "filter-active" : ""}`} value={unitFilter} onChange={(event) => setUnitFilter(event.target.value)}>
              <option value="">All units</option>
              {buildingUnits.length > 0 && (
                <optgroup label="Flats">
                  {buildingUnits.map((unit) => <option key={unit.id} value={unit.id}>{unit.unit_number}</option>)}
                </optgroup>
              )}
              <optgroup label="Communal">
                <option value="__communal__">All communal spaces</option>
                {buildingCommunalAreas.map((area) => <option key={area.id} value={`area:${area.id}`}>{area.name}</option>)}
              </optgroup>
            </select>
            {!residentMode && (
              <select aria-label="Trade filter" className={`field ${tradeFilter ? "filter-active" : ""}`} value={tradeFilter} onChange={(event) => setTradeFilter(event.target.value)}>
                <optgroup label="Filter options">
                  <option value="">All trades</option>
                  <option value="__none__">Trade not set</option>
                </optgroup>
                <optgroup label="Trades">
                  {trades.map((trade) => <option key={trade.id} value={trade.id}>{trade.name}</option>)}
                </optgroup>
              </select>
            )}
            <select aria-label="Status filter" className={`field ${activeStatusFilter ? "filter-active" : ""}`} value={activeStatusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="">All statuses</option>
              {statuses.map((status) => <option key={status} value={status}>{displayStatusLabel(status)}</option>)}
            </select>
            {quickFilter && (
              <button className="secondary md:col-span-4" onClick={() => setQuickFilter("")}>
                Clear {quickFilterLabel(quickFilter)} filter
              </button>
            )}
          </div>
        )}
      </div>
      <div className="bg-[#f1f4ef] p-3">
        <div className="grid gap-2 md:hidden">
          {pagedSnags.map((snag) => {
            const unit = units.find((item) => item.id === snag.unit_id);
            const area = areas.find((item) => item.id === snag.area_id);
            const trade = trades.find((item) => item.id === snag.trade_id);
            const photo = primarySnagPhoto(photos.filter((item) => item.snag_id === snag.id));
            const rowActions = listActions?.(snag);

            return (
              <article
                key={snag.id}
                className="rounded-xl border border-[#E2DED3] bg-white p-3 shadow-[0_6px_16px_rgba(31,42,36,0.05)] transition hover:border-[#D6A23A]"
              >
                <div className="grid grid-cols-[minmax(0,1fr)_58px] gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold leading-tight text-[#1F2A24]">{snag.title}</p>
                    <p className="mt-0.5 truncate text-xs text-[#66736B]">{unit?.unit_number ? `${residentMode ? "Flat" : "Unit"} ${unit.unit_number}` : "Communal"} / {area?.name ?? "No area"}</p>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      <span className={statusTone(snag.status)} title={statusLabel(snag.status)}>{displayTableStatusLabel(snag.status)}</span>
                      {snag.priority_code && <span className={statusTone(snag.priority_code)}>{snag.priority_code}</span>}
                    </div>
                  </div>
                  <div className="h-14 w-14 justify-self-end overflow-hidden rounded-lg border border-[#E2DED3] bg-[#FBFAF6]">
                    {photo?.file_url ? (
                      <SnagThumbnail photo={photo} onOpen={setPreviewPhoto} className="h-full w-full" width={240} height={240} />
                    ) : (
                      <div className="grid h-full place-items-center text-xs text-[#9aa59f]">No photo</div>
                    )}
                  </div>
                </div>
                <div className="mt-2 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 text-xs">
                  {!residentMode && (
                    <div className="min-w-0 truncate text-[#66736B]">
                      <span className="mr-1">Trade</span>
                      <span className="font-medium text-[#1F2A24]">{tradeControl ? tradeControl(snag, trade) : trade?.name ?? "No trade"}</span>
                    </div>
                  )}
                  <span className={`font-medium text-[#1F2A24] ${residentMode ? "col-start-2" : ""}`}>{formatDate(snag.created_at)}</span>
                </div>
                <div className="mt-2 flex flex-wrap justify-end gap-2 border-t border-[#E2DED3] pt-2">
                  {rowActions}
                  <button
                    className="snag-action-link"
                    onClick={() => openSnagDetail(snag.id)}
                    type="button"
                  >
                    Details <ChevronRight size={16} aria-hidden />
                  </button>
                </div>
              </article>
            );
          })}
        </div>
        <div className="hidden overflow-x-auto md:block">
        <table className={`${residentMode ? "min-w-[820px]" : "min-w-[980px]"} w-full border-separate border-spacing-0 text-sm`}>
          <thead>
            <tr className="text-left text-xs font-semibold uppercase text-[#617169]">
              <th className="border-b border-[#d9ded6] bg-white px-3 py-2">Title</th>
              <th className="border-b border-[#d9ded6] bg-white px-3 py-2">{residentMode ? "Flat" : "Unit"}</th>
              <th className="border-b border-[#d9ded6] bg-white px-3 py-2">Area</th>
              {!residentMode && <th className="border-b border-[#d9ded6] bg-white px-3 py-2">Trade</th>}
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
                  <td colSpan={residentMode ? 7 : 8} className="border-b border-[#d9ded6] bg-[#f8faf7] px-3 py-2 text-sm font-semibold">
                    {group.unitLabel} <span className="font-normal text-[#617169]">({group.snags.length})</span>
                  </td>
                </tr>
                {group.snags.map((snag) => {
                  const unit = units.find((item) => item.id === snag.unit_id);
                  const area = areas.find((item) => item.id === snag.area_id);
                  const trade = trades.find((item) => item.id === snag.trade_id);
                  const photo = primarySnagPhoto(photos.filter((item) => item.snag_id === snag.id));
                  const rowActions = listActions?.(snag);

                  return (
                    <tr
                      key={snag.id}
                      className="align-middle transition hover:bg-[#f8faf7]"
                    >
                      <td className="border-b border-[#e5e9e4] bg-white px-3 py-2 align-middle">
                        <p className="max-w-xs truncate font-medium">{snag.title}</p>
                        {snag.description && <p className="mt-0.5 max-w-xs truncate text-xs text-[#617169]">{snag.description}</p>}
                      </td>
                      <td className="border-b border-[#e5e9e4] bg-white px-3 py-2 align-middle">{unit?.unit_number ?? "Communal"}</td>
                      <td className="border-b border-[#e5e9e4] bg-white px-3 py-2 align-middle">{area?.name ?? "No area"}</td>
                      {!residentMode && <td className="border-b border-[#e5e9e4] bg-white px-3 py-2 align-middle">{tradeControl ? tradeControl(snag, trade) : trade?.name ?? "No trade"}</td>}
                      <td className="border-b border-[#e5e9e4] bg-white px-3 py-2 align-middle">
                        <span className={statusTone(snag.status)} title={statusLabel(snag.status)}>{displayTableStatusLabel(snag.status)}</span>
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
                        <div className="flex min-w-40 items-center justify-end gap-3 whitespace-nowrap">
                          {rowActions}
                          <button
                            className="snag-action-link"
                            onClick={() => openSnagDetail(snag.id)}
                            type="button"
                          >
                            Details <ChevronRight size={16} aria-hidden />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </Fragment>
            ))}
          </tbody>
        </table>
        </div>
        {ResultsFooter}
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
  return <SnagThumbnail photo={photo} onOpen={onOpen} className="h-10 w-14 rounded border border-[#d9ded6]" width={240} height={180} />;
}

function SnagThumbnail({
  photo,
  onOpen,
  className,
  width,
  height,
}: {
  photo: SnagPhoto;
  onOpen: (photo: SnagPhoto) => void;
  className: string;
  width: number;
  height: number;
}) {
  const containerRef = useRef<HTMLButtonElement | null>(null);
  const [visibleUrl, setVisibleUrl] = useState<string | null>(null);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const thumbnailUrl = supabaseStorageThumbnailUrl(photo.file_url, width, height);
  const shouldLoad = visibleUrl === thumbnailUrl;
  const failed = failedUrl === thumbnailUrl;

  useEffect(() => {
    if (!thumbnailUrl || failed) return;
    const element = containerRef.current;
    if (!element) return;
    if (typeof IntersectionObserver === "undefined") {
      const frame = window.requestAnimationFrame(() => setVisibleUrl(thumbnailUrl));
      return () => window.cancelAnimationFrame(frame);
    }
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      setVisibleUrl(thumbnailUrl);
      observer.disconnect();
    }, { rootMargin: "360px 0px" });
    observer.observe(element);
    return () => observer.disconnect();
  }, [failed, thumbnailUrl]);

  if (!thumbnailUrl || failed || !photo.file_url) {
    return (
      <button
        className={`grid cursor-pointer place-items-center bg-[#FBFAF6] text-xs text-[#9aa59f] ${className}`}
        onClick={(event) => {
          event.stopPropagation();
          onOpen(photo);
        }}
        aria-label="Open full photo"
        title="Open full photo"
        type="button"
      >
        Open
      </button>
    );
  }

  return (
    <button
      ref={containerRef}
      className={`relative block cursor-pointer overflow-hidden bg-[#FBFAF6] ${className}`}
      onClick={(event) => {
        event.stopPropagation();
        onOpen(photo);
      }}
      aria-label="Open photo preview"
      title="View photo"
      type="button"
    >
      <span className="absolute inset-0 animate-pulse bg-[#eef1ec]" aria-hidden />
      {shouldLoad && (
        <img
          src={thumbnailUrl}
          alt=""
          className="relative h-full w-full object-cover transition hover:opacity-80"
          loading="lazy"
          decoding="async"
          onError={() => setFailedUrl(thumbnailUrl)}
        />
      )}
    </button>
  );
}

type ActivityTab = "timeline" | "notes" | "photos" | "audit";

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
  residentMode = false,
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
  residentMode?: boolean;
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
  const [activityTab, setActivityTab] = useState<ActivityTab>("timeline");
  const [showAllAudit, setShowAllAudit] = useState(false);
  const [expandedNoteGroups, setExpandedNoteGroups] = useState<string[]>([]);
  const primaryPhoto = primarySnagPhoto(photos);
  const area = areas.find((item) => item.id === snag.area_id);
  const displayStatusLabel = residentMode ? residentSnagStatusLabel : statusLabel;
  const sortedEvents = useMemo(() => [...events].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()), [events]);
  const sortedPhotos = useMemo(() => [...photos].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()), [photos]);
  const noteEvents = sortedEvents.filter((event) => ["note", "access_note"].includes(event.event_type));
  const statusChangeCount = sortedEvents.filter((event) => event.event_type === "status_change" || event.event_type === "triage").length;
  const lastUpdatedTime = Math.max(new Date(snag.updated_at).getTime(), sortedEvents[0] ? new Date(sortedEvents[0].created_at).getTime() : 0);
  const auditEvents = showAllAudit ? sortedEvents : sortedEvents.slice(0, 10);
  const activityTabs: { key: ActivityTab; label: string }[] = residentMode
    ? [
        { key: "timeline", label: "Timeline" },
        { key: "notes", label: "Notes" },
        { key: "photos", label: "Photos" },
      ]
    : [
        { key: "timeline", label: "Timeline" },
        { key: "notes", label: "Notes" },
        { key: "photos", label: "Photos" },
        { key: "audit", label: "Audit" },
      ];

  function authorName(userId?: string | null, fallback = "Unknown user") {
    if (!userId) return "System";
    const profile = profiles.find((item) => item.id === userId);
    if (profile) return profile.full_name || profile.name || profile.email || fallback;
    if (userId === user.id) {
      const metadataName = typeof user.user_metadata?.full_name === "string"
        ? user.user_metadata.full_name
        : typeof user.user_metadata?.name === "string"
          ? user.user_metadata.name
          : "";
      return metadataName || user.email || fallback;
    }
    return fallback;
  }

  function timelineHeading(event: SnagEvent) {
    if (event.event_type === "status_change" || event.event_type === "triage") return displayStatusLabel(event.new_value ?? event.event_type);
    if (event.event_type === "trade_changed") return event.new_value ? `Trade set to ${event.new_value}` : "Trade changed";
    if (event.event_type === "priority_changed") return event.new_value ? `Priority set to ${event.new_value}` : "Priority changed";
    return eventLabel(event.event_type);
  }

  function timelineCardClass(value?: string | null) {
    if (value && ["rejected", "rejected_back_to_contractor", "needs_more_info"].includes(value)) {
      return "border-[#e2a74d] bg-[#fff8ec]";
    }
    if (value && ["closed", "resolved", "resolved_by_contractor"].includes(value)) {
      return "border-[#cfe1d4] bg-[#f6fbf7]";
    }
    return "border-[#d9ded6] bg-white";
  }

  function timelineAuthorName(event: SnagEvent) {
    const actorId = event.created_by_user_id ?? snag.created_by_user_id ?? snag.created_by ?? null;
    const fallback = snag.source_type === "leaseholder_defect" ? "Resident" : "Unknown user";
    return authorName(actorId, fallback);
  }

  function toggleNoteGroup(groupId: string) {
    setExpandedNoteGroups((current) => current.includes(groupId) ? current.filter((item) => item !== groupId) : [...current, groupId]);
  }

  const lifecycleEvents = sortedEvents
    .filter((event) => ["created", "submitted", "assigned", "triage", "status_change", "trade_changed", "priority_changed"].includes(event.event_type))
    .filter((event) => !residentMode || event.event_type !== "trade_changed")
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  const timelineItems = lifecycleEvents.length > 0
    ? lifecycleEvents
    : [{
      id: "created",
      snag_id: snag.id,
      event_type: "created",
      old_value: null,
      new_value: snag.status,
      comment: null,
      created_by_user_id: snag.created_by_user_id ?? snag.created_by ?? null,
      created_at: snag.created_at,
    }];
  const noteGroups = noteEvents.reduce<{ id: string; userId: string | null; createdAt: string; events: SnagEvent[] }[]>((groups, event) => {
    const minute = new Date(event.created_at).toISOString().slice(0, 16);
    const id = `${event.created_by_user_id ?? "system"}-${minute}`;
    const existing = groups.find((group) => group.id === id);
    if (existing) existing.events.push(event);
    else groups.push({ id, userId: event.created_by_user_id, createdAt: event.created_at, events: [event] });
    return groups;
  }, []);

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

  const hasDetailActions = Boolean(actions || (canReject && snag.status === "resolved_by_contractor"));

  return (
    <section className="rounded-md border border-[#d9ded6] bg-white">
      <div className="border-b border-[#d9ded6] px-4 py-3">
        <div className="flex w-full items-center gap-3">
          <button className="secondary min-h-9 px-3 py-1.5 text-sm" onClick={onBack}>Back</button>
          <span className={`ml-auto rounded-md px-2 py-1 text-xs font-semibold ${statusTone(snag.status)}`}>{displayStatusLabel(snag.status)}</span>
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
        <p className="text-sm text-[#617169]">{unit?.unit_number ? `${residentMode ? "Flat" : "Unit"} ${unit.unit_number}` : "Communal"} / {area?.name ?? "No area"}</p>
        {hasDetailActions && (
          <div className="mt-3 rounded-md border border-[#d9ded6] bg-[#f8faf7] p-3">
            <div className="flex flex-wrap items-center gap-3">
              {actions}
              {canReject && snag.status === "resolved_by_contractor" && (
                <button className="snag-action-link snag-action-warning" onClick={() => setShowReject((current) => !current)} type="button">
                  <CircleHelp size={16} aria-hidden /> Reject back to contractor
                </button>
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
            <DetailField label={residentMode ? "Flat" : "Unit"} value={unit?.unit_number ?? "Communal"} />
            <DetailField label="Area" value={area?.name ?? "No area"} />
            {!residentMode && <div>
              <p className="text-xs font-semibold uppercase text-[#617169]">Trade</p>
              <div className="mt-1">{tradeControl ?? trade?.name ?? <span className="text-xs text-[#9aa59f]">No trade</span>}</div>
            </div>}
            <DetailField label="Created" value={formatDateTime(snag.created_at)} />
            <div className="sm:col-span-2">
              <p className="text-xs font-semibold uppercase text-[#617169]">Description</p>
              <p className="mt-1 text-[#34413a]">{snag.description || "No description"}</p>
            </div>
          </div>
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
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="font-semibold text-[#0F3D2E]">Activity</h3>
              <p className="mt-1 text-sm text-[#617169]">Status, notes, photos and audit history for this snag.</p>
            </div>
            <span className={`rounded-md px-2 py-1 text-xs font-semibold ${statusTone(snag.status)}`}>{statusLabel(snag.status)}</span>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
            <div className="rounded-md border border-[#d9ded6] bg-white p-2">
              <p className="text-[0.68rem] font-semibold uppercase text-[#617169]">Created</p>
              <p className="mt-1 text-xs text-[#34413a]">{formatDateTime(snag.created_at)}</p>
            </div>
            <div className="rounded-md border border-[#d9ded6] bg-white p-2">
              <p className="text-[0.68rem] font-semibold uppercase text-[#617169]">Updated</p>
              <p className="mt-1 text-xs text-[#34413a]">{formatDateTime(new Date(lastUpdatedTime).toISOString())}</p>
            </div>
            <div className="rounded-md border border-[#d9ded6] bg-white p-2">
              <p className="text-[0.68rem] font-semibold uppercase text-[#617169]">Notes</p>
              <p className="mt-1 text-lg font-semibold text-[#0F3D2E]">{noteEvents.length}</p>
            </div>
            <div className="rounded-md border border-[#d9ded6] bg-white p-2">
              <p className="text-[0.68rem] font-semibold uppercase text-[#617169]">Photos</p>
              <p className="mt-1 text-lg font-semibold text-[#0F3D2E]">{photos.length}</p>
            </div>
            <div className="rounded-md border border-[#d9ded6] bg-white p-2 sm:col-span-2">
              <p className="text-[0.68rem] font-semibold uppercase text-[#617169]">Status changes</p>
              <p className="mt-1 text-lg font-semibold text-[#0F3D2E]">{statusChangeCount}</p>
            </div>
          </div>
          <div className="mt-4 flex gap-2 overflow-x-auto border-b border-[#d9ded6] pb-2">
            {activityTabs.map((tab) => (
              <button
                key={tab.key}
                className={`min-h-9 shrink-0 rounded-full border px-3 text-sm font-semibold transition ${activityTab === tab.key ? "border-[#0F3D2E] bg-[#0F3D2E] text-white shadow-sm" : "border-[#d9ded6] bg-white text-[#0F3D2E] hover:border-[#D6A23A]"}`}
                onClick={() => setActivityTab(tab.key)}
              >
                {tab.label}
              </button>
            ))}
          </div>
          {activityTab === "timeline" && (
            <div className="mt-4 grid gap-3">
              {timelineItems.map((event) => (
                <div key={event.id} className={`rounded-md border p-3 text-sm ${timelineCardClass(event.new_value)}`}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold text-[#0F3D2E]">{timelineHeading(event)}</p>
                      <p className="mt-1 text-xs text-[#617169]">{formatDateTime(event.created_at)} / {timelineAuthorName(event)}</p>
                    </div>
                    {event.new_value && <span className={`rounded-md px-2 py-1 text-xs font-semibold ${statusTone(event.new_value)}`}>{statusLabel(event.new_value)}</span>}
                  </div>
                  {event.comment && <p className="mt-3 text-[#34413a]">{event.comment}</p>}
                </div>
              ))}
              {timelineItems.length === 0 && <p className="text-sm text-[#617169]">No activity recorded.</p>}
            </div>
          )}
          {activityTab === "notes" && (
            <div className="mt-4 grid gap-3">
              {noteGroups.map((group) => {
                const expanded = expandedNoteGroups.includes(group.id);
                const grouped = group.events.length > 1;
                return (
                  <div key={group.id} className="rounded-md border border-[#d9ded6] bg-white p-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-semibold text-[#0F3D2E]">
                        {grouped ? `${authorName(group.userId)} added ${group.events.length} notes` : authorName(group.userId)}
                      </p>
                      <p className="text-xs text-[#617169]">{formatDateTime(group.createdAt)}</p>
                    </div>
                    {grouped && (
                      <button className="mt-2 text-xs font-semibold text-[#0F3D2E] underline" onClick={() => toggleNoteGroup(group.id)}>
                        {expanded ? "Collapse notes" : "View notes"}
                      </button>
                    )}
                    {(!grouped || expanded) && (
                      <div className="mt-3 grid gap-2">
                        {group.events.map((event) => (
                          <p key={event.id} className="rounded-md bg-[#f8faf7] px-3 py-2 text-[#34413a]">{event.comment || "No note text recorded."}</p>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
              {noteGroups.length === 0 && <p className="text-sm text-[#617169]">No notes yet.</p>}
              <div className="grid gap-2 rounded-md border border-[#d9ded6] bg-white p-3">
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
            </div>
          )}
          {activityTab === "photos" && (
            <div className="mt-4 grid gap-3">
              {sortedPhotos.map((item) => (
                <button key={item.id} className="grid cursor-pointer grid-cols-[5rem_minmax(0,1fr)] gap-3 rounded-md border border-[#d9ded6] bg-white p-2 text-left transition hover:border-[#D6A23A]" onClick={() => onOpenPhoto(item)}>
                  <img src={item.file_url} alt="" className="h-16 w-20 rounded-md border border-[#d9ded6] object-cover" />
                  <span className="self-center text-sm">
                    <span className="block font-semibold text-[#0F3D2E]">{item.photo_type === "resolution_photo" ? "Follow-up photo" : "Snag photo"}</span>
                    <span className="mt-1 block text-xs text-[#617169]">{formatDateTime(item.created_at)} / {authorName(item.uploaded_by_user_id)}</span>
                  </span>
                </button>
              ))}
              {sortedPhotos.length === 0 && <p className="text-sm text-[#617169]">No photos added.</p>}
            </div>
          )}
          {activityTab === "audit" && (
            <div className="mt-4 grid gap-3">
              {auditEvents.map((event) => (
                <div key={event.id} className="rounded-md border border-[#d9ded6] bg-white p-3 text-sm">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <p className="font-semibold text-[#0F3D2E]">{eventLabel(event.event_type)}</p>
                    <p className="text-xs text-[#617169]">{formatDateTime(event.created_at)}</p>
                  </div>
                  <p className="mt-1 text-xs text-[#617169]">{authorName(event.created_by_user_id)}</p>
                  {event.comment && <p className="mt-2 text-[#34413a]">{event.comment}</p>}
                  {(event.old_value || event.new_value) && (
                    <p className="mt-2 text-xs text-[#617169]">{event.old_value ? `${statusLabel(event.old_value)} -> ` : ""}{event.new_value ? statusLabel(event.new_value) : ""}</p>
                  )}
                </div>
              ))}
              {sortedEvents.length === 0 && <p className="text-sm text-[#617169]">No activity recorded.</p>}
              {sortedEvents.length > 10 && (
                <button className="secondary min-h-9 justify-self-start px-3 py-1.5 text-sm" onClick={() => setShowAllAudit((current) => !current)}>
                  {showAllAudit ? "Show latest 10" : "Show all activity"}
                </button>
              )}
            </div>
          )}
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

function SimplePhotoInput({ value, onChange, disabled = false, label = "Add or take photo" }: { value: string; onChange: (value: string) => void; disabled?: boolean; label?: string }) {
  function loadFile(file?: File) {
    if (!file || disabled) return;
    const reader = new FileReader();
    reader.onload = () => onChange(String(reader.result));
    reader.readAsDataURL(file);
  }

  return (
    <div className="grid h-full gap-2">
      <label className={`camera-action ${disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}>
        <Camera size={18} aria-hidden />
        {value ? "Replace photo" : label}
        <input
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          disabled={disabled}
          onChange={(event) => loadFile(event.target.files?.[0])}
        />
      </label>
      <div className="grid min-h-44 place-items-center rounded-xl border border-dashed border-[#d9ded6] bg-white p-2">
        {value ? (
          <img src={value} alt="" className="max-h-56 w-full rounded-md object-contain" />
        ) : (
          <p className="text-center text-sm text-[#66736B]">No photo added.</p>
        )}
      </div>
      {value && (
        <button className="secondary min-h-9 justify-self-start px-3 py-1.5 text-sm" disabled={disabled} onClick={() => onChange("")}>
          Remove photo
        </button>
      )}
    </div>
  );
}

function PhotoInput({ value, onChange, disabled = false }: { value: string; onChange: (value: string) => void; disabled?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [baseImage, setBaseImage] = useState("");
  const [strokes, setStrokes] = useState<{ x: number; y: number }[][]>([]);
  const [drawing, setDrawing] = useState(false);
  const [isAnnotating, setIsAnnotating] = useState(false);

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
      setBaseImage("");
      setIsAnnotating(false);
      onChange(String(reader.result));
    };
    reader.readAsDataURL(file);
  }

  function openAnnotationEditor() {
    if (!value || disabled) return;
    setStrokes([]);
    setBaseImage(value);
    setIsAnnotating(true);
  }

  function removePhoto() {
    setBaseImage("");
    setStrokes([]);
    setIsAnnotating(false);
    onChange("");
  }

  return (
    <div className="grid gap-2">
      <label className={`camera-action ${disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}>
        <Camera size={18} aria-hidden />
        {value ? "Replace photo" : "Add or take photo"}
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
          {!isAnnotating && (
            <>
              <button className="secondary min-h-11 w-full justify-center px-4 py-2 text-sm" onClick={openAnnotationEditor} disabled={disabled} aria-label="Annotate photo">
                <Pencil size={17} aria-hidden />
                Annotate Photo
              </button>
              <button
                className="group relative cursor-pointer overflow-hidden rounded-md border border-[#d9ded6] bg-[#eef1ec] text-left transition hover:border-[#D6A23A] hover:shadow-sm disabled:cursor-not-allowed disabled:opacity-60"
                onClick={openAnnotationEditor}
                disabled={disabled}
                aria-label="Open photo annotation editor"
              >
                <span className="absolute right-2 top-2 z-10 rounded-full bg-[#0F3D2E]/92 px-2.5 py-1 text-xs font-semibold text-white shadow-md sm:text-sm">
                  Tap to annotate
                </span>
                <img
                  src={value}
                  alt="Uploaded defect photo. Tap to annotate."
                  className="max-h-[28rem] min-h-44 w-full cursor-pointer object-contain transition group-hover:scale-[1.01] group-hover:opacity-95"
                />
              </button>
              <button className="secondary min-h-9 justify-self-start px-3 py-1.5 text-sm" disabled={disabled} onClick={removePhoto}>Remove photo</button>
            </>
          )}
          {isAnnotating && (
            <>
              <canvas
                ref={canvasRef}
                className="h-auto w-full touch-none cursor-crosshair rounded-md border border-[#d9ded6] bg-[#eef1ec]"
                aria-label="Photo annotation editor"
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
                  onClick={removePhoto}
                >
                  Remove
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

async function imageUrlToDataUrl(url: string, options: { normalizeOrientation?: boolean; maxDimension?: number } = {}) {
  const response = await fetch(url);
  const blob = await response.blob();
  if (options.normalizeOrientation && blob.type.startsWith("image/")) {
    return imageBlobToCanvasDataUrl(blob, options.maxDimension ?? 1800);
  }

  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function imageBlobToCanvasDataUrl(blob: Blob, maxDimension: number) {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" });
      try {
        return drawImageSourceToDataUrl(bitmap, bitmap.width, bitmap.height, blob.type, maxDimension);
      } finally {
        bitmap.close();
      }
    } catch {
      // Fall back to HTMLImageElement below; some browsers/storage formats do not support createImageBitmap.
    }
  }

  const objectUrl = URL.createObjectURL(blob);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("Image could not be loaded for the PDF report."));
      element.src = objectUrl;
    });

    return drawImageSourceToDataUrl(image, image.naturalWidth, image.naturalHeight, blob.type, maxDimension);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function drawImageSourceToDataUrl(source: CanvasImageSource, sourceWidth: number, sourceHeight: number, mimeType: string, maxDimension: number) {
  const largestSide = Math.max(sourceWidth, sourceHeight);
  const scale = largestSide > maxDimension ? maxDimension / largestSide : 1;
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Image could not be prepared for the PDF report.");

  const outputType = mimeType === "image/png" ? "image/png" : "image/jpeg";
  if (outputType === "image/jpeg") {
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
  }
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(source, 0, 0, width, height);

  return outputType === "image/png" ? canvas.toDataURL(outputType) : canvas.toDataURL(outputType, 0.88);
}

function filterBuildingsForRole(buildings: Building[], units: Unit[], profile: Profile | null, accessibleUnitIds: string[], accessibleBuildingIds: string[]) {
  if (!profile) return [];
  if (profile.role === "admin" || profile.role === "developer") return buildings;
  if (profile.role === "resident") {
    const buildingIds = new Set(units.filter((unit) => accessibleUnitIds.includes(unit.id)).map((unit) => unit.building_id));
    return buildings.filter((building) => buildingIds.has(building.id));
  }
  if (profile.role === "developer_representative" || profile.role === "contractor") {
    return buildings.filter((building) => accessibleBuildingIds.includes(building.id));
  }
  return [];
}

function filterUnitsForRole(units: Unit[], profile: Profile | null, accessibleUnitIds: string[], accessibleBuildingIds: string[]) {
  if (!profile) return [];
  if (profile.role === "admin" || profile.role === "developer") return units;
  if (profile.role === "resident") return units.filter((unit) => accessibleUnitIds.includes(unit.id));
  if (profile.role === "developer_representative" || profile.role === "contractor") return units.filter((unit) => accessibleBuildingIds.includes(unit.building_id));
  return [];
}

function filterAreasForRole(areas: Area[], profile: Profile | null, buildings: Building[], units: Unit[]) {
  if (!profile) return [];
  const buildingIds = new Set(buildings.map((building) => building.id));
  const unitIds = new Set(units.map((unit) => unit.id));
  return areas.filter((area) => (area.unit_id ? unitIds.has(area.unit_id) : buildingIds.has(area.building_id)));
}

function filterUnitLinkedRows<T>(rows: T[], units: Unit[], getUnitId: (row: T) => string | null | undefined) {
  const unitIds = new Set(units.map((unit) => unit.id));
  return rows.filter((row) => {
    const unitId = getUnitId(row);
    return Boolean(unitId && unitIds.has(unitId));
  });
}

function filterSnagsForRole(snags: ProductionSnag[], profile: Profile | null, accessibleUnitIds: string[], accessibleBuildingIds: string[]) {
  if (!profile) return [];
  if (profile.role === "resident") {
    return snags.filter((snag) => snag.source_type === "leaseholder_defect" && snag.unit_id && accessibleUnitIds.includes(snag.unit_id));
  }
  if (profile.role === "contractor" || profile.role === "developer_representative") {
    return snags.filter((snag) => (
      Boolean(snag.building_id && accessibleBuildingIds.includes(snag.building_id))
      || Boolean(profile.role === "contractor" && profile.organisation_id && snag.assigned_to_organisation_id === profile.organisation_id)
    ));
  }
  return snags;
}

