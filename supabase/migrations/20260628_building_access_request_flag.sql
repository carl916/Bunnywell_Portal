alter table public.buildings
add column if not exists allow_resident_access_requests boolean not null default true;

