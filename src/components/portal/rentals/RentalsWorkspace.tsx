"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import type { Building, BuildingFloor, Organisation, Unit } from "@/lib/data/production";
import { formatGbp } from "@/lib/sales/currency";
import { saleStatusLabel, sortUnitsByBuildingFloorOrder } from "@/lib/units/commercial-allocation";
import {
  activeTenancy,
  currentVoidDays,
  nextTenancy,
  orderedTenancies,
  rentalOccupancy,
  summariseRentals,
  tenancyHistoryMetrics,
  tenancyState,
  totalHistoricalVoidDays,
  type TenancySourceType,
  type UnitTenancy,
} from "@/lib/rentals/tenancies";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

const PAGE_SIZE = 12;

type TenancyDraft = {
  tenantName: string;
  tenancyStartDate: string;
  fixedTermEndDate: string;
  tenancyEndDate: string;
  monthlyRent: string;
  rentDueDay: string;
  depositAmount: string;
  lettingAgentOrganisationId: string;
  notes: string;
  sourceType: TenancySourceType;
  sourceReference: string;
};

const blankDraft: TenancyDraft = {
  tenantName: "", tenancyStartDate: "", fixedTermEndDate: "", tenancyEndDate: "",
  monthlyRent: "", rentDueDay: "", depositAmount: "", lettingAgentOrganisationId: "",
  notes: "", sourceType: "manual", sourceReference: "",
};

function draftFromTenancy(tenancy?: UnitTenancy | null): TenancyDraft {
  if (!tenancy) return blankDraft;
  return {
    tenantName: tenancy.tenant_name,
    tenancyStartDate: tenancy.tenancy_start_date,
    fixedTermEndDate: tenancy.fixed_term_end_date ?? "",
    tenancyEndDate: tenancy.tenancy_end_date ?? "",
    monthlyRent: String(tenancy.monthly_rent),
    rentDueDay: tenancy.rent_due_day ? String(tenancy.rent_due_day) : "",
    depositAmount: tenancy.deposit_amount === null ? "" : String(tenancy.deposit_amount),
    lettingAgentOrganisationId: tenancy.letting_agent_organisation_id ?? "",
    notes: tenancy.notes ?? "",
    sourceType: tenancy.source_type,
    sourceReference: tenancy.source_reference ?? "",
  };
}

function formatDate(value?: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "2-digit", timeZone: "UTC" }).format(new Date(`${value.slice(0, 10)}T00:00:00Z`));
}

function occupancyBadge(occupied: boolean) {
  return occupied
    ? "border-[#bedacb] bg-[#edf8f1] text-[#286348]"
    : "border-[#ead8a7] bg-[#fff8e8] text-[#765a18]";
}

