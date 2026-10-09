"use client";

import { useState, useSyncExternalStore, type ComponentProps } from "react";
import { SalesReservationWorkflow } from "./SalesReservationWorkflow";
import { ConveyancerSalesRegister } from "./ConveyancerSalesRegister";
import { INITIAL_REGISTER_FILTERS } from "@/lib/sales/register-presentation";
import type { RegisterFilters } from "@/lib/sales/register";
import { useSalesRegister } from "./useSalesRegister";
import { isSalesRouteUnit } from "@/lib/units/commercial-allocation";

type Props = Omit<ComponentProps<typeof SalesReservationWorkflow>, "conveyancerUnitId"> & { accessScopeKey?: string | null };
const subscribe = (notify: () => void) => {
  window.addEventListener("popstate", notify);
  window.addEventListener("conveyancer-sale-navigation", notify);
  return () => { window.removeEventListener("popstate", notify); window.removeEventListener("conveyancer-sale-navigation", notify); };
};
const locationSnapshot = () => window.location.search;
const serverSnapshot = () => null;

export function SalesWorkspace(props: Props) {
  return props.profile?.role === "conveyancer"
    ? <ConveyancerWorkspace key={`${props.user.id}:${props.profile.role}:${props.profile.organisation_id ?? ""}`} {...props} />
    : <SalesReservationWorkflow {...props} />;
}

function ConveyancerWorkspace(props: Props) {
  const search = useSyncExternalStore(subscribe, locationSnapshot, serverSnapshot);
  // Memory only: maintained while visiting a sale, discarded on logout/identity change or a fresh visit.
  const [filters, setFilters] = useState(INITIAL_REGISTER_FILTERS);
  if (search === null) return <section className="panel" aria-busy="true">Loading Sales…</section>;
  // Reset before rendering on every known scope change, including All buildings.
  // Filters remain in this parent; ordinary unit/status updates do not change membership.
  const scope = JSON.stringify([props.buildingContextId, props.accessScopeKey,
    props.buildings.map(b => [b.id, b.conveyancer_organisation_id ?? null]).sort(),
    props.units.map(u => [u.id, u.building_id]).sort()]);
  return <ScopedConveyancerWorkspace key={scope} {...props} search={search} filters={filters} onFilters={setFilters} />;
}

function ScopedConveyancerWorkspace({ search, filters, onFilters, ...props }: Props & {
  search: string; filters: RegisterFilters; onFilters: (filters: RegisterFilters) => void;
}) {
  const requested = new URLSearchParams(search).get("salesUnitId");
  // Resolve from authorised portal metadata before mounting or issuing any detail read.
  const selectedUnit = props.units.find(unit => unit.id === requested && isSalesRouteUnit(unit) && (!props.buildingContextId || unit.building_id === props.buildingContextId));
  const identity = `${props.user.id}:${props.profile!.role}:${props.profile!.organisation_id ?? ""}`;
  const register = useSalesRegister(identity, props.buildingContextId, !selectedUnit, props.salesRefreshKey);
  // Reset only the file on unit navigation. The register snapshot/filters retain
  // their existing owner; old file loads are invalidated by workflow cleanup.
  if (selectedUnit) return <SalesReservationWorkflow key={selectedUnit.id} {...props} conveyancerUnitId={selectedUnit.id} />;
  return <ConveyancerSalesRegister register={register}
    buildingId={props.buildingContextId} units={props.units} buildings={props.buildings} floors={props.buildingFloors}
    filters={filters} onFilters={onFilters} requestedUnavailable={Boolean(requested)} />;
}
