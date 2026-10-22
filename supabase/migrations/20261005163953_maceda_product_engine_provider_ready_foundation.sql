-- Additive Product Engine foundation. Existing sheets, quote/payment logic and concept designs remain authoritative.
create table public.pe_providers (
 id text primary key, display_name text not null, environment text not null default 'disabled' check(environment in ('disabled','sandbox','production')),
 approval_state text not null default 'not_verified' check(approval_state in ('not_verified','sandbox_only','production_approved')),
 approved_roles text[] not null default '{}', approval_evidence text, public_content_approved boolean not null default false,
 checked_at timestamptz, updated_at timestamptz not null default now()
);
insert into public.pe_providers(id,display_name) values('amazon_business','Amazon Business');
create table public.pe_categories (
 id text primary key, name text not null, search_terms text not null, enabled boolean not null default true,
 allowed_zones text[] not null, rules jsonb not null default '{"outdoor_required":true,"dimensions_required":true,"image_required":true,"electrical_review_required":true}',
 max_supplier_price numeric check(max_supplier_price>=0), desired_colors text[] not null default '{}'
);
insert into public.pe_categories(id,name,search_terms,allowed_zones) values
 ('wreath','Wreaths','outdoor pre lit Christmas wreath',array['front_door','windows','upper_gable']),
 ('garland','Garland','outdoor warm white Christmas garland',array['front_door','left_column','right_column','columns']),
 ('nutcracker','Nutcrackers','outdoor lighted Christmas nutcracker',array['front_door','pathway']),
 ('reindeer','Reindeer','outdoor lighted Christmas reindeer',array['pathway']),
 ('tree','Trees','outdoor lighted Christmas tree',array['pathway']),
 ('arches','Arches','outdoor lighted Christmas arch',array['pathway','front_door']),
 ('pathway','Pathway Decorations','outdoor Christmas pathway decorations',array['pathway']),
 ('large_outdoor','Large Outdoor Christmas Decorations','large outdoor Christmas decorations',array['pathway']);
