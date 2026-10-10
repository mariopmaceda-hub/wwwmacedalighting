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
