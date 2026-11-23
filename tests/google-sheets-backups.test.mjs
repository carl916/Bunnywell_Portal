import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { Google, GoogleError } from '../supabase/functions/portal-sheets-backup/google.ts';
import { columns, exportRows, recordKey, stagingDatabaseUrl, STAGING_REF } from '../supabase/functions/portal-sheets-backup/model.ts';
import { runBackups } from '../supabase/functions/portal-sheets-backup/run.ts';
import { planSheet } from '../supabase/functions/portal-sheets-backup/sheet.ts';

const id = (n) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const building = { id: id(1), name: 'Synthetic House' };
const other = { id: id(2), name: 'Synthetic Gate' };
const owner = 'sheets-test@example.iam.gserviceaccount.com';
const date = new Date('2026-07-16T23:30:00Z');
const drive = 'teststagingdrive';

function record(kind, subject, attempt, data) {
  return { key: recordKey(kind, subject, attempt), subject, record: attempt,
    values: columns[kind].map(({ label }) => data[label] ?? null) };
}

function worksheet() {
  const sheet = { properties: { sheetId: 0, sheetType: 'GRID', gridProperties: { rowCount: 1000, columnCount: 26 } },
    data: [{ rowData: [], rowMetadata: [] }] };
  const grid = sheet.data[0];
  const apply = (requests, notesColumn) => {
    for (const request of requests) {
      if (request.setBasicFilter) sheet.basicFilter = request.setBasicFilter.filter;
      if (request.addProtectedRange) sheet.protectedRanges = [{ ...request.addProtectedRange.protectedRange, protectedRangeId: 1 }];
      if (request.updateProtectedRange) sheet.protectedRanges = [request.updateProtectedRange.protectedRange];
      if (request.updateDimensionProperties?.range.dimension === 'ROWS') {
        const { range, properties } = request.updateDimensionProperties;
        grid.rowMetadata[range.startIndex] = properties;
      }
      if (!request.updateCells) continue;
      const { start, rows } = request.updateCells;
      for (const [row, { values }] of rows.entries()) {
        const index = start.rowIndex + row;
        const rowData = grid.rowData[index] ??= { values: [] };
        for (const [col, value] of values.entries()) {
          const column = start.columnIndex + col;
          if (index >= 3) assert.notEqual(column, notesColumn, 'sync writes must never include Working Notes');
          rowData.values[column] = value;
        }
      }
    }
  };
  return { sheet, grid, apply };
}

test('sales rows survive complete row sorting and a replacement buyer cannot inherit either set of historical notes', () => {
  const { sheet, grid, apply } = worksheet();
  const unit = id(21), attempt = id(31), replacement = id(32), unsold = id(22);
  const notesColumn = columns.sales.length;
  const snapshot = (a, buyer) => [record('sales', unit, a, { Unit: '02', 'Buyer names': buyer, 'Sale status': 'Reserved' }),
    record('sales', unsold, null, { Unit: '03', 'Sale status': 'For sale' })];
  apply(planSheet(sheet, 'sales', building, snapshot(attempt, 'First buyer'), owner, date), notesColumn);
  assert.equal(grid.rowData[1].values[1].userEnteredValue.stringValue, 'Last successful sync: 17/07/2026 00:30');
  assert.equal(sheet.protectedRanges[0].warningOnly, false);
  assert.deepEqual(sheet.protectedRanges[0].editors.users, [owner]);
  assert.deepEqual(sheet.protectedRanges[0].unprotectedRanges, [{ sheetId: 0, startRowIndex: 3, endRowIndex: 5, startColumnIndex: notesColumn, endColumnIndex: notesColumn + 1 }]);
  const notes = { userEnteredValue: { stringValue: '16/07/2026 — deposit confirmed\n17/07/2026 — follow-up' } };
  grid.rowData[3].values[notesColumn] = notes;
  [grid.rowData[3], grid.rowData[4]] = [grid.rowData[4], grid.rowData[3]];
  apply(planSheet(sheet, 'sales', building, snapshot(attempt, 'Updated first buyer'), owner, date), notesColumn);
  assert.equal(grid.rowData[4].values[8].userEnteredValue.stringValue, 'Updated first buyer');
  assert.equal(grid.rowData[4].values[notesColumn], notes);
  apply(planSheet(sheet, 'sales', building, snapshot(replacement, 'Next buyer'), owner, date), notesColumn);
  assert.equal(grid.rowData[4].values[2].userEnteredValue.stringValue, 'Historical — no longer current');
  assert.deepEqual(grid.rowData[4].values[8], {});
  assert.equal(grid.rowData[4].values[notesColumn], notes);
  assert.equal(grid.rowData[5].values[8].userEnteredValue.stringValue, 'Next buyer');
  assert.equal(grid.rowData[5].values[notesColumn], undefined);
  const again = planSheet(sheet, 'sales', building, snapshot(replacement, 'Next buyer'), owner, date);
  assert.equal(again.filter((request) => request.updateCells?.start.rowIndex >= 3).length, 0);
  assert.equal(again.some((request) => request.addProtectedRange || request.repeatCell), false);
  assert.equal(grid.rowData.length, 6);
});

