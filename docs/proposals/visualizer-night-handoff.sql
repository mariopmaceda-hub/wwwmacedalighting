-- PROPOSAL ONLY: additive acceptance of reviewed ai-night-v1 previews.
-- Captured live finalizer on 2026-10-09; never replay the older checked-in finalizer.
-- This changes only its contract/review guard. Attribution, contact/consent, locks,
-- storage, revision, idempotence, ownership, configuration and grants are preserved.
-- An unexpected deployed function body aborts without changing anything.
do $night_handoff$
declare
  target regprocedure := 'public.finalize_visualizer_quote(uuid,uuid,text,jsonb)'::regprocedure;
  original_definition text := pg_get_functiondef(target);
  original_acl aclitem[];
  original_owner oid;
  original_config text[];
  original_security_definer boolean;
  old_guard text := $old_guard$  if (r.design_spec->>'contract_version') is distinct from 'maceda-concept/1' or (r.design_spec->>'renderer') is distinct from 'deterministic-v1' then
    raise exception 'Unsupported preview contract';
  end if;$old_guard$;
  new_guard text := $new_guard$  if (r.design_spec->>'contract_version') is distinct from 'maceda-concept/1' or
     coalesce(r.design_spec->>'renderer','') not in ('deterministic-v1','ai-night-v1') then
    raise exception 'Unsupported preview contract';
  end if;
  if r.design_spec->>'renderer' = 'ai-night-v1' and (
    r.validation_result->'passed' is distinct from 'true'::jsonb or
    r.validation_result#>'{review,pass}' is distinct from 'true'::jsonb or
    r.validation_result#>'{review,night}' is distinct from 'true'::jsonb or
    r.validation_result#>'{review,photorealistic}' is distinct from 'true'::jsonb or
    r.validation_result#>'{review,architecture_preserved}' is distinct from 'true'::jsonb or
    r.validation_result#>'{review,selection_followed}' is distinct from 'true'::jsonb or
    r.validation_result#>'{review,failures}' is distinct from '[]'::jsonb
  ) then
    raise exception 'Night preview has not passed review';
  end if;$new_guard$;
begin
  -- Keep guard matching stable when Git checks this SQL out with Windows CRLF.
  old_guard := replace(old_guard,chr(13)||chr(10),chr(10));
  new_guard := replace(new_guard,chr(13)||chr(10),chr(10));
  select proacl,proowner,proconfig,prosecdef
    into original_acl,original_owner,original_config,original_security_definer
    from pg_proc where oid=target;
  if md5(original_definition) <> '49d3758d14cb54863e605b5a44b49bd3' then
    raise exception 'Finalizer changed since review; inspect its latest definition before applying';
  end if;
  if position(old_guard in original_definition)=0 or
     position('marketing_attribution=coalesce(marketing_attribution,public.sanitize_marketing_attribution(p_contact->''marketing_attribution''))' in original_definition)=0 then
    raise exception 'Expected finalizer contract or attribution guard is missing';
  end if;
  if original_security_definer or has_function_privilege('anon',target,'execute') or
     has_function_privilege('authenticated',target,'execute') or
     not has_function_privilege('service_role',target,'execute') then
    raise exception 'Unexpected finalizer permissions; inspect access before applying';
  end if;
  execute replace(original_definition,old_guard,new_guard);
  if exists(select 1 from pg_proc where oid=target and (
    proacl is distinct from original_acl or proowner is distinct from original_owner or
    proconfig is distinct from original_config or prosecdef is distinct from original_security_definer
  )) then
    raise exception 'Finalizer permissions or configuration changed unexpectedly';
  end if;
end;
$night_handoff$;
