// Run: node tests/visualizer-flow.spec.cjs (PLAYWRIGHT_MODULE / BROWSER_PATH optional).
// All external requests are blocked. No production sessions, uploads, renders or leads.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),out=process.env.QA_OUTPUT||path.join(__dirname,'visualizer-qa');
const directions=require('../visualizer/directions.js');
let count=0;function check(value,message){assert(value,message);count++;}
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.BROWSER_PATH?{executablePath:process.env.BROWSER_PATH}:{channel:'chrome'})});
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[],external=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',async route=>{
   const u=new URL(route.request().url());
   if(u.hostname==='localhost'){
     const file=path.join(root,u.pathname.endsWith('/')?u.pathname+'index.html':u.pathname);
     if(!fs.existsSync(file))return route.fulfill({status:404,body:'Not found'});
     return route.fulfill({contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html',body:fs.readFileSync(file)});
   }
   if(u.hostname==='cdn.jsdelivr.net')return route.fulfill({contentType:'text/javascript',body:'window.supabase={createClient:()=>{throw Error("Live client must never be used in preview")}};'});
   external.push(u.href);return route.abort();
 });
 const open=async()=>{await page.goto('http://localhost/visualizer/');await page.waitForFunction(()=>typeof ready!=='undefined'&&ready)};
 const mode=async m=>{await page.locator('[data-mode="'+m+'"]').click();await page.evaluate(()=>saveChain)};
 const A='design_it_for_me',B='design_my_home';
 await open();await Promise.all([page.waitForNavigation(),page.getByRole('button',{name:'Load example home'}).click()]);await page.waitForFunction(()=>typeof ready!=='undefined'&&ready);
 check(await page.locator('#modeStep h2').textContent()==='WHO SHOULD DESIGN YOUR HOME?','Exact heading');
 check(await page.locator('[data-mode="'+A+'"] strong').textContent()==='MACEDA DESIGNS IT FOR ME','Exact A title');
 check(await page.locator('[data-mode="'+B+'"] strong').textContent()==="I'LL DESIGN IT MYSELF",'Exact B title');
 const original=await page.evaluate(()=>({contact:S.s.contact_profile,photo:S.s.front_url,zones:S.s.install_zones}));
 await mode(A);check(await page.locator('#directionsStep').isVisible(),'A shows concepts');check(!await page.locator('#designStep').isVisible(),'A hides builder');check(await page.locator('.direction').count()===3,'Three distinct directions');
 check(await page.locator('.direction svg').count()===3,'Concept outlines reused');
 fs.mkdirSync(out,{recursive:true});await page.screenshot({path:path.join(out,'directions-desktop.png'),fullPage:true});
 await page.locator('.direction').nth(1).click();check(await page.locator('#render').isDisabled(),'Explicit color required');check(await page.locator('[data-diy]:visible').count()===0,'Maceda hides DIY controls');
 await page.locator('#colors [data-v="Red + White"]').click();check(await page.locator('#render').isEnabled(),'Color enables render');
 await mode(B);check(await page.locator('#designStep').isVisible(),'B shows builder');check(await page.locator('[data-diy]:visible').count()===3,'DIY retains all controls');
 await page.locator('#zones [data-v="windows"]').click();await mode(A);
 check(await page.locator('#directionsStep').isVisible(),'B-A returns to concepts');check(await page.evaluate(()=>S.zones.length===0&&!directionChosen&&!colorChosen),'B-A clears design');
 await mode(B);check(await page.locator('#designStep').isVisible(),'A-B-A-B ends in DIY');
 check(JSON.stringify(await page.evaluate(()=>({contact:S.s.contact_profile,photo:S.s.front_url,zones:S.s.install_zones})))===JSON.stringify(original),'Contact/photo/analysis preserved');
 await page.evaluate(()=>{MacedaPreview.delay=150});
 await page.locator('[data-mode="'+A+'"]').click();await page.locator('[data-mode="'+B+'"]').click();await page.locator('[data-mode="'+A+'"]').click();await page.evaluate(()=>saveChain);
 check(await page.evaluate(()=>MacedaPreview.getState().mode===S.mode&&S.mode==='design_it_for_me'&&MacedaPreview.getState().selected_zones.length===0),'Rapid switching last mode wins');
 await page.evaluate(()=>{MacedaPreview.delay=0});await page.reload();await page.waitForFunction(()=>typeof ready!=='undefined'&&ready);
 check(await page.locator('#directionsStep').isVisible(),'Refresh preserves unselected Maceda stage');
 await page.locator('.direction').first().click();await page.goBack();check(await page.locator('#directionsStep').isVisible(),'Back returns to directions');await page.goForward();check(await page.locator('#designStep').isVisible(),'Forward returns to colors');
 await page.locator('#colors [data-v="Multicolor"]').click();await page.evaluate(()=>{clearTimeout(saveTimer);return queueSave()});
 await page.reload();await page.waitForFunction(()=>typeof ready!=='undefined'&&ready);check(await page.locator('#designStep').isVisible(),'Refresh restores selected direction');check(await page.evaluate(()=>S.color==='Multicolor'&&colorChosen),'Refresh restores chosen color');
 await page.locator('#render').click();await page.locator('#finalStep').waitFor({state:'visible'});
 check(await page.locator('#selectionSummary').textContent().then(s=>s.includes('Multicolor')&&s.includes('Minimal Modern')),'Final summary exact direction/color');
 check(await page.evaluate(()=>MacedaPreview.requests.filter(x=>x.action==='start_render').length===1),'One render for chosen direction');
 check(await page.evaluate(()=>signature(MacedaPreview.getState())===signature()),'Render uses saved selection');
 await page.locator('#sms').check();await page.locator('#quoteSubmit').click();await page.locator('.success').waitFor();check(await page.evaluate(()=>MacedaPreview.requests.some(x=>x.action==='create_quote'&&x.sms_opt_in===true)),'Existing quote payload and consent');
 // Start a clean review session after the completed quote.
 await Promise.all([page.waitForNavigation(),page.getByRole('button',{name:'Load example home'}).click()]);await page.waitForFunction(()=>typeof ready!=='undefined'&&ready);await mode(A);
 await page.locator('.direction').first().click();await page.locator('#colors [data-v="Warm White"]').click();
 await page.evaluate(()=>{MacedaPreview.failAction='save_design'});await page.locator('#render').click();await page.waitForFunction(()=>!S.busy);
 check(!await page.locator('#finalStep').isVisible(),'Save failure blocks preview');check(await page.evaluate(()=>!MacedaPreview.requests.some(x=>x.action==='start_render')),'No render after failed save');
 await page.evaluate(()=>{MacedaPreview.failAction=null});await mode(B);await page.goBack();check(!await page.locator('#directionsStep').isVisible(),'History cannot resurrect old mode');check(await page.evaluate(()=>S.mode==='design_my_home'),'History preserves active mode');
 // Old opposite-mode draft must not override a current session.
 await page.evaluate(()=>{localStorage.setItem('mlVizDraft',JSON.stringify({id:S.id,mode:'design_it_for_me',preset:'Griswold',color:'Multicolor',zones:['pathway'],decor:[],placements:[],time:Date.now()+5000}));});
 await page.reload();await page.waitForFunction(()=>typeof ready!=='undefined'&&ready);check(await page.evaluate(()=>S.mode==='design_my_home'&&S.preset!=='Griswold'),'Legacy cross-mode draft rejected');
 // Missing and uncertain features cannot produce invented layouts.
 await page.evaluate(()=>{const s=MacedaPreview.getState();s.install_zones=[MacedaPreview.zones[0],{id:'trees',confidence:.2,bbox:[.1,.1,.2,.2]}];s.mode=null;s.selected_zones=[];s.render=null;MacedaPreview.setState(s);localStorage.removeItem('mlVizDraft');localStorage.removeItem('mlVizJourney');});
 await page.reload();await page.waitForFunction(()=>typeof ready!=='undefined'&&ready);await mode(A);check(await page.locator('.direction').count()===1,'Single-feature home shows one distinct layout');check(!await page.locator('#directions').textContent().then(s=>s.includes('Trees')),'Low-confidence tree excluded');
 await page.evaluate(()=>{const s=MacedaPreview.getState();s.install_zones=[{id:'main_roofline',confidence:.1,polyline:[[.1,.1],[.2,.2]]}];s.mode=null;MacedaPreview.setState(s);});
 await page.reload();await page.waitForFunction(()=>typeof ready!=='undefined'&&ready);await mode(A);check(await page.locator('.direction').count()===0,'Uncertain home has no fabricated directions');check(await page.locator('#directionNotice').textContent().then(s=>s.includes('clearer photo')),'Clear-photo recovery message');
 await Promise.all([page.waitForNavigation(),page.getByRole('button',{name:'Load example home'}).click()]);await page.waitForFunction(()=>typeof ready!=='undefined'&&ready);await mode(A);
 // Interrupted mode saves recover locally without bringing back previous selections.
 await page.evaluate(()=>{MacedaPreview.failAction='save_design'});await page.locator('[data-mode="'+B+'"]').click();await page.evaluate(()=>saveChain.catch(()=>{}));
 check(await page.evaluate(()=>JSON.parse(localStorage.getItem('mlVizDraft')).mode==='design_my_home'),'Failed switch retains local draft');
 await page.reload();await page.waitForFunction(()=>typeof ready!=='undefined'&&ready);check(await page.evaluate(()=>S.mode==='design_my_home'&&MacedaPreview.getState().mode===S.mode),'Refresh retries interrupted mode save');
 await mode(A);await page.getByRole('button',{name:'Edit details or photos'}).first().click();
 await page.locator('#cName').fill('Updated Sample');await page.locator('#contactSubmit').click();await page.waitForFunction(()=>!document.querySelector('#contactSubmit').disabled);
 const png=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=900;c.height=600;const p=c.getContext('2d');p.fillStyle='#ccb899';p.fillRect(0,0,900,600);return c.toDataURL('image/png').split(',')[1]});
 await page.locator('#front').setInputFiles({name:'review-home.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
 await page.evaluate(()=>{MacedaPreview.delay=80});await page.locator('#analyze').click();check(await page.locator('[data-mode="'+B+'"]').isDisabled(),'Mode locked during photo processing');
 await page.locator('#directionsStep').waitFor({state:'visible'});await page.evaluate(()=>{MacedaPreview.delay=0});
 check(await page.evaluate(()=>S.s.front_url.startsWith('data:image/jpeg')&&S.s.contact_profile.name==='Updated Sample'),'Upload normalization and contact save preserved');
 const photo=await page.evaluate(()=>S.s.front_url);await mode(B);await mode(A);check(await page.evaluate(()=>S.s.front_url)===photo,'Uploaded image survives A-B-A');
 await Promise.all([page.waitForNavigation(),page.getByRole('button',{name:'Load example home'}).click()]);await page.waitForFunction(()=>typeof ready!=='undefined'&&ready);await mode(A);
 for(const width of [360,390,768,1440]){await page.setViewportSize({width,height:900});await page.evaluate(()=>window.scrollTo(0,0));check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No horizontal overflow at '+width);await page.screenshot({path:path.join(out,'directions-'+width+'.png'),fullPage:true});}
 // Functions owned by Kevin and upload/quote behavior must be preserved.
 const baseline=process.env.VISUALIZER_BASE_REF||'ca1b84dd35cdb87184983c9b8006f83ca1033df5';
 const cp=require('node:child_process'),before=cp.execFileSync('git',['show',baseline+':visualizer/visualizer.js'],{cwd:root,encoding:'utf8'}),after=fs.readFileSync(path.join(root,'visualizer/visualizer.js'),'utf8');
 for(const prefix of ['function draw(){','function svgEl(','function colors(){','async function upload(','function files(){',"$('quoteForm').onsubmit=", "$('contactForm').onsubmit="]){check(before.split(/\r?\n/).find(l=>l.startsWith(prefix))===after.split(/\r?\n/).find(l=>l.startsWith(prefix)),'Preserved '+prefix);}
 const oldHtml=cp.execFileSync('git',['show',baseline+':visualizer/index.html'],{cwd:root,encoding:'utf8'}),newHtml=fs.readFileSync(path.join(root,'visualizer/index.html'),'utf8');
 check(oldHtml.match(/<label class="consent">.*?<\/label>/)[0]===newHtml.match(/<label class="consent">.*?<\/label>/)[0],'SMS consent unchanged');
 check(!directions.usable({confidence:.9,polyline:[[.1,.1],[.1,.1]]}),'Degenerate geometry rejected');
 check(external.length===0,'No external requests');check(errors.length===0,'No browser errors: '+errors.join('; '));
 await browser.close();console.log(JSON.stringify({passed:count,externalRequests:external.length,browserErrors:errors,screenshots:out},null,2));
})().catch(e=>{console.error(e);process.exit(1)});
