// Pure fixture SQL shared by isolated local and independent hosted setup.
export function buildSeedRecords(proposal,accounts){
const id=n=>"b1700000-0000-4000-8000-"+String(n).padStart(12,"0");
const literal=v=>v==null?"null":typeof v==="number"||typeof v==="boolean"?String(v):"'"+(typeof v==="object"?JSON.stringify(v):String(v)).replaceAll("'","''")+"'";
function insert(table,rows){return rows.map(row=>{const keys=Object.keys(row);return "insert into public."+table+" ("+keys.join(",")+") values ("+keys.map(k=>literal(row[k])).join(",")+");"}).join("\n");}
let statements=["begin;","set local request.jwt.claims = '{\"role\":\"service_role\"}';"];
statements.push("delete from public.buildings where name='Forum House' and address_line_1='' and town='' and not exists(select 1 from public.units where building_id=buildings.id);");
statements.push("set local app.sales_legal_write = 'on'; set local app.completion_package_write = 'on';"); statements.push(insert("organisations",[{id:id(501),name:"Local Developer Team",type:"developer_representative"},{id:id(502),name:"Willow Sales Team",type:"sales_agent"},{id:id(503),name:"Orchard Sales Team",type:"sales_agent"},{id:id(504),name:"Brook Legal Team",type:"conveyancer"},{id:id(505),name:"Local Contractor Team",type:"contractor"}]));
statements.push(...accounts.map(a=>"update public.profiles set role="+literal(a.role)+",organisation_id="+literal(a.organisationId)+",active="+literal(a.active)+",name="+literal("Local Test "+a.alias)+" where id="+literal(a.identity)+";"));
for(const b of proposal.buildings){
 const fact=proposal.scopedFacts.find(f=>f.building?.id===b.id||f.input?.buildingId===b.id);
 const input=fact?.proposedFacts;
 statements.push(insert("buildings",[{id:b.id,name:b.name,address_line_1:b.address,status:"active",sales_agent_organisation_id:b.id===id(1)?id(502):b.id===id(2)?id(503):null,conveyancer_organisation_id:b.id===id(3)?null:id(504)}]));
 if(!input)continue;
 let n=b.id===id(1)?7000:7100;
 statements.push(insert("building_floors",input.floors.map(f=>({...f,id:id(n++)}))));
 statements.push(insert("units",input.units.map(u=>({...u,sale_status:"for_sale"}))));
 for(const sale of input.sales){
  const final={...sale};delete final.created_at;
  statements.push(insert("unit_sale_attempts",[{...sale,workflow_status:"draft",buyer_person_name:fact.buyerLabels[sale.id],created_by_user_id:id(904),updated_by_user_id:id(904),reservation_date:sale.reservation_approved_at?"2026-10-07":null}]));
  const terms=input.terms.find(t=>t.sale_attempt_id===sale.id);
  statements.push(insert("unit_sale_terms",[{...terms,id:id(n++),status:sale.reservation_approved_at?"approved":"draft",agent_fee_percent:1.5,exchange_deposit_percent:10,completion_balance_percent:90}]));
  statements.push("update public.unit_sale_attempts set workflow_status="+literal(sale.workflow_status)+" where id="+literal(sale.id)+";");
 }
 statements.push("set local app.unit_commercial_mutation = 'on';");
 for(const u of input.units)statements.push("update public.units set sale_status="+literal(u.sale_status)+" where id="+literal(u.id)+";");
 for(const d of input.documents){
  const {unit_sale_document_versions:versions,...doc}=d;
  statements.push(insert("unit_sale_documents",[{...doc,title:{"completion_statement":"Completion statement","draft_statement_of_account":"Statement of account","completion_correspondence":"Completion correspondence"}[doc.document_type],visibility:"shared_sale_file",created_by_user_id:id(907),updated_by_user_id:id(907)}]));
  statements.push(insert("unit_sale_document_versions",versions.map(v=>({...v,document_id:d.id,version_number:1,storage_bucket:"sale-documents",storage_path:"local-metadata-only/"+v.id+".pdf",file_name:"Local-"+d.document_type+".pdf",mime_type:"application/pdf",uploaded_by_user_id:id(907)}))));
 }
 for(const source of input.depositSources){
  statements.push(insert("sale_exchange_deposit_sources",[{...source,source_kind:"legacy_locked_terms",snapshot:{terms:{contract_price:425000,exchange_deposit_percent:10}},terms_version:1}]));
  const receipt=input.deposits.find(d=>d.source_id===source.id);
  if(receipt)statements.push(insert("sale_exchange_deposit_receipts",[{...receipt,id:id(n++),revision:1,received_date:"2026-10-20",recorded_by:id(907),recorded_by_name:"Local Test conveyancer"}]));
 }
}
statements.push(insert("user_building_access",accounts.flatMap(a=>a.buildingIds.map(building_id=>({user_id:a.identity,building_id,role_on_building:a.role})))));
statements.push("notify pgrst, 'reload schema';","commit;");

return statements.join("\n");
}
