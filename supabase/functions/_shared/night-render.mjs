import { createSnapshot, canonicalJSON } from './concept-contract.mjs';
import { photoDimensions } from './photo-dimensions.mjs';
import { NIGHT_RENDERER, outputDimensions, generationRequest, reviewRequest, parseReview, providerRequest } from './night-provider.mjs';

const digest = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');
const now = () => new Date().toISOString();
const checked = result => { if(result.error) throw result.error; return result.data; };
async function signed(client,bucket,path) {
  const data=checked(await client.storage.from(bucket).createSignedUrl(path,3600));
  if(!data?.signedUrl) throw Error('The saved photo could not be opened.');
  return data.signedUrl;
}
async function attach(client,session,row) {
  const saved=checked(await client.from('visualizer_sessions').update({current_render_id:row.id,status:row.stage==='ready'?'render_ready':'rendering',updated_at:now()})
    .eq('id',session.id).eq('design_revision',session.design_revision).eq('source_photo_path',session.source_photo_path).neq('status','converted_to_quote').select('id').maybeSingle());
  if(!saved) throw Error('Your design changed. Create a new night preview.');
}

async function finishSession(client,session,row) {
  const saved=checked(await client.from('visualizer_sessions').update({status:'render_ready',updated_at:now()})
    .eq('id',session.id).eq('current_render_id',row.id).eq('design_revision',session.design_revision)
    .eq('source_photo_path',row.design_spec.source_photo_path).neq('status','converted_to_quote').select('id').maybeSingle());
  if(!saved) throw Error('Your design changed. Create a new night preview.');
}

export async function startNightRender(client,session,key,request=providerRequest) {
  if(!key) throw Error('Night preview service is unavailable. Your design is saved.');
  const source=checked(await client.storage.from('quote-photos').download(session.source_photo_path));
  if(!source||source.size>8*1024*1024) throw Error('Upload a JPG or PNG photo under 8 MB.');
  const bytes=new Uint8Array(await source.arrayBuffer()),[w,h]=photoDimensions(bytes);
  if(w<1||h<1||w>2400||h>2400) throw Error('Upload this photo again to resize it safely.');
  const catalog=checked(await client.from('maceda_decoration_types').select('id,customer_name,category,allowed_zones,concept_geometry').eq('enabled',true));
  const snapshot={...createSnapshot(session,catalog||[],await digest(bytes)),renderer:NIGHT_RENDERER,presentation_version:1,source_dimensions:[w,h],output_dimensions:outputDimensions(w,h)};
  const hash=await digest(new TextEncoder().encode(canonicalJSON(snapshot)));
  // Session/version uniqueness serializes racing starts. Re-read after a collision.
  let row;
  for(let attempt=0;attempt<3;attempt++) {
    const last=checked(await client.from('visualizer_renders').select('*').eq('session_id',session.id).order('version',{ascending:false}).limit(1).maybeSingle());
    if(last?.validation_result?.snapshot_sha256===hash&&last.stage!=='failed') {row=last;break;}
    const inserted=await client.from('visualizer_renders').insert({session_id:session.id,version:Number(last?.version||0)+1,stage:'queued',design_spec:snapshot,validation_result:{snapshot_sha256:hash,renderer:NIGHT_RENDERER,physical_dimensions_verified:false},attempt_no:1}).select('*').single();
    if(!inserted.error) {row=inserted.data;break;}
    if(inserted.error.code!=='23505') throw inserted.error;
  }
  if(!row) throw Error('Another preview is starting. Please try again.');
  await attach(client,session,row);
  // Start returns quickly. Subsequent authenticated polls advance the provider job.
  return row;
}

