"use client";

import { AlertCircle, CalendarClock, ChevronLeft, ChevronRight, Home, TrendingDown } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { PortfolioRentRiskSection, RentPerformancePanel, RentRiskAttentionBadge } from "@/components/portal/rentals/RentRiskPanels";
import type { Building, BuildingFloor, Organisation, Unit } from "@/lib/data/production";
import {
  calculateRentalPerformance,
  calculateUnitRentalPerformance,
  isRealTenantName,
  rentalReportingPeriodLabel,
  type RentalReportingPeriod,
  type RentalUnitPerformance,
} from "@/lib/rentals/performance";
import { adjacentRentalUnits, tenancyHistoryMetrics, tenancyState, todayDate, type TenancySourceType, type UnitTenancy } from "@/lib/rentals/tenancies";
import {
  deriveUnitRentRisk,
  tenancyHistoryStatusLabel,
  type RentalArrearsEpisode,
  type RentalArrearsEvent,
  type RentalImportHealth,
} from "@/lib/rentals/rent-risk";
import { formatGbp } from "@/lib/sales/currency";
import { saleStatusLabel, sortUnitsByBuildingFloorOrder } from "@/lib/units/commercial-allocation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

const PAGE_SIZE = 12;
type AttentionFilter = "all" | "current_voids" | "rent_below_first" | "ending_within_90" | "current_arrears" | "repeat_arrears" | "reconciliation_required";

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

