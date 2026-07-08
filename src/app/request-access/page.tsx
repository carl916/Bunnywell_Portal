import type { Metadata } from "next";
import { RequestAccessPage } from "@/components/portal/RequestAccessPage";

export const metadata: Metadata = {
  title: "Request Access | Bunnywell Portal",
  description: "Request resident access to the Bunnywell Portal",
};

export default function Page() {
  return <RequestAccessPage />;
}
