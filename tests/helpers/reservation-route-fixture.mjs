import { loadTypescriptModule } from './load-typescript-module.mjs';

// Real HTTP handler, explicit in-memory PostgREST/Storage adapter. No network,
// database triggers or RLS are simulated as proof of deployed database behaviour.
export function reservationRouteFixture(rows, profile) {
  const writes = [], uploads = [];
  let beforeWrite = null;
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: profile.id } }, error: null }) },
    storage: { listBuckets: async () => ({ data: [{ name: 'sale-documents' }], error: null }), from: () => ({ upload: async (path, file) => { uploads.push({ path, size: file.size }); return { error: null }; } }) },
    async rpc(name, args) {
      if (!['sales_workflow_mark_unit_for_sale', 'sales_workflow_mark_unit_reserved'].includes(name)) throw Error(`Unexpected RPC ${name}`);
      rows.units.find(row => row.id === args.p_unit_id).sale_status = name.endsWith('_reserved') ? 'reserved' : 'for_sale';
      writes.push({ rpc: name, args }); return { error: null };
    },
    from(table) {
      const filters = []; let operation = 'read', payload, single = false, required = false, limit = Infinity, sort;
      const value = (row, key) => key.startsWith('unit_sale_documents.')
        ? rows.unit_sale_documents?.find(doc => doc.id === row.document_id)?.[key.split('.')[1]] : row[key];
      const q = {
        select() { return q; }, eq(k, v) { filters.push(row => value(row, k) === v); return q; },
        neq(k, v) { filters.push(row => value(row, k) !== v); return q; },
        is(k) { filters.push(row => value(row, k) == null); return q; },
        order(k, options) { sort = [k, options?.ascending !== false]; return q; }, limit(n) { limit = n; return q; },
        maybeSingle() { single = true; return q; }, single() { single = true; required = true; return q; },
        insert(data) { operation = 'insert'; payload = data; return q; },
        update(data) { operation = 'update'; payload = data; return q; }, delete() { operation = 'delete'; return q; },
        then(resolve, reject) {
          return Promise.resolve().then(() => {
            rows[table] ??= [];
            if (operation !== 'read' && beforeWrite) { const hook = beforeWrite; beforeWrite = null; hook(table, rows); }
            let selected = rows[table].filter(row => filters.every(filter => filter(row)));
            if (operation === 'insert') {
              selected = (Array.isArray(payload) ? payload : [payload]).map(row => ({ id: crypto.randomUUID(), created_at: new Date().toISOString(), uploaded_at: new Date().toISOString(), ...row }));
              rows[table].push(...selected);
            } else if (operation === 'update') selected.forEach(row => Object.assign(row, payload));
            else if (operation === 'delete') rows[table] = rows[table].filter(row => !selected.includes(row));
            if (operation !== 'read') writes.push({ table, operation, payload, count: selected.length });
            if (sort) selected.sort((a, b) => String(a[sort[0]]).localeCompare(String(b[sort[0]]), 'en', { numeric: true }) * (sort[1] ? 1 : -1));
            selected = selected.slice(0, limit);
            return { data: structuredClone(single ? selected[0] ?? null : selected), error: required && selected.length !== 1 ? { message: 'Record changed; refresh before continuing.' } : null };
          }).then(resolve, reject);
        },
      }; return q;
    },
  };
  const route = loadTypescriptModule('src/app/api/sales/reservations/route.ts', { overrides: {
    '@/lib/supabase/admin': { requiredEnv: () => 'synthetic-only', createSupabaseServiceRoleClient: () => client },
  } });
  const post = body => route.POST(new Request('http://synthetic.invalid/api/sales/reservations', {
    method: 'POST', headers: { authorization: 'Bearer synthetic', ...(body instanceof FormData ? {} : { 'content-type': 'application/json' }) },
    body: body instanceof FormData ? body : JSON.stringify(body),
  }));
  return { post, handler: route.POST, writes, uploads, beforeWrite: hook => { beforeWrite = hook; } };
}
