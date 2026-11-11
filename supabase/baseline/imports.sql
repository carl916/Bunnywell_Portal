-- Explicit imported historical positions are evidence, not fabricated legal confirmations.
begin;
create table public.unit_import_origins (
 unit_id uuid primary key references public.units(id), source text not null,
 sale_status text not null check(sale_status in ('not_released','not_for_sale','for_sale','reserved','exchanged','completed')),
 imported_at timestamptz not null default now(), completion_date date,
 constraint import_source_present check(length(btrim(source))>0)
);
alter table public.unit_import_origins enable row level security;
revoke all on public.unit_import_origins from public,anon,authenticated;
grant select,insert on public.unit_import_origins to service_role;
create or replace function public.initialize_imported_unit_sale_status(p_unit_id uuid,p_sale_status text,p_source text)
returns void language plpgsql security definer set search_path='' as $$
declare u public.units%rowtype; prior public.unit_import_origins%rowtype;
begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Imported unit status initialization requires the service role.' using errcode='42501'; end if;
 if p_sale_status not in ('not_released','not_for_sale','for_sale','reserved','exchanged','completed') or nullif(btrim(p_source),'') is null then raise exception 'Unsupported import status or source'; end if;
 select * into u from public.units where id=p_unit_id for update;
 if not found then raise exception 'Imported unit not found'; end if;
 if exists(select 1 from public.unit_sale_attempts where unit_id=p_unit_id) then raise exception 'Imported status cannot overwrite a unit with sale history'; end if;
 select * into prior from public.unit_import_origins where unit_id=p_unit_id;
 if found then
  if prior.sale_status<>p_sale_status or prior.source<>p_source then raise exception 'Import conflicts with the recorded historical position; explicit reconciliation required'; end if;
  if u.sale_status=p_sale_status or (p_sale_status='completed' and u.sale_status='handed_over') then return; end if;
  raise exception 'Unit has progressed since import; refusing to overwrite it';
 end if;
 insert into public.unit_import_origins(unit_id,source,sale_status,completion_date) values(p_unit_id,p_source,p_sale_status,u.completion_date);
 perform set_config('app.unit_commercial_mutation','on',true);
 perform set_config('app.historical_unit_import',p_unit_id::text,true);
 update public.units set sale_status=p_sale_status,updated_at=now() where id=p_unit_id;
 perform set_config('app.historical_unit_import','',true);
end $$;
revoke all on function public.initialize_imported_unit_sale_status(uuid,text,text) from public,anon,authenticated;
grant execute on function public.initialize_imported_unit_sale_status(uuid,text,text) to service_role;
create or replace function public.sales_legal_unit_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if TG_OP='UPDATE' and coalesce(auth.jwt()->>'role','')='service_role'
  and current_setting('app.historical_unit_import',true)=new.id::text
  and exists(select 1 from public.unit_import_origins i where i.unit_id=new.id and i.sale_status=new.sale_status)
  and not exists(select 1 from public.unit_sale_attempts where unit_id=new.id) then return new; end if;
 if tg_op='INSERT' and new.sale_status in ('completed','handed_over') then raise exception 'New units must progress through legal completion before handover.'; end if;
 if new.sale_status='completed' and old.sale_status is distinct from new.sale_status and not exists(select 1 from public.unit_sale_attempts where unit_id=new.id and is_active and legal_completed_at is not null) then
 raise exception 'Conveyancer confirmation of legal completion is required before handover or key release.'; end if;
 return new;
end $$;
revoke all on function public.sales_legal_unit_guard() from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
