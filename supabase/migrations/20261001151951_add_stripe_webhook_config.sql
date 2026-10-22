
create table if not exists public.stripe_webhook_config (
  config_key text primary key,
  stripe_account_id text,
  webhook_endpoint_id text,
  mode text not null default 'test',
  updated_at timestamptz not null default now()
);

alter table public.stripe_webhook_config enable row level security;
revoke all on public.stripe_webhook_config from anon, authenticated;
