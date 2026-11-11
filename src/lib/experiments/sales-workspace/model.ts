import { calculateAgentInvoicePreview } from "@/lib/sales/commercial-model";
import { calculateMilestoneFee, deriveInvoicePaymentPosition } from "@/lib/sales/agent-fees";
import { sortUnitsByBuildingFloorOrder } from "@/lib/units/commercial-allocation";

export const prototypePath = "/dev/sales-workspace";
export const sections = [
  { id: "reservation", label: "Reservation", group: "Progression" },
  { id: "exchange", label: "Exchange", group: "Progression" },
  { id: "completion", label: "Completion", group: "Progression" },
  { id: "handover", label: "Handover", group: "Progression" },
  { id: "deposits", label: "Deposits", group: "Financials" },
  { id: "agent-fees", label: "Agent Fees", group: "Financials" },
  { id: "commercial", label: "Commercial Terms", group: "Commercial" },
] as const;
export type Section = typeof sections[number]["id"];
export const roles = { developer: "Developer", sales_agent: "Sales agent", conveyancer: "Conveyancer" } as const;
export type Role = keyof typeof roles;
export const scenarios = [
  { id: "completion-review", label: "Completion · awaiting review", section: "completion", role: "developer", status: "Exchanged" },
  { id: "completion-query", label: "Completion · document queried", section: "completion", role: "conveyancer", status: "Exchanged" },
  { id: "completion-completed", label: "Completion · legally completed", section: "completion", role: "developer", status: "Completed" },
  { id: "fees-submit", label: "Agent fees · awaiting invoice", section: "agent-fees", role: "sales_agent", status: "Reserved" },
  { id: "fees-review", label: "Agent fees · awaiting review", section: "agent-fees", role: "developer", status: "Reserved" },
  { id: "fees-paid", label: "Agent fees · credits & part payment", section: "agent-fees", role: "developer", status: "Exchanged" },
  { id: "reservation-draft", label: "Reservation · draft", section: "reservation", role: "sales_agent", status: "For sale" },
  { id: "reservation-review", label: "Reservation · awaiting approval", section: "reservation", role: "developer", status: "For sale" },
  { id: "reservation-approved", label: "Reservation · approved", section: "reservation", role: "developer", status: "Reserved" },
] as const;
export type Scenario = typeof scenarios[number];
export const buildings = [{ id: "willow", name: "Willow Court", address: "Garden Lane, St Albans" }, { id: "orchard", name: "Orchard House", address: "Orchard Road, Harpenden" }, { id: "cedar", name: "Cedar Place", address: "Cedar Avenue, Welwyn" }];
const floors = buildings.flatMap(building => ["Lower Ground", "Ground", "First", "Second", "Third"].map((name, sort_order) => ({ building_id: building.id, name, sort_order })));
export const units = sortUnitsByBuildingFloorOrder([
  { id: "lg10", building_id: "willow", floor: "Lower Ground", unit_number: "LG10", buyer: "Alex Morgan", scenarioId: "completion-review" },
  { id: "lg2", building_id: "willow", floor: "Lower Ground", unit_number: "LG2", buyer: "Robin Ellis", scenarioId: "reservation-draft" },
  { id: "g11", building_id: "willow", floor: "Ground", unit_number: "G11", buyer: "Taylor Reed", scenarioId: "completion-query" },
  { id: "g2", building_id: "willow", floor: "Ground", unit_number: "G2", buyer: "Jamie Brooks", scenarioId: "reservation-approved" },
  { id: "102", building_id: "willow", floor: "First", unit_number: "102", buyer: "Charlie Lane", scenarioId: "fees-review" },
  { id: "101", building_id: "willow", floor: "First", unit_number: "101", buyer: "Sam Rivers", scenarioId: "fees-submit" },
  { id: "20", building_id: "willow", floor: "", unit_number: "20", buyer: "Drew Parker", scenarioId: "reservation-review" },
  { id: "orchard-g1", building_id: "orchard", floor: "Ground", unit_number: "G1", buyer: "Casey Green", scenarioId: "reservation-approved" },
  { id: "willow-lg11", building_id: "willow", floor: "Lower Ground", unit_number: "LG11", buyer: "Jordan Finch", scenarioId: "reservation-review" },
  { id: "willow-301", building_id: "willow", floor: "Third", unit_number: "301", buyer: "Avery Moss", scenarioId: "fees-paid" },
  { id: "orchard-g11", building_id: "orchard", floor: "Ground", unit_number: "G11", buyer: "Harper Stone", scenarioId: "reservation-approved" },
  { id: "orchard-lg11", building_id: "orchard", floor: "Lower Ground", unit_number: "LG11", buyer: "Morgan West", scenarioId: "completion-completed" },
  { id: "orchard-301", building_id: "orchard", floor: "Third", unit_number: "301", buyer: "Riley Lake", scenarioId: "reservation-draft" },
  { id: "cedar-g11", building_id: "cedar", floor: "Ground", unit_number: "G11", buyer: "Elliot Park", scenarioId: "fees-review" },
], floors, buildings);
export function unitScenario(unit: FixtureUnit) { return scenarios.find(s => s.id === unit.scenarioId)!; }
export const saleStages = ["For sale", "Reserved", "Exchanged", "Completed"] as const;
export function accessibleBuildings(profile: string) { return profile === "single" ? buildings.filter(b => b.id === "willow") : buildings; }
export type FixtureUnit = typeof units[number];
export const terms = { contractPrice: 425000, agentFeePercent: 1.5, vatRate: 20, reservationFee: 2000, reservationFeeHolder: "sales_agent", agentContribution: 500 };
export const exchangeFee = calculateAgentInvoicePreview(terms);
export const completionFee = calculateMilestoneFee({ salePrice: terms.contractPrice, feePercent: 0.5, vatRate: 20 });
export const partialPayment = { amount: 3000, payer_type: "solicitor", payment_source: "cash", voided_at: null };
export const paidPosition = deriveInvoicePaymentPosition({ cashAmountPayable: exchangeFee.expectedPayableAmount, reservationFeeHeld: terms.reservationFee, payments: [partialPayment] });
export type DocumentVersion = { id: string; file_name: string; is_current: boolean; redacted_at: null; date: string; note: string };
export type FixtureDocument = {
  id: string; document_type: string; title: string; status: string; approved_version_id: string | null;
  unit_sale_document_versions: DocumentVersion[]; query?: string;
};
// Immutable snapshots only. Selecting a scenario never advances a transaction.
export function completionDocuments(scenario: Scenario): FixtureDocument[] {
  const queried = scenario.id === "completion-query";
  const completed = scenario.status === "Completed";
  return [
    { id: "statement", document_type: "completion_statement", title: "Completion statement", status: completed ? "approved" : queried ? "query_raised" : "awaiting_approval", approved_version_id: completed ? "statement-v2" : null,
      query: queried ? "The service-charge apportionment uses 1 November. Please calculate it to the contractual completion date, 3 November." : undefined,
      unit_sale_document_versions: [
        { id: "statement-v2", file_name: "completion-statement-v2.pdf", is_current: true, redacted_at: null, date: "30 Oct 2026, 09:15", note: completed ? "Approved by Dana Miller · 2 Nov, 14:20" : queried ? "Query raised by Dana Miller · 2 Nov, 10:05" : "Uploaded by Jamie Ellis · conveyancer" },
        { id: "statement-v1", file_name: "completion-statement-v1.pdf", is_current: false, redacted_at: null, date: "27 Oct 2026, 11:20", note: "Superseded · missing service-charge breakdown" },
      ] },
    { id: "account", document_type: "draft_statement_of_account", title: "Statement of account", status: completed || queried ? "approved" : "awaiting_approval", approved_version_id: completed || queried ? "account-v1" : null,
      unit_sale_document_versions: [{ id: "account-v1", file_name: "statement-of-account-v1.pdf", is_current: true, redacted_at: null, date: "30 Oct 2026, 09:15", note: completed || queried ? "Approved by Dana Miller · 30 Oct, 15:40" : "Uploaded by Jamie Ellis · conveyancer" }] },
  ];
}
export type NavigationState = { section: Section; scenario: Scenario; role: Role; unit: FixtureUnit; view: "buildings" | "dashboard" | "sale" | "worklist" | "portfolio" | "unavailable"; building: string; search: string; page: number; task: string; stage: string; profile: "single" | "multi"; queue: string; dataMode: "ready" | "loading" | "empty" | "error" | "unavailable" };
export function readNavigation(search: string): NavigationState {
  const p = new URLSearchParams(search);
  const profile = p.get("profile") === "single" ? "single" : "multi";
  const access = accessibleBuildings(profile);
  const requestedUnit = units.find(u => u.id === p.get("unit"));
  const requestedBuilding = p.get("building") || requestedUnit?.building_id || (profile === "single" ? "willow" : "");
  const building = access.find(b => b.id === requestedBuilding)?.id ?? "";
  // An invalid or mismatched direct link never falls back to another record.
  const invalid = !!(p.has("unit") && (!requestedUnit || requestedUnit.building_id !== building)) ||
    !!(requestedBuilding && !building);
  const unit = requestedUnit ?? units.find(u => u.building_id === building) ?? units[0];
  const scenario = scenarios.find(s => s.id === p.get("scenario")) ?? unitScenario(unit);
  const section = sections.find(s => s.id === p.get("section"))?.id ?? scenario.section;
  const role = p.get("role") as Role;
  const view = invalid ? "unavailable" : p.get("view") === "portfolio" ? "portfolio" :
    p.get("view") === "buildings" ? "buildings" : !building ? "buildings" :
    requestedUnit ? "sale" : p.get("view") === "worklist" ? "worklist" : "dashboard";
  return { section, scenario, role: Object.hasOwn(roles, role) ? role : "developer", unit, view, building,
    profile, queue: ["Our actions", "Waiting on others", "Recorded"].includes(p.get("queue") ?? "") ? p.get("queue")! : "", dataMode: (["loading", "empty", "error", "unavailable"].includes(p.get("data") ?? "") ? p.get("data") : "ready") as NavigationState["dataMode"], stage: saleStages.find(s => s === p.get("stage")) ?? "",
    search: (p.get("q") ?? "").slice(0, 80), page: Math.max(1, Math.min(99, Math.trunc(Number(p.get("page"))) || 1)),
    task: ["authority", "notice", "legal"].includes(p.get("task") ?? "") ? p.get("task")! : "documents" };
}
export function prototypeUrl(search: string, change: Record<string, string | null>) {
  const p = new URLSearchParams(search);
  for (const [key, value] of Object.entries(change)) { if (value === null) p.delete(key); else p.set(key, value); }
  return prototypePath + "?" + p.toString();
}
export function reservationState(scenario: Scenario) { return scenario.id === "reservation-draft" ? "not_started" : scenario.id === "reservation-review" ? "awaiting_approval" : "approved"; }
export function hasExchanged(scenario: Scenario) { return scenario.status === "Exchanged" || scenario.status === "Completed"; }
