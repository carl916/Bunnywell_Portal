import type { UnitSaleStatus } from "../data/production";
import { deriveDashboard } from "../dashboard/model";
import { deadlineState, formatWorkDate, londonDate } from "../dashboard/dates";
import type { DashboardInput, WorkDestination, WorkItem, WorkParty } from "../dashboard/types";
import { exchangeAuthorityState } from "./authority-state";
import { isSalesRouteUnit, sortUnitsByBuildingFloorOrder } from "../units/commercial-allocation";

export type ResponsibilityFilter = "all" | "ours" | "others";
export type RegisterAction = { id: string; label: string; party: WorkParty; ours: boolean; canAct: boolean; destination: WorkDestination | null };
export type RegisterDate = { label: string; actual: string; warning: boolean };
export type SalesRegisterRow = {
  unitId: string; unitNumber: string; buildingId: string; buildingName: string; stage: UnitSaleStatus;
  destination: WorkDestination; actions: RegisterAction[]; neutral: string; warning: string | null;
  keyDate: RegisterDate | null;
};
export type SalesRegisterSnapshot = {
  asOf: string; scope: { identity: string; buildingId: string; label: string; team: string };
  actionsAvailable: boolean; rows: SalesRegisterRow[];
};
export type RegisterFilters = { search: string; stage: string; responsibility: ResponsibilityFilter; page: number };

// Workflow dependencies take precedence over event age and incidental record-keeping work.
const order = ["sale_unit_reconciliation", "reservation_review", "reservation_correct", "commercial_review", "authority_request", "authority_follow_up", "exchange_progress", "notice_authority", "notice_request", "notice_arrangements", "notice_dates", "replace_completion_statement", "replace_draft_statement_of_account", "missing_completion_statement", "missing_draft_statement_of_account", "review_completion_statement", "review_draft_statement_of_account", "legal_completion"];

function label(item: WorkItem) {
  if (item.kind === "reservation_review") return `Reservation awaiting ${item.responsibility.label} approval`;
  if (item.kind === "exchange_progress") return "Awaiting exchange confirmation";
  if (item.kind === "legal_completion") return "Portal checks complete; completion not recorded";
  if (item.kind.startsWith("replace_")) return item.kind.endsWith("draft_statement_of_account") ? "Upload revised statement of account" : "Upload revised completion statement";
  if (item.kind.startsWith("review_")) return `${item.kind.endsWith("draft_statement_of_account") ? "Statement of account" : "Completion statement"} awaiting ${item.responsibility.label} approval`;
  return item.action;
}

/** Explicit non-financial response projection: never serialize the shared input or dashboard snapshot. */
export function deriveSalesRegister(input: DashboardInput): SalesRegisterSnapshot {
  const dashboard = deriveDashboard(input);
  const available = (key: string) => input.sources.some(source => source.key === key && source.state === "ready");
  const actionsAvailable = available("sales") && available("legal");
  const buildingMap = new Map(input.buildings.filter(b => !input.buildingId || b.id === input.buildingId).map(b => [b.id, b]));
  const units = sortUnitsByBuildingFloorOrder(input.units.filter(u => buildingMap.has(u.building_id) && isSalesRouteUnit(u)), input.floors, [...buildingMap.values()]);
  const rows = units.map((unit): SalesRegisterRow => {
    const sales = input.sales.filter(s => s.unit_id === unit.id && s.is_active && !s.redacted_at && !["fallen_through", "superseded", "failed", "withdrawn"].includes(s.workflow_status));
    const sale = sales.length === 1 ? sales[0] : undefined;
    const completed = Boolean(sale?.legal_completed_at || sale?.completed_at || sale?.workflow_status === "completed");
    const exchanged = Boolean(sale?.exchanged_at || completed);
    const destination: WorkDestination = { screen: "sales", buildingId: unit.building_id, unitId: unit.id, ...(sale ? { saleId: sale.id } : {}) };
    const warning = sales.length > 1 ? "Multiple active sale attempts; review the sale file"
      : sale && (completed && !["completed", "handed_over"].includes(unit.sale_status) || !completed && exchanged && unit.sale_status !== "exchanged" || !completed && ["completed", "handed_over"].includes(unit.sale_status) || !exchanged && ["exchanged"].includes(unit.sale_status)) ? "Sale attempt and unit stage disagree; review the sale file" : null;
    const items = sale && actionsAvailable ? dashboard.items.filter(item => item.recordKey === `sale:${sale.id}` && order.includes(item.kind)).sort((a,b) => order.indexOf(a.kind) - order.indexOf(b.kind)) : [];
    const actions: RegisterAction[] = [];
    for (const item of items) {
      // Related current-version document reviews share one destination in the existing package.
      const reviews = items.filter(other => other.kind.startsWith("review_") && other.responsibility.kind === item.responsibility.kind && other.responsibility.organisationId === item.responsibility.organisationId);
      if (item.kind.startsWith("review_") && reviews.length > 1 && item !== reviews[0]) continue;
      const documentType = ["completion_statement", "draft_statement_of_account"].find(type => item.kind.endsWith(type));
      const groupedReviews = item.kind.startsWith("review_") && reviews.length > 1;
      actions.push({ id: item.id, label: groupedReviews ? `Review completion documents (${reviews.length})` : label(item), party: item.responsibility, ours: item.ours, canAct: item.canAct,
        destination: item.destination && documentType && !groupedReviews ? { ...item.destination, anchor: `completion-document-${documentType}` } : item.destination });
    }
    let keyDate: RegisterDate | null = null;
    if (sale && available("sales") && !completed) {
      if (exchanged && sale.contractual_completion_date) {
        const actual = formatWorkDate(sale.contractual_completion_date, "date");
        const state = deadlineState({ at: sale.contractual_completion_date, precision: "date", basis: "Completion" }, input.now);
        keyDate = { actual, label: state === "overdue" ? "Completion date passed; completion not recorded" : state === "today" ? "Completion due today" : `Completion due ${actual}`, warning: ["overdue", "today", "soon"].includes(state) };
      } else if (!exchanged && available("legal")) {
        const authority = exchangeAuthorityState(input.authorities.filter(a => a.sale_attempt_id === sale.id), [], sale.authority_requested_at, false, input.now);
        const current = authority.current;
        if (current?.expires_at && !current.replaced_by && !current.revoked_at && authority.issued) {
          const state = deadlineState({ at: current.expires_at, precision: "instant", basis: "Authority" }, input.now);
          const actual = formatWorkDate(current.expires_at);
          keyDate = { actual, label: state === "overdue" ? "Authority expired" : londonDate(new Date(current.expires_at)) === londonDate(input.now) ? "Authority expires today" : `Authority expires ${actual}`, warning: state !== "future" };
        }
      }
    }
    return { unitId: unit.id, unitNumber: unit.unit_number, buildingId: unit.building_id, buildingName: buildingMap.get(unit.building_id)!.name, stage: unit.sale_status, destination, actions, warning, keyDate,
      neutral: !actionsAvailable ? "Next steps unavailable" : sales.length > 1 ? "Review active sale attempts" : completed || ["completed", "handed_over"].includes(unit.sale_status) ? "No outstanding legal progression" : !sale ? "No active sale" : sale.workflow_status === "draft" ? "Reservation in preparation" : "No outstanding progression action recorded" };
  });
  return { asOf: dashboard.asOf, scope: dashboard.scope, actionsAvailable, rows };
}
