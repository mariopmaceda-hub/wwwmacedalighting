
select vault.create_secret(
  encode(gen_random_bytes(32), 'hex'),
  'maceda_deposit_trigger_token',
  'Internal token for Maceda deposit checkout automation'
)
where not exists (
  select 1 from vault.decrypted_secrets where name = 'maceda_deposit_trigger_token'
);

create or replace function public.get_maceda_deposit_trigger_token()
returns text
language sql
security definer
set search_path = public, vault
as $$
  select decrypted_secret
  from vault.decrypted_secrets
  where name = 'maceda_deposit_trigger_token'
  order by created_at desc
  limit 1;
$$;

revoke all on function public.get_maceda_deposit_trigger_token() from public, anon, authenticated;

create or replace function public.maceda_prepare_deposit()
returns trigger
language plpgsql
as $$
begin
  if new.quote_amount is not null and new.quote_amount > 0 then
    if new.deposit_percent is null or new.deposit_percent <= 0 then
      new.deposit_percent := 0.50;
    end if;
    if new.deposit_required is null or new.deposit_required <= 0 then
      new.deposit_required := round((new.quote_amount * new.deposit_percent)::numeric, 2);
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists maceda_prepare_deposit_trigger on public.quotes;
create trigger maceda_prepare_deposit_trigger
before insert or update of quote_amount, deposit_percent
on public.quotes
for each row
execute function public.maceda_prepare_deposit();

create or replace function public.maceda_invoke_deposit_checkout()
returns trigger
language plpgsql
security definer
set search_path = public, vault, extensions
as $$
declare
  token text;
begin
  select decrypted_secret into token
  from vault.decrypted_secrets
  where name = 'maceda_deposit_trigger_token'
  order by created_at desc
  limit 1;

  perform net.http_post(
    url := 'https://gidqdlcvyasqalitqvcn.supabase.co/functions/v1/create-deposit-checkout',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-deposit-token', token
    ),
    body := jsonb_build_object('quote_id', new.id::text)
  );

  return new;
end;
$$;

revoke all on function public.maceda_invoke_deposit_checkout() from public, anon, authenticated;

drop trigger if exists maceda_invoke_deposit_checkout_trigger on public.quotes;
create trigger maceda_invoke_deposit_checkout_trigger
after insert or update of deposit_status
on public.quotes
for each row
when (
  new.deposit_status = 'awaiting_deposit'
  and new.quote_amount is not null
  and new.quote_amount > 0
  and new.deposit_checkout_session_id is null
)
execute function public.maceda_invoke_deposit_checkout();
