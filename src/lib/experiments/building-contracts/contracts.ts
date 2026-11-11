import type { WorkDeadline, } from "../../dashboard/dates";
import type { WorkParty } from "../../dashboard/types";

export const contractVersion = "building-workspace.v1" as const;
export const offlinePath = "/dev/building-workspace-contracts";
export const roles = ["admin", "developer", "sales_agent", "conveyancer"] as const;
export type Role = typeof roles[number];
export type Scope = { identity: string; role: Role | "developer_representative" | "contractor"; organisationId: string | null; accessRevision: string; buildingId: string };
export type Building = { id: string; name: string; address: string };
export type Catalog = { contract: typeof contractVersion; scope: Omit<Scope, "buildingId">; buildings: Building[]; fixtureOnly: true };
export type Queue = "ours" | "others" | "unallocated";
export type Action = {
  id: string; kind: string; title: string; party: WorkParty; queue: Queue;
  existingCapability: boolean; businessEnabled: false; countingUnit: string;
  deadline: WorkDeadline | null; urgent: boolean;
  destination: { buildingId: string; unitId: string; saleId: string; section: string; anchor: string; versionId?: string };
};
export type Preview = {
  heading: string; state: string; responsibleTeam: string; mode: "waiting" | "read-only";
  onBehalf: { label: string; existingRoleAllows: boolean; enabled: false } | null;
  expectedInvoiceGross?: number;
};
export type SaleRow = {
  unitId: string; unitNumber: string; buildingId: string; buildingName: string; floor: string;
  saleId: string | null; buyerLabel: string; stage: string; actions: Action[];
  historical?: boolean;
  primaryActionId: string | null; warning: string | null; preview: Preview;
};
export type Counts = {
  units: number; stages: Record<string, number>; complete: boolean;
  ours: { actions: number; sales: number } | null; others: { actions: number; sales: number } | null;
  unallocated: { actions: number; sales: number } | null; distinctSales: number | null;
};
export type Workspace = {
  contract: typeof contractVersion; scope: Scope; building: Building; asOf: string; fixtureOnly: boolean;
  population: string; sources: { key: string; state: "ready" | "unavailable" | "not_permitted" }[];
  counts: Counts; rows: SaleRow[];
};
export class ContractError extends Error {}
export const scopeKey = (s: Scope) => JSON.stringify([s.identity,s.role,s.organisationId,s.accessRevision,s.buildingId]);
export const sameScope = (a: Scope, b: Scope) => scopeKey(a) === scopeKey(b);
export const validId = (id: string) => /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id);
export function assertWorkspace(value: Workspace, scope: Scope, fixtureOnly = true): Workspace {
  if (!value || value.contract !== contractVersion || value.fixtureOnly !== fixtureOnly || !value.scope || !sameScope(value.scope,scope) ||
      value.building?.id !== scope.buildingId || !Array.isArray(value.rows) || !value.counts) throw new ContractError("Workspace response scope is invalid.");
  for (const row of value.rows) {
    if (row.buildingId !== scope.buildingId || !validId(row.unitId) || row.saleId && !validId(row.saleId) || !Array.isArray(row.actions)) throw new ContractError("Record belongs to another scope.");
    if (scope.role === "conveyancer" && Object.hasOwn(row.preview,"expectedInvoiceGross")) throw new ContractError("Financial field outside role contract.");
    for (const a of row.actions) {
      if (a.destination.buildingId !== scope.buildingId || a.destination.unitId !== row.unitId || a.destination.saleId !== row.saleId || a.businessEnabled !== false ||
          scope.role === "conveyancer" && a.kind.startsWith("fee_")) throw new ContractError("Action scope or role contract is invalid.");
    }
  }
  return value;
}
export function resolveSale(workspace: Workspace, unitId: string, saleId: string) {
  const row = workspace.rows.find(r => r.unitId === unitId && r.saleId === saleId);
  if (!row || !row.saleId) throw new ContractError("This building, unit and sale attempt do not match.");
  return row;
}

