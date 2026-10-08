
import "jsr:@supabase/functions-js@2.117.3/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

import { renderSnapshot } from '../_shared/render-snapshot.ts';
const CORS={
  "content-type":"application/json",
  "access-control-allow-origin":"*",
  "access-control-allow-headers":"content-type",
  "access-control-allow-methods":"GET,POST,OPTIONS"
};
const COLORS=new Set(["Warm White","Red + White","Multicolor"]);
const PRESETS=new Set(["Classic Christmas","Candy Cane","Elegant Estate","Christmas Spectacular","Minimal Modern","Griswold"]);
const ZONES=new Set(["main_roofline","garage_roofline","garage_peak","upper_gable","lower_gable","windows","columns","left_column","right_column","front_door","trees","tree_1","tree_2","tree_3","pathway"]);


function sb(){
  const raw=Deno.env.get("SUPABASE_SECRET_KEYS");
  if(!raw) throw new Error("Server configuration unavailable");
  const keys=JSON.parse(raw);
  const key=keys.default??Object.values(keys)[0];
  return createClient(Deno.env.get("SUPABASE_URL")!,key as string);
}
function randToken(){
  const b=new Uint8Array(32);crypto.getRandomValues(b);
  return [...b].map(x=>x.toString(16).padStart(2,"0")).join("");
}
async function sha256(s:string){
  const b=new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(s)));
  return [...b].map(x=>x.toString(16).padStart(2,"0")).join("");
}
async function clientHash(req:Request){
  const ip=(req.headers.get("cf-connecting-ip")||req.headers.get("x-forwarded-for")||req.headers.get("x-real-ip")||"unknown").split(",")[0].trim();
  const ua=req.headers.get("user-agent")||"unknown";
  const pepper=Deno.env.get("SUPABASE_SECRET_KEYS")||"maceda-visualizer";
  return await sha256(ip+"|"+ua+"|"+pepper.slice(0,96));
}
async function rateLimit(client:any,hash:string,action:string,max:number,minutes:number,sessionId:string|null=null){
  const cutoff=new Date(Date.now()-minutes*60*1000).toISOString();
  const q=await client.from("visualizer_request_limits").select("id",{count:"exact",head:true})
    .eq("client_hash",hash).eq("action",action).gte("created_at",cutoff);
  if(q.error) throw q.error;
  if(Number(q.count||0)>=max) throw new Error("Too many visualizer requests right now. Please try again a little later.");
  const ins=await client.from("visualizer_request_limits").insert({client_hash:hash,action,session_id:sessionId});
  if(ins.error) throw ins.error;
}
function arr(v:any){return Array.isArray(v)?v:[]}
function clean(s:any,n=500){return String(s??"").trim().slice(0,n)}
function bounded01(v:any){const n=Number(v);return Number.isFinite(n)?Math.max(0,Math.min(1,n)):0}
function jsonFromText(t:string){
  const a=t.indexOf("{"),b=t.lastIndexOf("}");
  if(a<0||b<a) throw new Error("AI analysis returned invalid data");
  return JSON.parse(t.slice(a,b+1));
}
function outputText(j:any){
  const out:string[]=[];
  for(const item of j?.output??[]) for(const c of item?.content??[]) if(c?.type==="output_text"&&typeof c.text==="string") out.push(c.text);
  return out.join("\n");
}
async function imageDataUrl(blob:Blob){
  const bytes=new Uint8Array(await blob.arrayBuffer());
  let s="";for(let i=0;i<bytes.length;i+=0x8000)s+=String.fromCharCode(...bytes.subarray(i,Math.min(i+0x8000,bytes.length)));
  return "data:"+(blob.type||"image/jpeg")+";base64,"+btoa(s);
}
async function requireSession(client:any,id:any,token:any){
  const sid=clean(id,100),tok=clean(token,200);
  if(!sid||!tok) throw new Error("Session authorization required");
  const hash=await sha256(tok);
  const {data,error}=await client.from("visualizer_sessions").select("*").eq("id",sid).eq("session_token_hash",hash).maybeSingle();
  if(error) throw error;
  if(!data) throw new Error("Visualizer session not found");
  if(new Date(data.expires_at).getTime()<Date.now()) throw new Error("Visualizer session expired");
  return data;
}
async function signed(client:any,bucket:string,path:any,seconds=3600){
  if(!path) return null;
  const {data,error}=await client.storage.from(bucket).createSignedUrl(String(path),seconds);
  if(error) return null;
  return data?.signedUrl??null;
}
function normalizeZones(v:any){
  // Preserve authoritative analysis geometry exactly. Validation happens downstream.
  return arr(v).map((z:any)=>({...z}));
}
function selectionSummary(s:any){
  return {
    mode:s.mode,preset:s.preset,color_style:s.color_style, source_photo_path:s.source_photo_path, architecture_lock:s.architecture_lock, visible_install_zones:s.install_zones, scale_calibration:s.scale_calibration, design_revision:s.design_revision,
    selected_zones:s.selected_zones??[],selected_decorations:s.selected_decorations??[],
    selections:s.selections??{}
  };
}
async function analyzeSession(sessionId:string){
  const client=sb();
  try{
    const {data:s,error}=await client.from("visualizer_sessions").select("*").eq("id",sessionId).single();
    if(error||!s) throw error??new Error("Session missing");
    if(!s.source_photo_path) throw new Error("Front photo missing");
    const key=Deno.env.get("OPENAI_API_KEY");if(!key) throw new Error("AI provider unavailable");
    const d=await client.storage.from("quote-photos").download(s.source_photo_path);
    if(d.error||!d.data) throw d.error??new Error("Front photo unavailable");
    const content:any[]=[
      {type:"input_text",text:[
        "Analyze this home photo for Maceda Lighting's customer Christmas-lighting visualizer.",
        "The original photo is the source of truth. Do not invent hidden architecture.",
        "Return ONLY JSON with this shape:",
        '{"usable":true,"warnings":[],"photo_quality":{"blur":"low","cropping":"good","perspective":"front","roofline_visibility":0,"front_elevation_visibility":0,"major_obstructions":[]},"architecture_lock":{"roof_geometry":"","windows":"","doors":"","garage":"","columns":"","landscaping":"","occlusions":"","camera":"","composition":""},"recommended_preset":"Classic Christmas","zones":[]}',
        'Each zones item: {"id":"main_roofline|garage_roofline|garage_peak|upper_gable|lower_gable|windows|left_column|right_column|columns|front_door|tree_1|tree_2|tree_3|trees|pathway","label":"short label","confidence":0.0,"polyline":[[x,y],[x,y]],"bbox":[x,y,w,h],"anchor":[x,y],"notes":"factual visibility note"}.',
        "All coordinates are normalized 0 to 1 relative to this exact front photo.",
        "For rooflines and gables, provide a polyline following only the visible installable edge. Do not continue lines behind trees, hedges, vehicles, or other occluders.",
        "For windows, columns, doors, trees, and pathway, use bbox and/or anchor. Return left_column and right_column separately when visible, and tree_1, tree_2, tree_3 individually. Return garage_peak for a distinct garage peak. Do not collapse multiple columns or trees into a single grouped box. Keep window paths on actual frames, not a box around the whole facade. Never estimate physical measurements from the photo.",
        "Only return zones actually visible enough to decorate. A normal homeowner phone photo should usually be usable; reject only if the property cannot reasonably be visualized.",
        "recommended_preset must be one of: Classic Christmas, Candy Cane, Elegant Estate, Christmas Spectacular, Minimal Modern, Griswold."
      ].join("\n")},
      {type:"input_image",image_url:await imageDataUrl(d.data),detail:"high"}
    ];
    for(const p of arr(s.additional_photo_paths).slice(0,5)){
      const x=await client.storage.from("quote-photos").download(p);
      if(!x.error&&x.data) content.push({type:"input_image",image_url:await imageDataUrl(x.data),detail:"low"});
    }
    const resp=await fetch("https://api.openai.com/v1/responses",{
      method:"POST",headers:{Authorization:"Bearer "+key,"Content-Type":"application/json"},
      body:JSON.stringify({model:"gpt-5.6-terra",store:false,max_output_tokens:7000,text:{format:{type:"json_object"}},input:[{role:"user",content}]})
    });
    const j=await resp.json();
    if(!resp.ok) throw new Error("AI analysis failed");
    if(j.status==="incomplete")throw new Error("Your photo analysis needs another try. Please analyze again.");
    const parsed=jsonFromText(outputText(j));
    const zones=normalizeZones(parsed?.zones);
    const usable=parsed?.usable!==false;
    const preset=PRESETS.has(String(parsed?.recommended_preset))?String(parsed.recommended_preset):"Classic Christmas";
    const {error:up}=await client.from("visualizer_sessions").update({
      status:usable?"ready_to_design":"photo_uploaded",
      photo_analysis:{usable,warnings:arr(parsed?.warnings).map((x:any)=>clean(x,500)),photo_quality:parsed?.photo_quality??{},recommended_preset:preset},
      architecture_lock:parsed?.architecture_lock??{},
      install_zones:zones,
      preset:preset,
      updated_at:new Date().toISOString()
    }).eq("id",sessionId).neq("status","converted_to_quote");
    if(up) throw up;
  }catch(e){
    await client.from("visualizer_sessions").update({
      status:"photo_uploaded",
      photo_analysis:{usable:false,error:e instanceof Error?e.message:String(e)},
      updated_at:new Date().toISOString()
    }).eq("id",sessionId);
  }
}
Deno.serve(async(req)=>{
  if(req.method==="OPTIONS") return new Response(null,{status:204,headers:CORS});
  const client=sb();
  try{
    if(req.method==="GET"){
      const u=new URL(req.url);
      if(u.searchParams.get("catalog")==="1"){
        const types=await client.from("maceda_decoration_types").select("id,customer_name,category,allowed_zones,concept_geometry").eq("enabled",true).order("display_order");
        if(types.error) throw types.error;
        const {data,error}=await client.rpc("pe_customer_catalog");
        if(error) throw error;
        return new Response(JSON.stringify({ok:true,products:data??[],decoration_types:types.data??[],pricing_enabled:false}),{headers:CORS});
      }
      const s=await requireSession(client,u.searchParams.get("session"),u.searchParams.get("token"));
      const render=s.current_render_id?await client.from("visualizer_renders").select("*").eq("id",s.current_render_id).maybeSingle():{data:null};
      const frontUrl=await signed(client,"quote-photos",s.source_photo_path,3600);
      const resultUrl=render?.data?.image_path?await signed(client,"visualizer-renders",render.data.image_path,3600):null;
      return new Response(JSON.stringify({ok:true,session:{
        id:s.id,status:s.status,updated_at:s.updated_at,mode:s.mode,source_photo_path:s.source_photo_path,contact_profile:s.contact_profile,lead_quote_id:s.lead_quote_id,photo_views:s.photo_views,scale_calibration:s.scale_calibration,design_revision:s.design_revision,
        additional_photo_paths:s.additional_photo_paths,front_url:frontUrl,
        photo_analysis:s.photo_analysis,architecture_lock:s.architecture_lock,install_zones:s.install_zones,
        preset:s.preset,color_style:s.color_style,selected_zones:s.selected_zones,
        selected_decorations:s.selected_decorations,selections:s.selections,expires_at:s.expires_at,
        render:render?.data?{id:render.data.id,version:render.data.version,stage:render.data.stage,image_url:resultUrl,
          design_spec:render.data.design_spec,validation_result:render.data.validation_result,error:render.data.error,retry_count:render.data.retry_count}:null
      }}),{headers:CORS});
    }
    if(req.method!=="POST") return new Response(JSON.stringify({ok:false,error:"Method not allowed"}),{status:405,headers:CORS});
    const b=await req.json().catch(()=>({}));
    const action=clean(b?.action,60);
    const ch=await clientHash(req);

    if(action==="create"){
      await rateLimit(client,ch,"create",10,60,null);
      const token=randToken(),hash=await sha256(token);
      const {data,error}=await client.from("visualizer_sessions").insert({session_token_hash:hash}).select("id,status,expires_at").single();
      if(error) throw error;
      return new Response(JSON.stringify({ok:true,session_id:data.id,session_token:token,status:data.status,expires_at:data.expires_at}),{headers:CORS});
    }

    
    const s=await requireSession(client,b?.session_id,b?.session_token);
    if(s.status==='converted_to_quote'&&action!=='create_quote')throw Error('This quote has already been submitted. Start a new design for further changes.');
    if(action==="save_contact"){
      await rateLimit(client,ch,"save_contact",30,60,s.id);
      const name=clean(b.name,160),phone=clean(b.phone,80),email=clean(b.email,220),address=clean(b.address,300);
      if(!name||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||phone.replace(/\D/g,"").length<10||!address) throw new Error("Enter your name, valid phone, email, and property address.");
      const contact={name,phone,email,address};
      const existing=await client.from("quotes").select("id").eq("visualizer_session_id",s.id).maybeSingle();
      if(existing.error)throw existing.error;
      let id=existing.data?.id;
      if(!id){
        const q=await client.from("quotes").insert({...contact,visualizer_session_id:s.id,property_type:"Residential",status:"New Lead",sms_opt_in:false,photo_paths:s.source_photo_path?[s.source_photo_path,...arr(s.additional_photo_paths)]:[],message:"Customer visualizer design in progress.",admin_notes:"Visualizer draft: customer has not yet requested a final quote."}).select("id").single();
        if(q.error&&q.error.code!=='23505')throw q.error;
        if(q.error){const existing=await client.from('quotes').select('id').eq('visualizer_session_id',s.id).single();if(existing.error)throw existing.error;id=existing.data.id;}else id=q.data.id;
      }else{
        const q=await client.from("quotes").update(contact).eq("id",id).eq("sms_opt_in",false);
        if(q.error)throw q.error;
      }
      const saved=await client.from("visualizer_sessions").update({contact_profile:contact,lead_quote_id:id,updated_at:new Date().toISOString()}).eq("id",s.id).neq("status","converted_to_quote");
      if(saved.error)throw saved.error;
      return new Response(JSON.stringify({ok:true,quote_id:id}),{headers:CORS});
    }
    if(action==="save_mode"){
      if(!["design_it_for_me","design_my_home"].includes(b.mode))throw new Error("Choose a design mode.");
      const q=await client.from("visualizer_sessions").update({mode:b.mode,design_revision:Number(s.design_revision||0)+1,current_render_id:null,updated_at:new Date().toISOString()}).eq("id",s.id).neq("status","converted_to_quote");if(q.error)throw q.error;
      return new Response(JSON.stringify({ok:true}),{headers:CORS});
    }
    if(action==="prepare_upload"){
      await rateLimit(client,ch,"upload",20,60,s.id);
      const ext=clean(b.extension,10).toLowerCase();
      if(!["jpg","jpeg","png","webp"].includes(ext))throw new Error("Use a JPG, PNG, or WebP photo.");
      const path="visualizer/"+s.id+"/"+crypto.randomUUID()+"."+ext;
      const r=await client.storage.from("quote-photos").createSignedUploadUrl(path);
      if(r.error)throw r.error;
      return new Response(JSON.stringify({ok:true,path,token:r.data.token}),{headers:CORS});
    }


    if(action==="attach_photos"){
      const front=clean(b?.source_photo_path,700);
      const extras=arr(b?.additional_photo_paths).slice(0,5).map((x:any)=>clean(x,700)).filter(Boolean);
      const prefix="visualizer/"+s.id+"/";
      if(!front.startsWith(prefix)||extras.some((x:string)=>!x.startsWith(prefix))) throw new Error("Uploaded photo path is invalid");
      const all=[front,...extras];
      for(const p of all){
        const {data}=await client.storage.from("quote-photos").list(p.split("/").slice(0,-1).join("/"),{search:p.split("/").at(-1),limit:5});
        const object=data?.find((x:any)=>p.endsWith('/'+x.name));
        if(!object)throw Error('One of the uploaded photos could not be verified.');
        if(Number(object.metadata?.size)>8*1024*1024||!['image/jpeg','image/png','image/webp'].includes(object.metadata?.mimetype))throw Error('Use JPG, PNG or WebP photos under 8 MB.');
      }
      const {error}=await client.from("visualizer_sessions").update({
        source_photo_path:front,additional_photo_paths:extras,design_revision:Number(s.design_revision||0)+1,status:"photo_uploaded",current_render_id:null,
        photo_views:Object.fromEntries(Object.entries(b.photo_views||{}).filter(([k,v])=>["front","left","right","additional_1","additional_2","additional_3"].includes(k)&&typeof v==="string"&&all.includes(v))),photo_analysis:{},architecture_lock:{},install_zones:[],updated_at:new Date().toISOString()
      }).eq("id",s.id).neq("status","converted_to_quote");
      if(error) throw error;
      if(s.lead_quote_id){const q=await client.from("quotes").update({photo_paths:[front,...extras]}).eq("id",s.lead_quote_id).eq("sms_opt_in",false);if(q.error)throw q.error;}
      return new Response(JSON.stringify({ok:true,status:"photo_uploaded"}),{headers:CORS});
    }

    if(action==="analyze"){
      await rateLimit(client,ch,"analyze",5,60,s.id);
      if(!s.source_photo_path) throw new Error("Upload a front photo first");
      await client.from("visualizer_sessions").update({status:"analyzing",updated_at:new Date().toISOString()}).eq("id",s.id).neq("status","converted_to_quote");
      await analyzeSession(s.id);
      const fresh=await client.from("visualizer_sessions").select("status,photo_analysis,install_zones,preset").eq("id",s.id).single();
      if(fresh.error) throw fresh.error;
      return new Response(JSON.stringify({ok:true,status:fresh.data.status,photo_analysis:fresh.data.photo_analysis,install_zones:fresh.data.install_zones,preset:fresh.data.preset}),{status:200,headers:CORS});
    }

    if(action==="save_design"){
      const mode=clean(b?.mode,40);
      if(!["design_it_for_me","design_my_home"].includes(mode)) throw new Error("Choose a design mode");
      const preset=clean(b?.preset,80);
      if(preset&&!PRESETS.has(preset)) throw new Error("Invalid preset");
      const color=clean(b?.color_style,80)||"Warm White";
      if(!COLORS.has(color)) throw new Error("Invalid color style");
      const visible=new Set(arr(s.install_zones).map((z:any)=>String(z?.id)));
      const selected=arr(b?.selected_zones).map((x:any)=>clean(x,80)).filter((x:string)=>ZONES.has(x)&&visible.has(x));
      
      const cat=await client.from("maceda_decoration_types").select("id,customer_name,category,allowed_zones").eq("enabled",true);
      if(cat.error)throw cat.error;
      const types=cat.data??[];
      const valid=new Set(types.filter((d:any)=>arr(d.allowed_zones).some((z:any)=>visible.has(String(z)))).map((d:any)=>d.customer_name));
      const decorations=arr(b?.selected_decorations).map((x:any)=>clean(x,80)).filter((x:string)=>valid.has(x));

      
      const input=b?.selections&&typeof b.selections==="object"?b.selections:{};
      const placements=arr(input.placements).slice(0,24).map((p:any)=>{
        const type=types.find((d:any)=>d.id===p.catalog_id&&decorations.includes(d.customer_name));
        if(!type||!visible.has(p.zone_id)||!arr(type.allowed_zones).includes(p.zone_id))return null;
        const zone=arr(s.install_zones).find((z:any)=>z.id===p.zone_id);
        const bb=arr(zone?.bbox),aa=arr(zone?.anchor);
        const anchor=arr(p.anchor);
        if(anchor.length!==2||!anchor.every((n:any)=>typeof n==='number'&&Number.isFinite(n)&&n>=0&&n<=1))throw Error('Invalid decoration anchor.');
        if(!anchor)return null;
        return {catalog_id:type.id,customer_name:type.customer_name,category:type.category,zone_id:p.zone_id,anchor,scale_status:"concept_unmeasured",physical_dimensions:null};
      }).filter(Boolean);
      const selections={overlay_version:2,placements,pricing_enabled:false};

      const {data:savedDesign,error}=await client.from("visualizer_sessions").update({
        mode,preset:preset||s.preset||"Classic Christmas",color_style:color,
        selected_zones:[...new Set(selected)],selected_decorations:[...new Set(decorations)],
        selections,design_revision:Number(s.design_revision||0)+1,current_render_id:null,status:"ready_to_design",updated_at:new Date().toISOString()
      }).eq("id",s.id).eq("design_revision",s.design_revision).neq("status","converted_to_quote").select("id").maybeSingle();
      if(error) throw error;
      if(!savedDesign)throw Error("Your design changed in another window. Reload before saving.");
      if(s.lead_quote_id){await client.from("quotes").update({message:"Visualizer draft: "+[mode,preset||s.preset,color,selected.join(", "),decorations.join(", ")].join(" | ")}).eq("id",s.lead_quote_id);}
      return new Response(JSON.stringify({ok:true}),{headers:CORS});
    }

    if(action==="start_render"||action==="continue_render"){
      await rateLimit(client,ch,"start_render",15,60,s.id);
      const fresh=await requireSession(client,s.id,b.session_token);
      if(fresh.status==='converted_to_quote')throw Error('This quote has already been submitted.');
      if(!fresh.source_photo_path||!arr(fresh.install_zones).length)throw Error('Analyze your photo first.');
      const r=await renderSnapshot(client,fresh);
      return new Response(JSON.stringify({ok:true,render_id:r.id,stage:r.stage}),{headers:CORS});
    }

    if(action==="create_quote"){
      await rateLimit(client,ch,"create_quote",20,1440,s.id);
      if(!s.current_render_id)throw Error('Create your preview before requesting a quote.');
      if(b.sms_opt_in!==true)throw Error('Please confirm text-message consent.');
      const rr=await client.from('visualizer_renders').select('*').eq('id',s.current_render_id).eq('session_id',s.id).eq('stage','ready').single();
      if(rr.error||!rr.data?.image_path)throw Error('Your preview is not available. Please create it again.');
      if(rr.data.design_spec?.contract_version!=='maceda-concept/1')throw Error('Please create a new preview before submitting.');
      const lead=await client.from('quotes').select('id').eq('visualizer_session_id',s.id).single();
      if(lead.error||!lead.data)throw Error('Save your contact details before requesting a quote.');
      const dest=lead.data.id+'/visualizer-'+rr.data.id+'.png';
      if(s.status!=='converted_to_quote'){
        const dl=await client.storage.from('visualizer-renders').download(rr.data.image_path);
        if(dl.error||!dl.data)throw Error('Your preview could not be retrieved. Your draft is saved; please retry.');
        const up=await client.storage.from('quote-previews').upload(dest,dl.data,{contentType:'image/png',upsert:true});
        if(up.error)throw Error('Your preview could not be attached. Your draft is saved; please retry.');
      }
      const spec=rr.data.design_spec;
      const summary='Customer Visualizer: '+[spec.preset,spec.color_style,arr(spec.selected_zones).join(', '),arr(spec.selected_decorations).join(', ')].filter(Boolean).join(' | ');
      const result=await client.rpc('finalize_visualizer_quote',{p_session_id:s.id,p_render_id:rr.data.id,p_preview_path:dest,p_contact:{name:clean(b.name,160),phone:clean(b.phone,80),email:clean(b.email,220),address:clean(b.address,300),sms_opt_in:true,message:[summary,clean(b.message,1500)].filter(Boolean).join('\n')}});
      if(result.error)throw Error('Your quote is not yet confirmed. Your design is saved; please retry.');
      return new Response(JSON.stringify({ok:true,...result.data}),{headers:CORS});
    }

    return new Response(JSON.stringify({ok:false,error:"Unknown action"}),{status:400,headers:CORS});
  }catch(e){
    return new Response(JSON.stringify({ok:false,error:e instanceof Error?e.message:String(e)}),{status:400,headers:CORS});
  }
});


