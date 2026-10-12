import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { discussionDatabase } from './discussion-database.mjs';
import { legalDatabase } from './legal-database.mjs';

export const migrationPath = 'supabase/migrations/20261012200050_sale_workflow_context_materialized.sql';
export const migration = readFileSync(migrationPath, 'utf8');
export function functionSql(file, name) {
  const text = readFileSync(file, 'utf8');
  const start = text.indexOf('create or replace function public.' + name + '(');
  assert.ok(start >= 0, name);
  return text.slice(start, text.indexOf('$$;', start) + 3);
}
export async function workflowContextDatabase({ legal = false } = {}) {
  const f = await (legal ? legalDatabase() : discussionDatabase());
  await f.owner();
  // Use the production role helpers, not the minimal fixture adapters.
  await f.db.exec(functionSql('supabase/migrations/20260626_user_status_access.sql', 'current_app_role'));
  await f.db.exec(functionSql('supabase/migrations/20260722_sales_pipeline_core_schema.sql', 'is_sales_internal_user'));
  if (!legal) {
    // Install the complete deployed projection chain verbatim. Other legal
    // schema/write functions are exercised separately with legalDatabase().
    for (const file of ['20260922_sales_legal_workflow.sql', '20260922b_completion_notice_authority.sql',
      '20260922d_exchange_deposit_receipts.sql', '20260922f_completion_document_package.sql']) {
      const text = readFileSync('supabase/migrations/' + file, 'utf8');
      const start = text.indexOf('alter function public.sale_event_projection(');
      assert.ok(start >= 0);
      await f.db.exec(text.slice(start, text.indexOf('end $$;', start) + 7));
    }
  }
  const catalog = async () => (await f.db.query(`
    select p.oid,p.oid::regprocedure::text signature,p.proowner,p.proacl::text,p.provolatile,
      p.prosecdef,p.proisstrict,p.proleakproof,p.proparallel,p.procost,p.proconfig,
      pg_get_function_result(p.oid) returns,pg_get_functiondef(p.oid) definition
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' order by p.oid
  `)).rows;
  const before = await catalog();
  const original = before.find(x => x.signature === 'sale_workflow_context(uuid[])');
  await f.db.exec(migration);
  const after = await catalog();
  assert.deepEqual(after.map(x => x.signature === original.signature ? { ...x, definition: original.definition } : x), before,
    'Migration must preserve every function property and every other function');

  // Call the SAME public endpoint as authenticated under identical claims.
  // Reinstall the existing definition inside a rolled-back local transaction;
  // no permissive copy, service-role read, or mocked permission helper is used.
  async function read(user, sales, old = false) {
    await f.owner();
    if (old) { await f.db.exec('begin'); await f.db.exec(original.definition); }
    try {
      if (user === 'anon') await f.db.exec('set role anon');
      else await f.as(user);
      const claims = (await f.db.query("select auth.uid()::text id,current_user::text role")).rows[0];
      const text = (await f.db.query('select public.sale_workflow_context($1::uuid[])::text result', [sales])).rows[0].result;
      return { claims, text };
    } catch (error) {
      return { error: { code: error.code, message: error.message } };
    } finally {
      if (old) await f.db.exec('rollback');
      await f.owner();
    }
  }
  async function compare(user, sales = [f.ids.sale]) {
    const before = await read(user, sales, true);
    const after = await read(user, sales);
    assert.deepEqual(after, before, 'CONTRACT DISCREPANCY: complete ordered JSON/error or caller differs');
    return after.error ? after : JSON.parse(after.text);
  }
  return { ...f, original, catalog, readContext: read, compare };
}
