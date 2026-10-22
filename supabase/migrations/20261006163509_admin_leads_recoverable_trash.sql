CREATE TABLE public.lead_management (
 quote_id uuid PRIMARY KEY REFERENCES public.quotes(id),
 trashed_at timestamptz,
 classification text NOT NULL DEFAULT 'unverified' CHECK (classification IN ('unverified','test','real')),
 evidence text,
 changed_by uuid NOT NULL,
 changed_at timestamptz NOT NULL DEFAULT now(),
 CHECK (classification = 'unverified' OR length(trim(evidence)) >= 8)
);
CREATE TABLE public.lead_management_audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 quote_id uuid NOT NULL REFERENCES public.quotes(id),
 action text NOT NULL,
 actor uuid NOT NULL,
 at timestamptz NOT NULL DEFAULT now(),
 before_state jsonb,
 after_state jsonb
);
ALTER TABLE public.lead_management ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_management_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.lead_management,public.lead_management_audit FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.lead_management TO service_role;
GRANT SELECT,INSERT ON public.lead_management_audit TO service_role;
GRANT USAGE,SELECT ON SEQUENCE public.lead_management_audit_id_seq TO service_role;

CREATE FUNCTION public.lead_protection_reason(q jsonb) RETURNS text
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT CASE
 WHEN coalesce((q->>'deposit_paid')::numeric,0)>0 OR nullif(q->>'deposit_paid_at','') IS NOT NULL
   OR lower(coalesce(q->>'deposit_status','')) IN ('paid','refunded','partially_refunded','disputed','processing','pending')
 THEN 'Payment history or payment in progress'
 WHEN lower(coalesce(q->>'scheduling_status',''))='booked' OR lower(coalesce(q->>'cal_booking_status',''))='booked'
   OR nullif(q->>'cal_booking_uid','') IS NOT NULL OR nullif(q->>'cal_booking_start_at','') IS NOT NULL
   OR nullif(q->>'installation_start_at','') IS NOT NULL
   OR lower(coalesce(q->>'job_status','')) NOT IN ('','new','unassigned','not_started')
   OR lower(coalesce(q->>'status','')) IN ('booked','scheduled','completed','paid')
 THEN 'Booked installation or job history'
 WHEN nullif(q->>'deposit_checkout_url','') IS NOT NULL OR nullif(q->>'deposit_checkout_session_id','') IS NOT NULL
 THEN 'Issued checkout link: review payment first'
 ELSE NULL END
