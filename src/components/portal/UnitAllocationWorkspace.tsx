"use client";

import { useEffect, useMemo, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { CircleMinus, CirclePlus, ExternalLink, Pencil } from "lucide-react";
import type { Building, BuildingFloor, RentalPortfolioStatus, Unit, UnitSaleStatus } from "@/lib/data/production";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  ADMIN_SALES_AVAILABILITY_STATUSES,
  isBlockingSaleWorkflow,
  isSalesRouteUnit,
  saleStatusLabel,
  saleWorkflowLabel,
  sortUnitsByBuildingFloorOrder,
  summariseUnitAllocation,
  type UnitAllocationAttempt,
  unitAllocationActionAvailability,
  validateRentalPortfolioChange,
  validateSalesAvailabilityChange,
} from "@/lib/units/commercial-allocation";

const PAGE_SIZE = 12;

type SalesFilter = "all" | "sales_route" | UnitSaleStatus;
type RentalFilter = "all" | "sale_and_rental" | RentalPortfolioStatus;
type AdminSalesTarget = Extract<UnitSaleStatus, "not_released" | "not_for_sale" | "for_sale">;
type PendingAction =
  | { kind: "sales"; target: AdminSalesTarget; unitIds: string[] }
  | { kind: "rental"; target: "active" | "exited"; unitIds: string[] };

const salesFilters: Array<{ value: SalesFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "not_released", label: "Not released" },
  { value: "not_for_sale", label: "Retained / not for sale" },
  { value: "for_sale", label: "For sale" },
  { value: "reserved", label: "Reserved" },
  { value: "exchanged", label: "Exchanged" },
  { value: "completed", label: "Completed" },
  { value: "handed_over", label: "Handed over" },
  { value: "sales_route", label: "Sales route" },
];

const rentalFilters: Array<{ value: RentalFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "active", label: "Rental portfolio" },
  { value: "not_in_portfolio", label: "Not in rental portfolio" },
  { value: "exited", label: "Exited rental portfolio" },
  { value: "sale_and_rental", label: "Sale and rental" },
];

function salesTone(status: UnitSaleStatus) {
  if (status === "not_released") return "border-[#d9ded6] bg-[#f2f4f0] text-[#617169]";
  if (status === "not_for_sale") return "border-[#decda6] bg-[#fbf5e8] text-[#765a18]";
  if (status === "for_sale") return "border-[#b8d2c4] bg-[#edf8f1] text-[#286348]";
  if (status === "reserved") return "border-[#ead8a7] bg-[#fff8e8] text-[#765a18]";
  if (status === "exchanged") return "border-[#bfd8df] bg-[#eef8fa] text-[#315f6a]";
  if (status === "completed") return "border-[#bedacb] bg-[#edf8f1] text-[#286348]";
  return "border-[#d6cae5] bg-[#f6f1fb] text-[#66507b]";
}

function rentalStatus(unit: Unit): RentalPortfolioStatus {
  return unit.rental_portfolio_status ?? "not_in_portfolio";
}

function operationalRentalStatusLabel(status: RentalPortfolioStatus) {
  return status === "active" ? "Rental portfolio" : "Not in rental portfolio";
}

function SummaryMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-0 border-l-2 border-[#d9ded6] px-3 py-1 first:border-l-0">
      <p className="truncate text-[11px] font-bold uppercase tracking-[0.07em] text-[#617169]">{label}</p>
      <p className="numeric-value mt-0.5 text-xl font-bold text-[#0F3D2E]">{value}</p>
    </div>
  );
}

