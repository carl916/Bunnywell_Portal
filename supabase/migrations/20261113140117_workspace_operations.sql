begin;
-- The new workspace exposes administration only for explicitly fictional records.
create table workspace_commands.test_entities(
 kind text not null check(kind in ('building','organisation','profile','trade','unit_type')),
 entity_id uuid not null,created_by uuid not null references public.profiles(id),
 created_at timestamptz not null default now(),primary key(kind,entity_id)
);
create table workspace_commands.operation_receipts(
 id uuid primary key,actor_id uuid not null references public.profiles(id),action text not null,
 target_id uuid,input jsonb not null,result jsonb not null,created_at timestamptz not null default now()
);
create table workspace_commands.snag_media_intents(
 id uuid primary key,actor_id uuid not null references public.profiles(id),building_id uuid not null references public.buildings(id),
 snag_id uuid references public.snags(id),action text not null,path text not null unique,name text not null,
 mime text not null,size bigint not null,created_at timestamptz not null default now()
);
alter table workspace_commands.test_entities enable row level security;
alter table workspace_commands.operation_receipts enable row level security;
alter table workspace_commands.snag_media_intents enable row level security;
revoke all on workspace_commands.test_entities,workspace_commands.operation_receipts,workspace_commands.snag_media_intents from public,anon,authenticated,service_role;

create function workspace_commands.setup_actor(p_actor uuid) returns void language plpgsql security definer set search_path=public as $$
begin
 if auth.jwt()->>'role' is distinct from 'service_role' or portal_audit.actor() is distinct from p_actor
 or not exists(select 1 from profiles where id=p_actor and active and role in ('admin','developer'))
 then raise exception 'Verified Setup administrator required.' using errcode='42501';end if;
end $$;
revoke all on function workspace_commands.setup_actor(uuid) from public,anon,authenticated,service_role;

create function public.workspace_setup_context(p_actor uuid) returns jsonb language plpgsql security definer set search_path=public,workspace_commands as $$
begin
 perform workspace_commands.setup_actor(p_actor);
 return jsonb_build_object('entities',coalesce((select jsonb_agg(jsonb_build_object('kind',kind,'id',entity_id)) from workspace_commands.test_entities),'[]'::jsonb),
 'buildings',coalesce((select jsonb_agg(to_jsonb(b)) from buildings b join workspace_commands.test_entities e on e.kind='building' and e.entity_id=b.id),'[]'::jsonb),
 'organisations',coalesce((select jsonb_agg(to_jsonb(o)) from organisations o join workspace_commands.test_entities e on e.kind='organisation' and e.entity_id=o.id),'[]'::jsonb),
 'people',coalesce((select jsonb_agg(to_jsonb(p)||jsonb_build_object('buildingIds',coalesce((select jsonb_agg(building_id) from user_building_access where user_id=p.id),'[]'::jsonb))) from profiles p join workspace_commands.test_entities e on e.kind='profile' and e.entity_id=p.id),'[]'::jsonb),
 'trades',coalesce((select jsonb_agg(to_jsonb(t)) from trades t join workspace_commands.test_entities e on e.kind='trade' and e.entity_id=t.id),'[]'::jsonb),
 'types',coalesce((select jsonb_agg(to_jsonb(t)) from unit_types t join workspace_commands.test_entities e on e.kind='unit_type' and e.entity_id=t.id),'[]'::jsonb));
end $$;
revoke all on function public.workspace_setup_context(uuid) from public,anon,authenticated;
grant execute on function public.workspace_setup_context(uuid) to service_role;

