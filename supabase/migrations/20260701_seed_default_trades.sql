insert into public.trades (name, sort_order, active)
values
  ('Decorating', 10, true),
  ('Electrical', 20, true),
  ('Plumbing', 30, true),
  ('Carpentry', 40, true),
  ('Flooring', 50, true),
  ('Cleaning', 60, true)
on conflict (name) do update
set
  sort_order = excluded.sort_order,
  active = true,
  updated_at = now();
