UPDATE private.retention_config SET enabled=true WHERE id;
SELECT cron.schedule('maceda_order_retention','17 * * * *','select private.run_order_retention()');
