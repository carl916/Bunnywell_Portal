import { BackupError, backupType, columns, formatLondon, type Kind, recordKey, type RecordRow, uuid, type Value } from "./model.ts";

const headerRow = 2;
const dataStart = headerRow + 1;
const protectionName = "Bunnywell portal-managed cells";

type TextRun = { startIndex?: number; format?: { link?: { uri: string } } };
type Cell = {
  userEnteredValue?: { stringValue?: string; numberValue?: number; boolValue?: boolean; formulaValue?: string };
  textFormatRuns?: TextRun[];
};
type GridRange = { sheetId?: number; startRowIndex?: number; endRowIndex?: number; startColumnIndex?: number; endColumnIndex?: number };
type Protection = {
  protectedRangeId?: number; description?: string; range?: GridRange; warningOnly?: boolean;
  editors?: { users?: string[]; groups?: string[]; domainUsersCanEdit?: boolean };
  unprotectedRanges?: GridRange[];
};
type Filter = { range: GridRange; [key: string]: unknown };
export type Worksheet = {
  properties: { sheetId: number; sheetType: string; gridProperties: { rowCount: number; columnCount: number } };
  data?: { rowData?: { values?: Cell[] }[]; rowMetadata?: { hiddenByUser?: boolean }[] }[];
  basicFilter?: Filter;
  protectedRanges?: Protection[];
};
export type SheetRequest = Record<string, unknown>;

function rowCell(value: Value): Cell {
  if (value === null || value === "") return {};
  if (typeof value === "number") return { userEnteredValue: { numberValue: value } };
  if (typeof value === "string") return { userEnteredValue: { stringValue: value } };
  return { userEnteredValue: { stringValue: value.text }, textFormatRuns: [{ startIndex: 0, format: { link: { uri: value.uri } } }] };
}

function text(cell?: Cell) {
  return cell?.userEnteredValue?.stringValue;
}

function hasValue(cell?: Cell) {
  return cell?.userEnteredValue !== undefined && text(cell) !== "";
}

function equalCell(before: Cell | undefined, after: Cell) {
  return (before?.userEnteredValue?.stringValue ?? "") === (after.userEnteredValue?.stringValue ?? "")
    && before?.userEnteredValue?.numberValue === after.userEnteredValue?.numberValue
    && !before?.userEnteredValue?.formulaValue && before?.userEnteredValue?.boolValue === undefined
    && before?.textFormatRuns?.[0]?.format?.link?.uri === after.textFormatRuns?.[0]?.format?.link?.uri;
}

function writeRows(sheetId: number, columnIndex: number, updates: { index: number; cells: Cell[] }[]) {
  const groups: { index: number; rows: { values: Cell[] }[] }[] = [];
  for (const { index, cells } of updates) {
    const last = groups.at(-1);
    if (last && last.index + last.rows.length === index) last.rows.push({ values: cells });
    else groups.push({ index, rows: [{ values: cells }] });
  }
  return groups.map(({ index, rows }) => ({
    updateCells: { start: { sheetId, rowIndex: index, columnIndex }, rows, fields: "userEnteredValue,textFormatRuns" },
  }));
}

function dataFormats(sheetId: number, kind: Kind, startRowIndex: number) {
  const headings = [...columns[kind], { label: "Working Notes", width: 350 }];
  return headings.map((column, col) => {
    const notes = col === headings.length - 1;
    const format = "format" in column ? column.format : undefined;
    const numberFormat = format === "date" ? { type: "DATE", pattern: "dd/mm/yyyy" }
      : format === "currency" ? { type: "CURRENCY", pattern: '"£"#,##0.00' }
      : notes ? { type: "TEXT", pattern: "@" } : undefined;
    return { repeatCell: { range: { sheetId, startRowIndex, startColumnIndex: col, endColumnIndex: col + 1 }, cell: { userEnteredFormat: {
      verticalAlignment: "TOP", wrapStrategy: "WRAP", numberFormat,
      ...(notes ? { backgroundColor: { red: 1, green: 0.98, blue: 0.88 } } : {}),
    } }, fields: "userEnteredFormat" } };
  });
}

