-- Approved by Kevin in this chat on 2026-10-08.
-- Atomic handoff after the preview has been copied successfully to private storage.
-- Existing tables/columns/records are preserved. Only the service role may call this RPC.
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


