import {Image} from 'https://deno.land/x/imagescript@1.3.0/mod.ts';
import {renderSnapshot} from '../supabase/functions/_shared/render-snapshot.ts';
const equal=(a:any,b:any)=>{if(JSON.stringify(a)!==JSON.stringify(b))throw Error('Mismatch: '+JSON.stringify([a,b]));};
Deno.test('real codec + server renderer: immutable source, interrupted response recovery, stale revision rejection',async()=>{
 const original=new Image(600,400);original.fill((x:number,y:number)=>Image.rgbaToColor(x%255,y%255,95,255));
 const png=await original.encode();
 const session:any={id:'TEST-session',source_photo_path:'TEST/photo.png',design_revision:1,status:'ready_to_design',mode:'design_my_home',preset:'Classic Christmas',color_style:'Warm White',selected_zones:['roof'],selected_decorations:[],selections:{placements:[]},install_zones:[{id:'roof',visible:true,confidence:.9,polyline:[[.1,.3],[.5,.1],[.9,.3]]}]};
 const renders:any[]=[],storage=new Map([['quote-photos/TEST/photo.png',new Blob([png],{type:'image/png'})]]);let failUpload=false,forceStale=false;
 const client:any={storage:{from:(bucket:string)=>({download:async(path:string)=>({data:storage.get(bucket+'/'+path)}),upload:async(path:string,bytes:any,options:any)=>{if(failUpload)return {error:Error('TEST storage failure')};storage.set(bucket+'/'+path,new Blob([bytes],{type:options.contentType}));return {error:null};}})},from:(table:string)=>{
  let filters:any[]=[],operation='select',value:any=null;
  const q:any={select:()=>q,eq:(k:string,v:any)=>{filters.push((r:any)=>r[k]===v);return q;},neq:(k:string,v:any)=>{filters.push((r:any)=>r[k]!==v);return q;},contains:(k:string,v:any)=>{filters.push((r:any)=>Object.entries(v).every(([key,val])=>r[k][key]===val));return q;},order:()=>q,limit:()=>q,insert:(v:any)=>{operation='insert';value=v;return q;},update:(v:any)=>{operation='update';value=v;return q;},single:()=>execute(),maybeSingle:()=>execute(),then:(resolve:any,reject:any)=>execute().then(resolve,reject)};
  async function execute(){if(table==='maceda_decoration_types')return {data:[]};if(table==='visualizer_renders'){if(operation==='insert'){const row={id:'TEST-render-'+renders.length,...value};renders.push(row);return {data:row};}return {data:renders.filter(r=>filters.every(f=>f(r))).at(-1)||null};}if(table==='visualizer_sessions'){if(forceStale||!filters.every(f=>f(session)))return {data:null};Object.assign(session,value);return {data:{id:session.id}};}throw Error('Unexpected table');}return q;
 }};
 failUpload=true;let failed=false;try{await renderSnapshot(client,session);}catch{failed=true;}equal(failed,true);equal(renders.length,0);equal(session.status,'ready_to_design');
 failUpload=false;const first=await renderSnapshot(client,session);equal(first.stage,'ready');equal(renders.length,1);
 // Lost HTTP response: retry uses the already finished artifact without duplicating render rows.
 const second=await renderSnapshot(client,session);equal(first.id,second.id);equal(renders.length,1);
 const decoded=await Image.decode(new Uint8Array(await storage.get('visualizer-renders/'+first.image_path)!.arrayBuffer()));
 equal([decoded.width,decoded.height],[600,400]);equal([...decoded.bitmap.slice((399*600)*4,(399*600+20)*4)],[...original.bitmap.slice((399*600)*4,(399*600+20)*4)]);
 forceStale=true;failed=false;try{await renderSnapshot(client,session);}catch{failed=true;}equal(failed,true);
});
