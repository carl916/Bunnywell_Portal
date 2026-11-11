import {notFound} from "next/navigation";
import ConnectedWorkspace from "@/components/experiments/building-integration/ConnectedWorkspace";
export const dynamic="force-dynamic";
export default function Page(){if(process.env.NODE_ENV!=="development"||process.env.BUILDING_WORKSPACE_LOCAL!=="1")notFound();return <ConnectedWorkspace/>}

