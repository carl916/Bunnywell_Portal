import type { RegisterAction, RegisterFilters, ResponsibilityFilter, SalesRegisterRow } from "./register";

export const INITIAL_REGISTER_FILTERS: RegisterFilters = { search: "", stage: "all", responsibility: "all", page: 1 };

export function matchesResponsibility(action: RegisterAction, filter: ResponsibilityFilter) {
  if (filter === "all") return true;
  // Unknown external organisations are unallocated, not an invented other team.
  const allocated = action.party.kind === "developer" || Boolean(action.party.organisationId);
  return allocated && (filter === "ours" ? action.ours : !action.ours);
}

export function filterSalesRegister(rows: SalesRegisterRow[], filters: RegisterFilters) {
  const search = filters.search.trim().toLocaleLowerCase("en-GB");
  return rows.filter(row => (filters.stage === "all" || row.stage === filters.stage)
    && (!search || `${row.unitNumber} ${row.buildingName}`.toLocaleLowerCase("en-GB").includes(search))
    && (filters.responsibility === "all" || row.actions.some(action => matchesResponsibility(action, filters.responsibility))));
}

export function prominentActions(row: SalesRegisterRow, filter: ResponsibilityFilter) {
  return row.actions.filter(action => matchesResponsibility(action, filter)).slice(0, 2);
}
