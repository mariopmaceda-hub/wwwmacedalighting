CREATE OR REPLACE FUNCTION public.sanitize_marketing_attribution(value jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare result jsonb:='{"version":1}'::jsonb; k text; v text;
begin
 if value is null or jsonb_typeof(value)<>'object' then return null; end if;
 foreach k in array array['utm_source','utm_medium','utm_campaign','utm_content'] loop
  v:=value->>k;
  if v ~ '^[A-Za-z][A-Za-z0-9_-]{0,63}$' and v !~ '[0-9]{7}' then result:=result||jsonb_build_object(k,v); end if;
 end loop;
 if value->>'landing_page' in ('/','/visualizer/','/privacy','/terms','/christmas-light-installation-pasadena/') then result:=result||jsonb_build_object('landing_page',value->>'landing_page'); end if;
 v:=value->>'referrer';
 if length(v)<=200 and v ~ '^https?://[a-zA-Z0-9.-]+(:[0-9]{1,5})?$' then result:=result||jsonb_build_object('referrer',v); end if;
 v:=value->>'first_touch_at';
 if v ~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z$' and length(v)<=30 then
  begin perform v::timestamptz; result:=result||jsonb_build_object('first_touch_at',v); exception when others then null; end;
 end if;
 if result='{"version":1}'::jsonb then return null;end if;
 return result;
end;$function$
;