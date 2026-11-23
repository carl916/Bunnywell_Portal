import { BackupError, backupType, driveId, type Kind, type RecordRow } from "./model.ts";
import { planSheet, type Worksheet } from "./sheet.ts";

const driveApi = "https://www.googleapis.com/drive/v3/";
const sheetsApi = "https://sheets.googleapis.com/v4/spreadsheets/";
const tokenUrl = "https://oauth2.googleapis.com/token";
const scope = "https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.readonly";
const folderType = "application/vnd.google-apps.folder";
const sheetType = "application/vnd.google-apps.spreadsheet";
const fileFields = "id,driveId,parents,mimeType,trashed,appProperties";
const textEncoder = new TextEncoder();

type DriveFile = { id: string; driveId: string; parents: string[]; mimeType: string; trashed?: boolean; appProperties?: Record<string, string> };

export class GoogleError extends BackupError {
  private action: string;
  readonly status: number;
  readonly transient: boolean;

  constructor(action: string, status: number, transient: boolean) {
    super(status ? `Google ${action} failed (HTTP ${status}).` : `Google ${action} request timed out or could not connect.`);
    this.action = action;
    this.status = status;
    this.transient = transient;
  }

  get createRejected() {
    return this.status >= 400 && this.status < 500 && this.status !== 408;
  }

  get uncertainWrite() {
    return (this.action === "worksheet update" || this.action === "spreadsheet creation") && !this.createRejected;
  }
}