test('removed defects are scrubbed, notes stay in place and a late note makes its historical row visible', () => {
  const { sheet, grid, apply } = worksheet();
  const notesColumn = columns.defects.length;
  const defect = record('defects', id(41), id(41), {
    'Flat / communal area': 'Stairwell', Description: '=sensitive', Status: 'Open', 'Portal Comments': '=quoted comment',
  });
  apply(planSheet(sheet, 'defects', building, [defect], owner, date), notesColumn);
  assert.deepEqual(grid.rowData[3].values[3].userEnteredValue, { stringValue: '=sensitive' });
  apply(planSheet(sheet, 'defects', building, [], owner, date), notesColumn);
  assert.equal(grid.rowMetadata[3].hiddenByUser, true);
  assert.deepEqual(grid.rowData[3].values[3], {});
  assert.deepEqual(grid.rowData[3].values[9], {});
  grid.rowData[3].values[notesColumn] = { userEnteredValue: { stringValue: 'Late note for the removed defect' } };
  const next = record('defects', id(42), id(42), { 'Flat / communal area': 'Stairwell', Status: 'Closed' });
  apply(planSheet(sheet, 'defects', building, [next], owner, date), notesColumn);
  assert.equal(grid.rowMetadata[3].hiddenByUser, false);
  assert.equal(grid.rowData[3].values[5].userEnteredValue.stringValue, 'Archived / removed');
  assert.equal(grid.rowData[4].values[notesColumn], undefined);
  assert.throws(() => planSheet(sheet, 'defects', other, [next], owner, date), /valid identity/);
});

