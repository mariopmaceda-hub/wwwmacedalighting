/* Maceda public analytics. No customer values, quote IDs, photo URLs or filenames enter vendor events. */
(function(){
  'use strict';
  const HOST='wwwmacedalighting.netlify.app',GA='G-RXSFMWCDJ9',CLARITY='yusyap213r';
  const paths=new Set(['/','/index.html','/visualizer/','/visualizer/index.html','/privacy','/privacy.html','/terms','/terms.html']);
  if(!paths.has(location.pathname))return;
  const STORE='mlFirstTouchV1',CONSENT='mlAnalyticsConsentV1',TTL=90*86400000;
  const sourceNames=new Set(['door_hanger','yard_sign','flyer','google','bing','facebook','instagram','email','referral','direct']);
  const read=k=>{try{return JSON.parse(localStorage.getItem(k)||'null')}catch{return null}},write=(k,v)=>{try{localStorage.setItem(k,JSON.stringify(v))}catch{}};
  const safe=v=>typeof v==='string'&&/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(v)&&!/[0-9]{7}/.test(v)?v:null;
  const page=location.pathname.startsWith('/visualizer')?'/visualizer/':location.pathname.startsWith('/privacy')?'/privacy':location.pathname.startsWith('/terms')?'/terms':'/';
  const params=new URLSearchParams(location.search);let touch=read(STORE);
  if(!touch||!Number.isFinite(Date.parse(touch.first_touch_at))||Date.now()-Date.parse(touch.first_touch_at)>TTL||Date.parse(touch.first_touch_at)>Date.now()+60000)touch=null;
  if(!touch&&['utm_source','utm_medium','utm_campaign','utm_content'].some(k=>params.has(k))){
    let referrer=null;try{const u=new URL(document.referrer);if(u.origin!==location.origin&&['https:','http:'].includes(u.protocol))referrer=u.origin}catch{}
    touch={version:1,utm_source:safe(params.get('utm_source')),utm_medium:safe(params.get('utm_medium')),utm_campaign:safe(params.get('utm_campaign')),utm_content:safe(params.get('utm_content')),landing_page:page,referrer,first_touch_at:new Date().toISOString()};write(STORE,touch);
  }
  const attribution=()=>touch?JSON.parse(JSON.stringify(touch)):null;
  const vendorSource=()=>sourceNames.has(touch?.utm_source)?touch.utm_source:touch?.utm_source?'other':'direct';
  const isProduction=location.hostname===HOST;
  let active=false,loaded=false;const started=new Set(),conversions=new Set();
  window.dataLayer=window.dataLayer||[];window.gtag=window.gtag||function(){dataLayer.push(arguments)};
  const cleanLocation='https://'+HOST+page;
  function track(name,form){
    if(!active)return;
    const fields={page_location:cleanLocation,page_referrer:'',page_title:page==='/visualizer/'?'Maceda Lighting Visualizer':'Maceda Lighting',form_name:form==='visualizer'?'visualizer':'homepage',marketing_source:vendorSource()};
    // Do not forward arbitrary UTM text to vendors. Only registered campaign labels are sent.
    if(touch?.utm_medium==='qr')fields.campaign_medium='qr';
    if(touch?.utm_campaign==='holiday_2026')fields.campaign_name='holiday_2026';
    fields.campaign_source=vendorSource();
    try{gtag('event',name,fields)}catch{};
  }
  function load(){
    if(loaded||!active||!isProduction)return;loaded=true;
    gtag('consent','default',{analytics_storage:'denied',ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied'});
    gtag('consent','update',{analytics_storage:'granted'});
    gtag('js',new Date());
    gtag('set',{allow_google_signals:false,allow_ad_personalization_signals:false,page_location:cleanLocation,page_referrer:'',page_title:page==='/visualizer/'?'Maceda Lighting Visualizer':'Maceda Lighting'});
    gtag('config',GA,{send_page_view:false,allow_google_signals:false,allow_ad_personalization_signals:false,form_interactions:false});
    const script=document.createElement('script');script.async=true;script.src='https://www.googletagmanager.com/gtag/js?id='+GA;document.head.append(script);
    track('page_view',page==='/visualizer/'?'visualizer':'homepage');
    // Clarity records the real URL. Exclude sessions with arbitrary query/hash/referrer data.
    const knownURL=[...params].every(([k,v])=>({utm_source:['door_hanger','yard_sign','flyer'],utm_medium:['qr'],utm_campaign:['holiday_2026']})[k]?.includes(v))&&['','#quote'].includes(location.hash);
    let refSafe=!document.referrer;try{const u=new URL(document.referrer);refSafe=!u.search&&!u.hash&&(u.pathname==='/'||(u.origin===location.origin&&paths.has(u.pathname)))}catch{}
    if(knownURL&&refSafe){window.clarity=window.clarity||function(){(window.clarity.q=window.clarity.q||[]).push(arguments)};clarity('consentv2',{ad_Storage:'denied',analytics_Storage:'granted'});const c=document.createElement('script');c.async=true;c.src='https://www.clarity.ms/tag/'+CLARITY;document.head.append(c);}
  }
  function choose(value){write(CONSENT,value);active=value==='granted'&&navigator.globalPrivacyControl!==true;document.getElementById('mlPrivacyBanner')?.remove();if(active){window['ga-disable-'+GA]=false;if(loaded){gtag('consent','update',{analytics_storage:'granted'});window.clarity?.('consentv2',{ad_Storage:'denied',analytics_Storage:'granted'});window.clarity?.('start');}else load();}else if(loaded){window['ga-disable-'+GA]=true;gtag('consent','update',{analytics_storage:'denied',ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied'});window.clarity?.('consentv2',{ad_Storage:'denied',analytics_Storage:'denied'});window.clarity?.('stop');}}
  function preferences(){document.getElementById('mlPrivacyBanner')?.remove();const box=document.createElement('aside');box.id='mlPrivacyBanner';box.setAttribute('aria-label','Analytics preferences');const p=document.createElement('p');p.textContent='May we use Google Analytics and Microsoft Clarity to understand visits and improve this site? Form details and property photos are protected. Your choice does not affect your quote.';box.append(p);for(const [label,value] of [['Allow analytics','granted'],['No thanks','denied']]){const b=document.createElement('button');b.type='button';b.textContent=label;b.onclick=()=>choose(value);box.append(b)}const a=document.createElement('a');a.href='/privacy';a.textContent='Privacy policy';box.append(a);document.body.append(box);}
  window.MLAnalytics={attribution,preferences,lead(id,form){if(typeof id!=='string'||!id||conversions.has(id))return;let sent=read('mlLeadEventsV1')||[];if(!Array.isArray(sent))sent=[];if(sent.includes(id))return;conversions.add(id);if(active){track('generate_lead',form);write('mlLeadEventsV1',[...sent,id].slice(-100));}},track};
  function start(){
    // Explicit masking is inherited by dynamically added descendants, including photos.
    document.querySelectorAll('form,#photoPreview,#pics,.picwrap,#directions,.compare,#formStatus,#quoteStatus,#contactStatus,#photoStatus').forEach(e=>e.setAttribute('data-clarity-mask','true'));
    document.addEventListener('input',e=>{const form=e.target.closest?.('#quoteForm,#contactForm');if(!form)return;const kind=page==='/visualizer/'?'visualizer':'homepage';if(started.has(kind))return;started.add(kind);track('quote_form_start',kind);},{capture:true});
    document.addEventListener('click',e=>{const a=e.target.closest?.('a[href]');if(!a)return;const u=new URL(a.href,location.href);if(u.origin===location.origin&&(u.hash==='#quote'||u.pathname==='/visualizer/'))track('quote_cta_click',u.pathname==='/visualizer/'?'visualizer':'homepage');});
    const button=document.createElement('button');button.type='button';button.id='mlPrivacySettings';button.textContent='Analytics preferences';button.onclick=preferences;document.body.append(button);
    const preference=read(CONSENT);if(preference==='granted'&&navigator.globalPrivacyControl!==true){active=true;load()}else if(preference!=='denied'&&navigator.globalPrivacyControl!==true)preferences();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
})();
