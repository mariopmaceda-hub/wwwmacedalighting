-- ISOLATED DATABASE ONLY. Never run fixtures against the hosted project.
INSERT INTO public.quotes(id,name,phone,email,address,job_status,deposit_status,deposit_paid,quote_amount,photo_paths) VALUES
('00000000-0000-4000-8000-000000000001','TEST installation','2025550101','one@example.invalid','TEST','Completed','not_started',0,100,'{}'),
('00000000-0000-4000-8000-000000000002','TEST paid job','2025550102','two@example.invalid','TEST','Scheduled','paid',50,100,ARRAY['test/photo.jpg']),
('00000000-0000-4000-8000-000000000003','TEST second job','2025550102','two@example.invalid','TEST','Scheduled','not_started',0,100,'{}');
SET LOCAL ROLE service_role;
DO $$
DECLARE a uuid:='a47b5dfb-f38c-4b2c-9867-0e5b8db7087b';q uuid:='00000000-0000-4000-8000-000000000002';blocked boolean:=false;
BEGIN
 IF has_function_privilege('anon','public.manage_leads(uuid[],text,uuid,text,text)','EXECUTE') OR has_function_privilege('authenticated','public.list_managed_orders(text,text,text,text,integer)','EXECUTE') THEN RAISE EXCEPTION 'Browser RPC permissions'; END IF;
 IF has_function_privilege('service_role','private.run_order_retention()','EXECUTE') THEN RAISE EXCEPTION 'Scheduler exposed'; END IF;
 IF has_table_privilege('authenticated','public.order_retention','SELECT') THEN RAISE EXCEPTION 'Retention records exposed'; END IF;
 IF EXISTS(SELECT 1 FROM public.order_retention) THEN RAISE EXCEPTION 'Installation starts timer'; END IF;
 UPDATE public.quotes SET job_status='Removal Completed' WHERE id=q;
 IF NOT EXISTS(SELECT 1 FROM public.order_retention WHERE quote_id=q AND removal_completed_at=now()) THEN RAISE EXCEPTION 'Removal starts no timer'; END IF;
 UPDATE public.order_retention SET removal_completed_at=now()-interval '1 hour' WHERE quote_id=q;
 UPDATE public.quotes SET job_status='Removal Completed' WHERE id=q;
 IF NOT EXISTS(SELECT 1 FROM public.order_retention WHERE quote_id=q AND removal_completed_at=now()-interval '1 hour') THEN RAISE EXCEPTION 'Same status resets timer'; END IF;
 BEGIN PERFORM public.manage_leads(ARRAY[q],'trash',NULL);EXCEPTION WHEN OTHERS THEN blocked:=true;END;
 IF NOT blocked THEN RAISE EXCEPTION 'Null actor accepted'; END IF;
 blocked:=false;BEGIN PERFORM public.manage_leads(ARRAY[q],'trash','00000000-0000-4000-8000-000000000099');EXCEPTION WHEN OTHERS THEN blocked:=true;END;
 IF NOT blocked THEN RAISE EXCEPTION 'Unknown actor accepted'; END IF;
 PERFORM public.manage_leads(ARRAY[q],'trash',a);
 IF (public.list_managed_orders('trash')->>'count')::int<>1 THEN RAISE EXCEPTION 'Paid job absent from shared trash'; END IF;
 IF (public.list_managed_orders('leads')->>'count')::int<>2 THEN RAISE EXCEPTION 'Single job hides other customer job'; END IF;
 PERFORM public.manage_leads(ARRAY[q],'restore',a);
 IF NOT EXISTS(SELECT 1 FROM public.order_retention WHERE quote_id=q AND automatic_hold) THEN RAISE EXCEPTION 'Restore fails to pause timer'; END IF;
 UPDATE public.quotes SET job_status='Scheduled' WHERE id=q;
 IF EXISTS(SELECT 1 FROM public.order_retention WHERE quote_id=q AND removal_completed_at IS NOT NULL) THEN RAISE EXCEPTION 'Reopened removal countdown'; END IF;
 UPDATE public.quotes SET job_status='Removal Completed' WHERE id=q;
END $$;
RESET ROLE;
DO $$
DECLARE q uuid:='00000000-0000-4000-8000-000000000002';a uuid:='a47b5dfb-f38c-4b2c-9867-0e5b8db7087b';before_q jsonb;after_q jsonb;r jsonb;
BEGIN
 SELECT to_jsonb(t) INTO before_q FROM public.quotes t WHERE id=q;
 IF (private.run_order_retention()->>'enabled')::boolean THEN RAISE EXCEPTION 'Enabled prematurely'; END IF;
 UPDATE private.retention_config SET enabled=true;
 UPDATE public.order_retention SET removal_completed_at=now()-interval '720 hours'+interval '1 second' WHERE quote_id=q;
 PERFORM private.run_order_retention();
 IF (public.list_managed_orders('trash')->>'count')::int<>0 THEN RAISE EXCEPTION '30-day timer early'; END IF;
 UPDATE public.order_retention SET removal_completed_at=now()-interval '720 hours' WHERE quote_id=q;
 PERFORM private.run_order_retention();
 IF (public.list_managed_orders('trash')->>'count')::int<>1 THEN RAISE EXCEPTION '30-day timer late'; END IF;
 UPDATE public.lead_management SET trashed_at=now()-interval '360 hours'+interval '1 second' WHERE quote_id=q;
 PERFORM private.run_order_retention();
 IF (public.list_managed_orders('archive')->>'count')::int<>0 THEN RAISE EXCEPTION '15-day timer early'; END IF;
 UPDATE public.lead_management SET trashed_at=now()-interval '360 hours' WHERE quote_id=q;
 PERFORM private.run_order_retention();
 IF (public.list_managed_orders('archive')->>'count')::int<>1 OR (public.list_managed_leads(true)->>'count')::int<>0 THEN RAISE EXCEPTION 'Archive and Trash overlap'; END IF;
 SELECT to_jsonb(t) INTO after_q FROM public.quotes t WHERE id=q;
 IF before_q IS DISTINCT FROM after_q THEN RAISE EXCEPTION 'Archiving changed original customer/payment/photo data'; END IF;
 r:=private.run_order_retention();
 IF (r->>'archived')::int<>0 OR (SELECT count(*) FROM public.order_retention_audit WHERE quote_id=q)<>2 THEN RAISE EXCEPTION 'Worker is not idempotent'; END IF;
 PERFORM public.manage_leads(ARRAY[q],'restore',a);
 PERFORM private.run_order_retention();
 IF (public.list_managed_orders('archive')->>'count')::int<>0 OR (public.list_managed_orders('leads')->>'count')::int<>3 THEN RAISE EXCEPTION 'Archive restore failed'; END IF;
 -- All customer jobs use the same operation and one Trash bin.
 PERFORM public.manage_leads(ARRAY[q,'00000000-0000-4000-8000-000000000003'::uuid],'trash',a);
 IF (public.list_managed_orders('trash')->>'count')::int<>2 THEN RAISE EXCEPTION 'Customer multi-order trash failed'; END IF;
 IF (SELECT count(*) FROM public.quotes)<>3 THEN RAISE EXCEPTION 'Data deleted'; END IF;
END $$;
SELECT 'Archive integration checks passed: boundaries, permissions, shared Trash, preservation, restore, idempotence' AS result;
