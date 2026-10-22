-- Additive marketing/owner-notification support. Existing operational triggers remain unchanged.
begin;
alter table public.quotes add column if not exists marketing_attribution jsonb;
create or replace function public.sanitize_marketing_attribution(value jsonb) returns jsonb
language plpgsql immutable set search_path='' as $$
declare result jsonb:='{"version":1}'::jsonb; k text; v text;
begin
 if value is null or jsonb_typeof(value)<>'object' then return null; end if;
 foreach k in array array['utm_source','utm_medium','utm_campaign','utm_content'] loop
  v:=value->>k;
  if v ~ '^[A-Za-z][A-Za-z0-9_-]{0,63}$' and v !~ '[0-9]{7}' then result:=result||jsonb_build_object(k,v); end if;
 end loop;
 if value->>'landing_page' in ('/','/visualizer/','/privacy','/terms') then result:=result||jsonb_build_object('landing_page',value->>'landing_page'); end if;
 v:=value->>'referrer';
 if length(v)<=200 and v ~ '^https?://[a-zA-Z0-9.-]+(:[0-9]{1,5})?$' then result:=result||jsonb_build_object('referrer',v); end if;
 v:=value->>'first_touch_at';
 if v ~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z$' and length(v)<=30 then
  begin perform v::timestamptz; result:=result||jsonb_build_object('first_touch_at',v); exception when others then null; end;
 end if;
 if result='{"version":1}'::jsonb then return null;end if;
 return result;
end;$$;
create or replace function private.normalize_quote_attribution() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='UPDATE' and old.marketing_attribution is not null then new.marketing_attribution:=old.marketing_attribution;
 else new.marketing_attribution:=public.sanitize_marketing_attribution(new.marketing_attribution); end if;
 return new;
end;$$;
create trigger normalize_quote_marketing_attribution before insert or update of marketing_attribution on public.quotes for each row execute function private.normalize_quote_attribution();

create table private.owner_notification_config(singleton boolean primary key default true check(singleton),enabled boolean not null default false,created_at timestamptz not null default now());
insert into private.owner_notification_config(singleton,enabled) values(true,false);
alter table private.owner_notification_config enable row level security;
create table private.owner_notifications(
 id uuid primary key default gen_random_uuid(), quote_id uuid not null references public.quotes(id),
 channel text not null check(channel in ('sms','email')),
 state text not null default 'pending' check(state in ('pending','processing','sending','accepted','blocked','failed','unknown')),
 attempts integer not null default 0, provider_id text, error_code text,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),next_attempt_at timestamptz not null default now(),
 unique(quote_id,channel)
);
alter table private.owner_notifications enable row level security;
create index owner_notifications_pending on private.owner_notifications(next_attempt_at) where state in ('pending','blocked','processing');
revoke all on private.owner_notifications,private.owner_notification_config from public,anon,authenticated;
grant usage on schema private to service_role;
grant all on private.owner_notifications,private.owner_notification_config to service_role;

create or replace function private.queue_owner_quote() returns trigger language plpgsql security definer set search_path='' as $$
declare qid uuid;
begin
 if tg_table_name='quotes' then
  if new.visualizer_session_id is not null or new.sms_opt_in is not true then return new;end if;
  qid:=new.id;
 else
  if new.status<>'converted_to_quote' or old.status='converted_to_quote' then return new;end if;
  select id into qid from public.quotes where visualizer_session_id=new.id;
 end if;
 if qid is not null then insert into private.owner_notifications(quote_id,channel) values(qid,'sms'),(qid,'email') on conflict(quote_id,channel) do nothing;end if;
 return new;
end;$$;
revoke all on function private.queue_owner_quote() from public,anon,authenticated;
create trigger owner_quote_created after insert on public.quotes for each row execute function private.queue_owner_quote();
create trigger owner_visualizer_finalized after update of status on public.visualizer_sessions for each row execute function private.queue_owner_quote();

create or replace function public.owner_notification_claim() returns setof private.owner_notifications
language plpgsql security invoker set search_path='' as $$
begin
 if not exists(select 1 from private.owner_notification_config where enabled) then return;end if;
 -- An ambiguous send is not automatically retried: this prevents duplicate texts.
 update private.owner_notifications set state='unknown',error_code='send_interrupted_check_provider',updated_at=now() where state='sending' and updated_at<now()-interval '10 minutes';
 return query with picked as (
 select id from private.owner_notifications where ((state in ('pending','blocked') and next_attempt_at<=now()) or (state='processing' and updated_at<now()-interval '5 minutes')) order by created_at for update skip locked limit 10
 ) update private.owner_notifications n set state='processing',updated_at=now() from picked where n.id=picked.id returning n.*;
