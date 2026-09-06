import type { Building, BuildingFloor, RentalPortfolioStatus, Unit, UnitSaleStatus } from "../data/production.ts";

export const SALES_ROUTE_STATUSES = ["for_sale", "reserved", "exchanged", "completed", "handed_over"] as const satisfies readonly UnitSaleStatus[];
export const ADMIN_SALES_AVAILABILITY_STATUSES = ["not_released", "not_for_sale", "for_sale"] as const satisfies readonly UnitSaleStatus[];

const salesRouteStatuses = new Set<UnitSaleStatus>(SALES_ROUTE_STATUSES);
const administrativeSalesStatuses = new Set<UnitSaleStatus>(ADMIN_SALES_AVAILABILITY_STATUSES);

export const SALE_STATUS_LABELS: Record<UnitSaleStatus, string> = {
  not_released: "Not released",
  not_for_sale: "Retained / not for sale",
  for_sale: "For sale",
  reserved: "Reserved",
  exchanged: "Exchanged",
  completed: "Completed",
  handed_over: "Handed over",
};

export const RENTAL_PORTFOLIO_STATUS_LABELS: Record<RentalPortfolioStatus, string> = {
  not_in_portfolio: "Not in rental portfolio",
  active: "Rental portfolio",
  exited: "Exited rental portfolio",
};

export type UnitAllocationAttempt = {
  id: string;
  unit_id: string;
  workflow_status: string;
  is_active: boolean;
  blocks_allocation: boolean;
};

export type UnitAllocationAction =
  | { kind: "sales"; target: Extract<UnitSaleStatus, "not_released" | "not_for_sale" | "for_sale"> }
  | { kind: "rental"; target: "active" | "exited" };

export type UnitAllocationActionAvailability = {
  enabled: boolean;
  reason?: string;
};

const saleWorkflowLabels: Record<string, string> = {
  draft: "Sale preparation",
  awaiting_approval: "Reservation submitted",
  reservation_submitted: "Reservation submitted",
  reservation_query_raised: "Reservation query",
  approved: "Reservation approved",
  reservation_approved: "Reservation approved",
  rejected: "Reservation rejected",
  awaiting_commercial_approval: "Commercial approval",
  ready_for_exchange: "Ready for exchange",
  exchanged: "Exchanged",
  completion_pending: "Completion pending",
  completed: "Completed",
};

export function isSalesRouteStatus(status: UnitSaleStatus | string): status is UnitSaleStatus {
  return salesRouteStatuses.has(status as UnitSaleStatus);
}

export function isSalesRouteUnit(unit: Pick<Unit, "sale_status">) {
  return isSalesRouteStatus(unit.sale_status);
}

export function canCreateSaleAttempt(status: UnitSaleStatus | string) {
  return status === "for_sale";
}

export function isBlockingSaleWorkflow(attempt: UnitAllocationAttempt | undefined) {
  return Boolean(attempt?.is_active && attempt.blocks_allocation);
}

export function saleWorkflowLabel(attempt: UnitAllocationAttempt | undefined) {
  if (!isBlockingSaleWorkflow(attempt)) return "Not started";
  return saleWorkflowLabels[attempt?.workflow_status ?? ""] ?? "Sales workflow in progress";
}

export function saleStatusLabel(status: UnitSaleStatus) {
  return SALE_STATUS_LABELS[status];
}

export function rentalPortfolioStatusLabel(status: RentalPortfolioStatus) {
  return RENTAL_PORTFOLIO_STATUS_LABELS[status];
}

export function sortUnitsByBuildingFloorOrder<T extends Pick<Unit, "building_id" | "floor" | "unit_number">>(
  units: T[],
  buildingFloors: Array<Pick<BuildingFloor, "building_id" | "name" | "sort_order">>,
  buildings: Array<Pick<Building, "id">>,
) {
  const buildingOrder = new Map(buildings.map((building, index) => [building.id, index]));
  const floorOrder = new Map(
    buildingFloors.map((floor) => [
      `${floor.building_id}:${floor.name.trim().toLowerCase()}`,
      floor.sort_order,
    ]),
  );

  return [...units].sort((a, b) => {
    const aBuildingOrder = buildingOrder.get(a.building_id) ?? Number.MAX_SAFE_INTEGER;
    const bBuildingOrder = buildingOrder.get(b.building_id) ?? Number.MAX_SAFE_INTEGER;
    if (aBuildingOrder !== bBuildingOrder) return aBuildingOrder - bBuildingOrder;
    if (a.building_id !== b.building_id) return a.building_id.localeCompare(b.building_id);

    const aFloorOrder = floorOrder.get(`${a.building_id}:${(a.floor ?? "").trim().toLowerCase()}`) ?? Number.MAX_SAFE_INTEGER;
    const bFloorOrder = floorOrder.get(`${b.building_id}:${(b.floor ?? "").trim().toLowerCase()}`) ?? Number.MAX_SAFE_INTEGER;
    if (aFloorOrder !== bFloorOrder) return aFloorOrder - bFloorOrder;

    return a.unit_number.localeCompare(b.unit_number, undefined, { numeric: true });
  });
}

