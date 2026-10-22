
alter table public.quotes
  add column if not exists scheduling_status text not null default 'locked',
  add column if not exists scheduling_ready_at timestamptz,
  add column if not exists scheduling_override boolean not null default false,
  add column if not exists booking_link text,
  add column if not exists booking_link_sent_at timestamptz,
  add column if not exists installation_start_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'quotes_scheduling_status_check'
  ) then
    alter table public.quotes
      add constraint quotes_scheduling_status_check
      check (scheduling_status in ('locked','ready','booked','cancelled'));
  end if;
end $$;

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
    return new;
  end if;

  if new.deposit_status = 'paid'
     and coalesce(new.deposit_paid,0) >= coalesce(new.deposit_required,0)
     and coalesce(new.deposit_required,0) > 0 then
    if new.scheduling_status not in ('booked','cancelled') then
      new.scheduling_status := 'ready';
      new.scheduling_ready_at := coalesce(new.scheduling_ready_at, now());
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

drop trigger if exists maceda_apply_scheduling_gate_trigger on public.quotes;
create trigger maceda_apply_scheduling_gate_trigger
before insert or update of deposit_status, deposit_paid, deposit_required, scheduling_override, scheduling_status
on public.quotes
for each row
execute function public.maceda_apply_scheduling_gate();

update public.quotes
set scheduling_status = case
      when deposit_status='paid'
       and coalesce(deposit_paid,0) >= coalesce(deposit_required,0)
       and coalesce(deposit_required,0) > 0
      then 'ready'
      else 'locked'
    end,
    scheduling_ready_at = case
      when deposit_status='paid'
       and coalesce(deposit_paid,0) >= coalesce(deposit_required,0)
       and coalesce(deposit_required,0) > 0
      then coalesce(scheduling_ready_at, now())
      else null
    end
where scheduling_status is distinct from
      case
        when deposit_status='paid'
         and coalesce(deposit_paid,0) >= coalesce(deposit_required,0)
         and coalesce(deposit_required,0) > 0
        then 'ready'
        else 'locked'
      end;