test('database migration reads only the leased building and current workflow, with correct comment and deposit associations', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  const migrationDir = new URL('../supabase/migrations/', import.meta.url);
  const migration = readdirSync(migrationDir).find((name) => name.endsWith('_staging_google_sheets_backups.sql'));
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create table buildings(id uuid primary key, name text);
    create table building_floors(building_id uuid, name text, sort_order int);
    create table units(id uuid primary key, building_id uuid, unit_number text, floor text, unit_type_id uuid, unit_type text,
      sale_status text, parking_bays int[], reservation_date date, completion_date date);
    create table unit_types(id uuid, name text);
    create table unit_sale_attempts(id uuid primary key, unit_id uuid, building_id uuid, is_active boolean, is_system_baseline boolean default false,
      workflow_status text, redacted_at timestamptz, buyer_person_name text, buyer_name text, buyer_company_name text, buyer_email text, buyer_phone text,
      buyer_solicitor_name text, reservation_date date, exchanged_at date, completion_notice_issued_at date, contractual_completion_date date,
      legal_completed_at timestamptz, completed_at date);
    create table unit_sale_terms(id uuid, sale_attempt_id uuid, is_current boolean, list_price_at_offer numeric, contract_price numeric,
      developer_contribution numeric, agent_contribution numeric, other_concessions numeric, parking_location_details text, reservation_fee numeric,
      exchange_deposit_percent numeric);
    create table unit_sale_payment_schedule(sale_attempt_id uuid, sale_terms_id uuid, payment_stage text, due_event text, due_offset_days int,
      expected_amount numeric, fixed_amount numeric, percent_of_contract_price numeric);
    create table sale_exchange_deposit_sources(id uuid, sale_attempt_id uuid, expected_amount numeric);
    create table sale_exchange_deposit_receipts(sale_attempt_id uuid, received_date date, revision int);
    create table sale_comments(sale_attempt_id uuid, created_at timestamptz, author_name text, body text, sequence bigint);
    create table snags(id uuid, building_id uuid, source_type text, unit_id uuid, flat_id uuid, area_id uuid, title text, description text,
      status text, created_at timestamptz, assigned_to_organisation_id uuid, trade_id uuid, image_path text);
    create table snag_events(id uuid, snag_id uuid, created_at timestamptz, actor_name text, created_by_user_id uuid, event_type text, comment text);
    create table snag_comments(id uuid, snag_id uuid, created_at timestamptz, user_id uuid, body text);
    create table snag_photos(snag_id uuid, media_type text);
    create table profiles(id uuid, full_name text, name text);
    create table flats(id uuid, building_name text, flat_reference text);
    create table areas(id uuid, building_id uuid, unit_id uuid, name text);
    create table organisations(id uuid, name text);
    create table trades(id uuid, name text);
    alter table units enable row level security;
    alter table unit_sale_attempts enable row level security;
    alter table snags enable row level security;
  `);
  const depositMigration = readFileSync(new URL('20260922d_exchange_deposit_receipts.sql', migrationDir), 'utf8');
  await db.exec(depositMigration.match(/create function public\.sales_exchange_deposit_amount[\s\S]+?\$\$;/)[0]);
  await db.exec(readFileSync(new URL(migration, migrationDir), 'utf8'));
  await db.exec(`
    insert into buildings values ('${building.id}','Synthetic House'), ('${other.id}','Synthetic Gate');
    insert into building_floors values ('${building.id}','Ground',1), ('${building.id}','First',2);
    insert into units(id,building_id,unit_number,floor,sale_status,parking_bays) values
      ('${id(21)}','${building.id}','11','First','exchanged','{4}'), ('${id(22)}','${building.id}','30','Ground','for_sale',null),
      ('${id(23)}','${other.id}','20','Ground','reserved',null);
    insert into unit_sale_attempts(id,unit_id,building_id,is_active,is_system_baseline,workflow_status,buyer_person_name,exchanged_at,completion_notice_issued_at,contractual_completion_date) values
      ('${id(31)}','${id(21)}','${building.id}',false,false,'fallen_through','Former buyer',null,null,null),
      ('${id(32)}','${id(21)}','${building.id}',true,false,'exchanged','Current buyer','2026-07-03','2026-07-07','2026-07-15'),
      ('${id(33)}','${id(22)}','${building.id}',true,true,'draft',null,null,null,null),
      ('${id(34)}','${id(22)}','${other.id}',true,false,'reserved','Wrong-building buyer',null,null,null);
    insert into unit_sale_terms(id,sale_attempt_id,is_current,list_price_at_offer,contract_price,exchange_deposit_percent) values
      ('${id(55)}','${id(32)}',true,300000,290000,10);
    insert into sale_exchange_deposit_sources values ('${id(56)}','${id(32)}',29000);
    insert into sale_exchange_deposit_receipts values ('${id(32)}','2026-07-04',1), ('${id(32)}','2026-07-05',2);
    insert into sale_comments values ('${id(32)}','2026-07-07 13:20Z','Case handler','Old',1), ('${id(32)}','2026-07-08 13:20Z','Solicitor','New',2),
      ('${id(31)}','2026-07-08 13:20Z','Old solicitor','Old sale only',1), ('${id(34)}','2026-07-08 13:20Z','Other staff','Wrong building',3);
    insert into areas values ('${id(61)}','${building.id}','${id(21)}','Hall');
    insert into snags values ('${id(41)}','${building.id}','developer_snag','${id(21)}',null,'${id(61)}','Door','Door will not latch','open','2026-07-16 23:30Z',null,null,null),
      ('${id(42)}','${building.id}','leaseholder_defect',null,null,null,'Resident issue',null,'open',now(),null,null,null),
      ('${id(43)}','${other.id}','developer_snag',null,null,null,'Other defect',null,'open',now(),null,null,null);
    insert into snag_events values ('${id(71)}','${id(41)}','2026-07-17 10:00Z','Engineer',null,'note','Recheck hinge');
    insert into snag_photos values ('${id(41)}','image');
    insert into sheets_backup.buildings(building_id,shared_drive_id,enabled,lease_token,lease_until)
      values ('${building.id}','${drive}',true,'${id(90)}',now()+interval '10 minutes'), ('${other.id}','${drive}',false,null,null);
  `);
  const read = async (buildingId, kind) => (await db.query('select sheets_backup.snapshot($1,$2,$3) as snapshot', [buildingId, kind, id(90)])).rows[0].snapshot;
  await db.exec('set role authenticated');
  await assert.rejects(db.exec('select * from sheets_backup.exports'), /permission denied/);
  await db.exec('reset role; set session authorization sheets_backup_runner');
  await assert.rejects(db.exec('update public.units set sale_status = \'completed\''), /permission denied/);
  await assert.rejects(db.exec('select * from public.unit_sale_attempts'), /permission denied/);
  await assert.rejects(db.exec('insert into public.snags(id) values(gen_random_uuid())'), /permission denied/);
  await assert.rejects(db.exec('update sheets_backup.buildings set enabled = true'), /permission denied/);
  await assert.rejects(read(other.id, 'sales'), /No active export lease/);

  const sales = await read(building.id, 'sales');
  const rows = exportRows('sales', sales, building.id);
  assert.deepEqual(rows.map(({ subject }) => subject), [id(22), id(21)]);
  assert.equal(rows[0].record, null);
  assert.equal(rows[1].record, id(32));
  assert.equal(rows[1].values[8], 'Current buyer');
  assert.equal(rows[1].values[15], 29000);
  assert.equal(sales.rows.find((row) => row.id === id(21)).exchange_received_date, '2026-07-05');
  assert.equal(rows[1].values[21], '08/07/2026 14:20 — Solicitor\nNew\n\n07/07/2026 14:20 — Case handler\nOld');

  const defects = await read(building.id, 'defects');
  assert.deepEqual(defects.rows.map(({ id }) => id), [id(41)]);
  assert.deepEqual([defects.rows[0].location, defects.rows[0].raised_on], ['Hall', '2026-07-17']);
  const snag = exportRows('defects', defects, building.id)[0];
  assert.equal(snag.values[3], 'Door will not latch');
  assert.match(snag.values[8].uri, new RegExp(`^https://staging.bunnywell.co.uk/workspace\\?view=snag&building=${building.id}&snag=${id(41)}$`));
  assert.match(snag.values[9], /Engineer\nRecheck hinge/);
  defects.rows[0].comments[0].body = 'x'.repeat(50_001);
  assert.throws(() => exportRows('defects', defects, building.id), /Portal Comments exceeds the Sheets cell limit/);

  assert.equal((await read(building.id, 'sales')).rows.find((row) => row.id === id(21)).sale_status, 'exchanged');
});

