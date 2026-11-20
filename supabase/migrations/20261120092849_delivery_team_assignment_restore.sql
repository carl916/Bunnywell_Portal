-- Preserve all uniqueness constraints, permissions and non-team Setup commands.
CREATE OR REPLACE FUNCTION public.workspace_setup_operation(p_actor uuid, p_request uuid, p_action text, p_target uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'workspace_commands'
AS $function$
declare assignment building_organisations%rowtype; holder building_organisations%rowtype;
 team_role text; role_label text; organisation_name text; previous_name text; team_changed boolean := true;
 prior workspace_commands.operation_receipts%rowtype; b uuid; entity_kind text; existing jsonb; result jsonb;
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
 elsif p_action='review_access_request' then entity_kind:='access_request';
 elsif p_action in ('save_person','set_person_status') then entity_kind:='profile';
 elsif p_action in ('save_floor','delete_floor','reorder_floors','save_unit','save_area','delete_area','save_team','remove_team','save_defaults','save_lifecycle','save_contacts','set_sales_availability','set_rental_portfolio') then
  b:=(p_payload->>'buildingId')::uuid;
  if not exists(select 1 from buildings where id=b) then raise exception 'Building unavailable.'; end if;
  perform 1 from buildings where id=b for update;
 else raise exception 'Setup operation unavailable.'; end if;
 if p_action in ('create_building','save_building') then
  select to_jsonb(t) into existing from buildings t where id=p_target for update;
  if p_action='create_building' and existing is not null then raise exception 'Building already exists.'; end if;
  if p_action='save_building' and (existing is null or (existing->>'updated_at')::timestamptz is distinct from (p_payload->>'expected')::timestamptz) then raise exception 'Building changed. Reload before saving.'; end if;
  if nullif(btrim(p_payload->>'name'),'') is null then raise exception 'Enter a building name.'; end if;
  if p_action='create_building' then
   insert into buildings(id,name,address_line_1,town,postcode,status,lifecycle_status,allow_resident_access_requests,seller_name,created_at,updated_at)
    values(p_target,btrim(p_payload->>'name'),p_payload->>'address',p_payload->>'town',p_payload->>'postcode','active','pre_handover',true,null,now(),now());
   -- Compatibility enrollment is an environment safeguard, never authorization.
   insert into workspace_commands.test_entities(kind,entity_id,created_by) values('building',p_target,p_actor) on conflict do nothing;
  else
   update buildings set name=btrim(p_payload->>'name'),
    address_line_1=p_payload->>'address',town=p_payload->>'town',postcode=p_payload->>'postcode',notes=p_payload->>'notes',
    updated_at=now() where id=p_target;
  end if;
 elsif p_action in ('create_organisation','save_organisation') then
  select to_jsonb(t) into existing from organisations t where id=p_target for update;
  if p_action='create_organisation' and existing is not null then raise exception 'Organisation already exists.'; end if;
  if p_action='save_organisation' and (existing is null or (existing->>'updated_at')::timestamptz is distinct from (p_payload->>'expected')::timestamptz) then raise exception 'Organisation changed. Reload before saving.'; end if;
  if nullif(btrim(p_payload->>'name'),'') is null or coalesce(p_payload->>'type','') not in ('developer_representative','contractor','supporting_trade','sales_agent','conveyancer','letting_agent','managing_agent') then raise exception 'Enter an organisation name and valid type.'; end if;

  if existing is not null and existing->>'type' is distinct from p_payload->>'type' and (
   exists(select 1 from profiles where organisation_id=p_target) or exists(select 1 from building_organisations where organisation_id=p_target and active) or exists(select 1 from buildings where sales_agent_organisation_id=p_target or conveyancer_organisation_id=p_target)) then raise exception 'This organisation is in use. Reassign its users and building roles before changing its type.';end if;
  insert into organisations(id,name,type,main_contact_name,email,phone,shared_system_email)
   values(p_target,btrim(p_payload->>'name'),p_payload->>'type',p_payload->>'contact',nullif(lower(p_payload->>'email'),''),p_payload->>'phone',nullif(lower(p_payload->>'systemEmail'),''))
  on conflict(id) do update set name=excluded.name,type=excluded.type,main_contact_name=excluded.main_contact_name,email=excluded.email,phone=excluded.phone,shared_system_email=excluded.shared_system_email,updated_at=now();
 elsif p_action in ('create_trade','save_trade','create_type','save_type') then
  if nullif(btrim(p_payload->>'name'),'') is null then raise exception 'Enter a name.'; end if;
  if entity_kind='trade' then
   select to_jsonb(t) into existing from trades t where id=p_target for update;
   if p_action='save_trade' and (existing is null or (existing->>'updated_at')::timestamptz is distinct from (p_payload->>'expected')::timestamptz) then raise exception 'Trade changed. Reload before saving.'; end if;
   if p_action='create_trade' and existing is not null then raise exception 'Trade already exists.';end if;
   insert into trades(id,name,sort_order,active) values(p_target,btrim(p_payload->>'name'),coalesce((p_payload->>'sortOrder')::integer,0),coalesce((p_payload->>'active')::boolean,true))
    on conflict(id) do update set name=excluded.name,sort_order=excluded.sort_order,active=excluded.active,updated_at=now();
  else
   select to_jsonb(t) into existing from unit_types t where id=p_target for update;
   if p_action='save_type' and (existing is null or (existing->>'updated_at')::timestamptz is distinct from (p_payload->>'expected')::timestamptz) then raise exception 'Unit type changed. Reload before saving.'; end if;
   if p_action='create_type' and existing is not null then raise exception 'Unit type already exists.';end if;
   insert into unit_types(id,name,description) values(p_target,btrim(p_payload->>'name'),p_payload->>'description')
    on conflict(id) do update set name=excluded.name,description=excluded.description,updated_at=now();
  end if;
 elsif p_action='review_access_request' then
  select to_jsonb(t) into existing from resident_access_requests t where id=p_target for update;
  if existing is null or (existing->>'updated_at')::timestamptz is distinct from (p_payload->>'expected')::timestamptz then raise exception 'Access request changed. Reload before reviewing.';end if;
  if coalesce(p_payload->>'decision','') not in ('approve','reject','save_notes') then raise exception 'Choose a review action.';end if;
  if p_payload->>'decision'<>'save_notes' and existing->>'status'<>'pending' then raise exception 'This request has already been reviewed.';end if;
  if p_payload->>'decision'='approve' then
   select id into org from profiles where lower(email)=lower(existing->>'email') and active and role='resident' for update;
   if org is null then raise exception 'Create or activate the resident account and assign its flats before approving this request.';end if;
   if exists(select 1 from jsonb_array_elements(existing->'requested_units') x where not exists(select 1 from units where id=(x->>'unit_id')::uuid and building_id=(x->>'building_id')::uuid)) then raise exception 'A requested flat is unavailable.';end if;
   select jsonb_agg(x) into defaults_value from (select distinct jsonb_build_object('unitId',unit_id,'accessType',access_type) x from user_unit_access where user_id=org union select jsonb_build_object('unitId',x->>'unit_id','accessType',existing->>'resident_type') from jsonb_array_elements(existing->'requested_units') x) q;
   select array_agg(distinct building_id) into ids from units where id in(select (x->>'unitId')::uuid from jsonb_array_elements(defaults_value)x);
   perform save_portal_user_access(org,(select to_jsonb(p) from profiles p where id=org),ids,defaults_value);
  end if;
  update resident_access_requests set admin_notes=nullif(p_payload->>'notes',''),status=case p_payload->>'decision' when 'approve' then 'approved' when 'reject' then 'rejected' else status end,reviewed_by_user_id=case when p_payload->>'decision'='save_notes' then reviewed_by_user_id else p_actor end,reviewed_at=case when p_payload->>'decision'='save_notes' then reviewed_at else now() end,updated_at=now() where id=p_target;
 elsif p_action='save_person' then
  select to_jsonb(t) into existing from profiles t where id=p_target for update;
  if existing is null or (existing->>'updated_at')::timestamptz is distinct from (p_payload->>'expected')::timestamptz then raise exception 'Person or access changed. Reload before saving.'; end if;
  org:=nullif(p_payload->>'organisationId','')::uuid;
  select coalesce(array_agg(value::uuid),'{}') into ids from jsonb_array_elements_text(coalesce(p_payload->'buildingIds','[]'::jsonb));
  if nullif(btrim(p_payload->>'name'),'') is null or coalesce(p_payload->>'role','') not in ('admin','developer','developer_representative','contractor','sales_agent','conveyancer','resident') then raise exception 'Enter a name and valid role.'; end if;
  if exists(select 1 from unnest(ids) id where not exists(select 1 from buildings where buildings.id=id)) then raise exception 'Choose existing buildings.'; end if;
  if p_payload->>'role' in ('developer_representative','contractor','sales_agent','conveyancer') and (cardinality(ids)=0 or not exists(select 1 from organisations where id=org and (type=p_payload->>'role' or (p_payload->>'role'='contractor' and type='supporting_trade')))) then raise exception 'Choose a matching organisation and at least one building.'; end if;
  if p_payload->>'role'='resident' then
   if coalesce(p_payload->>'residentType','') not in ('leaseholder','tenant','letting_agent','managing_agent') or jsonb_array_length(coalesce(p_payload->'unitAccess','[]'::jsonb))=0 then raise exception 'Choose a resident type and at least one flat.'; end if;
   if exists(select 1 from jsonb_array_elements(p_payload->'unitAccess') x where x->>'accessType' not in ('leaseholder','tenant','letting_agent','managing_agent','representative') or not exists(select 1 from units where id=(x->>'unitId')::uuid)) then raise exception 'Choose valid flat access.'; end if;
   select array_agg(distinct building_id) into ids from units where id in(select (x->>'unitId')::uuid from jsonb_array_elements(p_payload->'unitAccess') x);
  end if;
  perform public.save_portal_user_access(p_target,jsonb_build_object('email',existing->>'email','name',btrim(p_payload->>'name'),'full_name',btrim(p_payload->>'name'),'phone',p_payload->>'phone','role',p_payload->>'role','resident_type',case when p_payload->>'role'='resident' then p_payload->>'residentType' end,'organisation_id',case when p_payload->>'role' in ('developer_representative','contractor','sales_agent','conveyancer') then org end),ids,case when p_payload->>'role'='resident' then p_payload->'unitAccess' else '[]'::jsonb end);
  update profiles set updated_at=now() where id=p_target;
 elsif p_action='set_person_status' then
  if p_target=p_actor or jsonb_typeof(p_payload->'active') is distinct from 'boolean' then raise exception 'Choose an account and active status.'; end if;
  select to_jsonb(t) into existing from profiles t where id=p_target for update;
  if existing is null or (existing->>'updated_at')::timestamptz is distinct from (p_payload->>'expected')::timestamptz then raise exception 'Person changed. Reload before saving.'; end if;
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
  if nullif(p_payload->>'typeId','') is not null and not exists(select 1 from unit_types where id=(p_payload->>'typeId')::uuid) then raise exception 'Choose an existing unit type.'; end if;
  if nullif(p_payload->>'size','')::numeric<0 or exists(select 1 from jsonb_array_elements_text(coalesce(p_payload->'parking','[]')) v where v::integer<0) then raise exception 'Size and parking bay numbers must be non-negative.';end if;
  if u.id is null then
   insert into units(id,building_id,unit_number,floor,unit_type_id,unit_type,size_sqm,parking_bays,sale_status,rental_portfolio_status)
    values(p_target,b,btrim(p_payload->>'number'),p_payload->>'floor',nullif(p_payload->>'typeId','')::uuid,(select name from unit_types where id=nullif(p_payload->>'typeId','')::uuid),nullif(p_payload->>'size','')::numeric,ARRAY(select value::integer from jsonb_array_elements_text(coalesce(p_payload->'parking','[]'::jsonb))),'not_released','not_in_portfolio');
   insert into areas(building_id,unit_id,area_type,name,floor,sort_order)
    select b,p_target,'unit_room',name,p_payload->>'floor',sort_order from unit_type_areas where unit_type_id=nullif(p_payload->>'typeId','')::uuid and not coalesce(optional,false);
  else
   update units set unit_number=btrim(p_payload->>'number'),floor=p_payload->>'floor',unit_type_id=nullif(p_payload->>'typeId','')::uuid,unit_type=(select name from unit_types where id=nullif(p_payload->>'typeId','')::uuid),size_sqm=nullif(p_payload->>'size','')::numeric,parking_bays=ARRAY(select value::integer from jsonb_array_elements_text(coalesce(p_payload->'parking','[]'::jsonb))),updated_at=now() where id=p_target;
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
   if nullif(btrim(p_payload->>'name'),'') is null or coalesce(p_payload->>'type','') not in ('unit_room','communal_area','private_amenity') then raise exception 'Enter an area name and type.'; end if;
   if nullif(p_payload->>'unitId','') is not null then select * into u from units where id=(p_payload->>'unitId')::uuid and building_id=b; if u.id is null then raise exception 'Choose a unit in this building.';end if;
   elsif p_payload->>'type'='unit_room' then raise exception 'Choose a unit for a room.';end if;
   if u.id is null and not exists(select 1 from building_floors where building_id=b and name=p_payload->>'floor') then raise exception 'Choose a configured floor.';end if;
   insert into areas(id,building_id,unit_id,area_type,name,floor,sort_order) values(p_target,b,u.id,p_payload->>'type',btrim(p_payload->>'name'),coalesce(u.floor,p_payload->>'floor'),coalesce((p_payload->>'sortOrder')::integer,0))
    on conflict(id) do update set unit_id=excluded.unit_id,area_type=excluded.area_type,name=excluded.name,floor=excluded.floor,sort_order=excluded.sort_order,updated_at=now();
  end if;

 elsif p_action in ('save_team','remove_team') then
  -- The building row is locked above, before reading either assignment. All Setup
  -- saves/removals for this building serialize, including an initially empty role.
  -- This subtransaction restores the outgoing holder on ANY replacement failure.
  begin
   if p_action='remove_team' then
    select * into assignment from building_organisations where id=p_target and building_id=b for update;
    team_role:=assignment.role_on_project;
    select name into organisation_name from organisations where id=assignment.organisation_id;
    if assignment.id is null or assignment.updated_at is distinct from (p_payload->>'expected')::timestamptz then
     raise exception 'Team assignment changed. Reload before removing.';
    end if;
    team_changed:=assignment.active;
    update building_organisations set active=false,updated_at=clock_timestamp() where id=assignment.id and active;
    result:=jsonb_build_object('id',assignment.id,'changed',team_changed,'message',
     coalesce(organisation_name,'Organisation')||case when team_changed then ' removed as ' else ' is no longer assigned as ' end||replace(team_role,'_',' ')||'.');
   else
    org:=(p_payload->>'organisationId')::uuid;
    team_role:=p_payload->>'role';
    role_label:=upper(left(team_role,1))||substring(replace(team_role,'_',' ') from 2);
    select * into o from organisations where id=org;
    organisation_name:=o.name;
    if o.id is null
     or (case team_role when 'main_contractor' then 'contractor' else team_role end) is distinct from o.type
     or coalesce(team_role,'') not in ('main_contractor','developer_representative','supporting_trade','sales_agent','conveyancer') then
     raise exception 'Choose a matching organisation and role.';
    end if;
    -- Identity is the existing unique tuple, not the client-generated candidate ID.
    select * into assignment from building_organisations
     where building_id=b and organisation_id=org and role_on_project=team_role for update;
    if assignment.active and coalesce(assignment.trade_type,'')=coalesce(p_payload->>'tradeType','') then
     team_changed:=false;
     result:=jsonb_build_object('id',assignment.id,'changed',false,'message',organisation_name||' is already assigned as '||replace(team_role,'_',' ')||'.');
    else
     if team_role in ('main_contractor','developer_representative') then
      select * into holder from building_organisations where building_id=b and role_on_project=team_role and active for update;
      select name into previous_name from organisations where id=holder.organisation_id;
      -- New clients protect against overwriting another user's intervening save.
      if p_payload ? 'expectedHolderId' and
       (holder.id is distinct from nullif(p_payload->>'expectedHolderId','')::uuid
        or holder.updated_at is distinct from nullif(p_payload->>'expectedHolderUpdatedAt','')::timestamptz) then
       raise exception 'Team assignment changed. Reload before saving.';
      end if;
      update building_organisations set active=false,updated_at=clock_timestamp()
       where building_id=b and role_on_project=team_role and active and organisation_id<>org;
     end if;
     if assignment.id is not null then
      update building_organisations set active=true,trade_type=p_payload->>'tradeType',updated_at=clock_timestamp()
       where id=assignment.id returning * into assignment;
     else
      insert into building_organisations(id,building_id,organisation_id,role_on_project,active,trade_type)
       values(p_target,b,org,team_role,true,p_payload->>'tradeType') returning * into assignment;
     end if;
     result:=jsonb_build_object('id',assignment.id,'changed',true,'message',
      case when previous_name is not null and holder.organisation_id<>org then
       role_label||' changed from '||previous_name||' to '||organisation_name||'.'
      else organisation_name||' assigned as '||replace(team_role,'_',' ')||'.' end);
    end if;
   end if;
  exception when others then
   -- Database details remain in the server log; the client gets a useful summary.
   raise log 'Delivery team operation % failed for building %: % [%]',p_action,b,sqlerrm,sqlstate;
   select string_agg(o2.name,', ' order by o2.name) into previous_name
    from building_organisations t join organisations o2 on o2.id=t.organisation_id
    where t.building_id=b and t.role_on_project=team_role and t.active;
   return jsonb_build_object('ok',false,'message',
    case when p_action='remove_team' then 'Could not remove ' else 'Could not assign ' end||coalesce(organisation_name,'the selected organisation')||
    ' as '||coalesce(replace(team_role,'_',' '),'the selected role')||'. '||
    case when previous_name is not null then previous_name||' is still assigned. ' else 'No organisation is currently assigned. ' end||
    'Reload the current team and try again.');
  end;
 elsif p_action in ('save_lifecycle','save_contacts') then
  if p_target<>b then raise exception 'Exact building required.';end if;
  select to_jsonb(t) into existing from buildings t where id=b for update;
  if (existing->>'updated_at')::timestamptz is distinct from (p_payload->>'expected')::timestamptz then raise exception 'Building changed. Reload before saving.';end if;
  if p_action='save_lifecycle' then
   if jsonb_typeof(p_payload->'pcConfirmed') is distinct from 'boolean' or jsonb_typeof(p_payload->'allowRequests') is distinct from 'boolean' then raise exception 'Choose valid lifecycle settings.';end if;
   update buildings set pc_date=nullif(p_payload->>'pcDate','')::date,pc_confirmed=(p_payload->>'pcConfirmed')::boolean,defects_liability_end_date=case when (p_payload->>'pcConfirmed')::boolean then (nullif(p_payload->>'pcDate','')::date+interval '12 months')::date else null end,allow_resident_access_requests=(p_payload->>'allowRequests')::boolean,updated_at=now() where id=b;
  else
   if nullif(p_payload->>'conveyancerId','') is not null and not exists(select 1 from organisations where id=(p_payload->>'conveyancerId')::uuid and type='conveyancer') then raise exception 'Choose a conveyancer organisation.';end if;
   if nullif(p_payload->>'agentId','') is not null and not exists(select 1 from organisations where id=(p_payload->>'agentId')::uuid and type='sales_agent') then raise exception 'Choose a sales agent organisation.';end if;
   update buildings set conveyancer_organisation_id=nullif(p_payload->>'conveyancerId','')::uuid,sales_agent_organisation_id=nullif(p_payload->>'agentId','')::uuid,seller_name=nullif(btrim(p_payload->>'sellerName'),''),completion_information=nullif(btrim(p_payload->>'completionInformation'),''),updated_at=now() where id=b;
  end if;
 elsif p_action in ('set_sales_availability','set_rental_portfolio') then
  if p_target<>b then raise exception 'Exact building required.';end if;
  select array_agg(value::uuid) into ids from jsonb_array_elements_text(p_payload->'unitIds');
  if coalesce(cardinality(ids),0)=0 or cardinality(ids)>250 or cardinality(ids)<>(select count(distinct x) from unnest(ids)x) then raise exception 'Choose a valid unit selection.';end if;
  perform 1 from units where id=any(ids) order by id for update;
  if exists(select 1 from unnest(ids) picked(id) where not exists(select 1 from units where units.id=picked.id and building_id=b and updated_at=(p_payload#>>array['expected',picked.id::text])::timestamptz)) then raise exception 'Units changed or belong to another building. Reload before saving.';end if;
  if p_action='set_sales_availability' then n:=public.set_unit_sales_availability(ids,p_payload->>'target',p_actor,'unit_allocation');
  else n:=public.set_unit_rental_portfolio_status(ids,p_payload->>'target',p_actor,'unit_allocation');end if;
  result:=jsonb_build_object('id',b,'changed',n);
 elsif p_action='save_defaults' then
  -- Server supplies the existing validated commercial calculation; the database
  -- retains deposit inheritance triggers and atomically replaces its schedule.
  select to_jsonb(t) into existing from building_sale_defaults t where building_id=b for update;
  if existing is distinct from nullif(p_payload->'expectedDefaults','null'::jsonb) then raise exception 'Building defaults changed. Reload before saving.';end if;
  defaults_value:=p_payload->'defaults';
  insert into building_sale_defaults(building_id,build_cost,default_vat_rate,default_sales_solicitor_fee,default_agent_fee_percent,default_exchange_agent_fee_percent,default_completion_agent_fee_percent,reservation_fee,reservation_fee_holder_default,exchange_deposit_percent,second_deposit_enabled,second_deposit_percent,second_deposit_months_after_exchange,further_deposit_timing)
   values(b,(defaults_value->>'build_cost')::numeric,(defaults_value->>'default_vat_rate')::numeric,(defaults_value->>'default_sales_solicitor_fee')::numeric,(defaults_value->>'default_agent_fee_percent')::numeric,(defaults_value->>'default_exchange_agent_fee_percent')::numeric,(defaults_value->>'default_completion_agent_fee_percent')::numeric,(defaults_value->>'reservation_fee')::numeric,defaults_value->>'reservation_fee_holder_default',(defaults_value->>'exchange_deposit_percent')::numeric,(defaults_value->>'second_deposit_enabled')::boolean,(defaults_value->>'second_deposit_percent')::numeric,(defaults_value->>'second_deposit_months_after_exchange')::integer,defaults_value->'further_deposit_timing')
   on conflict(building_id) do update set build_cost=excluded.build_cost,default_vat_rate=excluded.default_vat_rate,default_sales_solicitor_fee=excluded.default_sales_solicitor_fee,default_agent_fee_percent=excluded.default_agent_fee_percent,default_exchange_agent_fee_percent=excluded.default_exchange_agent_fee_percent,default_completion_agent_fee_percent=excluded.default_completion_agent_fee_percent,reservation_fee=excluded.reservation_fee,reservation_fee_holder_default=excluded.reservation_fee_holder_default,exchange_deposit_percent=excluded.exchange_deposit_percent,second_deposit_enabled=excluded.second_deposit_enabled,second_deposit_percent=excluded.second_deposit_percent,second_deposit_months_after_exchange=excluded.second_deposit_months_after_exchange,further_deposit_timing=excluded.further_deposit_timing,updated_at=now();
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
 if team_changed and p_action not in ('set_sales_availability','set_rental_portfolio','save_contacts') then
  insert into audit_events(event_type,entity_type,entity_id,summary,category,building_id,unit_id,created_by_user_id,metadata,action_id,source,outcome)
  values(case when entity_kind='building' or p_action in ('save_lifecycle','save_defaults') then 'building_updated' else p_action end,
   coalesce(entity_kind,case when p_action in ('save_unit') then 'unit' when p_action in ('save_area','delete_area') then 'area' when p_action in ('save_floor','delete_floor') then 'floor' else 'building' end),case when p_action in ('save_team','remove_team') then assignment.id else p_target end,
   coalesce(result->>'message',initcap(replace(p_action,'_',' '))||' saved through Setup.'),case when entity_kind in ('profile','access_request') then 'users' else 'setup' end,
   case when entity_kind='building' then p_target else b end,case when p_action='save_unit' then p_target end,p_actor,
   jsonb_build_object('operation',p_action,'request_id',p_request,'building_id',case when entity_kind='building' then p_target else b end) || case when p_action in ('save_team','remove_team') then jsonb_build_object('assignment_id',assignment.id,'organisation_id',assignment.organisation_id,'role',team_role,'previous_organisation_id',holder.organisation_id) else '{}'::jsonb end,p_request,'workspace_setup','success');
 end if;
 result:=coalesce(result,jsonb_build_object('id',p_target));
 insert into workspace_commands.operation_receipts(id,actor_id,action,target_id,input,result) values(p_request,p_actor,p_action,p_target,p_payload-array['defaults','schedule','expectedDefaults'],result);
 return result;
end $function$

;