function formatLongDate(value?: string | null) {
  if (!value) return "Not recorded";
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${value.slice(0, 10)}T00:00:00Z`));
}

function formatPercentage(value?: number | null, signed = false) {
  if (value === null || value === undefined) return "—";
  const percentage = value * 100;
  return `${signed && percentage > 0 ? "+" : ""}${percentage.toFixed(1)}%`;
}

function signedGbp(value?: number | null) {
  if (value === null || value === undefined) return "—";
  return `${value > 0 ? "+" : ""}${formatGbp(value)}`;
}

function rentMovementText(movement?: { amount: number; percentage: number | null } | null) {
  return movement ? `${signedGbp(movement.amount)}${movement.percentage === null ? "" : ` (${formatPercentage(movement.percentage, true)})`}` : "—";
}

function ordinal(day?: number | null) {
  if (!day) return "Not recorded";
  const suffix = day % 10 === 1 && day % 100 !== 11 ? "st" : day % 10 === 2 && day % 100 !== 12 ? "nd" : day % 10 === 3 && day % 100 !== 13 ? "rd" : "th";
  return `${day}${suffix}`;
}

function occupancyBadge(occupied: boolean) {
  return occupied ? "border-[#bedacb] bg-[#edf8f1] text-[#286348]" : "border-[#ead8a7] bg-[#fff8e8] text-[#765a18]";
}

function movementColour(amount?: number | null) {
  if (amount === null || amount === undefined || amount === 0) return "text-[#617169]";
  return amount > 0 ? "text-[#286348]" : "text-[#8d382d]";
}

async function authHeaders() {
  const { data } = await createSupabaseBrowserClient().auth.getSession();
  return { "Content-Type": "application/json", Authorization: `Bearer ${data.session?.access_token ?? ""}` };
}

function SectionHeading({ eyebrow, title, description, action }: { eyebrow: string; title: string; description?: string; action?: React.ReactNode }) {
  return <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-[0.14em] text-[#8A6A22]">{eyebrow}</p><h3 className="mt-1 text-xl font-bold text-[#0F3D2E]">{title}</h3>{description && <p className="mt-1 text-sm text-[#617169]">{description}</p>}</div>{action}</div>;
}

function PerformanceMetric({ label, value, detail, tone = "normal" }: { label: string; value: string; detail?: string; tone?: "normal" | "negative" }) {
  return <div className="min-w-0 px-3 py-3 sm:px-4"><p className="text-xs font-bold uppercase tracking-[0.06em] text-[#617169]">{label}</p><p className={`numeric-value mt-1 text-xl font-bold ${tone === "negative" ? "text-[#8d382d]" : "text-[#0F3D2E]"}`}>{value}</p>{detail && <p className="mt-1 text-xs leading-relaxed text-[#6b7770]">{detail}</p>}</div>;
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
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Tenancy could not be deleted.");
    } finally { setSaving(false); }
  }

  return <div className="rounded-lg border border-[#d9ded6] bg-white p-4 sm:p-5">
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
      <label className="field-label">Source<select className="field" value={draft.sourceType} onChange={(event) => set("sourceType", event.target.value as TenancySourceType)}><option value="manual">Manual</option><option value="spreadsheet_import">Spreadsheet import</option><option value="document">Document</option><option value="email">Email</option></select></label>
      <label className="field-label md:col-span-2">Source/reference<input className="field" value={draft.sourceReference} onChange={(event) => set("sourceReference", event.target.value)} /></label>
      <label className="field-label md:col-span-2">Notes<textarea className="field min-h-24" value={draft.notes} onChange={(event) => set("notes", event.target.value)} /></label>
    </div>
    <div className="mt-4 flex flex-wrap justify-between gap-2"><div>{tenancy && isAdmin && <button className="text-xs font-semibold text-[#7a271a] underline underline-offset-4" type="button" onClick={() => setShowDelete((value) => !value)}>Delete erroneous record</button>}</div><div className="flex gap-2"><button className="secondary" type="button" onClick={onCancel} disabled={saving}>Cancel</button><button className="primary" type="button" onClick={() => void save()} disabled={saving}>{saving ? "Saving…" : "Save tenancy"}</button></div></div>
    {showDelete && tenancy && isAdmin && <div className="mt-4 rounded-md border border-[#e5c4be] bg-[#fff9f7] p-3"><label className="field-label">Deletion reason<textarea className="field min-h-20" value={deleteReason} onChange={(event) => setDeleteReason(event.target.value)} /></label><div className="mt-3 flex justify-end"><button className="danger-button" type="button" disabled={saving || !deleteReason.trim()} onClick={() => void remove()}>Confirm deletion</button></div></div>}
  </div>;
}

function RentalFile({
  role, unit, building, tenancies, organisations, arrearsEpisodes, arrearsEvents, saleAttemptUnitIds, tab, editingTenancyId,
  previousUnit, nextUnit, setTab, setEditingTenancyId, onBack, onOpenUnit, onOpenSaleFile, onSaved, onNotice,
}: {
  role: string;
  unit: Unit;
  building: Building | null;
  tenancies: UnitTenancy[];
  organisations: Organisation[];
  arrearsEpisodes: RentalArrearsEpisode[];
  arrearsEvents: RentalArrearsEvent[];
  saleAttemptUnitIds: Set<string>;
  tab: "current" | "history";
  editingTenancyId: string | "new" | "";
  previousUnit: Unit | null;
  nextUnit: Unit | null;
  setTab: (tab: "current" | "history") => void;
  setEditingTenancyId: (id: string | "new" | "") => void;
  onBack: () => void;
  onOpenUnit: (unit: Unit) => void;
  onOpenSaleFile: (unit: Unit) => void;
  onSaved: () => Promise<void>;
  onNotice: (message: string) => void;
}) {
  const metrics = calculateUnitRentalPerformance(unit, tenancies, todayDate(), "lifetime");
  const current = metrics.currentTenancy as UnitTenancy | null;
  const next = metrics.nextTenancy as UnitTenancy | null;
  const history = tenancyHistoryMetrics(tenancies).reverse();
  const arrearsTenancyIds = new Set(arrearsEpisodes.map((episode) => episode.tenancy_id));
  const occupied = Boolean(current);
  const editing = editingTenancyId === "new" ? null : tenancies.find((tenancy) => tenancy.id === editingTenancyId) ?? null;
  const lettingAgents = organisations.filter((organisation) => organisation.type === "letting_agent");
  const lettingAgent = current ? organisations.find((item) => item.id === current.letting_agent_organisation_id) : null;
  const isAlsoForSale = saleAttemptUnitIds.has(unit.id) || ["for_sale", "reserved", "exchanged", "completed", "handed_over"].includes(unit.sale_status);

  return <div className="grid min-w-0 gap-5">
    <section className="panel">
      <div className="flex items-center justify-between gap-3">
        <button className="secondary" type="button" onClick={onBack}>&lt; Back to Rentals</button>
        <div className="flex items-center gap-2" aria-label="Rental unit navigation">
          {previousUnit && <button className="secondary icon-button" type="button" aria-label={`Previous rental unit ${previousUnit.unit_number}`} title={`Unit ${previousUnit.unit_number}`} onClick={() => onOpenUnit(previousUnit)}><ChevronLeft size={18} aria-hidden="true" /></button>}
          {nextUnit && <button className="secondary icon-button" type="button" aria-label={`Next rental unit ${nextUnit.unit_number}`} title={`Unit ${nextUnit.unit_number}`} onClick={() => onOpenUnit(nextUnit)}><ChevronRight size={18} aria-hidden="true" /></button>}
        </div>
      </div>
      <div className="mt-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#D6A23A]">Rental file</p>
          <h2 className="mt-1 text-2xl font-bold text-[#0F3D2E]">Unit {unit.unit_number}</h2>
          <p className="text-sm text-[#617169]">{building?.name} / {unit.floor ?? "No floor"}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <span className="rounded-full border border-[#bfd8df] bg-[#eef8fa] px-3 py-1 text-xs font-bold text-[#315f6a]">{unit.rental_portfolio_status === "active" ? "Rental portfolio" : "Exited rental portfolio"}</span>
            {unit.rental_portfolio_status === "active" && <span className={`rounded-full border px-3 py-1 text-xs font-bold ${occupancyBadge(occupied)}`}>{occupied ? "Occupied" : "Void"}</span>}
            {isAlsoForSale && <span className="rounded-full border border-[#e3c77b] bg-[#fff8e8] px-3 py-1 text-xs font-bold text-[#765a18]">{unit.sale_status === "for_sale" ? "Also for sale" : saleStatusLabel(unit.sale_status)}</span>}
          </div>
        </div>
        <div className="min-w-[12rem] text-left sm:text-right">
          <p className="numeric-value text-2xl font-bold text-[#0F3D2E]">{current ? `${formatGbp(current.monthly_rent)} pcm` : "No current rent"}</p>
          <p className="mt-1 text-sm text-[#617169]">{saleStatusLabel(unit.sale_status)}</p>
          {isAlsoForSale && <button className="mt-2 text-sm font-semibold text-[#0F3D2E] underline underline-offset-4" type="button" onClick={() => onOpenSaleFile(unit)}>Open sale file</button>}
        </div>
      </div>
      <div className="mt-5 flex border-b border-[#d9ded6]" role="tablist">
        <button role="tab" aria-selected={tab === "current"} className={`px-4 py-3 text-sm font-bold ${tab === "current" ? "border-b-2 border-[#0F3D2E] text-[#0F3D2E]" : "text-[#617169]"}`} onClick={() => { setTab("current"); setEditingTenancyId(""); }}>Current tenancy</button>
        <button role="tab" aria-selected={tab === "history"} className={`px-4 py-3 text-sm font-bold ${tab === "history" ? "border-b-2 border-[#0F3D2E] text-[#0F3D2E]" : "text-[#617169]"}`} onClick={() => { setTab("history"); setEditingTenancyId(""); }}>History</button>
      </div>
    </section>

    {editingTenancyId && <TenancyForm tenancy={editing} unit={unit} lettingAgents={lettingAgents} isAdmin={role === "admin"} onCancel={() => setEditingTenancyId("")} onSaved={onSaved} onNotice={onNotice} />}

    {!editingTenancyId && tab === "current" && <section className="panel">
      {current ? <>
        <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-xl font-bold text-[#0F3D2E]">Current tenancy</h3><p className="mt-1 text-sm text-[#617169]">The unit remains occupied until an actual tenancy end is recorded.</p></div><button className="secondary" onClick={() => setEditingTenancyId(current.id)}>Edit</button></div>
        <dl className="mt-5 divide-y divide-[#e6e9e4] rounded-lg border border-[#dfe3dd] bg-[#fbfcfa] px-4">
          <div className="py-4"><dt className="text-xs font-bold uppercase tracking-[0.08em] text-[#617169]">Tenant</dt><dd className="mt-1 text-lg font-semibold text-[#26342d]">{current.tenant_name}</dd></div>
          <div className="grid gap-4 py-4 sm:grid-cols-2"><div><dt className="text-xs font-bold uppercase tracking-[0.08em] text-[#617169]">Tenancy</dt><dd className="mt-1 font-semibold text-[#34413a]">{formatLongDate(current.tenancy_start_date)} – ongoing</dd><dd className="mt-1 text-sm text-[#617169]">Fixed term: {formatLongDate(current.fixed_term_end_date)}</dd></div><div><dt className="text-xs font-bold uppercase tracking-[0.08em] text-[#617169]">Rent</dt><dd className="numeric-value mt-1 text-lg font-semibold text-[#34413a]">{formatGbp(current.monthly_rent)} pcm</dd><dd className="mt-1 text-sm text-[#617169]">Due: {ordinal(current.rent_due_day)}</dd></div></div>
          <div className="grid gap-4 py-4 sm:grid-cols-2"><div><dt className="text-xs font-bold uppercase tracking-[0.08em] text-[#617169]">Deposit</dt><dd className="numeric-value mt-1 font-semibold text-[#34413a]">{current.deposit_amount === null ? "Not recorded" : formatGbp(current.deposit_amount)}</dd></div><div><dt className="text-xs font-bold uppercase tracking-[0.08em] text-[#617169]">Letting agent</dt><dd className="mt-1 font-semibold text-[#34413a]">{lettingAgent?.name ?? "Not recorded"}</dd></div></div>
        </dl>
        {(current.source_reference || current.notes) && <div className="mt-4 grid gap-3 text-sm text-[#617169] sm:grid-cols-2">{current.source_reference && <div><p className="text-xs font-bold uppercase tracking-[0.06em]">Source / reference</p><p className="mt-1 break-words">{current.source_type.replace(/_/g, " ")} · {current.source_reference}</p></div>}{current.notes && <div><p className="text-xs font-bold uppercase tracking-[0.06em]">Notes</p><p className="mt-1 whitespace-pre-line">{current.notes}</p></div>}</div>}
      </> : unit.rental_portfolio_status === "exited" ? <div className="rounded-lg border border-[#d9ded6] bg-[#fbfcfa] p-6"><h3 className="text-xl font-bold text-[#0F3D2E]">Exited rental portfolio</h3><p className="mt-2 text-sm text-[#617169]">Current occupancy is not tracked for exited units. Historical tenancy records remain available and editable.</p><button className="secondary mt-4" onClick={() => setTab("history")}>View tenancy history</button></div> : <div className="rounded-lg border border-[#ead8a7] bg-[#fffaf0] p-6"><h3 className="text-xl font-bold text-[#765a18]">Void</h3><p className="mt-2 text-sm text-[#617169]">{metrics.currentVoid?.days !== null ? `No active tenancy. ${metrics.currentVoid?.days ?? 0} current void days since ${formatDate(metrics.currentVoid?.startDate)}.` : next ? `No active tenancy yet. The first recorded tenancy starts ${formatDate(next.tenancy_start_date)}.` : "No tenancy has been recorded for this rental unit."}</p><button className="primary mt-4" onClick={() => setEditingTenancyId("new")}>Add tenancy</button></div>}
      {next && <div className="mt-5 rounded-lg border border-[#bfd8df] bg-[#f4fbfc] p-4"><div className="flex justify-between gap-3"><div><p className="text-xs font-bold uppercase text-[#315f6a]">Next tenancy</p><h4 className={`mt-1 font-bold text-[#0F3D2E] ${isRealTenantName(next.tenant_name) ? "" : "opacity-60"}`}>{next.tenant_name}</h4><p className="mt-1 text-sm text-[#617169]">Starts {formatDate(next.tenancy_start_date)} · {formatGbp(next.monthly_rent)} per month</p></div><button className="secondary" onClick={() => setEditingTenancyId(next.id)}>Edit</button></div></div>}
    </section>}

    {!editingTenancyId && tab === "current" && <RentPerformancePanel
      currentTenancyId={current?.id ?? null}
      episodes={arrearsEpisodes}
      events={arrearsEvents}
      asOfDate={todayDate()}
    />}

    {!editingTenancyId && tab === "history" && <section className="panel min-w-0">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-xl font-bold text-[#0F3D2E]">Tenancy history</h3><p className="mt-1 text-sm text-[#617169]">Lifetime performance from the first recorded tenancy.</p></div><button className="primary" onClick={() => setEditingTenancyId("new")}>Add tenancy</button></div>
      <div className="mt-5 grid grid-cols-2 divide-x divide-y divide-[#e2e6e0] overflow-hidden rounded-lg border border-[#d9ded6] bg-[#fbfcfa] md:grid-cols-3 lg:grid-cols-6 lg:divide-y-0">
        <PerformanceMetric label="Recorded tenancies" value={String(metrics.tenancyCount)} />
        <PerformanceMetric label="Recorded void" value={`${metrics.voidDays} days`} />
        <PerformanceMetric label="Estimated void loss" value={metrics.estimatedVoidLoss === null ? "Unknown" : formatGbp(metrics.estimatedVoidLoss)} />
        <PerformanceMetric label="First achieved rent" value={metrics.firstAchievedRent === null ? "—" : formatGbp(metrics.firstAchievedRent)} />
        <PerformanceMetric label="Current rent" value={metrics.currentRent === null ? "—" : formatGbp(metrics.currentRent)} />
        <PerformanceMetric label="Rent movement" value={rentMovementText(metrics.currentVsFirstRent)} tone={(metrics.currentVsFirstRent?.amount ?? 0) < 0 ? "negative" : "normal"} />
      </div>
      {history.length === 0 ? <p className="mt-5 rounded-lg border border-[#d9ded6] bg-[#fbfcfa] px-4 py-8 text-center text-sm text-[#617169]">No tenancy history recorded.</p> : <>
        <div className="mt-5 grid gap-3 md:hidden">
          {history.map(({ tenancy, rentChange: latestChange, voidDaysBefore }) => {
            const state = tenancyState(tenancy);
            const hasArrears = state === "ended" && arrearsTenancyIds.has(tenancy.id);
            return <article key={tenancy.id} className="rounded-lg border border-[#d9ded6] bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h4 className={`font-semibold ${isRealTenantName(tenancy.tenant_name) ? "text-[#34413a]" : "text-[#89928d]"}`}>{tenancy.tenant_name}</h4>
                  <p className={`mt-1 text-xs ${hasArrears ? "text-[#8A6A22]" : "text-[#617169]"}`}>{tenancyHistoryStatusLabel(state, hasArrears)}</p>
                </div>
                <button className="text-sm font-semibold text-[#0F3D2E] underline" onClick={() => setEditingTenancyId(tenancy.id)}>Edit</button>
              </div>
              <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                <div><dt className="text-xs font-bold uppercase text-[#617169]">Tenancy</dt><dd className="mt-1 text-[#34413a]">{formatDate(tenancy.tenancy_start_date)} – {formatDate(tenancy.tenancy_end_date)}</dd></div>
                <div><dt className="text-xs font-bold uppercase text-[#617169]">Fixed-term end</dt><dd className="mt-1 text-[#34413a]">{formatDate(tenancy.fixed_term_end_date)}</dd></div>
                <div><dt className="text-xs font-bold uppercase text-[#617169]">Monthly rent</dt><dd className="numeric-value mt-1 text-[#34413a]">{formatGbp(tenancy.monthly_rent)}</dd></div>
                <div><dt className="text-xs font-bold uppercase text-[#617169]">Rent change</dt><dd className={`numeric-value mt-1 ${movementColour(latestChange?.amount)}`}>{rentMovementText(latestChange)}</dd></div>
                <div><dt className="text-xs font-bold uppercase text-[#617169]">Void before</dt><dd className="numeric-value mt-1 text-[#34413a]">{voidDaysBefore === null ? "—" : `${voidDaysBefore} days`}</dd></div>
                <div><dt className="text-xs font-bold uppercase text-[#617169]">Letting agent</dt><dd className="mt-1 text-[#34413a]">{organisations.find((item) => item.id === tenancy.letting_agent_organisation_id)?.name ?? "—"}</dd></div>
              </dl>
            </article>;
          })}
        </div>
        <div className="mt-5 hidden overflow-x-auto rounded-lg border border-[#d9ded6] md:block">
          <table className="min-w-[64rem] w-full text-left text-sm">
            <thead className="bg-[#fbfcfa] text-xs uppercase text-[#617169]"><tr>{["Tenant", "Start", "Fixed-term end", "Actual end", "Monthly rent", "Rent change", "Void before", "Letting agent", ""].map((heading) => <th key={heading} className="border-b border-[#d9ded6] px-3 py-3">{heading}</th>)}</tr></thead>
            <tbody>{history.map(({ tenancy, rentChange: latestChange, voidDaysBefore }) => {
              const state = tenancyState(tenancy);
              const hasArrears = state === "ended" && arrearsTenancyIds.has(tenancy.id);
              return <tr key={tenancy.id} className="bg-white">
                <td className={`border-b border-[#eef0eb] px-3 py-3 font-semibold ${isRealTenantName(tenancy.tenant_name) ? "" : "text-[#89928d]"}`}>{tenancy.tenant_name}<span className={`mt-1 block text-xs font-normal ${hasArrears ? "text-[#8A6A22]" : "text-[#617169]"}`}>{tenancyHistoryStatusLabel(state, hasArrears)}</span></td>
                <td className="border-b border-[#eef0eb] px-3 py-3">{formatDate(tenancy.tenancy_start_date)}</td>
                <td className="border-b border-[#eef0eb] px-3 py-3">{formatDate(tenancy.fixed_term_end_date)}</td>
                <td className="border-b border-[#eef0eb] px-3 py-3">{formatDate(tenancy.tenancy_end_date)}</td>
                <td className="numeric-value border-b border-[#eef0eb] px-3 py-3">{formatGbp(tenancy.monthly_rent)}</td>
                <td className={`numeric-value border-b border-[#eef0eb] px-3 py-3 ${movementColour(latestChange?.amount)}`}>{rentMovementText(latestChange)}</td>
                <td className="numeric-value border-b border-[#eef0eb] px-3 py-3">{voidDaysBefore === null ? "—" : `${voidDaysBefore} days`}</td>
                <td className="border-b border-[#eef0eb] px-3 py-3">{organisations.find((item) => item.id === tenancy.letting_agent_organisation_id)?.name ?? "—"}</td>
                <td className="border-b border-[#eef0eb] px-3 py-3"><button className="text-sm font-semibold text-[#0F3D2E] underline" onClick={() => setEditingTenancyId(tenancy.id)}>Edit</button></td>
              </tr>;
            })}</tbody>
          </table>
        </div>
      </>}
    </section>}
  </div>;
}

function nextEventText(metrics: RentalUnitPerformance) {
  if (!metrics.currentTenancy) {
    if (metrics.currentVoid?.days !== null && metrics.currentVoid?.days !== undefined) return `Void ${metrics.currentVoid.days} days`;
    if (metrics.nextTenancy) return `Next tenancy ${formatDate(metrics.nextTenancy.tenancy_start_date)}`;
    return "No tenancy recorded";
  }
  if (metrics.upcomingFixedTermDays !== null && metrics.currentTenancy.fixed_term_end_date) return `Fixed term ends ${formatDate(metrics.currentTenancy.fixed_term_end_date)}`;
  if (metrics.nextTenancy) return `Next tenancy ${formatDate(metrics.nextTenancy.tenancy_start_date)}`;
  return "—";
}

export function RentalsWorkspace({ role, buildings, buildingFloors, units, buildingContextId, organisations, onNotice, onOpenSaleFile }: {
  role: string;
  buildings: Building[];
  buildingFloors: BuildingFloor[];
  units: Unit[];
  buildingContextId: string;
  organisations: Organisation[];
  onNotice: (message: string) => void;
  onOpenSaleFile: (unit: Unit) => void;
}) {
  const [tenancies, setTenancies] = useState<UnitTenancy[]>([]);
  const [arrearsEpisodes, setArrearsEpisodes] = useState<RentalArrearsEpisode[]>([]);
  const [arrearsEvents, setArrearsEvents] = useState<RentalArrearsEvent[]>([]);
  const [rentalImports, setRentalImports] = useState<RentalImportHealth[]>([]);
  const [saleAttemptUnitIds, setSaleAttemptUnitIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const buildingId = buildingContextId;
  const [selectedUnitId, setSelectedUnitId] = useState(() => typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("rentalUnitId") ?? "");
  const [search, setSearch] = useState("");
  const [occupancyFilter, setOccupancyFilter] = useState<"all" | "occupied" | "void">("all");
  const [attentionFilter, setAttentionFilter] = useState<AttentionFilter>("all");
  const [reportingPeriod, setReportingPeriod] = useState<RentalReportingPeriod>("lifetime");
  const [page, setPage] = useState(1);
  const [tab, setTab] = useState<"current" | "history">("current");
  const [editingTenancyId, setEditingTenancyId] = useState<string | "new" | "">("");
  const rentalListScrollYRef = useRef<number | null>(null);
  const reportingDate = todayDate();

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
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Tenancies could not be loaded.");
    } finally { setLoading(false); }
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const headers = await authHeaders();
        const [response, riskResponse] = await Promise.all([
          fetch("/api/rentals/tenancies", { headers }),
          fetch("/api/rentals/rent-risk", { headers }),
        ]);
        const payload = await response.json() as { tenancies?: UnitTenancy[]; error?: string };
        const riskPayload = await riskResponse.json() as {
          episodes?: RentalArrearsEpisode[];
          events?: RentalArrearsEvent[];
          imports?: RentalImportHealth[];
          error?: string;
        };
        if (!response.ok) throw new Error(payload.error ?? "Tenancies could not be loaded.");
        if (!riskResponse.ok) throw new Error(riskPayload.error ?? "Rent-risk history could not be loaded.");
        if (!cancelled) {
          setTenancies(payload.tenancies ?? []);
          setArrearsEpisodes(riskPayload.episodes ?? []);
          setArrearsEvents(riskPayload.events ?? []);
          setRentalImports(riskPayload.imports ?? []);
        }
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
  const scopedUnitIds = useMemo(() => new Set(scopedUnits.map((unit) => unit.id)), [scopedUnits]);
  const scopedTenancies = useMemo(() => tenancies.filter((tenancy) => scopedUnitIds.has(tenancy.unit_id)), [scopedUnitIds, tenancies]);
  const scopedTenancyIds = useMemo(() => new Set(scopedTenancies.map((tenancy) => tenancy.id)), [scopedTenancies]);
  const scopedArrearsEpisodes = useMemo(() => arrearsEpisodes.filter((episode) => scopedTenancyIds.has(episode.tenancy_id)), [arrearsEpisodes, scopedTenancyIds]);
  const performance = useMemo(() => calculateRentalPerformance(scopedUnits, scopedTenancies, { reportingDate, reportingPeriod }), [reportingDate, reportingPeriod, scopedTenancies, scopedUnits]);
  const metricsByUnitId = useMemo(() => new Map(performance.units.map((metrics) => [metrics.unit.id, metrics])), [performance.units]);
  const scopedCurrentTenancyIds = useMemo(() => performance.units
    .map((metrics) => metrics.currentTenancy?.id)
    .filter((tenancyId): tenancyId is string => Boolean(tenancyId)), [performance.units]);
  const scopedCurrentTenancyIdSet = useMemo(() => new Set(scopedCurrentTenancyIds), [scopedCurrentTenancyIds]);
  const scopedCurrentArrearsEpisodes = useMemo(() => scopedArrearsEpisodes
    .filter((episode) => scopedCurrentTenancyIdSet.has(episode.tenancy_id)), [scopedArrearsEpisodes, scopedCurrentTenancyIdSet]);
  const rentRiskByUnitId = useMemo(() => new Map(scopedUnits.map((unit) => {
    const currentTenancyId = metricsByUnitId.get(unit.id)?.currentTenancy?.id ?? null;
    return [unit.id, deriveUnitRentRisk(currentTenancyId, scopedCurrentArrearsEpisodes, reportingDate)] as const;
  })), [metricsByUnitId, reportingDate, scopedCurrentArrearsEpisodes, scopedUnits]);
  const filteredUnits = useMemo(() => scopedUnits.filter((unit) => {
    const metrics = metricsByUnitId.get(unit.id);
    if (!metrics) return false;
    const rentRisk = rentRiskByUnitId.get(unit.id);
    const occupied = Boolean(metrics.currentTenancy);
    const buildingName = buildings.find((building) => building.id === unit.building_id)?.name ?? "";
    return (!search.trim() || unit.unit_number.toLowerCase().includes(search.trim().toLowerCase()) || buildingName.toLowerCase().includes(search.trim().toLowerCase()))
      && (occupancyFilter === "all" || (occupancyFilter === "occupied" ? occupied : !occupied))
      && (attentionFilter === "all"
        || (attentionFilter === "current_voids" && !occupied)
        || (attentionFilter === "rent_below_first" && (metrics.currentVsFirstRent?.amount ?? 0) < 0)
        || (attentionFilter === "ending_within_90" && metrics.upcomingFixedTermDays !== null && metrics.upcomingFixedTermDays <= 90)
        || (attentionFilter === "current_arrears" && rentRisk?.hasCurrentArrears)
        || (attentionFilter === "repeat_arrears" && rentRisk?.repeatArrears)
        || (attentionFilter === "reconciliation_required" && rentRisk?.reconciliationRequired));
  }), [attentionFilter, buildings, metricsByUnitId, occupancyFilter, rentRiskByUnitId, scopedUnits, search]);
  const pageCount = Math.max(1, Math.ceil(filteredUnits.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pagedUnits = filteredUnits.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const selectedUnit = units.find((unit) => unit.id === selectedUnitId) ?? null;
  const { previousUnit, nextUnit } = adjacentRentalUnits(filteredUnits, selectedUnitId);
  const selectedBuilding = selectedUnit ? buildings.find((building) => building.id === selectedUnit.building_id) ?? null : null;
  const selectedTenancies = selectedUnit ? tenancies.filter((tenancy) => tenancy.unit_id === selectedUnit.id) : [];
  const selectedTenancyIds = new Set(selectedTenancies.map((tenancy) => tenancy.id));
  const selectedArrearsEpisodes = arrearsEpisodes.filter((episode) => selectedTenancyIds.has(episode.tenancy_id));
  const selectedEpisodeIds = new Set(selectedArrearsEpisodes.map((episode) => episode.id));
  const selectedArrearsEvents = arrearsEvents.filter((event) => selectedEpisodeIds.has(event.episode_id));

  function writeUrl(_nextBuildingId: string, unitId?: string | null) {
    const params = new URLSearchParams(window.location.search);
    params.set("screen", "rentals");
    if (unitId) params.set("rentalUnitId", unitId);
    else params.delete("rentalUnitId");
    window.history.pushState(null, "", `${window.location.pathname}?${params.toString()}`);
  }

  function openRentalFile(unit: Unit, rememberListPosition = false) {
    if (rememberListPosition) rentalListScrollYRef.current = window.scrollY;
    setSelectedUnitId(unit.id);
    setTab("current");
    setEditingTenancyId("");
    writeUrl(buildingId, unit.id);
  }

  function returnToRentalList() {
    const savedScrollY = rentalListScrollYRef.current;
    setSelectedUnitId("");
    setEditingTenancyId("");
    writeUrl(buildingId, null);
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        if (savedScrollY !== null) window.scrollTo({ top: savedScrollY, behavior: "auto" });
        else document.getElementById("rental-unit-list")?.scrollIntoView({ block: "start" });
      });
    });
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setPage(1);
      if (selectedUnitId && !scopedUnitIds.has(selectedUnitId)) {
        setSelectedUnitId("");
        setEditingTenancyId("");
        writeUrl(buildingId, null);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [buildingId, scopedUnitIds, selectedUnitId]);

  if (selectedUnit && (selectedUnit.rental_portfolio_status === "active" || selectedUnit.rental_portfolio_status === "exited")) {
    return <RentalFile
      role={role}
      unit={selectedUnit}
      building={selectedBuilding}
      tenancies={selectedTenancies}
      organisations={organisations}
      arrearsEpisodes={selectedArrearsEpisodes}
      arrearsEvents={selectedArrearsEvents}
      saleAttemptUnitIds={saleAttemptUnitIds}
      tab={tab}
      editingTenancyId={editingTenancyId}
      previousUnit={previousUnit}
      nextUnit={nextUnit}
      setTab={setTab}
      setEditingTenancyId={setEditingTenancyId}
      onBack={returnToRentalList}
      onOpenUnit={(unit) => openRentalFile(unit)}
      onOpenSaleFile={onOpenSaleFile}
      onSaved={loadTenancies}
      onNotice={onNotice}
    />;
  }

  const current = performance.currentPosition;
  const historical = performance.performance;
  const attention = performance.attention;
  const selectedBuildingName = buildingId ? buildings.find((building) => building.id === buildingId)?.name : null;

  return <div className="grid min-w-0 gap-5">
    <section className="panel"><div><h2 className="text-2xl font-bold text-[#0F3D2E]">Rentals</h2><p className="mt-1 text-sm text-[#617169]">{selectedBuildingName ?? "All buildings"} · active rental portfolio management</p></div></section>

    <section className="panel min-w-0">
      <SectionHeading eyebrow="Current position" title="Portfolio today" description={`Position at ${formatLongDate(reportingDate)}`} />
      <div className="mt-5 grid gap-4 lg:grid-cols-[1.05fr_1.45fr]">
        <dl className="grid grid-cols-3 divide-x divide-[#dfe4de] overflow-hidden rounded-lg border border-[#d9ded6] bg-[#fbfcfa]"><PerformanceMetric label="Rental units" value={String(current.rentalUnits)} /><PerformanceMetric label="Occupied" value={`${current.occupied} / ${formatPercentage(current.occupancyPercentage)}`} /><PerformanceMetric label="Void" value={String(current.void)} tone={current.void > 0 ? "negative" : "normal"} /></dl>
        <dl className="grid grid-cols-2 divide-x divide-[#cbd9d0] overflow-hidden rounded-lg border border-[#bdd0c4] bg-[#f1f7f3]"><PerformanceMetric label="Monthly rent roll" value={formatGbp(current.monthlyRentRoll)} detail="Active tenancies today" /><PerformanceMetric label="Annualised rent roll" value={formatGbp(current.annualisedRentRoll)} detail="Current monthly rent × 12" /></dl>
      </div>
    </section>

    <section className="panel">
      <SectionHeading eyebrow="Performance" title="Recorded performance" description="Calculated from recorded tenancy periods" action={<label className="field-label min-w-[15rem]">Reporting period<select aria-label="Reporting period" className="field" value={reportingPeriod} onChange={(event) => { setReportingPeriod(event.target.value as RentalReportingPeriod); setPage(1); }}><option value="lifetime">Since first recorded tenancy</option><option value="ytd">Year to date</option><option value="last_12_months">Last 12 months</option></select></label>} />
      <div className="mt-5 grid grid-cols-2 divide-x divide-y divide-[#e2e6e0] overflow-hidden rounded-lg border border-[#d9ded6] bg-[#fbfcfa] lg:grid-cols-5 lg:divide-y-0">
        <PerformanceMetric label="Historical occupancy" value={formatPercentage(historical.occupancyPercentage)} detail="Occupied days ÷ measured available days" />
        <PerformanceMetric label="Recorded void days" value={`${historical.voidDays} days`} detail="Excludes days before first recorded tenancy" />
        <PerformanceMetric label="Estimated void rent loss" value={historical.estimatedVoidLoss === null ? "Unknown" : formatGbp(historical.estimatedVoidLoss)} detail="Using rent immediately before each void" />
        <PerformanceMetric label="Tenancy changes" value={String(historical.tenancyChanges)} detail="Recorded relets across the portfolio" />
        <PerformanceMetric label="Current vs first achieved" value={rentMovementText(historical.rentMovement)} tone={(historical.rentMovement?.amount ?? 0) < 0 ? "negative" : "normal"} detail={`Like-for-like · ${historical.comparableUnits} comparable units`} />
      </div>
      <p className="mt-3 text-xs text-[#6b7770]">Period: {rentalReportingPeriodLabel(reportingPeriod)}. Occupancy is weighted by total unit-days, not averaged by unit.</p>
    </section>

    <section className="panel">
      <SectionHeading eyebrow="Management attention" title="Exceptions and upcoming dates" description="Objective signals derived from the tenancy record" />
      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <PortfolioRentRiskSection
          episodes={scopedCurrentArrearsEpisodes}
          currentTenancyIds={scopedCurrentTenancyIds}
          imports={rentalImports}
          buildingId={buildingId}
          asOfDate={reportingDate}
          loading={loading}
        />
        <article className="rounded-lg border border-[#d9ded6] p-4">
          <div className="flex items-center gap-2"><Home className="h-4 w-4 text-[#617169]" /><h4 className="font-bold text-[#34413a]">Longest recorded void</h4></div>
          {attention.longestVoid ? <div className="mt-3"><p className="text-xl font-bold text-[#0F3D2E]">Unit {attention.longestVoid.unit.unit_number} · {attention.longestVoid.period.days} days</p><p className="mt-1 text-sm text-[#617169]">{formatDate(attention.longestVoid.period.startDate)} – {formatDate(attention.longestVoid.period.endDate)}</p><p className="mt-2 text-sm font-semibold text-[#34413a]">Estimated loss: {attention.longestVoid.period.estimatedLoss === null ? "Unknown" : formatGbp(attention.longestVoid.period.estimatedLoss)}</p></div> : <p className="mt-3 text-sm text-[#617169]">No recorded void periods in this reporting period.</p>}
        </article>
        <article className="rounded-lg border border-[#d9ded6] p-4">
          <div className="flex items-center gap-2"><TrendingDown className="h-4 w-4 text-[#617169]" /><h4 className="font-bold text-[#34413a]">Largest current rent reduction</h4></div>
          {attention.largestRentReduction ? <div className="mt-3"><p className="text-xl font-bold text-[#8d382d]">Unit {attention.largestRentReduction.unit.unit_number} · {rentMovementText(attention.largestRentReduction.movement)}</p><p className="mt-1 text-sm text-[#617169]">First achieved {formatGbp(attention.largestRentReduction.firstRent)} · current {formatGbp(attention.largestRentReduction.currentRent)}</p></div> : <p className="mt-3 text-sm text-[#617169]">No occupied unit is below its first achieved rent.</p>}
        </article>
        <article className="rounded-lg border border-[#d9ded6] p-4">
          <div className="flex items-center gap-2"><CalendarClock className="h-4 w-4 text-[#617169]" /><h4 className="font-bold text-[#34413a]">Upcoming fixed-term dates</h4></div>
          {attention.upcomingFixedTerms.recorded > 0 ? <dl className="mt-3 grid grid-cols-3 divide-x divide-[#e2e6e0]"><PerformanceMetric label="30 days" value={String(attention.upcomingFixedTerms.within30Days)} /><PerformanceMetric label="60 days" value={String(attention.upcomingFixedTerms.within60Days)} /><PerformanceMetric label="90 days" value={String(attention.upcomingFixedTerms.within90Days)} /></dl> : <p className="mt-3 text-sm text-[#617169]">No future fixed-term dates are recorded for current tenancies.</p>}
        </article>
        <article className="rounded-lg border border-[#d9ded6] p-4">
          <div className="flex items-center gap-2"><AlertCircle className="h-4 w-4 text-[#617169]" /><h4 className="font-bold text-[#34413a]">Current voids</h4></div>
          {attention.currentVoids.length === 0 ? <p className="mt-3 text-sm text-[#617169]">No current voids.</p> : <div className="mt-3 divide-y divide-[#e5e8e3]">{attention.currentVoids.map(({ unit, details, nextTenancy: scheduled }) => <div key={unit.id} className="py-2 first:pt-0"><p className="font-semibold text-[#34413a]">Unit {unit.unit_number} · {details.days === null ? "not yet measured" : `${details.days} days`}</p><p className="mt-0.5 text-sm text-[#617169]">Previous rent {details.previousMonthlyRent === null ? "unknown" : formatGbp(details.previousMonthlyRent)} · loss {details.estimatedLoss === null ? "unknown" : formatGbp(details.estimatedLoss)}{scheduled ? ` · next tenancy ${formatDate(scheduled.tenancy_start_date)}` : ""}</p></div>)}</div>}
        </article>
      </div>
    </section>

    <section id="rental-unit-list" className="panel min-w-0">
      <SectionHeading eyebrow="Rental portfolio" title="Unit performance" description={`${filteredUnits.length} units match the selected view`} />
      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <label className="field-label">Unit search<input className="field" placeholder="Unit number" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} /></label>
        <label className="field-label">Occupancy<select className="field" value={occupancyFilter} onChange={(event) => { setOccupancyFilter(event.target.value as typeof occupancyFilter); setPage(1); }}><option value="all">All</option><option value="occupied">Occupied</option><option value="void">Void</option></select></label>
        <label className="field-label">Performance / attention<select className="field" value={attentionFilter} onChange={(event) => { setAttentionFilter(event.target.value as AttentionFilter); setPage(1); }}><option value="all">All</option><option value="current_arrears">Current arrears</option><option value="repeat_arrears">Repeat arrears</option><option value="reconciliation_required">Reconciliation required</option><option value="current_voids">Current voids</option><option value="rent_below_first">Rent below first achieved</option><option value="ending_within_90">Tenancy ending within 90 days</option></select></label>
      </div>
      {loading ? <p className="mt-5 text-sm text-[#617169]" role="status">Loading rental portfolio…</p> : <>
        <div className="mt-5 overflow-x-auto rounded-lg border border-[#d9ded6]"><table className="min-w-[72rem] w-full text-left text-sm">
          <thead className="bg-[#fbfcfa] text-xs uppercase text-[#617169]"><tr><th className="border-b border-[#d9ded6] px-3 py-3">Unit</th>{!buildingId && <th className="border-b border-[#d9ded6] px-3 py-3">Building</th>}{["Occupancy", "Attention", "Current rent", "Rent movement", "Current tenancy", "Tenancies", "Recorded void", "Next event"].map((heading) => <th key={heading} className="border-b border-[#d9ded6] px-3 py-3">{heading}</th>)}</tr></thead>
          <tbody>{pagedUnits.length === 0 ? <tr><td colSpan={buildingId ? 9 : 10} className="px-4 py-8 text-center text-[#617169]">No rental units match the selected filters.</td></tr> : pagedUnits.map((unit) => {
            const metrics = metricsByUnitId.get(unit.id) as RentalUnitPerformance;
            const rentRisk = rentRiskByUnitId.get(unit.id);
            const active = metrics.currentTenancy;
            const saleException = saleAttemptUnitIds.has(unit.id) || ["for_sale", "reserved", "exchanged", "completed", "handed_over"].includes(unit.sale_status);
            return <tr key={unit.id} className="cursor-pointer bg-white hover:bg-[#fbfcfa]" tabIndex={0} onClick={() => openRentalFile(unit, true)} onKeyDown={(event) => { if (event.key === "Enter") openRentalFile(unit, true); }}>
              <td className="border-b border-[#eef0eb] px-3 py-3 font-bold text-[#0F3D2E]"><span>{unit.unit_number}</span>{saleException && <span className="mt-1 block w-fit rounded-full border border-[#e3c77b] bg-[#fff8e8] px-2 py-0.5 text-[0.68rem] font-bold text-[#765a18]">{unit.sale_status === "for_sale" ? "Also for sale" : saleStatusLabel(unit.sale_status)}</span>}</td>
              {!buildingId && <td className="border-b border-[#eef0eb] px-3 py-3">{buildings.find((building) => building.id === unit.building_id)?.name}</td>}
              <td className="border-b border-[#eef0eb] px-3 py-3"><span className={`rounded-full border px-2.5 py-1 text-xs font-bold ${occupancyBadge(Boolean(active))}`}>{active ? "Occupied" : "Void"}</span></td>
              <td className="border-b border-[#eef0eb] px-3 py-3"><RentRiskAttentionBadge risk={rentRisk} /></td>
              <td className="numeric-value border-b border-[#eef0eb] px-3 py-3 font-semibold">{metrics.currentRent === null ? "—" : formatGbp(metrics.currentRent)}</td>
              <td className={`numeric-value border-b border-[#eef0eb] px-3 py-3 ${movementColour(metrics.currentVsFirstRent?.amount)}`}>{rentMovementText(metrics.currentVsFirstRent)}</td>
              <td className="border-b border-[#eef0eb] px-3 py-3">{active ? <><span className="block font-medium">Since {formatDate(active.tenancy_start_date)}</span><span className={`block max-w-[12rem] truncate text-xs ${isRealTenantName(active.tenant_name) ? "text-[#617169]" : "text-[#98a09b]"}`}>{active.tenant_name}</span></> : "—"}</td>
              <td className="numeric-value border-b border-[#eef0eb] px-3 py-3">{metrics.tenancyCount}</td>
              <td className="numeric-value border-b border-[#eef0eb] px-3 py-3"><span className="block">{metrics.voidDays} days</span>{metrics.estimatedVoidLoss !== null && metrics.estimatedVoidLoss > 0 && <span className="block text-xs text-[#617169]">{formatGbp(metrics.estimatedVoidLoss)} est.</span>}</td>
              <td className="border-b border-[#eef0eb] px-3 py-3 text-[#617169]">{nextEventText(metrics)}</td>
            </tr>;
          })}</tbody>
        </table></div>
        <div className="mt-4 flex items-center justify-between gap-3 text-sm text-[#617169]"><span>Showing {filteredUnits.length === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1}-{Math.min(currentPage * PAGE_SIZE, filteredUnits.length)} of {filteredUnits.length}</span><div className="flex gap-2"><button className="secondary" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>Previous</button><button className="secondary" disabled={currentPage >= pageCount} onClick={() => setPage(currentPage + 1)}>Next</button></div></div>
      </>}
    </section>
  </div>;
}
