import {configuration,deliver,messageFor,handler} from '../supabase/functions/owner-lead-notifications/index.ts';
const assert=(v:unknown,m:string)=>{if(!v)throw Error(m)};
Deno.test('owner routing, providers, ambiguous failure and authentication',async()=>{
 for(const key of ['TWILIO_SEND_ENABLED','TWILIO_ACCOUNT_SID','TWILIO_AUTH_TOKEN','TWILIO_PHONE_NUMBER','RESEND_API_KEY','SENDGRID_API_KEY','OWNER_NOTIFICATION_EMAIL_FROM'])Deno.env.delete(key);
 assert(!configuration().sms_ready,'not ready without config');
 Deno.env.set('TWILIO_SEND_ENABLED','true');Deno.env.set('TWILIO_ACCOUNT_SID','AC_TEST');Deno.env.set('TWILIO_AUTH_TOKEN','TEST');Deno.env.set('TWILIO_PHONE_NUMBER','+15005550006');
 assert(configuration().sms_ready,'sms ready');
 const body=messageFor({id:'TEST',name:'Test Only',phone:'+15005550009',email:'test@example.invalid',address:'TEST',services:['Roofline'],marketing_attribution:{utm_source:'flyer'}});
 let calls=0;
 const mock=(async(url:any,init:any)=>{calls++;assert(String(url).startsWith('https://api.twilio.com/'),'existing provider');const p=new URLSearchParams(init.body);assert(p.get('To')==='+13234807447','owner only');assert(!p.has('MediaUrl'),'no property photos');return Response.json({sid:'SM_TEST'},{status:201})}) as typeof fetch;
 assert((await deliver('sms',body,'TEST',mock)).ok,'accepted');assert(calls===1,'single request');
 assert((await deliver('sms',body,'TEST',(async()=>Response.json({},{status:503})) as typeof fetch)).ambiguous,'ambiguous held');
 Deno.env.set('RESEND_API_KEY','TEST');Deno.env.set('OWNER_NOTIFICATION_EMAIL_FROM','test@example.invalid');
 await deliver('email',body,'TEST',(async(_url:any,init:any)=>{const data=JSON.parse(init.body);assert(data.to[0]==='mariopmaceda@gmail.com','email owner only');assert(init.headers['Idempotency-Key']==='maceda-owner-TEST','idempotency');return Response.json({id:'EMAIL_TEST'})}) as typeof fetch);
 assert((await handler(new Request('https://example.invalid',{method:'POST'}))).status===401,'public access denied');
});
