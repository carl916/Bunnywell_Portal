import type { Session } from "@/lib/experiments/building-integration/reader";
import { sameScope, type Scope } from "@/lib/experiments/building-contracts/contracts";
import { summarise } from "@/lib/experiments/building-contracts/projection";
import type { PortalSnapshot } from "./types";

// Owned by one mounted workspace. Credentials rotate without replacing the
// reader or its React tree. Old readers fail closed after a principal changes.
export function createWorkspaceCredentials() {
  let current: Session | null = null;
  let stable: Session | null = null;
  let generation=0;
  return {
    clear() { generation++; current = null; stable = null; },
    update(next: Session) {
      current = next;
      if (stable?.user.id !== next.user.id) {
        const identity = next.user.id, owner=++generation;
        stable = {
          user: { id: identity },
          get access_token() {
            if (owner!==generation || current?.user.id !== identity) throw Error("Session changed. Sign in again.");
            return current.access_token;
          },
          get expires_at() { return current?.user.id === identity ? current.expires_at : 0; },
        };
      }
      return stable;
    },
  };
}

export function filterWorklist(snapshot: PortalSnapshot, parameters: URLSearchParams): PortalSnapshot {
  const q = (parameters.get("q") || "").toLowerCase();
  const stage = parameters.get("stage") || "", queue = parameters.get("queue") || "";
  if (queue && !["ours", "others", "unallocated"].includes(queue)) throw Error("Invalid responsibility filter.");
  const rows = (snapshot.filterRows || snapshot.rows).filter(row =>
    (!stage || row.stage === stage) && (!queue || row.actions.some(action => action.queue === queue)) &&
    (row.unitNumber + " " + row.buyerLabel).toLowerCase().includes(q));
  const pages = Math.max(1, Math.ceil(rows.length / 20));
  const number = Math.min(pages, Math.max(1, Math.trunc(Number(parameters.get("page")) || 1)));
  const filteredCounts = summarise(rows, snapshot.counts.complete);
  const current = summarise(rows.filter(row => !row.historical), snapshot.counts.complete);
  filteredCounts.units = current.units; filteredCounts.stages = current.stages;
  return { ...snapshot, filteredCounts, rows: rows.slice((number - 1) * 20, number * 20), page: { number, pages, total: rows.length, size: 20 } };
}

// Complete, bounded, caller-authorised projections only; never combine pages or
// infer that a server-filtered page represents the complete building.
export function createWorklistCache(now = Date.now) {
  let entry: { snapshot: PortalSnapshot; expires: number } | null = null;
  return {
    clear() { entry = null; },
    put(snapshot: PortalSnapshot) {
      if (snapshot.filterRows && snapshot.filterRows.length <= 200 && snapshot.filterRows.every(row => row.buildingId === snapshot.scope.buildingId)) {
        entry = { snapshot, expires: now() + 30_000 };
      }
    },
    get(scope: Scope, parameters: URLSearchParams) {
      return entry && entry.expires > now() && sameScope(entry.snapshot.scope, scope) ? filterWorklist(entry.snapshot, parameters) : null;
    },
  };
}
