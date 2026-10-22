
create table if not exists public.stripe_webhook_events (
  event_id text primary key,
  event_type text not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  status text not null default 'received',
  error text
);

alter table public.stripe_webhook_events enable row level security;
revoke all on public.stripe_webhook_events from anon, authenticated;

create or replace function public.get_stripe_webhook_secret()
returns text
language sql
security definer
set search_path = public, vault
as $$
  select decrypted_secret
  from vault.decrypted_secrets
  where name = 'stripe_deposit_webhook_secret'
  order by created_at desc
  limit 1;
$$;

revoke all on function public.get_stripe_webhook_secret() from public, anon, authenticated;
