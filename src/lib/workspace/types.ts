import type { Workspace } from "@/lib/experiments/building-contracts/contracts";
import type { DashboardSnapshot, WorkItem } from "@/lib/dashboard/types";
import type { Area, Building, BuildingFloor, BuildingOrganisation, Unit, ProductionSnag, SnagPhoto, SnagEvent, Organisation } from "@/lib/data/production";
export type PortalSnapshot = Workspace & { filteredCounts?:Workspace["counts"]; page?:{number:number;pages:number;total:number;size:number}; overview?: Pick<DashboardSnapshot,"items"|"sources"|"summaries"> & {queues?:Record<string,{actions:number;records:number}>} };
export type SnagRow = ProductionSnag & { unitLabel:string; areaLabel:string; actions:WorkItem[] };
export type SnagList = { buildingId:string; rows:SnagRow[]; complete:boolean };
export type SnagDetail = { buildingId:string; snag:SnagRow; photos:SnagPhoto[]; events:(SnagEvent & {actor_name?:string|null;actor_role?:string|null})[]; moreEvents:boolean; unit:Unit|null };
export type BuildingDetail = { building:Building; units:Unit[]; floors:BuildingFloor[]; areas:Area[]; teams:BuildingOrganisation[]; organisations:Organisation[]; defaults:Record<string,unknown>|null };
export type SetupData = { tab:string; rows:Record<string,unknown>[]; more:boolean };