$$;
REVOKE ALL ON FUNCTION public.lead_protection_reason(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.lead_protection_reason(jsonb) TO service_role;

CREATE VIEW public.admin_lead_records WITH (security_invoker=true) AS
 SELECT q.*, coalesce(m.classification,'unverified') AS lead_classification,
 m.evidence AS lead_evidence, m.changed_at AS lead_verified_at,
 CASE WHEN p.reason IS NULL THEN m.trashed_at ELSE NULL END AS lead_trashed_at,
 p.reason AS lead_protection_reason
 FROM public.quotes q LEFT JOIN public.lead_management m ON m.quote_id=q.id
 CROSS JOIN LATERAL (SELECT coalesce(public.lead_protection_reason(to_jsonb(q)),
 CASE WHEN EXISTS(SELECT 1 FROM public.pe_payment_evidence e WHERE e.quote_id=q.id) THEN 'Verified payment evidence' END) AS reason) p;
REVOKE ALL ON public.admin_lead_records FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.admin_lead_records TO service_role;

CREATE FUNCTION public.manage_leads(p_ids uuid[],p_action text,p_actor uuid,p_classification text DEFAULT NULL,p_evidence text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE v_id uuid; v_before jsonb; v_after jsonb; v_blocked jsonb; v_count int;
BEGIN
 IF p_actor IS DISTINCT FROM 'd1e2ff19-84fd-4aca-8e7d-0a6d8dc26666'::uuid THEN RAISE EXCEPTION 'Unauthorized admin'; END IF;
 IF p_action IS NULL OR p_action NOT IN ('trash','restore','classify') THEN RAISE EXCEPTION 'Invalid action'; END IF;
 IF coalesce(cardinality(p_ids),0)<1 OR cardinality(p_ids)>100 OR array_position(p_ids,NULL) IS NOT NULL THEN RAISE EXCEPTION 'Select 1 to 100 leads'; END IF;
 IF p_action='classify' AND (p_classification IS NULL OR p_classification NOT IN ('unverified','test','real') OR coalesce(length(trim(p_evidence)),0)<8) THEN RAISE EXCEPTION 'Classification requires verification evidence (at least 8 characters)'; END IF;
 -- Lock in deterministic order. Payment/booking updates cannot race the eligibility check.
 PERFORM id FROM public.quotes WHERE id=ANY(p_ids) ORDER BY id FOR UPDATE;
 SELECT count(*) INTO v_count FROM public.quotes WHERE id=ANY(p_ids);
 IF v_count<>(SELECT count(DISTINCT x) FROM unnest(p_ids) x) THEN RAISE EXCEPTION 'One or more leads no longer exist'; END IF;
 IF p_action='trash' THEN
  SELECT jsonb_agg(jsonb_build_object('id',id,'name',name,'reason',lead_protection_reason)) INTO v_blocked
  FROM public.admin_lead_records WHERE id=ANY(p_ids) AND lead_protection_reason IS NOT NULL;
  IF v_blocked IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'error','Protected records cannot be moved to Trash. Nothing was changed.','protected',v_blocked); END IF;
 END IF;
 FOR v_id IN SELECT DISTINCT x FROM unnest(p_ids) x ORDER BY x LOOP
  SELECT to_jsonb(m) INTO v_before FROM public.lead_management m WHERE quote_id=v_id;
  INSERT INTO public.lead_management(quote_id,changed_by) VALUES(v_id,p_actor) ON CONFLICT DO NOTHING;
  IF p_action='trash' THEN
   UPDATE public.lead_management SET trashed_at=coalesce(trashed_at,now()),changed_by=p_actor,changed_at=now() WHERE quote_id=v_id;
  ELSIF p_action='restore' THEN
   UPDATE public.lead_management SET trashed_at=NULL,changed_by=p_actor,changed_at=now() WHERE quote_id=v_id;
  ELSE
   UPDATE public.lead_management SET classification=p_classification,evidence=trim(p_evidence),changed_by=p_actor,changed_at=now() WHERE quote_id=v_id;
  END IF;
  SELECT to_jsonb(m) INTO v_after FROM public.lead_management m WHERE quote_id=v_id;
  INSERT INTO public.lead_management_audit(quote_id,action,actor,before_state,after_state) VALUES(v_id,p_action,p_actor,v_before,v_after);
 END LOOP;
 RETURN jsonb_build_object('ok',true,'count',v_count,'action',p_action);
END $$;
REVOKE ALL ON FUNCTION public.manage_leads(uuid[],text,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.manage_leads(uuid[],text,uuid,text,text) TO service_role;

CREATE FUNCTION public.list_managed_leads(p_trash boolean DEFAULT false,p_search text DEFAULT '',p_status text DEFAULT '',p_kind text DEFAULT '',p_page int DEFAULT 0)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 WITH filtered AS (
 SELECT id,name,phone,email,address,status,created_at,services,property_type,preview_status,lead_classification,lead_evidence,lead_trashed_at,lead_protection_reason
 FROM public.admin_lead_records
 WHERE (lead_trashed_at IS NOT NULL)=p_trash
 AND (p_status='' OR coalesce(status,'')=p_status)
 AND (p_kind='' OR lead_classification=p_kind)
 AND (p_search='' OR strpos(lower(concat_ws(' ',name,phone,email,address)),lower(p_search))>0)
 ), paged AS (SELECT * FROM filtered ORDER BY created_at DESC,id DESC LIMIT 50 OFFSET greatest(p_page,0)*50)
 SELECT jsonb_build_object('ok',true,'items',coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY created_at DESC,id DESC) FROM paged p),'[]'::jsonb),
 'count',(SELECT count(*) FROM filtered),
 'statuses',(SELECT coalesce(jsonb_agg(s ORDER BY s),'[]'::jsonb) FROM (SELECT DISTINCT status s FROM public.quotes WHERE status IS NOT NULL) t),
 'active_count',(SELECT count(*) FROM public.admin_lead_records WHERE lead_trashed_at IS NULL),
 'trash_count',(SELECT count(*) FROM public.admin_lead_records WHERE lead_trashed_at IS NOT NULL))
$$;
REVOKE ALL ON FUNCTION public.list_managed_leads(boolean,text,text,text,int) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.list_managed_leads(boolean,text,text,text,int) TO service_role;