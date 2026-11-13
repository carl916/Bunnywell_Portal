import type {Document} from "@/lib/experiments/building-integration/reader";
import type {Scope} from "@/lib/experiments/building-contracts/contracts";
import type {CommercialSummary} from "./commercial-summary";

export type SaleDetails = {
  title: string;
  historical: boolean;
  attempts: {id:string;attempt_number:number;workflow_status:string;is_active:boolean}[];
  groups: {id:string; title:string; fields:[string,string][]}[];
  notices: string[];
  documents: Document[];
  commercial?: CommercialSummary;
};
export type SaleDetailsReader = {
  details?: (scope:Scope, unit:string, sale:string, section:string, signal:AbortSignal)=>Promise<SaleDetails>;
};
