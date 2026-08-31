import type { Unit } from "../data/production.ts";
import { activeTenancy, nextTenancy, orderedTenancies, rentChange, type UnitTenancy } from "./tenancies.ts";

export type RentalReportingPeriod = "lifetime" | "ytd" | "last_12_months";

export type RentalTenancyInput = Omit<UnitTenancy, "monthly_rent"> & { monthly_rent: number | null };
export type RentalUnitInput = Pick<Unit, "id" | "building_id" | "unit_number" | "sale_status" | "rental_portfolio_status">;

export type RentalVoidPeriod = {
  startDate: string;
  endDate: string;
  days: number;
  previousMonthlyRent: number | null;
  estimatedLoss: number | null;
  current: boolean;
};

export type RentMovement = {
  amount: number;
  percentage: number | null;
};

export type RentalUnitPerformance = {
  unit: RentalUnitInput;
  reportingPeriod: RentalReportingPeriod;
  reportingDate: string;
  measurementStart: string | null;
  measurementEnd: string;
  measuredAvailableDays: number;
  occupiedDays: number;
  voidDays: number;
  occupancyPercentage: number | null;
  voidPeriods: RentalVoidPeriod[];
  estimatedVoidLoss: number | null;
  hasUnknownVoidLoss: boolean;
  tenancyCount: number;
  tenancyChanges: number;
  firstTenancy: RentalTenancyInput | null;
  currentTenancy: RentalTenancyInput | null;
  nextTenancy: RentalTenancyInput | null;
  firstAchievedRent: number | null;
  currentRent: number | null;
  currentVsFirstRent: RentMovement | null;
  latestTenancyRentMovement: RentMovement | null;
  currentVoid: {
    startDate: string | null;
    days: number | null;
    previousMonthlyRent: number | null;
    estimatedLoss: number | null;
  } | null;
  upcomingFixedTermDays: number | null;
  coverage: {
    realTenantName: boolean;
    tenancyStart: boolean;
    currentRent: boolean;
    fixedTermEnd: boolean;
    rentDueDay: boolean;
    lettingAgent: boolean;
  };
};

export type RentalPortfolioPerformance = {
  reportingDate: string;
  reportingPeriod: RentalReportingPeriod;
  requestedPeriodStart: string | null;
  units: RentalUnitPerformance[];
  currentPosition: {
    rentalUnits: number;
    occupied: number;
    void: number;
    occupancyPercentage: number | null;
    monthlyRentRoll: number;
    annualisedRentRoll: number;
  };
  performance: {
    measuredAvailableDays: number;
    occupiedDays: number;
    voidDays: number;
    occupancyPercentage: number | null;
    estimatedVoidLoss: number | null;
    tenancyChanges: number;
    rentMovement: RentMovement | null;
    comparableUnits: number;
  };
  attention: {
    longestVoid: { unit: RentalUnitInput; period: RentalVoidPeriod } | null;
    largestRentReduction: { unit: RentalUnitInput; firstRent: number; currentRent: number; movement: RentMovement } | null;
    upcomingFixedTerms: { within30Days: number; within60Days: number; within90Days: number; recorded: number };
    currentVoids: Array<{ unit: RentalUnitInput; details: NonNullable<RentalUnitPerformance["currentVoid"]>; nextTenancy: RentalTenancyInput | null }>;
  };
  coverage: {
    total: number;
    realTenantName: number;
    tenancyStart: number;
    currentRent: number;
    fixedTermEnd: number;
    rentDueDay: number;
    lettingAgent: number;
  };
};

const DAY_MS = 86_400_000;
const placeholderTenantName = /^(?:tenant\s+\d+\s*\(name not supplied\)|tenant name not supplied|unknown tenant)$/i;

function dateValue(value: string) {
  return Date.parse(`${value.slice(0, 10)}T00:00:00Z`);
}

function isoDate(value: number | Date) {
  return new Date(value).toISOString().slice(0, 10);
}

function addDays(value: string, days: number) {
  return isoDate(dateValue(value) + days * DAY_MS);
}

function laterDate(left: string, right: string) {
  return left > right ? left : right;
}

function earlierDate(left: string, right: string) {
  return left < right ? left : right;
}

function inclusiveDays(start: string, end: string) {
  if (start > end) return 0;
  return Math.round((dateValue(end) - dateValue(start)) / DAY_MS) + 1;
}

