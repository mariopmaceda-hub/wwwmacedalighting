'use strict';
const U='https://gidqdlcvyasqalitqvcn.supabase.co',K='sb_publishable_Hc3SF2Vo6_pgvP8WlRY_5g_0f-uw1VR',API=U+'/functions/v1/customer-visualizer-api';
const db=window.MacedaPreviewClient||window.supabase.createClient(U,K),$=id=>document.getElementById(id);
const PRE=['Classic Christmas','Candy Cane','Elegant Estate','Christmas Spectacular','Minimal Modern','Griswold'],COL=['Warm White','Red + White','Multicolor'];
const LABEL={main_roofline:'Main Roofline',garage_roofline:'Garage Roofline',garage_peak:'Garage Peak',upper_gable:'Upper Gable',lower_gable:'Lower Gable',windows:'Windows',columns:'Columns',left_column:'Left Column',right_column:'Right Column',front_door:'Front Door',trees:'Trees',tree_1:'Tree 1',tree_2:'Tree 2',tree_3:'Tree 3',pathway:'Pathway'};
const MAP={'Classic Christmas':{c:'Warm White',z:['main_roofline','garage_roofline','garage_peak','upper_gable','lower_gable','windows'],d:['Wreath','Garland']},'Candy Cane':{c:'Red + White',z:['main_roofline','garage_roofline','garage_peak','upper_gable','left_column','right_column','columns'],d:['Wreath']},'Elegant Estate':{c:'Warm White',z:['main_roofline','garage_roofline','garage_peak','upper_gable','lower_gable','windows','left_column','right_column','columns'],d:['Wreath','Garland']},'Christmas Spectacular':{c:'Multicolor',all:true,d:['Wreath','Garland','Pathway','Arches']},'Minimal Modern':{c:'Warm White',z:['main_roofline','garage_roofline','garage_peak','upper_gable','lower_gable'],d:[]},'Griswold':{c:'Multicolor',all:true,d:['Wreath','Garland','Pathway','Arches']}};
const S={id:null,t:null,s:null,mode:null,preset:'Classic Christmas',color:'Warm White',zones:[],decor:[],placements:[],catalog:[],products:[],continuing:false,busy:false};
let epoch=0,stage="choice",directionChosen=false,colorChosen=false,ready=false,directions=[],renderSignature=null;
let authPending,editVersion=0,saveTimer,saveChain=Promise.resolve(),pollTimer,dirty=false;
function message(id,text,bad=false){const e=$(id);e.classList.remove('hidden');e.textContent=text;e.style.background=bad?'#fff0ef':'#f4efe5';e.style.color=bad?'#8d2927':'#4f6057';}
function prog(n){document.querySelectorAll('[data-p]').forEach(x=>{const v=Number(x.dataset.p);x.classList.toggle('done',v<n);x.classList.toggle('active',v===n)});}
async function post(b){const r=await fetch(API,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b)}),j=await r.json().catch(()=>({}));if(!r.ok||j.ok===false)throw Error(j.error||'Please try again.');return j;}
const payload=b=>({...b,session_id:S.id,session_token:S.t});
async function get(){const r=await fetch(API+'?session='+encodeURIComponent(S.id)+'&token='+encodeURIComponent(S.t)),j=await r.json();if(!r.ok||!j.ok)throw Error(j.error||'Could not restore your design.');S.s=j.session;return j.session;}
function remember(){try{localStorage.setItem('mlViz',JSON.stringify({id:S.id,t:S.t}))}catch{}}
async function authImpl(){if(S.id&&S.t)return;let stored;try{stored=localStorage.getItem('mlViz')||sessionStorage.getItem('mlViz')}catch{}if(stored){try{const x=JSON.parse(stored);S.id=x.id;S.t=x.t;await get();remember();return}catch{S.id=null;S.t=null;try{localStorage.removeItem('mlViz')}catch{}}}const j=await post({action:'create'});S.id=j.session_id;S.t=j.session_token;remember();}
function auth(){if(!authPending)authPending=authImpl().finally(()=>{authPending=null});return authPending;}
function visible(){return S.s?.install_zones||[];}
function eligible(d){return MacedaGeometry.eligibleZones(d,S.mode==='design_it_for_me'?visible().filter(MacedaDirections.usable):visible());}
function anchor(z){if(z.anchor?.length===2)return z.anchor;if(z.bbox?.length===4)return[z.bbox[0]+z.bbox[2]/2,z.bbox[1]+z.bbox[3]/2];if(z.polyline?.length>=2)return z.polyline[Math.floor(z.polyline.length/2)];return null;}
function setPlacements(){S.placements=S.decor.map(name=>{const d=S.catalog.find(x=>x.customer_name===name);if(!d)return null;const zones=eligible(d),old=S.placements.find(p=>p.catalog_id===d.id);const zone=zones.find(z=>z.id===old?.zone_id)||zones[0];return zone?{catalog_id:d.id,customer_name:name,category:d.category,zone_id:zone.id,anchor:anchor(zone),scale_status:'concept_unmeasured'}:null;}).filter(Boolean);}
function selectMode(mode,scroll=true){
  if(!ready||S.busy||!['design_it_for_me','design_my_home'].includes(mode))return;
  if(S.mode===mode){showStage(nextStage(),{scroll});return;}
  epoch++;editVersion++;clearTimeout(saveTimer);clearTimeout(pollTimer);
  S.mode=mode;S.preset=PRE[0];S.color=COL[0];S.zones=[];S.decor=[];S.placements=[];
  directionChosen=false;colorChosen=false;renderSignature=null;S.continuing=false;
  $('renderFinal').removeAttribute('src');$('renderStatus').classList.add('hidden');
  try{localStorage.removeItem('mlVizDraft')}catch{}
  if(visible().length){build();if(mode==='design_my_home'){preset(PRE[0]);directionChosen=true;colorChosen=true;}else{dirty=true;localDraft();}}
  else{dirty=true;localDraft();}
  rememberJourney();showStage(nextStage(),{scroll});
  queueSave().catch(e=>message('contactStatus','Your choice is saved on this device. Reconnect before continuing.',true));
}
document.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>selectMode(b.dataset.mode));
$('customize').onclick=()=>selectMode('design_my_home');
$('contactForm').onsubmit=async e=>{e.preventDefault();const b=$('contactSubmit');try{b.disabled=true;await auth();const contact={name:$('cName').value.trim(),phone:$('cPhone').value.trim(),email:$('cEmail').value.trim(),address:$('cAddress').value.trim()};await post(payload({action:'save_contact',...contact}));await get();['Name','Phone','Email','Address'].forEach(x=>$('q'+x).value=$('c'+x).value);message('contactStatus','Your details are saved. Add your front photo.');$('photoStep').classList.remove('hidden');$('photoStep').scrollIntoView({behavior:'smooth'});}catch(err){message('contactStatus',err.message,true)}finally{b.disabled=false}};
function files(){const a=[];for(const [view,id] of [['front','front'],['left','leftView'],['right','rightView']])if($(id).files[0])a.push({view,file:$(id).files[0]});Array.from($('extras').files||[]).slice(0,3).forEach((file,i)=>a.push({view:'additional_'+(i+1),file}));return a;}
function preview(){const p=$('pics');p.replaceChildren();files().forEach(({view,file})=>{const img=document.createElement('img');img.alt=view+' view';img.src=URL.createObjectURL(file);img.onload=()=>URL.revokeObjectURL(img.src);p.append(img)});$('analyze').disabled=!$('front').files[0];}
['front','leftView','rightView','extras'].forEach(id=>$(id).onchange=preview);
async function upload(file){if(!['image/jpeg','image/png','image/webp'].includes(file.type))throw Error('Use a JPG, PNG or WebP photo. Export HEIC photos as JPG first.');if(file.size>8*1024*1024)throw Error('Each photo must be under 8 MB.');let bitmap;try{bitmap=await createImageBitmap(file,{imageOrientation:'from-image'});}catch{throw Error('This photo could not be read. Choose a clear JPG, PNG or WebP photo.');}const canvas=document.createElement('canvas'),scale=Math.min(1,2400/Math.max(bitmap.width,bitmap.height));canvas.width=Math.round(bitmap.width*scale);canvas.height=Math.round(bitmap.height*scale);const paint=canvas.getContext('2d');paint.fillStyle='#ffffff';paint.fillRect(0,0,canvas.width,canvas.height);paint.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();const normalized=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.94));if(!normalized)throw Error('Photo processing failed. Try another photo.');const j=await post(payload({action:'prepare_upload',extension:'jpg'}));const x=await db.storage.from('quote-photos').uploadToSignedUrl(j.path,j.token,normalized,{contentType:'image/jpeg'});if(x.error)throw Error('Photo upload failed. Please try again.');return j.path;}
$('analyze').onclick=async()=>{try{clearTimeout(saveTimer);lock(true);await saveChain;message('photoStatus','Saving your photos…');await auth();if(!S.s?.contact_profile?.name)throw Error('Save your contact details first.');const entries=files();if(!entries.find(x=>x.view==='front'))throw Error('Choose a front photo first.');const paths={},extra=[];for(const x of entries){const p=await upload(x.file);paths[x.view]=p;if(x.view!=='front')extra.push(p);}await post(payload({action:'attach_photos',source_photo_path:paths.front,additional_photo_paths:extra,photo_views:paths}));message('photoStatus','Finding the visible lighting areas on your home…');await post(payload({action:'analyze'}));const s=await get();if(s.status!=='ready_to_design')throw Error(s.photo_analysis?.error||'Please try a clearer front photo showing your whole home.');lock(false);S.preset=s.preset||'Classic Christmas';$('house').src=s.front_url;$('originalFinal').src=s.front_url;epoch++;directionChosen=false;colorChosen=false;renderSignature=null;build();if(S.mode==='design_my_home'){preset(S.preset);directionChosen=true;colorChosen=true;}else{S.zones=[];S.decor=[];S.placements=[];changed();}rememberJourney();showStage(nextStage());message('photoStatus','Your photos are saved. '+visible().length+' visible lighting areas found.');}catch(e){message('photoStatus',e.message,true)}finally{lock(false);}};
function button(text,cls,fn){const b=document.createElement('button');b.type='button';b.textContent=text;b.className=cls;b.onclick=fn;return b;}
function icon(kind){const shapes={ring:'<circle cx="24" cy="18" r="12" fill="none" stroke="#315b40" stroke-width="6"/><path d="M20 10h8l-4 6z" fill="#8d2927"/>',drape:'<path d="M5 8Q24 36 43 8" fill="none" stroke="#315b40" stroke-width="6"/>',path:'<path d="M7 30L40 8" stroke="#d7b56d"/><circle cx="12" cy="25" r="4" fill="#d7b56d"/><circle cx="24" cy="18" r="4" fill="#d7b56d"/><circle cx="36" cy="11" r="4" fill="#d7b56d"/>',arch:'<path d="M7 31V19a17 17 0 0 1 34 0v12" fill="none" stroke="#d7b56d" stroke-width="4"/>'};return '<svg viewBox="0 0 48 36" aria-hidden="true">'+(shapes[kind]||shapes.ring)+'</svg>';}
function build(){$('presets').replaceChildren();PRE.forEach(p=>{const b=button(p,'preset',()=>preset(p));b.dataset.v=p;$('presets').append(b)});$('colors').replaceChildren();COL.forEach(c=>{const b=button(c,'color',()=>{S.color=c;colorChosen=true;rememberJourney();changed()});const sw=document.createElement('span');sw.className='sw '+(c==='Warm White'?'warm':c==='Red + White'?'rw':'multi');b.prepend(sw);b.dataset.v=c;$('colors').append(b)});$('zones').replaceChildren();visible().forEach(z=>{const b=button(LABEL[z.id]||z.label,'chip',()=>{if(S.mode==='design_it_for_me')return;S.zones=S.zones.includes(z.id)?S.zones.filter(x=>x!==z.id):[...S.zones,z.id];changed()});b.dataset.v=z.id;$('zones').append(b)});$('decor').replaceChildren();S.catalog.forEach(d=>{const b=button(d.customer_name,'',()=>{if(S.mode==='design_it_for_me')return;S.decor=S.decor.includes(d.customer_name)?S.decor.filter(x=>x!==d.customer_name):[...S.decor,d.customer_name];setPlacements();changed()});b.insertAdjacentHTML('afterbegin',icon(d.concept_geometry));b.dataset.v=d.customer_name;$('decor').append(b)});$('quality').replaceChildren();const info=[['Photo','Your original home'],['Zones',visible().length+' visible areas'],['Scale','Concept · unmeasured']];info.forEach(([label,value])=>{const d=document.createElement('div'),b=document.createElement('b');b.textContent=value;d.append(b,document.createTextNode(label));$('quality').append(d)});sync();}
function preset(p){S.preset=p;const m=MAP[p]||MAP[PRE[0]],v=new Set(visible().filter(window.MacedaConceptEditor?.usableZone||MacedaDirections.usable).map(z=>z.id));S.color=m.c;S.zones=m.all?[...v]:(m.z||[]).filter(z=>v.has(z));S.decor=m.d.filter(name=>{const d=S.catalog.find(x=>x.customer_name===name);return d&&eligible(d).length});setPlacements();changed();}
function sync(){syncJourney();document.querySelectorAll('#presets [data-v]').forEach(b=>{const a=b.dataset.v===S.preset;b.classList.toggle('active',a);b.setAttribute('aria-pressed',String(a))});document.querySelectorAll('#colors [data-v]').forEach(b=>{const a=b.dataset.v===S.color&&(S.mode!=='design_it_for_me'||colorChosen);b.classList.toggle('active',a);b.setAttribute('aria-pressed',String(a))});document.querySelectorAll('#zones [data-v]').forEach(b=>{const a=S.zones.includes(b.dataset.v);b.classList.toggle('active',a);b.setAttribute('aria-pressed',String(a));b.disabled=S.mode==='design_it_for_me'||S.busy;});document.querySelectorAll('#decor [data-v]').forEach(b=>{const d=S.catalog.find(x=>x.customer_name===b.dataset.v);b.setAttribute('aria-pressed',String(S.decor.includes(b.dataset.v)));b.disabled=S.mode==='design_it_for_me'||!eligible(d).length||S.busy;});$('customize').classList.add('hidden');$('placementControls').replaceChildren();S.placements.forEach(p=>{const d=S.catalog.find(x=>x.id===p.catalog_id),wrap=document.createElement('div'),label=document.createElement('label'),sel=document.createElement('select');wrap.className='placement';sel.id='place-'+d.id;label.htmlFor=sel.id;label.textContent=p.customer_name+' location';eligible(d).forEach(z=>{const o=document.createElement('option');o.value=z.id;o.textContent=LABEL[z.id]||z.label;sel.append(o)});sel.value=p.zone_id;sel.disabled=S.mode==='design_it_for_me'||S.busy;sel.onchange=()=>{p.zone_id=sel.value;p.anchor=anchor(visible().find(z=>z.id===sel.value));changed()};wrap.append(label,sel);$('placementControls').append(wrap)});}
function svgEl(tag,attrs){const e=document.createElementNS('http://www.w3.org/2000/svg',tag);Object.entries(attrs).forEach(([k,v])=>e.setAttribute(k,v));return e;}
function colors(){return S.color==='Red + White'?['#e04438','#fff8e5']:S.color==='Multicolor'?['#e04438','#55ba78','#568df6','#f5cd5d']:['#fff0b8'];}
function draw(){const svg=$('svg');svg.replaceChildren();const ratio=$('house').naturalWidth&&$('house').naturalHeight?$('house').naturalWidth/$('house').naturalHeight:1.5;const vbH=1000/ratio;svg.setAttribute('viewBox','0 0 1000 '+vbH);const palette=colors();function bulb(x,y,i){svg.append(svgEl('circle',{cx:x,cy:y,r:3.2,fill:palette[i%palette.length],class:'bulb'}))}function run(points){let idx=0;for(let i=1;i<points.length;i++){const a=[points[i-1][0]*1000,points[i-1][1]*vbH],b=[points[i][0]*1000,points[i][1]*vbH],n=Math.max(1,Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/11));for(let j=0;j<n;j++)bulb(a[0]+(b[0]-a[0])*j/n,a[1]+(b[1]-a[1])*j/n,idx++);}const p=points.at(-1);bulb(p[0]*1000,p[1]*vbH,idx)}visible().forEach(z=>{if(!S.zones.includes(z.id))return;if(z.polyline?.length>=2)run(z.polyline);else if(z.bbox?.length===4){const [x,y,w,h]=z.bbox;run([[x,y],[x+w,y],[x+w,y+h],[x,y+h],[x,y]])}});S.placements.forEach(p=>{const d=S.catalog.find(x=>x.id===p.catalog_id),z=visible().find(x=>x.id===p.zone_id),a=anchor(z);if(!d||!a)return;const x=a[0]*1000,y=a[1]*vbH,bb=z.bbox||[],w=bb.length===4?bb[2]*1000:80,h=bb.length===4?bb[3]*vbH:90;const r=Math.max(10,Math.min(w*.25,h*.2,30));if(d.concept_geometry==='ring')svg.append(svgEl('circle',{cx:x,cy:y,r,fill:'none',stroke:'#458655','stroke-width':6}));else if(d.concept_geometry==='drape')svg.append(svgEl('path',{d:'M '+(x-w*.42)+' '+(y-h*.4)+' Q '+x+' '+y+' '+(x+w*.42)+' '+(y-h*.4),fill:'none',stroke:'#458655','stroke-width':6}));else if(d.concept_geometry==='path'){for(let i=-2;i<=2;i++)bulb(x+i*w*.16,y+i*h*.08,i+2);}else if(d.concept_geometry==='arch')svg.append(svgEl('path',{d:'M '+(x-w*.35)+' '+(y+h*.25)+' Q '+x+' '+(y-h*.6)+' '+(x+w*.35)+' '+(y+h*.25),fill:'none',stroke:palette[0],'stroke-width':5}));});}
$('house').onload=draw;
function designPayload(){return payload({action:'save_design',mode:S.mode,preset:S.preset,color_style:S.color,selected_zones:[...S.zones],selected_decorations:[...S.decor],selections:{overlay_version:2,placements:S.placements.map(p=>({...p}))}});}
function localDraft(){try{localStorage.setItem('mlVizDraft',JSON.stringify({version:3,id:S.id,mode:S.mode,preset:S.preset,color:S.color,zones:S.zones,decor:S.decor,placements:S.placements,directionChosen,colorChosen,time:Date.now()}))}catch{}}
function queueSave(){
  if(!S.mode)return Promise.resolve();
  const b=visible().length?designPayload():payload({action:'save_mode',mode:S.mode}),revision=editVersion,generation=epoch;
  saveChain=saveChain.catch(()=>{}).then(async()=>{
    if(generation!==epoch)return;
    await post(b);
    if(generation===epoch&&revision===editVersion){dirty=false;try{localStorage.removeItem('mlVizDraft')}catch{}$('saveStatus').textContent='Design saved · you can return on this device.';rememberJourney();}
  });return saveChain;
}
function changed(){
  if(S.busy)return;renderSignature=null;sync();draw();
  if(S.mode&&visible().length){dirty=true;editVersion++;$('saveStatus').textContent='Saving your design…';localDraft();rememberJourney();clearTimeout(saveTimer);saveTimer=setTimeout(()=>queueSave().catch(()=>{$('saveStatus').textContent='Your latest edit is saved on this device. Reconnect to sync.'}),650);$('finalStep').classList.add('hidden');}
}
function lock(b){S.busy=b;document.querySelectorAll('#presets button,#colors button,[data-mode],#analyze,#contactSubmit,#customize,.direction,.journey-back').forEach(x=>x.disabled=b);if(!b)$('analyze').disabled=!$('front').files[0];sync();}
$('render').onclick=async()=>{
  const generation=epoch;
  try{
    if(S.mode==='design_it_for_me'&&(!directionChosen||!colorChosen||!S.zones.length))throw Error('Choose a direction and color first.');
    clearTimeout(saveTimer);lock(true);$('finalStep').classList.add('hidden');prog(3);message('renderStatus','Saving your design…');
    await queueSave();const saved=await get();if(generation!==epoch)return;
    if(signature(saved)!==signature())throw Error('Your selection could not be confirmed. Please try again.');
    message('renderStatus','Rendering realistic lights at night… This may take a few minutes.');await post(payload({action:'start_render',render_style:'night'}));await pollRender(generation);
  }catch(e){if(generation===epoch){message('renderStatus',e.message,true);lock(false);}}
};
function describeRender(render){
  const night=render?.design_spec?.renderer==='ai-night-v1';
  document.querySelector('#finalStep .head p').textContent=night?'An AI-generated night concept based on your photo and selected design. Maceda reviews placement and measurements before installation.':'Your saved lighting layout. Maceda reviews placement and measurements before installation.';
  $('previewWarnings').textContent=night?'AI lighting and exposure may vary from the actual installation. Bulb spacing, placement and measurements are confirmed by Maceda.':'';
}
async function pollRender(generation=epoch){
  clearTimeout(pollTimer);
  try{
    const s=await get();if(generation!==epoch)return;const r=s.render;
    if(!r)throw Error('Preview not found. Please try again.');
    if(signature(s)!==signature())throw Error('Your design changed. Create a new preview.');
    if(r.stage==='ready'&&r.image_url){if(s.status!=='render_ready'&&s.status!=='converted_to_quote'){await post(payload({action:'continue_render'}));pollTimer=setTimeout(()=>pollRender(generation),1000);return;}if(r.design_spec&&signature({...r.design_spec})!==signature(s))throw Error('Your preview belongs to an earlier design. Please create a new preview.');$('originalFinal').src=s.front_url;$('renderFinal').src=r.image_url;renderSignature=signature();lock(false);showSummary();showStage('final');describeRender(r);message('renderStatus','Your preview is ready.');return;}
    if(r.stage==='failed')throw Error('This preview could not be completed. Your design is saved. Please try again.');
    message('renderStatus',r.stage==='accuracy_check'?'Checking the preview against your original home…':r.retry_count?'Refining your preview for accuracy…':'Rendering realistic lights at night… This may take a few minutes.');
    if(['queued','generating','accuracy_check'].includes(r.stage)&&!S.continuing){S.continuing=true;post(payload({action:'continue_render'})).catch(()=>{if(generation===epoch)message('renderStatus','Connection interrupted. Checking your saved preview…',true)}).finally(()=>{if(generation===epoch)S.continuing=false});}
    pollTimer=setTimeout(()=>pollRender(generation),5000);
  }catch(e){if(generation===epoch){message('renderStatus',e.message,true);lock(false);}}
}
$('quoteForm').onsubmit=async e=>{e.preventDefault();const b=$('quoteSubmit');try{b.disabled=true;const result=await post(payload({action:'create_quote',marketing_attribution:window.MLAnalytics?.attribution()||null,name:$('qName').value.trim(),phone:$('qPhone').value.trim(),email:$('qEmail').value.trim(),address:$('qAddress').value.trim(),message:$('qMessage').value.trim(),sms_opt_in:$('sms').checked}));if(result.status!=='submitted'||result.preview_attached!==true)throw Error('Your quote is not yet confirmed. Your design is saved; please retry.');try{window.MLAnalytics?.lead(result.quote_id,'visualizer')}catch{}$('quoteForm').replaceChildren();const s=document.createElement('div');s.className='success';s.textContent='Quote request sent. Your design, photos and lighting preview are attached for Maceda to review.';$('quoteForm').append(s);}catch(err){message('quoteStatus',err.message,true);b.disabled=false;}};
window.addEventListener('pagehide',()=>{if(dirty&&S.id)localDraft();});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'&&dirty){clearTimeout(saveTimer);queueSave().catch(()=>{});}});
async function init(){
  document.querySelectorAll('[data-mode]').forEach(b=>b.disabled=true);
  try{
    const r=await fetch(API+'?catalog=1'),j=await r.json();if(!r.ok||!j.ok)throw Error('The Maceda catalog could not load. Please refresh.');
    S.catalog=j.decoration_types||[];S.products=j.products||[];await auth();
    if(!S.s){showStage('choice',{replace:true,scroll:false});return;}
    const s=S.s;S.mode=s.mode;S.preset=s.preset||PRE[0];S.color=s.color_style||COL[0];S.zones=s.selected_zones||[];S.decor=s.selected_decorations||[];S.placements=s.selections?.placements||[];
    const c=s.contact_profile||{};['Name','Phone','Email','Address'].forEach(x=>{const v=c[x.toLowerCase()]||'';$('c'+x).value=v;$('q'+x).value=v;});
    if(c.name)message('contactStatus','Your details are saved.');
    if(s.front_url){$('house').src=s.front_url;$('originalFinal').src=s.front_url;message('photoStatus','Your uploaded photos are saved.');}
    let journey;try{journey=JSON.parse(localStorage.getItem('mlVizJourney')||'null')}catch{}
    try{
      const d=JSON.parse(localStorage.getItem('mlVizDraft')||'null');
      // Only this version's draft may resume an interrupted switch. Older drafts must match the server mode.
      const pendingSwitch=d?.version===3&&journey?.id===S.id&&journey.mode===d.mode;
      if(d?.id===S.id&&(d.mode===S.mode||pendingSwitch)&&d.time>Date.now()-7*86400000&&(d.time>Date.parse(s.updated_at||0)||pendingSwitch)){
        S.mode=d.mode;S.preset=PRE.includes(d.preset)?d.preset:PRE[0];S.color=COL.includes(d.color)?d.color:COL[0];S.zones=(d.zones||[]).filter(id=>visible().some(z=>z.id===id));S.decor=d.decor||[];S.placements=d.placements||[];dirty=true;
      }
    }catch{}
    directionChosen=S.mode==='design_my_home'||S.zones.length>0;colorChosen=directionChosen;
    if(journey?.id===S.id&&journey.mode===S.mode){directionChosen=journey.directionChosen&&S.zones.length>0;colorChosen=journey.colorChosen&&directionChosen;}
    build();setPlacements();sync();draw();
    if(dirty){await queueSave();await get();}else $('saveStatus').textContent='Your saved design is restored.';
    showStage(nextStage(),{replace:true,scroll:false});
    if(!dirty&&directionChosen&&colorChosen&&S.s.render&&['queued','generating','accuracy_check'].includes(S.s.render.stage)){lock(true);pollRender();}
    else if(directionChosen&&colorChosen&&S.s.render?.stage==='ready'&&S.s.render.image_url&&(!S.s.render.design_spec||signature(S.s.render.design_spec)===signature(S.s))){
      if(S.s.render.design_spec?.renderer==='deterministic-v1'&&S.s.status!=='converted_to_quote')message('renderStatus','Your saved layout is ready. Create a new night preview to see realistic lights.');
      else if(S.s.status!=='render_ready'&&S.s.status!=='converted_to_quote'){lock(true);pollRender();}
      else{$('renderFinal').src=S.s.render.image_url;renderSignature=signature();showSummary();showStage('final',{replace:true,scroll:false});describeRender(S.s.render);}
    }
  }catch(e){message('contactStatus',e.message,true);$('contactStep').classList.remove('hidden');}
  finally{ready=Boolean(S.id);document.querySelectorAll('[data-mode]').forEach(b=>b.disabled=!ready||S.busy);}
}
function signature(s){
  const zones=s?s.selected_zones:S.zones,decor=s?s.selected_decorations:S.decor,placements=s?s.selections?.placements:S.placements;
  return JSON.stringify([s?s.mode:S.mode,s?s.preset:S.preset,s?s.color_style:S.color,[...(zones||[])].sort(),[...(decor||[])].sort(),(placements||[]).map(p=>[p.catalog_id,p.zone_id,p.anchor]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))),s?s.source_photo_path:S.s?.source_photo_path,s?s.install_zones:S.s?.install_zones]);
}
function rememberJourney(){try{localStorage.setItem('mlVizJourney',JSON.stringify({id:S.id,mode:S.mode,directionChosen,colorChosen}))}catch{}}
function nextStage(){if(!S.mode)return 'choice';if(!visible().length)return 'home';return S.mode==='design_it_for_me'&&!directionChosen?'directions':'design';}
function showStage(wanted,{replace=false,scroll=true,history=true}={}){
  if(wanted==='final'&&renderSignature!==signature())wanted=nextStage();
  if(['design','directions'].includes(wanted)&&!visible().length)wanted=nextStage();
  if(wanted==='design'&&S.mode==='design_it_for_me'&&!directionChosen)wanted='directions';
  stage=wanted;
  $('contactStep').classList.toggle('hidden',!S.mode||stage!=='home');
  $('photoStep').classList.toggle('hidden',!S.mode||stage!=='home'||!S.s?.contact_profile?.name);
  $('directionsStep').classList.toggle('hidden',stage!=='directions');
  $('designStep').classList.toggle('hidden',stage!=='design');
  $('finalStep').classList.toggle('hidden',stage!=='final');
  if(stage==='directions')buildDirections();
  syncJourney();prog(stage==='choice'?1:stage==='home'?2:stage==='final'?4:3);
  if(history){const state={mlJourney:true,id:S.id,mode:S.mode,epoch,stage};window.history[replace?'replaceState':'pushState'](state,'','#'+stage);}
  if(scroll)$(stage==='choice'?'modeStep':stage==='home'?(S.s?.contact_profile?.name?'photoStep':'contactStep'):stage==='directions'?'directionsStep':stage==='final'?'finalStep':'designStep').scrollIntoView({behavior:'smooth',block:'start'});
}
function syncJourney(){
  const maceda=S.mode==='design_it_for_me';
  document.querySelectorAll('[data-mode]').forEach(b=>{b.setAttribute('aria-pressed',String(b.dataset.mode===S.mode));b.classList.toggle('selected',b.dataset.mode===S.mode)});
  document.querySelectorAll('[data-diy]').forEach(e=>e.classList.toggle('hidden',maceda));
  $('designStep').classList.toggle('maceda-colors',maceda);
  $('designHeading').textContent=maceda?'Make it yours with color.':'Build the lighting direction.';
  $('designIntro').textContent=maceda?S.preset+' · Your chosen lighting areas stay the same. Select a color, then create your lighting preview.':'Choose your layout here, then create a realistic night preview with glowing lights.';
  $('designBack').textContent=maceda?'Back to concept directions':'Back to your choice';
  $('colorPrompt').classList.toggle('hidden',!maceda||colorChosen);
  $('render').disabled=S.busy||(maceda&&(!directionChosen||!colorChosen||!S.zones.length));
  if(maceda&&!colorChosen)document.querySelectorAll('#colors [data-v]').forEach(b=>{b.classList.remove('active');b.setAttribute('aria-pressed','false')});
}
function buildDirections(){
  directions=MacedaDirections.create({zones:visible(),catalog:S.catalog,presets:MAP,candidates:typeof window.MacedaConceptProvider==='function'?window.MacedaConceptProvider({zones:visible(),catalog:S.catalog}):undefined});
  $('directionNotice').textContent=directions.length===3?'Each layout uses only detected, clearly visible features.':directions.length?'Your photo supports '+directions.length+' distinct '+(directions.length===1?'layout':'layouts')+'. We leave out uncertain or hidden features.':'We need a clearer photo to suggest a reliable lighting direction. Add a front photo showing the visible roofline and entrance.';
  $('directionsStep').querySelector('h2').textContent=directions.length===3?'Three looks. Your home.':'Looks for your home.';
  $('directions').replaceChildren();
  directions.forEach(d=>{
    const b=button('','direction',()=>chooseDirection(d));b.dataset.direction=d.preset;b.setAttribute('aria-pressed',String(directionChosen&&S.preset===d.preset));
    const thumb=document.createElement('span');thumb.className='thumbnail';const img=document.createElement('img');img.src=S.s.front_url;img.alt=d.preset+' concept on your home';thumb.append(img);
    const copy=document.createElement('span');copy.className='direction-copy';const title=document.createElement('strong');title.textContent=d.preset;const scope=document.createElement('span');scope.className='scope';scope.textContent=[d.zones.map(z=>LABEL[z]||z).join(' · '),d.decor.join(' · ')].filter(Boolean).join(' / ');const choose=document.createElement('span');choose.className='choose-label';choose.textContent='CHOOSE THIS DIRECTION →';copy.append(title,scope,choose);b.append(thumb,copy);$('directions').append(b);
  });
  drawDirections();
}
function drawDirections(){
  // Reuse Kevin's existing renderer unchanged, then restore the selected design.
  const saved={zones:S.zones,decor:S.decor,placements:S.placements,color:S.color};
  try{directions.forEach((d,i)=>{S.zones=d.zones;S.decor=d.decor;S.placements=[];S.color=COL[0];setPlacements();draw();const thumb=$('directions').children[i]?.querySelector('.thumbnail');if(thumb){thumb.querySelector('svg')?.remove();const svg=$('svg').cloneNode(true);svg.removeAttribute('id');svg.setAttribute('preserveAspectRatio','xMidYMid meet');thumb.append(svg);}})}finally{Object.assign(S,saved);draw();}
}
function chooseDirection(d){
  if(S.busy)return;S.preset=d.preset;S.zones=[...d.zones];S.decor=[...d.decor];S.placements=[];S.color=COL[0];setPlacements();directionChosen=true;colorChosen=false;changed();rememberJourney();showStage('design');
}
function showSummary(){$('selectionSummary').textContent=[S.mode==='design_it_for_me'?'Maceda designs it for me':"I'll design it myself",S.preset,S.color,S.zones.map(z=>LABEL[z]||z).join(', '),S.placements.map(p=>p.customer_name+' — '+(LABEL[p.zone_id]||p.zone_id)).join(', ')].filter(Boolean).join(' · ');}
$('house').addEventListener('load',()=>{if(stage==='directions')drawDirections()});
$('directionsBack').onclick=()=>showStage('choice');
$('designBack').onclick=()=>showStage(S.mode==='design_it_for_me'?'directions':'choice');
$('finalBack').onclick=()=>showStage('design');
document.querySelectorAll('[data-edit-home]').forEach(b=>b.onclick=()=>showStage('home'));
window.addEventListener('popstate',e=>{const h=e.state;if(S.busy){showStage(stage,{replace:true,scroll:false});return;}showStage(h?.mlJourney&&h.id===S.id&&h.mode===S.mode&&h.epoch===epoch?h.stage:'choice',{history:false});});
window.addEventListener('pageshow',e=>{if(e.persisted)showStage(nextStage(),{replace:true,scroll:false});});

init();
