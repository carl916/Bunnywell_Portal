import type { Building } from "../data/production";
import type { WorkParty } from "../dashboard/types";

export type SalesAppointment = Pick<Building, "sales_agent_organisation_id" | "conveyancer_organisation_id">;
export type SalesOrganisationRole = "sales_agent" | "conveyancer";

/** Operational ownership only: an appointment never grants building or action access.
 * Attempt assignments and individual audit actors are deliberately not inputs.
 * null is a confirmed missing appointment; undefined is an incomplete read.
 */
export function buildingSalesResponsibility(building: SalesAppointment | undefined, role: SalesOrganisationRole,
  organisations: readonly { id: string; name: string }[]): WorkParty {
  const id = building?.[role === "sales_agent" ? "sales_agent_organisation_id" : "conveyancer_organisation_id"];
  const title = role === "sales_agent" ? "Sales agent" : "Conveyancer";
  return { kind: role, organisationId: id ?? null,
    allocation: id === undefined ? "unavailable" : id === null ? "unallocated" : "appointed",
    label: id === undefined ? `${title} appointment unavailable` : id === null ? `${title} not appointed for building`
      : organisations.find(item => item.id === id)?.name ?? `${title} — appointed organisation`,
  };
}

export function sellerConveyancer(building: SalesAppointment | undefined, organisations: readonly { id: string; name: string }[]) {
  return buildingSalesResponsibility(building, "conveyancer", organisations);
}

/** Report legacy inconsistencies; never repair commercial identity or appointments. */
export function conflictingSaleAssignments(sale: SalesAppointment, building: SalesAppointment | undefined) {
  return (["sales_agent_organisation_id", "conveyancer_organisation_id"] as const)
    .filter(key => sale[key] && building?.[key] !== undefined && sale[key] !== building[key]);
}
