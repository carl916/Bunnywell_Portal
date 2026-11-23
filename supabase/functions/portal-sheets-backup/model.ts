import { saleStatusLabel, sortUnitsByBuildingFloorOrder } from "../../../src/lib/units/commercial-allocation.ts";
import type { UnitSaleStatus } from "../../../src/lib/data/production.ts";

export const STAGING_REF = "vxkpvdtrldwwqiddoyof";
export const STAGING_URL = `https://${STAGING_REF}.supabase.co`;
export const kinds = ["sales", "defects"] as const;
export type Kind = typeof kinds[number];
export const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export const driveId = /^[\w-]{10,120}$/;
export const backupType = { sales: "Sales Backup", defects: "Defects Backup" };

export class BackupError extends Error {}

export function stagingDatabaseUrl(setting?: string) {
  let url: URL;
  try { url = new URL(setting || ""); } catch { throw new BackupError("Staging backup database connection is not configured."); }
  const direct = url.hostname === `db.${STAGING_REF}.supabase.co` && url.port === "5432" && url.username === "sheets_backup_runner";
  const pooled = url.hostname.endsWith(".pooler.supabase.com") && url.port === "6543" && url.username === `sheets_backup_runner.${STAGING_REF}`;
  if (url.protocol !== "postgresql:" || url.pathname !== "/postgres" || !url.password || url.search || url.hash || !(direct || pooled)) {
    throw new BackupError("The database connection must use the restricted Bunnywell staging backup role.");
  }
  return url.href;
}

type Comment = { at: string; author: string | null; body: string };
type Building = { id: string; name: string };
type Floor = { building_id: string; name: string; sort_order: number };
type BaseRow = { id: string; building_id: string; comments: Comment[] };
type SaleRow = BaseRow & {
  unit_number: string; floor: string | null; unit_type: string | null; sale_status: UnitSaleStatus;
  record_id: string | null; workflow_status: string | null;
  list_price: number | null; contract_price: number | null; developer_contribution: number | null;
  agent_contribution: number | null; other_concessions: number | null; parking_bays: number[] | null;
  parking_location: string | null; buyer: string | null; company: string | null; email: string | null;
  phone: string | null; solicitor: string | null; reservation_date: string | null; reservation_fee: number | null;
  exchange_due: number | null; exchange_received_date: string | null; exchange_date: string | null;
  notice_date: string | null; completion_deadline: string | null; completion_date: string | null;
};
type DefectRow = BaseRow & {
  unit_id: string | null; flat_or_area: string | null; location: string | null; title: string;
  description: string | null; raised_on: string; status: string; contractor: string | null;
  trade: string | null; has_photos: boolean;
};

export type Snapshot = { building: Building; floors?: Floor[]; rows: SaleRow[] | DefectRow[] };
export type Value = string | number | null | { text: string; uri: string };
export type RecordRow = { key: string; subject: string; record: string | null; values: Value[] };
type Column = { label: string; width: number; format?: "date" | "currency" };

export const columns: Record<Kind, Column[]> = {
  sales: [
    { label: "Unit", width: 90 }, { label: "Unit type", width: 125 },
    { label: "Sale status", width: 142 }, { label: "Sale stage", width: 154 },
    { label: "List price", width: 110, format: "currency" }, { label: "Contract price", width: 119, format: "currency" },
    { label: "Incentives", width: 190 }, { label: "Parking", width: 170 },
    { label: "Buyer names", width: 160 }, { label: "Buyer company", width: 160 },
    { label: "Buyer email", width: 190 }, { label: "Buyer telephone", width: 140 },
    { label: "Buyer’s solicitor", width: 158 }, { label: "Reservation date", width: 125, format: "date" },
    { label: "Reservation fee", width: 121, format: "currency" },
    { label: "Exchange deposit expected", width: 136, format: "currency" },
    { label: "Exchange deposit received on", width: 144, format: "date" },
    { label: "Exchange date", width: 114, format: "date" }, { label: "Notice issue date", width: 126, format: "date" },
    { label: "Completion deadline", width: 145, format: "date" }, { label: "Completion date", width: 127, format: "date" },
    { label: "Portal Comments", width: 380 },
  ],
  defects: [
    { label: "Flat / communal area", width: 148 }, { label: "Room / location", width: 170 },
    { label: "Defect title", width: 210 }, { label: "Description", width: 320 },
    { label: "Date raised", width: 110, format: "date" }, { label: "Status", width: 132 },
    { label: "Assigned contractor", width: 152 }, { label: "Trade", width: 130 },
    { label: "Photos", width: 140 }, { label: "Portal Comments", width: 380 },
  ],
};

