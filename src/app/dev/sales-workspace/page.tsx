import { notFound } from "next/navigation";
import { SalesWorkspacePrototype } from "@/components/experiments/sales-workspace/SalesWorkspacePrototype";

export default function SalesWorkspacePrototypePage() {
  // No authentication bypass: this separate fixture surface never mounts the portal.
  // Fail closed when inherited telemetry would make requests from the root layout.
  if (process.env.NODE_ENV !== "development" || process.env.STAGING_WEB_VITALS === "1") notFound();
  return <SalesWorkspacePrototype />;
}