end;$$;
create or replace function public.owner_notification_update(p_id uuid,p_state text,p_provider_id text default null,p_error text default null) returns void
language plpgsql security invoker set search_path='' as $$
begin
 if p_state not in ('sending','accepted','blocked','failed','unknown') then raise exception 'Invalid state';end if;
 update private.owner_notifications set state=p_state,provider_id=coalesce(p_provider_id,provider_id),error_code=left(p_error,100),updated_at=now(),next_attempt_at=now()+interval '1 hour',attempts=attempts+case when p_state='sending' then 1 else 0 end where id=p_id and state in ('processing','sending');
 if not found then raise exception 'Notification claim no longer active';end if;
end;$$;
create or replace function public.owner_notification_secret() returns text language sql security definer set search_path='' as $$select decrypted_secret from vault.decrypted_secrets where name='maceda_owner_notification_token' order by created_at desc limit 1$$;
revoke all on function public.owner_notification_claim(),public.owner_notification_update(uuid,text,text,text),public.owner_notification_secret() from public,anon,authenticated;
grant execute on function public.owner_notification_claim(),public.owner_notification_update(uuid,text,text,text),public.owner_notification_secret() to service_role;
-- Secret generated inside Vault, never exported to frontend/repository.
do $$begin if not exists(select 1 from vault.secrets where name='maceda_owner_notification_token') then perform vault.create_secret(encode(extensions.gen_random_bytes(32),'hex'),'maceda_owner_notification_token');end if;end$$;
create or replace function private.dispatch_owner_notifications(p_status_only boolean default false) returns bigint language plpgsql security definer set search_path='' as $$
declare token text; request_id bigint;
begin
 select decrypted_secret into token from vault.decrypted_secrets where name='maceda_owner_notification_token' order by created_at desc limit 1;
 select net.http_post(url:='https://gidqdlcvyasqalitqvcn.supabase.co/functions/v1/owner-lead-notifications',headers:=jsonb_build_object('content-type','application/json','x-maceda-owner-token',token),body:=jsonb_build_object('status_only',p_status_only),timeout_milliseconds:=15000) into request_id;
 return request_id;
end;$$;
revoke all on function private.dispatch_owner_notifications(boolean) from public,anon,authenticated;
-- Enabled only after deployment and verification; no historic quotes are queued.


create or replace function public.finalize_visualizer_quote(
  p_session_id uuid, p_render_id uuid, p_preview_path text, p_contact jsonb
) returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  s public.visualizer_sessions%rowtype;
  r public.visualizer_renders%rowtype;
  q public.quotes%rowtype;
  v integer;
  stamp timestamptz := now();
