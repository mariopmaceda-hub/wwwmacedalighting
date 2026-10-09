import { Image } from 'https://deno.land/x/imagescript@1.3.0/mod.ts';
import { createSnapshot, canonicalJSON } from './concept-contract.mjs';
import { photoDimensions } from './photo-dimensions.mjs';
import { compositeRGBA } from './compositor.mjs';
const digest = async (bytes: Uint8Array) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');
export async function renderSnapshot(client:any, session:any) {
  const download=await client.storage.from('quote-photos').download(session.source_photo_path);
  if(download.error||!download.data)throw Error('Your original photo is unavailable. Please upload it again.');
  if(download.data.size>8*1024*1024)throw Error('The original photo exceeds 8 MB. Please upload it again.');
  const bytes=new Uint8Array(await download.data.arrayBuffer());
  const [width,height]=photoDimensions(bytes);
  if(width<1||height<1||width>2400||height>2400)throw Error('Please upload this photo again to resize it safely.');
  const types=await client.from('maceda_decoration_types').select('id,customer_name,category,allowed_zones,concept_geometry').eq('enabled',true);
  if(types.error)throw types.error;
  const snapshot=createSnapshot(session,types.data||[],await digest(bytes));
  const snapshotHash=await digest(new TextEncoder().encode(canonicalJSON(snapshot)));
  const existing=await client.from('visualizer_renders').select('*').eq('session_id',session.id).eq('stage','ready').contains('validation_result',{snapshot_sha256:snapshotHash}).limit(1).maybeSingle();
  if(existing.error)throw existing.error;
  let row=existing.data;
  if(!row){
    let image;
    try{image=await Image.decode(bytes);}catch{throw Error('This stored photo cannot be processed. Upload a new JPG, PNG or WebP photo to normalize it first.');}
    if(image.width>2400||image.height>2400||image.width*image.height>5760000)throw Error('Please upload this photo again to resize it safely.');
    const composed=compositeRGBA(new Uint8Array(image.bitmap),image.width,image.height,snapshot);
    image.bitmap.set(composed.pixels);
    const png=await image.encode();
    if(png.length>10*1024*1024)throw Error('The finished preview is too large. Upload a smaller photo and try again.');
    const path=session.id+'/'+snapshotHash+'.png';
    const uploaded=await client.storage.from('visualizer-renders').upload(path,png,{contentType:'image/png',upsert:true});
    if(uploaded.error)throw uploaded.error;
    // No queued jobs: render inside this request, persist only a completed immutable artifact.
    // A disconnected client can recover the result; a terminated request can safely retry.
    for(let attempt=0;attempt<3;attempt++){
      const last=await client.from('visualizer_renders').select('version').eq('session_id',session.id).order('version',{ascending:false}).limit(1).maybeSingle();
      if(last.error)throw last.error;
      const result=await client.from('visualizer_renders').insert({session_id:session.id,version:Number(last.data?.version||0)+1,stage:'ready',image_path:path,design_spec:snapshot,attempt_no:1,generated_at:new Date().toISOString(),validation_result:{...snapshot.validation,snapshot_sha256:snapshotHash,renderer:'deterministic-v1',pixel_preservation:'outside_overlay_exact',physical_dimensions_verified:false}}).select('*').single();
      if(!result.error){row=result.data;break;}
      if(result.error.code!=='23505')throw result.error;
    }
    if(!row)throw Error('Your preview was saved but could not be registered. Please retry.');
  }
  const saved=await client.from('visualizer_sessions').update({current_render_id:row.id,status:'render_ready',updated_at:new Date().toISOString()}).eq('id',session.id).eq('design_revision',session.design_revision).eq('source_photo_path',session.source_photo_path).neq('status','converted_to_quote').select('id').maybeSingle();
  if(saved.error)throw saved.error;
  if(!saved.data)throw Error('Your design changed while the preview was being created. Please create a new preview.');
  return row;
}

