
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
        'https://cal.com/mario-maceda-pnuvzg/chrismas-light-installation?metadata[quote_id]=' || new.id::text;
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
        'https://cal.com/mario-maceda-pnuvzg/chrismas-light-installation?metadata[quote_id]=' || new.id::text;
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

update public.quotes
set booking_link =
  'https://cal.com/mario-maceda-pnuvzg/chrismas-light-installation?metadata[quote_id]=' || id::text
where scheduling_status in ('ready','booked');
