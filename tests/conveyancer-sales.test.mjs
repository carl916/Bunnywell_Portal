import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTypescriptModule } from './helpers/load-typescript-module.mjs';
import { fixture, document, sale, unit, building, NOW } from './helpers/dashboard-fixture.mjs';
const { deriveSalesRegister } = loadTypescriptModule('src/lib/sales/register.ts');
const { filterSalesRegister, prominentActions, INITIAL_REGISTER_FILTERS } = loadTypescriptModule('src/lib/sales/register-presentation.ts');
const viewer = { id:'legal-1', role:'conveyancer', organisation_id:'legal-org' };
const snapshot = (overrides={}) => deriveSalesRegister(fixture({ viewer, ...overrides }));
const filtered = (rows, responsibility, rest={}) => filterSalesRegister(rows, { ...INITIAL_REGISTER_FILTERS, responsibility, ...rest });

test('one approved document and one current query produce the precise replacement destination',()=>{
  const row=snapshot({documents:[document('completion_statement','approved'),document('draft_statement_of_account','query_raised')]}).rows[0];
  assert.equal(row.actions.length,1);assert.equal(row.actions[0].label,'Upload revised statement of account');
  assert.equal(row.actions[0].destination.versionId,'draft_statement_of_account-v1');
  assert.equal(row.actions[0].destination.anchor,'completion-document-draft_statement_of_account');
  assert.equal(row.actions[0].party.label,'Synthetic Legal Team');assert.equal(row.keyDate.label,'Completion due today');
});
test('colleague replacement moves responsibility without undoing the sibling approval',()=>{
  const docs=[document('completion_statement','approved'),document('draft_statement_of_account','query_raised')];
  assert.equal(filtered(snapshot({documents:docs}).rows,'ours').length,1);
  docs[1]=document('draft_statement_of_account','uploaded','account-v2');
  const result=snapshot({documents:docs});
  assert.equal(filtered(result.rows,'ours').length,0);assert.equal(filtered(result.rows,'others').length,1);
  assert.equal(result.rows[0].actions[0].destination.versionId,'account-v2');
  assert.match(result.rows[0].actions[0].label,/Statement of account awaiting Developer team approval/);
});
test('multiple parties match both filters once; each filter promotes its relevant action',()=>{
  const rows=snapshot({documents:[document('completion_statement'),document('draft_statement_of_account','query_raised')]}).rows;
  assert.equal(filtered(rows,'ours').length,1);assert.equal(filtered(rows,'others').length,1);
  assert.match(prominentActions(rows[0],'ours')[0].label,/Upload revised/);
  assert.match(prominentActions(rows[0],'others')[0].label,/Completion statement awaiting/);
  assert.equal(prominentActions(rows[0],'all')[0].party.kind,'conveyancer');
});
test('related current document reviews group into a single compact action',()=>{
  const row=snapshot({documents:[document('completion_statement'),document('draft_statement_of_account')]}).rows[0];
  assert.equal(row.actions.length,1);assert.equal(row.actions[0].label,'Review completion documents (2)');
  assert.equal(row.actions[0].destination.anchor,'completion-documents-step');
});
test('organisation work ignores login identity, unread notifications and last actor',()=>{
  const input={documents:[document('completion_statement','approved'),document('draft_statement_of_account','query_raised')]};
  const a=snapshot(input);
  for(const id of ['legal-2','shared-plot-sales'])assert.deepEqual(snapshot({...input,viewer:{...viewer,id},unread:0,last_actor:id}).rows,a.rows);
  const other=snapshot({...input,viewer:{...viewer,organisation_id:'different-org'}});
  assert.equal(filtered(other.rows,'ours').length,0);
});
test('unallocated responsibility is not assigned to Other teams; neutral inventory stays in All teams',()=>{
  const rows=snapshot({buildings:[{...building,conveyancer_organisation_id:null}],sales:[{...sale,conveyancer_organisation_id:null}],documents:[document('completion_statement','approved'),document('draft_statement_of_account','query_raised')]}).rows;
  assert.equal(filtered(rows,'others').length,0);assert.equal(filtered(rows,'ours').length,0);assert.equal(filtered(rows,'all').length,1);
  assert.match(rows[0].actions[0].party.label,/not configured/);
  const available=snapshot({sales:[],units:[{...unit,sale_status:'for_sale'}]}).rows;
  assert.equal(available[0].neutral,'No active sale');assert.equal(filtered(available,'others').length,0);
});
test('stage, search and permitted building scope combine over the complete sorted population',()=>{
  const units=Array.from({length:301},(_,i)=>({...unit,id:`u${i}`,unit_number:String(i+1),floor:i<3?'Ground':'First'}));
  const rows=snapshot({units,sales:[],floors:[{building_id:building.id,name:'First',sort_order:2},{building_id:building.id,name:'Ground',sort_order:1}]}).rows;
  assert.equal(rows.length,301);assert.deepEqual(rows.slice(0,4).map(r=>r.unitNumber),['1','2','3','4']);
  assert.equal(filtered(rows,'all',{search:'Synthetic House',stage:'exchanged'}).length,301);
  assert.equal(filtered(rows,'all',{search:'301',stage:'exchanged'}).length,1);
  assert.equal(filtered(rows,'all',{search:'301',stage:'reserved'}).length,0);
  assert.equal(snapshot({buildingId:'inaccessible'}).rows.length,0);
});
test('building and configured floor ordering precede natural unit numbers and unknown floors',()=>{
  const b2={...building,id:'b2',name:'Second House'};
  const rows=snapshot({buildings:[building,b2],sales:[],floors:[{building_id:building.id,name:'Lower Ground',sort_order:0},{building_id:building.id,name:'Ground',sort_order:1}],units:[{...unit,id:'a',unit_number:'2',floor:'Ground'},{...unit,id:'b',unit_number:'10',floor:'Lower Ground'},{...unit,id:'c',unit_number:'1',floor:null},{...unit,id:'d',building_id:b2.id,unit_number:'1'}]}).rows;
  assert.deepEqual(rows.map(r=>r.unitId),['b','a','c','d']);
});
test('historical attempts create no current actions or duplicate rows',()=>{
  const row=snapshot({sales:[{...sale,id:'old',is_active:false},sale]}).rows[0];
  assert.ok(row.actions.every(a=>a.id.startsWith(`sale:${sale.id}:`)));
  const duplicate=snapshot({sales:[sale,{...sale,id:'conflict'}]}).rows;
  assert.equal(duplicate.length,1);assert.equal(duplicate[0].actions.length,0);assert.match(duplicate[0].warning,/Multiple active/);
});
test('inconsistent unit availability is flagged without rewriting the canonical stage',()=>{
  const row=snapshot({units:[{...unit,sale_status:'for_sale'}]}).rows[0];
  assert.equal(row.stage,'for_sale');assert.match(row.warning,/disagree/);assert.ok(!row.actions.some(a=>a.label.startsWith('Portal checks')));
});
test('dependency order wins over event age and date/deposit tasks do not drive responsibility',()=>{
  const row=snapshot({sales:[{...sale,workflow_status:'approved',exchanged_at:null,commercial_approved_at:null,authority_requested_at:'2026-01-01'}],units:[{...unit,sale_status:'reserved'}]}).rows[0];
  assert.match(row.actions[0].label,/commercial terms/);
  const completed=snapshot({sales:[{...sale,workflow_status:'completed',completed_at:'2026-10-01'}],units:[{...unit,sale_status:'completed'}]}).rows[0];
  assert.equal(completed.actions.length,0);assert.equal(completed.keyDate,null);assert.match(completed.neutral,/No outstanding/);
});
test('both current approvals permit an explicit completion next step without deposit or fee gates',()=>{
  const row=snapshot({documents:[document('completion_statement','approved'),document('draft_statement_of_account','approved')]}).rows[0];
  assert.equal(row.actions[0].label,'Portal checks complete; completion not recorded');
  assert.equal(row.actions[0].destination.anchor,'completion-legal-step');
});
test('saved completion date today is not overdue at London midnight, including DST',()=>{
  for(const now of ['2026-10-06T23:00:00Z','2026-10-07T22:59:59Z'])assert.equal(snapshot({now:Date.parse(now)}).rows[0].keyDate.label,'Completion due today');
  assert.match(snapshot({now:Date.parse('2026-10-07T23:00:00Z')}).rows[0].keyDate.label,/date passed/);
  assert.equal(snapshot({now:Date.parse('2026-10-24T23:00:00Z'),sales:[{...sale,contractual_completion_date:'2026-10-25'}]}).rows[0].keyDate.label,'Completion due today');
});
test('deadlines remain visible while the developer has the action, even beyond the warning window',()=>{
  const row=snapshot({documents:[document('completion_statement'),document('draft_statement_of_account')],sales:[{...sale,contractual_completion_date:'2026-12-12'}]}).rows[0];
  assert.equal(row.actions[0].ours,false);assert.equal(row.keyDate.label,'Completion due 12 Dec 2026');assert.equal(row.keyDate.warning,false);
});
test('current authority expiry respects supersession and recorded exchange',()=>{
  const base={id:'old',sale_attempt_id:sale.id,kind:'authority',version:1,issued_at:'2026-09-01T12:00:00Z',expires_at:'2026-10-01T12:00:00Z',sent_at:'2026-09-01T12:00:00Z',replaced_by:'new'};
  const latest={...base,id:'new',version:2,replaced_by:null,expires_at:'2026-10-07T15:00:00Z'};
  const input={sales:[{...sale,workflow_status:'approved',exchanged_at:null}],units:[{...unit,sale_status:'reserved'}],authorities:[base,latest]};
  assert.equal(snapshot(input).rows[0].keyDate.label,'Authority expires today');
  assert.equal(snapshot({...input,authorities:[base]}).rows[0].keyDate,null);
  assert.match(snapshot({...input,now:NOW+86400000}).rows[0].keyDate.label,/Authority expired/);
  assert.equal(snapshot({authorities:[base,latest]}).rows[0].keyDate.label,'Completion due today');
});
test('failed legal source preserves the base register and dates without claiming no work',()=>{
  const result=snapshot({sources:[{key:'sales',state:'ready'},{key:'legal',state:'unavailable'}]});
  assert.equal(result.actionsAvailable,false);assert.equal(result.rows.length,1);assert.equal(result.rows[0].neutral,'Next steps unavailable');assert.equal(result.rows[0].actions.length,0);
});
test('explicit response projection drops restricted aggregates, raw terms and histories',()=>{
  const result=snapshot({forecastRevenue:998877,netSalesProceeds:998877,terms:[{contract_price:262500,net_proceeds:998877}],saleEvents:[{id:'secret',summary:'PRIVATE CONTEXT',sale_attempt_id:sale.id,created_at:'2026-10-07T11:00:00Z',event_type:'completion_recorded'}]});
  const json=JSON.stringify(result);assert.doesNotMatch(json,/998877|PRIVATE CONTEXT|contract_price|summaries|activity|net_proceeds|forecastRevenue/);
});
