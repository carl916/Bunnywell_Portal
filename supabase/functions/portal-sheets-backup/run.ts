import type { Store } from "./database.ts";
import { type Google, GoogleError } from "./google.ts";
import { BackupError, driveId, exportRows, kinds, type Kind } from "./model.ts";

export type Scope = { buildingId: string | null; kind: Kind | null };
type Status = { buildingId: string; kind: Kind; status: "succeeded" | "failed" | "busy"; spreadsheetId?: string; error?: string };
type GoogleClient = Pick<Google, "verifyDrive" | "reserveFolderId" | "ensureFolder" | "findSpreadsheet" | "createSpreadsheet" | "verifySpreadsheet" | "updateSpreadsheet">;

export function safeError(error: unknown) {
  if (error instanceof BackupError) return error.message;
  if (error instanceof DOMException && ["TimeoutError", "AbortError"].includes(error.name)) return "The export exceeded its time limit.";
  return "The scoped database or backup worker failed. Check the staging configuration and database logs.";
}

function logStatus(status: Status) {
  const { buildingId, kind, error } = status;
  if (status.status === "failed") console.error(JSON.stringify({ component: "portal-sheets-backup", buildingId, kind, error }));
}

export async function runBackups(store: Store, getGoogle: () => GoogleClient, scope: Scope, now = () => new Date()) {
  const targets = await store.targets(scope.buildingId);
  const selected = scope.kind ? [scope.kind] : kinds;
  const output: Status[] = [];

  async function runBuilding(buildingId: string): Promise<Status[]> {
    const token = crypto.randomUUID();
    const statuses: Status[] = [];
    let target;
    try { target = await store.claim(buildingId, token); } catch (error) {
      return selected.map((kind) => ({ buildingId, kind, status: "failed", error: safeError(error) }));
    }
    if (!target) return selected.map((kind) => ({ buildingId, kind, status: "busy" }));

    const sharedDrive = target.shared_drive_id;
    let folderId = target.drive_folder_id;
    let verifiedFolder: Promise<string> | undefined;
    let ambiguousWrite = false;
    try {
      for (const kind of selected) {
        let spreadsheetId: string | null = null;
        let sheetWritten = false;
        try {
          const state = await store.start(buildingId, kind, token);
          spreadsheetId = state.spreadsheet_id;
          const google = getGoogle();
          const snapshot = await store.snapshot(buildingId, kind, token);
          const records = exportRows(kind, snapshot, buildingId);
          const folder = await (verifiedFolder ??= (async () => {
            if (!driveId.test(sharedDrive) || (folderId && !driveId.test(folderId))) throw new BackupError("The staging Drive IDs are invalid.");
            await google.verifyDrive(sharedDrive);
            if (!folderId) {
              folderId = await google.reserveFolderId();
              await store.saveFolder(buildingId, token, folderId);
            }
            await google.ensureFolder(folderId, sharedDrive, snapshot.building);
            return folderId;
          })());

          if (!spreadsheetId) {
            spreadsheetId = await google.findSpreadsheet(sharedDrive, folder, buildingId, kind);
            if (!spreadsheetId) {
              if (state.creation_requested_at) throw new BackupError("An earlier Drive creation has an unknown outcome. Check the staging Drive before resetting its marker.");
              await store.creationStarted(buildingId, kind, token);
              try { spreadsheetId = await google.createSpreadsheet(sharedDrive, folder, snapshot.building, kind); }
              catch (error) {
                if (error instanceof GoogleError && error.createRejected) await store.saveSpreadsheet(buildingId, kind, token, null);
                throw error;
              }
            }
            await store.saveSpreadsheet(buildingId, kind, token, spreadsheetId);
          }
          if (!driveId.test(spreadsheetId)) throw new BackupError("The configured spreadsheet ID is invalid.");
          await google.verifySpreadsheet(spreadsheetId, sharedDrive, folder, buildingId, kind);
          const completedAt = now();
          await google.updateSpreadsheet(spreadsheetId, kind, snapshot.building, records, completedAt);
          sheetWritten = true;
          await store.finish(buildingId, kind, token, { status: "succeeded", completedAt, count: records.length });
          statuses.push({ buildingId, kind, status: "succeeded", spreadsheetId });
        } catch (cause) {
          if (cause instanceof GoogleError && cause.uncertainWrite) ambiguousWrite = true;
          let error = sheetWritten ? "The worksheet was updated, but staging could not record its success." : safeError(cause);
          try { await store.finish(buildingId, kind, token, { status: "failed", error }); }
          catch { error += " The failure status could not be saved."; }
          statuses.push({ buildingId, kind, status: "failed", spreadsheetId: spreadsheetId ?? undefined, error });
        }
      }
    } finally {
      // Google may still be applying an unacknowledged write. Keep this lease
      // longer than the Sheets API processing limit before letting another worker write.
      if (!ambiguousWrite) {
        try { await store.release(buildingId, token); }
        catch { console.error(JSON.stringify({ component: "portal-sheets-backup", buildingId, error: "Could not release the lease. It will expire." })); }
      }
    }
    return statuses;
  }

  for (let i = 0; i < targets.length; i += 2) {
    const group = await Promise.all(targets.slice(i, i + 2).map(({ building_id }) => runBuilding(building_id)));
    for (const result of group.flat()) {
      logStatus(result);
      output.push(result);
    }
  }
  return output;
}
