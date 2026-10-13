/** Preserve old Financials fee bookmarks and route legacy legal deposit anchors. */
export function financialSubview(params: URLSearchParams, hash: string): "deposits" | "agent_fees" {
  if (hash.includes("deposit")) return "deposits";
  if (hash.includes("fee")) return "agent_fees";
  if (params.get("financialView") === "deposits") return "deposits";
  if (params.get("financialView") === "agent_fees" || params.get("section") === "financials") return "agent_fees";
  return "deposits";
}
