-- Sanitized historical restoration: the original literal Vault credential provisioning block is intentionally omitted.
-- Already-applied production history is unchanged. This file MUST NOT be replayed in production.
-- New environments require independently approved provisioning of the token referenced below before operational use.
-- The canonical trigger/function/storage statements below are preserved; this is not a placeholder migration.

create or replace function public.maceda_invoke_quote_preview()
returns trigger
language plpgsql
security definer
set search_path = public, vault, net
as $$
declare
  preview_token text;
  request_id bigint;
begin
  if new.preview_status <> 'queued' then
    return new;
  end if;

  if tg_op = 'UPDATE' and old.preview_status is not distinct from new.preview_status then
    return new;
  end if;

  select decrypted_secret
    into preview_token
  from vault.decrypted_secrets
  where name = 'maceda_preview_webhook_token'
  limit 1;

  if preview_token is null then
    raise warning 'Maceda preview webhook token is missing';
    return new;
  end if;

  select net.http_post(
    url := 'https://gidqdlcvyasqalitqvcn.supabase.co/functions/v1/generate-quote-preview',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-preview-token', preview_token
    ),
    body := jsonb_build_object('quote_id', new.id)
  ) into request_id;

  return new;
end;
$$;

revoke all on function public.maceda_invoke_quote_preview() from public, anon, authenticated;

drop trigger if exists maceda_invoke_quote_preview_trigger on public.quotes;

create trigger maceda_invoke_quote_preview_trigger
after insert or update of preview_status on public.quotes
for each row
when (new.preview_status = 'queued')
execute function public.maceda_invoke_quote_preview();

update storage.buckets
set public = false
where id = 'quote-photos';
