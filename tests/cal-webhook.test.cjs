const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {stripTypeScriptTypes}=require('node:module');
const {webcrypto,createHmac}=require('node:crypto');
const source=stripTypeScriptTypes(fs.readFileSync(require('node:path').join(__dirname,'../supabase/functions/cal-booking-webhook/index.ts'),'utf8').replace(/^import .*;\s*$/gm,''));
function fixture(paid=true){
 let handler;const actions=[];const quote={id:'11111111-1111-4111-8111-111111111111',email:'fixture@example.invalid',deposit_status:paid?'paid':'unpaid',deposit_paid:paid?100:0,deposit_required:100};
 const sb={from(table){let operation='select',values;const q={select(){return q},eq(){return q},update(v){operation='update';values=v;return q},upsert(v){operation='upsert';values=v;return q},maybeSingle(){return finish()},single(){return finish()},then(a,b){return finish().then(a,b)}};async function finish(){actions.push({table,operation,values});return {data:table==='quotes'?quote:null,error:null}}return q}};
 vm.runInNewContext(source,{Deno:{env:{get:k=>({CAL_WEBHOOK_SECRET:'fixture-secret',SUPABASE_SECRET_KEYS:'{"default":"fixture-only"}',SUPABASE_URL:'https://fixture.invalid'})[k]},serve:fn=>handler=fn},createClient:()=>sb,crypto:webcrypto,TextEncoder,Response,console:{warn(){}}});
 async function send(trigger,payload={},valid=true){const body=JSON.stringify({triggerEvent:trigger,createdAt:'2026-10-20T00:00:00Z',payload});const signature=valid?createHmac('sha256','fixture-secret').update(body).digest('hex'):'invalid';return handler(new Request('https://fixture.invalid',{method:'POST',body,headers:{'x-cal-signature-256':signature}}))}
 return {send,actions,quote};
}
test('unrelated lifecycle events without quote metadata are acknowledged without quote access',async()=>{
 for(const event of ['MEETING_STARTED','MEETING_ENDED','BOOKING_NO_SHOW_UPDATED']){const f=fixture(),r=await f.send(event,{uid:'fixture'});assert.equal(r.status,200);assert.equal((await r.json()).ignored,true);assert(!f.actions.some(x=>x.table==='quotes'));assert(f.actions.some(x=>x.values?.status==='processed'));}
});
test('ignored events still require authentic signature',async()=>{const f=fixture();assert.equal((await f.send('MEETING_ENDED',{},false)).status,401);assert.equal(f.actions.length,0)});
test('booking events still require metadata and paid deposit',async()=>{
 const missing=fixture();assert.equal((await missing.send('BOOKING_CREATED',{uid:'fixture'})).status,409);
 const unpaid=fixture(false);assert.equal((await unpaid.send('BOOKING_CREATED',{metadata:{quoteId:unpaid.quote.id},startTime:'2026-11-01T12:00:00Z'})).status,409);assert(!unpaid.actions.some(x=>x.table==='quotes'&&x.operation==='update'));
});
test('paid booking metadata still reaches booked installation state',async()=>{const f=fixture(),r=await f.send('BOOKING_CREATED',{metadata:{quoteId:f.quote.id},startTime:'2026-11-01T12:00:00Z'});assert.equal(r.status,200);assert(f.actions.some(x=>x.table==='quotes'&&x.values?.scheduling_status==='booked'))});