create table public.pe_supplier_items (
 id uuid primary key default gen_random_uuid(), provider_id text not null references public.pe_providers(id),
 environment text not null check(environment in ('sandbox','production')), external_product_id text not null,
 external_variant_id text not null, offer_id text, title text not null, supplier_images jsonb not null default '[]',
 specifications jsonb not null default '{}', variants jsonb not null default '[]', delivery jsonb not null default '{}',
 purchase_reference text, price numeric check(price>=0), currency text,
 availability text not null default 'unknown' check(availability in ('available','unavailable','unknown')),
 exact_variant_verified boolean not null default false, delivery_verified boolean not null default false,
 checked_at timestamptz, expires_at timestamptz, category_id text references public.pe_categories(id),
 source text not null check(source in ('search','cart','detail')), raw_digest text,
 unique(provider_id,environment,external_product_id,external_variant_id)
);
create table public.pe_variants (
 id uuid primary key default gen_random_uuid(), product_id uuid not null references public.maceda_products(id),
 variant_code text not null unique, customer_name text not null, category_id text not null references public.pe_categories(id), color text not null,
 width_m numeric check(width_m>0), height_m numeric check(height_m>0), depth_m numeric check(depth_m>0), dimension_source text,
 allowed_zones text[] not null default '{}', outdoor_rating text, electrical_specifications jsonb not null default '{}', electrical_reviewed boolean not null default false,
 customer_image_url text, image_rights text not null default 'unverified' check(image_rights in ('unverified','maceda_owned','licensed_supplier')),
 image_rights_evidence text, image_rights_expires_at timestamptz, asset_definition jsonb not null default '{}',
 qualification_state text not null default 'needs_review' check(qualification_state in ('needs_review','approved','rejected')),
 customer_visible boolean not null default false, approved_by uuid, approved_at timestamptz,
 supplier_item_id uuid references public.pe_supplier_items(id), reusable boolean not null default true, storage_notes text,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index pe_variants_supplier_idx on public.pe_variants(supplier_item_id);
create table public.pe_inventory (
 variant_id uuid primary key references public.pe_variants(id), quantity_owned int not null default 0 check(quantity_owned>=0),
 verified_at timestamptz not null, verified_by uuid not null, source_reference text not null, storage_location text,
 updated_at timestamptz not null default now()
);
create table public.pe_designs (
 id uuid primary key default gen_random_uuid(), quote_id uuid not null references public.quotes(id), session_id uuid references public.visualizer_sessions(id),
 design_revision int not null check(design_revision>=0), reviewed_by uuid not null, reviewed_at timestamptz not null default now(),
 accepted_at timestamptz, acceptance_evidence text, active boolean not null default true,
 external_job_reference text, external_customer_reference text, unique(quote_id,design_revision)
);
create unique index pe_one_active_design on public.pe_designs(quote_id) where active;
create table public.pe_design_lines (
 id uuid primary key default gen_random_uuid(), design_id uuid not null references public.pe_designs(id), variant_id uuid not null references public.pe_variants(id),
 quantity int not null check(quantity between 1 and 1000), zone_id text not null, product_snapshot jsonb not null,
 placement_geometry jsonb not null default '{}', unique(design_id,variant_id,zone_id)
);
create index pe_lines_variant_idx on public.pe_design_lines(variant_id);
create table public.pe_payment_evidence (
 quote_id uuid primary key references public.quotes(id), checkout_session_id text not null, payment_intent_id text not null,
 amount_paid numeric not null check(amount_paid>0), currency text not null, livemode boolean not null,
 verified_at timestamptz not null, verification_source text not null check(verification_source='stripe_api')
);
create table public.pe_procurements (
 id uuid primary key default gen_random_uuid(), design_id uuid not null unique references public.pe_designs(id),
 state text not null default 'needs_review' check(state in ('needs_review','ready_for_manual_purchase','inventory_ready','released')),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), created_by uuid not null,
 money_spent_automatically boolean not null default false check(money_spent_automatically=false)
);
create table public.pe_procurement_lines (
 id uuid primary key default gen_random_uuid(), procurement_id uuid not null references public.pe_procurements(id),
 variant_id uuid not null references public.pe_variants(id), required_qty int not null check(required_qty>0),
 owned_allocated_qty int not null check(owned_allocated_qty>=0), purchase_qty int not null check(purchase_qty>=0),
 state text not null check(state in ('from_inventory','ready_for_manual_purchase','needs_review','unavailable')),
 supplier_snapshot jsonb not null default '{}', unique(procurement_id,variant_id),
 check(owned_allocated_qty+purchase_qty=required_qty)
);
create table public.pe_reservations (
 id uuid primary key default gen_random_uuid(), procurement_id uuid not null references public.pe_procurements(id),
 variant_id uuid not null references public.pe_inventory(variant_id), quantity int not null check(quantity>0),
 state text not null default 'reserved' check(state in ('reserved','installed','returned','released')),
 created_at timestamptz not null default now(), returned_at timestamptz, unique(procurement_id,variant_id)
);
create index pe_reservations_variant_idx on public.pe_reservations(variant_id,state);
create table public.pe_review_flags (
 id uuid primary key default gen_random_uuid(), design_id uuid not null references public.pe_designs(id), variant_id uuid references public.pe_variants(id),
 reason text not null, state text not null default 'open' check(state in ('open','resolved')), created_at timestamptz not null default now(),
 unique(design_id,variant_id,reason)
);
create table public.pe_alternatives (
 variant_id uuid not null references public.pe_variants(id), alternative_variant_id uuid not null references public.pe_variants(id),
 approved_by uuid not null, approved_at timestamptz not null default now(), notes text not null,
 primary key(variant_id,alternative_variant_id), check(variant_id<>alternative_variant_id)
);
create table public.pe_refresh_queue (
 id uuid primary key default gen_random_uuid(), dedupe_key text not null unique, quote_id uuid references public.quotes(id),
 variant_id uuid references public.pe_variants(id), reason text not null check(reason in ('design_finalized','quote_approval','deposit_payment','procurement','scheduled')),
 state text not null default 'blocked_provider' check(state in ('pending','processing','complete','failed','blocked_provider')),
 attempts int not null default 0, not_before timestamptz not null default now(), last_error text, created_at timestamptz not null default now()
);
create table public.pe_audit_log (
 id uuid primary key default gen_random_uuid(), actor_id uuid, action text not null, entity_id text, details jsonb not null default '{}', created_at timestamptz not null default now()
);

