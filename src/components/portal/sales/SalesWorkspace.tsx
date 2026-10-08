"use client";

import { useState, useSyncExternalStore, type ComponentProps } from "react";
import { SalesReservationWorkflow } from "./SalesReservationWorkflow";
import { ConveyancerSalesRegister } from "./ConveyancerSalesRegister";
import { INITIAL_REGISTER_FILTERS } from "@/lib/sales/register-presentation";

type Props = ComponentProps<typeof SalesReservationWorkflow>;
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
  const requested = new URLSearchParams(search).get("salesUnitId");
  if (requested && props.units.some(unit => unit.id === requested)) return <SalesReservationWorkflow {...props} />;
  return <ConveyancerSalesRegister key={props.buildingContextId} identity={`${props.user.id}:${props.profile!.role}:${props.profile!.organisation_id ?? ""}`}
    buildingId={props.buildingContextId} units={props.units} buildings={props.buildings} floors={props.buildingFloors}
    filters={filters} onFilters={setFilters} refreshKey={props.salesRefreshKey} requestedUnavailable={Boolean(requested)} />;
}