function layout(sheetId: number, kind: Kind, notesColumn: number, width: number): SheetRequest[] {
  const headings = [...columns[kind], { label: "Working Notes", width: 350 }];
  const range = { sheetId, startColumnIndex: 0, endColumnIndex: width };
  return [
    { updateSpreadsheetProperties: { properties: { locale: "en_GB", timeZone: "Europe/London" }, fields: "locale,timeZone" } },
    { updateSheetProperties: { properties: { sheetId, title: backupType[kind], gridProperties: { frozenRowCount: dataStart, frozenColumnCount: 1 } },
      fields: "title,gridProperties(frozenRowCount,frozenColumnCount)" } },
    { repeatCell: { range: { ...range, startRowIndex: headerRow, endRowIndex: dataStart },
      cell: { userEnteredFormat: { backgroundColor: { red: 0.88, green: 0.92, blue: 0.96 }, textFormat: { bold: true }, wrapStrategy: "WRAP" } },
      fields: "userEnteredFormat" } },
    { mergeCells: { range: { sheetId, startRowIndex: 0, endRowIndex: 2, startColumnIndex: 1, endColumnIndex: 6 }, mergeType: "MERGE_ROWS" } },
    ...headings.map((column, col) => ({ updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: col, endIndex: col + 1 },
      properties: { pixelSize: column.width }, fields: "pixelSize" } })),
    ...dataFormats(sheetId, kind, dataStart),
    { repeatCell: { range: { sheetId, startRowIndex: headerRow, endRowIndex: dataStart, startColumnIndex: notesColumn, endColumnIndex: notesColumn + 1 },
      cell: { userEnteredFormat: { backgroundColor: { red: 0.98, green: 0.93, blue: 0.76 } } }, fields: "userEnteredFormat.backgroundColor" } },
    { updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: notesColumn + 1, endIndex: width },
      properties: { hiddenByUser: true }, fields: "hiddenByUser" } },
  ];
}

function equalRange(a: GridRange | undefined, b: GridRange) {
  return a?.sheetId === b.sheetId && (a?.startRowIndex ?? 0) === (b.startRowIndex ?? 0)
    && a?.endRowIndex === b.endRowIndex && (a?.startColumnIndex ?? 0) === (b.startColumnIndex ?? 0)
    && a?.endColumnIndex === b.endColumnIndex;
}

