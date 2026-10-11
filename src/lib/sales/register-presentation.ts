import type { RegisterAction, RegisterFilters, ResponsibilityFilter, SalesRegisterRow } from "./register";
import { deadlineState } from "../dashboard/dates";

export const INITIAL_REGISTER_FILTERS: RegisterFilters = { search: "", stage: "all", responsibility: "ours", page: 1 };

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
  // Preserve workflow dependency order, and count every matching action (not just the first two).
  return row.actions.filter(action => matchesResponsibility(action, filter));
}

export function sortSalesRegisterByUrgency(rows: SalesRegisterRow[], now: number) {
  const priority = (row: SalesRegisterRow) => {
    const actions = prominentActions(row, "ours");
    const deadlines = [row.keyDate?.deadline, ...actions.map(action => action.deadline)].filter(deadline => deadline && Number.isFinite(Date.parse(deadline.at)));
    const states = deadlines.map(deadline => deadlineState(deadline!, now));
    if (actions.some(action => action.urgent) || states.includes("overdue")) return 0;
    if (states.some(state => state === "today" || state === "soon")) return 1;
    return 2;
  };
  // The snapshot is already grouped by building, configured floor and natural unit order.
  // Keep that canonical order within each urgency tier, including after filtering.
  return rows.map((row, index) => ({ row, index, priority: priority(row) }))
    .sort((a, b) => a.priority - b.priority || a.index - b.index).map(({ row }) => row);
}

export function salesRegisterCount(total: number, responsibility: ResponsibilityFilter) {
  const sales = `${total} ${total === 1 ? "sale" : "sales"}`;
  return responsibility === "ours" ? `${sales} requiring your attention`
    : responsibility === "others" ? `${sales} awaiting other teams` : `${sales} across all teams`;
}
