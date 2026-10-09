import {createClient} from 'npm:@supabase/supabase-js@2.57.4';
const OWNER_PHONE='+13234807447',OWNER_EMAIL='mariopmaceda@gmail.com';
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});
function client(){const keys=JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}');return createClient(Deno.env.get('SUPABASE_URL')!,keys.default||Object.values(keys)[0] as string);}
const env=(key:string)=>Deno.env.get(key)||'';
export function configuration(){return {sms_ready:env('TWILIO_SEND_ENABLED').toLowerCase()==='true'&&!!env('TWILIO_ACCOUNT_SID')&&!!((env('TWILIO_API_KEY')&&env('TWILIO_API_SECRET'))||env('TWILIO_AUTH_TOKEN'))&&!!(env('TWILIO_MESSAGING_SERVICE_SID')||env('TWILIO_PHONE_NUMBER')),email_resend_present:!!env('RESEND_API_KEY'),email_sendgrid_present:!!env('SENDGRID_API_KEY'),email_from_present:!!(env('OWNER_NOTIFICATION_EMAIL_FROM')||env('EMAIL_FROM')||env('RESEND_FROM_EMAIL')),smtp_present:!!env('SMTP_HOST')};}
export function messageFor(q:any){const source=q.marketing_attribution?.utm_source||'unattributed',campaign=q.marketing_attribution?.utm_campaign||'none';const clean=(v:any,n=250)=>String(v??'').replace(/[\r\n]+/g,' ').slice(0,n);return ['Maceda Lighting — new quote','Name: '+clean(q.name,160),'Phone: '+clean(q.phone,80),'Email: '+clean(q.email,220),'Address: '+clean(q.address,300),'Services: '+clean((q.services||[]).join(', '),250),'Source: '+clean(source,64)+' / '+clean(campaign,64),'Quote: '+q.id,'Admin: https://wwwmacedalighting.netlify.app/inbox/#leads'].join('\n');}
export async function deliver(channel:string,body:string,id:string,request=fetch){
 if(channel==='sms'){
  const sid=env('TWILIO_ACCOUNT_SID'),user=env('TWILIO_API_KEY')&&env('TWILIO_API_SECRET')?env('TWILIO_API_KEY'):sid,password=user===sid?env('TWILIO_AUTH_TOKEN'):env('TWILIO_API_SECRET');
  const params=new URLSearchParams({To:OWNER_PHONE,Body:body});if(env('TWILIO_MESSAGING_SERVICE_SID'))params.set('MessagingServiceSid',env('TWILIO_MESSAGING_SERVICE_SID'));else params.set('From',env('TWILIO_PHONE_NUMBER'));
  const r=await request('https://api.twilio.com/2010-04-01/Accounts/'+sid+'/Messages.json',{method:'POST',headers:{Authorization:'Basic '+btoa(user+':'+password),'content-type':'application/x-www-form-urlencoded'},body:params,signal:AbortSignal.timeout(12000)});const j=await r.json();return {ok:r.ok,id:j.sid||null,code:r.ok?null:'twilio_'+String(j.code||r.status),ambiguous:r.status>=500};
 }
 const from=env('OWNER_NOTIFICATION_EMAIL_FROM')||env('EMAIL_FROM')||env('RESEND_FROM_EMAIL');
 if(env('RESEND_API_KEY')){
  const r=await request('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+env('RESEND_API_KEY'),'content-type':'application/json','Idempotency-Key':'maceda-owner-'+id},body:JSON.stringify({from,to:[OWNER_EMAIL],subject:'Maceda Lighting: new quote request',text:body}),signal:AbortSignal.timeout(12000)});const j=await r.json();return {ok:r.ok,id:j.id||null,code:r.ok?null:'email_http_'+r.status,ambiguous:r.status>=500};
 }
 const r=await request('https://api.sendgrid.com/v3/mail/send',{method:'POST',headers:{Authorization:'Bearer '+env('SENDGRID_API_KEY'),'content-type':'application/json'},body:JSON.stringify({personalizations:[{to:[{email:OWNER_EMAIL}]}],from:{email:from},subject:'Maceda Lighting: new quote request',content:[{type:'text/plain',value:body}]}),signal:AbortSignal.timeout(12000)});return {ok:r.ok,id:r.headers.get('x-message-id'),code:r.ok?null:'email_http_'+r.status,ambiguous:r.status>=500};
}
export async function handler(req:Request){
 if(req.method!=='POST')return json({ok:false,error:'method_not_allowed'},405);
 const supplied=req.headers.get('x-maceda-owner-token')||'';if(supplied.length<32)return json({ok:false,error:'unauthorized'},401);
 const sb=client(),secret=await sb.rpc('owner_notification_secret');
 if(secret.error||typeof secret.data!=='string'||secret.data.length!==supplied.length)return json({ok:false,error:'unauthorized'},401);
 let mismatch=0;for(let i=0;i<supplied.length;i++)mismatch|=supplied.charCodeAt(i)^secret.data.charCodeAt(i);if(mismatch)return json({ok:false,error:'unauthorized'},401);
 const input=await req.json().catch(()=>({})),config=configuration();
 if(input.status_only===true)return json({ok:true,configuration:config});
 if(typeof input.check_delivery==='string'&&/^SM[0-9a-f]{32}$/i.test(input.check_delivery)){
  const sid=env('TWILIO_ACCOUNT_SID'),key=env('TWILIO_API_KEY')&&env('TWILIO_API_SECRET')?env('TWILIO_API_KEY'):sid,password=key===sid?env('TWILIO_AUTH_TOKEN'):env('TWILIO_API_SECRET');
  const r=await fetch('https://api.twilio.com/2010-04-01/Accounts/'+sid+'/Messages/'+input.check_delivery+'.json',{headers:{Authorization:'Basic '+btoa(key+':'+password)},signal:AbortSignal.timeout(12000)});const data=await r.json();
  if(!r.ok||data.to!==OWNER_PHONE)return json({ok:false,error:'delivery_lookup_failed'},502);
  return json({ok:true,status:data.status,error_code:data.error_code||null});
 }

 const claimed=await sb.rpc('owner_notification_claim');if(claimed.error)return json({ok:false,error:'queue_unavailable'},503);
 const results=[];
 for(const job of claimed.data||[]){
  const update=async(state:string,provider:string|null=null,error:string|null=null)=>{const r=await sb.rpc('owner_notification_update',{p_id:job.id,p_state:state,p_provider_id:provider,p_error:error});if(r.error)throw Error('notification_state_update_failed');};
  const ready=job.channel==='sms'?config.sms_ready:config.email_from_present&&(config.email_resend_present||config.email_sendgrid_present);
  if(!ready){await update('blocked',null,job.channel+'_configuration_missing');results.push({channel:job.channel,state:'blocked'});continue;}
  const {data:q,error}=await sb.from('quotes').select('id,name,phone,email,address,services,marketing_attribution').eq('id',job.quote_id).single();
  if(error||!q){await update('failed',null,'quote_unavailable');continue;}
  // Commit sending BEFORE the external request. A lost response is held for reconciliation, never blindly resent.
  await update('sending');
  try{const result=await deliver(job.channel,messageFor(q),job.id);const state=result.ok?'accepted':result.ambiguous?'unknown':'failed';await update(state,result.id,result.code);results.push({channel:job.channel,state});}
  catch{await update('unknown',null,'delivery_result_unknown');results.push({channel:job.channel,state:'unknown'});}
 }
 return json({ok:true,results});
}
if(import.meta.main)Deno.serve(handler);
