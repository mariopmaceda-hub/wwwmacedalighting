import test from 'node:test';
import assert from 'node:assert/strict';
import {startNightRender,continueNightRender} from '../supabase/functions/_shared/night-render.mjs';
import {nightPrompt,parseReview,providerRequest,outputDimensions} from '../supabase/functions/_shared/night-provider.mjs';

function fixture(){
 const session={id:'test-session',source_photo_path:'test/home.png',design_revision:1,status:'ready_to_design',mode:'design_my_home',preset:'Classic Christmas',color_style:'Warm White',selected_zones:['main_roofline'],selected_decorations:[],selections:{placements:[]},install_zones:[{id:'main_roofline',confidence:.95,visible:true,polyline:[[.1,.2],[.9,.2]]}]};
 const renders=[],storage=new Map();
 const png=new Uint8Array(21000);png.set([137,80,78,71,13,10,26,10]);new DataView(png.buffer).setUint32(12,0x49484452);new DataView(png.buffer).setUint32(16,640);new DataView(png.buffer).setUint32(20,480);
 storage.set('quote-photos/test/home.png',new Blob([png]));
 const client={storage:{from:bucket=>({download:async path=>({data:storage.get(bucket+'/'+path)}),createSignedUrl:async path=>({data:{signedUrl:'https://storage.test/'+bucket+'/'+path}}),upload:async(path,data)=>{storage.set(bucket+'/'+path,new Blob([data]));return {error:null};}})},from:table=>{
  let filters=[],op='select',values,sort=false,limit=false;
  const q={select:()=>q,eq:(k,v)=>{filters.push(r=>r[k]===v);return q;},neq:(k,v)=>{filters.push(r=>r[k]!==v);return q;},contains:(k,v)=>{filters.push(r=>Object.entries(v).every(([a,b])=>r[k]?.[a]===b));return q;},order:()=>{sort=true;return q;},limit:()=>{limit=true;return q;},insert:v=>{op='insert';values=v;return q;},update:v=>{op='update';values=v;return q;},single:()=>run(),maybeSingle:()=>run(),then:(a,b)=>run().then(a,b)};
  async function run(){
   if(table==='maceda_decoration_types')return {data:[]};
   const all=table==='visualizer_sessions'?[session]:renders;
   if(op==='insert'){
    if(renders.some(r=>r.version===values.version))return {error:{code:'23505'}};
    const row={id:'render-'+renders.length,created_at:new Date().toISOString(),updated_at:new Date().toISOString(),...structuredClone(values)};renders.push(row);return {data:structuredClone(row)};
   }
   let rows=all.filter(r=>filters.every(f=>f(r)));if(sort)rows.sort((a,b)=>b.version-a.version);if(limit)rows=rows.slice(0,1);
   if(op==='update')rows.forEach(r=>Object.assign(r,structuredClone(values)));
   return {data:structuredClone(rows[0]||null)};
  }return q;
 }};
 const calls=[];
 const request=async(key,path,body)=>{calls.push({path,body});
  if(body?.tools)return {id:'generation',status:'queued'};
  if(body)return {id:'review',status:'queued'};
  if(path==='/generation'){const output=png.slice();new DataView(output.buffer).setUint32(16,1536);new DataView(output.buffer).setUint32(20,1152);return {status:'completed',output:[{type:'image_generation_call',status:'completed',result:Buffer.from(output).toString('base64')}]};}
  return {status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify({pass:true,night:true,photorealistic:true,architecture_preserved:true,selection_followed:true,failures:[]})}]}]};
 };
 return {client,session,renders,storage,calls,request};
}
test('both modes use real image editing and validated immutable artifacts, retries reuse finished output',async()=>{
 for(const mode of ['design_my_home','design_it_for_me']){
  const f=fixture();f.session.mode=mode;
  const first=await startNightRender(f.client,f.session,'test',f.request);assert.equal(first.stage,'queued');assert.equal(f.calls.length,0);
  await continueNightRender(f.client,f.session,'test',f.request);assert.equal(f.calls[0].body.tools[0].action,'edit');assert.equal(f.calls[0].body.background,true);
  await continueNightRender(f.client,f.session,'test',f.request);assert.equal(f.renders[0].stage,'accuracy_check');assert.equal(f.renders[0].image_path,undefined);
  await continueNightRender(f.client,f.session,'test',f.request);
  const ready=await continueNightRender(f.client,f.session,'test',f.request);assert.equal(ready.stage,'ready');assert.equal(f.session.status,'render_ready');assert.equal(ready.validation_result.passed,true);assert.equal(ready.design_spec.renderer,'ai-night-v1');
  const retry=await startNightRender(f.client,f.session,'test',f.request);assert.equal(retry.id,first.id);assert.equal(f.renders.length,1);
  assert.equal(f.storage.get('quote-photos/test/home.png').size,21000);
 }
});
test('concurrent starts and continuations do not duplicate paid generation',async()=>{
 const f=fixture();await Promise.all([startNightRender(f.client,f.session,'test'),startNightRender(f.client,f.session,'test')]);assert.equal(f.renders.length,1);
 await Promise.all([continueNightRender(f.client,f.session,'test',f.request),continueNightRender(f.client,f.session,'test',f.request)]);assert.equal(f.calls.length,1);
});
test('stale designs, missing provider and ambiguous lost responses cannot become ready',async()=>{
 const f=fixture();await assert.rejects(startNightRender(f.client,f.session,''),/unavailable/);assert.equal(f.renders.length,0);
 await startNightRender(f.client,f.session,'test');f.session.design_revision++;
 await assert.rejects(continueNightRender(f.client,f.session,'test'),/design changed/);f.session.design_revision--;
 await assert.rejects(continueNightRender(f.client,f.session,'test',async()=>{throw Error('connection lost')}),/connection lost/);assert.equal(f.renders[0].stage,'failed');assert.equal(f.renders[0].image_path,undefined);
});
test('daylight or schematic output fails review; malformed review fails closed',()=>{
 const response=v=>({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(v)}]}]});
 assert.equal(parseReview(response({pass:true,night:false,photorealistic:true,architecture_preserved:true,selection_followed:true,failures:[]})).passed,false);
 assert.equal(parseReview(response({pass:true,night:true,photorealistic:false,architecture_preserved:true,selection_followed:true,failures:[]})).passed,false);
 assert.throws(()=>parseReview({status:'completed',output:[]}));
 const {session}=fixture();const prompt=nightPrompt(session);assert.match(prompt,/12-inch/);assert.match(prompt,/do NOT calculate/);assert.match(prompt,/NIGHT/);
});
test('provider errors do not expose credentials or provider response bodies',async()=>{
 await assert.rejects(providerRequest('secret','',{},async()=>({ok:false,json:()=>({error:'private details'})})),e=>!e.message.includes('secret')&&!e.message.includes('private details'));
});
test('framing preserves landscape and portrait aspect ratio and rejects extreme panoramas',()=>{
 assert.deepEqual(outputDimensions(638,480),[1536,1152]);assert.deepEqual(outputDimensions(480,640),[1152,1536]);assert.throws(()=>outputDimensions(2400,300));
});
test('ready image repairs an interrupted session update without another paid generation',async()=>{
 const f=fixture();await startNightRender(f.client,f.session,'test');
 for(let i=0;i<4;i++)await continueNightRender(f.client,f.session,'test',f.request);
 f.session.status='rendering';const calls=f.calls.length;
 const recovered=await continueNightRender(f.client,f.session,'test',f.request);
 assert.equal(recovered.stage,'ready');assert.equal(f.session.status,'render_ready');assert.equal(f.calls.length,calls);
});
