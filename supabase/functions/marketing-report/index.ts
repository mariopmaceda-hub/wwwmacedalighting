
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const ADMIN_USER_ID="d1e2ff19-84fd-4aca-8e7d-0a6d8dc26666";

function secretClient(){
  const raw=Deno.env.get("SUPABASE_SECRET_KEYS");
  if(!raw) throw new Error("Missing Supabase secret keys");
  const keys=JSON.parse(raw);
  const key=keys.default??Object.values(keys)[0];
  return createClient(Deno.env.get("SUPABASE_URL")!,key as string);
}
function publishableClient(authHeader:string){
  const raw=Deno.env.get("SUPABASE_PUBLISHABLE_KEYS");
  if(!raw) throw new Error("Missing publishable keys");
  const keys=JSON.parse(raw);
  const key=keys.default??Object.values(keys)[0];
  return createClient(Deno.env.get("SUPABASE_URL")!,key as string,{global:{headers:{Authorization:authHeader}}});
}
async function adminUser(req:Request){
  const auth=req.headers.get("authorization")??"";
  if(!auth.toLowerCase().startsWith("bearer ")) return null;
  const token=auth.slice(7);
  const c=publishableClient(auth);
  const {data,error}=await c.auth.getUser(token);
  if(error||!data.user||![ADMIN_USER_ID, "a47b5dfb-f38c-4b2c-9867-0e5b8db7087b"].includes(data.user.id)) return null;
  return data.user;
}

const cors={'content-type':'application/json','access-control-allow-origin':'https://wwwmacedalighting.netlify.app','access-control-allow-headers':'authorization,content-type,apikey','cache-control':'no-store'};
Deno.serve(async(req:Request)=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
 if(req.method!=='GET')return new Response(JSON.stringify({error:'method_not_allowed'}),{status:405,headers:cors});
 try{
  if(!await adminUser(req))return new Response(JSON.stringify({error:'unauthorized'}),{status:401,headers:cors});
  const url=new URL(req.url),days=Number(url.searchParams.get('days')||30);
  if(![7,30,90,365].includes(days))return new Response(JSON.stringify({error:'invalid_range'}),{status:400,headers:cors});
  const until=new Date(),since=new Date(until.getTime()-days*86400000);
  const {data,error}=await secretClient().rpc('marketing_quote_report',{p_since:since.toISOString(),p_until:until.toISOString()});
  if(error)throw error;
  return new Response(JSON.stringify({ok:true,since:since.toISOString(),until:until.toISOString(),report:data}),{headers:cors});
 }catch{return new Response(JSON.stringify({error:'report_unavailable'}),{status:503,headers:cors})}
});
