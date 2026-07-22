alter table public.profiles
drop constraint if exists profiles_role_final_check;

alter table public.profiles
add constraint profiles_role_final_check
check (role::text in ('admin', 'developer', 'developer_representative', 'sales_agent', 'conveyancer', 'contractor', 'resident', 'user'));
