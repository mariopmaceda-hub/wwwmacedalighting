
alter table public.quotes
  add column if not exists quote_amount numeric(12,2),
  add column if not exists deposit_percent numeric(5,4) not null default 0.50,
  add column if not exists deposit_required numeric(12,2),
  add column if not exists deposit_status text not null default 'not_started',
  add column if not exists deposit_paid numeric(12,2) not null default 0,
  add column if not exists deposit_checkout_session_id text,
  add column if not exists deposit_checkout_url text,
  add column if not exists deposit_payment_intent_id text,
  add column if not exists deposit_paid_at timestamptz;

alter table public.quotes
  drop constraint if exists quotes_deposit_status_check;

alter table public.quotes
  add constraint quotes_deposit_status_check
  check (deposit_status = any (array[
    'not_started'::text,
    'awaiting_deposit'::text,
    'paid'::text,
    'failed'::text,
    'refunded'::text
  ]));
