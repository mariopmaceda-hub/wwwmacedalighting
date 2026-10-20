// Browser behavior only: fixture images are placeholders, not evidence of AI quality.
// All requests stay on local fixtures; no production sessions or quotes are created.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
let checks=0;const check=(value,message)=>{assert(value,message);checks++;};
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'chrome'});
 try{
  const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage(),errors=[],external=[];
  page.on('pageerror',e=>errors.push(e.message));
  await context.route('**/*',route=>{
   const u=new URL(route.request().url());
   if(u.hostname==='localhost'){
    const file=path.resolve(root,'.'+(u.pathname.endsWith('/')?u.pathname+'index.html':u.pathname));
    if(!file.startsWith(root+path.sep)||!fs.existsSync(file))return route.fulfill({status:404,body:'Not found'});
    return route.fulfill({contentType:/\.m?js$/.test(file)?'text/javascript':file.endsWith('.css')?'text/css':'text/html',body:fs.readFileSync(file)});
   }
   if(u.hostname==='cdn.jsdelivr.net')return route.fulfill({contentType:'text/javascript',body:'window.supabase={createClient:()=>{throw Error("Production client blocked")}}'});
   external.push(u.href);return route.abort();
  });
  await page.goto('http://localhost/visualizer/');
  await page.waitForFunction(()=>typeof ready!=='undefined'&&ready&&window.MacedaConceptEditor);
  await Promise.all([page.waitForNavigation(),page.getByRole('button',{name:'Load example home'}).click()]);
  await page.waitForFunction(()=>ready&&window.MacedaConceptEditor);
  await page.locator('[data-mode="design_my_home"]').click();
  await page.evaluate(async()=>{clearTimeout(saveTimer);await queueSave();await get();});
  check(await page.locator('#render').textContent()==='CREATE MY NIGHT PREVIEW','Night action is explicit');
  check(await page.locator('#finalStep').textContent().then(t=>t.includes('AI-generated night concept')),'Final result discloses AI concept');

  // Hold the continue request open: a slow provider must not create overlapping requests.
  await page.evaluate(()=>{
   window.nightFixtureFetch=window.fetch;window.nightContinues=0;
   window.fetch=async(input,options={})=>{
    const b=JSON.parse(options.body||'{}');
    if(b.action==='continue_render'){
     window.nightContinues++;
     return new Promise(resolve=>{window.finishNightContinue=()=>resolve(new Response(JSON.stringify({ok:true}),{headers:{'content-type':'application/json'}}));});
    }
    return window.nightFixtureFetch(input,options);
   };
  });
  for(const renderStage of ['queued','generating','accuracy_check']){
   const result=await page.evaluate(async stage=>{
    const s=MacedaPreview.getState();s.render={id:'night-fixture',stage};MacedaPreview.setState(s);lock(true);
    const before=window.nightContinues;
    await pollRender();clearTimeout(pollTimer);await pollRender();clearTimeout(pollTimer);
    const result={requests:window.nightContinues-before,busy:S.busy,continuing:S.continuing,message:document.querySelector('#renderStatus').textContent,final:document.querySelector('#finalStep').classList.contains('hidden')};
    window.finishNightContinue();await new Promise(resolve=>setTimeout(resolve,0));
    return result;
   },renderStage);
   check(result.requests===1,renderStage+' resumes once and prevents duplicate in-flight work');
   check(result.busy&&result.continuing&&result.final,renderStage+' waits without showing a completed result');
   check(result.message.includes(renderStage==='accuracy_check'?'Checking the preview':'Rendering realistic lights at night'),renderStage+' shows accurate progress');
  }
  await page.evaluate(()=>{window.fetch=window.nightFixtureFetch;});
  await page.evaluate(async()=>{
   const s=MacedaPreview.getState();s.render={id:'night-fixture',stage:'failed'};MacedaPreview.setState(s);
   await pollRender();clearTimeout(pollTimer);
  });
  check(await page.evaluate(()=>!S.busy&&document.querySelector('#finalStep').classList.contains('hidden')),'Failed job restores editing without claiming success');
  check(await page.locator('#renderStatus').textContent().then(t=>t.includes('Your design is saved')),'Failed job explains saved-design recovery');

  await page.evaluate(async()=>{
   const s=MacedaPreview.getState();s.status='render_ready';s.render={id:'wrong-design',stage:'ready',image_url:s.front_url,design_spec:{...s,color_style:'Multicolor'}};MacedaPreview.setState(s);lock(true);
   await pollRender();clearTimeout(pollTimer);
  });
  check(await page.locator('#renderStatus').textContent().then(t=>t.includes('earlier design')),'Ready result from a different saved design is rejected');
  check(!await page.locator('#finalStep').isVisible(),'Rejected result stays out of final step');

  // Refresh during every active phase must reconnect to the job in both customer journeys.
  for(const mode of ['design_my_home','design_it_for_me']){
   await page.evaluate(async selectedMode=>{
    lock(false);selectMode(selectedMode,false);await saveChain;
    if(selectedMode==='design_it_for_me'){
     document.querySelector('.direction').click();document.querySelector('#colors [data-v="Warm White"]').click();
    }
    clearTimeout(saveTimer);await queueSave();await get();
   },mode);
   for(const renderStage of ['queued','generating','accuracy_check']){
    await page.evaluate(stage=>{
     const s=MacedaPreview.getState();s.render={id:'resume-fixture',stage};MacedaPreview.setState(s);
    },renderStage);
    await page.reload();await page.waitForFunction(()=>ready&&window.MacedaConceptEditor);
    await page.locator('#finalStep').waitFor({state:'visible'});
    check(await page.evaluate(()=>MacedaPreview.requests.filter(r=>r.action==='continue_render').length===1),mode+' resumes '+renderStage+' after refresh');
    check(await page.evaluate(()=>S.color==='Warm White'&&S.mode===MacedaPreview.getState().mode),mode+' retains saved choice while resuming '+renderStage);
   }
  }
  // A completed image is not quotable until the corresponding session transition succeeds.
  await page.evaluate(()=>{
   const s=MacedaPreview.getState();s.status='rendering';s.render={id:'ready-before-session',stage:'ready',image_url:s.front_url,design_spec:{...s,render:null,renderer:'ai-night-v1'}};MacedaPreview.setState(s);
  });
  await page.reload();await page.waitForFunction(()=>ready&&window.MacedaConceptEditor);
  await page.locator('#finalStep').waitFor({state:'visible'});
  check(await page.evaluate(()=>MacedaPreview.requests.filter(r=>r.action==='continue_render').length===1),'Reload repairs session transition before showing ready result');
  check(await page.evaluate(()=>S.s.status==='render_ready'),'Repaired ready result has quotable session state');
  check(await page.locator('#finalStep .head p').textContent().then(t=>t.includes('AI-generated night concept')),'AI result has the correct result label');
  check(await page.locator('#previewWarnings').textContent().then(t=>t.includes('AI lighting and exposure may vary')),'AI concept explains visual uncertainty');
  // A completed render is not proof that its image URL can be loaded.
  for(const width of [390,1440])for(const mode of ['design_my_home','design_it_for_me']){
   await page.setViewportSize({width,height:900});
   await page.evaluate(async mode=>{
    lock(false);selectMode(mode,false);await saveChain;
    if(mode==='design_it_for_me'){document.querySelector('.direction').click();document.querySelector('#colors [data-v="Warm White"]').click();}
    clearTimeout(saveTimer);await queueSave();await get();
    const s=MacedaPreview.getState();s.status='render_ready';s.render={id:'broken-image',stage:'ready',image_url:'data:image/png;base64,broken',design_spec:{...s,render:null,renderer:'ai-night-v1'}};MacedaPreview.setState(s);
    await pollRender();clearTimeout(pollTimer);
   },mode);
   await page.locator('#retryPreviewImage').waitFor({state:'visible'});
   check(await page.locator('#previewImageStatus').textContent().then(t=>t.includes('could not load')),mode+' '+width+' explains broken image');
   if(process.env.QA_OUTPUT&&mode==='design_my_home'){fs.mkdirSync(process.env.QA_OUTPUT,{recursive:true});await page.screenshot({path:path.join(process.env.QA_OUTPUT,'preview-image-recovery-'+width+'.png'),fullPage:true});}
   await page.reload();await page.waitForFunction(()=>ready&&window.MacedaConceptEditor);
   await page.locator('#retryPreviewImage').waitFor({state:'visible'});
   check(await page.locator('#previewImageStatus').isVisible(),mode+' '+width+' handles broken restored image');
   const before=await page.evaluate(()=>({signature:signature(),requests:MacedaPreview.requests.length}));
   await page.evaluate(()=>{const s=MacedaPreview.getState();s.render.image_url=s.front_url;MacedaPreview.setState(s);});
   await page.locator('#retryPreviewImage').click();
   await page.waitForFunction(()=>document.querySelector('#renderFinal').naturalWidth>0&&document.querySelector('#previewImageStatus').classList.contains('hidden'));
   check(await page.evaluate(()=>signature())===before.signature,mode+' '+width+' recovery preserves design');
   check(await page.evaluate(n=>MacedaPreview.requests.slice(n).every(r=>!['start_render','continue_render','create_quote','save_design','save_contact'].includes(r.action)),before.requests),mode+' '+width+' retry performs no generation or writes');
   check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),mode+' '+width+' has no horizontal overflow');
  }
  // Ready jobs can lack a URL when storage signing fails. This is delivery recovery, not regeneration.
  for(const width of [390,1440])for(const mode of ['design_my_home','design_it_for_me']){
   await page.setViewportSize({width,height:900});
   const before=await page.evaluate(async mode=>{
    lock(false);selectMode(mode,false);await saveChain;
    if(mode==='design_it_for_me'){document.querySelector('.direction').click();document.querySelector('#colors [data-v="Warm White"]').click();}
    clearTimeout(saveTimer);await queueSave();await get();
    const s=MacedaPreview.getState();s.status='render_ready';s.render={id:'missing-url',stage:'ready',image_url:null,design_spec:{...s,render:null,renderer:'ai-night-v1'}};MacedaPreview.setState(s);
    const saved={signature:signature(),state:JSON.stringify(MacedaPreview.getState()),requests:MacedaPreview.requests.length};
    lock(true);const original=setTimeout;window.pollSchedules=[];window.setTimeout=(fn,delay)=>{window.pollSchedules.push(delay);return 0;};
    try{await pollRender();}finally{window.setTimeout=original;}
    return saved;
   },mode);
   const label=mode+' '+width;
   check(await page.locator('#finalStep').isVisible(),label+' missing URL retains saved preview stage');
   check(await page.locator('#previewImageStatus').textContent().then(t=>t.includes('could not load')&&t.includes('design is saved')),label+' missing URL is explained');
   check(await page.evaluate(()=>!S.busy&&pollSchedules.length===0),label+' missing URL stops busy state and automatic polling');
   check(await page.locator('#renderFinal').getAttribute('src')===null,label+' missing URL clears any stale image');
   check(await page.evaluate(saved=>signature()===saved.signature&&JSON.stringify(MacedaPreview.getState())===saved.state,before),label+' missing URL preserves saved data');
   await page.locator('#retryPreviewImage').click();
   check(await page.locator('#retryPreviewImage').isVisible()&&!await page.locator('#retryPreviewImage').isDisabled(),label+' continued signing failure remains retryable');
   check(await page.evaluate(n=>MacedaPreview.requests.slice(n).length===2&&MacedaPreview.requests.slice(n).every(r=>Object.keys(r).length===0),before.requests),label+' polling and retry only read status');
   await page.reload();await page.waitForFunction(()=>ready&&window.MacedaConceptEditor);
   check(await page.locator('#finalStep').isVisible()&&await page.locator('#retryPreviewImage').isVisible(),label+' refresh restores missing-URL recovery');
   check(await page.evaluate(()=>!S.busy&&MacedaPreview.requests.every(r=>!r.action)),label+' refresh creates no generation or writes');
   if(process.env.QA_OUTPUT&&mode==='design_my_home')await page.screenshot({path:path.join(process.env.QA_OUTPUT,'preview-missing-url-'+width+'.png'),fullPage:true});
   const requestCount=await page.evaluate(()=>MacedaPreview.requests.length);
   await page.evaluate(()=>{const s=MacedaPreview.getState();s.render.image_url=s.front_url;MacedaPreview.setState(s);});
   await page.locator('#retryPreviewImage').click();
   await page.waitForFunction(()=>document.querySelector('#renderFinal').naturalWidth>0&&document.querySelector('#previewImageStatus').classList.contains('hidden'));
   check(!await page.locator('#retryPreviewImage').isVisible(),label+' valid URL clears recovery controls');
   check(await page.evaluate(n=>MacedaPreview.requests.slice(n).length===1&&Object.keys(MacedaPreview.requests[n]).length===0,requestCount),label+' successful retry is exactly one status read');
   check(await page.evaluate(()=>signature())===before.signature,label+' successful retry retains design');
   await page.reload();await page.waitForFunction(()=>ready&&window.MacedaConceptEditor&&document.querySelector('#renderFinal').naturalWidth>0);
   check(await page.locator('#finalStep').isVisible()&&!await page.locator('#previewImageStatus').isVisible()&&!await page.locator('#retryPreviewImage').isVisible(),label+' normal ready restoration remains unchanged');
   check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),label+' recovery layout fits viewport');
  }
  const savedSignature=await page.evaluate(()=>signature());
  await page.evaluate(()=>{
   const s=MacedaPreview.getState();s.status='render_ready';s.render={id:'legacy-layout',stage:'ready',image_url:s.front_url,design_spec:{...s,render:null,renderer:'deterministic-v1'}};MacedaPreview.setState(s);
  });
  await page.reload();await page.waitForFunction(()=>ready&&window.MacedaConceptEditor);
  check(!await page.locator('#finalStep').isVisible(),'Legacy daytime layout does not auto-open as new night result');
  check(await page.locator('#renderStatus').textContent().then(t=>t.includes('Create a new night preview')),'Legacy saved layout offers explicit night regeneration');
  check(await page.evaluate(()=>signature())===savedSignature,'Legacy rendering upgrade preserves saved choices');
  check(await page.evaluate(()=>MacedaPreview.requests.every(r=>!['start_render','continue_render'].includes(r.action))),'Legacy layout does not incur automatic generation');
  await page.evaluate(()=>{const s=MacedaPreview.getState();s.status='converted_to_quote';MacedaPreview.setState(s);});
  await page.reload();await page.waitForFunction(()=>ready&&window.MacedaConceptEditor);
  check(await page.locator('#finalStep').isVisible(),'Previously quoted layout remains accessible');
  check(await page.locator('#finalStep .head p').textContent().then(t=>t.includes('saved lighting layout')&&!t.includes('AI-generated')),'Legacy quoted result is labeled accurately');
  check(external.length===0,'No external requests');check(errors.length===0,'No browser errors: '+errors.join('; '));
  console.log(JSON.stringify({checks,externalRequests:external.length,browserErrors:errors,scope:'Isolated UI behavior; no live AI calls'},null,2));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
