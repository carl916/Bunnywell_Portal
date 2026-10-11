"use client";

import { useSyncExternalStore, type ComponentProps } from "react";
import { SalesReservationWorkflow } from "./SalesReservationWorkflow";
import { ConveyancerSalesRegister } from "./ConveyancerSalesRegister";
import { useSalesRegister } from "./useSalesRegister";
import { isSalesRouteUnit } from "@/lib/units/commercial-allocation";
import { useSalesOverviewNavigation } from "./useSalesOverviewNavigation";
import { useSalesResultsSpace } from "./useSalesResultsSpace";

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
    : <SalesReservationWorkflow key={`${props.user.id}:${props.profile?.role}:${props.profile?.organisation_id ?? ""}:${props.accessScopeKey ?? ""}`} {...props} />;
}

function ConveyancerWorkspace(props: Props) {
  const search = useSyncExternalStore(subscribe, locationSnapshot, serverSnapshot);
  if (search === null) return <section className="panel" aria-busy="true">Loading Sales…</section>;
  // Reset before rendering on every known scope change, including All buildings.
  // URL refinements survive a sale visit; ordinary unit/status updates do not change membership.
  const scope = JSON.stringify([props.buildingContextId, props.accessScopeKey,
    props.buildings.map(b => [b.id, b.conveyancer_organisation_id ?? null]).sort(),
    props.units.map(u => [u.id, u.building_id]).sort()]);
  return <ScopedConveyancerWorkspace key={scope} {...props} search={search} />;
}

function ScopedConveyancerWorkspace({ search, ...props }: Props & {
  search: string;
}) {
  const requested = new URLSearchParams(search).get("salesUnitId");
  // Resolve from authorised portal metadata before mounting or issuing any detail read.
  const selectedUnit = props.units.find(unit => unit.id === requested && isSalesRouteUnit(unit) && (!props.buildingContextId || unit.building_id === props.buildingContextId));
  const identity = `${props.user.id}:${props.profile!.role}:${props.profile!.organisation_id ?? ""}`;
  const register = useSalesRegister(identity, props.buildingContextId, !selectedUnit, props.salesRefreshKey);
  const overview = useSalesOverviewNavigation(true, Boolean(register.snapshot), selectedUnit?.id ?? "");
  const resultsSpace = useSalesResultsSpace(`${identity}:${props.buildingContextId}`);
  // Reset only the file on unit navigation. The register snapshot/filters retain
  // their existing owner; old file loads are invalidated by workflow cleanup.
  if (selectedUnit) return <SalesReservationWorkflow key={selectedUnit.id} {...props} conveyancerUnitId={selectedUnit.id} />;
  return <ConveyancerSalesRegister register={register} onRetry={register.retry}
    buildingId={props.buildingContextId} buildings={props.buildings}
    filters={{ ...overview.filters, responsibility: overview.filters.work }}
    onFilters={next => overview.update({ ...next, category: next.category ?? "", work: next.responsibility })}
    search={overview.search} onOpen={overview.open} resultsSpace={resultsSpace} requestedUnavailable={Boolean(requested)} />;
}
