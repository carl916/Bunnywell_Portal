import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Reviewed against production's live schema on 7 October 2026. This is a
// one-time catch-up, not a general migration runner. Never replay on staging.
const migrations = [
  '20260907_sale_discussions.sql',
  '20260907b_sale_activity_projection.sql',
  '20260908_sale_discussion_building_agents.sql',
  '20260908b_sale_actor_names.sql',
  '20260922_sales_legal_workflow.sql',
  '20260922b_completion_notice_authority.sql',
  '20260922c_legal_email_presentation.sql',
  '20260922d_exchange_deposit_receipts.sql',
  '20260922e_authority_renewal_requests.sql',
  '20260922f_completion_document_package.sql',
  // Timestamp sorting alone puts this before its completion-package dependency.
  '20260922194750_completion_direct_upload.sql',
  '20261006134823_reliable_audit_increment.sql',
  '20261006135625_preserve_legacy_audit_actors.sql',
  '20261007133421_completion_document_review.sql',
];

const output = path.resolve('test-results/production-release');
const hash = (value) => createHash('sha256').update(value).digest('hex');
const sources = await Promise.all(migrations.map(async (name) => {
  const sql = await readFile(path.join('supabase/migrations', name), 'utf8');
  return { name, sql, sha256: hash(sql) };
}));

// Commit 20261007152600_sales_production_prerequisites.sql separately FIRST:
// new enum values must be committed before the sales functions use them.
// Remove only standalone transaction wrappers, preserving all migration bodies.
const body = sources.map(({ name, sql, sha256 }) =>
  `-- Source: ${name}\n-- SHA-256: ${sha256}\n${sql.replace(/^(?:begin|commit);\s*$/gim, '')}`
).join('\n');
const sql = `begin;\nset local lock_timeout='10s';\nset local statement_timeout='120s';\n${body}\ncommit;\n`;
await mkdir(output, { recursive: true });
await writeFile(path.join(output, 'catchup.sql'), sql);
await writeFile(path.join(output, 'migration-manifest.json'), JSON.stringify({
  project: 'zxgezoiazsubopqhqhim',
  prerequisite: '20261007152600_sales_production_prerequisites.sql',
  migrations: sources.map(({ name, sha256 }) => ({ name, sha256 })),
  bundleSha256: hash(sql),
}, null, 2) + '\n');
console.log(`Prepared ${sources.length} migrations; no database connection or changes made.`);
console.log(`Bundle: ${path.join(output, 'catchup.sql')}`);
