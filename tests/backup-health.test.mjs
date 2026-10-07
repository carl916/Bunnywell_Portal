import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTypescriptModule } from './helpers/load-typescript-module.mjs';
const health=loadTypescriptModule('src/lib/backups/health.ts');

test('freshness check covers both GMT and BST without two daily alerts',()=>{
  assert.equal(health.isBackupCheckHour(new Date('2026-10-07T06:00:00Z')),true);
  assert.equal(health.isBackupCheckHour(new Date('2026-10-07T07:00:00Z')),false);
  assert.equal(health.isBackupCheckHour(new Date('2026-12-07T07:00:00Z')),true);
  assert.equal(health.isBackupCheckHour(new Date('2026-12-07T06:00:00Z')),false);
});
test('a successful database-only job does not count as a workbook backup',async()=>{
  const fetcher=async url=>Response.json(url.includes('/jobs?')?{jobs:[{steps:[{name:'Create and upload database backup',conclusion:'success',completed_at:'2026-10-07T03:00:00Z'}]}]}:
    {workflow_runs:[{id:1,head_branch:'main',run_started_at:'2026-10-07T02:17:00Z',conclusion:'success',html_url:'https://github.com/run/1'}]});
  assert.equal((await health.checkWorkbookBackup(new Date('2026-10-07T06:00:00Z'),fetcher)).healthy,false);
});
test('only a successful current-day production workbook publish counts as fresh',async()=>{
  const fetcher=async url=>Response.json(url.includes('/jobs?')?{jobs:[{steps:[{name:'Generate and publish operational workbook package',conclusion:'success',completed_at:'2026-10-07T03:00:00Z'}]}]}:
    {workflow_runs:[{id:1,head_branch:'main',run_started_at:'2026-10-07T02:17:00Z',conclusion:'success',html_url:'https://github.com/run/1'}]});
  assert.equal((await health.checkWorkbookBackup(new Date('2026-10-07T06:00:00Z'),fetcher)).healthy,true);
  assert.equal((await health.checkWorkbookBackup(new Date('2026-10-08T06:00:00Z'),fetcher)).healthy,false);
});
test('missing runs and API errors are actionable instead of appearing healthy',async()=>{
  const r=await health.checkWorkbookBackup(new Date('2026-10-07T06:00:00Z'),async()=>Response.json({workflow_runs:[]}));assert.equal(r.healthy,false);
  await assert.rejects(health.checkWorkbookBackup(new Date(),async()=>new Response('',{status:403})),/could not be checked/);
});
test('unauthenticated cron requests cannot run checks or send alerts',async()=>{
  const route=loadTypescriptModule('src/app/api/cron/backup-health/route.ts',{overrides:{'@/lib/backups/health':{checkWorkbookBackup(){throw new Error('Must not run');}}}});
  const r=await route.GET(new Request('https://portal.bunnywell.co.uk/api/cron/backup-health'));assert.equal(r.status,401);
});
test('failure email uses the approved recipient and a daily idempotency key',async t=>{
  const previous={key:process.env.RESEND_API_KEY,recipient:process.env.BACKUP_ALERT_EMAIL};
  t.after(()=>{for(const [name,value] of [['RESEND_API_KEY',previous.key],['BACKUP_ALERT_EMAIL',previous.recipient]]){if(value===undefined)delete process.env[name];else process.env[name]=value;}});
  process.env.RESEND_API_KEY='test-only';delete process.env.BACKUP_ALERT_EMAIL;
  let sent;
  await health.sendBackupAlert('2026-10-07','No backup','https://github.com/run/1',async(url,options)=>{sent={url,...options};return Response.json({id:'test'});});
  assert.equal(JSON.parse(sent.body).to,'info@bunnywell.co.uk');
  assert.equal(sent.headers['Idempotency-Key'],'workbook-backup-alert-2026-10-07');
  assert.match(JSON.parse(sent.body).text,/Latest.zip/);
  await assert.rejects(health.sendBackupAlert('2026-10-07','No backup','https://github.com/run/1',async()=>new Response('',{status:500})),/delivery failed/);
});