async function authHeaders() {
  const { data } = await createSupabaseBrowserClient().auth.getSession();
  return { "Content-Type": "application/json", Authorization: `Bearer ${data.session?.access_token ?? ""}` };
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg border border-[#d9ded6] bg-white p-4"><p className="text-xs font-bold uppercase tracking-[0.08em] text-[#617169]">{label}</p><p className="numeric-value mt-2 text-2xl font-bold text-[#0F3D2E]">{value}</p></div>;
}

function TenancyForm({ tenancy, unit, lettingAgents, isAdmin, onCancel, onSaved, onNotice }: {
  tenancy?: UnitTenancy | null;
  unit: Unit;
  lettingAgents: Organisation[];
  isAdmin: boolean;
  onCancel: () => void;
  onSaved: () => Promise<void>;
  onNotice: (message: string) => void;
}) {
  const [draft, setDraft] = useState(() => draftFromTenancy(tenancy));
  const [saving, setSaving] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [deleteReason, setDeleteReason] = useState("");
  const set = (field: keyof TenancyDraft, value: string) => setDraft((current) => ({ ...current, [field]: value }));

  async function save() {
    setSaving(true);
    try {
      const response = await fetch("/api/rentals/tenancies", {
        method: tenancy ? "PATCH" : "POST",
        headers: await authHeaders(),
        body: JSON.stringify({
          tenancyId: tenancy?.id, buildingId: unit.building_id, unitId: unit.id,
          tenantName: draft.tenantName, tenancyStartDate: draft.tenancyStartDate,
          fixedTermEndDate: draft.fixedTermEndDate || null, tenancyEndDate: draft.tenancyEndDate || null,
          monthlyRent: draft.monthlyRent, rentDueDay: draft.rentDueDay || null,
          depositAmount: draft.depositAmount || null, lettingAgentOrganisationId: draft.lettingAgentOrganisationId || null,
          notes: draft.notes, sourceType: draft.sourceType, sourceReference: draft.sourceReference,
        }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Tenancy could not be saved.");
      onNotice(tenancy ? "Tenancy updated." : "Tenancy added.");
      await onSaved();
      onCancel();
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Tenancy could not be saved.");
    } finally { setSaving(false); }
  }

  async function remove() {
    setSaving(true);
    try {
      const response = await fetch("/api/rentals/tenancies", { method: "DELETE", headers: await authHeaders(), body: JSON.stringify({ tenancyId: tenancy?.id, reason: deleteReason }) });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Tenancy could not be deleted.");
      onNotice("Erroneous tenancy deleted and recorded in the audit log.");
      await onSaved();
      onCancel();
    } catch (error) { onNotice(error instanceof Error ? error.message : "Tenancy could not be deleted."); }
    finally { setSaving(false); }
  }

  return (
    <div className="rounded-lg border border-[#d9ded6] bg-white p-4 sm:p-5">
      <h4 className="font-bold text-[#0F3D2E]">{tenancy ? "Edit tenancy" : "Add tenancy"}</h4>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <label className="field-label md:col-span-2">Tenant name(s)<input className="field" value={draft.tenantName} onChange={(event) => set("tenantName", event.target.value)} /></label>
        <label className="field-label">Tenancy start<input className="field" type="date" value={draft.tenancyStartDate} onChange={(event) => set("tenancyStartDate", event.target.value)} /></label>
        <label className="field-label">Fixed-term end<input className="field" type="date" value={draft.fixedTermEndDate} onChange={(event) => set("fixedTermEndDate", event.target.value)} /></label>
        <label className="field-label">Actual tenancy end<input className="field" type="date" value={draft.tenancyEndDate} onChange={(event) => set("tenancyEndDate", event.target.value)} /></label>
        <label className="field-label">Monthly rent (£)<input className="field" inputMode="decimal" value={draft.monthlyRent} onChange={(event) => set("monthlyRent", event.target.value)} /></label>
        <label className="field-label">Rent due day<input className="field" type="number" min="1" max="31" value={draft.rentDueDay} onChange={(event) => set("rentDueDay", event.target.value)} /></label>
        <label className="field-label">Deposit (£)<input className="field" inputMode="decimal" value={draft.depositAmount} onChange={(event) => set("depositAmount", event.target.value)} /></label>
        <label className="field-label">Letting agent<select className="field" value={draft.lettingAgentOrganisationId} onChange={(event) => set("lettingAgentOrganisationId", event.target.value)}><option value="">Not recorded</option>{lettingAgents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select></label>
        <label className="field-label">Source<select className="field" value={draft.sourceType} onChange={(event) => set("sourceType", event.target.value)}><option value="manual">Manual</option><option value="spreadsheet_import">Spreadsheet import</option><option value="document">Document</option><option value="email">Email</option></select></label>
        <label className="field-label md:col-span-2">Source/reference<input className="field" value={draft.sourceReference} onChange={(event) => set("sourceReference", event.target.value)} /></label>
        <label className="field-label md:col-span-2">Notes<textarea className="field min-h-24" value={draft.notes} onChange={(event) => set("notes", event.target.value)} /></label>
      </div>
      <div className="mt-4 flex flex-wrap justify-between gap-2">
        <div>{tenancy && isAdmin && <button className="text-xs font-semibold text-[#7a271a] underline underline-offset-4" type="button" onClick={() => setShowDelete((value) => !value)}>Delete erroneous record</button>}</div>
        <div className="flex gap-2"><button className="secondary" type="button" onClick={onCancel} disabled={saving}>Cancel</button><button className="primary" type="button" onClick={() => void save()} disabled={saving}>{saving ? "Saving…" : "Save tenancy"}</button></div>
      </div>
      {showDelete && tenancy && isAdmin && <div className="mt-4 rounded-md border border-[#e5c4be] bg-[#fff9f7] p-3"><label className="field-label">Deletion reason<textarea className="field min-h-20" value={deleteReason} onChange={(event) => setDeleteReason(event.target.value)} /></label><div className="mt-3 flex justify-end"><button className="danger-button" type="button" disabled={saving || !deleteReason.trim()} onClick={() => void remove()}>Confirm deletion</button></div></div>}
    </div>
  );
}

export function RentalsWorkspace({ role, buildings, buildingFloors, units, organisations, onNotice, onOpenSaleFile }: {
  role: string;
  buildings: Building[];
  buildingFloors: BuildingFloor[];
  units: Unit[];
  organisations: Organisation[];
  onNotice: (message: string) => void;
  onOpenSaleFile: (unit: Unit) => void;
}) {
  const [tenancies, setTenancies] = useState<UnitTenancy[]>([]);
  const [saleAttemptUnitIds, setSaleAttemptUnitIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [buildingId, setBuildingId] = useState(() => typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("rentalsBuildingId") ?? "");
  const [selectedUnitId, setSelectedUnitId] = useState(() => typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("rentalUnitId") ?? "");
  const [search, setSearch] = useState("");
  const [occupancyFilter, setOccupancyFilter] = useState<"all" | "occupied" | "void">("all");
  const [salesFilter, setSalesFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [tab, setTab] = useState<"current" | "history">("current");
  const [editingTenancyId, setEditingTenancyId] = useState<string | "new" | "">("");

  async function loadTenancies() {
    setLoading(true);
    try {
      const response = await fetch("/api/rentals/tenancies", { headers: await authHeaders() });
      const payload = await response.json() as { tenancies?: UnitTenancy[]; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Tenancies could not be loaded.");
      setTenancies(payload.tenancies ?? []);
      const rentalUnitIds = units.filter((unit) => unit.rental_portfolio_status === "active").map((unit) => unit.id);
      if (rentalUnitIds.length > 0) {
        const { data } = await createSupabaseBrowserClient().from("unit_sale_attempts").select("unit_id").in("unit_id", rentalUnitIds);
        setSaleAttemptUnitIds(new Set((data ?? []).map((row) => row.unit_id as string)));
      }
    } catch (error) { onNotice(error instanceof Error ? error.message : "Tenancies could not be loaded."); }
    finally { setLoading(false); }
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/rentals/tenancies", { headers: await authHeaders() });
        const payload = await response.json() as { tenancies?: UnitTenancy[]; error?: string };
        if (!response.ok) throw new Error(payload.error ?? "Tenancies could not be loaded.");
        if (!cancelled) setTenancies(payload.tenancies ?? []);
        const rentalUnitIds = units.filter((unit) => unit.rental_portfolio_status === "active").map((unit) => unit.id);
        if (rentalUnitIds.length > 0) {
          const { data } = await createSupabaseBrowserClient().from("unit_sale_attempts").select("unit_id").in("unit_id", rentalUnitIds);
          if (!cancelled) setSaleAttemptUnitIds(new Set((data ?? []).map((row) => row.unit_id as string)));
        }
      } catch (error) {
        if (!cancelled) onNotice(error instanceof Error ? error.message : "Tenancies could not be loaded.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [onNotice, units]);

  const rentalUnits = useMemo(() => sortUnitsByBuildingFloorOrder(units.filter((unit) => unit.rental_portfolio_status === "active"), buildingFloors, buildings), [buildingFloors, buildings, units]);
  const scopedUnits = useMemo(() => buildingId ? rentalUnits.filter((unit) => unit.building_id === buildingId) : rentalUnits, [buildingId, rentalUnits]);
  const scopedTenancies = useMemo(() => tenancies.filter((tenancy) => scopedUnits.some((unit) => unit.id === tenancy.unit_id)), [scopedUnits, tenancies]);
  const summary = useMemo(() => summariseRentals(scopedUnits, scopedTenancies), [scopedTenancies, scopedUnits]);
  const filteredUnits = useMemo(() => scopedUnits.filter((unit) => {
    const unitTenancies = tenancies.filter((tenancy) => tenancy.unit_id === unit.id);
    const occupancy = rentalOccupancy(unit, unitTenancies);
    return (!search.trim() || unit.unit_number.toLowerCase().includes(search.trim().toLowerCase()))
      && (occupancyFilter === "all" || occupancy === occupancyFilter)
      && (salesFilter === "all" || unit.sale_status === salesFilter);
  }), [occupancyFilter, salesFilter, scopedUnits, search, tenancies]);
  const pageCount = Math.max(1, Math.ceil(filteredUnits.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pagedUnits = filteredUnits.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const selectedUnit = units.find((unit) => unit.id === selectedUnitId) ?? null;
  const selectedBuilding = selectedUnit ? buildings.find((building) => building.id === selectedUnit.building_id) : null;
  const selectedTenancies = selectedUnit ? tenancies.filter((tenancy) => tenancy.unit_id === selectedUnit.id) : [];
  const current = activeTenancy(selectedTenancies);
  const next = nextTenancy(selectedTenancies);
  const history = tenancyHistoryMetrics(selectedTenancies).reverse();
  const lettingAgents = organisations.filter((organisation) => organisation.type === "letting_agent");

  function writeUrl(nextBuildingId: string, unitId?: string | null) {
    const params = new URLSearchParams(window.location.search);
    params.set("screen", "rentals");
    if (nextBuildingId) params.set("rentalsBuildingId", nextBuildingId);
    else params.delete("rentalsBuildingId");
    if (unitId) params.set("rentalUnitId", unitId);
    else params.delete("rentalUnitId");
    window.history.pushState(null, "", `${window.location.pathname}?${params.toString()}`);
  }

  if (selectedUnit && (selectedUnit.rental_portfolio_status === "active" || selectedUnit.rental_portfolio_status === "exited")) {
    const occupied = Boolean(current);
    const editing = editingTenancyId === "new" ? null : selectedTenancies.find((tenancy) => tenancy.id === editingTenancyId) ?? null;
    const latestEndedTenancy = orderedTenancies(selectedTenancies).filter((tenancy) => tenancyState(tenancy) === "ended").at(-1) ?? null;
    return <div className="grid gap-5">
      <section className="panel">
        <button className="secondary" type="button" onClick={() => { setSelectedUnitId(""); setEditingTenancyId(""); writeUrl(buildingId, null); }}>&lt; Back to Rentals</button>
        <div className="mt-5 flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#D6A23A]">Rental file</p><h2 className="mt-1 text-2xl font-bold text-[#0F3D2E]">Unit {selectedUnit.unit_number}</h2><p className="text-sm text-[#617169]">{selectedBuilding?.name} / {selectedUnit.floor ?? "No floor"}</p></div><div className="flex flex-wrap gap-2"><span className="rounded-full border border-[#bfd8df] bg-[#eef8fa] px-3 py-1 text-xs font-bold text-[#315f6a]">{selectedUnit.rental_portfolio_status === "active" ? "Rental portfolio" : "Exited rental portfolio"}</span>{selectedUnit.rental_portfolio_status === "active" && <span className={`rounded-full border px-3 py-1 text-xs font-bold ${occupancyBadge(occupied)}`}>{occupied ? "Occupied" : "Void"}</span>}</div></div>
        <div className="mt-5 grid gap-3 sm:grid-cols-3"><SummaryCard label="Sales position" value={saleStatusLabel(selectedUnit.sale_status)} /><SummaryCard label="Occupancy" value={selectedUnit.rental_portfolio_status === "exited" ? "Exited" : occupied ? "Occupied" : "Void"} /><SummaryCard label="Current monthly rent" value={current ? formatGbp(current.monthly_rent) : "—"} /></div>
        {saleAttemptUnitIds.has(selectedUnit.id) && <button className="mt-4 text-sm font-semibold text-[#0F3D2E] underline underline-offset-4" type="button" onClick={() => onOpenSaleFile(selectedUnit)}>Open sale file</button>}
        <div className="mt-5 flex border-b border-[#d9ded6]" role="tablist"><button className={`px-4 py-3 text-sm font-bold ${tab === "current" ? "border-b-2 border-[#0F3D2E] text-[#0F3D2E]" : "text-[#617169]"}`} onClick={() => { setTab("current"); setEditingTenancyId(""); }}>Current tenancy</button><button className={`px-4 py-3 text-sm font-bold ${tab === "history" ? "border-b-2 border-[#0F3D2E] text-[#0F3D2E]" : "text-[#617169]"}`} onClick={() => { setTab("history"); setEditingTenancyId(""); }}>History</button></div>
      </section>

      {editingTenancyId && <TenancyForm tenancy={editing} unit={selectedUnit} lettingAgents={lettingAgents} isAdmin={role === "admin"} onCancel={() => setEditingTenancyId("")} onSaved={loadTenancies} onNotice={onNotice} />}

      {!editingTenancyId && tab === "current" && <section className="panel">
        {current ? <><div className="flex justify-between gap-3"><div><h3 className="text-xl font-bold text-[#0F3D2E]">Current tenancy</h3><p className="mt-1 text-sm text-[#617169]">Active from {formatDate(current.tenancy_start_date)}</p></div><button className="secondary" onClick={() => setEditingTenancyId(current.id)}>Edit</button></div><dl className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{[
          ["Tenant", current.tenant_name], ["Tenancy start", formatDate(current.tenancy_start_date)], ["Fixed-term end", formatDate(current.fixed_term_end_date)], ["Monthly rent", formatGbp(current.monthly_rent)], ["Rent due day", current.rent_due_day ? `Day ${current.rent_due_day}` : "—"], ["Deposit", current.deposit_amount === null ? "—" : formatGbp(current.deposit_amount)], ["Letting agent", organisations.find((item) => item.id === current.letting_agent_organisation_id)?.name ?? "—"], ["Source/reference", [current.source_type.replace(/_/g, " "), current.source_reference].filter(Boolean).join(" · ")], ["Notes", current.notes ?? "—"],
        ].map(([label, value]) => <div key={label} className="rounded-md border border-[#eef0eb] bg-[#fbfcfa] p-3"><dt className="text-xs font-bold uppercase text-[#617169]">{label}</dt><dd className="mt-1 font-semibold text-[#34413a]">{value}</dd></div>)}</dl></> : selectedUnit.rental_portfolio_status === "exited" ? <div className="rounded-lg border border-[#d9ded6] bg-[#fbfcfa] p-6"><h3 className="text-xl font-bold text-[#0F3D2E]">Exited rental portfolio</h3><p className="mt-2 text-sm text-[#617169]">Current occupancy is not tracked for exited units. Historical tenancy records remain available and editable.</p><button className="secondary mt-4" onClick={() => setTab("history")}>View tenancy history</button></div> : <div className="rounded-lg border border-[#ead8a7] bg-[#fffaf0] p-6"><h3 className="text-xl font-bold text-[#765a18]">Void</h3><p className="mt-2 text-sm text-[#617169]">{selectedTenancies.length === 0 ? "No tenancy has been recorded for this rental unit." : latestEndedTenancy ? `No active tenancy. ${currentVoidDays(latestEndedTenancy.tenancy_end_date) ?? 0} current void days.` : "No active tenancy has started yet."}</p><button className="primary mt-4" onClick={() => setEditingTenancyId("new")}>Add tenancy</button></div>}
        {next && <div className="mt-5 rounded-lg border border-[#bfd8df] bg-[#f4fbfc] p-4"><div className="flex justify-between gap-3"><div><p className="text-xs font-bold uppercase text-[#315f6a]">Next tenancy</p><h4 className="mt-1 font-bold text-[#0F3D2E]">{next.tenant_name}</h4><p className="mt-1 text-sm text-[#617169]">Starts {formatDate(next.tenancy_start_date)} · {formatGbp(next.monthly_rent)} per month</p></div><button className="secondary" onClick={() => setEditingTenancyId(next.id)}>Edit</button></div></div>}
      </section>}

      {!editingTenancyId && tab === "history" && <section className="panel"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-xl font-bold text-[#0F3D2E]">Tenancy history</h3><p className="mt-1 text-sm text-[#617169]">{selectedTenancies.length} recorded {selectedTenancies.length === 1 ? "tenancy" : "tenancies"} · {totalHistoricalVoidDays(selectedTenancies)} historical void days</p></div><button className="primary" onClick={() => setEditingTenancyId("new")}>Add tenancy</button></div><div className="mt-5 overflow-x-auto rounded-lg border border-[#d9ded6]"><table className="min-w-[64rem] w-full text-left text-sm"><thead className="bg-[#fbfcfa] text-xs uppercase text-[#617169]"><tr>{["Tenant", "Start", "Fixed-term end", "Actual end", "Monthly rent", "Rent change", "Void before", "Letting agent", ""].map((heading) => <th key={heading} className="border-b border-[#d9ded6] px-3 py-3">{heading}</th>)}</tr></thead><tbody>{history.length === 0 ? <tr><td colSpan={9} className="px-4 py-8 text-center text-[#617169]">No tenancy history recorded.</td></tr> : history.map(({ tenancy, rentChange, voidDaysBefore }) => <tr key={tenancy.id} className="bg-white"><td className="border-b border-[#eef0eb] px-3 py-3 font-semibold">{tenancy.tenant_name}<span className="mt-1 block text-xs font-normal capitalize text-[#617169]">{tenancyState(tenancy)}</span></td><td className="border-b border-[#eef0eb] px-3 py-3">{formatDate(tenancy.tenancy_start_date)}</td><td className="border-b border-[#eef0eb] px-3 py-3">{formatDate(tenancy.fixed_term_end_date)}</td><td className="border-b border-[#eef0eb] px-3 py-3">{formatDate(tenancy.tenancy_end_date)}</td><td className="numeric-value border-b border-[#eef0eb] px-3 py-3">{formatGbp(tenancy.monthly_rent)}</td><td className={`numeric-value border-b border-[#eef0eb] px-3 py-3 ${rentChange && rentChange.amount < 0 ? "text-[#8d382d]" : rentChange && rentChange.amount > 0 ? "text-[#286348]" : "text-[#617169]"}`}>{rentChange ? `${rentChange.amount >= 0 ? "+" : ""}${formatGbp(rentChange.amount)}${rentChange.percentage === null ? "" : ` (${rentChange.percentage >= 0 ? "+" : ""}${(rentChange.percentage * 100).toFixed(1)}%)`}` : "—"}</td><td className="numeric-value border-b border-[#eef0eb] px-3 py-3">{voidDaysBefore === null ? "—" : `${voidDaysBefore} days`}</td><td className="border-b border-[#eef0eb] px-3 py-3">{organisations.find((item) => item.id === tenancy.letting_agent_organisation_id)?.name ?? "—"}</td><td className="border-b border-[#eef0eb] px-3 py-3"><button className="text-sm font-semibold text-[#0F3D2E] underline" onClick={() => setEditingTenancyId(tenancy.id)}>Edit</button></td></tr>)}</tbody></table></div></section>}
    </div>;
  }

  return <div className="grid gap-5">
    <section className="panel"><div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between"><div><h2 className="text-2xl font-bold text-[#0F3D2E]">Rentals</h2><p className="mt-1 text-sm text-[#617169]">{buildingId ? buildings.find((building) => building.id === buildingId)?.name : "All buildings"} · active rental portfolio</p></div><label className="field-label lg:w-[320px]">Building<select className="field" value={buildingId} onChange={(event) => { setBuildingId(event.target.value); setPage(1); writeUrl(event.target.value, null); }}><option value="">All buildings</option>{buildings.map((building) => <option key={building.id} value={building.id}>{building.name}</option>)}</select></label></div></section>
    <section className="panel"><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><SummaryCard label="Rental portfolio" value={String(summary.rentalPortfolio)} /><SummaryCard label="Occupied" value={String(summary.occupied)} /><SummaryCard label="Void" value={String(summary.void)} /><SummaryCard label="Monthly rent roll" value={formatGbp(summary.monthlyRentRoll)} /><SummaryCard label="Annualised rent roll" value={formatGbp(summary.annualisedRentRoll)} /><SummaryCard label="Sale and rental" value={String(summary.saleAndRental)} /><SummaryCard label="Tenancies ending within 90 days" value={String(summary.endingWithin90Days)} /></div></section>
    <section className="panel"><div className="grid gap-3 md:grid-cols-3"><label className="field-label">Unit search<input className="field" placeholder="Unit number" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} /></label><label className="field-label">Occupancy<select className="field" value={occupancyFilter} onChange={(event) => { setOccupancyFilter(event.target.value as typeof occupancyFilter); setPage(1); }}><option value="all">All</option><option value="occupied">Occupied</option><option value="void">Void</option></select></label><label className="field-label">Sales position<select className="field" value={salesFilter} onChange={(event) => { setSalesFilter(event.target.value); setPage(1); }}><option value="all">All</option>{["not_released", "not_for_sale", "for_sale", "reserved", "exchanged", "completed", "handed_over"].map((status) => <option key={status} value={status}>{saleStatusLabel(status as Unit["sale_status"])}</option>)}</select></label></div>
      {loading ? <p className="mt-5 text-sm text-[#617169]" role="status">Loading rental portfolio…</p> : <><div className="mt-5 overflow-x-auto rounded-lg border border-[#d9ded6]"><table className="min-w-[70rem] w-full text-left text-sm"><thead className="bg-[#fbfcfa] text-xs uppercase text-[#617169]"><tr>{["Unit", "Building", "Sales position", "Occupancy", "Current tenant", "Current rent", "Tenancy start", "Fixed-term end", "Void / tenancy info"].map((heading) => <th key={heading} className="border-b border-[#d9ded6] px-3 py-3">{heading}</th>)}</tr></thead><tbody>{pagedUnits.length === 0 ? <tr><td colSpan={9} className="px-4 py-8 text-center text-[#617169]">No rental units match the selected filters.</td></tr> : pagedUnits.map((unit) => { const unitTenancies = tenancies.filter((tenancy) => tenancy.unit_id === unit.id); const active = activeTenancy(unitTenancies); const latestEnded = orderedTenancies(unitTenancies).filter((tenancy) => tenancyState(tenancy) === "ended").at(-1); const metrics = tenancyHistoryMetrics(unitTenancies); const currentMetric = active ? metrics.find((item) => item.tenancy.id === active.id) : null; const info = active && currentMetric?.rentChange ? `Previous rent ${formatGbp(active.monthly_rent - currentMetric.rentChange.amount)} (${currentMetric.rentChange.percentage === null ? "—" : `${(currentMetric.rentChange.percentage * 100).toFixed(1)}%`})` : unitTenancies.length === 0 ? "No tenancy recorded" : latestEnded ? `${currentVoidDays(latestEnded.tenancy_end_date) ?? 0} days` : "Tenancy scheduled"; return <tr key={unit.id} className="cursor-pointer bg-white hover:bg-[#fbfcfa]" tabIndex={0} onClick={() => { setSelectedUnitId(unit.id); writeUrl(buildingId, unit.id); }} onKeyDown={(event) => { if (event.key === "Enter") { setSelectedUnitId(unit.id); writeUrl(buildingId, unit.id); } }}><td className="border-b border-[#eef0eb] px-3 py-3 font-bold text-[#0F3D2E]">{unit.unit_number} <ChevronRight className="inline" size={14} /></td><td className="border-b border-[#eef0eb] px-3 py-3">{buildings.find((building) => building.id === unit.building_id)?.name}</td><td className="border-b border-[#eef0eb] px-3 py-3">{saleStatusLabel(unit.sale_status)}</td><td className="border-b border-[#eef0eb] px-3 py-3"><span className={`rounded-full border px-2.5 py-1 text-xs font-bold ${occupancyBadge(Boolean(active))}`}>{active ? "Occupied" : "Void"}</span></td><td className="border-b border-[#eef0eb] px-3 py-3">{active?.tenant_name ?? "—"}</td><td className="numeric-value border-b border-[#eef0eb] px-3 py-3">{active ? formatGbp(active.monthly_rent) : "—"}</td><td className="border-b border-[#eef0eb] px-3 py-3">{formatDate(active?.tenancy_start_date)}</td><td className="border-b border-[#eef0eb] px-3 py-3">{formatDate(active?.fixed_term_end_date)}</td><td className="border-b border-[#eef0eb] px-3 py-3 text-[#617169]">{info}</td></tr>; })}</tbody></table></div><div className="mt-4 flex items-center justify-between gap-3 text-sm text-[#617169]"><span>Showing {filteredUnits.length === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1}-{Math.min(currentPage * PAGE_SIZE, filteredUnits.length)} of {filteredUnits.length}</span><div className="flex gap-2"><button className="secondary" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>Previous</button><button className="secondary" disabled={currentPage >= pageCount} onClick={() => setPage(currentPage + 1)}>Next</button></div></div></>}
    </section>
  </div>;
}
