CREATE OR REPLACE FUNCTION public.complete_handover_unit()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
declare
  target_building_id uuid;
begin
  select u.building_id
  into target_building_id
  from public.units u
  where u.id = new.unit_id
    and u.sale_status = 'completed';

  if target_building_id is null then
    raise exception 'Handovers can only be created for completed units.';
  end if;

  if not public.building_allows_flat_handover(target_building_id) then
    raise exception 'Flat handover can only be completed once Practical Completion has been confirmed.';
  end if;

  perform set_config('app.handover_completion', 'on', true);

  update public.units
  set sale_status = 'handed_over',
      handover_date = new.handover_date,
      updated_at = now()
  where id = new.unit_id;

  return new;
end;
$function$
