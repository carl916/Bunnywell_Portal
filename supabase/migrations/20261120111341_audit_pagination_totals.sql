-- Count after filtering and before the cursor. Keep existing callers' array response.
do $migration$
declare definition text;
begin
 select pg_get_functiondef('public.portal_audit_page(jsonb,timestamp with time zone,uuid,text)'::regprocedure) into definition;
 if position('), page as (' in definition)=0 or position('and (p_before_time is null' in definition)=0 then
  raise exception 'Audit pagination changed; review before applying.';
 end if;
 definition:=replace(definition,'), page as (', '), filtered as (');
 definition:=replace(definition,'      and (p_before_time is null',
  '      and (nullif(p_filters->>''search'','''') is null or concat_ws('' '',f.summary,f.actor_name,replace(f.event_type,''_'','' '')) ilike ''%''||(p_filters->>''search'')||''%'')
  ), page as (
    select f.*, (select count(*) from filtered) as filtered_total from filtered f where (true)
      and (p_before_time is null');
 execute definition;
end $migration$;
