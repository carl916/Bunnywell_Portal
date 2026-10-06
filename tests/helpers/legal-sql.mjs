import { readFileSync } from 'node:fs';
export const legalSql = readFileSync('supabase/migrations/20260922_sales_legal_workflow.sql','utf8');
export function legalActionSql(action) {
  const start=legalSql.indexOf(`elsif p_action='${action}' then`);
  if(start<0) throw new Error(`Missing legal action ${action}`);
  const next=legalSql.indexOf('\n  elsif ',start+1);
  return legalSql.slice(start,next<0 ? legalSql.indexOf("\n  else raise exception 'Unsupported",start) : next);
}
