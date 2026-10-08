
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
const cors={
  "content-type":"application/json",
  "access-control-allow-origin":"*",
  "access-control-allow-headers":"authorization, content-type, apikey"
};
function money(v:any){const n=Number(v??0);return Number.isFinite(n)?n:0}
function normPhone(v:any){return String(v??"").replace(/\D/g,"").replace(/^1(?=\d{10}$)/,"")}
function isTest(q:any){return q.lead_classification === "test";}
async function signed(sb:any,bucket:string,path:any,expires=3600){
  if(!path)return null;
  const {data,error}=await sb.storage.from(bucket).createSignedUrl(String(path),expires);
  return error?null:(data?.signedUrl??null);
}

async function withRetention(sb:any,items:any[]){
  if(!items.length)return items;
  const {data,error}=await sb.rpc("order_retention_metadata",{p_ids:items.map(q=>q.id)});
  if(error)throw error;
  const meta=new Map((data||[]).map((r:any)=>[r.id,r]));
  return items.map(q=>({...q,...(meta.get(q.id) as any||{})}));
}
async function handle(req:Request){
  if(req.method==="OPTIONS")return new Response(null,{status:204,headers:cors});
  const user=await adminUser(req);
  if(!user)return new Response(JSON.stringify({ok:false,error:"unauthorized"}),{status:401,headers:cors});
  const sb=secretClient();
  const url=new URL(req.url);

  if(req.method==="GET"){
    const requestedView=url.searchParams.get("view");
    if(["leads","trash","archive"].includes(requestedView||"")){
      const page=Number(url.searchParams.get("page")||0);
      if(!Number.isInteger(page)||page<0||page>100000) return new Response(JSON.stringify({ok:false,error:"Invalid page"}),{status:400,headers:cors});
      const {data,error}=await sb.rpc("list_managed_orders",{p_view:requestedView,p_search:(url.searchParams.get("q")||"").slice(0,200),p_status:(url.searchParams.get("status")||"").slice(0,100),p_kind:url.searchParams.get("kind")||"",p_page:page});
      if(error)return new Response(JSON.stringify({ok:false,error:"Could not load leads"}),{status:500,headers:cors});
      return new Response(JSON.stringify({...data,items:await withRetention(sb,data.items||[])}),{headers:cors});
    }
    const view=url.searchParams.get("view")||"dashboard";
    const limit=Math.min(Math.max(Number(url.searchParams.get("limit")||100),1),300);

    if(view==="dashboard"){
      const quotes:any[]=[];
      for(let offset=0;;offset+=1000){
        const {data,error}=await sb.from("admin_lead_records").select("id,name,phone,address,status,created_at,quote_amount,deposit_required,deposit_paid,deposit_status,preview_status,preview_delivery_status,scheduling_status,cal_booking_status,cal_booking_start_at,job_status,lead_classification,lead_trashed_at,lead_archived_at").order("created_at",{ascending:false}).order("id",{ascending:false}).range(offset,offset+999);
        if(error)throw error;
        quotes.push(...(data??[]));if(!data||data.length<1000)break;
      }
      const {count:unread}=await sb.from("sms_messages").select("id",{count:"exact",head:true}).eq("direction","inbound").eq("is_read",false);
      const now=Date.now(), week=now+7*86400000;
      const financial=(quotes??[]).filter((q:any)=>!isTest(q));
      const live=financial.filter((q:any)=>!q.lead_trashed_at&&!q.lead_archived_at);
      const metrics={
        new_leads:live.filter((q:any)=>String(q.status||"")==="New Lead").length,
        previews_waiting:live.filter((q:any)=>q.preview_status==="needs_review").length,
        quotes_waiting:live.filter((q:any)=>money(q.quote_amount)>0 && !["paid","refunded"].includes(String(q.deposit_status||""))).length,
        deposits_collected:financial.reduce((s:number,q:any)=>s+money(q.deposit_paid),0),
        jobs_booked:live.filter((q:any)=>q.scheduling_status==="booked"||q.cal_booking_status==="booked").length,
        installs_next_7_days:live.filter((q:any)=>{const t=q.cal_booking_start_at?new Date(q.cal_booking_start_at).getTime():0;return t>=now&&t<=week}).length,
        unread_messages:unread??0,
        revenue_collected:financial.reduce((s:number,q:any)=>s+money(q.deposit_paid),0),
        outstanding:financial.reduce((s:number,q:any)=>s+Math.max(0,money(q.quote_amount)-money(q.deposit_paid)),0)
      };
      const actions:any[]=[];
      if(metrics.previews_waiting)actions.push({type:"reviews",label:metrics.previews_waiting+" AI preview"+(metrics.previews_waiting===1?"":"s")+" need review",priority:"high"});
      if(metrics.unread_messages)actions.push({type:"messages",label:metrics.unread_messages+" unread customer message"+(metrics.unread_messages===1?"":"s"),priority:"high"});
      if(metrics.quotes_waiting)actions.push({type:"payments",label:metrics.quotes_waiting+" quote"+(metrics.quotes_waiting===1?"":"s")+" awaiting deposit/payment",priority:"medium"});
      if(metrics.installs_next_7_days)actions.push({type:"schedule",label:metrics.installs_next_7_days+" install"+(metrics.installs_next_7_days===1?"":"s")+" in the next 7 days",priority:"medium"});
      const upcoming=live.filter((q:any)=>q.cal_booking_start_at&&new Date(q.cal_booking_start_at).getTime()>=now)
        .sort((a:any,b:any)=>new Date(a.cal_booking_start_at).getTime()-new Date(b.cal_booking_start_at).getTime()).slice(0,8);
      return new Response(JSON.stringify({ok:true,metrics,actions,upcoming}),{headers:cors});
    }

    const base="id,name,phone,email,address,property_type,services,status,created_at,sms_opt_in,photo_paths,preview_status,preview_image_path,preview_generated_at,preview_version,preview_delivery_status,selected_package,quote_amount,deposit_percent,deposit_required,deposit_paid,deposit_status,deposit_paid_at,deposit_checkout_url,scheduling_status,booking_link,cal_booking_uid,cal_booking_status,cal_booking_start_at,cal_booking_end_at,installation_start_at,crew,job_status,admin_notes,visualizer_session_id";
    let query=sb.from("admin_lead_records").select(base).order("created_at",{ascending:false}).order("id",{ascending:false});
    if(view!=="payments")query=query.is("lead_trashed_at",null).is("lead_archived_at",null);
    if(view!=="customers")query=query.limit(limit);

    if(view==="jobs"||view==="schedule"){
      query=query.or("scheduling_status.eq.booked,cal_booking_status.eq.booked").order("cal_booking_start_at",{ascending:true,nullsFirst:false});
    }else if(view==="payments"){
      query=query.not("quote_amount","is",null);
    }else if(view==="quotes"){
      query=query.not("quote_amount","is",null);
    }else if(view==="search"){
      const term=String(url.searchParams.get("q")||"").trim().replace(/[,%()]/g," ");
      if(!term)return new Response(JSON.stringify({ok:true,items:[]}),{headers:cors});
      query=query.or("name.ilike.%"+term+"%,phone.ilike.%"+term+"%,email.ilike.%"+term+"%,address.ilike.%"+term+"%");
    }

    let items:any[]=[];
    if(view==="customers"){
      for(let offset=0;;offset+=1000){
        const {data,error}=await query.range(offset,offset+999);
        if(error)throw error;items.push(...(data||[]));if(!data||data.length<1000)break;
      }
    }else{
      const {data,error}=await query;if(error)throw error;items=data||[];
    }
    items=await withRetention(sb,items);

    if(view==="customers"){
      const map=new Map<string,any>();
      for(const q of items){
        const key=normPhone(q.phone)||String(q.email||q.id).toLowerCase();
        const existing=map.get(key);
        if(!existing){
          map.set(key,{key,name:q.name,phone:q.phone,email:q.email,address:q.address,latest_quote:q,quote_ids:[q.id],quote_count:1,total_quoted:money(q.quote_amount),total_paid:money(q.deposit_paid)});
        }else{
          existing.quote_count++;existing.quote_ids.push(q.id);
          existing.total_quoted+=money(q.quote_amount);
          existing.total_paid+=money(q.deposit_paid);
          if(new Date(q.created_at)>new Date(existing.latest_quote.created_at))existing.latest_quote=q;
        }
      }
      items=Array.from(map.values()).sort((a:any,b:any)=>new Date(b.latest_quote.created_at).getTime()-new Date(a.latest_quote.created_at).getTime());
    }

    if(view==="leads"){
      const out=[];
      for(const q of items){
        const first=Array.isArray(q.photo_paths)&&q.photo_paths.length?q.photo_paths[0]:null;
        out.push({...q,first_photo_url:first?await signed(sb,"quote-photos",first):null});
      }
      items=out;
    }

    if(view==="reviews"){
      const out=[];
      for(const q of items.filter((x:any)=>x.preview_status==="needs_review")){
        out.push({...q,preview_url:await signed(sb,"quote-previews",q.preview_image_path)});
      }
      items=out;
    }

    if(view==="schedule"){
      items=items.filter((q:any)=>q.cal_booking_start_at||q.installation_start_at)
        .sort((a:any,b:any)=>new Date(a.cal_booking_start_at||a.installation_start_at).getTime()-new Date(b.cal_booking_start_at||b.installation_start_at).getTime());
    }

    if(view==="detail"){
      const id=String(url.searchParams.get("id")||"");
      const {data:q,error:qErr}=await sb.from("quotes").select(base).eq("id",id).maybeSingle();
      if(qErr)throw qErr;
      if(!q)return new Response(JSON.stringify({ok:false,error:"not_found"}),{status:404,headers:cors});
      const photo_urls=[];
      for(const p of q.photo_paths??[]){photo_urls.push(await signed(sb,"quote-photos",p));}
      const preview_url=await signed(sb,"quote-previews",q.preview_image_path);
      const viz=q.visualizer_session_id?await sb.from("visualizer_sessions").select("id,status,mode,preset,color_style,selected_zones,selected_decorations,selections,install_zones,scale_calibration,design_revision").eq("id",q.visualizer_session_id).maybeSingle():{data:null};
      const phone=normPhone(q.phone);
      const {data:messages}=await sb.from("sms_messages").select("id,created_at,direction,body,status,error_code,error_message,media_urls,is_read").eq("customer_phone","+1"+phone).order("created_at",{ascending:true}).limit(300);
      return new Response(JSON.stringify({ok:true,item:{...(await withRetention(sb,[q]))[0],photo_urls,preview_url,visualizer:viz.data,messages:messages??[]}}),{headers:cors});
    }

    return new Response(JSON.stringify({ok:true,items}),{headers:cors});
  }

  if(req.method==="POST"){
    const body=await req.json().catch(()=>({}));
    const action=String(body?.action||"");
    if(["trash_leads","restore_leads","classify_leads"].includes(action)){
      const ids=body.ids;
      if(!Array.isArray(ids)||ids.length<1||ids.length>100||ids.some((id:any)=>typeof id!=="string"||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)))return new Response(JSON.stringify({ok:false,error:"Select 1 to 100 valid leads"}),{status:400,headers:cors});
      const {data,error}=await sb.rpc("manage_leads",{p_ids:[...new Set(ids)],p_action:action.replace("_leads",""),p_actor:user.id,p_classification:body.classification??null,p_evidence:typeof body.evidence==="string"?body.evidence.slice(0,2000):null});
      if(error)return new Response(JSON.stringify({ok:false,error:error.message}),{status:400,headers:cors});
      return new Response(JSON.stringify(data),{status:data.ok?200:409,headers:cors});
    }
    const id=String(body?.id||"");
    if(!id)return new Response(JSON.stringify({ok:false,error:"id_required"}),{status:400,headers:cors});

    if(action==="update_quote"){
      const patch:any={};
      const allowed=["status","selected_package","crew","job_status","admin_notes"];
      for(const k of allowed){if(Object.prototype.hasOwnProperty.call(body,k))patch[k]=body[k]??null;}
      if(Object.prototype.hasOwnProperty.call(body,"quote_amount")){
        const v=Number(body.quote_amount);
        if(!Number.isFinite(v)||v<0)return new Response(JSON.stringify({ok:false,error:"invalid_quote_amount"}),{status:400,headers:cors});
        patch.quote_amount=v;
      }
      if(Object.prototype.hasOwnProperty.call(body,"deposit_percent")){
        const v=Number(body.deposit_percent);
        if(!Number.isFinite(v)||v<=0||v>1)return new Response(JSON.stringify({ok:false,error:"deposit_percent_must_be_0_to_1"}),{status:400,headers:cors});
        patch.deposit_percent=v;
      }
      if(patch.status==="Deposit Pending"){
        let amount=Object.prototype.hasOwnProperty.call(patch,"quote_amount")?Number(patch.quote_amount):NaN;
        if(!Number.isFinite(amount)){
          const {data:current,error:currentErr}=await sb.from("quotes").select("quote_amount").eq("id",id).maybeSingle();
          if(currentErr)throw currentErr;
          amount=Number(current?.quote_amount??0);
        }
        if(!(amount>0))return new Response(JSON.stringify({ok:false,error:"quote_amount_required_before_deposit"}),{status:400,headers:cors});
        patch.deposit_status="awaiting_deposit";
      }
      if(!Object.keys(patch).length)return new Response(JSON.stringify({ok:false,error:"no_changes"}),{status:400,headers:cors});
      const {data,error}=await sb.from("quotes").update(patch).eq("id",id).select("id,status,quote_amount,deposit_percent,deposit_required,deposit_status,deposit_checkout_url,payment_short_code,deposit_link_delivery_status,crew,job_status,admin_notes").single();
      if(error)throw error;
      return new Response(JSON.stringify({ok:true,item:data,deposit_requested:patch.deposit_status==="awaiting_deposit"}),{headers:cors});
    }

    return new Response(JSON.stringify({ok:false,error:"unknown_action"}),{status:400,headers:cors});
  }

  return new Response(JSON.stringify({ok:false,error:"method_not_allowed"}),{status:405,headers:cors});
}
Deno.serve(async(req:Request)=>{
 try{return await handle(req)}catch(error){console.error("Admin operation failed");return new Response(JSON.stringify({ok:false,error:"Could not complete the operation. Refresh and try again."}),{status:500,headers:cors})}
});