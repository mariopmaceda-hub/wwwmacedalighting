create or replace function public.pe_flag_affected() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 insert into public.pe_review_flags(design_id,variant_id,reason)
 select distinct l.design_id,v.id,'product_availability_or_qualification_changed' from public.pe_variants v join public.pe_design_lines l on l.variant_id=v.id
 join public.pe_designs d on d.id=l.design_id
 where d.active and ((tg_table_name='pe_supplier_items' and v.supplier_item_id=new.id) or (tg_table_name='pe_variants' and v.id=new.id))
 and (public.pe_variant_status(v.id) not in ('in_maceda_inventory','available_to_order') or cardinality(public.pe_qualification_errors(v.id))>0 or v.qualification_state<>'approved' or (tg_table_name='pe_supplier_items' and to_jsonb(new)->>'availability'='unavailable'))
 on conflict(design_id,variant_id,reason) do update set state='open';
 update public.pe_procurements p set state='needs_review',updated_at=now() where p.state<>'released' and exists(select 1 from public.pe_review_flags f where f.design_id=p.design_id and f.state='open');
 return new;
end $$;
create or replace function public.pe_build_procurement(p_design uuid,p_actor uuid) returns uuid language plpgsql security invoker set search_path='' as $$
declare d public.pe_designs; q public.quotes; ev public.pe_payment_evidence; pr uuid; r record; own int; taken int; alloc int; need int; st text; s public.pe_supplier_items;
begin
 select * into d from public.pe_designs where id=p_design for update;
 if not found or not d.active or d.accepted_at is null or nullif(d.acceptance_evidence,'') is null then raise exception 'Reviewed and accepted design required'; end if;
 select * into q from public.quotes where id=d.quote_id;
 select * into ev from public.pe_payment_evidence where quote_id=d.quote_id;
 if q.deposit_status is distinct from 'paid' or coalesce(q.deposit_required,0)<=0 or ev.quote_id is null or not ev.livemode or ev.amount_paid<q.deposit_required
 or ev.currency<>'usd' or ev.checkout_session_id is distinct from q.deposit_checkout_session_id or ev.verified_at<now()-interval '15 minutes' then raise exception 'Fresh verified live deposit covering required amount is required'; end if;
 if d.session_id is not null and not exists(select 1 from public.visualizer_sessions where id=d.session_id and design_revision=d.design_revision) then raise exception 'Design changed after review'; end if;
 if not exists(select 1 from public.pe_design_lines where design_id=d.id) then raise exception 'Exact product lines required'; end if;
 select id into pr from public.pe_procurements where design_id=p_design;
 if pr is not null then
   if exists(select 1 from public.pe_reservations where procurement_id=pr and state='installed') then raise exception 'Installed reservations must be reconciled before replanning'; end if;
   perform 1 from public.pe_variants where id in (select variant_id from public.pe_design_lines where design_id=p_design) order by id for update;
   update public.pe_reservations set state='released' where procurement_id=pr and state='reserved';
   delete from public.pe_procurement_lines where procurement_id=pr;
 else
   insert into public.pe_procurements(design_id,created_by) values(p_design,p_actor) returning id into pr;
 end if;
 for r in select variant_id,sum(quantity)::int qty from public.pe_design_lines where design_id=p_design group by variant_id order by variant_id loop
   -- Consistent lock order prevents both deadlocks and double reservation across jobs.
   perform 1 from public.pe_variants where id=r.variant_id for update;
   select quantity_owned into own from public.pe_inventory where variant_id=r.variant_id for update;
   select coalesce(sum(quantity),0)::int into taken from public.pe_reservations where variant_id=r.variant_id and state in ('reserved','installed');
   alloc:=least(greatest(coalesce(own,0)-taken,0),r.qty); need:=r.qty-alloc;
   select si.* into s from public.pe_variants v join public.pe_supplier_items si on si.id=v.supplier_item_id where v.id=r.variant_id;
   st:='needs_review';
   if cardinality(public.pe_qualification_errors(r.variant_id))=0 and exists(select 1 from public.pe_variants where id=r.variant_id and qualification_state='approved') then
     if need=0 then st:='from_inventory';
     elsif s.environment='production' and s.availability='unavailable' then st:='unavailable';
     elsif s.environment='production' and s.availability='available' and s.exact_variant_verified and s.delivery_verified and s.offer_id is not null and s.price is not null and s.currency='USD'
       and s.checked_at>=greatest(q.deposit_paid_at,now()-interval '15 minutes') and s.checked_at<=now() and s.expires_at>now()
       and exists(select 1 from public.pe_providers where id=s.provider_id and environment='production' and approval_state='production_approved') then st:='ready_for_manual_purchase'; end if;
   end if;
   insert into public.pe_procurement_lines(procurement_id,variant_id,required_qty,owned_allocated_qty,purchase_qty,state,supplier_snapshot)
   values(pr,r.variant_id,r.qty,alloc,need,st,case when s.id is null then '{}'::jsonb else jsonb_build_object('supplier_item_id',s.id,'product_id',s.external_product_id,'variant_id',s.external_variant_id,'offer_id',s.offer_id,'unit_cost',s.price,'currency',s.currency,'checked_at',s.checked_at,'purchase_reference',s.purchase_reference) end);
   if alloc>0 then insert into public.pe_reservations(procurement_id,variant_id,quantity) values(pr,r.variant_id,alloc) on conflict(procurement_id,variant_id) do update set quantity=excluded.quantity,state='reserved',returned_at=null; end if;
   if st in ('needs_review','unavailable') then insert into public.pe_review_flags(design_id,variant_id,reason) values(d.id,r.variant_id,'procurement_'||st) on conflict do nothing; end if;
   if need>0 then insert into public.pe_refresh_queue(dedupe_key,quote_id,variant_id,reason) values('procurement:'||pr||':'||r.variant_id,q.id,r.variant_id,'procurement') on conflict do nothing; end if;
 end loop;
 update public.pe_procurements set state=case when exists(select 1 from public.pe_procurement_lines where procurement_id=pr and state in ('needs_review','unavailable')) then 'needs_review' when exists(select 1 from public.pe_procurement_lines where procurement_id=pr and purchase_qty>0) then 'ready_for_manual_purchase' else 'inventory_ready' end where id=pr;
 insert into public.pe_audit_log(actor_id,action,entity_id) values(p_actor,'procurement_created',pr::text);
 return pr;
end $$;
