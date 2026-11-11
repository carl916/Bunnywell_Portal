// Loaded before Next: this review server cannot fetch an external service.
// No credentials are logged. Only the approved local API and document RPCs pass.
const originalFetch = globalThis.fetch;
const allowedRpc = new Set(["sales_legal_snapshot", "sales_legal_action", "sales_completion_upload_session", "sale_comment_write", "sale_comment_page", "sale_activity_page", "sale_discussion_access"]);
globalThis.fetch = async (input, init) => {
  const request = new Request(input, init);
  const url = new URL(request.url);
  if (url.origin !== "http://127.0.0.1:54321" || url.username || url.password) throw Error("Local server egress denied.");
  const rpc = url.pathname.match(/^\/rest\/v1\/rpc\/([a-z_]+)$/)?.[1];
  if (rpc) {
    if (!allowedRpc.has(rpc)) throw Error("RPC outside approved Completion scope.");
    const body = await request.clone().json();
    if (rpc === "sales_legal_action" && !["approve_completion_document", "query_completion_document"].includes(body.p_action)) throw Error("Business action unavailable.");
    if (rpc === "sales_completion_upload_session" && !["begin", "get", "finalize"].includes(body.p_action)) throw Error("Upload action unavailable.");
    if (rpc === "sale_comment_write" && (body.p_comment || body.p_parent || body.p_mentions?.length)) throw Error("Only plain new comments are enabled.");
  } else if (url.pathname.startsWith("/rest/v1/")) {
    if (request.method !== "GET") throw Error("Direct business table writes unavailable.");
  } else if (url.pathname.startsWith("/auth/v1/")) {
    if (url.pathname !== "/auth/v1/user" || request.method !== "GET") throw Error("Server auth operation unavailable.");
  } else if (!url.pathname.startsWith("/storage/v1/")) throw Error("Local API path unavailable.");
  return originalFetch(new Request(request, { redirect: "error" }));
};
process.env.BUNNYWELL_LOCAL_EGRESS_GUARD = "1";
