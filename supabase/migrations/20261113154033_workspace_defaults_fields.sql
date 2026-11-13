begin;
-- Persist every field produced by the existing validated defaults helper.
-- This replaces only the reviewed function text and does not rewrite any records.
do $migration$
declare definition text; original text;
begin
 select pg_get_functiondef('public.workspace_setup_operation(uuid,uuid,text,uuid,jsonb)'::regprocedure) into definition;
 original:=definition;
 if position('insert into building_sale_defaults(building_id,build_cost,default_agent_fee_percent' in definition)=0 then raise exception 'Unexpected Setup function version';end if;
 definition:=replace(definition,
  'insert into building_sale_defaults(building_id,build_cost,default_agent_fee_percent',
  'insert into building_sale_defaults(building_id,build_cost,default_vat_rate,default_sales_solicitor_fee,default_agent_fee_percent');
 definition:=replace(definition,
  'values(b,(defaults_value->>''build_cost'')::numeric,(defaults_value->>''default_agent_fee_percent'')::numeric',
  'values(b,(defaults_value->>''build_cost'')::numeric,(defaults_value->>''default_vat_rate'')::numeric,(defaults_value->>''default_sales_solicitor_fee'')::numeric,(defaults_value->>''default_agent_fee_percent'')::numeric');
 definition:=replace(definition,
  'on conflict(building_id) do update set build_cost=excluded.build_cost,default_agent_fee_percent',
  'on conflict(building_id) do update set build_cost=excluded.build_cost,default_vat_rate=excluded.default_vat_rate,default_sales_solicitor_fee=excluded.default_sales_solicitor_fee,default_agent_fee_percent');
 if definition=original then raise exception 'Defaults fields were not added';end if;
 execute definition;
end $migration$;
commit;