begin
  select * into strict s from public.visualizer_sessions where id=p_session_id for update;
  select * into strict r from public.visualizer_renders where id=p_render_id and session_id=s.id and stage='ready';
  select * into strict q from public.quotes where visualizer_session_id=s.id for update;
  if s.status='converted_to_quote' then
    if q.preview_image_path=p_preview_path then
      return jsonb_build_object('status','submitted','quote_id',q.id,'preview_attached',true);
    end if;
    raise exception 'Quote already submitted with a different preview';
  end if;
  if s.status <> 'render_ready' then raise exception 'Create a completed preview before submitting'; end if;
  if s.current_render_id is distinct from r.id or (r.design_spec->>'design_revision')::integer is distinct from s.design_revision then
    raise exception 'Design changed; create a new preview';
  end if;
  if (r.design_spec->>'contract_version') is distinct from 'maceda-concept/1' or (r.design_spec->>'renderer') is distinct from 'deterministic-v1' then
    raise exception 'Unsupported preview contract';
  end if;
  if p_preview_path <> q.id::text || '/visualizer-' || r.id::text || '.png' then
    raise exception 'Unexpected preview path';
  end if;
  if not exists(select 1 from storage.objects where bucket_id='quote-previews' and name=p_preview_path) then
    raise exception 'Preview transfer incomplete';
  end if;
  if coalesce((p_contact->>'sms_opt_in')::boolean,false) is not true or
     coalesce(length(trim(p_contact->>'name')),0)=0 or coalesce(length(trim(p_contact->>'phone')),0)=0 or
     coalesce(length(trim(p_contact->>'email')),0)=0 or coalesce(length(trim(p_contact->>'address')),0)=0 then
    raise exception 'Contact details and consent are required';
  end if;
  select coalesce(max(version),0)+1 into v from public.preview_versions where quote_id=q.id;
  insert into public.preview_versions(quote_id,version,source_photo_path,image_path,stage,generated_at,stage_updated_at,design_spec,validation_result,quality_status,metadata)
  values(q.id,v,r.design_spec->>'source_photo_path',p_preview_path,'ready_for_review',stamp,stamp,r.design_spec,r.validation_result,'passed',jsonb_build_object('created_by','customer_visualizer','visualizer_session_id',s.id,'visualizer_render_id',r.id));
  update public.quotes set
    name=left(trim(p_contact->>'name'),160), phone=left(trim(p_contact->>'phone'),80),
    email=left(trim(p_contact->>'email'),220), address=left(trim(p_contact->>'address'),300),
    message=left(coalesce(p_contact->>'message',''),1500),
    marketing_attribution=coalesce(marketing_attribution,public.sanitize_marketing_attribution(p_contact->'marketing_attribution')),
    services=coalesce((select array_agg(distinct case
      when z in ('main_roofline','upper_gable','lower_gable') then 'Roofline'
      when z in ('garage_roofline','garage_peak') then 'Garage'
      when z in ('columns','left_column','right_column') then 'Columns'
      when z in ('trees','tree_1','tree_2','tree_3') then 'Trees'
      when z='windows' then 'Windows' when z='front_door' then 'Front door'
      when z='pathway' then 'Walkways' else 'Custom display' end)
      from jsonb_array_elements_text(coalesce(r.design_spec->'selected_zones','[]'::jsonb)) z),array['Custom display']),
    photo_paths=array[r.design_spec->>'source_photo_path'] || array(select jsonb_array_elements_text(coalesce(r.design_spec->'additional_photo_paths','[]'::jsonb))),
    admin_notes='Customer visualizer quote requested. Concept sizing requires review.',
    sms_opt_in=true,sms_opt_in_at=coalesce(sms_opt_in_at,stamp),
    preview_source_photo_path=r.design_spec->>'source_photo_path',preview_image_path=p_preview_path,
    preview_generated_at=stamp,preview_error=null,preview_version=v,preview_status='needs_review'
  where id=q.id;
  update public.visualizer_sessions set status='converted_to_quote',updated_at=stamp where id=s.id;
  return jsonb_build_object('status','submitted','quote_id',q.id,'preview_attached',true);
end;
$$;
revoke all on function public.finalize_visualizer_quote(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.finalize_visualizer_quote(uuid,uuid,text,jsonb) to service_role;



-- Authoritative completed quotes; drafts and explicitly classified test records are excluded.
create or replace function public.marketing_quote_report(p_since timestamptz,p_until timestamptz) returns jsonb
language sql stable security invoker set search_path='' as $$
with completed as (
 select q.marketing_attribution,coalesce(m.classification,'unverified') classification
 from public.quotes q left join public.lead_management m on m.quote_id=q.id
 left join public.visualizer_sessions s on s.id=q.visualizer_session_id
 where q.created_at>=p_since and q.created_at<p_until and coalesce(m.classification,'unverified')<>'test'
 and ((q.visualizer_session_id is null and q.sms_opt_in=true) or s.status='converted_to_quote')
),sources as (select case when marketing_attribution->>'utm_source' in ('door_hanger','yard_sign','flyer') then marketing_attribution->>'utm_source' when marketing_attribution->>'utm_source' is null then 'unattributed' else 'other' end source,count(*) total from completed group by 1)
select jsonb_build_object('completed_quotes',(select count(*) from completed),'unverified_classification',(select count(*) from completed where classification='unverified'),'sources',coalesce((select jsonb_object_agg(source,total) from sources),'{}'::jsonb),'notifications',coalesce((select jsonb_agg(x) from (select channel,state,count(*) total from private.owner_notifications where created_at>=p_since and created_at<p_until group by channel,state) x),'[]'::jsonb));
$$;
revoke all on function public.marketing_quote_report(timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function public.marketing_quote_report(timestamptz,timestamptz) to service_role;
commit;