create function public.workspace_setup_operation(p_actor uuid,p_request uuid,p_action text,p_target uuid,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public,workspace_commands as $$
declare prior workspace_commands.operation_receipts%rowtype; b uuid; entity_kind text; existing jsonb; result jsonb;
 f building_floors%rowtype; u units%rowtype; a areas%rowtype; o organisations%rowtype; org uuid; ids uuid[]; sale uuid; defaults_value jsonb; n integer; old_name text;
begin
 perform workspace_commands.setup_actor(p_actor);
 if p_request is null or p_target is null or jsonb_typeof(p_payload)<>'object' then raise exception 'A record, fields and submission reference are required.'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_request::text,0));
 select * into prior from workspace_commands.operation_receipts where id=p_request;
 if found then
  if prior.actor_id<>p_actor or prior.action<>p_action or prior.target_id<>p_target or prior.input is distinct from (p_payload-array['defaults','schedule','expectedDefaults']) then raise exception 'Submission reference conflicts with the saved operation.'; end if;
  return prior.result;
 end if;
 if p_action in ('create_building','save_building') then entity_kind:='building';
 elsif p_action in ('create_organisation','save_organisation') then entity_kind:='organisation';
 elsif p_action in ('create_trade','save_trade') then entity_kind:='trade';
 elsif p_action in ('create_type','save_type') then entity_kind:='unit_type';
 elsif p_action in ('prepare_user','save_person','set_person_status') then entity_kind:='profile';
 elsif p_action in ('save_floor','delete_floor','reorder_floors','save_unit','save_area','delete_area','save_team','remove_team','save_defaults') then
  b:=(p_payload->>'buildingId')::uuid;
  if not exists(select 1 from workspace_commands.test_entities where kind='building' and entity_id=b) then raise exception 'Only fictional test-building configuration can be changed.'; end if;
  perform 1 from buildings where id=b for update;
 else raise exception 'Setup operation unavailable.'; end if;
 if entity_kind is not null then
  if p_action like 'create_%' or p_action='prepare_user' then
   if exists(select 1 from workspace_commands.test_entities where kind=entity_kind and entity_id=p_target) then raise exception 'Test record already exists. Reload before saving.'; end if;
   if p_payload->>'fictional' is distinct from 'true' then raise exception 'Confirm this is fictional test data.'; end if;
   insert into workspace_commands.test_entities(kind,entity_id,created_by) values(entity_kind,p_target,p_actor);
  elsif not exists(select 1 from workspace_commands.test_entities where kind=entity_kind and entity_id=p_target) then raise exception 'Imported reference records remain read-only.'; end if;
 end if;
 if p_action in ('create_building','save_building') then
  select to_jsonb(t) into existing from buildings t where id=p_target for update;
  if p_action='create_building' and existing is not null then raise exception 'Building already exists.'; end if;
  if p_action='save_building' and (existing is null or (existing->>'updated_at')::timestamptz is distinct from (p_payload->>'expected')::timestamptz) then raise exception 'Building changed. Reload before saving.'; end if;
  if nullif(btrim(p_payload->>'name'),'') is null then raise exception 'Enter a building name.'; end if;
  if p_action='create_building' then
   insert into buildings(id,name,address_line_1,town,postcode,status,lifecycle_status,allow_resident_access_requests,seller_name,created_at,updated_at)
    values(p_target,'Integration test · '||btrim(p_payload->>'name'),p_payload->>'address',p_payload->>'town',p_payload->>'postcode','active','pre_handover',false,'Fictional Integration Seller',now(),now());
  else
   update buildings set name=case when p_payload->>'name' like 'Integration test · %' then btrim(p_payload->>'name') else 'Integration test · '||btrim(p_payload->>'name') end,
    address_line_1=p_payload->>'address',town=p_payload->>'town',postcode=p_payload->>'postcode',notes=p_payload->>'notes',
    pc_date=nullif(p_payload->>'pcDate','')::date,pc_confirmed=coalesce((p_payload->>'pcConfirmed')::boolean,false),
    seller_name=nullif(btrim(p_payload->>'sellerName'),''),completion_information=p_payload->>'completionInformation',
    allow_resident_access_requests=false,updated_at=now() where id=p_target;
  end if;
 elsif p_action in ('create_organisation','save_organisation') then
  select to_jsonb(t) into existing from organisations t where id=p_target for update;
  if p_action='create_organisation' and existing is not null then raise exception 'Organisation already exists.'; end if;
  if p_action='save_organisation' and (existing is null or existing->>'updated_at' is distinct from p_payload->>'expected') then raise exception 'Organisation changed. Reload before saving.'; end if;
  if nullif(btrim(p_payload->>'name'),'') is null or p_payload->>'type' not in ('developer_representative','contractor','supporting_trade','sales_agent','conveyancer','letting_agent','managing_agent') then raise exception 'Enter an organisation name and valid type.'; end if;
  if coalesce(p_payload->>'email','')<>'' and lower(p_payload->>'email') not like '%@example.invalid' then raise exception 'Use an example.invalid test email address.'; end if;
  insert into organisations(id,name,type,main_contact_name,email,phone,shared_system_email)
   values(p_target,case when p_payload->>'name' like 'Integration test · %' then btrim(p_payload->>'name') else 'Integration test · '||btrim(p_payload->>'name') end,p_payload->>'type',p_payload->>'contact',nullif(lower(p_payload->>'email'),''),p_payload->>'phone',nullif(lower(p_payload->>'email'),''))
  on conflict(id) do update set name=excluded.name,type=excluded.type,main_contact_name=excluded.main_contact_name,email=excluded.email,phone=excluded.phone,shared_system_email=excluded.shared_system_email,updated_at=now();
 elsif p_action in ('create_trade','save_trade','create_type','save_type') then
  if nullif(btrim(p_payload->>'name'),'') is null then raise exception 'Enter a name.'; end if;
  if entity_kind='trade' then
   select to_jsonb(t) into existing from trades t where id=p_target for update;
   if p_action='save_trade' and (existing is null or existing->>'updated_at' is distinct from p_payload->>'expected') then raise exception 'Trade changed. Reload before saving.'; end if;
   if p_action='create_trade' and existing is not null then raise exception 'Trade already exists.';end if;
   insert into trades(id,name,sort_order,active) values(p_target,case when p_payload->>'name' like 'Integration test · %' then btrim(p_payload->>'name') else 'Integration test · '||btrim(p_payload->>'name') end,coalesce((p_payload->>'sortOrder')::integer,0),coalesce((p_payload->>'active')::boolean,true))
    on conflict(id) do update set name=excluded.name,sort_order=excluded.sort_order,active=excluded.active,updated_at=now();
  else
   select to_jsonb(t) into existing from unit_types t where id=p_target for update;
   if p_action='save_type' and (existing is null or existing->>'updated_at' is distinct from p_payload->>'expected') then raise exception 'Unit type changed. Reload before saving.'; end if;
   if p_action='create_type' and existing is not null then raise exception 'Unit type already exists.';end if;
   insert into unit_types(id,name,description) values(p_target,case when p_payload->>'name' like 'Integration test · %' then btrim(p_payload->>'name') else 'Integration test · '||btrim(p_payload->>'name') end,p_payload->>'description')
    on conflict(id) do update set name=excluded.name,description=excluded.description,updated_at=now();
  end if;
 elsif p_action in ('prepare_user','save_person') then
  org:=nullif(p_payload->>'organisationId','')::uuid;
  select coalesce(array_agg(value::uuid),'{}') into ids from jsonb_array_elements_text(coalesce(p_payload->'buildingIds','[]'::jsonb));
  if lower(p_payload->>'email') not like '%@example.invalid' or nullif(btrim(p_payload->>'name'),'') is null
   or p_payload->>'role' not in ('developer_representative','contractor','sales_agent','conveyancer') then raise exception 'Use a fictional name, example.invalid email and operational test role.'; end if;
  if not exists(select 1 from workspace_commands.test_entities where kind='organisation' and entity_id=org)
   or not exists(select 1 from organisations where id=org and (type=p_payload->>'role' or (p_payload->>'role'='contractor' and type='supporting_trade')))
   or cardinality(ids)=0 or exists(select 1 from unnest(ids) id where not exists(select 1 from workspace_commands.test_entities where kind='building' and entity_id=id)) then raise exception 'Assign a test organisation and at least one fictional test building.'; end if;
  if p_action='prepare_user' then
   if exists(select 1 from auth.users where id=p_target or lower(email)=lower(p_payload->>'email')) then raise exception 'This test account already exists. Edit it in People and access.'; end if;
   result:=jsonb_build_object('id',p_target,'prepared',true);
  else
   select to_jsonb(t) into existing from profiles t where id=p_target for update;
   if existing is null or lower(existing->>'email') is distinct from lower(p_payload->>'email') then raise exception 'Test account unavailable.'; end if;
   if p_payload ? 'provisionRequest' then
    if not exists(select 1 from workspace_commands.operation_receipts where id=(p_payload->>'provisionRequest')::uuid and target_id=p_target and actor_id=p_actor and action='prepare_user')
     or not exists(select 1 from auth.users where id=p_target and raw_app_meta_data->>'workspace_test_request'=p_payload->>'provisionRequest') then raise exception 'Test account provision does not match.'; end if;
   elsif existing->>'updated_at' is distinct from p_payload->>'expected' then raise exception 'Person or access changed. Reload before saving.'; end if;
   perform public.save_portal_user_access(p_target,jsonb_build_object('email',lower(p_payload->>'email'),'name',btrim(p_payload->>'name'),'full_name',btrim(p_payload->>'name'),'role',p_payload->>'role','organisation_id',org,'active',true),ids,'[]'::jsonb);
   update profiles set updated_at=now() where id=p_target;
  end if;
 elsif p_action='set_person_status' then
  if p_target=p_actor or jsonb_typeof(p_payload->'active')<>'boolean' then raise exception 'Choose a test account and active status.'; end if;
  select to_jsonb(t) into existing from profiles t where id=p_target for update;
  if existing is null or existing->>'updated_at' is distinct from p_payload->>'expected' then raise exception 'Person changed. Reload before saving.'; end if;
  update profiles set active=(p_payload->>'active')::boolean,updated_at=now() where id=p_target;
 elsif p_action='save_floor' then
  select * into f from building_floors where id=p_target for update;
  if f.id is not null and (f.building_id<>b or f.updated_at::text::timestamptz is distinct from (p_payload->>'expected')::timestamptz) then raise exception 'Floor changed or belongs to another building.'; end if;
  if nullif(btrim(p_payload->>'name'),'') is null then raise exception 'Enter a floor name.'; end if;
  if exists(select 1 from building_floors where building_id=b and id<>p_target and lower(btrim(name))=lower(btrim(p_payload->>'name'))) then raise exception 'A floor with this name already exists in this building.';end if;
  old_name:=f.name;
  insert into building_floors(id,building_id,name,sort_order) values(p_target,b,btrim(p_payload->>'name'),coalesce((p_payload->>'sortOrder')::integer,0))
   on conflict(id) do update set name=excluded.name,sort_order=excluded.sort_order,updated_at=now();
  if old_name is not null and old_name<>btrim(p_payload->>'name') then
   update units set floor=btrim(p_payload->>'name'),updated_at=now() where building_id=b and floor=old_name;
   update areas set floor=btrim(p_payload->>'name'),updated_at=now() where building_id=b and floor=old_name;
  end if;
 elsif p_action='delete_floor' then
  select * into f from building_floors where id=p_target and building_id=b for update;
  if f.id is null or f.updated_at is distinct from (p_payload->>'expected')::timestamptz then raise exception 'Floor changed. Reload before removing.'; end if;
  if exists(select 1 from units where building_id=b and floor=f.name) or exists(select 1 from areas where building_id=b and floor=f.name) then raise exception 'Move this floor’s units and areas before removing it.';end if;
  delete from building_floors where id=p_target;
 elsif p_action='reorder_floors' then
  if p_target<>b then raise exception 'Exact building required.';end if;
  select coalesce(array_agg(value::uuid),'{}') into ids from jsonb_array_elements_text(p_payload->'ids');
  if cardinality(ids)<>(select count(*) from building_floors where building_id=b) or cardinality(ids)<>(select count(distinct x) from unnest(ids)x)
   or exists(select 1 from unnest(ids) picked(entity_id) where not exists(select 1 from building_floors f2 where f2.building_id=b and f2.id=picked.entity_id)) then raise exception 'Floor list changed. Reload before reordering.'; end if;
  if exists(select 1 from building_floors where building_id=b and updated_at is distinct from (p_payload#>>array['expected',id::text])::timestamptz) then raise exception 'Floor order changed. Reload before reordering.';end if;
  update building_floors floor_row set sort_order=ordered.ord::integer-1,updated_at=now() from unnest(ids) with ordinality ordered(id,ord) where floor_row.id=ordered.id and floor_row.building_id=b;
 elsif p_action='save_unit' then
  select * into u from units where id=p_target for update;
  if u.id is not null and (u.building_id<>b or u.updated_at is distinct from (p_payload->>'expected')::timestamptz) then raise exception 'Unit changed or belongs to another building.'; end if;
  if nullif(btrim(p_payload->>'number'),'') is null or not exists(select 1 from building_floors where building_id=b and name=p_payload->>'floor') then raise exception 'Choose a unit number and configured floor.'; end if;
  if exists(select 1 from units where building_id=b and id<>p_target and lower(btrim(unit_number))=lower(btrim(p_payload->>'number'))) then raise exception 'This unit number already exists in the building.';end if;
  if nullif(p_payload->>'typeId','') is not null and not exists(select 1 from workspace_commands.test_entities where kind='unit_type' and entity_id=(p_payload->>'typeId')::uuid) then raise exception 'Choose a fictional test unit type.'; end if;
  if u.id is null then
   insert into units(id,building_id,unit_number,floor,unit_type_id,unit_type,size_sqm,sale_status,rental_portfolio_status)
    values(p_target,b,btrim(p_payload->>'number'),p_payload->>'floor',nullif(p_payload->>'typeId','')::uuid,(select name from unit_types where id=nullif(p_payload->>'typeId','')::uuid),nullif(p_payload->>'size','')::numeric,'for_sale','not_in_portfolio');
   sale:=public.prepare_unit_baseline_sale_record(p_target,p_actor);
   insert into workspace_commands.test_journeys(sale_id,building_id,unit_id,purpose,enrolled_by,fictional_details_confirmed_at) values(sale,b,p_target,'Fictional test building Sales journey',p_actor,now());
   result:=jsonb_build_object('id',p_target,'saleAttemptId',sale);
  else
   update units set unit_number=btrim(p_payload->>'number'),floor=p_payload->>'floor',unit_type_id=nullif(p_payload->>'typeId','')::uuid,unit_type=(select name from unit_types where id=nullif(p_payload->>'typeId','')::uuid),size_sqm=nullif(p_payload->>'size','')::numeric,updated_at=now() where id=p_target;
   update areas set floor=p_payload->>'floor',updated_at=now() where unit_id=p_target;
  end if;
 elsif p_action in ('save_area','delete_area') then
  select * into a from areas where id=p_target for update;
  if a.id is not null and (a.building_id<>b or a.updated_at is distinct from (p_payload->>'expected')::timestamptz) then raise exception 'Area changed or belongs to another building.'; end if;
  if p_action='delete_area' then
   if a.id is null or exists(select 1 from snags where area_id=p_target) then raise exception 'Area unavailable or has snag history; it cannot be removed.'; end if;
   delete from areas where id=p_target;
  else
   if a.id is not null and a.unit_id is distinct from nullif(p_payload->>'unitId','')::uuid and exists(select 1 from snags where area_id=p_target) then raise exception 'An area with snag history cannot be moved to another unit.';end if;
   if nullif(btrim(p_payload->>'name'),'') is null or p_payload->>'type' not in ('unit_room','communal_area','private_amenity') then raise exception 'Enter an area name and type.'; end if;
   if nullif(p_payload->>'unitId','') is not null then select * into u from units where id=(p_payload->>'unitId')::uuid and building_id=b; if u.id is null then raise exception 'Choose a unit in this building.';end if;
   elsif p_payload->>'type'='unit_room' then raise exception 'Choose a unit for a room.';end if;
   if u.id is null and not exists(select 1 from building_floors where building_id=b and name=p_payload->>'floor') then raise exception 'Choose a configured floor.';end if;
   insert into areas(id,building_id,unit_id,area_type,name,floor,sort_order) values(p_target,b,u.id,p_payload->>'type',btrim(p_payload->>'name'),coalesce(u.floor,p_payload->>'floor'),coalesce((p_payload->>'sortOrder')::integer,0))
    on conflict(id) do update set unit_id=excluded.unit_id,area_type=excluded.area_type,name=excluded.name,floor=excluded.floor,sort_order=excluded.sort_order,updated_at=now();
  end if;
 elsif p_action in ('save_team','remove_team') then
  if p_action='remove_team' then
   select to_jsonb(t) into existing from building_organisations t where id=p_target and building_id=b for update;
   if existing is null or (existing->>'updated_at')::timestamptz is distinct from (p_payload->>'expected')::timestamptz then raise exception 'Team assignment changed. Reload before removing.';end if;
   update building_organisations set active=false,updated_at=now() where id=p_target;
   if existing->>'role_on_project'='sales_agent' then update buildings set sales_agent_organisation_id=null,updated_at=now() where id=b;end if;
   if existing->>'role_on_project'='conveyancer' then update buildings set conveyancer_organisation_id=null,updated_at=now() where id=b;end if;
  else
   org:=(p_payload->>'organisationId')::uuid;
   select * into o from organisations where id=org;
   if not exists(select 1 from workspace_commands.test_entities where kind='organisation' and entity_id=org)
    or (case p_payload->>'role' when 'main_contractor' then 'contractor' else p_payload->>'role' end) is distinct from o.type
    or p_payload->>'role' not in ('main_contractor','developer_representative','supporting_trade','sales_agent','conveyancer') then raise exception 'Choose a matching fictional test organisation and role.';end if;
   select to_jsonb(t) into existing from building_organisations t where id=p_target for update;
   if existing is not null and ((existing->>'building_id')::uuid<>b or (existing->>'updated_at')::timestamptz is distinct from (p_payload->>'expected')::timestamptz) then raise exception 'Team assignment changed.';end if;
   if p_payload->>'role'<>'supporting_trade' then update building_organisations set active=false,updated_at=now() where building_id=b and role_on_project=p_payload->>'role' and id<>p_target and active;end if;
   insert into building_organisations(id,building_id,organisation_id,role_on_project,active,trade_type) values(p_target,b,org,p_payload->>'role',true,p_payload->>'tradeType')
    on conflict(id) do update set organisation_id=excluded.organisation_id,role_on_project=excluded.role_on_project,active=true,trade_type=excluded.trade_type,updated_at=now();
   if p_payload->>'role'='sales_agent' then update buildings set sales_agent_organisation_id=org,updated_at=now() where id=b;end if;
   if p_payload->>'role'='conveyancer' then update buildings set conveyancer_organisation_id=org,updated_at=now() where id=b;end if;
  end if;
 elsif p_action='save_defaults' then
  -- Server supplies the existing validated commercial calculation; the database
  -- retains deposit inheritance triggers and atomically replaces its schedule.
  select to_jsonb(t) into existing from building_sale_defaults t where building_id=b for update;
  if existing is distinct from nullif(p_payload->'expectedDefaults','null'::jsonb) then raise exception 'Building defaults changed. Reload before saving.';end if;
  defaults_value:=p_payload->'defaults';
  insert into building_sale_defaults(building_id,build_cost,default_agent_fee_percent,default_exchange_agent_fee_percent,default_completion_agent_fee_percent,reservation_fee,reservation_fee_holder_default,exchange_deposit_percent,second_deposit_enabled,second_deposit_percent,second_deposit_months_after_exchange,further_deposit_timing)
   values(b,(defaults_value->>'build_cost')::numeric,(defaults_value->>'default_agent_fee_percent')::numeric,(defaults_value->>'default_exchange_agent_fee_percent')::numeric,(defaults_value->>'default_completion_agent_fee_percent')::numeric,(defaults_value->>'reservation_fee')::numeric,defaults_value->>'reservation_fee_holder_default',(defaults_value->>'exchange_deposit_percent')::numeric,(defaults_value->>'second_deposit_enabled')::boolean,(defaults_value->>'second_deposit_percent')::numeric,(defaults_value->>'second_deposit_months_after_exchange')::integer,defaults_value->'further_deposit_timing')
   on conflict(building_id) do update set build_cost=excluded.build_cost,default_agent_fee_percent=excluded.default_agent_fee_percent,default_exchange_agent_fee_percent=excluded.default_exchange_agent_fee_percent,default_completion_agent_fee_percent=excluded.default_completion_agent_fee_percent,reservation_fee=excluded.reservation_fee,reservation_fee_holder_default=excluded.reservation_fee_holder_default,exchange_deposit_percent=excluded.exchange_deposit_percent,second_deposit_enabled=excluded.second_deposit_enabled,second_deposit_percent=excluded.second_deposit_percent,second_deposit_months_after_exchange=excluded.second_deposit_months_after_exchange,further_deposit_timing=excluded.further_deposit_timing,updated_at=now();
  -- Match the existing blank, unreserved-unit fee cascade, inside this transaction.
  -- A deposit-only defaults edit must retain unit-specific fee settings.
  if row(existing->'default_agent_fee_percent',existing->'default_exchange_agent_fee_percent',existing->'default_completion_agent_fee_percent',existing->'reservation_fee',existing->'reservation_fee_holder_default')
     is distinct from row(defaults_value->'default_agent_fee_percent',defaults_value->'default_exchange_agent_fee_percent',defaults_value->'default_completion_agent_fee_percent',defaults_value->'reservation_fee',defaults_value->'reservation_fee_holder_default') then
   update unit_sale_terms t set reservation_fee=(defaults_value->>'reservation_fee')::numeric,
    reservation_fee_holder=defaults_value->>'reservation_fee_holder_default',
    agent_fee_percent=(defaults_value->>'default_agent_fee_percent')::numeric,
    exchange_agent_fee_percent=(defaults_value->>'default_exchange_agent_fee_percent')::numeric,
    completion_agent_fee_percent=(defaults_value->>'default_completion_agent_fee_percent')::numeric,
    vat_rate=(defaults_value->>'default_vat_rate')::numeric,solicitor_fee=(defaults_value->>'default_sales_solicitor_fee')::numeric,
    updated_by_user_id=p_actor,updated_at=now()
   from unit_sale_attempts attempt join units unit on unit.id=attempt.unit_id
   where t.sale_attempt_id=attempt.id and t.is_current and attempt.building_id=b and attempt.is_active
    and unit.sale_status='for_sale' and attempt.workflow_status='draft'
    and attempt.reservation_date is null and attempt.reservation_submitted_at is null
    and attempt.reservation_approved_at is null and attempt.commercial_approved_at is null
    and attempt.exchanged_at is null and attempt.completed_at is null and attempt.legal_completed_at is null
    and nullif(btrim(concat(attempt.buyer_name,attempt.buyer_person_name,attempt.buyer_company_name,attempt.buyer_email,attempt.buyer_phone,attempt.buyer_solicitor_name)),'') is null
    and not exists(select 1 from unit_sale_documents doc where doc.sale_attempt_id=attempt.id and doc.document_type='reservation_form' and doc.status<>'redacted' and doc.redacted_at is null)
    and not exists(select 1 from unit_sale_invoices invoice where invoice.sale_attempt_id=attempt.id)
    and not exists(select 1 from sale_legal_emails email where email.sale_attempt_id=attempt.id);
  end if;
  delete from building_sale_default_payment_schedule where building_id=b;
  insert into building_sale_default_payment_schedule(building_id,sequence_no,payment_stage,label,due_offset_days,percent_of_contract_price,includes_reservation_fee)
   select b,(r->>'sequenceNo')::integer,r->>'paymentStage',r->>'label',(r->>'dueOffsetDays')::integer,(r->>'percentOfContractPrice')::numeric,(r->>'includesReservationFee')::boolean from jsonb_array_elements(p_payload->'schedule') r;
 end if;
 result:=coalesce(result,jsonb_build_object('id',p_target));
 insert into workspace_commands.operation_receipts(id,actor_id,action,target_id,input,result) values(p_request,p_actor,p_action,p_target,p_payload-array['defaults','schedule','expectedDefaults'],result);
 return result;
end $$;
revoke all on function public.workspace_setup_operation(uuid,uuid,text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.workspace_setup_operation(uuid,uuid,text,uuid,jsonb) to service_role;

create function workspace_commands.snag_actor(p_building uuid,p_snag uuid,p_action text) returns public.profiles
language plpgsql security definer set search_path=public,workspace_commands as $$
declare actor profiles%rowtype;s snags%rowtype;
begin
 select * into actor from profiles where id=auth.uid() and active;
 if actor.id is null or actor.role not in ('admin','developer','developer_representative','contractor') or not public.can_access_building(p_building) then raise exception 'Authorised Snags account required.' using errcode='42501';end if;
 if not exists(select 1 from workspace_commands.test_entities where kind='building' and entity_id=p_building) then raise exception 'Snag writes are limited to the fictional test building.'; end if;
 if p_snag is null then
  if actor.role not in ('admin','developer','developer_representative') or p_action not in ('create_snag','context') then raise exception 'Developer snag creation required.' using errcode='42501';end if;
 else
  select * into s from snags where id=p_snag and building_id=p_building;
  if s.id is null or not public.can_access_snag(p_snag) then raise exception 'Snag unavailable in this building.' using errcode='42501';end if;
  if actor.role='contractor' and (not public.contractor_can_access_developer_snag(s.building_id,s.assigned_to_organisation_id) or p_action not in ('resolve_snag','request_snag_info','snag_comment','add_snag_media','context')) then raise exception 'This snag operation requires developer review.' using errcode='42501';end if;
 end if;
 return actor;
end $$;
revoke all on function workspace_commands.snag_actor(uuid,uuid,text) from public,anon,authenticated,service_role;

create function public.workspace_snag_context(p_building uuid,p_snag uuid default null) returns jsonb
language plpgsql security definer set search_path=public,workspace_commands as $$
declare actor profiles%rowtype;editable boolean;
begin
 select * into actor from profiles where id=auth.uid() and active;
 if actor.id is null or actor.role not in ('admin','developer','developer_representative','contractor') or not public.can_access_building(p_building) then raise exception 'Authorised Snags account required.' using errcode='42501';end if;
 if p_snag is not null and not exists(select 1 from snags where id=p_snag and building_id=p_building and public.can_access_snag(id)) then raise exception 'Exact snag unavailable.';end if;
 editable:=exists(select 1 from workspace_commands.test_entities where kind='building' and entity_id=p_building);
 return jsonb_build_object('editable',editable,'role',actor.role,
 'units',coalesce((select jsonb_agg(jsonb_build_object('id',id,'building_id',building_id,'unit_number',unit_number,'floor',floor)) from units where building_id=p_building),'[]'::jsonb),
 'floors',coalesce((select jsonb_agg(to_jsonb(f) order by sort_order) from building_floors f where building_id=p_building),'[]'::jsonb),
 'areas',coalesce((select jsonb_agg(to_jsonb(a) order by sort_order) from areas a where building_id=p_building),'[]'::jsonb),
 'trades',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name) order by sort_order) from trades where active),'[]'::jsonb),
 'teams',coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'name',o.name,'role',t.role_on_project)) from building_organisations t join organisations o on o.id=t.organisation_id where t.building_id=p_building and t.active and t.role_on_project in ('main_contractor','supporting_trade','developer_representative')),'[]'::jsonb),
 'snag',case when p_snag is null then null else (select to_jsonb(s) from snags s where id=p_snag) end);
