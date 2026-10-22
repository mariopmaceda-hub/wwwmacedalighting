
create extension if not exists pg_net;

create or replace function public.maceda_push_new_quote_to_sheet()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, net, vault
as $$
declare
  webhook_url text;
begin
  select decrypted_secret
    into webhook_url
  from vault.decrypted_secrets
  where name = 'maceda_lead_webhook_url'
  order by created_at desc
  limit 1;

  if webhook_url is null or webhook_url = '' then
    raise warning 'maceda_lead_webhook_url is not configured';
    return new;
  end if;

  perform net.http_post(
    url := webhook_url,
    body := jsonb_build_object(
      'type', 'INSERT',
      'table', TG_TABLE_NAME,
      'schema', TG_TABLE_SCHEMA,
      'record', to_jsonb(new),
      'old_record', null
    ),
    headers := jsonb_build_object('Content-Type', 'application/json'),
    timeout_milliseconds := 5000
  );

  return new;
end;
$$;

drop trigger if exists maceda_quotes_insert_webhook on public.quotes;

create trigger maceda_quotes_insert_webhook
after insert on public.quotes
for each row
execute function public.maceda_push_new_quote_to_sheet();
