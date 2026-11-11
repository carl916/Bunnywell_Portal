import {sql,isolation} from './runtime.mjs';
isolation();
console.log(sql(`begin;set local request.jwt.claims='{"role":"service_role"}';set local app.unit_commercial_mutation='on';set local app.sales_legal_write='on';set local app.completion_package_write='on';
insert into units(id,building_id,unit_number,floor,sale_status) select md5('foundation-unit-'||g)::uuid,case when g<=400 then 'b1700000-0000-4000-8000-000000000001'::uuid else 'b1700000-0000-4000-8000-000000000002'::uuid end,(2000+g)::text,case when g%2=0 then 'Ground' else 'First' end,'for_sale' from generate_series(1,700)g on conflict(id) do nothing;
insert into unit_sale_attempts(id,building_id,unit_id,attempt_number,workflow_status,is_active,buyer_person_name,created_by_user_id,updated_by_user_id,sales_agent_organisation_id,conveyancer_organisation_id)
select md5('foundation-sale-'||g)::uuid,u.building_id,u.id,1,case when g%2=0 then 'exchanged' else 'draft' end,true,'Synthetic Buyer '||g,'b1700000-0000-4000-8000-000000000904','b1700000-0000-4000-8000-000000000904','b1700000-0000-4000-8000-000000000502','b1700000-0000-4000-8000-000000000504' from generate_series(1,700)g join units u on u.id=md5('foundation-unit-'||g)::uuid on conflict(id) do nothing;
insert into unit_sale_terms(id,sale_attempt_id,version_number,is_current,status,contract_price,agent_fee_percent,exchange_agent_fee_percent,completion_agent_fee_percent,vat_rate,exchange_deposit_percent,completion_balance_percent)
select md5('foundation-terms-'||g)::uuid,md5('foundation-sale-'||g)::uuid,1,true,'draft',425000,1.5,1,0.5,20,10,90 from generate_series(1,700)g on conflict(id) do nothing;
update units set sale_status='exchanged' where id in(select md5('foundation-unit-'||g)::uuid from generate_series(1,700)g where g%2=0);
insert into snags(id,building_id,unit_id,source_type,title,status,created_by_user_id)
select md5('foundation-snag-'||g)::uuid,u.building_id,u.id,'developer_snag','Synthetic snag '||g,'open','b1700000-0000-4000-8000-000000000901' from generate_series(1,1400)g join units u on u.id=md5('foundation-unit-'||((g-1)%700+1))::uuid on conflict(id) do nothing;
insert into unit_sale_documents(id,sale_attempt_id,document_type,title,status,visibility,created_by_user_id)
select md5('foundation-doc-'||g)::uuid,md5('foundation-sale-'||g)::uuid,'completion_statement','Synthetic completion statement',case when g%4=0 then 'query_raised' else 'uploaded' end,'shared_sale_file','b1700000-0000-4000-8000-000000000907' from generate_series(1,700)g where g%2=0 on conflict(id) do nothing;
insert into unit_sale_document_versions(id,document_id,version_number,storage_bucket,storage_path,file_name,mime_type,is_current,uploaded_by_user_id)
select md5('foundation-version-'||g)::uuid,md5('foundation-doc-'||g)::uuid,1,'sale-documents','synthetic-metadata-only/'||g||'.pdf','Synthetic statement.pdf','application/pdf',true,'b1700000-0000-4000-8000-000000000907' from generate_series(1,700)g where g%2=0 on conflict(id) do nothing;
commit;analyze;
select json_build_object('syntheticUnitsAdded',700,'snagsAdded',1400,'documentsAdded',350);
`).slice(-150));
