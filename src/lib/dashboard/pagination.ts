export const DASHBOARD_PAGE_SIZE = 250;
export const DASHBOARD_SOURCE_LIMIT = 20_000;
type Page<T> = { data: T[] | null; error: { message: string } | null; count: number | null };

/** Check count on every page: truncation or a changing population is never an all-clear. */
export async function readComplete<T>(page: (from: number, to: number) => PromiseLike<Page<T>>, limit = DASHBOARD_SOURCE_LIMIT) {
  const result: T[] = [];
  let expected: number | null = null;
  while (true) {
    const response = await page(result.length, result.length + DASHBOARD_PAGE_SIZE - 1);
    if (response.error) throw new Error(response.error.message);
    if (response.count === null) throw new Error("Source did not provide a complete count.");
    if (response.count > limit) throw new Error("Source exceeds the bounded dashboard read; use the module view.");
    if (expected !== null && response.count !== expected) throw new Error("Source changed while loading. Refresh to read the current position.");
    expected = response.count;
    const rows = response.data ?? [];
    if (rows.length === 0 && result.length < expected) throw new Error("Source returned an incomplete page.");
    result.push(...rows);
    if (result.length >= expected) return result;
  }
}
