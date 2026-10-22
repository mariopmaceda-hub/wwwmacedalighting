
create table if not exists public.lead_followup_config (
  id smallint primary key default 1 check (id = 1),
  enabled boolean not null default true,
  send_enabled boolean not null default false,
  go_live_at timestamptz not null,
  followup_1_hours integer not null default 24 check (followup_1_hours > 0),
  followup_2_hours integer not null default 72 check (followup_2_hours > followup_1_hours),
  followup_3_hours integer not null default 168 check (followup_3_hours > followup_2_hours),
  worker_token text not null,
  updated_at timestamptz not null default now()
);

alter table public.lead_followup_config enable row level security;

create table if not exists public.lead_followup_state (
  quote_id uuid primary key references public.quotes(id) on delete cascade,
  enrolled_at timestamptz not null default now(),
  initial_response_at timestamptz,
  initial_response_message_id uuid references public.sms_messages(id) on delete set null,
  followups_sent integer not null default 0 check (followups_sent between 0 and 3),
  next_followup_at timestamptz,
  status text not null default 'awaiting_personalized_response'
    check (status in (
      'awaiting_personalized_response',
      'waiting_for_consent',
      'scheduled',
      'customer_replied',
      'human_owned',
      'handed_off',
      'closed',
      'test_spam',
      'hold',
      'error'
    )),
  last_inbound_at timestamptz,
  last_human_outbound_at timestamptz,
  last_automated_followup_at timestamptz,
  manual_hold boolean not null default false,
  closed_reason text,
  last_error text,
  updated_at timestamptz not null default now()
);

alter table public.lead_followup_state enable row level security;

create index if not exists lead_followup_state_due_idx
  on public.lead_followup_state (next_followup_at)
  where status = 'scheduled' and manual_hold = false;

create table if not exists public.lead_followup_audit (
  id bigint generated always as identity primary key,
  quote_id uuid not null references public.quotes(id) on delete cascade,
  event text not null,
  stage integer,
  dedupe_key text not null unique,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.lead_followup_audit enable row level security;

insert into public.lead_followup_config (
  id, enabled, send_enabled, go_live_at,
  followup_1_hours, followup_2_hours, followup_3_hours, worker_token
)
values (
  1, true, false, '2026-10-06T13:52:59-07:00'::timestamptz,
  24, 72, 168, replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
)
on conflict (id) do update set
  go_live_at = excluded.go_live_at,
  followup_1_hours = excluded.followup_1_hours,
  followup_2_hours = excluded.followup_2_hours,
  followup_3_hours = excluded.followup_3_hours,
  send_enabled = false,
  updated_at = now();
