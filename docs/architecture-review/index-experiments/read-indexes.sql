begin;
create index snags_building_status_id on public.snags(building_id,status,id);
create index areas_building_unit_id on public.areas(building_id,unit_id,id);
create index snag_events_latest_transition on public.snag_events(snag_id,created_at desc,id desc) where event_type in ('status_change','triage');
create index snag_photos_snag_id on public.snag_photos(snag_id,id);
commit;
