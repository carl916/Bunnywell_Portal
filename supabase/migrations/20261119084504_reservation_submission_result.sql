-- Upload intents use the existing private receipt ledger. No table or policy changes.
create or replace function public.workspace_reservation_upload(p_building uuid,p_unit uuid,p_sale uuid,p_actor uuid,p_request uuid,p_action text,p_input jsonb default null)
returns jsonb language plpgsql security definer set search_path=public,workspace_commands as $$
declare a unit_sale_attempts%rowtype; r workspace_commands.operation_receipts%rowtype; result jsonb; upload_id uuid;
begin
 if auth.jwt()->>'role' is distinct from 'service_role' or portal_audit.actor() is distinct from p_actor then raise exception 'Verified server actor required.' using errcode='42501';end if;
 perform sales_legal_assert(p_sale,p_actor,array['admin','developer','sales_agent']);
 select * into a from unit_sale_attempts where id=p_sale for update;
 if a.building_id is distinct from p_building or a.unit_id is distinct from p_unit or not a.is_active or a.redacted_at is not null or p_request is null then raise exception 'Exact active sale required.';end if;
 select * into r from workspace_commands.operation_receipts where id=p_request for update;
 if found then
  if r.actor_id<>p_actor or r.target_id<>p_sale or r.action<>'reservation_submission' or (p_input is not null and r.input is distinct from p_input) then raise exception 'Submission reference conflict.';end if;
  if r.result->>'state'='committed' then return r.result;end if;
  if p_action='abort' then
   update workspace_commands.operation_receipts set result=operation_receipts.result||'{"state":"aborted"}'::jsonb where id=p_request returning operation_receipts.result into result;
   return result;
  end if;
  return r.result;
 end if;
 if p_action<>'prepare' or p_input is null then raise exception 'Submission reference unavailable.';end if;
 if a.workflow_status not in ('draft','rejected','reservation_query_raised') or a.exchanged_at is not null or a.legal_completed_at is not null or a.updated_at is distinct from (p_input->>'expected')::timestamptz then raise exception 'This reservation changed or is not editable. Reload before submitting.';end if;
 if not exists(select 1 from units where id=p_unit and sale_status='for_sale') then raise exception 'This unit is not available for reservation.';end if;
 upload_id:=gen_random_uuid();
 result:=jsonb_build_object('state','prepared','uploadId',upload_id,'path',p_building::text||'/'||p_sale::text||'/reservation-'||upload_id::text||'/reservation_form.pdf');
 insert into workspace_commands.operation_receipts(id,actor_id,action,target_id,input,result) values(p_request,p_actor,'reservation_submission',p_sale,p_input,result);
 return result;
end $$;

create or replace function public.workspace_reservation_submit(p_building uuid,p_unit uuid,p_sale uuid,p_actor uuid,p_request uuid,p_input jsonb,p_expected_terms jsonb,p_expected_defaults jsonb,p_terms jsonb,p_schedule jsonb)
returns jsonb language plpgsql security definer set search_path=public,workspace_commands as $$
declare r jsonb; uploaded jsonb; submission_result jsonb; payload jsonb;
begin
 -- Locks the sale before checking either ledger or changing a document version.
 r:=workspace_reservation_upload(p_building,p_unit,p_sale,p_actor,p_request,'status',p_input);
 if r->>'state'='committed' then return r->'result';end if;
 if r->>'state'<>'prepared' then raise exception 'This upload was cancelled. Retry the submission.';end if;
 uploaded:=workspace_reservation_file(p_sale,p_actor,(r->>'uploadId')::uuid,nullif(p_input->>'expectedVersionId','')::uuid,(p_input->'file')||jsonb_build_object('path',r->>'path'));
 payload:=(p_input->'payload')||jsonb_build_object('versionId',uploaded->>'versionId');
 submission_result:=workspace_reservation_command(p_building,p_unit,p_sale,p_actor,p_request,'save_reservation',(p_input->>'expected')::timestamptz,payload,p_expected_terms,p_expected_defaults,p_terms,p_schedule);
 update workspace_commands.operation_receipts set result=r||jsonb_build_object('state','committed','result',submission_result) where id=p_request;
 return submission_result;
end $$;
revoke all on function public.workspace_reservation_upload(uuid,uuid,uuid,uuid,uuid,text,jsonb) from public,anon,authenticated;
revoke all on function public.workspace_reservation_submit(uuid,uuid,uuid,uuid,uuid,jsonb,jsonb,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.workspace_reservation_upload(uuid,uuid,uuid,uuid,uuid,text,jsonb) to service_role;
grant execute on function public.workspace_reservation_submit(uuid,uuid,uuid,uuid,uuid,jsonb,jsonb,jsonb,jsonb,jsonb) to service_role;
