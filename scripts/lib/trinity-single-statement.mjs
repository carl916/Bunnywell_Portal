import assert from "node:assert/strict";

// Keep the reviewed record IDs/payloads intact while removing any dependency on
// temporary tables or transaction state shared between SQL Editor statements.
export function singleStatementTrinityImport(batchSql, expectedUnits) {
  const start = batchSql.indexOf("begin;\nset local lock_timeout");
  const end = batchSql.lastIndexOf("\ncommit;\n");
  assert.ok(start >= 0 && end > start, "Unrecognised transfer batch");
  let body = batchSql.slice(start + "begin;\n".length, end);
  const declaration = JSON.stringify(expectedUnits).replaceAll("'", "''");
  const unitRows = "jsonb_to_recordset(v_expected_units) as e(id uuid, building_id uuid, unit_number text, old_sale_status text, old_rental_portfolio_status text, sale_status text, rental_portfolio_status text)";
  const beforeRows = "jsonb_to_recordset(v_units_before) as b(id uuid, row_data jsonb)";

  const tempStart = body.indexOf("create temporary table trinity_expected_units");
  const tempEnd = body.indexOf("\n\n-- Prevent a concurrent RMJ", tempStart);
  assert.ok(tempStart >= 0 && tempEnd > tempStart);
  body = body.slice(0, tempStart) + body.slice(tempEnd);
  body = body.replace("create temporary table trinity_units_before on commit drop as select id, to_jsonb(u) as row_data from public.units u;",
    "select coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'row_data', to_jsonb(u))), '[]'::jsonb) into v_units_before from public.units u;");
  body = body.replaceAll("trinity_expected_units e", unitRows)
    .replaceAll("from trinity_expected_units)", `from ${unitRows})`)
    .replaceAll("trinity_units_before b", beforeRows)
    .replaceAll("(select count(*) from trinity_units_before)", "jsonb_array_length(v_units_before)");
  body = body.replace("do $guard$\nbegin", "begin").replace("$guard$;", "")
    .replace("do $verify$\nbegin", "begin").replace("$verify$;", "");
  body = body.replace("select pg_advisory_xact_lock", "perform pg_advisory_xact_lock");
  body = body.replaceAll(/set local ([a-z_.]+) = '([^']*)';/g, "perform set_config('$1', '$2', true);");
  assert.ok(!/trinity_expected_units|trinity_units_before|create temporary|on commit drop|do \$guard\$|do \$verify\$/.test(body), "Temporary state was not fully removed");
  assert.ok(!body.includes("$trinity_import$"), "Dollar quote collision");
  const sql = `-- PRIVATE TENANT DATA. Replacement for the original multi-statement import.
-- Production Trinity Point units 69-86 only. Keeps the original transfer and row IDs.
-- Run this entire single DO statement as postgres; leave RLS enabled.
-- All guards, writes and verification execute atomically in one statement.
-- Existing/changed destination data causes an exception before writes.
do $trinity_import$
declare
  v_expected_units jsonb := '${declaration}'::jsonb;
  v_units_before jsonb;
begin
${body}
  raise notice 'Trinity Point transfer completed. Run the separate verification query for counts.';
end;
$trinity_import$;
`;
  return sql;
}
