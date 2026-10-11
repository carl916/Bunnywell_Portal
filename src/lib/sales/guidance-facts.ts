import type { SupabaseClient } from "@supabase/supabase-js";
import type { DashboardInput } from "../dashboard/types";

export type SalesGuidanceFacts = Pick<DashboardInput, "authorities" | "depositSources" | "deposits"> & { asOf: string };
export const EMPTY_GUIDANCE_FACTS: SalesGuidanceFacts = { authorities: [], depositSources: [], deposits: [], asOf: new Date(0).toISOString() };

/** Compact, bounded batches over already authorised sales, never a read per row. */
export async function loadSalesGuidanceFacts(client: SupabaseClient, sales: string[]): Promise<SalesGuidanceFacts> {
  async function read(table: string, columns: string) {
    const result = [];
    for (let offset = 0; offset < sales.length; offset += 150) {
      const ids = sales.slice(offset, offset + 150);
      let expected: number | null = null;
      let received = 0;
      do {
        const response = await client.from(table).select(columns, { count: "exact" }).in("sale_attempt_id", ids).order("id").range(received, received + 249);
        if (response.error) throw response.error;
        if (response.count === null || response.count > 20_000 || expected !== null && expected !== response.count) throw new Error("Sales guidance changed or is incomplete. Refresh to retry.");
        expected = response.count;
        const rows = response.data ?? [];
        if (!rows.length && received < expected) throw new Error("Sales guidance is incomplete. Refresh to retry.");
        received += rows.length;
        result.push(...rows);
      } while (received < expected);
    }
    return result;
  }
  const [authorities, depositSources, deposits] = await Promise.all([
    read("sale_legal_emails", "id,sale_attempt_id,kind,version,issued_at,expires_at,revoked_at,replaced_by,exchanged_at,delivery_status,sent_at,resend_message_id"),
    read("sale_exchange_deposit_sources", "id,sale_attempt_id,source_kind,expected_amount"),
    read("sale_exchange_deposit_receipts", "id,sale_attempt_id,source_id,expected_amount,received_amount"),
  ]);
  return { authorities, depositSources, deposits, asOf: new Date().toISOString() } as unknown as SalesGuidanceFacts;
}
