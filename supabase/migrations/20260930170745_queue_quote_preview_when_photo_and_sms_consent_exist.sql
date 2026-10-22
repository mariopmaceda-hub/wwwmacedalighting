
create or replace function public.maceda_prepare_quote_preview()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if coalesce(new.sms_opt_in,false) and coalesce(cardinality(new.photo_paths),0) > 0 then
      if new.preview_status in ('not_started','waiting_for_photo','failed') then
        new.preview_status := 'queued';
      end if;
    elsif coalesce(cardinality(new.photo_paths),0) = 0 then
      new.preview_status := 'waiting_for_photo';
    end if;
  elsif tg_op = 'UPDATE' then
    if (new.photo_paths is distinct from old.photo_paths or new.sms_opt_in is distinct from old.sms_opt_in)
       and coalesce(new.sms_opt_in,false)
       and coalesce(cardinality(new.photo_paths),0) > 0
       and new.preview_status in ('not_started','waiting_for_photo','failed') then
      new.preview_status := 'queued';
      new.preview_error := null;
    elsif coalesce(cardinality(new.photo_paths),0) = 0
       and new.preview_status not in ('sent','generated') then
      new.preview_status := 'waiting_for_photo';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists maceda_prepare_quote_preview_trigger on public.quotes;

create trigger maceda_prepare_quote_preview_trigger
before insert or update of photo_paths, sms_opt_in on public.quotes
for each row execute function public.maceda_prepare_quote_preview();
