import { building, unit, sale, document, snag, NOW } from './dashboard-fixture.mjs';

export function dashboardReadClient({ role = 'admin', fail = '', reject = '', hold = [], delay = () => 0, changingProfile = false, changingAccess = false } = {}) {
  const second = { ...building, id: '10000000-0000-4000-8000-000000000002', name: 'Second House', sales_agent_organisation_id: null };
  const profile = { id: 'viewer', role, organisation_id: 'dev-org', active: true };
  const tables = {
    profiles: [profile], buildings: [building, second],
    units: [unit, { ...unit, id: 'unit-b', building_id: second.id, sale_status: 'completed' }],
    building_floors: [], organisations: [{ id: 'agent-org', name: 'Agent' }, { id: 'legal-org', name: 'Legal' }], building_organisations: [],
    user_building_access: [{ id: 'access', user_id: profile.id, building_id: building.id }], user_unit_access: [],
    unit_sale_attempts: [sale, { ...sale, id: 'sale-b', unit_id: 'unit-b', building_id: second.id }],
    unit_sale_documents: [document('completion_statement')], sale_legal_emails: [], sale_exchange_deposit_receipts: [], sale_exchange_deposit_sources: [],
    snags: [snag({ assigned_to_organisation_id: null })], handovers: [],
    unit_tenancies: [{ id: 'tenancy', building_id: building.id, unit_id: unit.id, tenancy_start_date: '2026-01-01', fixed_term_end_date: '2026-10-12', tenancy_end_date: null }],
    rental_arrears_episodes: [], rental_import_runs: [], resident_access_requests: [],
  };
  const rpcs = {
    sale_workflow_context: [{ id: 'event', sale_attempt_id: sale.id, event_type: 'authority_issued', created_at: new Date(NOW).toISOString(), created_by_user_id: 'actor' }],
    sale_actor_names: [{ id: 'actor', display_name: 'Synthetic actor' }],
    get_agent_fee_portfolio: [{ sale_attempt_id: 'historical', building_id: second.id, building_name: second.name, unit_id: 'unit-b', unit_number: '2', unit_sale_status: 'withdrawn', workflow_status: 'fallen_through', contract_price: 100000, exchange_fee_percent: 1, completion_fee_percent: 1, vat_rate: 20,
      exchange_invoice: { id: 'invoice', invoice_type: 'sales_agent', fee_milestone: 'exchange', status: 'approved', total_amount: 1200, invoice_amount: 1200, created_at: new Date(NOW).toISOString() }, completion_invoice: null, exchange_active_payments: [], completion_active_payments: [] }],
  };
  const calls = [], gates = new Map(); let active = 0, peak = 0;
  for (const name of hold) { let release; const promise = new Promise(r => { release = r; }); gates.set(name, { promise, release }); }
  const run = async (name, args, response) => {
    const call = { name, args, ended: false }; calls.push(call); active++; peak = Math.max(peak, active);
    try {
      await gates.get(name)?.promise;
      const ms = delay(name, calls.length); if (ms) await new Promise(r => setTimeout(r, ms));
      if (name === reject) throw new Error('private failure');
      const data = response();
      return { ...data, error: name === fail ? { message: 'private failure' } : null };
    } finally { call.ended = true; active--; }
  };
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: profile.id } }, error: null }) },
    from(name) {
      let rows = [...(tables[name] ?? [])], from = 0, to = Infinity, single = false;
      const filters = [];
      const q = {
        select() { return q; }, order() { return q; }, range(a,b) { from = a; to = b; return q; }, limit() { return q; },
        in(key, ids) { filters.push([key, ids]); if (!key.includes('.')) rows = rows.filter(r => ids.includes(r[key])); return q; },
        eq(key, value) { if (!key.includes('.')) rows = rows.filter(r => r[key] === value); return q; },
        is(key) { if (!key.includes('.')) rows = rows.filter(r => r[key] == null); return q; },
        not(key, _op, value) { rows = rows.filter(r => !value.slice(1,-1).split(',').includes(r[key])); return q; },
        single() { single = true; return q; },
        then(resolve, reject) { return run(name, { from, to, filters }, () => {
          const nth = calls.filter(c => c.name === name).length;
          if (name === 'profiles' && changingProfile && nth > 1) rows = [{ ...profile, active: false }];
          if (name === 'user_building_access' && changingAccess && nth > 1) rows = [];
          return { data: single ? rows[0] : rows.slice(from, to + 1), count: rows.length };
        }).then(resolve, reject); },
      };
      return q;
    },
    rpc(name, args) { return run(name, args, () => { const data = (rpcs[name] ?? []).filter(r => !r.sale_attempt_id || !args.p_sales || args.p_sales.includes(r.sale_attempt_id)); return { data, count: data.length }; }); },
  };
  return { client, profile, tables, rpcs, calls, second, release: name => gates.get(name)?.release(), get peak() { return peak; } };
}

export async function until(predicate) {
  for (let i = 0; i < 500; i++) { if (predicate()) return; await new Promise(r => setImmediate(r)); }
  throw new Error('Expected scheduling boundary was not reached');
}
