// Intent is armed only by an explicit navigation handler. A data load alone
// never creates an intent. State contains IDs and times, never session tokens.
const pending = new Map<string, number>();
const recorded = new Map<string, number>();
export function markUnitOpenIntent(unitId: string, now = Date.now()) {
  if (unitId) pending.set(unitId, now);
}
export function consumeUnitOpenIntent(unitId: string, now = Date.now()) {
  const armedAt = pending.get(unitId);
  pending.delete(unitId);
  if (armedAt === undefined || now - armedAt > 60_000) return false;
  if (now - (recorded.get(unitId) ?? -Infinity) < 300_000) return false;
  recorded.set(unitId, now);
  return true;
}
export function cancelUnitOpenIntent(unitId: string) { pending.delete(unitId); }
export function resetUnitOpenIntents() { pending.clear(); recorded.clear(); }
