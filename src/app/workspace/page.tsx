import {notFound} from "next/navigation";
import ConnectedWorkspace from "@/components/experiments/building-integration/ConnectedWorkspace";
import {stagingEnabled} from "@/lib/workspace/staging";
export const dynamic="force-dynamic";
export default function Page(){if(!stagingEnabled())notFound();return <ConnectedWorkspace staging/>;}
