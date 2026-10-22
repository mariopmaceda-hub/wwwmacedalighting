
alter table public.quotes
  add column if not exists cal_booking_uid text,
  add column if not exists cal_booking_status text,
  add column if not exists cal_booking_start_at timestamptz,
  add column if not exists cal_booking_end_at timestamptz,
  add column if not exists cal_booking_updated_at timestamptz;

create table if not exists public.cal_webhook_events (
  event_key text primary key,
  trigger_event text,
  booking_uid text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  status text not null default 'received',
  error text
);

alter table public.cal_webhook_events enable row level security;
revoke all on public.cal_webhook_events from anon, authenticated;

create or replace function public.maceda_apply_scheduling_gate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.scheduling_override = true then
    if new.scheduling_status = 'locked' then
      new.scheduling_status := 'ready';
      new.scheduling_ready_at := coalesce(new.scheduling_ready_at, now());
    end if;
    if new.booking_link is null or new.booking_link = '' then
      new.booking_link :=
        'https://cal.com/mario-maceda-pnuvzg/chrismas-light-installation?quoteId=' || new.id::text;
    end if;
    return new;
  end if;

  if new.deposit_status = 'paid'
     and coalesce(new.deposit_paid,0) >= coalesce(new.deposit_required,0)
     and coalesce(new.deposit_required,0) > 0 then
    if new.scheduling_status not in ('booked','cancelled') then
      new.scheduling_status := 'ready';
      new.scheduling_ready_at := coalesce(new.scheduling_ready_at, now());
    end if;
    if new.booking_link is null or new.booking_link = '' then
      new.booking_link :=
        'https://cal.com/mario-maceda-pnuvzg/chrismas-light-installation?quoteId=' || new.id::text;
    end if;
  else
    if new.scheduling_status <> 'cancelled' then
      new.scheduling_status := 'locked';
      new.scheduling_ready_at := null;
      new.booking_link := null;
      new.booking_link_sent_at := null;
      new.installation_start_at := null;
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.maceda_apply_scheduling_gate() from public, anon, authenticated;

update public.quotes
set booking_link =
  'https://cal.com/mario-maceda-pnuvzg/chrismas-light-installation?quoteId=' || id::text
where scheduling_status in ('ready','booked')
  and (booking_link is null or booking_link='');