-- Live status is computed; an old supplier check never remains 'available to order' indefinitely.
create function public.pe_variant_status(p_variant uuid) returns text language plpgsql stable security invoker set search_path='' as $$
declare v public.pe_variants; s public.pe_supplier_items; n int;
begin
 select * into v from public.pe_variants where id=p_variant;
 if not found then return 'needs_review'; end if;
 select greatest(i.quantity_owned-coalesce((select sum(r.quantity) from public.pe_reservations r where r.variant_id=p_variant and r.state in ('reserved','installed')),0),0) into n from public.pe_inventory i where i.variant_id=p_variant;
 if coalesce(n,0)>0 then return 'in_maceda_inventory'; end if;
 select * into s from public.pe_supplier_items where id=v.supplier_item_id;
 if s.environment='production' and s.availability='unavailable' then return 'unavailable'; end if;
 if s.environment='production' and s.availability='available' and s.exact_variant_verified and s.delivery_verified and s.offer_id is not null
 and s.checked_at<=now() and s.expires_at>now() and s.checked_at>now()-interval '24 hours'
 and exists(select 1 from public.pe_providers where id=s.provider_id and environment='production' and approval_state='production_approved') then return 'available_to_order'; end if;
 return 'needs_review';
end $$;
create function public.pe_qualification_errors(p_variant uuid) returns text[] language plpgsql stable security invoker set search_path='' as $$
declare v public.pe_variants; c public.pe_categories; e text[]:='{}';
begin
 select * into v from public.pe_variants where id=p_variant; if not found then return array['variant_missing']; end if;
 select * into c from public.pe_categories where id=v.category_id;
 if not c.enabled then e:=array_append(e,'category_disabled'); end if;
 if v.width_m is null or v.height_m is null or nullif(v.dimension_source,'') is null then e:=array_append(e,'verified_dimensions_required'); end if;
 if cardinality(v.allowed_zones)=0 or not(v.allowed_zones<@c.allowed_zones) then e:=array_append(e,'installation_zones_required'); end if;
 if nullif(v.outdoor_rating,'') is null then e:=array_append(e,'outdoor_rating_required'); end if;
 if not v.electrical_reviewed then e:=array_append(e,'electrical_review_required'); end if;
 if nullif(v.customer_image_url,'') is null or v.customer_image_url !~ '^https://' or v.image_rights='unverified' or nullif(v.image_rights_evidence,'') is null or v.image_rights_expires_at<=now() then e:=array_append(e,'customer_image_rights_required'); end if;
 if v.image_rights='licensed_supplier' and not exists(select 1 from public.pe_supplier_items s join public.pe_providers p on p.id=s.provider_id where s.id=v.supplier_item_id and p.public_content_approved) then e:=array_append(e,'supplier_public_content_not_approved'); end if;
 if cardinality(c.desired_colors)>0 and not(v.color=any(c.desired_colors)) then e:=array_append(e,'color_not_approved'); end if;
 if c.max_supplier_price is not null and exists(select 1 from public.pe_supplier_items where id=v.supplier_item_id and (price is null or currency<>'USD' or price>c.max_supplier_price)) then e:=array_append(e,'supplier_price_limit'); end if;
 if exists(select 1 from public.pe_supplier_items where id=v.supplier_item_id and environment<>'production') then e:=array_append(e,'sandbox_product'); end if;
 return e;
