-- Reviewed deployment script. Apply transactionally before the new admin UI/API.
-- Scheduling is separate; all customer and financial records are preserved.
CREATE TABLE public.order_retention (
  quote_id uuid PRIMARY KEY REFERENCES public.quotes(id) ON DELETE CASCADE,
  removal_completed_at timestamptz,
  archived_at timestamptz,
  automatic_hold boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE private.retention_config(id boolean PRIMARY KEY DEFAULT true CHECK(id),enabled boolean NOT NULL DEFAULT false);
INSERT INTO private.retention_config DEFAULT VALUES;
CREATE TABLE public.order_retention_audit(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,quote_id uuid NOT NULL REFERENCES public.quotes(id),action text NOT NULL CHECK(action IN ('auto_trash','archive')),created_at timestamptz NOT NULL DEFAULT now(),before_state jsonb,after_state jsonb);
ALTER TABLE public.order_retention ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_retention_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.retention_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.order_retention,public.order_retention_audit FROM PUBLIC,anon,authenticated;
REVOKE ALL ON private.retention_config FROM PUBLIC,anon,authenticated,service_role;
GRANT ALL ON public.order_retention TO service_role;
CREATE INDEX order_retention_due ON public.order_retention(removal_completed_at) WHERE NOT automatic_hold AND archived_at IS NULL;
CREATE INDEX lead_management_trash_due ON public.lead_management(trashed_at) WHERE trashed_at IS NOT NULL;
CREATE FUNCTION private.track_removal_completion() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.job_status IS DISTINCT FROM OLD.job_status THEN
  INSERT INTO public.order_retention(quote_id,removal_completed_at,automatic_hold)
  VALUES(NEW.id,CASE WHEN NEW.job_status='Removal Completed' THEN now() END,false)
  ON CONFLICT(quote_id) DO UPDATE SET removal_completed_at=EXCLUDED.removal_completed_at,automatic_hold=false,updated_at=now();
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.track_removal_completion() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER retention_removal_completed AFTER UPDATE OF job_status ON public.quotes
FOR EACH ROW EXECUTE FUNCTION private.track_removal_completion();

-- Preserve existing view column order. Trash must remain visible even for paid orders.
CREATE OR REPLACE VIEW public.admin_lead_records WITH (security_invoker=true) AS
SELECT q.*, coalesce(m.classification,'unverified') AS lead_classification,
 m.evidence AS lead_evidence,m.changed_at AS lead_verified_at,m.trashed_at AS lead_trashed_at,
 NULL::text AS lead_protection_reason,r.archived_at AS lead_archived_at
FROM public.quotes q LEFT JOIN public.lead_management m ON m.quote_id=q.id LEFT JOIN public.order_retention r ON r.quote_id=q.id;

CREATE OR REPLACE FUNCTION public.manage_leads(p_ids uuid[],p_action text,p_actor uuid,p_classification text DEFAULT NULL,p_evidence text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE v_id uuid; v_before jsonb; v_after jsonb; v_count int;
BEGIN
 IF p_actor IS NULL OR NOT private.is_admin(p_actor) THEN RAISE EXCEPTION 'Unauthorized admin'; END IF;
 IF p_action IS NULL OR p_action NOT IN ('trash','restore','classify') THEN RAISE EXCEPTION 'Invalid action'; END IF;
 IF coalesce(cardinality(p_ids),0)<1 OR cardinality(p_ids)>100 OR array_position(p_ids,NULL) IS NOT NULL THEN RAISE EXCEPTION 'Select 1 to 100 orders'; END IF;
 IF p_action='classify' AND (p_classification IS NULL OR p_classification NOT IN ('unverified','test','real') OR coalesce(length(trim(p_evidence)),0)<8) THEN RAISE EXCEPTION 'Classification requires verification evidence'; END IF;
 PERFORM id FROM public.quotes WHERE id=ANY(p_ids) ORDER BY id FOR UPDATE;
 SELECT count(*) INTO v_count FROM public.quotes WHERE id=ANY(p_ids);
 IF v_count<>(SELECT count(DISTINCT x) FROM unnest(p_ids) x) THEN RAISE EXCEPTION 'One or more orders no longer exist'; END IF;
 FOR v_id IN SELECT DISTINCT x FROM unnest(p_ids) x ORDER BY x LOOP
  SELECT to_jsonb(m) INTO v_before FROM public.lead_management m WHERE quote_id=v_id;
  INSERT INTO public.lead_management(quote_id,changed_by) VALUES(v_id,p_actor) ON CONFLICT DO NOTHING;
  IF p_action='trash' THEN
   IF EXISTS(SELECT 1 FROM public.order_retention WHERE quote_id=v_id AND archived_at IS NOT NULL) THEN RAISE EXCEPTION 'Restore archived records before moving them to Trash'; END IF;
   UPDATE public.lead_management SET trashed_at=coalesce(trashed_at,now()),changed_by=p_actor,changed_at=now() WHERE quote_id=v_id;
   UPDATE public.lead_followup_state SET manual_hold=true,status='hold',updated_at=now() WHERE quote_id=v_id;
  ELSIF p_action='restore' THEN
   UPDATE public.lead_management SET trashed_at=NULL,changed_by=p_actor,changed_at=now() WHERE quote_id=v_id;
   -- Restoring must not immediately put an old completed order back into Trash.
   INSERT INTO public.order_retention(quote_id,automatic_hold) VALUES(v_id,true)
   ON CONFLICT(quote_id) DO UPDATE SET automatic_hold=true,archived_at=NULL,updated_at=now();
  ELSE
   UPDATE public.lead_management SET classification=p_classification,evidence=trim(p_evidence),changed_by=p_actor,changed_at=now() WHERE quote_id=v_id;
  END IF;
  SELECT to_jsonb(m) INTO v_after FROM public.lead_management m WHERE quote_id=v_id;
  INSERT INTO public.lead_management_audit(quote_id,action,actor,before_state,after_state) VALUES(v_id,p_action,p_actor,v_before,v_after);
 END LOOP;
 RETURN jsonb_build_object('ok',true,'count',v_count,'action',p_action);
END $$;


CREATE FUNCTION public.order_retention_metadata(p_ids uuid[]) RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$
SELECT coalesce(jsonb_agg(jsonb_build_object('id',q.id,'removal_completed_at',r.removal_completed_at,'archived_at',r.archived_at,'lead_trashed_at',m.trashed_at,
'automatic_hold',coalesce(r.automatic_hold,false),
 'trash_due_at',CASE WHEN r.archived_at IS NULL AND m.trashed_at IS NULL AND NOT coalesce(r.automatic_hold,false) THEN r.removal_completed_at+interval '720 hours' END,
 'archive_due_at',CASE WHEN r.archived_at IS NULL THEN m.trashed_at+interval '360 hours' END)),'[]')
FROM public.quotes q LEFT JOIN public.order_retention r ON r.quote_id=q.id LEFT JOIN public.lead_management m ON m.quote_id=q.id WHERE q.id=ANY(p_ids)
$$;
CREATE FUNCTION public.list_managed_orders(p_view text DEFAULT 'leads',p_search text DEFAULT '',p_status text DEFAULT '',p_kind text DEFAULT '',p_page integer DEFAULT 0)
RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$
WITH filtered AS (
 SELECT id,name,phone,email,address,status,created_at,services,property_type,preview_status,lead_classification,lead_evidence,lead_trashed_at,lead_protection_reason,lead_archived_at
 FROM public.admin_lead_records WHERE
 ((p_view='archive' AND lead_archived_at IS NOT NULL) OR (p_view='trash' AND lead_trashed_at IS NOT NULL AND lead_archived_at IS NULL) OR (p_view='leads' AND lead_trashed_at IS NULL AND lead_archived_at IS NULL))
 AND(p_status='' OR coalesce(status,'')=p_status) AND(p_kind='' OR lead_classification=p_kind)
 AND(p_search='' OR strpos(lower(concat_ws(' ',name,phone,email,address)),lower(p_search))>0)
),paged AS(SELECT * FROM filtered ORDER BY created_at DESC,id DESC LIMIT 50 OFFSET greatest(p_page,0)*50)
SELECT jsonb_build_object('ok',true,'items',coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY created_at DESC,id DESC) FROM paged p),'[]'),
'count',(SELECT count(*) FROM filtered),
'statuses',(SELECT coalesce(jsonb_agg(s ORDER BY s),'[]') FROM(SELECT DISTINCT status s FROM public.quotes WHERE status IS NOT NULL)t),
'active_count',(SELECT count(*) FROM public.admin_lead_records WHERE lead_trashed_at IS NULL AND lead_archived_at IS NULL),
'trash_count',(SELECT count(*) FROM public.admin_lead_records WHERE lead_trashed_at IS NOT NULL AND lead_archived_at IS NULL),
'archive_count',(SELECT count(*) FROM public.admin_lead_records WHERE lead_archived_at IS NOT NULL))
$$;
CREATE OR REPLACE FUNCTION public.list_managed_leads(p_trash boolean DEFAULT false,p_search text DEFAULT '',p_status text DEFAULT '',p_kind text DEFAULT '',p_page integer DEFAULT 0)
RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT public.list_managed_orders(CASE WHEN p_trash THEN 'trash' ELSE 'leads' END,p_search,p_status,p_kind,p_page)
$$;
CREATE FUNCTION private.run_order_retention() RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE v_id uuid;v_before jsonb;v_trashed int:=0;v_archived int:=0;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM private.retention_config WHERE id AND enabled) THEN RETURN jsonb_build_object('ok',true,'enabled',false); END IF;
 IF NOT pg_try_advisory_xact_lock(73304161) THEN RETURN jsonb_build_object('ok',true,'busy',true); END IF;
 FOR v_id IN SELECT q.id FROM public.quotes q JOIN public.order_retention r ON r.quote_id=q.id LEFT JOIN public.lead_management m ON m.quote_id=q.id
 WHERE q.job_status='Removal Completed' AND NOT r.automatic_hold AND r.archived_at IS NULL AND r.removal_completed_at<=now()-interval '720 hours' AND m.trashed_at IS NULL ORDER BY q.id LIMIT 100 FOR UPDATE OF q LOOP
 SELECT to_jsonb(m) INTO v_before FROM public.lead_management m WHERE quote_id=v_id;
 -- Legacy changed_by requires the project owner; order_retention_audit identifies this as an automatic action.
 INSERT INTO public.lead_management(quote_id,trashed_at,changed_at,changed_by) VALUES(v_id,now(),now(),'d1e2ff19-84fd-4aca-8e7d-0a6d8dc26666') ON CONFLICT(quote_id) DO UPDATE SET trashed_at=now(),changed_at=now();
 UPDATE public.lead_followup_state SET manual_hold=true,status='hold',updated_at=now() WHERE quote_id=v_id;
 INSERT INTO public.order_retention_audit(quote_id,action,before_state,after_state) SELECT v_id,'auto_trash',v_before,to_jsonb(m) FROM public.lead_management m WHERE quote_id=v_id;
 v_trashed:=v_trashed+1;
 END LOOP;
 FOR v_id IN SELECT q.id FROM public.quotes q JOIN public.lead_management m ON m.quote_id=q.id LEFT JOIN public.order_retention r ON r.quote_id=q.id
 WHERE m.trashed_at<=now()-interval '360 hours' AND r.archived_at IS NULL ORDER BY q.id LIMIT 100 FOR UPDATE OF q LOOP
 SELECT to_jsonb(r) INTO v_before FROM public.order_retention r WHERE quote_id=v_id;
 INSERT INTO public.order_retention(quote_id,archived_at) VALUES(v_id,now()) ON CONFLICT(quote_id) DO UPDATE SET archived_at=now(),updated_at=now();
 INSERT INTO public.order_retention_audit(quote_id,action,before_state,after_state) SELECT v_id,'archive',v_before,to_jsonb(r) FROM public.order_retention r WHERE quote_id=v_id;
 v_archived:=v_archived+1;
 END LOOP;
 RETURN jsonb_build_object('ok',true,'enabled',true,'trashed',v_trashed,'archived',v_archived);
END $$;
REVOKE ALL ON FUNCTION private.run_order_retention() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.manage_leads(uuid[],text,uuid,text,text),public.order_retention_metadata(uuid[]),public.list_managed_orders(text,text,text,text,integer),public.list_managed_leads(boolean,text,text,text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.manage_leads(uuid[],text,uuid,text,text),public.order_retention_metadata(uuid[]),public.list_managed_orders(text,text,text,text,integer),public.list_managed_leads(boolean,text,text,text,integer) TO service_role;
GRANT USAGE ON SCHEMA private TO service_role;
REVOKE ALL ON public.admin_lead_records FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.admin_lead_records TO service_role;
