/* Branch/local review isolation. Only the existing production hostname uses live APIs. */
(function(){
  'use strict';
  if(location.hostname==='wwwmacedalighting.netlify.app')return;
  const host='gidqdlcvyasqalitqvcn.supabase.co',key='mlVizPreviewFixtureV1';
  const sample='data:image/svg+xml;charset=utf-8,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="900" height="600" viewBox="0 0 900 600"><rect width="900" height="600" fill="#b8ced0"/><rect y="440" width="900" height="160" fill="#71885b"/><path d="M130 290L430 110L730 290Z" fill="#4d514a"/><path d="M180 285H685V470H180Z" fill="#e2d4b9"/><path d="M550 470L590 600H375L414 470Z" fill="#cbc1a6"/><rect x="415" y="315" width="105" height="155" fill="#684f3c"/><g fill="#6b8581" stroke="#f7eddb" stroke-width="12"><rect x="230" y="320" width="100" height="95"/><rect x="565" y="320" width="75" height="95"/></g><path d="M125 292L430 110L738 292" fill="none" stroke="#f4eddf" stroke-width="10"/><text x="450" y="560" text-anchor="middle" font-family="Arial" font-size="22" fill="#263b2f">ILLUSTRATED REVIEW HOME · NOT AN AI RENDER</text></svg>');
  const catalog=[{id:'review-wreath',customer_name:'Wreath',category:'wreath',allowed_zones:['front_door'],concept_geometry:'ring'},{id:'review-garland',customer_name:'Garland',category:'garland',allowed_zones:['front_door','columns'],concept_geometry:'drape'},{id:'review-path',customer_name:'Pathway',category:'pathway',allowed_zones:['pathway'],concept_geometry:'path'},{id:'review-arches',customer_name:'Arches',category:'arches',allowed_zones:['pathway'],concept_geometry:'arch'}];
  const zones=[{id:'main_roofline',confidence:.96,visible:true,polyline:[[.139,.487],[.478,.183],[.82,.487]]},{id:'windows',confidence:.94,visible:true,bbox:[.25,.53,.12,.16]},{id:'front_door',confidence:.96,visible:true,bbox:[.46,.525,.12,.258],anchor:[.52,.65]},{id:'pathway',confidence:.91,visible:true,bbox:[.42,.8,.23,.18],anchor:[.54,.89]}];
  const empty=()=>({id:'isolated-review-session',mode:null,status:'created',contact_profile:{},install_zones:[],selected_zones:[],selected_decorations:[],selections:{placements:[]},design_revision:0,updated_at:new Date().toISOString()});
  let state;try{state=JSON.parse(sessionStorage.getItem(key)||'null')}catch{}state=state||empty();
  let uploadData=null,started=0;
  function save(){state.updated_at=new Date().toISOString();sessionStorage.setItem(key,JSON.stringify(state));}
  const nativeFetch=window.fetch.bind(window);
  window.fetch=async function(input,options={}){
    const url=new URL(typeof input==='string'?input:input.url,location.href);
    if(url.hostname!==host)return nativeFetch(input,options);
    if(!url.pathname.endsWith('/customer-visualizer-api'))return new Response(JSON.stringify({ok:false,error:'Live services are disabled in this review preview.'}),{status:403});
    const b=JSON.parse(options.body||'{}');let result={ok:true};
    if(window.MacedaPreview.delay)await new Promise(resolve=>setTimeout(resolve,window.MacedaPreview.delay));
    window.MacedaPreview.requests.push(structuredClone(b));
    if(window.MacedaPreview.failAction===b.action)return new Response(JSON.stringify({ok:false,error:'Simulated connection failure'}),{status:503});
    if(url.searchParams.has('catalog'))result={ok:true,decoration_types:catalog,products:[]};
    else if(!b.action)result={ok:true,session:state};
    else switch(b.action){
      case 'create':result={ok:true,session_id:state.id,session_token:'review-only-token'};break;
      case 'save_mode':state.mode=b.mode;save();break;
      case 'save_contact':state.contact_profile={name:b.name,phone:b.phone,email:b.email,address:b.address};save();break;
      case 'prepare_upload':result={ok:true,path:'review/upload.jpg',token:'review-upload-token'};break;
      case 'attach_photos':state.front_url=uploadData||sample;state.source_photo_path=b.source_photo_path;state.additional_photo_paths=b.additional_photo_paths;state.install_zones=[];state.render=null;save();break;
      case 'analyze':state.install_zones=zones;state.status='ready_to_design';state.preset='Classic Christmas';save();break;
      case 'save_design':Object.assign(state,{mode:b.mode,preset:b.preset,color_style:b.color_style,selected_zones:b.selected_zones,selected_decorations:b.selected_decorations,selections:b.selections,design_revision:state.design_revision+1,render:null,status:'ready_to_design'});save();break;
      case 'start_render':started++;state.render={id:'review-render-'+started,stage:'queued',version:started};save();break;
      case 'continue_render':state.render={...state.render,stage:'ready',image_url:state.front_url};state.status='render_ready';save();break;
      case 'create_quote':state.status='converted_to_quote';save();result={ok:true,quote_id:'review-only-no-quote-sent',status:'submitted',preview_attached:true};break;
      default:return new Response(JSON.stringify({ok:false,error:'Unsupported review action'}),{status:400});
    }
    return new Response(JSON.stringify(result),{headers:{'content-type':'application/json'}});
  };
  window.MacedaPreviewClient={storage:{from:()=>({uploadToSignedUrl:async(path,token,blob)=>{uploadData=await new Promise(resolve=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.readAsDataURL(blob)});return {error:null};}})}};
  window.MacedaPreview={requests:[],delay:0,failAction:null,getState:()=>structuredClone(state),setState:s=>{state=structuredClone(s);save()},sample,zones,catalog};
  const notice=document.createElement('aside');notice.className='preview-notice';notice.setAttribute('role','note');notice.textContent='REVIEW PREVIEW · Sample analysis and placeholder images only. Nothing is sent to Maceda. Use sample details, not customer information.';
  const load=document.createElement('button');load.type='button';load.textContent='Load example home';load.onclick=()=>{state={...empty(),front_url:sample,source_photo_path:'review/home.svg',contact_profile:{name:'Sample Homeowner',phone:'2025550100',email:'sample@example.invalid',address:'Example home — review only'},install_zones:zones,status:'ready_to_design'};save();localStorage.removeItem('mlVizDraft');localStorage.removeItem('mlVizJourney');location.reload()};notice.append(load);document.body.prepend(notice);
  new MutationObserver(()=>{
    const success=document.querySelector('.success');
    const text='Review complete. No quote was submitted and no messages were sent.';
    if(success&&success.textContent!==text)success.textContent=text;
    const caption=document.querySelector('#finalStep .compare figure:last-child figcaption');
    const label='REVIEW PLACEHOLDER — no realistic image was generated';
    if(caption&&caption.textContent!==label)caption.textContent=label;
  }).observe(document.body,{childList:true,subtree:true});
})();