function numberOrNull(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function isRealTenantName(value?: string | null) {
  return Boolean(value?.trim()) && !placeholderTenantName.test(value?.trim() ?? "");
}

export function reportingPeriodStart(period: RentalReportingPeriod, reportingDate: string) {
  if (period === "lifetime") return null;
  if (period === "ytd") return `${reportingDate.slice(0, 4)}-01-01`;
  const date = new Date(`${reportingDate}T00:00:00Z`);
  const previousYear = date.getUTCFullYear() - 1;
  const month = date.getUTCMonth();
  const lastDayInMonth = new Date(Date.UTC(previousYear, month + 1, 0)).getUTCDate();
  const anniversary = Date.UTC(previousYear, month, Math.min(date.getUTCDate(), lastDayInMonth));
  return isoDate(anniversary + DAY_MS);
}

export function rentalReportingPeriodLabel(period: RentalReportingPeriod) {
  if (period === "ytd") return "Year to date";
  if (period === "last_12_months") return "Last 12 months";
  return "Since first recorded tenancy";
}

function occupiedIntervals(tenancies: RentalTenancyInput[], measurementStart: string, reportingDate: string) {
  const intervals = tenancies
    .filter((tenancy) => tenancy.tenancy_start_date <= reportingDate && (!tenancy.tenancy_end_date || tenancy.tenancy_end_date >= measurementStart))
    .map((tenancy) => ({
      start: laterDate(tenancy.tenancy_start_date, measurementStart),
      end: earlierDate(tenancy.tenancy_end_date ?? reportingDate, reportingDate),
    }))
    .filter((interval) => interval.start <= interval.end)
    .sort((left, right) => left.start.localeCompare(right.start));

  const merged: Array<{ start: string; end: string }> = [];
  for (const interval of intervals) {
    const previous = merged.at(-1);
    if (previous && interval.start <= addDays(previous.end, 1)) {
      previous.end = interval.end > previous.end ? interval.end : previous.end;
    } else {
      merged.push({ ...interval });
    }
  }
  return merged;
}

function selectedVoidPeriods(tenancies: RentalTenancyInput[], measurementStart: string, reportingDate: string) {
  const ordered = orderedTenancies(tenancies as UnitTenancy[]) as RentalTenancyInput[];
  const periods: RentalVoidPeriod[] = [];
  for (let index = 0; index < ordered.length; index += 1) {
    const previous = ordered[index];
    if (!previous.tenancy_end_date || previous.tenancy_end_date >= reportingDate) continue;
    const next = ordered[index + 1] ?? null;
    const rawStart = addDays(previous.tenancy_end_date, 1);
    const rawEnd = next ? earlierDate(addDays(next.tenancy_start_date, -1), reportingDate) : reportingDate;
    if (rawStart > rawEnd) continue;
    const startDate = laterDate(rawStart, measurementStart);
    const endDate = earlierDate(rawEnd, reportingDate);
    if (startDate > endDate) continue;
    const days = inclusiveDays(startDate, endDate);
    const previousMonthlyRent = numberOrNull(previous.monthly_rent);
    periods.push({
      startDate,
      endDate,
      days,
      previousMonthlyRent,
      estimatedLoss: previousMonthlyRent === null ? null : previousMonthlyRent * 12 / 365 * days,
      current: rawEnd === reportingDate && (!next || next.tenancy_start_date > reportingDate),
    });
  }
  return periods;
}

export function calculateUnitRentalPerformance(
  unit: RentalUnitInput,
  tenancies: RentalTenancyInput[],
  reportingDate: string,
  reportingPeriod: RentalReportingPeriod = "lifetime",
): RentalUnitPerformance {
  const ordered = orderedTenancies(tenancies as UnitTenancy[]) as RentalTenancyInput[];
  const firstTenancy = ordered[0] ?? null;
  const requestedStart = reportingPeriodStart(reportingPeriod, reportingDate);
  const measurementStart = firstTenancy && firstTenancy.tenancy_start_date <= reportingDate
    ? requestedStart ? laterDate(firstTenancy.tenancy_start_date, requestedStart) : firstTenancy.tenancy_start_date
    : null;
  const measuredAvailableDays = measurementStart ? inclusiveDays(measurementStart, reportingDate) : 0;
  const intervals = measurementStart ? occupiedIntervals(ordered, measurementStart, reportingDate) : [];
  const occupiedDays = intervals.reduce((total, interval) => total + inclusiveDays(interval.start, interval.end), 0);
  const voidDays = Math.max(0, measuredAvailableDays - occupiedDays);
  const voidPeriods = measurementStart ? selectedVoidPeriods(ordered, measurementStart, reportingDate) : [];
  const knownVoidLosses = voidPeriods.filter((period) => period.estimatedLoss !== null);
  const hasUnknownVoidLoss = voidPeriods.some((period) => period.estimatedLoss === null);
  const estimatedVoidLoss = !firstTenancy
    ? null
    : hasUnknownVoidLoss
      ? null
      : knownVoidLosses.reduce((total, period) => total + (period.estimatedLoss ?? 0), 0);
  const currentTenancy = activeTenancy(ordered as UnitTenancy[], reportingDate) as RentalTenancyInput | null;
  const scheduledTenancy = nextTenancy(ordered as UnitTenancy[], reportingDate) as RentalTenancyInput | null;
  const firstAchievedRent = firstTenancy ? numberOrNull(firstTenancy.monthly_rent) : null;
  const currentRent = currentTenancy ? numberOrNull(currentTenancy.monthly_rent) : null;
  const currentVsFirstRent = currentRent === null || firstAchievedRent === null
    ? null
    : { amount: currentRent - firstAchievedRent, percentage: firstAchievedRent === 0 ? null : (currentRent - firstAchievedRent) / firstAchievedRent };
  const currentIndex = currentTenancy ? ordered.findIndex((tenancy) => tenancy.id === currentTenancy.id) : -1;
  const previousRent = currentIndex > 0 ? numberOrNull(ordered[currentIndex - 1].monthly_rent) : null;
  const latestTenancyRentMovement = currentRent === null || previousRent === null ? null : rentChange(currentRent, previousRent);
  const latestEnded = [...ordered].reverse().find((tenancy) => tenancy.tenancy_end_date && tenancy.tenancy_end_date < reportingDate) ?? null;
  const currentVoid = currentTenancy ? null : latestEnded?.tenancy_end_date
    ? {
      startDate: addDays(latestEnded.tenancy_end_date, 1),
      days: inclusiveDays(addDays(latestEnded.tenancy_end_date, 1), reportingDate),
      previousMonthlyRent: numberOrNull(latestEnded.monthly_rent),
      estimatedLoss: numberOrNull(latestEnded.monthly_rent) === null ? null : Number(latestEnded.monthly_rent) * 12 / 365 * inclusiveDays(addDays(latestEnded.tenancy_end_date, 1), reportingDate),
    }
    : { startDate: null, days: null, previousMonthlyRent: null, estimatedLoss: null };
  const upcomingFixedTermDays = currentTenancy?.fixed_term_end_date && currentTenancy.fixed_term_end_date >= reportingDate
    ? Math.round((dateValue(currentTenancy.fixed_term_end_date) - dateValue(reportingDate)) / DAY_MS)
    : null;

  return {
    unit,
    reportingPeriod,
    reportingDate,
    measurementStart,
    measurementEnd: reportingDate,
    measuredAvailableDays,
    occupiedDays,
    voidDays,
    occupancyPercentage: measuredAvailableDays ? occupiedDays / measuredAvailableDays : null,
    voidPeriods,
    estimatedVoidLoss,
    hasUnknownVoidLoss,
    tenancyCount: ordered.length,
    tenancyChanges: Math.max(ordered.length - 1, 0),
    firstTenancy,
    currentTenancy,
    nextTenancy: scheduledTenancy,
    firstAchievedRent,
    currentRent,
    currentVsFirstRent,
    latestTenancyRentMovement,
    currentVoid,
    upcomingFixedTermDays,
    coverage: {
      realTenantName: isRealTenantName(currentTenancy?.tenant_name),
      tenancyStart: Boolean(currentTenancy?.tenancy_start_date),
      currentRent: currentRent !== null,
      fixedTermEnd: Boolean(currentTenancy?.fixed_term_end_date),
      rentDueDay: currentTenancy?.rent_due_day !== null && currentTenancy?.rent_due_day !== undefined,
      lettingAgent: Boolean(currentTenancy?.letting_agent_organisation_id),
    },
  };
}

export function calculateRentalPerformance(
  units: RentalUnitInput[],
  tenancies: RentalTenancyInput[],
  options: { reportingDate: string; reportingPeriod?: RentalReportingPeriod },
): RentalPortfolioPerformance {
  const reportingPeriod = options.reportingPeriod ?? "lifetime";
  const activeUnits = units.filter((unit) => unit.rental_portfolio_status === "active");
  const unitResults = activeUnits.map((unit) => calculateUnitRentalPerformance(
    unit,
    tenancies.filter((tenancy) => tenancy.unit_id === unit.id),
    options.reportingDate,
    reportingPeriod,
  ));
  const occupied = unitResults.filter((result) => result.currentTenancy);
  const monthlyRentRoll = occupied.reduce((total, result) => total + (result.currentRent ?? 0), 0);
  const measuredAvailableDays = unitResults.reduce((total, result) => total + result.measuredAvailableDays, 0);
  const occupiedDays = unitResults.reduce((total, result) => total + result.occupiedDays, 0);
  const voidDays = unitResults.reduce((total, result) => total + result.voidDays, 0);
  const measuredUnits = unitResults.filter((result) => result.measurementStart !== null);
  const hasUnknownVoidLoss = measuredUnits.some((result) => result.hasUnknownVoidLoss);
  const comparables = occupied.filter((result) => result.firstAchievedRent !== null && result.currentRent !== null);
  const firstComparableRent = comparables.reduce((total, result) => total + (result.firstAchievedRent ?? 0), 0);
  const currentComparableRent = comparables.reduce((total, result) => total + (result.currentRent ?? 0), 0);
  const rentMovement = comparables.length === 0 ? null : {
    amount: currentComparableRent - firstComparableRent,
    percentage: firstComparableRent === 0 ? null : (currentComparableRent - firstComparableRent) / firstComparableRent,
  };
  const longestVoid = unitResults
    .flatMap((result) => result.voidPeriods.map((period) => ({ unit: result.unit, period })))
    .sort((left, right) => right.period.days - left.period.days)[0] ?? null;
  const largestRentReduction = unitResults
    .filter((result) => result.currentVsFirstRent && result.currentVsFirstRent.amount < 0 && result.firstAchievedRent !== null && result.currentRent !== null)
    .sort((left, right) => (left.currentVsFirstRent?.amount ?? 0) - (right.currentVsFirstRent?.amount ?? 0))
    .map((result) => ({ unit: result.unit, firstRent: result.firstAchievedRent as number, currentRent: result.currentRent as number, movement: result.currentVsFirstRent as RentMovement }))[0] ?? null;
  const upcoming = unitResults.map((result) => result.upcomingFixedTermDays).filter((days): days is number => days !== null);

  return {
    reportingDate: options.reportingDate,
    reportingPeriod,
    requestedPeriodStart: reportingPeriodStart(reportingPeriod, options.reportingDate),
    units: unitResults,
    currentPosition: {
      rentalUnits: unitResults.length,
      occupied: occupied.length,
      void: unitResults.length - occupied.length,
      occupancyPercentage: unitResults.length ? occupied.length / unitResults.length : null,
      monthlyRentRoll,
      annualisedRentRoll: monthlyRentRoll * 12,
    },
    performance: {
      measuredAvailableDays,
      occupiedDays,
      voidDays,
      occupancyPercentage: measuredAvailableDays ? occupiedDays / measuredAvailableDays : null,
      estimatedVoidLoss: measuredUnits.length === 0 || hasUnknownVoidLoss
        ? null
        : measuredUnits.reduce((total, result) => total + (result.estimatedVoidLoss ?? 0), 0),
      tenancyChanges: unitResults.reduce((total, result) => total + result.tenancyChanges, 0),
      rentMovement,
      comparableUnits: comparables.length,
    },
    attention: {
      longestVoid,
      largestRentReduction,
      upcomingFixedTerms: {
        within30Days: upcoming.filter((days) => days <= 30).length,
        within60Days: upcoming.filter((days) => days <= 60).length,
        within90Days: upcoming.filter((days) => days <= 90).length,
        recorded: upcoming.length,
      },
      currentVoids: unitResults.filter((result) => result.currentVoid).map((result) => ({ unit: result.unit, details: result.currentVoid as NonNullable<RentalUnitPerformance["currentVoid"]>, nextTenancy: result.nextTenancy })),
    },
    coverage: {
      total: unitResults.length,
      realTenantName: unitResults.filter((result) => result.coverage.realTenantName).length,
      tenancyStart: unitResults.filter((result) => result.coverage.tenancyStart).length,
      currentRent: unitResults.filter((result) => result.coverage.currentRent).length,
      fixedTermEnd: unitResults.filter((result) => result.coverage.fixedTermEnd).length,
      rentDueDay: unitResults.filter((result) => result.coverage.rentDueDay).length,
      lettingAgent: unitResults.filter((result) => result.coverage.lettingAgent).length,
    },
  };
}
