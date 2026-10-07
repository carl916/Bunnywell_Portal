import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

// Only application records enter the operational export. Auth credentials,
// session tokens and Storage internals remain exclusively in the restore dump.
export const tables = [
  'buildings', 'building_floors', 'units', 'areas', 'trades', 'profiles', 'organisations', 'building_organisations',
  'snags', 'snag_photos', 'snag_events', 'snag_comments', 'snag_reports', 'snag_report_items', 'snag_report_recipients', 'reports',
  'handovers', 'handover_key_items', 'handover_photos', 'meter_readings',
  'unit_sale_attempts', 'unit_sale_terms', 'unit_sale_payment_schedule', 'unit_sale_documents', 'unit_sale_document_versions',
  'unit_sale_invoices', 'unit_sale_invoice_payments', 'unit_sale_notes', 'unit_sale_workflow_events',
  'sale_comments', 'sale_comment_revisions', 'sale_legal_emails', 'sale_exchange_deposit_sources', 'sale_exchange_deposit_receipts',
];

export function copyValue(value) {
  if (value === '\\N') return null;
  return value.replace(/\\([0-7]{1,3}|x[0-9a-fA-F]{1,2}|.)/g, (_, escape) => {
    if (/^[0-7]/.test(escape)) return String.fromCharCode(parseInt(escape, 8));
    if (/^x[0-9a-f]/i.test(escape)) return String.fromCharCode(parseInt(escape.slice(1), 16));
    return ({ b: '\b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v', '\\': '\\' })[escape] ?? escape;
  });
}

export async function readDump(file) {
  const data = Object.fromEntries(tables.map(table => [table, []]));
  const found = new Set();
  let section = null;
  for await (const line of createInterface({ input: createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity })) {
    if (line === '\\.') { section = null; continue; }
    if (section) {
      if (!section.table) continue;
      const values = line.split('\t');
      if (values.length !== section.columns.length) throw new Error(`Invalid COPY row in ${section.table}; export stopped.`);
      data[section.table].push(Object.fromEntries(section.columns.map((column, i) => [column, copyValue(values[i])])));
      continue;
    }
    const copy = line.match(/^COPY (?:"([^"]+)"|([\w]+))\.(?:"([^"]+)"|([\w]+)) \((.+)\) FROM stdin;$/);
    if (copy) {
      const schema = copy[1] ?? copy[2], table = copy[3] ?? copy[4];
      const accepted = schema === 'public' && tables.includes(table);
      if (accepted && found.has(table)) throw new Error(`Duplicate COPY section: ${table}`);
      if (accepted) found.add(table);
      section = { table: accepted ? table : null, columns: copy[5].split(',').map(c => c.trim().replace(/^"|"$/g, '')) };
    }
  }
  if (section) throw new Error('Truncated database dump; export stopped.');
  const missing = tables.filter(table => !found.has(table));
  if (missing.length) throw new Error(`Missing required application tables: ${missing.join(', ')}`);
  return data;
}

export const truth = value => value === true || value === 't' || value === 'true';
export function json(value, fallback = {}) {
  if (value == null || value === '') return fallback;
  return typeof value === 'string' ? JSON.parse(value) : value;
}
export function number(value) {
  if (value == null || value === '') return null;
  const result = Number(value);
  if (!Number.isFinite(result)) throw new Error('Invalid numeric value in source data.');
  return result;
}
