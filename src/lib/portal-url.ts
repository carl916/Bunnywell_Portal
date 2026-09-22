/** Canonical email origin; never derive legal links from a request's Host header. */
export function portalBaseUrl(fallback = "https://portal.bunnywell.co.uk") {
  const configured = process.env.DIGEST_APP_URL || process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL || fallback;
  const value = configured.trim();
  const url = new URL(/^[a-z][a-z\d+.-]*:/i.test(value) ? value : `https://${value}`);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error("Configure a valid public portal URL.");
  return url.toString().replace(/\/$/, "");
}

export type SaleFileLocation = { building_id: string; unit_id: string; sale_attempt_id: string; comment_id?: string };

// Matches the existing unit detail / sale conversation route, including historic
// transaction context. Sign-in occurs on this URL and preserves its query.
export function saleFilePath(item: SaleFileLocation) {
  if (!item.building_id || !item.unit_id || !item.sale_attempt_id) throw new Error("The sale file location is incomplete. Refresh before sending.");
  const params = new URLSearchParams({ screen: "sales", building: item.building_id, salesUnitId: item.unit_id, conversation: item.sale_attempt_id });
  if (item.comment_id) params.set("comment", item.comment_id);
  return `/?${params}`;
}

export function absoluteSaleFileUrl(item: SaleFileLocation, baseUrl: string) {
  return `${baseUrl.replace(/\/$/, "")}${saleFilePath(item)}`;
}
