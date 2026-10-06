import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTypescriptModule } from './helpers/load-typescript-module.mjs';
import { emailSnapshot as snapshot, emailNow, emailExpiry } from './helpers/legal-email-fixture.mjs';
const { renderLegalEmail }=loadTypescriptModule('src/lib/sales/legal-workflow.ts');
const { emailDate, emailDateTime, legalEmailPayments }=loadTypescriptModule('src/lib/sales/legal-email.ts');
const urls=loadTypescriptModule('src/lib/portal-url.ts');
const render=(kind='authority',value=snapshot)=>renderLegalEmail(value,kind,kind==='authority'?emailExpiry:'',emailNow,'https://portal.example.test');

for(const [kind,title]of [['authority','Authority to Exchange'],['notice_authority','Authority to Serve Notice']])test(`${kind} has equivalent HTML/text, the right sale link, material details and attribution`,()=>{
  const email=render(kind);assert.equal(email.subject,`${title} – Riverside House – 105`);
  const path=urls.saleFilePath({building_id:snapshot.building.id,unit_id:snapshot.unit_id,sale_attempt_id:snapshot.sale_id});
  const link='https://portal.example.test'+path;
  assert.ok(email.body.includes(link));assert.ok(email.html.includes(link.replaceAll('&','&amp;')));
  assert.equal((email.html.match(/href=/g)||[]).length,2);
  assert.match(email.html,/max-width:640px/);assert.match(email.html,/<!--\[if mso\]>/);
  for(const content of ['Riverside House','Plot 105','Alex Morgan / Jamie Morgan','Riverside Developments Ltd','£325,000.00','Approved and issued by Sam Taylor through Bunnywell.','View sale file in Bunnywell Portal']) {
    assert.ok(email.body.includes(content),content);assert.ok(email.html.includes(content),content);
  }
  assert.deepEqual(email.to,['legal@example.test']);assert.deepEqual(email.cc,['sales@example.test']);
  const query=new URL(link).searchParams;assert.equal(query.get('salesUnitId'),snapshot.unit_id);assert.equal(query.get('conversation'),snapshot.sale_id);assert.equal(query.get('building'),snapshot.building.id);
  assert.doesNotMatch(link,/token|magic|expires/);
});

test('exchange payment information appears once, uses human triggers, and keeps financial terms',()=>{
  const email=render();
  for(const content of [email.body,email.html]) {
    assert.doesNotMatch(content,/manual_date|delayed_deposit|due_event|Payment structure|No location recorded|value £0/);
    for(const value of ['£32,500.00','£16,250.00','£276,250.00'])assert.equal(content.split(value).length-1,1);
    assert.match(content,/93 days after exchange/);assert.match(content,/On exchange/);assert.match(content,/On completion/);
    assert.match(content,/£2,000.00 \(held by Sales agent\)/);assert.match(content,/Includes reservation fee/);assert.match(content,/Developer: £5,000.00/);
    assert.match(content,/Integrated kitchen appliances included/);assert.match(content,/Completion following notice under the contract/);
  }
  assert.equal(legalEmailPayments(snapshot).length,3);
});

test('UK expiry uses BST/GMT and preserves authority validity wording',()=>{
  assert.equal(emailDateTime(emailExpiry),'24 September 2026 at 3:18pm BST');
  assert.equal(emailDateTime('2026-12-24T15:18:00Z'),'24 December 2026 at 3:18pm GMT');
  assert.equal(emailDate('2026-09-29'),'29 September 2026');assert.equal(emailDate('2026-02-30'),'Not recorded');
  const email=render();
  for(const body of [email.body,email.html]) {
    assert.match(body,/Authority valid until 24 September 2026 at 3:18pm BST/);
    assert.match(body,/we authorise Riverside Legal to exchange contracts for the above property on the following basis:/);
    assert.match(body,/expire automatically if exchange has not taken place by that time/);
    assert.match(body,/Any material amendment to the above terms will require fresh authority/);
    assert.match(body,/Please confirm exchange through the Bunnywell Portal/);
  }
});

test('notice authority remains date-free and never becomes notice to complete',()=>{
  const email=render('notice_authority');
  for(const body of [email.body,email.html]) {
    assert.match(body,/we authorise Riverside Legal to serve notice under the contract/);
    assert.match(body,/record the notice issue date, completion due date and notice PDF/);
    assert.doesNotMatch(body,/proposed|notice to complete|Authority valid until|2026-09-29/i);
  }
});

test('zero optional amounts are concise and nonzero parking, custom terms and notes are retained',()=>{
  const empty=structuredClone(snapshot);Object.assign(empty.terms,{developer_contribution:0,additional_special_conditions:[]});
  const email=render('authority',empty);assert.match(email.body,/Incentives and contributions: None/);assert.match(email.body,/Parking arrangements: None/);assert.match(email.body,/Special terms or agreed variations: None/);
  Object.assign(empty.terms,{developer_contribution:null,agent_contribution:undefined,other_concessions:''});assert.match(render('authority',empty).body,/Incentives and contributions: None/);
  Object.assign(empty.terms,{parking_location_details:'Bay 24',parking_value:15000,parking_contribution_value:1200,deposit_summary:'Second deposit subject to agreed retention.'});empty.schedule[1].notes='Pay to the stakeholder account.';
  const custom=render('authority',empty);for(const body of [custom.html,custom.body])for(const text of ['Bay 24','£15,000.00','£1,200.00','Second deposit subject to agreed retention.','Pay to the stakeholder account.'])assert.ok(body.includes(text));
  empty.schedule=[];assert.equal(legalEmailPayments(empty).length,3);assert.match(render('authority',empty).body,/93 days after exchange/);
  empty.schedule=[{payment_stage:'other',label:'Retention',fixed_amount:123.45,due_event:'manual_date',due_date:'2026-09-29'}];assert.match(render('authority',empty).body,/29 September 2026/);assert.match(render('authority',empty).body,/£123.45/);
});

test('HTML text and URL attributes escape untrusted sale content',()=>{
  const value=structuredClone(snapshot);value.buyer='<img src=x onerror="alert(1)"> & Co';value.plot='A" & B';value.sale_id='sale&x="onclick"';
  const email=render('authority',value);assert.doesNotMatch(email.html,/<img src=x|onerror="|sale&x=/);assert.match(email.html,/&lt;img/);assert.match(email.html,/&quot;alert\(1\)&quot;/);assert.match(email.html,/sale%26x%3D%22onclick%22/);assert.ok(email.body.includes(value.buyer));
});

test('canonical base uses existing configuration precedence and rejects unsafe URLs',()=>{
  const keys=['DIGEST_APP_URL','NEXT_PUBLIC_APP_URL','NEXT_PUBLIC_SITE_URL'];const before=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
  try {
    keys.forEach(key=>delete process.env[key]);assert.equal(urls.portalBaseUrl(),'https://portal.bunnywell.co.uk');
    process.env.NEXT_PUBLIC_APP_URL='portal.example.test/';assert.equal(urls.portalBaseUrl(),'https://portal.example.test');
    process.env.DIGEST_APP_URL='https://canonical.example.test';assert.equal(urls.portalBaseUrl(),'https://canonical.example.test');
    for(const invalid of ['javascript:alert(1)','https://user:password@example.test','https://example.test?next=evil']){process.env.DIGEST_APP_URL=invalid;assert.throws(()=>urls.portalBaseUrl());}
    assert.throws(()=>urls.saleFilePath({building_id:'b',sale_attempt_id:'s'}),/incomplete/);
  } finally {for(const key of keys)if(before[key]===undefined)delete process.env[key];else process.env[key]=before[key];}
});