end $$;
create function public.pe_customer_catalog() returns jsonb language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('variant_id',v.id,'maceda_product_id',p.maceda_product_id,'customer_name',v.customer_name,
 'customer_image_url',v.customer_image_url,'category',v.category_id,'dimensions',jsonb_build_object('unit','m','width',v.width_m,'height',v.height_m,'depth',v.depth_m),
 'color_variants',jsonb_build_array(v.color),'allowed_zones',v.allowed_zones,'availability_status',public.pe_variant_status(v.id),'selectable',true) order by v.customer_name),'[]')
 from public.pe_variants v join public.maceda_products p on p.id=v.product_id
 where v.customer_visible and v.qualification_state='approved' and v.approved_at is not null and v.approved_by is not null
 and cardinality(public.pe_qualification_errors(v.id))=0 and public.pe_variant_status(v.id) in ('in_maceda_inventory','available_to_order');
$$;
create function public.pe_capture_line() returns trigger language plpgsql security invoker set search_path='' as $$
declare v public.pe_variants;
begin
 select * into v from public.pe_variants where id=new.variant_id;
 if v.qualification_state<>'approved' or cardinality(public.pe_qualification_errors(v.id))>0 or public.pe_variant_status(v.id) not in ('in_maceda_inventory','available_to_order') then raise exception 'Product is not qualified and available'; end if;
 if not(new.zone_id=any(v.allowed_zones)) then raise exception 'Product installation zone is not approved'; end if;
 new.product_snapshot:=jsonb_build_object('variant_code',v.variant_code,'customer_name',v.customer_name,'color',v.color,'width_m',v.width_m,'height_m',v.height_m,'depth_m',v.depth_m,'customer_image_url',v.customer_image_url);
 return new;
end $$;
create trigger pe_capture_line before insert on public.pe_design_lines for each row execute function public.pe_capture_line();
create function public.pe_flag_affected() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 insert into public.pe_review_flags(design_id,variant_id,reason)
 select distinct l.design_id,v.id,'product_availability_or_qualification_changed' from public.pe_variants v join public.pe_design_lines l on l.variant_id=v.id
 join public.pe_designs d on d.id=l.design_id
 where d.active and ((tg_table_name='pe_supplier_items' and v.supplier_item_id=new.id) or (tg_table_name='pe_variants' and v.id=new.id))
 and (public.pe_variant_status(v.id) not in ('in_maceda_inventory','available_to_order') or cardinality(public.pe_qualification_errors(v.id))>0 or v.qualification_state<>'approved')
 on conflict(design_id,variant_id,reason) do update set state='open';
 update public.pe_procurements p set state='needs_review',updated_at=now() where p.state<>'released' and exists(select 1 from public.pe_review_flags f where f.design_id=p.design_id and f.state='open');
 return new;
end $$;
create trigger pe_supplier_changed after update on public.pe_supplier_items for each row execute function public.pe_flag_affected();
create trigger pe_variant_changed after update on public.pe_variants for each row execute function public.pe_flag_affected();

-- Outbox only: no network call inside the existing quote transaction.
create function public.pe_queue_quote_milestone() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if new.deposit_status='paid' and old.deposit_status is distinct from new.deposit_status then
 insert into public.pe_refresh_queue(dedupe_key,quote_id,reason) values('deposit:'||new.id||':'||coalesce(new.deposit_checkout_session_id,''),new.id,'deposit_payment') on conflict do nothing;
 end if;
 return new;
end $$;
create trigger pe_deposit_outbox after update of deposit_status on public.quotes for each row execute function public.pe_queue_quote_milestone();

create function public.pe_build_procurement(p_design uuid,p_actor uuid) returns uuid language plpgsql security invoker set search_path='' as $$
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
 if pr is not null then return pr; end if;
 insert into public.pe_procurements(design_id,created_by) values(p_design,p_actor) returning id into pr;
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
   if alloc>0 then insert into public.pe_reservations(procurement_id,variant_id,quantity) values(pr,r.variant_id,alloc); end if;
   if st in ('needs_review','unavailable') then insert into public.pe_review_flags(design_id,variant_id,reason) values(d.id,r.variant_id,'procurement_'||st) on conflict do nothing; end if;
   if need>0 then insert into public.pe_refresh_queue(dedupe_key,quote_id,variant_id,reason) values('procurement:'||pr||':'||r.variant_id,q.id,r.variant_id,'procurement') on conflict do nothing; end if;
 end loop;
 update public.pe_procurements set state=case when exists(select 1 from public.pe_procurement_lines where procurement_id=pr and state in ('needs_review','unavailable')) then 'needs_review' when exists(select 1 from public.pe_procurement_lines where procurement_id=pr and purchase_qty>0) then 'ready_for_manual_purchase' else 'inventory_ready' end where id=pr;
 insert into public.pe_audit_log(actor_id,action,entity_id) values(p_actor,'procurement_created',pr::text);
 return pr;