function fixture() {
  const locks = new Set(), state = new Map(), files = new Map(), synced = [];
  const keys = [building, other].map(({ id }) => ({ building_id: id, shared_drive_id: drive, drive_folder_id: 'testdrivefolder' }));
  const store = {
    async targets(id) { return keys.filter((target) => !id || target.building_id === id); },
    async claim(id) { if (!locks.has(id)) { locks.add(id); return keys.find((target) => target.building_id === id); } },
    async release(id) { locks.delete(id); },
    async start(id, kind) {
      const key = `${id}/${kind}`;
      if (!state.has(key)) state.set(key, { spreadsheet_id: null, creation_requested_at: null });
      return state.get(key);
    },
    async snapshot(id) { return { building: id === building.id ? building : other, rows: [] }; },
    async creationStarted(id, kind) { state.get(`${id}/${kind}`).creation_requested_at = new Date(); },
    async saveSpreadsheet(id, kind, spreadsheet) {
      Object.assign(state.get(`${id}/${kind}`), { spreadsheet_id: spreadsheet, creation_requested_at: null });
    },
    async finish(id, kind, _, result) { Object.assign(state.get(`${id}/${kind}`), { result }); },
  };
  const google = {
    async verifyDrive() {}, async ensureFolder() {}, async verifySpreadsheet() {},
    async findSpreadsheet(_, __, id, kind) { return files.get(`${id}/${kind}`) || null; },
    async createSpreadsheet(_, __, building, kind) {
      const result = `testsheetid${files.size}`;
      files.set(`${building.id}/${kind}`, result);
      return result;
    },
    async updateSpreadsheet(id) { synced.push(id); },
  };
  return { store, google, locks, state, files, synced };
}