end $$;
revoke all on function public.workspace_snag_context(uuid,uuid) from public,anon,service_role;
grant execute on function public.workspace_snag_context(uuid,uuid) to authenticated;

create function public.workspace_snag_media(p_building uuid,p_snag uuid,p_request uuid,p_action text,p_name text,p_mime text,p_size bigint)
returns jsonb language plpgsql security definer set search_path=public,workspace_commands as $$
declare actor profiles%rowtype;intent workspace_commands.snag_media_intents%rowtype;ext text;path text;
begin
 actor:=workspace_commands.snag_actor(p_building,p_snag,p_action);
 if p_request is null or p_action not in ('create_snag','resolve_snag','reject_snag','add_snag_media') or p_size<8 or p_size>4194304 or length(p_name)>200 or p_name~'[\\/]' then raise exception 'Choose supported test evidence up to 4 MiB.';end if;
 ext:=case p_mime when 'image/jpeg' then 'jpg' when 'image/png' then 'png' when 'image/webp' then 'webp' when 'video/mp4' then 'mp4' when 'video/webm' then 'webm' end;
 if ext is null then raise exception 'Use JPEG, PNG, WebP, MP4 or WebM evidence.';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_request::text,0));
 select * into intent from workspace_commands.snag_media_intents where id=p_request;
 if found then
  if intent.actor_id<>actor.id or intent.building_id<>p_building or intent.snag_id is distinct from p_snag or intent.action<>p_action or intent.name<>p_name or intent.mime<>p_mime or intent.size<>p_size then raise exception 'Evidence submission reference conflicts.';end if;
  return jsonb_build_object('path',intent.path);
 end if;
 path:=p_building::text||'/'||p_request::text||'/evidence.'||ext;
 insert into workspace_commands.snag_media_intents(id,actor_id,building_id,snag_id,action,path,name,mime,size) values(p_request,actor.id,p_building,p_snag,p_action,path,p_name,p_mime,p_size);
 return jsonb_build_object('path',path);
