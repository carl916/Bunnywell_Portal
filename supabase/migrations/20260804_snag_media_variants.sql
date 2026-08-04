alter table public.snag_photos
  add column if not exists media_type text not null default 'image',
  add column if not exists thumbnail_url text,
  add column if not exists thumbnail_square_url text,
  add column if not exists thumbnail_landscape_url text,
  add column if not exists report_image_url text,
  add column if not exists storage_path text,
  add column if not exists thumbnail_storage_path text,
  add column if not exists thumbnail_square_storage_path text,
  add column if not exists thumbnail_landscape_storage_path text,
  add column if not exists report_image_storage_path text,
  add column if not exists mime_type text,
  add column if not exists file_size_bytes bigint,
  add column if not exists duration_seconds numeric;

alter table public.snag_photos
  drop constraint if exists snag_photos_media_type_check;

alter table public.snag_photos
  add constraint snag_photos_media_type_check
  check (media_type in ('image', 'video'));

create index if not exists snag_photos_media_type_idx
  on public.snag_photos (media_type);