test('ambiguous creation and overlapping runs cannot duplicate spreadsheets; both kinds report independently', async () => {
  const { store, google, locks, state, files, synced } = fixture();
  const create = google.createSpreadsheet;
  let loseResponse = true;
  google.createSpreadsheet = async (...args) => {
    const result = await create(...args);
    if (loseResponse && args[2].id === building.id && args[3] === 'sales') {
      loseResponse = false;
      throw new GoogleError('spreadsheet creation', 503, true);
    }
    return result;
  };
  const report = await runBackups(store, () => google, { buildingId: null, kind: null });
  assert.deepEqual(report.map(({ status }) => status), ['failed', 'succeeded', 'succeeded', 'succeeded']);
  assert.equal(state.get(`${building.id}/sales`).result.status, 'failed');
  assert.equal(files.size, 4);
  assert.equal(synced.length, 3);
  assert.deepEqual((await runBackups(store, () => google, { buildingId: building.id, kind: null })).map(({ status }) => status), ['busy', 'busy']);
  locks.delete(building.id); // Simulate the lease expiring.
  assert.deepEqual((await runBackups(store, () => google, { buildingId: building.id, kind: null })).map(({ status }) => status), ['succeeded', 'succeeded']);
  assert.equal(files.size, 4);
});

test('missing Google credentials and a different Supabase project fail closed', async () => {
  const { store, files } = fixture();
  const report = await runBackups(store, () => new Google(undefined, new AbortController().signal), { buildingId: building.id, kind: null });
  assert.ok(report.every(({ status, error }) => status === 'failed' && error === 'Google service-account credentials are missing.'));
  assert.equal(files.size, 0);
  assert.throws(() => stagingDatabaseUrl('postgresql://sheets_backup_runner:fake@db.different.supabase.co:5432/postgres'), /restricted Bunnywell staging/);
  assert.throws(() => stagingDatabaseUrl(`postgresql://postgres:fake@db.${STAGING_REF}.supabase.co:5432/postgres`), /restricted Bunnywell staging/);
  assert.doesNotThrow(() => stagingDatabaseUrl(`postgresql://sheets_backup_runner.${STAGING_REF}:fake@aws-0-eu-central-1.pooler.supabase.com:6543/postgres`));
});

test('Google permission and sheet checks fail before business data is sent, and a successful batch carries the timestamp with the cells', async () => {
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  const credential = JSON.stringify({ type: 'service_account', client_email: owner, private_key: privateKey });
  const { sheet, grid, apply } = worksheet();
  const now = new Date('2026-11-23T22:30:00Z');
  const sheetId = 'testSpreadsheet';
  let permission = 'anyone';
  let extraTab = true;
  let failWrite = true;
  let writeCount = 0;
  const transport = async (input, init) => {
    const url = new URL(input);
    if (url.origin === 'https://oauth2.googleapis.com') {
      const jwt = init.body.get('assertion');
      const claims = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url'));
      assert.equal(claims.iss, owner);
      assert.match(claims.scope, /drive\.file.*drive\.readonly/);
      return Response.json({ access_token: 'synthetic-oauth-token' });
    }
    assert.equal(init.headers.Authorization, 'Bearer synthetic-oauth-token');
    if (url.pathname === `/drive/v3/drives/${drive}`) return Response.json({ id: drive, restrictions: { driveMembersOnly: true } });
    if (url.pathname === `/drive/v3/files/${drive}/permissions`) return Response.json({ permissions: [{ type: permission }] });
    if (url.pathname === `/v4/spreadsheets/${sheetId}`) return Response.json({ sheets: extraTab ? [sheet, sheet] : [sheet] });
    assert.equal(url.href, `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}:batchUpdate`);
    writeCount++;
    if (failWrite) return new Response('', { status: 400 });
    apply(JSON.parse(init.body).requests, columns.defects.length);
    return Response.json({ replies: [] });
  };
  const google = new Google(credential, new AbortController().signal, transport);
  await assert.rejects(google.verifyDrive(drive), /domain-wide or public access/);
  permission = 'group';
  await google.verifyDrive(drive);
  const rows = [record('defects', id(41), id(41), { 'Defect title': 'Example snag', Status: 'Open' })];
  await assert.rejects(google.updateSpreadsheet(sheetId, 'defects', building, rows, now), /exactly one worksheet/);
  assert.equal(writeCount, 0);
  extraTab = false;
  await assert.rejects(google.updateSpreadsheet(sheetId, 'defects', building, rows, now), /HTTP 400/);
  assert.equal(grid.rowData.length, 0);
  failWrite = false;
  await google.updateSpreadsheet(sheetId, 'defects', building, rows, now);
  assert.equal(grid.rowData[1].values[1].userEnteredValue.stringValue, 'Last successful sync: 23/11/2026 22:30');
  assert.equal(grid.rowData[3].values[2].userEnteredValue.stringValue, 'Example snag');
});
