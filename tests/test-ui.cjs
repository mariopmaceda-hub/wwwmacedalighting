const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
(async()=>{
 const browser=await chromium.launch({...(process.env.BROWSER_CHANNEL?{channel:process.env.BROWSER_CHANNEL}:{}),headless:true});
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const base={name:'TEST Customer',phone:'2025550102',email:'test@example.invalid',address:'TEST address',services:[],photo_paths:[],status:'Booked',created_at:'2026-10-01T12:00:00Z',quote_amount:100,deposit_paid:50,deposit_status:'paid',cal_booking_start_at:'2026-10-12T14:00:00Z',job_status:'Scheduled'};
 const items=[{...base,id:'00000000-0000-4000-8000-000000000001'},{...base,id:'00000000-0000-4000-8000-000000000002'}];
 let posts=[];
 await page.route('**/*',async route=>{
 const u=new URL(route.request().url());
 if(u.hostname==='localhost'){
 const file=path.join(root,u.pathname);return route.fulfill({contentType:file.endsWith('.js')?'text/javascript':'text/html',body:fs.readFileSync(file)});
 }
 if(u.hostname==='cdn.jsdelivr.net')return route.fulfill({contentType:'text/javascript',body:'export const createClient=()=>({auth:{getSession:async()=>({data:{session:{access_token:"fake-local-only"}}})}});'});
 if(u.pathname.endsWith('/admin-ops-api')){
 const req=route.request();const view=u.searchParams.get('view');let result;
 if(req.method()==='POST'){
 const b=req.postDataJSON();posts.push(b);for(const q of items.filter(x=>b.ids?.includes(x.id))){if(b.action==='trash_leads'){q.lead_trashed_at=new Date().toISOString();q.archive_due_at='2026-10-23T00:00:00Z'}else if(b.action==='restore_leads'){q.lead_trashed_at=null;q.archived_at=null;q.archive_due_at=null;q.automatic_hold=true}}
 result={ok:true,count:b.ids.length};
 }else{
 const active=items.filter(x=>!x.lead_trashed_at&&!x.archived_at),trash=items.filter(x=>x.lead_trashed_at&&!x.archived_at),archive=items.filter(x=>x.archived_at);
 result={ok:true,items:view==='trash'?trash:view==='archive'?archive:view==='payments'?items:active,count:(view==='trash'?trash:view==='archive'?archive:active).length,active_count:active.length,trash_count:trash.length,archive_count:archive.length,statuses:['Booked']};
 if(view==='customers')result.items=active.length?[{name:base.name,phone:base.phone,latest_quote:active[0],quote_ids:active.map(x=>x.id),quote_count:active.length,total_paid:100,total_quoted:200}]:[];
 }
 return route.fulfill({contentType:'application/json',body:JSON.stringify(result)});
 }
 return route.abort();
 });
 page.on('dialog',d=>d.accept());
 const go=async view=>{await page.goto('about:blank');await page.goto('http://localhost/inbox/index.html#'+view);await page.locator('#content h2').waitFor()};
 await go('jobs');await page.locator('[data-trash-order]').first().click();await page.waitForFunction(()=>document.querySelectorAll('[data-trash-order]').length===1);assert.equal(posts.at(-1).ids.length,1);
 await go('trash');await page.locator('[data-change]').click();await page.waitForFunction(()=>document.querySelectorAll('[data-change]').length===0);
 await go('customers');await page.locator('[data-trash-order]').click();await page.waitForFunction(()=>document.querySelectorAll('[data-trash-order]').length===0);assert.equal(posts.at(-1).ids.length,2);
 await go('trash');assert.equal(await page.locator('.lm-card').count(),2);assert.equal(await page.getByRole('button',{name:/permanently/i}).count(),0);
 for(const q of items)q.archived_at='2026-10-23T00:00:00Z';
 await go('archive');assert.equal(await page.locator('.lm-card').count(),2);assert.equal(await page.locator('#lmArchive').getAttribute('aria-pressed'),'true');
 for(const width of [1440,390]){await page.setViewportSize({width,height:900});await page.waitForTimeout(350);assert(await page.locator('#lmArchive').isVisible());await page.screenshot({path:path.resolve(__dirname,'archive-'+width+'.png'),fullPage:true});}
 await page.locator('[data-change]').first().click();await page.waitForFunction(()=>document.querySelectorAll('.lm-card').length===1);
 await go('payments');assert.equal(await page.locator('tbody tr').count(),2);
 assert.deepEqual(errors,[]);await browser.close();console.log('Browser checks passed: Jobs selects one order, Customers selects all listed orders, shared Trash, Archive restore, preserved Payments, desktop/mobile rendering.');
})().catch(e=>{console.error(e);process.exit(1)});
