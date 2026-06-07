alter table public.organisations drop constraint if exists organisations_type_check;

update public.organisations
set type = case
  when type in ('managing_agent', 'sales_agent') then 'agent'
  when type = 'developer' then 'contractor'
  else type
end;

alter table public.organisations
add constraint organisations_type_check
check (type in ('agent', 'contractor', 'trade'));
