begin;
-- Request-local access snapshot; caller JWT/RLS, no security-definer bypass and no cache.
create function public.workspace_access_context() returns jsonb language sql stable security invoker set search_path='' as $$
select jsonb_build_object('profile',(select jsonb_build_object('id',id,'role',role,'organisation_id',organisation_id,'active',active) from public.profiles where id=auth.uid()),
'units',coalesce((select jsonb_agg(x) from (select unit_id from public.user_unit_access where user_id=auth.uid()) x),'[]'::jsonb),
'buildings',coalesce((select jsonb_agg(x) from (select building_id from public.user_building_access where user_id=auth.uid()) x),'[]'::jsonb),
'links',coalesce((select jsonb_agg(x) from (select building_id,organisation_id,role_on_project,active from public.building_organisations where organisation_id=(select organisation_id from public.profiles where id=auth.uid())) x),'[]'::jsonb));
$$;
revoke all on function public.workspace_access_context() from public,anon;
grant execute on function public.workspace_access_context() to authenticated,service_role;
-- Minimal facts from one building, one PostgreSQL statement snapshot, evaluated under caller RLS.
-- All action, responsibility and money calculations remain in the existing canonical TypeScript helpers.
create function public.workspace_building_facts(p_building uuid,p_unit uuid default null,p_sale uuid default null,p_include_snags boolean default true)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare r text:=public.current_app_role(); result jsonb;
begin
 if r is null or r not in ('admin','developer','developer_representative','contractor','sales_agent','conveyancer') or not exists(select 1 from public.buildings where id=p_building) then raise exception 'Building unavailable' using errcode='42501'; end if;
 if p_sale is not null and (p_unit is null or not exists(select 1 from public.unit_sale_attempts where id=p_sale and unit_id=p_unit and building_id=p_building and redacted_at is null)) then raise exception 'Exact sale unavailable' using errcode='42501'; end if;
 if (select count(*) from public.units where building_id=p_building and (p_unit is null or id=p_unit))>20000 then raise exception 'Building source exceeds bounded read'; end if;
 with b as(select id,name,status,pc_date,pc_confirmed,practical_completion_date,conveyancer_organisation_id,sales_agent_organisation_id from public.buildings where id=p_building),
 u as(select id,building_id,unit_number,floor,sale_status,rental_portfolio_status,completion_date,handover_date from public.units where building_id=p_building and (p_unit is null or id=p_unit)),
 a as(select id,building_id,unit_id,is_active,workflow_status,sales_agent_organisation_id,conveyancer_organisation_id,reservation_submitted_at,reservation_rejected_at,reservation_rejection_reason,reservation_approved_at,commercial_approved_at,exchanged_at,completed_at,legal_completed_at,redacted_at,authority_requested_at,completion_authority_requested_at,completion_authority_given_at,completion_arrangements_confirmed_at,completion_legacy_stage,completion_notice_issued_at,contractual_completion_date,created_at,buyer_person_name,buyer_company_name from public.unit_sale_attempts where building_id=p_building and (p_unit is null or unit_id=p_unit) and (p_sale is null or id=p_sale) and redacted_at is null and r in ('admin','developer','sales_agent','conveyancer')),
 i as(select id,sale_attempt_id,invoice_type,status,fee_milestone,gross_amount,expected_payable_amount,reservation_fee_deduction,agent_contribution_deduction,approved_at,created_at from public.unit_sale_invoices where sale_attempt_id in(select id from a) and r in ('admin','developer','sales_agent')),
 teams as(select id,building_id,organisation_id,role_on_project,active from public.building_organisations where building_id=p_building)
 select jsonb_build_object(
 'buildings',coalesce((select jsonb_agg(x) from (select * from b) x),'[]'::jsonb),'units',coalesce((select jsonb_agg(x) from (select * from u) x),'[]'::jsonb),'sales',coalesce((select jsonb_agg(x) from (select * from a) x),'[]'::jsonb),
 'floors',coalesce((select jsonb_agg(x) from (select id,building_id,name,sort_order from public.building_floors where building_id=p_building) x),'[]'::jsonb),
 'buildingOrganisations',coalesce((select jsonb_agg(x) from (select * from teams) x),'[]'::jsonb),
 'organisations',coalesce((select jsonb_agg(x) from (select id,name from public.organisations where id in(select organisation_id from teams union select conveyancer_organisation_id from b union select sales_agent_organisation_id from b)) x),'[]'::jsonb),
 'terms',coalesce((select jsonb_agg(x) from (select id,sale_attempt_id,is_current,version_number,contract_price,exchange_agent_fee_percent,completion_agent_fee_percent,vat_rate from public.unit_sale_terms where sale_attempt_id in(select id from a) and r in ('admin','developer','sales_agent')) x),'[]'::jsonb),
 'invoices',coalesce((select jsonb_agg(x) from (select * from i) x),'[]'::jsonb),
 'payments',coalesce((select jsonb_agg(x) from (select id,invoice_id,payment_source,payer_type,amount,paid_at,voided_at from public.unit_sale_invoice_payments where invoice_id in(select id from i)) x),'[]'::jsonb),
 'documents',coalesce((select jsonb_agg(x) from (select d.id,d.sale_attempt_id,d.document_type,d.status,d.query_note,d.approved_version_id,d.approved_at,d.updated_at,d.updated_by_user_id,coalesce((select jsonb_agg(x) from (select v.id,v.is_current,v.redacted_at,v.uploaded_at from public.unit_sale_document_versions v where v.document_id=d.id and v.is_current and v.redacted_at is null) x),'[]'::jsonb) as unit_sale_document_versions from public.unit_sale_documents d where d.sale_attempt_id in(select id from a where is_active) and d.redacted_at is null and d.superseded_at is null and d.document_type in ('completion_statement','draft_statement_of_account','completion_correspondence')) x),'[]'::jsonb),
 'authorities',coalesce((select jsonb_agg(x) from (select id,sale_attempt_id,kind,version,issued_at,expires_at,revoked_at,replaced_by,exchanged_at,delivery_status,sent_at,resend_message_id from public.sale_legal_emails where sale_attempt_id in(select id from a where is_active)) x),'[]'::jsonb),
 'deposits',coalesce((select jsonb_agg(x) from (select id,sale_attempt_id,source_id,expected_amount,received_amount from public.sale_exchange_deposit_receipts where sale_attempt_id in(select id from a where is_active)) x),'[]'::jsonb),
 'depositSources',coalesce((select jsonb_agg(x) from (select id,sale_attempt_id,source_kind,expected_amount from public.sale_exchange_deposit_sources where sale_attempt_id in(select id from a where is_active)) x),'[]'::jsonb),
 'furtherDeposits',coalesce((select jsonb_agg(x) from (select id,sale_attempt_id,required,percent,expected_amount,received_amount,timing,months_after_exchange,exchanged_at,pc_date,deadline,terms_version from public.sale_further_deposit_facts where sale_attempt_id in(select id from a where is_active)) x),'[]'::jsonb),
 'snags',coalesce((select jsonb_agg(x) from (select s.id,s.building_id,s.unit_id,s.source_type,s.title,s.status,s.trade_id,s.assigned_to_organisation_id,s.assigned_to_user_id,s.priority_code,s.sla_due_date,s.created_at,s.closed_at,coalesce((select jsonb_agg(x) from (select e.id,e.snag_id,e.event_type,e.old_value,e.new_value,e.comment,e.created_by_user_id,e.created_at from public.snag_events e where e.snag_id=s.id and e.event_type in ('status_change','triage') order by e.created_at desc,e.id desc limit 1) x),'[]'::jsonb) as snag_events from public.snags s where p_include_snags and p_unit is null and s.building_id=p_building and r in ('admin','developer','developer_representative','contractor') and s.source_type in ('developer_snag','leaseholder_defect') and s.status not in ('closed','resolved')) x),'[]'::jsonb)
 ) into result;
 return result;
end $$;
revoke all on function public.workspace_building_facts(uuid,uuid,uuid,boolean) from public,anon;
grant execute on function public.workspace_building_facts(uuid,uuid,uuid,boolean) to authenticated,service_role;
notify pgrst,'reload schema';
commit;
