import type { Building } from "../data/production";
import type { WorkParty } from "../dashboard/types";

/** A workflow label only. Building contacts never grant record access. */
export function sellerConveyancer(building: Pick<Building, "conveyancer_organisation_id"> | undefined,
  organisations: readonly { id: string; name: string }[]): WorkParty {
  const id = building?.conveyancer_organisation_id;
  const organisation = id ? organisations.find(item => item.id === id) : undefined;
  return {
    kind: "conveyancer",
    organisationId: organisation?.id ?? null,
    label: organisation?.name ?? (id ? "Conveyancer configuration unresolved" : "Conveyancer not configured for building"),
  };
}