end $$;
create function public.pe_set_inventory(p_variant uuid,p_quantity int,p_actor uuid,p_source text,p_location text) returns void language plpgsql security invoker set search_path='' as $$
declare taken int;
begin
 perform 1 from public.pe_variants where id=p_variant for update; if not found then raise exception 'Variant missing'; end if;
 select coalesce(sum(quantity),0)::int into taken from public.pe_reservations where variant_id=p_variant and state in ('reserved','installed');
 if p_quantity<taken or p_quantity<0 or nullif(p_source,'') is null then raise exception 'Verified quantity cannot be below active reservations; source required'; end if;
 insert into public.pe_inventory(variant_id,quantity_owned,verified_at,verified_by,source_reference,storage_location) values(p_variant,p_quantity,now(),p_actor,p_source,p_location)
 on conflict(variant_id) do update set quantity_owned=excluded.quantity_owned,verified_at=now(),verified_by=p_actor,source_reference=p_source,storage_location=p_location,updated_at=now();
 insert into public.pe_audit_log(actor_id,action,entity_id,details) values(p_actor,'inventory_verified',p_variant::text,jsonb_build_object('quantity',p_quantity,'source',p_source));
end $$;

-- All supplier and operational data is server-only. Customer data leaves via an explicit whitelist RPC.
do $$ declare t text; f record; begin
 for t in select tablename from pg_tables where schemaname='public' and tablename like 'pe\_%' escape '\' loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public, anon, authenticated',t);
 execute format('grant all on public.%I to service_role',t);
 end loop;
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'pe\_%' escape '\' loop
 execute format('revoke all on function %s from public,anon,authenticated',f.signature);
 execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;

create function public.pe_save_reviewed_design(p_quote uuid,p_lines jsonb,p_actor uuid,p_job text default null,p_customer text default null) returns uuid language plpgsql security invoker set search_path='' as $$
declare q public.quotes; s public.visualizer_sessions; d uuid; rev int; l jsonb;
begin
 select * into q from public.quotes where id=p_quote for update; if not found then raise exception 'Quote missing'; end if;
 if jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines) not between 1 and 100 then raise exception '1 to 100 exact product lines required'; end if;
 select * into s from public.visualizer_sessions where id=q.visualizer_session_id;
 rev:=coalesce(s.design_revision,(select coalesce(max(design_revision),-1)+1 from public.pe_designs where quote_id=p_quote));
 if exists(select 1 from public.pe_designs where quote_id=p_quote and design_revision=rev) then raise exception 'This revision already has an immutable review; revise the design before reviewing again'; end if;
 update public.pe_designs set active=false where quote_id=p_quote and active;
 insert into public.pe_designs(quote_id,session_id,design_revision,reviewed_by,external_job_reference,external_customer_reference) values(p_quote,q.visualizer_session_id,rev,p_actor,p_job,p_customer) returning id into d;
 for l in select value from jsonb_array_elements(p_lines) loop
 insert into public.pe_design_lines(design_id,variant_id,quantity,zone_id,product_snapshot,placement_geometry) values(d,(l->>'variant_id')::uuid,(l->>'quantity')::int,l->>'zone_id','{}',coalesce(l->'placement_geometry','{}'));
 end loop;
 insert into public.pe_refresh_queue(dedupe_key,quote_id,reason) values('design:'||d,q.id,'design_finalized') on conflict do nothing;
 insert into public.pe_audit_log(actor_id,action,entity_id) values(p_actor,'design_reviewed',d::text);
 return d;