end $$;
revoke all on function public.workspace_snag_media(uuid,uuid,uuid,text,text,text,bigint) from public,anon,service_role;
grant execute on function public.workspace_snag_media(uuid,uuid,uuid,text,text,text,bigint) to authenticated;

create function public.workspace_snag_operation(p_building uuid,p_snag uuid,p_request uuid,p_action text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public,workspace_commands as $$
declare actor profiles%rowtype;s snags%rowtype;prior workspace_commands.operation_receipts%rowtype;intent workspace_commands.snag_media_intents%rowtype;
 target uuid:=p_snag;unit_id uuid;area areas%rowtype;org uuid;trade uuid;note text;patch jsonb;next_status text;result jsonb;
begin
 actor:=workspace_commands.snag_actor(p_building,p_snag,p_action);
 if p_request is null or jsonb_typeof(p_payload)<>'object' or p_action not in ('create_snag','resolve_snag','request_snag_info','close_snag','reject_snag','answer_snag_info','assign_snag','snag_comment','add_snag_media') then raise exception 'Choose a snag operation and submission reference.';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_request::text,0));
 select * into prior from workspace_commands.operation_receipts where id=p_request;
 if found then
  if prior.actor_id<>actor.id or prior.action<>p_action or prior.target_id is distinct from p_snag or prior.input is distinct from p_payload||jsonb_build_object('buildingId',p_building) then raise exception 'Submission reference conflicts with the saved snag operation.';end if;
  return prior.result;
 end if;
 note:=nullif(btrim(p_payload->>'comment'),'');
 if length(note)>5000 then raise exception 'Use up to 5,000 characters.';end if;
 if p_action in ('snag_comment','request_snag_info','reject_snag','answer_snag_info') and note is null then raise exception 'Enter a comment explaining this action.';end if;
 if p_payload->>'withMedia'='true' then
  select * into intent from workspace_commands.snag_media_intents where id=p_request and actor_id=actor.id and building_id=p_building and snag_id is not distinct from p_snag and action=p_action for update;
  if intent.id is null or not exists(select 1 from storage.objects where bucket_id='workspace-snag-media' and name=intent.path) then raise exception 'Upload this submission’s evidence first.';end if;
 end if;
 if p_action='create_snag' then
  if p_snag is not null or nullif(btrim(p_payload->>'title'),'') is null or length(p_payload->>'title')>240 or length(p_payload->>'description')>10000 or intent.id is null then raise exception 'A title, location and evidence are required for a new snag.';end if;
  unit_id:=nullif(p_payload->>'unitId','')::uuid;
  select * into area from areas where id=(p_payload->>'areaId')::uuid and building_id=p_building;
  if area.id is null or area.unit_id is distinct from unit_id or (unit_id is not null and not exists(select 1 from units where id=unit_id and building_id=p_building)) then raise exception 'Choose a location in this building.';end if;
  org:=nullif(p_payload->>'organisationId','')::uuid;trade:=nullif(p_payload->>'tradeId','')::uuid;
  if org is not null and not exists(select 1 from building_organisations where building_id=p_building and organisation_id=org and active and role_on_project in ('main_contractor','supporting_trade')) then raise exception 'Choose a contractor assigned to this building.';end if;
  if trade is not null and not exists(select 1 from trades where id=trade and active) then raise exception 'Choose an active trade.';end if;
  target:=gen_random_uuid();
  insert into snags(id,building_id,unit_id,area_id,source_type,created_by,created_by_user_id,title,description,trade_id,assigned_to_organisation_id,priority,priority_code,status)
   values(target,p_building,unit_id,area.id,'developer_snag',actor.id,actor.id,btrim(p_payload->>'title'),nullif(btrim(p_payload->>'description'),''),trade,org,null,null,'open');
 else
  select * into s from snags where id=p_snag and building_id=p_building for update;
  if p_action not in ('snag_comment','add_snag_media') and s.updated_at is distinct from (p_payload->>'expected')::timestamptz then raise exception 'Snag changed. Reload before saving.';end if;
  if p_action='snag_comment' then
   insert into snag_events(snag_id,event_type,comment,created_by_user_id) values(target,'note',note,actor.id);
  elsif p_action='add_snag_media' then
   if intent.id is null then raise exception 'Choose evidence to add.';end if;
  elsif p_action='assign_snag' then
   if actor.role='contractor' then raise exception 'Developer allocation required.' using errcode='42501';end if;
   org:=nullif(p_payload->>'organisationId','')::uuid;trade:=nullif(p_payload->>'tradeId','')::uuid;
   if org is not null and not exists(select 1 from building_organisations where building_id=p_building and organisation_id=org and active and role_on_project in ('main_contractor','supporting_trade')) then raise exception 'Choose a building contractor.';end if;
   if trade is not null and not exists(select 1 from trades where id=trade and active) then raise exception 'Choose an active trade.';end if;
   if nullif(p_payload->>'priority','') is not null and p_payload->>'priority' not in ('P1','P2','P3') then raise exception 'Choose a valid priority.';end if;
   patch:=jsonb_build_object('assigned_to_organisation_id',org,'assigned_to_user_id',null,'trade_id',trade,'priority_code',nullif(p_payload->>'priority',''),'sla_due_date',nullif(p_payload->>'due',''));
   perform public.change_snag(target,patch,note);
  else
   if s.status::text='closed' then raise exception 'This snag is already closed.';end if;
   next_status:=case p_action when 'resolve_snag' then 'resolved_by_contractor' when 'request_snag_info' then 'needs_more_info' when 'close_snag' then 'closed' when 'reject_snag' then 'rejected_back_to_contractor' when 'answer_snag_info' then 'open' end;
   if p_action in ('close_snag','reject_snag','answer_snag_info') and actor.role='contractor' then raise exception 'Developer review required.' using errcode='42501';end if;
   if p_action='reject_snag' and s.status::text<>'resolved_by_contractor' then raise exception 'Only resolved snags can be returned to the contractor.';end if;
   if p_action='answer_snag_info' and s.status::text<>'needs_more_info' then raise exception 'This snag is not awaiting more information.';end if;
   if p_action in ('resolve_snag','request_snag_info') and s.status::text in ('resolved_by_contractor','needs_more_info') then raise exception 'This snag is awaiting developer review.';end if;
   perform public.change_snag(target,jsonb_build_object('status',next_status,'closed_at',case when next_status='closed' then now() end),note);
  end if;
 end if;
 if intent.id is not null then
  insert into snag_photos(snag_id,file_url,photo_type,caption,uploaded_by_user_id,media_type,storage_path,mime_type,file_size_bytes)
   values(target,'private:'||intent.path,case when p_action='resolve_snag' then 'resolution_photo' else 'annotated' end,note,actor.id,case when intent.mime like 'video/%' then 'video' else 'image' end,intent.path,intent.mime,intent.size);
  insert into snag_events(snag_id,event_type,comment,created_by_user_id) values(target,'photo_added',coalesce(note,'Test evidence added.'),actor.id);
 end if;
 result:=jsonb_build_object('id',target);
 insert into workspace_commands.operation_receipts(id,actor_id,action,target_id,input,result) values(p_request,actor.id,p_action,p_snag,p_payload||jsonb_build_object('buildingId',p_building),result);
 return result;
