// Produces SELECT/EXPLAIN statements only; it never installs a function.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const originalFile = readFileSync('supabase/migrations/20260907b_sale_activity_projection.sql','utf8');
const original = originalFile.slice(originalFile.indexOf('create function public.sale_workflow_context('));
const migration = readFileSync('supabase/migrations/20261012200050_sale_workflow_context_materialized.sql','utf8');
export const baseline = original.slice(original.indexOf('  select coalesce'),original.indexOf('  return result;')).trim().replace(/\s+into result\b/,'').replace(/;\s*$/,'');
export const optimized = migration.slice(migration.indexOf('  with requested_sale_ids'),migration.indexOf('  return result;')).trim().replace(/\s+into result\b/,'').replace(/;\s*$/,'');
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
export function query(template, saleIds) {
  assert.ok(Array.isArray(saleIds) && saleIds.length<=500 && saleIds.every(id=>uuid.test(id)));
  return template.replaceAll('p_sales','ARRAY['+saleIds.map(id=>"'"+id+"'::uuid").join(',')+']::uuid[]');
}
export function transaction(userId, statement, { countFunctions = false } = {}) {
  assert.ok(uuid.test(userId));
  return "begin read only;set local statement_timeout='10s';set local search_path=public;"
    +"set local request.jwt.claims='"+JSON.stringify({sub:userId,role:'authenticated'})+"';"
    +(countFunctions?"set local track_functions='all';":"")+statement+";rollback;";
}
export function equality(saleIds) {
  const ids=query('p_sales',saleIds);
  return "with original as materialized(select public.sale_workflow_context("+ids+") data), candidate as materialized("
    +query(optimized,saleIds)+") select (select data from original)=(select * from candidate) exact_ordered_json_equal,"
    +"jsonb_array_length((select data from original)) event_count,octet_length((select data from original)::text) bytes";
}