end $$;
create function public.pe_accept_design(p_design uuid,p_evidence text,p_actor uuid) returns void language plpgsql security invoker set search_path='' as $$
declare d public.pe_designs;
begin
 select * into d from public.pe_designs where id=p_design for update;
 if not found or not d.active or length(trim(p_evidence))<5 then raise exception 'Active design and acceptance evidence required'; end if;
 if d.session_id is not null and not exists(select 1 from public.visualizer_sessions where id=d.session_id and design_revision=d.design_revision) then raise exception 'Design changed after review'; end if;
 update public.pe_designs set accepted_at=now(),acceptance_evidence=p_evidence where id=p_design;
 insert into public.pe_refresh_queue(dedupe_key,quote_id,reason) values('accept:'||p_design,d.quote_id,'quote_approval') on conflict do nothing;
 insert into public.pe_audit_log(actor_id,action,entity_id) values(p_actor,'acceptance_recorded',p_design::text);
end $$;
create function public.pe_return_reservation(p_reservation uuid,p_actor uuid,p_returned boolean) returns void language plpgsql security invoker set search_path='' as $$
declare r public.pe_reservations;
begin
 select * into r from public.pe_reservations where id=p_reservation;
 if not found then raise exception 'Reservation missing'; end if;
 perform 1 from public.pe_variants where id=r.variant_id for update;
 if r.state='installed' and not p_returned then raise exception 'Installed inventory must be returned after removal'; end if;
 update public.pe_reservations set state=case when p_returned then 'returned' else 'released' end,returned_at=case when p_returned then now() else null end where id=p_reservation and state in ('reserved','installed');
 -- Releasing a reservation invalidates the old purchase list; no silent reallocation.
 update public.pe_procurements set state='released',updated_at=now() where id=r.procurement_id;
 insert into public.pe_audit_log(actor_id,action,entity_id) values(p_actor,case when p_returned then 'inventory_returned' else 'reservation_released' end,p_reservation::text);
end $$;
create function public.pe_claim_provider_read(p_key text) returns boolean language plpgsql security invoker set search_path='' as $$
declare latest timestamptz;
begin
 perform pg_advisory_xact_lock(hashtext('pe_provider_read'));
 select max(created_at) into latest from public.pe_audit_log where action='provider_read';
 if latest>now()-interval '3 seconds' then return false; end if;
 if exists(select 1 from public.pe_audit_log where action='provider_read' and entity_id=p_key and created_at>now()-interval '60 seconds') then return false; end if;
 insert into public.pe_audit_log(action,entity_id) values('provider_read',p_key);return true;
end $$;
create function public.pe_scan_refresh() returns int language plpgsql security invoker set search_path='' as $$
declare n int;
begin
 insert into public.pe_refresh_queue(dedupe_key,variant_id,reason)
 select 'scheduled:'||v.id||':'||to_char(now(),'YYYY-MM-DD-HH24'),v.id,'scheduled' from public.pe_variants v join public.pe_supplier_items s on s.id=v.supplier_item_id
 where (v.customer_visible or exists(select 1 from public.pe_design_lines l join public.pe_designs d on d.id=l.design_id where l.variant_id=v.id and d.active)) and (s.expires_at<now()+interval '1 hour' or s.expires_at is null)
 on conflict do nothing;
 get diagnostics n=row_count;
 insert into public.pe_review_flags(design_id,variant_id,reason)
 select distinct l.design_id,v.id,'availability_requires_recheck' from public.pe_design_lines l join public.pe_designs d on d.id=l.design_id join public.pe_variants v on v.id=l.variant_id
 where d.active and public.pe_variant_status(v.id) in ('needs_review','unavailable') and not exists(select 1 from public.pe_reservations r join public.pe_procurements p on p.id=r.procurement_id where p.design_id=d.id and r.variant_id=v.id and r.state in ('reserved','installed') and r.quantity>=l.quantity)
 on conflict(design_id,variant_id,reason) do update set state='open';
 update public.pe_procurements p set state='needs_review' where p.state<>'released' and exists(select 1 from public.pe_review_flags f where f.design_id=p.design_id and f.state='open');
 return n;
end $$;
do $$ declare f record; begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'pe\_%' escape '\' loop
 execute format('revoke all on function %s from public,anon,authenticated',f.signature);
 execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;

