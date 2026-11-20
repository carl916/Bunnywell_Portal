import test from 'node:test';
import assert from 'node:assert/strict';
import {notificationDatabase,ids} from './helpers/notification-database.mjs';
import {loadTypescriptModule} from './helpers/load-typescript-module.mjs';
const {selectEmailNotificationRecipients:select}=loadTypescriptModule('./src/lib/workspace/email-notifications.ts');
test('durable notification transactions, fixed windows and capture boundary',async t=>{
 const f=await notificationDatabase();t.after(()=>f.db.close());
 const w=crypto.randomUUID();
 const fanout=async()=>{let e;while((e=await f.worker(w,'next_event'))){await f.worker(w,'fanout',{eventId:e.id,recipientIds:select(e.audience,e.event_id).map(r=>r.userId)});}};
 const settings=async(roles,mentions=true)=>{await f.service();const s=await f.rpc('workspace_email_notification_settings',{p_actor:ids.developer});return f.rpc('workspace_save_email_notifications',{p_actor:ids.developer,p_request:crypto.randomUUID(),p_payload:{expectedVersion:s.version,roles,mentionsEnabled:mentions}});};
 const capture=async b=>{const items=b.events.flatMap(e=>{const original=select(e.audience,e.eventId).find(r=>r.userId===b.recipientId),current=e.current&&select(e.current,e.eventId).find(r=>r.userId===b.recipientId),reasons=original?.eventIds.filter(id=>current?.eventIds.includes(id))||[];return reasons.length?[{eventId:e.id,reasons}]:[];});return f.worker(w,'capture',{batchId:b.batchId,revision:b.revision,items,mail:{subject:'Test',text:'Safe capture',html:'<p>Safe capture</p>'}});};
 await t.test('pre-activation comments never enqueue; migration preserves existing command',async()=>{await f.as('agent');await f.write('Before activation',{p_mentions:[ids.developer]});assert.equal((await f.rows('select * from workspace_commands.notification_events')).length,0);});
 await f.activate();await f.as('agent');const client=crypto.randomUUID(),comment=await f.write('First @Developer',{p_client:client,p_mentions:[ids.developer]});
 await t.test('comment retry and failed transaction create no duplicate events',async()=>{await f.as('agent');assert.equal(await f.write('First @Developer',{p_client:client,p_mentions:[ids.developer]}),comment);await assert.rejects(f.write('Invalid tag',{p_mentions:[crypto.randomUUID()]}));assert.equal((await f.rows('select * from workspace_commands.notification_events')).length,1);});
 await t.test('durable lease rejects overlapping workers; lost worker can resume after expiry',async()=>{assert.equal((await f.worker(w,'claim')).claimed,true);assert.equal((await f.worker(crypto.randomUUID(),'claim')).claimed,false);await assert.rejects(f.worker(crypto.randomUUID(),'next_event'),/lease expired/);});
 await fanout();
 await t.test('two mentions and approval share recipient window without moving deadline',async()=>{
  await f.as('agent');await f.write('Second @Developer',{p_mentions:[ids.developer]});
  await f.service();const req=crypto.randomUUID(),args={p_building:ids.building,p_unit:ids.unit,p_sale:ids.sale,p_actor:ids.developer,p_request:req,p_action:'approve_reservation',p_expected:new Date().toISOString()};
  await f.rpc('workspace_reservation_command',args);await f.rpc('workspace_reservation_command',args);
  await assert.rejects(f.rpc('workspace_reservation_command',{...args,p_request:crypto.randomUUID(),p_payload:{fail:true}}));
  await f.rows("update workspace_commands.notification_events set occurred_at=(select min(opened_at) from workspace_commands.notification_batches)+case when event_id='reservation_approved' then interval '3 minutes' else interval '1 minute' end where fanout_at is null");
  await fanout();const batches=await f.rows('select *,extract(epoch from due_at-opened_at)::int duration from workspace_commands.notification_batches');
  const d=batches.find(b=>b.recipient_id===ids.developer),c=batches.find(b=>b.recipient_id===ids.solicitor);
  assert.equal(d.duration,300);assert.equal(new Date(c.due_at)-new Date(d.due_at),180000);
  assert.equal((await f.rows('select * from workspace_commands.notification_batch_items where batch_id=$1',[d.id])).length,3);
 });
 await t.test('event exactly at cutoff creates new batch even with earlier batch pending',async()=>{
  await f.as('agent');await f.write('At cutoff',{p_mentions:[ids.developer]});
  await f.rows('update workspace_commands.notification_events set occurred_at=(select min(due_at) from workspace_commands.notification_batches) where fanout_at is null');await fanout();
  assert.equal((await f.rows('select * from workspace_commands.notification_batches where recipient_id=$1',[ids.developer])).length,2);
 });
 await t.test('sale attempt is the batching identity, even on the same unit',async()=>{
  await f.rows('update unit_sale_attempts set is_active=false where id=$1',[ids.sale]);await f.rows('update unit_sale_attempts set unit_id=$1 where id=$2',[ids.unit,ids.replacement]);await f.rows('update workspace_commands.test_journeys set unit_id=$1 where sale_id=$2',[ids.unit,ids.replacement]);
  await f.as('agent');await f.write('New buyer',{p_sale:ids.replacement,p_mentions:[ids.developer]});await fanout();assert.equal((await f.rows('select * from workspace_commands.notification_batches where sale_id=$1',[ids.replacement])).length,1);
 });
 await t.test('ordinary comments silent; fabricated legal inbox rows never create email events',async()=>{
  const before=(await f.rows('select * from workspace_commands.notification_batch_items')).length;await f.as('agent');const ordinary=await f.write('An ordinary update');await fanout();assert.equal((await f.rows('select * from workspace_commands.notification_batch_items')).length,before);
  const events=(await f.rows('select * from workspace_commands.notification_events')).length;
  await f.rows('insert into sale_mention_notifications(sale_attempt_id,comment_id,recipient_id) values($1,$2,$3)',[ids.sale,ordinary,ids.developer]);
  assert.equal((await f.rows('select * from workspace_commands.notification_events')).length,events);
 });
 await t.test('new explicit edit tags once; removing and readding a tag does not repeat it',async()=>{
  await f.as('agent');await f.write('First @Developer @Solicitor',{p_comment:comment,p_version:1,p_mentions:[ids.developer,ids.solicitor]});await f.write('First @Developer',{p_comment:comment,p_version:2,p_mentions:[ids.developer]});await f.write('First @Developer @Solicitor',{p_comment:comment,p_version:3,p_mentions:[ids.developer,ids.solicitor]});
  const edits=await f.rows("select * from workspace_commands.notification_events where event_id='comment_mentioned'");assert.equal(edits.length,1);assert.deepEqual(select(edits[0].audience,'comment_mentioned').map(r=>r.userId),[ids.solicitor]);await fanout();
 });
 await t.test('comment role and explicit mention overlap once; email switch does not prevent tags',async()=>{
  await settings({comment_added:['developer']});await f.as('agent');const c=await f.write('Both routes',{p_mentions:[ids.developer]});await fanout();const event=(await f.rows('select * from workspace_commands.notification_events where comment_id=$1',[c]))[0];assert.equal(select(event.audience,'comment_added').length,1);assert.equal((await f.rows('select * from workspace_commands.notification_batch_items where event_id=$1',[event.id])).length,1);
  await settings({comment_added:[]},false);await f.as('agent');const off=await f.write('Tag with email off',{p_mentions:[ids.developer]});assert(off);await fanout();assert.equal((await f.rows('select i.* from workspace_commands.notification_batch_items i join workspace_commands.notification_events e on e.id=i.event_id where e.comment_id=$1',[off])).length,0);await settings({comment_added:[]});
 });
 await t.test('capture rechecks settings, visibility and access; empty is suppressed; retries idempotent',async()=>{
  // Move the fixture timeline back as a whole, preserving all five-minute windows.
  await f.rows("update workspace_commands.notification_events set occurred_at=occurred_at-interval '20 minutes'");await f.rows("update workspace_commands.notification_batches set opened_at=opened_at-interval '20 minutes',due_at=due_at-interval '20 minutes'");
  let b=await f.worker(w,'next_batch');await settings({reservation_approved:[]});await assert.rejects(capture(b),/changed/);await settings({reservation_approved:['developer','sales_agent','conveyancer']});
  await f.rows('delete from user_building_access where user_id=$1',[ids.solicitor]);
  let count=0;while((b=await f.worker(w,'next_batch'))){const result=await capture(b);assert.equal((await capture(b)).replayed,true);if(b.recipientId===ids.solicitor)assert.equal(result.status,'suppressed');count++;}assert(count>1);
  const captures=await f.rows('select * from workspace_commands.notification_captures');assert(captures.every(c=>!c.external_delivery&&c.delivery_status==='captured_test'));assert.equal(new Set(captures.map(c=>c.batch_id)).size,captures.length);
 });
 await t.test('expired worker lease is safely reclaimed; browser identities cannot dispatch',async()=>{await f.rows("update workspace_commands.notification_dispatch_state set lease_until=clock_timestamp()-interval '1 second'");assert.equal((await f.worker(crypto.randomUUID(),'claim')).claimed,true);await assert.rejects(f.worker(w,'next_event'),/expired/);await f.as('agent');await assert.rejects(f.rpc('workspace_notification_worker',{p_worker:w,p_action:'claim'}),/permission denied/);});
});
test('revalidation removes one comment while retaining another in the same email',async t=>{
 const f=await notificationDatabase();t.after(()=>f.db.close());await f.activate();await f.service();
 await f.rpc('workspace_save_email_notifications',{p_actor:ids.developer,p_request:crypto.randomUUID(),p_payload:{expectedVersion:0,roles:{comment_added:['developer']},mentionsEnabled:true}});
 await f.as('agent');const retained=await f.write('Explicit tag survives settings change',{p_mentions:[ids.developer]});await f.write('Role-only item must disappear');
 const worker=crypto.randomUUID();await f.worker(worker,'claim');let e;while((e=await f.worker(worker,'next_event')))await f.worker(worker,'fanout',{eventId:e.id,recipientIds:select(e.audience,e.event_id).map(r=>r.userId)});
 await f.rows("update workspace_commands.notification_events set occurred_at=occurred_at-interval '10 minutes'");await f.rows("update workspace_commands.notification_batches set opened_at=opened_at-interval '10 minutes',due_at=due_at-interval '10 minutes'");
 await f.service();await f.rpc('workspace_save_email_notifications',{p_actor:ids.developer,p_request:crypto.randomUUID(),p_payload:{expectedVersion:1,roles:{comment_added:[]},mentionsEnabled:true}});
 const b=await f.worker(worker,'next_batch');assert.equal(b.events.length,2);const keep=b.events.find(e=>e.commentId===retained),items=[{eventId:keep.id,reasons:['comment_mentioned']}];
 const result=await f.worker(worker,'capture',{batchId:b.batchId,revision:b.revision,items,mail:{subject:'One retained item',text:'Explicit tag survives settings change',html:'<p>Explicit tag survives settings change</p>'}});assert.equal(result.status,'captured');assert.deepEqual((await f.rows('select items from workspace_commands.notification_captures'))[0].items,items);
});
