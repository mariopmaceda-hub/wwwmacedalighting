// Offline regression checks: no network, real quotes, or vendor submissions.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),cp=require('node:child_process');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const route='/christmas-light-installation-pasadena/',origin='https://wwwmacedalighting.netlify.app';
const analytics=read('assets/analytics.js');
function run(url,storage=new Map(),gpc=false,referrer=''){
 const listeners={},nodes=new Map(),scripts=[],masked=[];
 function element(tag){return {tagName:tag,children:[],attributes:{},append(...children){this.children.push(...children);for(const n of children){if(n.id)nodes.set(n.id,n);if(n.tagName==='script')scripts.push(n.src)}},setAttribute(k,v){this.attributes[k]=v},remove(){nodes.delete(this.id)}}}
 const doc={readyState:'complete',referrer,head:element('head'),body:element('body'),createElement:element,getElementById:id=>nodes.get(id),querySelectorAll:selector=>{masked.push(selector);return [{setAttribute(k,v){assert.equal(k,'data-clarity-mask');assert.equal(v,'true')}}]},addEventListener:(name,fn)=>listeners[name]=fn};
 const ctx={document:doc,location:new URL(url),navigator:{globalPrivacyControl:gpc},URL,URLSearchParams,Date,Set,JSON,localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)}};
 ctx.window=ctx;vm.runInNewContext(analytics,ctx);
 const choose=label=>nodes.get('mlPrivacyBanner').children.find(n=>n.textContent===label).onclick();
 const events=()=>Array.from(ctx.dataLayer||[]).filter(x=>x[0]==='event').map(x=>({name:x[1],data:x[2]}));
 return {ctx,storage,scripts,masked,events,choose,click:href=>listeners.click({target:{closest:()=>({href:new URL(href,url).href})}}),input:()=>listeners.input({target:{closest:()=>({})}})};
}
const shared=new Map(),city=run(origin+route+'?utm_source=door_hanger&utm_medium=qr&utm_campaign=holiday_2026',shared);
assert.equal(city.scripts.length,0);city.choose('Allow analytics');
assert.equal(city.scripts.filter(x=>x.includes('googletagmanager')).length,1);assert.equal(city.scripts.filter(x=>x.includes('clarity.ms')).length,1);
assert.equal(city.events().filter(x=>x.name==='page_view').length,1);
assert.equal(city.events()[0].data.page_location,origin+route);assert.equal(city.ctx.MLAnalytics.attribution().landing_page,route);
city.click('/#quote');assert.equal(city.events().filter(x=>x.name==='quote_cta_click').length,1);assert.equal(city.events().at(-1).data.page_location,origin+route);
city.ctx.MLAnalytics.preferences();city.choose('Allow analytics');assert.equal(city.events().filter(x=>x.name==='page_view').length,1);
city.click('/visualizer/');assert.equal(city.events().at(-1).data.form_name,'visualizer');
const home=run(origin+'/#quote',shared, false,origin+route);home.input();home.input();assert.equal(home.events().filter(x=>x.name==='quote_form_start').length,1);
assert.equal(home.ctx.MLAnalytics.attribution().utm_source,'door_hanger');assert.equal(home.ctx.MLAnalytics.attribution().landing_page,route);
assert(home.scripts.some(x=>x.includes('clarity.ms')));assert(home.masked.some(x=>x.includes('#photoPreview')&&x.includes('form')));
const visualizer=run(origin+'/visualizer/?utm_source=flyer',shared);assert.equal(visualizer.ctx.MLAnalytics.attribution().utm_source,'door_hanger');assert.equal(visualizer.ctx.MLAnalytics.attribution().landing_page,route);assert(visualizer.masked.some(x=>x.includes('#pics')&&x.includes('#directions')&&x.includes('.compare')));
const denied=run(origin+route,new Map([['mlAnalyticsConsentV1','"denied"']]));assert.equal(denied.scripts.length,0);denied.click('/#quote');assert.equal(denied.events().length,0);
const gpc=run(origin+route,new Map([['mlAnalyticsConsentV1','"granted"']]),true);assert.equal(gpc.scripts.length,0);
const unsafe=run(origin+route+'?email=private@example.invalid&utm_source=PrivatePerson&phone=3235550123#secret',new Map([['mlAnalyticsConsentV1','"granted"']]));
assert(!unsafe.scripts.some(x=>x.includes('clarity.ms')));assert(!JSON.stringify(unsafe.events()).match(/PrivatePerson|private@example|3235550123|secret/));
assert.equal(unsafe.events()[0].data.campaign_source,'other');assert.equal(unsafe.events()[0].data.page_location,origin+route);
for(const p of ['/inbox/','/inbox/analytics/','/pay/','/review/','/admin/','/unknown/'])assert.equal(run(origin+p).ctx.MLAnalytics,undefined);
const alias=run(origin+route+'index.html',new Map([['mlAnalyticsConsentV1','"granted"']]));assert.equal(alias.events()[0].data.page_location,origin+route);

