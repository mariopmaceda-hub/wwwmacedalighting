
alter table public.quotes
  add column if not exists sms_opt_in boolean not null default false,
  add column if not exists sms_opt_in_at timestamptz,
  add column if not exists preview_status text not null default 'not_started',
  add column if not exists preview_source_photo_path text,
  add column if not exists preview_image_path text,
  add column if not exists preview_generated_at timestamptz,
  add column if not exists preview_sent_at timestamptz,
  add column if not exists preview_error text,
  add column if not exists preview_attempts integer not null default 0,
  add column if not exists preview_version integer not null default 1,
  add column if not exists selected_package text,
  add column if not exists selected_package_at timestamptz,
  add column if not exists preview_sms_sid text,
  add column if not exists preview_sms_status text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'quotes_preview_status_check'
      and conrelid = 'public.quotes'::regclass
  ) then
    alter table public.quotes
      add constraint quotes_preview_status_check
      check (preview_status in (
        'not_started','waiting_for_photo','queued','processing',
        'generated','sent','needs_review','failed'
      ));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'quotes_selected_package_check'
      and conrelid = 'public.quotes'::regclass
  ) then
    alter table public.quotes
      add constraint quotes_selected_package_check
      check (selected_package is null or selected_package in (
        'basic','standard','full_display'
      ));
  end if;
end $$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'quote-previews',
  'quote-previews',
  false,
  10485760,
  array['image/png','image/jpeg','image/webp']
)
on conflict (id) do nothing;
