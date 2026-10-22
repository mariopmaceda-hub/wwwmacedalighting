
alter table public.quotes
  add column if not exists preview_reviewed_at timestamptz,
  add column if not exists preview_review_action text,
  add column if not exists preview_review_note text;
