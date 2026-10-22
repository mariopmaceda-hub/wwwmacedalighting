
create extension if not exists pg_cron with schema pg_catalog;

do $$
declare
  v_job bigint;
begin
  select jobid into v_job
  from cron.job
  where jobname = 'maceda_sync_stripe_deposits'
  limit 1;

  if v_job is not null then
    perform cron.unschedule(v_job);
  end if;

  perform cron.schedule(
    'maceda_sync_stripe_deposits',
    '*/2 * * * *',
    $job$
      select net.http_post(
        url := 'https://gidqdlcvyasqalitqvcn.supabase.co/functions/v1/sync-stripe-deposits',
        headers := jsonb_build_object(
          'Content-Type','application/json',
          'x-deposit-token', public.get_maceda_deposit_trigger_token()
        ),
        body := '{}'::jsonb
      );
    $job$
  );
end
$$;