export async function continueNightRender(client,session,key,request=providerRequest) {
  const row=checked(await client.from('visualizer_renders').select('*').eq('id',session.current_render_id).eq('session_id',session.id).maybeSingle());
  if(!row||row.design_spec?.renderer!==NIGHT_RENDERER) throw Error('Create a new night preview first.');
  if(row.design_spec.design_revision!==session.design_revision||row.design_spec.source_photo_path!==session.source_photo_path) throw Error('Your design changed. Create a new night preview.');
  if(row.stage==='ready') { await finishSession(client,session,row); return row; }
  if(row.stage==='failed') return row;
  const validation=row.validation_result||{},stamp=new Date(Math.max(Date.now(),Date.parse(row.updated_at)+1)).toISOString();
  // A short DB lease prevents duplicate paid submissions and duplicate publication.
  if(validation.lease_until&&Date.parse(validation.lease_until)>Date.now()) return row;
  const lease=crypto.randomUUID();
  const claimed=checked(await client.from('visualizer_renders').update({updated_at:stamp,validation_result:{...validation,lease,lease_until:new Date(Date.now()+60000).toISOString()}}).eq('id',row.id).eq('updated_at',row.updated_at).eq('stage',row.stage).select('*').maybeSingle());
  if(!claimed) return row;
  const save=async values => checked(await client.from('visualizer_renders').update({...values,updated_at:now(),validation_result:{...validation,...values.validation_result,lease:null,lease_until:null}}).eq('id',row.id).contains('validation_result',{lease}).select('*').maybeSingle());
  try {
    if(Date.now()-Date.parse(row.created_at)>15*60*1000) throw Error('This night preview timed out. Please try again.');
    if(row.stage==='queued') {
      // Mark before submitting: a lost provider response must never silently submit twice.
      const marked=checked(await client.from('visualizer_renders').update({stage:'generating',started_at:stamp}).eq('id',row.id).contains('validation_result',{lease}).select('id').maybeSingle());
      if(!marked) return row;
      const url=await signed(client,'quote-photos',row.design_spec.source_photo_path);
      const job=await request(key,'',generationRequest(row.design_spec,url));
      if(!job.id||!['queued','in_progress','completed'].includes(job.status)) throw Error('The night preview could not be started. Please try again.');
      return await save({stage:'generating',validation_result:{generation_id:job.id}});
    }
    if(row.stage==='generating') {
      if(!validation.generation_id) throw Error('The night preview connection was interrupted. Please try again.');
      const job=await request(key,'/'+encodeURIComponent(validation.generation_id));
      if(['queued','in_progress'].includes(job.status)) return await save({stage:'generating'});
      const image=(job.output||[]).find(x=>x.type==='image_generation_call'&&x.status==='completed'&&typeof x.result==='string');
      if(job.status!=='completed'||!image) throw Error('The night preview service did not return a finished image. Please try again.');
      if(image.result.length>14*1024*1024) throw Error('The night preview was too large. Please try again.');
      const png=Uint8Array.from(atob(image.result),x=>x.charCodeAt(0));
      if(png.length>10*1024*1024) throw Error('The night preview exceeds the image storage limit. Please try again.');
      if(png.length<20000||png[0]!==137||png[1]!==80) throw Error('The night preview image could not be verified.');
      const [w,h]=photoDimensions(png);
      if(!w||!h||w>4096||h>4096) throw Error('The night preview dimensions could not be verified.');
      const expected=row.design_spec.output_dimensions;
      if(w!==expected[0]||h!==expected[1]) throw Error('The night preview changed the photo framing. Please try again.');
      const path=session.id+'/'+row.id+'-night.png';
      checked(await client.storage.from('visualizer-renders').upload(path,png,{contentType:'image/png',upsert:true}));
      // Candidate stays private and is not exposed as a completed customer image.
      return await save({stage:'accuracy_check',validation_result:{candidate_path:path}});
    }
    if(row.stage==='accuracy_check'&&!validation.review_id) {
      if(validation.review_submitted) throw Error('The night preview review was interrupted. Please try again.');
      const marked=checked(await client.from('visualizer_renders').update({validation_result:{...claimed.validation_result,review_submitted:true}}).eq('id',row.id).contains('validation_result',{lease}).select('id').maybeSingle());
      if(!marked) return row;
      const original=await signed(client,'quote-photos',row.design_spec.source_photo_path);
      const candidate=await signed(client,'visualizer-renders',validation.candidate_path);
      const review=await request(key,'',reviewRequest(row.design_spec,original,candidate));
      if(!review.id) throw Error('The night preview review could not start.');
      return await save({stage:'accuracy_check',validation_result:{review_id:review.id,review_submitted:true}});
    }
    const job=await request(key,'/'+encodeURIComponent(validation.review_id));
    if(['queued','in_progress'].includes(job.status)) return await save({stage:'accuracy_check'});
    const result=parseReview(job);
    if(!result.passed) return await save({stage:'failed',error:'The image did not pass the night-preview accuracy review. Your design is saved; try again or simplify the selected areas.',validation_result:{review:result.review,passed:false},failure_reasons:result.review.failures||[]});
    const ready=await save({stage:'ready',image_path:validation.candidate_path,generated_at:now(),error:null,validation_result:{review:result.review,passed:true,pixel_preservation:'ai_approximation',physical_dimensions_verified:false}});
    if(!ready) return row;
    await finishSession(client,session,ready);
    return ready;
  } catch(error) {
    await save({stage:'failed',error:error instanceof Error?error.message:'The night preview could not finish. Your design is saved.'});
    throw error;
  }
}
