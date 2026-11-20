/** Local-only Stage 2 boundary. Does not initialise a client or read ambient .env files. */
export const approvedLocalEnvironment = Object.freeze({
  projectId: "bunnywell-workspace-stage2",
  appOrigin: "http://127.0.0.1:3031",
  apiOrigin: "http://127.0.0.1:54321",
  mailCaptureOrigin: "http://127.0.0.1:54324",
});

export function assertLocalEnvironment(value: { projectId: string; appOrigin: string; apiOrigin: string }): void {
  for (const key of ["projectId", "appOrigin", "apiOrigin"] as const) {
    if (value[key] !== approvedLocalEnvironment[key]) throw new Error("The approved local test environment does not match.");
  }
}

/** A network guard, not an authentication or row-level permission grant. */
export function assertLocalReadUrl(input: string | URL, allowedPaths: ReadonlySet<string>): URL {
  const url = new URL(input);
  if (url.origin !== approvedLocalEnvironment.apiOrigin || url.username || url.password || url.hash ||
      !allowedPaths.has(url.pathname) || !/^\/rest\/v1\/[a-z][a-z0-9_]*$/.test(url.pathname)) {
    throw new Error("Request outside the approved local read boundary.");
  }
  return url;
}

/**
 * Future readers must supply an audited table allowlist and authenticated headers.
 * RPCs, Storage, Auth and application routes cannot pass through this reader.
 * Authentication needs its own explicit boundary; it is not a business read.
 */
export function createLocalReadTransport(
  environment: { projectId: string; appOrigin: string; apiOrigin: string },
  paths: readonly string[],
  transport: typeof fetch = fetch,
) {
  assertLocalEnvironment(environment);
  const allowedPaths = new Set(paths);
  for (const path of paths) assertLocalReadUrl(new URL(path, environment.apiOrigin), allowedPaths);
  return async (input: string | URL, init: RequestInit = {}) => {
    const url = assertLocalReadUrl(input, allowedPaths);
    if ((init.method ?? "GET") !== "GET" || init.body != null || init.redirect && init.redirect !== "error") {
      throw new Error("Business writes and redirects are unavailable in this read-only integration.");
    }
    const response = await transport(url, { ...init, method: "GET", redirect: "error", cache: "no-store" });
    if (response.redirected || response.url && new URL(response.url).origin !== environment.apiOrigin) {
      throw new Error("Unexpected response outside the approved local environment.");
    }
    return response;
  };
}