function base64url(data: Uint8Array) {
  return btoa(String.fromCharCode(...data)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function tags(buildingId: string, kind: Kind | "folder") {
  return { portal_backup: "bunnywell-staging", building: buildingId, backup_kind: kind };
}

function verifyFile(file: DriveFile, expected: { sharedDrive: string; parent: string; building: string; kind: Kind | "folder" }) {
  const properties = tags(expected.building, expected.kind);
  if (!driveId.test(file.id) || file.trashed || file.driveId !== expected.sharedDrive || !file.parents?.includes(expected.parent)
    || file.mimeType !== (expected.kind === "folder" ? folderType : sheetType)
    || Object.entries(properties).some(([key, value]) => file.appProperties?.[key] !== value)) {
    throw new BackupError("Drive file is unavailable or does not match the configured staging backup.");
  }
}

export class Google {
  private token?: Promise<string>;
  private readonly privateKey: string;
  private readonly signal: AbortSignal;
  private readonly send: typeof fetch;
  readonly email: string;

  constructor(credentials: string | undefined, signal: AbortSignal, send: typeof fetch = fetch) {
    if (!credentials) throw new BackupError("Google service-account credentials are missing.");
    let key: { type?: string; client_email?: string; private_key?: string };
    try { key = JSON.parse(credentials); } catch { throw new BackupError("Google service-account credentials are invalid."); }
    if (key?.type !== "service_account" || typeof key.client_email !== "string" || !key.client_email.endsWith(".gserviceaccount.com")
      || typeof key.private_key !== "string" || !key.private_key) {
      throw new BackupError("Google service-account credentials are invalid.");
    }
    this.email = key.client_email;
    this.privateKey = key.private_key;
    this.signal = signal;
    this.send = send;
  }

  private async accessToken() {
    const now = Math.floor(Date.now() / 1000);
    const header = base64url(textEncoder.encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
    const claims = base64url(textEncoder.encode(JSON.stringify({ iss: this.email, scope, aud: tokenUrl, iat: now, exp: now + 3600 })));
    const message = `${header}.${claims}`;
    let signature: ArrayBuffer;
    try {
      const bytes = Uint8Array.from(atob(this.privateKey.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, "")), (c) => c.charCodeAt(0));
      const key = await crypto.subtle.importKey("pkcs8", bytes, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
      signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, textEncoder.encode(message));
    } catch { throw new BackupError("Google service-account private key is invalid."); }
    const response = await this.request<{ access_token?: string }>("token", tokenUrl, {
      method: "POST", body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${message}.${base64url(new Uint8Array(signature))}` }),
    });
    if (!response.access_token) throw new BackupError("Google did not issue an access token.");
    return response.access_token;
  }

  private async request<T>(action: string, url: string, init: RequestInit = {}, retries = 2): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      this.signal.throwIfAborted();
      try {
        const response = await this.send(url, { ...init, redirect: "error", signal: AbortSignal.any([this.signal, AbortSignal.timeout(8_000)]) });
        if (response.ok) return await response.json() as T;
        let rateLimit = false;
        if (response.status === 403) {
          const payload = await response.json().catch(() => ({}));
          rateLimit = (payload.error?.errors ?? []).some((entry: { reason?: string }) =>
            entry.reason === "rateLimitExceeded" || entry.reason === "userRateLimitExceeded");
        } else await response.body?.cancel();
        throw new GoogleError(action, response.status, rateLimit || [408, 429, 500, 502, 503, 504].includes(response.status));
      } catch (caught) {
        const error = caught instanceof GoogleError ? caught : new GoogleError(action, 0, true);
        if (!error.transient || attempt >= retries) throw error;
        await new Promise((resolve) => setTimeout(resolve, 250 * (2 ** attempt) + Math.random() * 150));
      }
    }
  }

  private async api<T>(action: string, baseUrl: string, path: string, params: Record<string, string> = {}, body?: object, retries?: number) {
    const url = new URL(`./${path}`, baseUrl);
    url.search = new URLSearchParams(params).toString();
    const token = await (this.token ??= this.accessToken());
    return await this.request<T>(action, url.href, {
      method: body ? "POST" : "GET", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    }, retries);
  }

  async verifyPrivate(fileId: string) {
    let pageToken: string | undefined;
    do {
      const result: { permissions?: { type: string; deleted?: boolean }[]; nextPageToken?: string } = await this.api(
        "Drive permission check", driveApi, `files/${fileId}/permissions`,
        { supportsAllDrives: "true", fields: "nextPageToken,permissions(type,deleted)", pageSize: "100", ...(pageToken ? { pageToken } : {}) },
      );
      if (result.permissions?.some(({ type, deleted }) => !deleted && type !== "user" && type !== "group")) {
        throw new BackupError("Drive destination allows domain-wide or public access.");
      }
      pageToken = result.nextPageToken;
    } while (pageToken);
  }

  async verifyDrive(id: string) {
    const drive = await this.api<{ id: string; restrictions?: { driveMembersOnly?: boolean } }>(
      "shared-drive check", driveApi, `drives/${id}`, { fields: "id,restrictions(driveMembersOnly)" },
    );
    if (drive.id !== id || drive.restrictions?.driveMembersOnly !== true) {
      throw new BackupError("Configure the staging shared drive to restrict access to drive members.");
    }
    await this.verifyPrivate(id);
  }

  async reserveFolderId() {
    const result = await this.api<{ ids: string[] }>("Drive ID reservation", driveApi, "files/generateIds", { count: "1", space: "drive" });
    const id = result.ids?.[0];
    if (!id || !driveId.test(id)) throw new BackupError("Drive did not issue a valid folder ID.");
    return id;
  }

  private getFile(id: string) {
    return this.api<DriveFile>("Drive file lookup", driveApi, `files/${id}`, { supportsAllDrives: "true", fields: fileFields });
  }

  async ensureFolder(id: string, sharedDrive: string, building: { id: string; name: string }) {
    let file: DriveFile;
    try { file = await this.getFile(id); } catch (error) {
      if (!(error instanceof GoogleError && error.status === 404)) throw error;
      try {
        file = await this.api("Drive folder creation", driveApi, "files", { supportsAllDrives: "true", fields: fileFields }, {
          id, name: building.name, mimeType: folderType, parents: [sharedDrive], appProperties: tags(building.id, "folder"),
        });
      } catch (createError) {
        if (!(createError instanceof GoogleError && createError.status === 409)) throw createError;
        file = await this.getFile(id);
      }
    }
    verifyFile(file, { sharedDrive, parent: sharedDrive, building: building.id, kind: "folder" });
    await this.verifyPrivate(id);
  }

  async findSpreadsheet(sharedDrive: string, folder: string, building: string, kind: Kind) {
    const markers = Object.entries(tags(building, kind)).map(([key, value]) => `appProperties has { key='${key}' and value='${value}' }`);
    const result = await this.api<{ files?: DriveFile[]; nextPageToken?: string; incompleteSearch?: boolean }>("spreadsheet lookup", driveApi, "files", {
      supportsAllDrives: "true", includeItemsFromAllDrives: "true", corpora: "drive", driveId: sharedDrive,
      q: [`'${folder}' in parents`, "trashed=false", ...markers].join(" and "),
      fields: `nextPageToken,incompleteSearch,files(${fileFields})`, pageSize: "100",
    });
    if (result.nextPageToken || result.incompleteSearch || (result.files?.length ?? 0) > 1) {
      throw new BackupError("Drive lookup could not establish a unique spreadsheet for this export.");
    }
    const file = result.files?.[0];
    if (!file) return null;
    verifyFile(file, { sharedDrive, parent: folder, building, kind });
    return file.id;
  }

  async createSpreadsheet(sharedDrive: string, folder: string, building: { id: string; name: string }, kind: Kind) {
    // Drive does not support pre-generated IDs for native Sheets. The DB marks
    // this request before dispatch, so an uncertain response cannot cause a duplicate.
    const file = await this.api<DriveFile>("spreadsheet creation", driveApi, "files", { supportsAllDrives: "true", fields: fileFields }, {
      name: `${building.name} — ${backupType[kind]}`, mimeType: sheetType, parents: [folder], appProperties: tags(building.id, kind),
    }, 0);
    verifyFile(file, { sharedDrive, parent: folder, building: building.id, kind });
    return file.id;
  }

  async verifySpreadsheet(id: string, sharedDrive: string, folder: string, building: string, kind: Kind) {
    verifyFile(await this.getFile(id), { sharedDrive, parent: folder, building, kind });
    await this.verifyPrivate(id);
  }

  async updateSpreadsheet(id: string, kind: Kind, building: { id: string; name: string }, records: RecordRow[], syncTime: Date) {
    for (let attempt = 0; ; attempt++) {
      const result = await this.api<{ sheets: Worksheet[] }>("worksheet read", sheetsApi, id, {
        fields: "sheets(properties(sheetId,sheetType,gridProperties(rowCount,columnCount)),basicFilter,protectedRanges,data(rowData(values(userEnteredValue,textFormatRuns(startIndex,format(link(uri)))),rowMetadata(hiddenByUser)))",
      });
      if (result.sheets?.length !== 1 || result.sheets[0].properties.sheetType !== "GRID") {
        throw new BackupError("The backup spreadsheet must contain exactly one worksheet.");
      }
      const requests = planSheet(result.sheets[0], kind, building, records, this.email, syncTime);
      const body = { requests, includeSpreadsheetInResponse: false };
      if (textEncoder.encode(JSON.stringify(body)).length > 1_800_000) {
        throw new BackupError("Export exceeds the configured size for an atomic Sheets update.");
      }
      try {
        await this.api("worksheet update", sheetsApi, `${id}:batchUpdate`, {}, body, 0);
        return;
      } catch (error) {
        if (!(error instanceof GoogleError && error.transient && !error.uncertainWrite) || attempt >= 1) throw error;
        // A rejected quota-limited request can be retried. An ambiguous write keeps the DB lease until it expires.
        await new Promise((resolve) => setTimeout(resolve, 500 + Math.random() * 150));
      }
    }
  }
}
