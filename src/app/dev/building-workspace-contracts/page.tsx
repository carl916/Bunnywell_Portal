import { notFound } from "next/navigation";
import { ContractWorkspace } from "@/components/experiments/building-contracts/ContractWorkspace";
export default function Page() {
  if(process.env.NODE_ENV!=="development"||process.env.BUILDING_CONTRACTS_OFFLINE!=="1"||process.env.STAGING_WEB_VITALS==="1")notFound();
  return <ContractWorkspace />;
}
