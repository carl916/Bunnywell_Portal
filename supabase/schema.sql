create type public.user_role as enum ('admin', 'user');
create type public.snag_status as enum ('Open', 'Pending', 'Resolved');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  role public.user_role not null default 'user',
  created_at timestamptz not null default now()
);

create table public.flats (
  id uuid primary key default gen_random_uuid(),
  flat_reference text not null,
  building_name text not null,
  created_at timestamptz not null default now(),
  unique (flat_reference, building_name)
);

create table public.snags (
  id uuid primary key default gen_random_uuid(),
  flat_id uuid not null references public.flats(id) on delete restrict,
  title text not null,
  description text,
  status public.snag_status not null default 'Open',
  priority integer not null default 2 check (priority in (1, 2, 3)),
  image_path text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.snag_comments (
  id uuid primary key default gen_random_uuid(),
  snag_id uuid not null references public.snags(id) on delete cascade,
  user_id uuid not null references public.profiles(id),
  body text not null,
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    coalesce(new.email, ''),
    new.raw_user_meta_data ->> 'full_name',
    'user'
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.flats enable row level security;
alter table public.snags enable row level security;
alter table public.snag_comments enable row level security;

create policy "profiles are visible to authenticated users"
on public.profiles for select
to authenticated
using (true);

create policy "users can update their own profile"
on public.profiles for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

create policy "flats are visible to authenticated users"
on public.flats for select
to authenticated
using (true);

create policy "admins manage flats"
on public.flats for all
to authenticated
using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'))
with check (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

create policy "snags are visible to authenticated users"
on public.snags for select
to authenticated
using (true);

create policy "authenticated users create snags"
on public.snags for insert
to authenticated
with check (created_by = auth.uid());

create policy "admins update snags"
on public.snags for update
to authenticated
using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'))
with check (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

create policy "admins delete snags"
on public.snags for delete
to authenticated
using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

create policy "comments are visible to authenticated users"
on public.snag_comments for select
to authenticated
using (true);

create policy "authenticated users create comments"
on public.snag_comments for insert
to authenticated
with check (user_id = auth.uid());

insert into storage.buckets (id, name, public)
values ('snag-images', 'snag-images', true)
on conflict (id) do update set public = true;

create policy "snag images are publicly readable"
on storage.objects for select
using (bucket_id = 'snag-images');

create policy "authenticated users upload snag images"
on storage.objects for insert
to authenticated
with check (bucket_id = 'snag-images');

create policy "admins update snag images"
on storage.objects for update
to authenticated
using (
  bucket_id = 'snag-images'
  and exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
)
with check (
  bucket_id = 'snag-images'
  and exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
);

create policy "admins delete snag images"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'snag-images'
  and exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
);