export function planSheet(sheet: Worksheet, kind: Kind, building: { id: string; name: string }, records: RecordRow[], owner: string, syncTime: Date) {
  const { sheetId, gridProperties } = sheet.properties;
  const notesColumn = columns[kind].length;
  const idColumn = notesColumn + 1;
  const headers = [...columns[kind].map((col) => col.label), "Working Notes", "Building ID",
    ...(kind === "sales" ? ["Unit ID", "Sale attempt ID"] : ["Defect ID"])];
  const width = headers.length;
  const grid = sheet.data?.[0];
  const rows = grid?.rowData ?? [];
  const initialized = headers.every((header, index) => text(rows[headerRow]?.values?.[index]) === header);
  if (!initialized && rows.some((row) => row.values?.some(hasValue))) throw new BackupError("Unexpected worksheet headers. Existing cells were preserved.");

  const pending = new Map(records.map((record) => [record.key, record]));
  const seen = new Set<string>();
  const managedUpdates: { index: number; cells: Cell[] }[] = [];
  const idUpdates: { index: number; cells: Cell[] }[] = [];
  const visibility: { index: number; hidden: boolean }[] = [];
  let end = dataStart;

  for (let index = dataStart; index < rows.length; index++) {
    const cells = rows[index].values ?? [];
    if (!cells.some(hasValue)) continue;
    end = index + 1;
    const subject = text(cells[idColumn + 1]);
    const sale = kind === "sales" ? text(cells[idColumn + 2]) || null : null;
    if (text(cells[idColumn]) !== building.id || !subject || !uuid.test(subject) || (sale && !uuid.test(sale))
      || cells.slice(width).some(hasValue)) {
      throw new BackupError("Worksheet contains a row without a valid identity for this building.");
    }
    const key = recordKey(kind, subject, sale);
    if (seen.has(key)) throw new BackupError("Worksheet contains duplicate record identities.");
    seen.add(key);
    const current = pending.get(key);
    pending.delete(key);
    const hidden = !current && !hasValue(cells[notesColumn]);
    if (Boolean(grid?.rowMetadata?.[index]?.hiddenByUser) !== hidden) visibility.push({ index, hidden });

    // A retired row is never deleted or reused. A note added during sync still belongs to this ID.
    const historical = Array<Value>(notesColumn).fill(null);
    historical[0] = text(cells[0]) || null;
    if (kind === "defects") historical[1] = text(cells[1]) || null;
    historical[kind === "sales" ? 2 : 5] = kind === "sales" ? "Historical — no longer current" : "Archived / removed";
    const replacement = (current?.values ?? historical).map(rowCell);
    if (replacement.some((cell, index) => !equalCell(cells[index], cell))) managedUpdates.push({ index, cells: replacement });
  }
  for (const row of pending.values()) {
    managedUpdates.push({ index: end, cells: row.values.map(rowCell) });
    const ids = [building.id, row.subject, ...(kind === "sales" ? [row.record] : [])];
    idUpdates.push({ index: end, cells: ids.map(rowCell) });
    end++;
  }

  const requests: SheetRequest[] = [];
  // Grow before writing and leave enough existing rows to keep the working area usable.
  if (end > gridProperties.rowCount || width > gridProperties.columnCount) {
    requests.push({ updateSheetProperties: { properties: { sheetId, gridProperties: {
      rowCount: Math.max(end + 25, gridProperties.rowCount), columnCount: Math.max(width, gridProperties.columnCount),
    } }, fields: "gridProperties(rowCount,columnCount)" } });
    if (initialized && end > gridProperties.rowCount) requests.push(...dataFormats(sheetId, kind, gridProperties.rowCount));
  }
  if (!initialized) {
    requests.push(...layout(sheetId, kind, notesColumn, width));
    requests.push(...writeRows(sheetId, 0, [{ index: headerRow, cells: headers.map(rowCell) }]));
  }
  const range = { sheetId, startRowIndex: headerRow, endRowIndex: Math.max(end, dataStart + 1), startColumnIndex: 0, endColumnIndex: width };

  const protections = sheet.protectedRanges ?? [];
  const existing = protections.find((value) => value.description === protectionName);
  if (protections.length !== (existing ? 1 : 0)) throw new BackupError("Worksheet contains an unexpected protection rule.");
  const noteRange = { sheetId, startRowIndex: dataStart, endRowIndex: end, startColumnIndex: notesColumn, endColumnIndex: idColumn };
  const protection: Protection = { range: { sheetId }, description: protectionName, warningOnly: false,
    editors: { users: [owner], domainUsersCanEdit: false }, unprotectedRanges: end > dataStart ? [noteRange] : [] };
  if (!existing) requests.push({ addProtectedRange: { protectedRange: protection } });
  else if (!equalRange(existing.range, { sheetId }) || existing.warningOnly || existing.editors?.users?.join() !== owner
    || existing.editors?.groups?.length || existing.editors?.domainUsersCanEdit
    || (existing.unprotectedRanges?.length ?? 0) !== protection.unprotectedRanges!.length
    || (end > dataStart && !equalRange(existing.unprotectedRanges?.[0], noteRange))) {
    requests.push({ updateProtectedRange: { protectedRange: { ...protection, protectedRangeId: existing.protectedRangeId },
      fields: "range,warningOnly,editors,unprotectedRanges" } });
  }

  requests.push(...writeRows(sheetId, 0, managedUpdates), ...writeRows(sheetId, idColumn, idUpdates));
  for (const { index, hidden } of visibility) requests.push({ updateDimensionProperties: {
    range: { sheetId, dimension: "ROWS", startIndex: index, endIndex: index + 1 }, properties: { hiddenByUser: hidden }, fields: "hiddenByUser",
  } });
  requests.push(...writeRows(sheetId, 1, [
    { index: 0, cells: [rowCell(`${building.name} — ${backupType[kind]}`)] },
    { index: 1, cells: [rowCell(`Last successful sync: ${formatLondon(syncTime)}`)] },
  ]));
  if (!equalRange(sheet.basicFilter?.range, range)) {
    // Preserve row order. Reapplying an old sort spec may move rows after the ID lookup.
    const filter: Filter = { ...sheet.basicFilter, range };
    delete filter.sortSpecs;
    requests.push({ setBasicFilter: { filter } });
  }
  return requests;
}
