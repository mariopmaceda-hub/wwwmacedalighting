const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync(require('node:path').join(__dirname, '../inbox/index.html'), 'utf8');
const code = html.slice(html.indexOf('function classificationLabel('), html.indexOf('async function saveDetail('));
function setup(request) {
  const fields = Object.fromEntries(['classificationForm','leadClassification','classificationEvidence','saveClassification','classificationResult','classificationCurrent'].map(id => [id, {value:'',textContent:'',disabled:false,focus(){this.focused=true}}]));
  const ctx = vm.createContext({el:id=>fields[id],authFetch:request,urls:{ops:'admin-only-api'}});
  vm.runInContext(code, ctx);
  ctx.wireClassification({id:'00000000-0000-4000-8000-000000000001',lead_classification:'unverified'});
  return {fields, submit:()=>fields.classificationForm.onsubmit({preventDefault(){}})};
}
(async()=>{
  let calls=[],resolve;
  const {fields:f,submit}=setup((url,opts)=>{calls.push({url,body:JSON.parse(opts.body)});return new Promise(r=>resolve=r)});
  f.classificationEvidence.value='       x       ';
  await submit();assert.equal(calls.length,0);assert(f.classificationEvidence.focused);
  f.leadClassification.value='test';f.classificationEvidence.value='  Explicit test evidence  ';
  const pending=submit();await submit();assert.equal(calls.length,1);assert(f.saveClassification.disabled);
  assert.deepEqual(calls[0],{url:'admin-only-api',body:{action:'classify_leads',ids:['00000000-0000-4000-8000-000000000001'],classification:'test',evidence:'Explicit test evidence'}});
  resolve({ok:true});await pending;
  assert.equal(f.classificationCurrent.textContent,'Current: Test');assert.equal(f.classificationEvidence.value,'');assert(!f.saveClassification.disabled);
  const failed=setup(async()=>{throw new Error('Permission denied')});
  failed.fields.classificationEvidence.value='Evidence retained on error';await failed.submit();
  assert.match(failed.fields.classificationResult.textContent,/Permission denied/);assert.equal(failed.fields.classificationEvidence.value,'Evidence retained on error');assert(!failed.fields.saveClassification.disabled);
  for(const classification of ['real','unverified']){
    const t=setup(async(url,opts)=>{assert.equal(JSON.parse(opts.body).classification,classification);return {ok:true}});
    t.fields.leadClassification.value=classification;t.fields.classificationEvidence.value='Verified reason';await t.submit();
    assert.match(t.fields.classificationResult.textContent,/saved and audited/);
  }
  console.log('PASS: evidence validation, classification-only payload, duplicate-submit guard, error recovery, all three classifications.');
})().catch(e=>{console.error(e);process.exitCode=1});