function AllocationAction({ icon, children, className = "", type = "button", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { icon: ReactNode }) {
  return <button className={`allocation-action ${className}`} type={type} {...props}>{icon}<span>{children}</span></button>;
}

function AllocationStatusActionCell({ status, actions }: { status: ReactNode; actions?: ReactNode }) {
  return (
    <div className="allocation-status-action-cell">
      <div className="allocation-cell-status">{status}</div>
      <div className="allocation-cell-actions">{actions}</div>
    </div>
  );
}

function mostRecentlyCreatedBuildingId(buildings: Building[]) {
  return [...buildings].sort((a, b) => {
    const aTime = a.created_at ? Date.parse(a.created_at) : Number.NEGATIVE_INFINITY;
    const bTime = b.created_at ? Date.parse(b.created_at) : Number.NEGATIVE_INFINITY;
    return bTime - aTime;
  })[0]?.id ?? "";
}

export function UnitAllocationWorkspace({
  buildings,
  buildingFloors,
  units,
  onOpenSaleFile,
  onOpenRentalFile,
  onNotice,
  reload,
}: {
  buildings: Building[];
  buildingFloors: BuildingFloor[];
  units: Unit[];
  onOpenSaleFile: (unit: Unit) => void;
  onOpenRentalFile: (unit: Unit) => void;
  onNotice: (notice: string) => void;
  reload: () => Promise<void>;
}) {
  const [attempts, setAttempts] = useState<UnitAllocationAttempt[]>([]);
  const [buildingFilter, setBuildingFilter] = useState("");
  const [buildingSelectionReady, setBuildingSelectionReady] = useState(false);
  const [search, setSearch] = useState("");
  const [salesFilter, setSalesFilter] = useState<SalesFilter>("all");
  const [rentalFilter, setRentalFilter] = useState<RentalFilter>("all");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [validationError, setValidationError] = useState("");

  async function queryAttempts() {
    const supabase = createSupabaseBrowserClient();
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) throw new Error("Your session has expired. Sign in again.");
    const response = await fetch("/api/units/allocation", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const payload = await response.json() as { workflows?: UnitAllocationAttempt[]; error?: string };
    if (!response.ok) throw new Error(payload.error || "Sale workflow status could not be loaded.");
    return payload.workflows ?? [];
  }

  useEffect(() => {
    let cancelled = false;
    void queryAttempts()
      .then((loadedAttempts) => {
        if (!cancelled) setAttempts(loadedAttempts);
      })
      .catch((error: unknown) => {
        if (!cancelled) onNotice(error instanceof Error ? error.message : "Sale workflow status could not be loaded.");
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (buildings.length === 0) return;
    if (buildingSelectionReady && (buildingFilter === "" || buildings.some((building) => building.id === buildingFilter))) return;
    const explicit = typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("allocationBuildingId");
    const nextBuildingId = explicit === "all" ? "" : explicit && buildings.some((building) => building.id === explicit)
      ? explicit
      : mostRecentlyCreatedBuildingId(buildings);
    const timer = window.setTimeout(() => {
      setBuildingFilter(nextBuildingId);
      setBuildingSelectionReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [buildingFilter, buildingSelectionReady, buildings]);

  function changeBuilding(buildingId: string) {
    setBuildingFilter(buildingId);
    setSelectedIds([]);
    setValidationError("");
    setPage(1);
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      params.set("allocationBuildingId", buildingId || "all");
      window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
    }
  }

  const buildingById = useMemo(() => new Map(buildings.map((building) => [building.id, building])), [buildings]);
  const attemptByUnit = useMemo(() => new Map(attempts.map((attempt) => [attempt.unit_id, attempt])), [attempts]);
  const selectedUnits = useMemo(() => units.filter((unit) => selectedIds.includes(unit.id)), [selectedIds, units]);
  const filteredUnits = useMemo(() => sortUnitsByBuildingFloorOrder(units.filter((unit) => {
    if (buildingFilter && unit.building_id !== buildingFilter) return false;
    if (search && !unit.unit_number.toLowerCase().includes(search.trim().toLowerCase())) return false;
    if (salesFilter === "sales_route" && !isSalesRouteUnit(unit)) return false;
    if (salesFilter !== "all" && salesFilter !== "sales_route" && unit.sale_status !== salesFilter) return false;
    const rental = rentalStatus(unit);
    if (rentalFilter === "sale_and_rental" && !(rental === "active" && isSalesRouteUnit(unit))) return false;
    if (rentalFilter !== "all" && rentalFilter !== "sale_and_rental" && rental !== rentalFilter) return false;
    return true;
  }), buildingFloors, buildings), [buildingFilter, buildingFloors, buildings, rentalFilter, salesFilter, search, units]);
  const summary = useMemo(() => summariseUnitAllocation(filteredUnits.map((unit) => ({
    sale_status: unit.sale_status,
    rental_portfolio_status: rentalStatus(unit),
  }))), [filteredUnits]);
  const pageCount = Math.max(1, Math.ceil(filteredUnits.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pagedUnits = filteredUnits.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const pageFullySelected = pagedUnits.length > 0 && pagedUnits.every((unit) => selectedIds.includes(unit.id));

  function toggleUnit(unitId: string) {
    setValidationError("");
    setSelectedIds((current) => current.includes(unitId) ? current.filter((id) => id !== unitId) : [...current, unitId]);
  }

  function togglePageSelection() {
    setValidationError("");
    setSelectedIds((current) => pageFullySelected
      ? current.filter((id) => !pagedUnits.some((unit) => unit.id === id))
      : Array.from(new Set([...current, ...pagedUnits.map((unit) => unit.id)])));
  }

  function prepareAction(action: PendingAction) {
    const actionUnits = action.unitIds.map((id) => units.find((unit) => unit.id === id)).filter((unit): unit is Unit => Boolean(unit));
    const errors = actionUnits.map((unit) => action.kind === "sales"
      ? validateSalesAvailabilityChange(unit, attemptByUnit.get(unit.id), action.target)
      : validateRentalPortfolioChange({ ...unit, rental_portfolio_status: rentalStatus(unit) }, action.target))
      .filter((error): error is string => Boolean(error));
    if (errors.length > 0) {
      const message = errors.join(" ");
      setValidationError(message);
      onNotice(message);
      return;
    }
    setValidationError("");
    setPendingAction(action);
  }

  async function applyAction() {
    if (!pendingAction) return;
    setIsSaving(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("Your session has expired. Sign in again.");
      const response = await fetch("/api/units/allocation", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          action: pendingAction.kind === "sales" ? "set_sales_availability" : "set_rental_portfolio",
          unitIds: pendingAction.unitIds,
          target: pendingAction.target,
        }),
      });
      const payload = await response.json() as { changed?: number; error?: string };
      if (!response.ok) throw new Error(payload.error || "Unit allocation could not be changed.");
      setPendingAction(null);
      setSelectedIds([]);
      setValidationError("");
      onNotice(`${payload.changed ?? 0} unit${payload.changed === 1 ? "" : "s"} updated.`);
      const [, loadedAttempts] = await Promise.all([reload(), queryAttempts()]);
      setAttempts(loadedAttempts);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unit allocation could not be changed.";
      setValidationError(message);
      onNotice(message);
      setPendingAction(null);
    } finally {
      setIsSaving(false);
    }
  }

  const pendingUnits = pendingAction
    ? pendingAction.unitIds.map((id) => units.find((unit) => unit.id === id)).filter((unit): unit is Unit => Boolean(unit))
    : [];
  const pendingUnit = pendingUnits.length === 1 ? pendingUnits[0] : undefined;
  const retainedSalesPositions = Array.from(new Set(pendingUnits.map((unit) => saleStatusLabel(unit.sale_status))));
  const salesPositionReminder = pendingUnit
    ? `Its sales position will remain ${saleStatusLabel(pendingUnit.sale_status)}.`
    : `Every unit will keep its current sales position${retainedSalesPositions.length > 0 ? ` (${retainedSalesPositions.join(", ")})` : ""}.`;
  const actionDescription = pendingAction?.kind === "sales"
    ? pendingUnit
      ? `Set Unit ${pendingUnit.unit_number} to ${saleStatusLabel(pendingAction.target)}. Its existing pristine draft, if any, will be retained.`
      : `Set ${pendingAction.unitIds.length} selected units to ${saleStatusLabel(pendingAction.target)}. Existing pristine drafts will be retained.`
    : pendingAction?.target === "active"
      ? pendingUnit
        ? `Add Unit ${pendingUnit.unit_number} to the rental portfolio? ${salesPositionReminder}`
        : `Add ${pendingAction?.unitIds.length ?? 0} selected units to the rental portfolio. ${salesPositionReminder}`
      : pendingUnit
        ? `Remove Unit ${pendingUnit.unit_number} from the rental portfolio? ${salesPositionReminder} Historical allocation will be retained.`
        : `Remove ${pendingAction?.unitIds.length ?? 0} selected units from the rental portfolio. ${salesPositionReminder} Historical allocation will be retained.`;
  const selectedBuilding = buildingFilter ? buildingById.get(buildingFilter) : undefined;

  return (
    <section className="panel">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.12em] text-[#D6A23A]">Commercial setup</p>
          <h2 className="mt-1 text-2xl font-bold text-[#0F3D2E]">Unit allocation</h2>
          <p className="mt-1 max-w-3xl text-sm text-[#617169]">Manage administrative sales availability and rental-portfolio participation. Formal sale stages stay controlled by the sale file.</p>
        </div>
        <label className="min-w-60 text-xs font-bold uppercase tracking-[0.06em] text-[#617169]">
          Building context
          <select className="field mt-1 min-h-10 py-2 text-sm normal-case tracking-normal" aria-label="Building context" value={buildingFilter} onChange={(event) => changeBuilding(event.target.value)}>
            <option value="">All buildings</option>
            {buildings.map((building) => <option key={building.id} value={building.id}>{building.name}</option>)}
          </select>
          <span className="mt-1 block text-right text-[11px] font-normal normal-case tracking-normal">{selectedBuilding ? `${units.filter((unit) => unit.building_id === selectedBuilding.id).length} units` : `${units.length} units`}</span>
        </label>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-y-3 rounded-lg border border-[#d9ded6] bg-[#fbfcfa] py-2 sm:grid-cols-3 xl:grid-cols-6">
        <SummaryMetric label="Total units" value={summary.total} />
        <SummaryMetric label="Not released" value={summary.notReleased} />
        <SummaryMetric label="Sales route" value={summary.salesRoute} />
        <SummaryMetric label="Rental portfolio" value={summary.rentalPortfolio} />
        <SummaryMetric label="Sale and rental" value={summary.saleAndRental} />
        <SummaryMetric label="Sold / handed over" value={summary.soldOrHandedOver} />
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <label className="field-label">Unit number<input className="field min-h-10 py-2" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Search units" /></label>
        <label className="field-label">Sales position<select className="field min-h-10 py-2" value={salesFilter} onChange={(event) => { setSalesFilter(event.target.value as SalesFilter); setPage(1); }}>{salesFilters.map((filter) => <option key={filter.value} value={filter.value}>{filter.label}</option>)}</select></label>
        <label className="field-label">Rental position<select className="field min-h-10 py-2" value={rentalFilter} onChange={(event) => { setRentalFilter(event.target.value as RentalFilter); setPage(1); }}>{rentalFilters.map((filter) => <option key={filter.value} value={filter.value}>{filter.label}</option>)}</select></label>
      </div>

      {selectedIds.length > 0 ? <div className="mt-4 rounded-lg border border-[#c8d3cc] bg-[#f4f8f5] p-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="font-bold text-[#0F3D2E]">{selectedIds.length} unit{selectedIds.length === 1 ? "" : "s"} selected</p>
            <p className="text-xs text-[#617169]">Every selected unit is validated before a transactional, all-or-nothing change.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="sr-only" htmlFor="bulk-sales-availability">Change sales availability</label>
            <select id="bulk-sales-availability" className="field min-h-9 w-auto py-1.5 text-sm" defaultValue="" onChange={(event) => { const target = event.target.value as AdminSalesTarget; if (target) prepareAction({ kind: "sales", target, unitIds: selectedIds }); event.currentTarget.value = ""; }}>
              <option value="">Change sales availability…</option>
              {ADMIN_SALES_AVAILABILITY_STATUSES.map((status) => {
                const availability = unitAllocationActionAvailability(selectedUnits, attemptByUnit, { kind: "sales", target: status });
                return <option key={status} value={status} disabled={!availability.enabled}>{saleStatusLabel(status)}</option>;
              })}
            </select>
            {(["active", "exited"] as const).map((target) => {
              const availability = unitAllocationActionAvailability(selectedUnits, attemptByUnit, { kind: "rental", target });
              return <button key={target} className="secondary min-h-9 px-3 py-1.5 text-sm" type="button" disabled={!availability.enabled} title={availability.reason} onClick={() => prepareAction({ kind: "rental", target, unitIds: selectedIds })}>{target === "active" ? "Add to rental" : "Remove from rental"}</button>;
            })}
          </div>
        </div>
        {validationError && <p className="mt-3 rounded-md border border-[#e5c4be] bg-[#fff9f7] p-3 text-sm text-[#7a271a]" role="alert">{validationError}</p>}
      </div> : <p className="mt-4 text-xs text-[#617169]">Select units to make bulk changes.</p>}

      <div className="mt-4 hidden overflow-visible rounded-lg border border-[#d9ded6] xl:block">
        <table className="w-full table-fixed text-left text-sm">
          <thead className="bg-[#fbfcfa] text-xs uppercase text-[#617169]">
            <tr>
              <th className="w-10 border-b border-[#d9ded6] px-3 py-2.5"><input aria-label="Select units on this page" type="checkbox" checked={pageFullySelected} onChange={togglePageSelection} /></th>
              <th className="w-20 border-b border-[#d9ded6] px-3 py-2.5">Unit</th>
              {!buildingFilter && <th className="border-b border-[#d9ded6] px-3 py-2.5">Building</th>}
              <th className="w-28 border-b border-[#d9ded6] px-3 py-2.5">Floor</th>
              <th className="w-72 border-b border-[#d9ded6] px-3 py-2.5">Sales position</th>
              <th className="w-96 border-b border-[#d9ded6] px-3 py-2.5">Rental portfolio</th>
              <th className="w-40 border-b border-[#d9ded6] px-3 py-2.5">Sale workflow</th>
            </tr>
          </thead>
          <tbody>
            {pagedUnits.length === 0 ? <tr><td className="px-4 py-8 text-center text-[#617169]" colSpan={buildingFilter ? 6 : 7}>No units match the selected filters.</td></tr> : pagedUnits.map((unit) => {
              const attempt = attemptByUnit.get(unit.id);
              const rental = rentalStatus(unit);
              const workflowBlocksAllocation = isBlockingSaleWorkflow(attempt);
              const hasAdministrativeAvailability = ADMIN_SALES_AVAILABILITY_STATUSES.includes(unit.sale_status as typeof ADMIN_SALES_AVAILABILITY_STATUSES[number]);
              const availabilityEditable = hasAdministrativeAvailability && !workflowBlocksAllocation;
              const rentalAction = rental === "active" ? { kind: "rental" as const, target: "exited" as const } : { kind: "rental" as const, target: "active" as const };
              const rentalAvailability = unitAllocationActionAvailability([unit], attemptByUnit, rentalAction);
              return (
                <tr key={unit.id} className="bg-white hover:bg-[#fbfcfa]">
                  <td className="border-b border-[#eef0eb] px-3 py-2.5"><input aria-label={`Select unit ${unit.unit_number}`} type="checkbox" checked={selectedIds.includes(unit.id)} onChange={() => toggleUnit(unit.id)} /></td>
                  <td className="border-b border-[#eef0eb] px-3 py-2.5 font-bold text-[#0F3D2E]">{unit.unit_number}</td>
                  {!buildingFilter && <td className="border-b border-[#eef0eb] px-3 py-2.5">{buildingById.get(unit.building_id)?.name ?? "Unknown"}</td>}
                  <td className="border-b border-[#eef0eb] px-3 py-2.5">{unit.floor || "—"}</td>
                  <td className="border-b border-[#eef0eb] px-3 py-2.5">
                    <AllocationStatusActionCell
                      status={<span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-bold ${salesTone(unit.sale_status)}`}>{saleStatusLabel(unit.sale_status)}</span>}
                      actions={availabilityEditable ? <details className="relative"><summary className="allocation-action" aria-label={`Sales availability for unit ${unit.unit_number}`}><Pencil size={16} aria-hidden /><span>Change</span></summary><div className="absolute left-0 z-20 mt-1 grid min-w-44 gap-1 rounded-md border border-[#d9ded6] bg-white p-1.5 shadow-lg">{ADMIN_SALES_AVAILABILITY_STATUSES.map((status) => <button key={status} className="rounded px-2 py-1.5 text-left text-xs hover:bg-[#f2f5f1] disabled:opacity-45" type="button" disabled={status === unit.sale_status} onClick={() => prepareAction({ kind: "sales", target: status, unitIds: [unit.id] })}>{saleStatusLabel(status)}</button>)}</div></details> : workflowBlocksAllocation ? <span className="sr-only">Managed through the sale workflow.</span> : null}
                    />
                  </td>
                  <td className="border-b border-[#eef0eb] px-3 py-2.5">
                    <AllocationStatusActionCell
                      status={<span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-bold ${rental === "active" ? "border-[#bfd8df] bg-[#eef8fa] text-[#315f6a]" : "border-[#d9ded6] bg-[#f2f4f0] text-[#617169]"}`} title={rental === "exited" ? "Previously exited; allocation history is retained in the Activity log." : undefined}>{operationalRentalStatusLabel(rental)}</span>}
                      actions={<><AllocationAction icon={rental === "active" ? <CircleMinus size={16} aria-hidden /> : <CirclePlus size={16} aria-hidden />} disabled={!rentalAvailability.enabled} title={rentalAvailability.reason} onClick={() => prepareAction({ ...rentalAction, unitIds: [unit.id] })}>{rental === "active" ? "Remove" : "Add"}</AllocationAction>{(unit.rental_portfolio_status === "active" || unit.rental_portfolio_status === "exited") && <AllocationAction icon={<ExternalLink size={16} aria-hidden />} onClick={() => onOpenRentalFile(unit)}>Open file</AllocationAction>}</>}
                    />
                  </td>
                  <td className="border-b border-[#eef0eb] px-3 py-2.5">
                    {workflowBlocksAllocation
                      ? <button className="snag-action-link" type="button" onClick={() => onOpenSaleFile(unit)}>{saleWorkflowLabel(attempt)}</button>
                      : <span className="text-[#617169]">Not started</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-4 grid gap-2 xl:hidden">
        {pagedUnits.length === 0 ? <p className="rounded-lg border border-[#d9ded6] p-5 text-center text-sm text-[#617169]">No units match the selected filters.</p> : pagedUnits.map((unit) => {
          const attempt = attemptByUnit.get(unit.id);
          const rental = rentalStatus(unit);
          const workflowBlocksAllocation = isBlockingSaleWorkflow(attempt);
          const availabilityEditable = ADMIN_SALES_AVAILABILITY_STATUSES.includes(unit.sale_status as typeof ADMIN_SALES_AVAILABILITY_STATUSES[number]) && !workflowBlocksAllocation;
          const rentalAction = rental === "active" ? { kind: "rental" as const, target: "exited" as const } : { kind: "rental" as const, target: "active" as const };
          const rentalAvailability = unitAllocationActionAvailability([unit], attemptByUnit, rentalAction);
          return (
            <article key={unit.id} className="rounded-lg border border-[#d9ded6] bg-white p-3">
              <div className="flex items-center justify-between gap-3">
                <label className="flex items-center gap-2 font-bold text-[#0F3D2E]"><input aria-label={`Select unit ${unit.unit_number}`} type="checkbox" checked={selectedIds.includes(unit.id)} onChange={() => toggleUnit(unit.id)} />{unit.unit_number}</label>
                <span className="text-xs text-[#617169]">{unit.floor || "No floor"}</span>
              </div>
              {!buildingFilter && <p className="mt-1 text-xs text-[#617169]">{buildingById.get(unit.building_id)?.name ?? "Unknown building"}</p>}
              <div className="mt-3 grid gap-3">
                <div>
                  <p className="text-[11px] font-bold uppercase text-[#617169]">Sales position</p>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-bold ${salesTone(unit.sale_status)}`}>{saleStatusLabel(unit.sale_status)}</span>
                    {availabilityEditable && <details className="relative"><summary className="allocation-action" aria-label={`Sales availability for unit ${unit.unit_number}`}><Pencil size={16} aria-hidden /><span>Change</span></summary><div className="absolute right-0 z-20 mt-1 grid min-w-44 gap-1 rounded-md border border-[#d9ded6] bg-white p-1.5 shadow-lg">{ADMIN_SALES_AVAILABILITY_STATUSES.map((status) => <button key={status} className="rounded px-2 py-2 text-left text-xs hover:bg-[#f2f5f1]" type="button" disabled={status === unit.sale_status} onClick={() => prepareAction({ kind: "sales", target: status, unitIds: [unit.id] })}>{saleStatusLabel(status)}</button>)}</div></details>}
                  </div>
                </div>
                <div>
                  <p className="text-[11px] font-bold uppercase text-[#617169]">Rental portfolio</p>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <span className={`rounded-full border px-2.5 py-1 text-xs font-bold ${rental === "active" ? "border-[#bfd8df] bg-[#eef8fa] text-[#315f6a]" : "border-[#d9ded6] bg-[#f2f4f0] text-[#617169]"}`}>{operationalRentalStatusLabel(rental)}</span>
                    <AllocationAction icon={rental === "active" ? <CircleMinus size={16} aria-hidden /> : <CirclePlus size={16} aria-hidden />} disabled={!rentalAvailability.enabled} title={rentalAvailability.reason} onClick={() => prepareAction({ ...rentalAction, unitIds: [unit.id] })}>{rental === "active" ? "Remove" : "Add"}</AllocationAction>
                    {(unit.rental_portfolio_status === "active" || unit.rental_portfolio_status === "exited") && <AllocationAction icon={<ExternalLink size={16} aria-hidden />} onClick={() => onOpenRentalFile(unit)}>Open file</AllocationAction>}
                  </div>
                </div>
                <div>
                  <p className="text-[11px] font-bold uppercase text-[#617169]">Sale workflow</p>
                  {workflowBlocksAllocation ? <button className="snag-action-link mt-1" type="button" onClick={() => onOpenSaleFile(unit)}>{saleWorkflowLabel(attempt)}</button> : <p className="mt-1 text-sm text-[#617169]">Not started</p>}
                </div>
              </div>
            </article>
          );
        })}
      </div>

      <div className="mt-4 flex flex-col gap-3 text-sm text-[#617169] sm:flex-row sm:items-center sm:justify-between">
        <span>Showing {filteredUnits.length === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1}-{Math.min(currentPage * PAGE_SIZE, filteredUnits.length)} of {filteredUnits.length}</span>
        <div className="flex gap-2"><button className="secondary" type="button" disabled={currentPage <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>Previous</button><button className="secondary" type="button" disabled={currentPage >= pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))}>Next</button></div>
      </div>

      {pendingAction && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/55 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !isSaving) setPendingAction(null); }}>
          <div className="w-full max-w-lg rounded-xl border border-[#d9ded6] bg-white p-5 shadow-xl" role="dialog" aria-modal="true" aria-labelledby="allocation-confirm-title">
            <h3 id="allocation-confirm-title" className="text-xl font-bold text-[#0F3D2E]">Confirm allocation change</h3>
            <p className="mt-2 text-sm text-[#34413a]">{actionDescription}</p>
            <p className="mt-3 rounded-md bg-[#fbf8ef] p-3 text-xs text-[#765a18]">The full selection will succeed together or no units will be changed. One audit event will be recorded per changed unit.</p>
            <div className="mt-5 flex justify-end gap-2"><button className="secondary" type="button" disabled={isSaving} onClick={() => setPendingAction(null)}>Cancel</button><button className="primary" type="button" disabled={isSaving} onClick={() => void applyAction()}>{isSaving ? "Applying…" : "Confirm change"}</button></div>
          </div>
        </div>
      )}
    </section>
  );
}