// Run the actual unchanged homepage submit handler with fake storage/insert adapters.
async function quoteChecks(){
 const html=read('index.html'),body=html.slice(html.indexOf('let pendingQuoteId=null;'),html.indexOf('</script>',html.indexOf('let pendingQuoteId=null;')));
 let submit,mode='upload-error',inserted=[],ids=0;
 const fields={name:{value:'Private Test Person'},phone:{value:'3235550123'},email:{value:'private@example.invalid'},address:{value:'123 Secret Street'},message:{value:'Private message'},propertyType:{value:'Residential'},smsOptIn:{checked:true}};
 const context={quoteForm:{addEventListener:(name,fn)=>submit=fn,reset(){}},submitBtn:{},formStatus:{style:{}},photoPreview:{},photosInput:{files:[{name:'PrivatePerson.png',type:'image/png',size:100}]},document:{getElementById:id=>fields[id],querySelectorAll:()=>[{value:'Roofline'}]},crypto:{randomUUID:()=>`fake-id-${++ids}`},window:{MLAnalytics:home.ctx.MLAnalytics},console:{error(){}},showStatus(){},supabaseClient:{storage:{from:()=>({upload:async()=>({error:mode==='upload-error'?new Error('upload failed'):null})})},from:()=>({insert:async q=>{if(mode==='insert-error')return {error:new Error('insert failed')};inserted.push(q);return {error:null}}})}};
 vm.runInNewContext(body,context);
 await submit({preventDefault(){}});assert.equal(home.events().filter(x=>x.name==='generate_lead').length,0);
 mode='insert-error';await submit({preventDefault(){}});assert.equal(home.events().filter(x=>x.name==='generate_lead').length,0);
 mode='success';await submit({preventDefault(){}});assert.equal(inserted.length,1);assert.equal(home.events().filter(x=>x.name==='generate_lead').length,1);
 home.ctx.MLAnalytics.lead(inserted[0].id,'homepage');assert.equal(home.events().filter(x=>x.name==='generate_lead').length,1);
 const next=run(origin+'/',shared);next.ctx.MLAnalytics.lead(inserted[0].id,'homepage');assert.equal(next.events().filter(x=>x.name==='generate_lead').length,0);
 assert.equal(inserted[0].marketing_attribution.utm_source,'door_hanger');assert.equal(inserted[0].marketing_attribution.landing_page,route);
 assert(!JSON.stringify(home.events()).match(/Private|3235550123|private@example|Secret Street|fake-id/));
}
function seoChecks(){
 const page=read(route.slice(1)+'index.html'),home=read('index.html');
 assert.equal((page.match(/<h1>/g)||[]).length,1);assert(page.includes('<h1>Christmas Light Installation in Pasadena, CA</h1>'));
 assert(page.includes('<title>Christmas Light Installation Pasadena, CA | Maceda Lighting</title>'));
 assert(page.includes('name="description" content="Professional Christmas light installation in Pasadena, CA. Custom rooflines, trees, windows, walkways and full-property holiday displays from Maceda Lighting."'));
 assert(page.includes('rel="canonical" href="'+origin+route+'"'));assert(home.includes('href="'+route+'"'));
 assert.equal((page.match(/<form\b/g)||[]).length,0);assert.equal((page.match(/<details>/g)||[]).length,5);
 const schema=JSON.parse(page.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);assert.equal(schema['@type'],'Service');assert.equal(schema.areaServed.name,'Pasadena');assert(!JSON.stringify(schema).match(/rating|review|address|openingHours|geo/));
 assert(read('sitemap.xml').includes(origin+route));const robots=read('robots.txt');for(const p of ['/inbox','/admin','/pay','/review'])assert(robots.includes('Disallow: '+p));assert(!robots.includes('Disallow: '+route));
 // Compare against the production baseline before the shared CSS extraction.
 const prior=cp.execFileSync('git',['show','f97b135034eb2cf6dfe239583c58204031293835:index.html'],{cwd:root,encoding:'utf8'});
 assert.equal(read('assets/public-site.css'),prior.match(/<style>([\s\S]*?)<\/style>/)[1]);
 // Quote behavior is covered by quoteChecks and homepage-lead.spec; the no-photo path intentionally differs.
 assert.equal(home.match(/<label class="consent">[\s\S]*?<\/label>/)[0],prior.match(/<label class="consent">[\s\S]*?<\/label>/)[0]);
 for(const href of [...page.matchAll(/(?:href|src)="([^"]+)"/g)].map(m=>m[1])){
  if(href.startsWith('#'))assert(page.includes('id="'+href.slice(1)+'"'));
  if(href.startsWith('/')&&!href.startsWith('//')){const p=href.split('#')[0];assert([p,p+'index.html',p+'.html'].some(p=>fs.existsSync(path.join(root,p))),href)}
 }
}
quoteChecks().then(()=>{seoChecks();console.log('PASS: SEO, links, shared-style equivalence; consent and GPC; distinct city page_view; one event per CTA; first-touch to homepage/visualizer; form start once; failed submits emit no conversion; successful mocked quote emits once; reload deduplication; PII exclusion; Clarity gate/masking; private paths excluded. No external requests or records.');}).catch(e=>{console.error(e);process.exitCode=1});