end $$;
revoke all on function public.workspace_snag_operation(uuid,uuid,uuid,text,jsonb) from public,anon,service_role;
grant execute on function public.workspace_snag_operation(uuid,uuid,uuid,text,jsonb) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('workspace-snag-media','workspace-snag-media',false,4194304,array['image/jpeg','image/png','image/webp','video/mp4','video/webm']);
create policy "exact visible workspace snag evidence" on storage.objects for select to authenticated using(
 bucket_id='workspace-snag-media' and exists(select 1 from public.profiles where id=auth.uid() and active)
 and exists(select 1 from public.snag_photos p join public.snags s on s.id=p.snag_id where p.storage_path=objects.name and p.file_url='private:'||objects.name and public.can_access_building(s.building_id) and public.can_access_snag(p.snag_id))
);


create function public.workspace_setup_receipt(p_actor uuid,p_request uuid,p_action text,p_target uuid,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public,workspace_commands as $$
declare r workspace_commands.operation_receipts%rowtype;
begin
 perform workspace_commands.setup_actor(p_actor);
 select * into r from workspace_commands.operation_receipts where id=p_request;
 if not found then return null;end if;
 if r.actor_id<>p_actor or r.action<>p_action or r.target_id<>p_target or r.input is distinct from (p_payload-array['defaults','schedule','expectedDefaults']) then raise exception 'Submission reference conflicts with the saved operation.';end if;
 return jsonb_build_object('result',r.result);
end $$;
revoke all on function public.workspace_setup_receipt(uuid,uuid,text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.workspace_setup_receipt(uuid,uuid,text,uuid,jsonb) to service_role;

commit;
