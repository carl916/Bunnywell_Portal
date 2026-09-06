import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { singleStatementTrinityImport } from "./lib/trinity-single-statement.mjs";

// Offline preparation only. Never connects to or writes to a database.
const argument = (name) => {
  const value = process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
  assert.ok(value, `Pass --${name}=<path>`);
  return path.resolve(value);
};
const sourcePath = argument("source");
const preflightPath = argument("preflight");
const outputDir = argument("output-dir");
const relativeOutput = path.relative(process.cwd(), outputDir);
assert.ok(relativeOutput.startsWith(`..${path.sep}`) || path.isAbsolute(relativeOutput), "Tenant data outputs must be outside the repository");
const readJson = (file) => JSON.parse(readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const source = readJson(sourcePath);
const target = readJson(preflightPath);
const unitNumbers = Array.from({ length: 18 }, (_, index) => String(index + 69));
const sortedNumbers = (rows) => rows.map((row) => row.unit_number).sort((a, b) => Number(a) - Number(b));
const unique = (rows, key) => assert.equal(new Set(rows.map((row) => row[key])).size, rows.length, `Duplicate ${key}`);
assert.equal(source.source_host, "vxkpvdtrldwwqiddoyof.supabase.co");
assert.equal(source.building.name, "Trinity Point");
assert.equal(source.building.address_line_1, "New Road");
assert.equal(source.building.postcode, "DA11 0FD");
assert.deepEqual(sortedNumbers(source.units), unitNumbers);
assert.deepEqual(sortedNumbers(target.units), unitNumbers);
assert.equal(target.matched_unit_count, 18);
assert.equal(target.building_matches.length, 1);
const building = target.building_matches[0];
assert.equal(building.name, source.building.name);
assert.equal(building.address_line_1, source.building.address_line_1);
assert.equal(building.postcode, source.building.postcode);
assert.notEqual(building.id, source.building.id, "Destination must differ from staging");
for (const name of ["existing_tenancies", "existing_sale_attempts", "existing_import_runs", "letting_agent_matches", "missing_unit_numbers", "duplicate_unit_numbers"]) {
  assert.deepEqual(target[name], [], `Production ${name} requires reconciliation`);
}
assert.equal(target.existing_arrears_episode_count, 0);
assert.equal(target.existing_arrears_event_count, 0);
assert.equal(target.actor_matches.length, 1);
const actor = target.actor_matches[0];
assert.equal(actor.email.toLowerCase(), "carl.gilbert@gmail.com");
assert.equal(actor.role, "admin");
assert.equal(actor.active, true);
assert.equal(source.actors.length, 1);
assert.equal(source.actors[0].email.toLowerCase(), actor.email.toLowerCase());
assert.equal(source.sales.length, 0);
for (const [name, count] of Object.entries({ tenancies: 29, episodes: 13, events: 32, runs: 1 })) {
  assert.equal(source[name].length, count, `Unexpected ${name} count`);
  unique(source[name], "id");
}
unique(source.units, "id");
unique(target.units, "id");
unique(source.episodes, "source_import_key");
unique(source.events, "source_import_key");
const sourceAgentIds = new Set(source.tenancies.map((row) => row.letting_agent_organisation_id));
assert.equal(sourceAgentIds.size, 1);
const sourceAgent = source.organisations.find((row) => sourceAgentIds.has(row.id));
assert.ok(sourceAgent);
assert.equal(sourceAgent.name, "RMJ");
assert.equal(sourceAgent.type, "letting_agent");
const unitMap = new Map(source.units.map((unit) => {
  assert.equal(unit.building_id, source.building.id);
  assert.equal(unit.sale_status, "not_for_sale");
  assert.equal(unit.rental_portfolio_status, "active");
  const destination = target.units.find((row) => row.unit_number === unit.unit_number);
  assert.equal(destination.building_id, building.id);
  assert.equal(destination.sale_status, "for_sale");
  assert.equal(destination.rental_portfolio_status, "not_in_portfolio");
  for (const date of ["reservation_date", "completion_date", "handover_date"]) assert.equal(destination[date], null);
  return [unit.id, destination.id];
}));
const tenancyMap = new Map(source.tenancies.map((row) => [row.id, randomUUID()]));
const episodeMap = new Map(source.episodes.map((row) => [row.id, randomUUID()]));
const mapRequired = (map, key) => { assert.ok(map.has(key), "Unmapped source relationship"); return map.get(key); };
const mapActor = (id) => {
  if (id === null) return null;
  assert.equal(id, source.actors[0].id, "Unknown source actor");
  return actor.id;
};
const agent = { ...sourceAgent, id: randomUUID() };
const records = {
  organisations: [agent],
  unit_tenancies: source.tenancies.map((row) => {
    assert.equal(row.building_id, source.building.id);
    return { ...row, id: mapRequired(tenancyMap, row.id), building_id: building.id,
      unit_id: mapRequired(unitMap, row.unit_id), letting_agent_organisation_id: agent.id,
      created_by_user_id: mapActor(row.created_by_user_id), updated_by_user_id: mapActor(row.updated_by_user_id) };
  }),
  rental_arrears_episodes: source.episodes.map((row) => ({ ...row, id: mapRequired(episodeMap, row.id), tenancy_id: mapRequired(tenancyMap, row.tenancy_id) })),
  rental_arrears_events: source.events.map((row) => ({ ...row, id: randomUUID(), episode_id: mapRequired(episodeMap, row.episode_id) })),
  rental_import_runs: source.runs.map((row) => {
    assert.equal(row.building_id, source.building.id);
    return { ...row, id: randomUUID(), building_id: building.id, created_by_user_id: mapActor(row.created_by_user_id) };
  }),
};
for (const unitId of unitMap.values()) {
  const tenancies = records.unit_tenancies.filter((row) => row.unit_id === unitId).sort((a, b) => a.tenancy_start_date.localeCompare(b.tenancy_start_date));
  assert.ok(tenancies.length > 0);
  for (let index = 0; index < tenancies.length; index++) {
    const row = tenancies[index];
    assert.ok(!row.tenancy_end_date || row.tenancy_end_date >= row.tenancy_start_date);
    if (index) assert.ok((tenancies[index - 1].tenancy_end_date ?? "9999-12-31") < row.tenancy_start_date, "Overlapping tenancy dates");
  }
}
const transferId = randomUUID();
const sourceHash = createHash("sha256").update(readFileSync(sourcePath)).digest("hex");
const literal = (value) => `'${String(value).replaceAll("'", "''")}'`;
const json = (value) => `${literal(JSON.stringify(value))}::jsonb`;
const expectedUnits = target.units.map((row) => ({ id: row.id, building_id: row.building_id, unit_number: row.unit_number,
  old_sale_status: row.sale_status, old_rental_portfolio_status: row.rental_portfolio_status,
  sale_status: "not_for_sale", rental_portfolio_status: "active" }));
const insertSql = Object.entries(records).map(([table, rows]) => {
  const columns = Object.keys(rows[0]);
  columns.forEach((column) => assert.match(column, /^[a-z_]+$/));
  return `insert into public.${table} (${columns.join(", ")})\nselect ${columns.join(", ")} from jsonb_populate_recordset(null::public.${table},\n  ${json(rows)});`;
}).join("\n\n");
const equalityChecks = Object.entries(records).map(([table, rows]) => `
  if exists (
    select 1 from jsonb_populate_recordset(null::public.${table}, ${json(rows)}) expected
    left join public.${table} actual on actual.id = expected.id
    where actual.id is null or to_jsonb(actual) is distinct from to_jsonb(expected)
  ) then raise exception 'Copied ${table} content does not match the snapshot'; end if;`).join("\n");
const report = `select jsonb_pretty(jsonb_build_object(
  'transfer_id', ${literal(transferId)},
  'transfer_audit_present', exists(select 1 from public.audit_events where id = ${literal(transferId)}::uuid),
  'units_with_expected_status', (select count(*) from public.units where id = any(array[${[...unitMap.values()].map((id) => `${literal(id)}::uuid`).join(",")}]) and sale_status = 'not_for_sale' and rental_portfolio_status = 'active'),
  'tenancies', (select count(*) from public.unit_tenancies where id = any(array[${records.unit_tenancies.map((row) => `${literal(row.id)}::uuid`).join(",")}])),
  'arrears_episodes', (select count(*) from public.rental_arrears_episodes where id = any(array[${records.rental_arrears_episodes.map((row) => `${literal(row.id)}::uuid`).join(",")}])),
  'arrears_events', (select count(*) from public.rental_arrears_events where id = any(array[${records.rental_arrears_events.map((row) => `${literal(row.id)}::uuid`).join(",")}])),
  'import_runs', (select count(*) from public.rental_import_runs where id = ${literal(records.rental_import_runs[0].id)}::uuid),
  'letting_agent_present', exists(select 1 from public.organisations where id = ${literal(agent.id)}::uuid and name = 'RMJ' and type = 'letting_agent')
)) as trinity_point_transfer_result;`;
const sql = `-- PRIVATE TENANT DATA: do not commit, share publicly or paste into an issue.
-- Trinity Point units 69-86 ONLY. Destination building ${building.id}.
-- Source snapshot ${source.captured_at}; SHA-256 ${sourceHash}.
-- Production preflight ${target.captured_at}.
-- Confirm a recoverable production backup. Run this ENTIRE file in production SQL Editor.
-- Never run against staging. No deletes, account copies, schema changes or trigger disabling.
-- Do not rerun after success. If the result is unclear, run the separate verification file.
begin;
set local lock_timeout = '10s';
set local statement_timeout = '120s';
set local standard_conforming_strings = on;
select pg_advisory_xact_lock(hashtextextended('trinity-point-rental-transfer-20260906', 0));

create temporary table trinity_expected_units on commit drop as
select * from jsonb_to_recordset(${json(expectedUnits)}) as x(
  id uuid, building_id uuid, unit_number text, old_sale_status text,
  old_rental_portfolio_status text, sale_status text, rental_portfolio_status text);

-- Prevent a concurrent RMJ creation between the absence check and insert.
lock table public.organisations in share row exclusive mode;
do $guard$
begin
  if exists(select 1 from public.audit_events where id = ${literal(transferId)}::uuid) then
    raise exception 'This transfer already committed; do not rerun';
  end if;
  perform 1 from public.buildings where id = ${literal(building.id)}::uuid
    and name = 'Trinity Point' and address_line_1 = 'New Road' and postcode = 'DA11 0FD' for share;
  if not found then raise exception 'Production Trinity Point identity mismatch'; end if;
  perform 1 from public.profiles where id = ${literal(actor.id)}::uuid
    and lower(email) = ${literal(actor.email.toLowerCase())} and active is true and role::text = 'admin' for share;
  if not found then raise exception 'Production admin identity mismatch'; end if;
  perform u.id from public.units u join trinity_expected_units e on e.id = u.id order by u.id for update of u;
  if (select count(*) from trinity_expected_units) <> 18 or (select count(distinct id) from trinity_expected_units) <> 18 then
    raise exception 'Expected exactly 18 unique mapped units';
  end if;
  if (select count(*) from public.units u join trinity_expected_units e on e.id = u.id
      where u.building_id = e.building_id and u.unit_number = e.unit_number
        and u.sale_status = e.old_sale_status and u.rental_portfolio_status = e.old_rental_portfolio_status
        and u.reservation_date is null and u.completion_date is null and u.handover_date is null) <> 18 then
    raise exception 'Production units changed since preflight; stop and reconcile';
  end if;
  if exists(select 1 from public.unit_sale_attempts a join trinity_expected_units e on e.id = a.unit_id)
    or exists(select 1 from public.unit_tenancies t join trinity_expected_units e on e.id = t.unit_id)
    or exists(select 1 from public.rental_import_runs where building_id = ${literal(building.id)}::uuid) then
    raise exception 'Existing production sales/rental records; stop and reconcile';
  end if;
  if exists(select 1 from public.organisations where lower(trim(name)) = 'rmj') then
    raise exception 'RMJ now exists; map it before importing rather than creating a duplicate';
  end if;
end;
$guard$;

create temporary table trinity_units_before on commit drop as select id, to_jsonb(u) as row_data from public.units u;

-- Authorised one-off allocation, retaining database guards and recording an audit.
set local app.unit_commercial_mutation = 'on';
update public.units u set sale_status = e.sale_status, rental_portfolio_status = e.rental_portfolio_status,
  updated_at = current_timestamp from trinity_expected_units e where u.id = e.id;
set local app.unit_commercial_mutation = 'off';

${insertSql}

insert into public.audit_events(id, event_type, entity_type, entity_id, summary, metadata,
  created_by_user_id, category, building_id, action_id, source)
values (${literal(transferId)}::uuid, 'rental_staging_transfer', 'building', ${literal(building.id)}::uuid,
  'Copied Trinity Point units 69-86 rental records from staging: 18 allocations, 29 tenancies, 13 arrears episodes, 32 events and 1 import history record.',
  jsonb_build_object('source', 'trinity_point_staging_transfer', 'source_host', ${literal(source.source_host)},
    'source_captured_at', ${literal(source.captured_at)}, 'source_sha256', ${literal(sourceHash)},
    'unit_changes', (select jsonb_agg(to_jsonb(e)) from trinity_expected_units e)),
  ${literal(actor.id)}::uuid, 'rentals', ${literal(building.id)}::uuid, ${literal(transferId)}::uuid, 'trinity_point_staging_transfer');

do $verify$
begin
  if (select count(*) from public.units) <> (select count(*) from trinity_units_before) then
    raise exception 'Unit count changed during the transfer'; end if;
  if exists(select 1 from trinity_units_before b left join public.units u on u.id = b.id
    where not exists(select 1 from trinity_expected_units e where e.id = b.id)
      and (u.id is null or to_jsonb(u) is distinct from b.row_data)) then
    raise exception 'A non-target unit changed during the transfer'; end if;
  if exists(select 1 from trinity_units_before b join trinity_expected_units e on e.id = b.id
    join public.units u on u.id = b.id
    where (to_jsonb(u) - array['sale_status','rental_portfolio_status','updated_at'])
      is distinct from (b.row_data - array['sale_status','rental_portfolio_status','updated_at'])
      or u.sale_status <> e.sale_status or u.rental_portfolio_status <> e.rental_portfolio_status) then
    raise exception 'Target unit changed beyond the authorised allocation fields'; end if;
${equalityChecks}
end;
$verify$;
commit;

${report}
`;
const verifySql = `-- Read-only verification; does not expose tenant records.\nbegin read only;\nset local statement_timeout = '30s';\n${report}\ncommit;\n`;
mkdirSync(outputDir, { recursive: true });
writeFileSync(path.join(outputDir, "trinity-point-production-import.sql"), singleStatementTrinityImport(sql, expectedUnits));
writeFileSync(path.join(outputDir, "trinity-point-production-verify.sql"), verifySql);
writeFileSync(path.join(outputDir, "transfer-manifest.private.json"), JSON.stringify({ transferId, sourceHash, source_captured_at: source.captured_at,
  production_preflight_at: target.captured_at, building, expectedUnits, records,
  unit_id_map: Object.fromEntries(unitMap), tenancy_id_map: Object.fromEntries(tenancyMap), episode_id_map: Object.fromEntries(episodeMap) }, null, 2));
console.log(JSON.stringify({ outputDir, transferId, sourceHash, counts: Object.fromEntries(Object.entries(records).map(([table, rows]) => [table, rows.length])) }, null, 2));
