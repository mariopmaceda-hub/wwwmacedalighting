-- Roll back only the ai-night-v1 acceptance added by visualizer-night-handoff.sql.
-- Leaves saved quotes/previews, attribution, grants and all customer data unchanged.
-- Unsubmitted ai-night-v1 previews will require restoring the reviewed renderer
-- before handoff. Already-submitted quotes retain their existing idempotent reply.
-- This aborts if another change has modified the finalizer after this release.
do $night_handoff_rollback$
declare
  target regprocedure := 'public.finalize_visualizer_quote(uuid,uuid,text,jsonb)'::regprocedure;
  current_definition text := pg_get_functiondef(target);
  original_acl aclitem[];
  original_owner oid;
  original_config text[];
  original_security_definer boolean;
  night_guard text := $night_guard$  if (r.design_spec->>'contract_version') is distinct from 'maceda-concept/1' or
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
  end if;$night_guard$;
  previous_guard text := $previous_guard$  if (r.design_spec->>'contract_version') is distinct from 'maceda-concept/1' or (r.design_spec->>'renderer') is distinct from 'deterministic-v1' then
    raise exception 'Unsupported preview contract';
  end if;$previous_guard$;
begin
  night_guard := replace(night_guard,chr(13)||chr(10),chr(10));
  previous_guard := replace(previous_guard,chr(13)||chr(10),chr(10));
  select proacl,proowner,proconfig,prosecdef
    into original_acl,original_owner,original_config,original_security_definer
    from pg_proc where oid=target;
  if md5(current_definition) <> '7a46a822545cf41f1657b663fab037a1' then
    raise exception 'Finalizer changed since night release; inspect its latest definition before rollback';
  end if;
  if position(night_guard in current_definition)=0 then
    raise exception 'Expected night preview guard is missing';
  end if;
  execute replace(current_definition,night_guard,previous_guard);
  if exists(select 1 from pg_proc where oid=target and (
    proacl is distinct from original_acl or proowner is distinct from original_owner or
    proconfig is distinct from original_config or prosecdef is distinct from original_security_definer
  )) then
    raise exception 'Finalizer permissions or configuration changed unexpectedly';
  end if;
end;
$night_handoff_rollback$;
