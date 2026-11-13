begin;
-- A private, explicit fictional-data confirmation permits user-chosen test names
-- and addresses. Existing format-based fixtures continue to work. No public
-- enrollment API, real-delivery path or business-record update is introduced.
alter table workspace_commands.test_journeys
 add column fictional_details_confirmed_at timestamptz;
comment on column workspace_commands.test_journeys.fictional_details_confirmed_at is
 'Explicit confirmation that this enrolled sale is fictional test data; recorded with purpose and enrolled_by. Never evidence of real email delivery.';

do $patch$
declare definition text;
 old_check text := $old$if not exists(select 1 from workspace_commands.test_journeys where sale_id=p_sale and building_id=a.building_id and unit_id=a.unit_id)
 or coalesce(a.buyer_person_name,'') not like 'Fictional Integration %' or coalesce(a.buyer_email,'') not like '%@example.invalid'$old$;
 new_check text := $new$if not exists(select 1 from workspace_commands.test_journeys j
 where j.sale_id=p_sale and j.building_id=a.building_id and j.unit_id=a.unit_id
 and (j.fictional_details_confirmed_at is not null
 or (coalesce(a.buyer_person_name,'') like 'Fictional Integration %'
 and coalesce(a.buyer_email,'') like '%@example.invalid')))$new$;
begin
 select pg_get_functiondef('public.workspace_capture_legal_email(uuid,uuid,uuid,text,jsonb,jsonb,text)'::regprocedure) into definition;
 if position(old_check in definition)=0 then
  raise exception 'Capture eligibility definition changed; review before applying.';
 end if;
 execute replace(definition,old_check,new_check);
end $patch$;
-- Preserve the existing server-only boundary explicitly.
revoke all on function public.workspace_capture_legal_email(uuid,uuid,uuid,text,jsonb,jsonb,text) from public,anon,authenticated;
grant execute on function public.workspace_capture_legal_email(uuid,uuid,uuid,text,jsonb,jsonb,text) to service_role;
commit;
