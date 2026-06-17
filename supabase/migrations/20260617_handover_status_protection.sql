create or replace function public.prevent_manual_handed_over_unit_status()
returns trigger
language plpgsql
as $$
begin
  if new.sale_status = 'handed_over'
    and (
      tg_op = 'INSERT'
      or old.sale_status is distinct from 'handed_over'
    )
    and coalesce(current_setting('app.handover_completion', true), '') <> 'on'
  then
    raise exception 'Handed Over can only be set by completing the handover workflow.';
  end if;

  return new;
end;
$$;

drop trigger if exists prevent_manual_handed_over_unit_status on public.units;
create trigger prevent_manual_handed_over_unit_status
before insert or update on public.units
for each row execute function public.prevent_manual_handed_over_unit_status();

create or replace function public.complete_handover_unit()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1 from public.units
    where id = new.unit_id and sale_status = 'completed'
  ) then
    raise exception 'Handovers can only be created for completed units.';
  end if;

  perform set_config('app.handover_completion', 'on', true);

  update public.units
  set sale_status = 'handed_over',
      handover_date = new.handover_date,
      updated_at = now()
  where id = new.unit_id;

  return new;
end;
$$;
