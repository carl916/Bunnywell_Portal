import type { Unit } from "../data/production.ts";

export type TenancySourceType = "manual" | "spreadsheet_import" | "document" | "email";

export type UnitTenancy = {
  id: string;
  building_id: string;
  unit_id: string;
  tenant_name: string;
  tenancy_start_date: string;
  fixed_term_end_date: string | null;
  tenancy_end_date: string | null;
  monthly_rent: number;
  rent_due_day: number | null;
  deposit_amount: number | null;
  letting_agent_organisation_id: string | null;
  notes: string | null;
  source_type: TenancySourceType;
  source_reference: string | null;
  created_at: string;
  updated_at: string;
};

export type TenancyState = "scheduled" | "active" | "ended";

function dateValue(value: string) {
  return Date.parse(`${value.slice(0, 10)}T00:00:00Z`);
}

export function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

export function tenancyState(tenancy: Pick<UnitTenancy, "tenancy_start_date" | "tenancy_end_date">, today = todayDate()): TenancyState {
  if (tenancy.tenancy_start_date > today) return "scheduled";
  if (!tenancy.tenancy_end_date || tenancy.tenancy_end_date >= today) return "active";
  return "ended";
}

export function tenanciesOverlap(left: Pick<UnitTenancy, "tenancy_start_date" | "tenancy_end_date">, right: Pick<UnitTenancy, "tenancy_start_date" | "tenancy_end_date">) {
  const leftEnd = left.tenancy_end_date ?? "9999-12-31";
  const rightEnd = right.tenancy_end_date ?? "9999-12-31";
  return left.tenancy_start_date <= rightEnd && right.tenancy_start_date <= leftEnd;
}

export function voidDaysBetween(previousEndDate?: string | null, nextStartDate?: string | null) {
  if (!previousEndDate || !nextStartDate) return null;
  return Math.max(0, Math.round((dateValue(nextStartDate) - dateValue(previousEndDate)) / 86_400_000) - 1);
}

export function currentVoidDays(latestEndDate?: string | null, today = todayDate()) {
  if (!latestEndDate || latestEndDate >= today) return null;
  return Math.max(0, Math.round((dateValue(today) - dateValue(latestEndDate)) / 86_400_000));
}

export function rentChange(currentRent: number, previousRent?: number | null) {
  if (previousRent === null || previousRent === undefined) return null;
  const amount = currentRent - previousRent;
  return { amount, percentage: previousRent === 0 ? null : amount / previousRent };
}

export function orderedTenancies(tenancies: UnitTenancy[]) {
  return [...tenancies].sort((a, b) => a.tenancy_start_date.localeCompare(b.tenancy_start_date) || a.created_at.localeCompare(b.created_at));
}

export function activeTenancy(tenancies: UnitTenancy[], today = todayDate()) {
  return orderedTenancies(tenancies).reverse().find((tenancy) => tenancyState(tenancy, today) === "active") ?? null;
}

export function nextTenancy(tenancies: UnitTenancy[], today = todayDate()) {
  return orderedTenancies(tenancies).find((tenancy) => tenancyState(tenancy, today) === "scheduled") ?? null;
}

export function tenancyHistoryMetrics(tenancies: UnitTenancy[]) {
  const ordered = orderedTenancies(tenancies);
  return ordered.map((tenancy, index) => ({
    tenancy,
    voidDaysBefore: index === 0 ? null : voidDaysBetween(ordered[index - 1].tenancy_end_date, tenancy.tenancy_start_date),
    rentChange: rentChange(tenancy.monthly_rent, index === 0 ? null : ordered[index - 1].monthly_rent),
  }));
}

export function totalHistoricalVoidDays(tenancies: UnitTenancy[]) {
  return tenancyHistoryMetrics(tenancies).reduce((total, item) => total + (item.voidDaysBefore ?? 0), 0);
}

export function adjacentRentalUnits<T extends Pick<Unit, "id">>(units: T[], selectedUnitId: string) {
  const selectedIndex = units.findIndex((unit) => unit.id === selectedUnitId);
  if (selectedIndex < 0) return { previousUnit: null, nextUnit: null };
  return {
    previousUnit: selectedIndex > 0 ? units[selectedIndex - 1] : null,
    nextUnit: selectedIndex < units.length - 1 ? units[selectedIndex + 1] : null,
  };
}

export function rentalOccupancy(unit: Pick<Unit, "rental_portfolio_status">, tenancies: UnitTenancy[], today = todayDate()) {
  if (unit.rental_portfolio_status !== "active") return "not_in_portfolio" as const;
  return activeTenancy(tenancies, today) ? "occupied" as const : "void" as const;
}

export function tenancyEndingWithinDays(tenancy: UnitTenancy, days: number, today = todayDate()) {
  if (tenancyState(tenancy, today) !== "active" || !tenancy.fixed_term_end_date) return false;
  const difference = Math.round((dateValue(tenancy.fixed_term_end_date) - dateValue(today)) / 86_400_000);
  return difference >= 0 && difference <= days;
}

export function summariseRentals(units: Unit[], tenancies: UnitTenancy[], today = todayDate()) {
  const rentalUnits = units.filter((unit) => unit.rental_portfolio_status === "active");
  const activeByUnit = new Map(rentalUnits.map((unit) => [unit.id, activeTenancy(tenancies.filter((tenancy) => tenancy.unit_id === unit.id), today)]));
  const active = [...activeByUnit.values()].filter((tenancy): tenancy is UnitTenancy => Boolean(tenancy));
  const monthlyRentRoll = active.reduce((total, tenancy) => total + Number(tenancy.monthly_rent || 0), 0);
  return {
    rentalPortfolio: rentalUnits.length,
    occupied: active.length,
    void: rentalUnits.length - active.length,
    monthlyRentRoll,
    annualisedRentRoll: monthlyRentRoll * 12,
    saleAndRental: rentalUnits.filter((unit) => ["for_sale", "reserved", "exchanged", "completed", "handed_over"].includes(unit.sale_status)).length,
    endingWithin90Days: active.filter((tenancy) => tenancyEndingWithinDays(tenancy, 90, today)).length,
  };
}
