alter type public.user_role add value if not exists 'developer_representative';
alter type public.user_role add value if not exists 'resident';

alter table public.profiles
add column if not exists resident_type text;

alter table public.profiles
drop constraint if exists profiles_resident_type_check;

alter table public.profiles
add constraint profiles_resident_type_check
check (
  resident_type is null
  or resident_type in ('leaseholder', 'tenant', 'letting_agent', 'managing_agent')
);