const londonDate = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit",
});
const londonTime = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});
const money = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" });

export function formatLondon(instant: Date | string) {
  const date = new Date(instant);
  return `${londonDate.format(date)} ${londonTime.format(date)}`;
}

function sheetDate(date: string | null) {
  if (!date) return null;
  return (Date.parse(`${date}T00:00:00Z`) - Date.UTC(1899, 11, 30)) / 86_400_000;
}

function portalComments(comments: Comment[]) {
  return comments.map(({ at, author, body }) => `${formatLondon(at)} — ${author || "Author unavailable"}\n${body}`).join("\n\n") || null;
}

const salesStages: Record<string, string> = {
  draft: "Sale preparation", awaiting_approval: "Reservation submitted", approved: "Reservation approved",
  reservation_query_raised: "Reservation query", ready_for_exchange: "Ready for exchange",
};

function displayStatus(value: string) {
  return value.replace(/_/g, " ").replace(/^./, (first) => first.toUpperCase());
}

function saleValues(row: SaleRow): Value[] {
  const contributions = [
    ["Developer", row.developer_contribution], ["Sales agent", row.agent_contribution], ["Other", row.other_concessions],
  ] as const;
  const incentives = contributions.flatMap(([label, amount]) => amount ? [`${label} ${money.format(amount)}`] : []).join("\n");
  const parking = [...new Set([...(row.parking_bays || []), row.parking_location].filter(Boolean))].join("\n");
  return [
    row.unit_number, row.unit_type, saleStatusLabel(row.sale_status) ?? displayStatus(row.sale_status),
    row.workflow_status ? salesStages[row.workflow_status] ?? displayStatus(row.workflow_status) : null,
    row.list_price, row.contract_price, incentives || null, parking || null,
    row.buyer, row.company, row.email, row.phone, row.solicitor, sheetDate(row.reservation_date), row.reservation_fee,
    row.exchange_due, sheetDate(row.exchange_received_date), sheetDate(row.exchange_date), sheetDate(row.notice_date),
    sheetDate(row.completion_deadline), sheetDate(row.completion_date), portalComments(row.comments),
  ];
}

function defectValues(row: DefectRow): Value[] {
  const params = new URLSearchParams({ view: "snag", building: row.building_id, snag: row.id });
  return [row.flat_or_area, row.location, row.title, row.description, sheetDate(row.raised_on), displayStatus(row.status),
    row.contractor, row.trade, row.has_photos ? { text: "View in portal", uri: `https://staging.bunnywell.co.uk/workspace?${params}` } : null,
    portalComments(row.comments)];
}

export function recordKey(kind: Kind, subject: string, record: string | null) {
  if (kind === "defects") return subject;
  return record ? `${subject}:${record}` : subject;
}

export function exportRows(kind: Kind, snapshot: Snapshot, buildingId: string): RecordRow[] {
  if (snapshot.building.id !== buildingId || snapshot.rows.some((row) => row.building_id !== buildingId)) {
    throw new BackupError("Snapshot belongs to a different building.");
  }
  const data = kind === "sales"
    ? sortUnitsByBuildingFloorOrder(snapshot.rows as SaleRow[], snapshot.floors || [], [snapshot.building]).map((row) => ({
      // A system draft can become the first real reservation without changing its attempt ID.
      key: recordKey(kind, row.id, row.record_id), subject: row.id, record: row.record_id, values: saleValues(row),
    }))
    : (snapshot.rows as DefectRow[]).map((row) => ({
      key: recordKey(kind, row.id, row.id), subject: row.id, record: row.id, values: defectValues(row),
    }));
  if (new Set(data.map((row) => row.subject)).size !== data.length) throw new BackupError("Snapshot contains duplicate records.");
  for (const row of data) {
    for (const [index, value] of row.values.entries()) {
      if (typeof value === "string" && value.length > 50_000) {
        throw new BackupError(`${columns[kind][index].label} exceeds the Sheets cell limit (record ${row.subject}).`);
      }
      if (typeof value === "number" && !Number.isFinite(value)) throw new BackupError("Invalid numeric source value.");
    }
  }
  return data;
}
