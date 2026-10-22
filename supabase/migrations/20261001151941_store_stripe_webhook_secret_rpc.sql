
create or replace function public.store_stripe_deposit_webhook_secret(p_secret text)
returns void
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_id uuid;
begin
  if p_secret is null or length(p_secret) < 10 then
    raise exception 'invalid webhook secret';
  end if;

  select id into v_id
  from vault.decrypted_secrets
  where name = 'stripe_deposit_webhook_secret'
  order by created_at desc
  limit 1;

  if v_id is null then
    perform vault.create_secret(
      p_secret,
      'stripe_deposit_webhook_secret',
      'Stripe deposit webhook signing secret'
    );
  else
    perform vault.update_secret(
      v_id,
      p_secret,
      'stripe_deposit_webhook_secret',
      'Stripe deposit webhook signing secret'
    );
  end if;
end;
$$;

revoke all on function public.store_stripe_deposit_webhook_secret(text) from public, anon, authenticated;
grant execute on function public.store_stripe_deposit_webhook_secret(text) to service_role;