export function validateSalesAvailabilityChange(
  unit: Pick<Unit, "unit_number" | "sale_status">,
  activeAttempt: UnitAllocationAttempt | undefined,
  target: UnitSaleStatus,
) {
  if (!administrativeSalesStatuses.has(target)) return "Choose a valid administrative sales availability.";
  if (isBlockingSaleWorkflow(activeAttempt)) {
    return `Unit ${unit.unit_number} has a sales workflow in progress. Resolve the sales workflow before changing its sales availability.`;
  }
  if (!administrativeSalesStatuses.has(unit.sale_status)) {
    return `Unit ${unit.unit_number} is ${saleStatusLabel(unit.sale_status)} and can only be changed through the formal sales workflow.`;
  }
  return null;
}

export function validateRentalPortfolioChange(
  unit: Pick<Unit, "unit_number" | "sale_status" | "rental_portfolio_status">,
  target: "active" | "exited",
) {
  if (target === "active" && !["not_for_sale", "for_sale", "reserved", "exchanged"].includes(unit.sale_status)) {
    return `Unit ${unit.unit_number} cannot enter the rental portfolio while its sales position is ${saleStatusLabel(unit.sale_status)}.`;
  }
  if (target === "exited" && unit.rental_portfolio_status !== "active") {
    return `Unit ${unit.unit_number} is not currently in the rental portfolio.`;
  }
  return null;
}

export function unitAllocationActionAvailability(
  units: Array<Pick<Unit, "id" | "unit_number" | "sale_status" | "rental_portfolio_status">>,
  attemptsByUnit: ReadonlyMap<string, UnitAllocationAttempt>,
  action: UnitAllocationAction,
): UnitAllocationActionAvailability {
  if (units.length === 0) return { enabled: false, reason: "Select at least one unit." };

  if (action.kind === "sales") {
    if (units.some((unit) => isBlockingSaleWorkflow(attemptsByUnit.get(unit.id)))) {
      return { enabled: false, reason: "Sales workflow in progress." };
    }
    if (units.some((unit) => !administrativeSalesStatuses.has(unit.sale_status))) {
      return { enabled: false, reason: "Managed through the formal sales workflow." };
    }
    if (units.every((unit) => unit.sale_status === action.target)) {
      return { enabled: false, reason: `Already ${saleStatusLabel(action.target).toLowerCase()}.` };
    }
    return { enabled: true };
  }

  const activeCount = units.filter((unit) => unit.rental_portfolio_status === "active").length;
  if (action.target === "active") {
    if (activeCount === units.length) return { enabled: false, reason: "Already in rental portfolio." };
    if (activeCount > 0) return { enabled: false, reason: "Selection includes units already in the rental portfolio." };
    const ineligible = units.find((unit) => !["not_for_sale", "for_sale", "reserved", "exchanged"].includes(unit.sale_status));
    if (ineligible) {
      return { enabled: false, reason: `Not eligible while unit is ${saleStatusLabel(ineligible.sale_status)}.` };
    }
    return { enabled: true };
  }

  if (activeCount === 0) return { enabled: false, reason: "Not in rental portfolio." };
  if (activeCount !== units.length) return { enabled: false, reason: "Selection includes units not in the rental portfolio." };
  return { enabled: true };
}

export function summariseUnitAllocation(units: Array<Pick<Unit, "sale_status" | "rental_portfolio_status">>) {
  return {
    total: units.length,
    notReleased: units.filter((unit) => unit.sale_status === "not_released").length,
    salesRoute: units.filter(isSalesRouteUnit).length,
    rentalPortfolio: units.filter((unit) => unit.rental_portfolio_status === "active").length,
    saleAndRental: units.filter((unit) => unit.rental_portfolio_status === "active" && isSalesRouteUnit(unit)).length,
    soldOrHandedOver: units.filter((unit) => unit.sale_status === "completed" || unit.sale_status === "handed_over").length,
  };
}
