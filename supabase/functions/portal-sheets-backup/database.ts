import postgres from "npm:postgres@3.4.9";
import { BackupError, stagingDatabaseUrl, type Kind, type Snapshot } from "./model.ts";

type Target = { building_id: string; shared_drive_id: string; drive_folder_id: string | null };
type ExportState = { spreadsheet_id: string | null; creation_requested_at: Date | null };
type Result = { status: "succeeded"; completedAt: Date; count: number } | { status: "failed"; error: string };

export function openDatabase(setting: string | undefined) {
  const sql = postgres(stagingDatabaseUrl(setting), {
    max: 2, prepare: false, connect_timeout: 5, ssl: { rejectUnauthorized: true }, onnotice: () => {},
  });
  return {
    close: () => sql.end({ timeout: 2 }),
    targets: (buildingId: string | null) => sql<Target[]>`
      select building_id, shared_drive_id, drive_folder_id from sheets_backup.buildings
      where enabled and (${buildingId}::uuid is null or building_id = ${buildingId}::uuid) order by building_id`,
    async claim(buildingId: string, token: string) {
      const [row] = await sql<Target[]>`
        update sheets_backup.buildings set lease_token = ${token}, lease_until = statement_timestamp() + interval '10 minutes'
        where building_id = ${buildingId} and enabled and (lease_until is null or lease_until <= statement_timestamp())
        returning building_id, shared_drive_id, drive_folder_id`;
      return row;
    },
    async release(buildingId: string, token: string) {
      await sql`update sheets_backup.buildings set lease_token = null, lease_until = null
        where building_id = ${buildingId} and lease_token = ${token}`;
    },
    async saveFolder(buildingId: string, token: string, folder: string) {
      await requireChange(sql`update sheets_backup.buildings set drive_folder_id = ${folder}
        where building_id = ${buildingId} and drive_folder_id is null and lease_token = ${token} and lease_until > statement_timestamp()`);
    },
    async start(buildingId: string, kind: Kind, token: string) {
      const [row] = await sql<ExportState[]>`
        insert into sheets_backup.exports (building_id, kind, last_attempt_at, status)
        select building_id, ${kind}, statement_timestamp(), 'running' from sheets_backup.buildings
        where building_id = ${buildingId} and lease_token = ${token} and lease_until > statement_timestamp()
        on conflict (building_id, kind) do update set last_attempt_at = excluded.last_attempt_at, status = 'running', error = null
        returning spreadsheet_id, creation_requested_at`;
      if (!row) throw new BackupError("The building export lease expired or was disabled.");
      return row;
    },
    async snapshot(buildingId: string, kind: Kind, token: string) {
      const [data] = await sql<{ data: Snapshot }[]>`select sheets_backup.snapshot(${buildingId}, ${kind}, ${token}) as data`;
      return data.data;
    },
    async creationStarted(buildingId: string, kind: Kind, token: string) {
      await requireChange(sql`update sheets_backup.exports set creation_requested_at = statement_timestamp()
        where building_id = ${buildingId} and kind = ${kind} and spreadsheet_id is null and creation_requested_at is null
        and exists (select 1 from sheets_backup.buildings b where b.building_id = ${buildingId} and b.lease_token = ${token}
          and b.lease_until > statement_timestamp())`);
    },
    async saveSpreadsheet(buildingId: string, kind: Kind, token: string, spreadsheetId: string | null) {
      await requireChange(sql`update sheets_backup.exports set spreadsheet_id = ${spreadsheetId}, creation_requested_at = null
        where building_id = ${buildingId} and kind = ${kind} and spreadsheet_id is null
        and exists (select 1 from sheets_backup.buildings b where b.building_id = ${buildingId} and b.lease_token = ${token}
          and b.lease_until > statement_timestamp())`);
    },
    async finish(buildingId: string, kind: Kind, token: string, result: Result) {
      await requireChange(sql`update sheets_backup.exports set status = ${result.status}, error = ${result.status === "failed" ? result.error : null},
        last_success_at = coalesce(${result.status === "succeeded" ? result.completedAt : null}::timestamptz, last_success_at),
        row_count = coalesce(${result.status === "succeeded" ? result.count : null}::integer, row_count)
        where building_id = ${buildingId} and kind = ${kind}
        and exists (select 1 from sheets_backup.buildings b where b.building_id = ${buildingId} and b.lease_token = ${token}
          and b.lease_until > statement_timestamp())`);
    },
  };
}

async function requireChange(query: PromiseLike<{ count: number }>) {
  if ((await query).count !== 1) throw new BackupError("The export state changed or its lease expired.");
}

export type Store = Omit<ReturnType<typeof openDatabase>, "close">;
