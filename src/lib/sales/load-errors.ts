// PostgREST returns plain error objects as well as Error instances.
export function salesLoadErrorMessage(error: unknown) {
  if (typeof error === "object" && error !== null && "message" in error
    && typeof error.message === "string" && error.message.trim()) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return "Could not load sales data.";
}

export function isMissingSaleActorNames(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error
    && error.code === "PGRST202" && salesLoadErrorMessage(error).includes("sale_actor_names");
}

export function isSalesAccessError(error: unknown) {
  if (typeof error !== "object" || error === null) return false;
  const value = error as { code?: string; status?: number };
  return ["42501", "PGRST301", "PGRST302", "PGRST303"].includes(value.code ?? "") || [401, 403].includes(value.status ?? 0);
}
