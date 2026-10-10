// Run with PLAYWRIGHT_MODULE; optional QA_PHOTO points to an owner-provided local photo.
// Loopback fixture only. All external requests are blocked; no production writes.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),out=process.env.QA_OUTPUT||path.join(root,'tests/visualizer-qa');
let checks=0;const check=(v,msg)=>{assert(v,msg);checks++;};
(async()=>{
 const fixture=fs.readFileSync(path.join(root,'visualizer/preview-fixture.js'),'utf8');
 for(const hostname of ['wwwmacedalighting.netlify.app','macedalighting.com','unrelated.example']){
   const scope={location:{hostname}};vm.runInNewContext(fixture,scope);check(!scope.MacedaPreview,'No simulated success on '+hostname);
 }
 const server=http.createServer((req,res)=>{
   const pathname=new URL(req.url,'http://localhost').pathname;
   const file=pathname==='/test-photo.jpg'&&process.env.QA_PHOTO?process.env.QA_PHOTO:path.resolve(root,'.'+(pathname.endsWith('/')?pathname+'index.html':pathname));
   if((pathname!=='/test-photo.jpg'&&!file.startsWith(root+path.sep))||!fs.existsSync(file)){res.writeHead(404);res.end();return;}
   const mime=/\.m?js$/.test(file)?'text/javascript':file.endsWith('.css')?'text/css':/\.jpg$/i.test(file)?'image/jpeg':'text/html';
   res.writeHead(200,{'content-type':mime});res.end(fs.readFileSync(file));
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({headless:true,channel:process.env.BROWSER_CHANNEL||'chrome'});
 try{
 const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage(),errors=[],external=[];
 await context.addInitScript(()=>localStorage.setItem('mlAnalyticsConsentV1',JSON.stringify('denied')));
 page.on('pageerror',e=>errors.push(e.message));
 await context.route('**/*',route=>{
   const u=new URL(route.request().url());
   if(['localhost','127.0.0.1'].includes(u.hostname))return route.continue();
   if(u.hostname==='cdn.jsdelivr.net')return route.fulfill({contentType:'text/javascript',body:'window.supabase={createClient:()=>{throw Error("Production client blocked")}}'});
   external.push(u.hostname);return route.abort();
 });
 await page.goto('http://localhost:'+server.address().port+'/visualizer/');
 await page.waitForFunction(()=>typeof ready!=='undefined'&&ready&&window.MacedaConceptEditor);
 await Promise.all([page.waitForNavigation(),page.getByRole('button',{name:'Load example home'}).click()]);
 await page.waitForFunction(()=>ready&&window.MacedaConceptEditor);
 await page.locator('[data-mode="design_my_home"]').click();
 await page.waitForFunction(()=>document.querySelector('#editorPreviewStatus').textContent.includes('Layout guide only'));
 const original=await page.evaluate(()=>JSON.stringify(S.s.install_zones));
 const initial=await page.evaluate(()=>signature());
 await page.locator('[data-zone="main_roofline"]').focus();await page.keyboard.press('Enter');
 check(await page.evaluate(()=>!S.zones.includes('main_roofline')),'Keyboard toggles a detected run');
 await page.locator('#editorUndo').click();check(await page.evaluate(()=>signature())===initial,'Undo restores exact saved design signature');
 await page.locator('#editorRedo').click();check(await page.evaluate(()=>!S.zones.includes('main_roofline')),'Redo reapplies selection');
 await page.locator('#editorUndo').click();
 const beforeTap=await page.evaluate(()=>S.zones.includes('main_roofline'));
 await page.locator('.editor-surface').scrollIntoViewIfNeeded();
 const tap=await page.locator('[data-zone="main_roofline"]').evaluate(e=>{const p=e.ownerSVGElement.createSVGPoint();p.x=300;p.y=196;const q=p.matrixTransform(e.getScreenCTM());return {x:q.x,y:q.y};});
 await page.mouse.click(tap.x,tap.y);
 check(await page.evaluate(()=>S.zones.includes('main_roofline'))!==beforeTap,'Pointer tap toggles the roofline');
 await page.locator('#editorUndo').click();
 await page.getByRole('button',{name:'Colors',exact:true}).click();
 await page.locator('#colors [data-v="Red + White"]').click();
 await page.locator('#editorUndo').click();check(await page.evaluate(()=>S.color==='Warm White'),'Undo covers colors');
 await page.locator('#editorRedo').click();check(await page.evaluate(()=>S.color==='Red + White'),'Redo covers colors');
 await page.locator('#editorCompare').click();check(await page.locator('.editor-surface').evaluate(e=>e.classList.contains('editor-original')),'Compare shows original');
 await page.locator('#editorCompare').click();
 await page.locator('#editorZoomIn').click();check(await page.locator('.picwrap').evaluate(e=>e.style.width==='150%'),'Zoom enlarges shared photo and overlays');
 await page.locator('#editorFit').click();
 await page.getByRole('button',{name:'Lights',exact:true}).click();
 await page.locator('#zones [data-v="windows"]').click();
 check(await page.evaluate(()=>JSON.stringify(S.s.install_zones))===original,'Edits never mutate detector evidence');
 // Confidence >1 and invalid secondary geometry must not sneak past the v1 contract.
 await page.evaluate(()=>{
   S.s.install_zones.push({id:'trees',confidence:.2,bbox:[.1,.1,.2,.2]},{id:'tree_1',confidence:1.2,bbox:[.1,.1,.2,.2]},{id:'tree_2',confidence:.9,polyline:[[.1,.1],[.2,.2]],bbox:[.9,.9,.2,.2]});build();preset('Griswold');
 });
 check(await page.evaluate(()=>!S.zones.some(x=>x.startsWith('tree'))),'Presets exclude all unsupported zones');
 for(const id of ['trees','tree_1','tree_2'])check(await page.locator('#zones [data-v="'+id+'"]').isDisabled(),'Unsupported zone disabled '+id);
 // The final API call must remain blocked even if an invalid selection is injected.
 await page.evaluate(()=>{S.zones.push('trees');});
 const renders=await page.evaluate(()=>MacedaPreview.requests.filter(x=>x.action==='start_render').length);
 await page.evaluate(()=>document.querySelector('#render').onclick());
 check(await page.evaluate(()=>MacedaPreview.requests.filter(x=>x.action==='start_render').length)===renders,'Contract failure blocks render request');
 await page.evaluate(()=>{preset('Classic Christmas');});
 await page.getByRole('button',{name:'Decor',exact:true}).click();
 await page.locator('#decor [data-v="Wreath"]').click();
 await page.locator('#editorUndo').click();check(await page.evaluate(()=>S.decor.includes('Wreath')),'Undo restores decoration and placement');
 // Optional real photograph exercises decode and original pixels, not AI detection.
 if(process.env.QA_PHOTO){
   await page.evaluate(()=>{
     S.s.front_url='/test-photo.jpg';S.s.source_photo_path='TEST/owner-photo.jpg';
     S.s.install_zones=[{id:'main_roofline',confidence:.95,visible:true,polyline:[[.266,.393],[.46,.395],[.521,.421],[.835,.421]],occlusion_masks:[]}];
     S.zones=['main_roofline'];S.decor=[];S.placements=[];document.querySelector('#house').src=S.s.front_url;build();changed();
   });
 }
 await page.waitForFunction(()=>document.querySelector('#editorPreviewStatus').textContent.includes('Layout guide only'));
 const parity=await page.evaluate(async()=>{
   const {compositeRGBA}=await import('/supabase/functions/_shared/compositor.mjs');
   const img=document.querySelector('#house'),c=document.createElement('canvas');c.width=img.naturalWidth;c.height=img.naturalHeight;
   const ctx=c.getContext('2d',{willReadFrequently:true});ctx.drawImage(img,0,0);
   const source=ctx.getImageData(0,0,c.width,c.height).data;
   const expected=compositeRGBA(new Uint8Array(source),c.width,c.height,{...S.s,color_style:S.color,selected_zones:S.zones,selections:{placements:S.placements},catalog:S.catalog});
   const actual=document.querySelector('.editor-paint').getContext('2d').getImageData(0,0,c.width,c.height).data;
   let differences=0,untouchedDifferences=0;
   for(let i=0;i<actual.length;i++){if(actual[i]!==expected.pixels[i])differences++;if(!expected.touched[Math.floor(i/4)]&&actual[i]!==source[i])untouchedDifferences++;}
   return {differences,untouchedDifferences,width:c.width,height:c.height};
 });
 check(parity.differences===0,'Worker view equals server compositor pixels: '+JSON.stringify(parity));check(parity.untouchedDifferences===0,'Original pixels outside overlay unchanged');
 fs.mkdirSync(out,{recursive:true});
 for(const width of [360,390,768,1440]){
   await page.setViewportSize({width,height:900});
   await page.locator('#designStep').scrollIntoViewIfNeeded();
   check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No overflow at '+width);
   const targets=await page.locator('.editor-toolbar button,.editor-tabs button').evaluateAll(all=>all.filter(e=>e.getClientRects().length).every(e=>e.getBoundingClientRect().height>=44));
   check(targets,'Toolbar targets at least 44px at '+width);
   await page.screenshot({path:path.join(out,'editor-'+width+'.png'),fullPage:true});
 }
 // Saved selections survive a reload, and a mode switch clears the undo boundary.
 await page.evaluate(()=>{clearTimeout(saveTimer);return queueSave();});
 const saved=await page.evaluate(()=>[S.color,S.zones,S.decor]);
 await page.reload();await page.waitForFunction(()=>ready&&window.MacedaConceptEditor);
 check(JSON.stringify(await page.evaluate(()=>[S.color,S.zones,S.decor]))===JSON.stringify(saved),'Edits recover after reload');
 await page.locator('[data-mode="design_it_for_me"]').click();
 await page.waitForFunction(()=>document.querySelector('#editorUndo').disabled);
 check(await page.locator('#editorUndo').isDisabled(),'History cannot resurrect edits from the previous mode');
 check(errors.length===0,'No browser errors: '+errors.join(';'));check(external.length===0,'No external requests');
 console.log(JSON.stringify({checks,parity,externalRequests:external.length,errors,screenshots:out},null,2));
 }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
