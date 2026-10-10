const fs = require('node:fs');
const assert = require('node:assert/strict');
const { PGlite } = require(process.env.PGLITE_MODULE || '@electric-sql/pglite');

// Isolated PostgreSQL only. No Supabase, provider, storage or notification calls.
// The captured function is the live attribution-aware definition, not the older proposal.
(async () => {
  const db = new PGlite();
  let checks = 0;
  try {
    await db.exec('create role anon; create role authenticated; create role service_role; create schema storage; create table storage.objects(bucket_id text,name text);');
    const quotes = JSON.parse(fs.readFileSync('tests/schema-fixture.json')).tables.find(t => t.name === 'public.quotes');
    await db.exec('create table quotes(' + quotes.columns.map(c => '"' + c.name + '" ' + (c.data_type === 'ARRAY' ? c.format.slice(1) + '[]' : c.format)).join(',') + '); alter table quotes add column if not exists marketing_attribution jsonb;');
    const columns = JSON.parse(fs.readFileSync('tests/visualizer-schema-columns.json'));
    for (const table of new Set(columns.map(c => c.table_name))) {
      await db.exec('create table ' + table + '(' + columns.filter(c => c.table_name === table).map(c => c.column_name + ' ' + (c.data_type === 'ARRAY' ? c.udt_name.slice(1) + '[]' : c.udt_name) + (c.column_default ? ' default ' + c.column_default : '') + (c.is_nullable === 'NO' ? ' not null' : '')).join(',') + ');');
    }
    // Stub only the pre-existing sanitizer; these tests verify forwarding/preservation,
    // not its separate URL/privacy sanitization behavior.
    await db.exec('create function public.sanitize_marketing_attribution(value jsonb) returns jsonb language sql immutable as $$ select value $$;');
    const baseline = fs.readFileSync('tests/fixtures/finalizer-live-before-night.sql', 'utf8').replace(/\r\n/g, '\n');
    await db.exec(baseline);
    await db.exec('revoke all on function public.finalize_visualizer_quote(uuid,uuid,text,jsonb) from public,anon,authenticated; grant execute on function public.finalize_visualizer_quote(uuid,uuid,text,jsonb) to service_role;');
    await db.exec("create table test_notifications(id integer generated always as identity); create function test_ack() returns trigger language plpgsql as 'begin insert into test_notifications default values; return new; end'; create trigger test_ack after update of sms_opt_in on quotes for each row when (new.sms_opt_in=true) execute function test_ack();");

    const meta = async () => (await db.query("select pg_get_functiondef(oid) as definition, proacl::text as acl,proowner,proconfig,prosecdef from pg_proc where oid='public.finalize_visualizer_quote(uuid,uuid,text,jsonb)'::regprocedure")).rows[0];
    const before = await meta();
    const proposal = fs.readFileSync('docs/proposals/visualizer-night-handoff.sql', 'utf8').replace(/\r\n/g, '\n');
    // Reject any unexpected function drift before replacing even the intended guard.
    await db.exec(before.definition.replace('stamp timestamptz := now();', 'stamp timestamptz := now(); -- unexpected change'));
    await assert.rejects(() => db.exec(proposal), /Finalizer changed since review/); checks++;
    await db.exec(baseline);
    await db.exec('grant execute on function public.finalize_visualizer_quote(uuid,uuid,text,jsonb) to anon;');
    await assert.rejects(() => db.exec(proposal), /Unexpected finalizer permissions/); checks++;
    await db.exec('revoke execute on function public.finalize_visualizer_quote(uuid,uuid,text,jsonb) from anon;');
    await db.exec(proposal);
    const after = await meta();
    assert.deepEqual({ ...after, definition: null }, { ...before, definition: null }); checks++;
    const oldGuard = proposal.match(/old_guard text := \$old_guard\$([\s\S]*?)\$old_guard\$/)[1];
    const newGuard = proposal.match(/new_guard text := \$new_guard\$([\s\S]*?)\$new_guard\$/)[1];
    assert.equal(after.definition, before.definition.replace(oldGuard, newGuard)); checks++;
    assert(after.definition.includes("marketing_attribution=coalesce(marketing_attribution,public.sanitize_marketing_attribution(p_contact->'marketing_attribution'))")); checks++;
    // Retrying a proposal is deliberately blocked: the operator must inspect new state.
    await assert.rejects(() => db.exec(proposal), /Finalizer changed since review/); checks++;

    const sid = '10000000-0000-0000-0000-000000000001';
    const rid = '20000000-0000-0000-0000-000000000001';
    const qid = '30000000-0000-0000-0000-000000000001';
    const dest = qid + '/visualizer-' + rid + '.png';
    const contact = { name: 'TEST ONLY', email: 'test@example.invalid', phone: '0000000000', address: 'TEST', sms_opt_in: true, marketing_attribution: { qr_id: 'existing-test-qr', utm_source: 'existing-test-source' } };
    const goodReview = { pass: true, night: true, photorealistic: true, architecture_preserved: true, selection_followed: true, failures: [] };
    const goodValidation = () => ({ passed: true, review: structuredClone(goodReview) });
    const seed = async ({ renderer = 'ai-night-v1', validation = goodValidation(), existingAttribution = null } = {}) => {
      await db.exec('truncate quotes,visualizer_sessions,visualizer_renders,preview_versions,storage.objects,test_notifications restart identity;');
      await db.query("insert into visualizer_sessions(id,session_token_hash,status,design_revision,current_render_id) values($1,'TEST','render_ready',1,$2)", [sid, rid]);
      await db.query("insert into visualizer_renders(id,session_id,stage,design_spec,validation_result) values($1,$2,'ready',$3,$4)", [rid, sid, JSON.stringify({ contract_version: 'maceda-concept/1', renderer, design_revision: 1, source_photo_path: 'TEST/photo.jpg', selected_zones: ['main_roofline'] }), JSON.stringify(validation)]);
      await db.query('insert into quotes(id,visualizer_session_id,marketing_attribution) values($1,$2,$3)', [qid, sid, existingAttribution && JSON.stringify(existingAttribution)]);
      await db.query("insert into storage.objects values('quote-previews',$1)", [dest]);
    };
    const submit = (details = contact, path = dest) => db.query('select finalize_visualizer_quote($1,$2,$3,$4) as result', [sid, rid, path, JSON.stringify(details)]);
    const rejectWithoutHandoff = async (pattern, details = contact, path = dest) => {
      await assert.rejects(() => submit(details, path), pattern);
      assert.equal((await db.query('select count(*)::int as n from preview_versions')).rows[0].n, 0);
      assert.equal((await db.query('select count(*)::int as n from test_notifications')).rows[0].n, 0);
      assert.equal((await db.query('select status from visualizer_sessions')).rows[0].status === 'converted_to_quote', false);
      checks++;
    };

    for (const value of [null, {}, { passed: true }, { passed: false, review: goodReview }, { passed: 'true', review: goodReview }]) {
      await seed({ validation: value }); await rejectWithoutHandoff(/Night preview has not passed review/);
    }
    for (const key of ['pass', 'night', 'photorealistic', 'architecture_preserved', 'selection_followed']) {
      for (const value of [false, null, 'true', undefined]) {
        const validation = goodValidation(); validation.review[key] = value;
        await seed({ validation }); await rejectWithoutHandoff(/Night preview has not passed review/);
      }
    }
    for (const failures of [undefined, null, {}, '', [{ code: 'architecture_changed' }]]) {
      const validation = goodValidation(); validation.review.failures = failures;
      await seed({ validation }); await rejectWithoutHandoff(/Night preview has not passed review/);
    }
    for (const renderer of [null, '', 'unknown-renderer']) {
      await seed({ renderer }); await rejectWithoutHandoff(/Unsupported preview contract/);
    }
    await seed(); await db.exec("update visualizer_renders set design_spec=jsonb_set(design_spec,'{contract_version}','\"maceda-concept/2\"')"); await rejectWithoutHandoff(/Unsupported preview contract/);
    await seed(); await db.exec('update visualizer_sessions set design_revision=2'); await rejectWithoutHandoff(/Design changed/);
    await seed(); await db.exec('update visualizer_sessions set current_render_id=null'); await rejectWithoutHandoff(/Design changed/);
    await seed(); await db.exec("update visualizer_sessions set status='design_ready'"); await rejectWithoutHandoff(/completed preview/);
    await seed(); await db.exec("update visualizer_renders set stage='validating'"); await rejectWithoutHandoff(/query returned no rows/);
    await seed(); await db.exec("update visualizer_renders set session_id='10000000-0000-0000-0000-000000000002'"); await rejectWithoutHandoff(/query returned no rows/);
    await seed(); await db.exec('delete from storage.objects'); await rejectWithoutHandoff(/transfer incomplete/);
    await seed(); await rejectWithoutHandoff(/Unexpected preview path/, contact, 'wrong/preview.png');
    for (const key of ['name', 'email', 'phone', 'address']) {
      await seed(); await rejectWithoutHandoff(/Contact details and consent/, { ...contact, [key]: '' });
    }
    await seed(); await rejectWithoutHandoff(/Contact details and consent/, { ...contact, sms_opt_in: false });

    for (const role of ['anon', 'authenticated']) {
      await seed(); await db.exec('set role ' + role);
      await assert.rejects(submit, /permission denied for function finalize_visualizer_quote/);
      await db.exec('reset role'); checks++;
    }
    for (const renderer of ['deterministic-v1', 'ai-night-v1']) {
      await seed({ renderer, validation: renderer === 'deterministic-v1' ? {} : goodValidation() });
      assert.equal((await submit()).rows[0].result.preview_attached, true);
      await submit(); await submit();
      assert.equal((await db.query('select count(*)::int as n from preview_versions')).rows[0].n, 1);
      assert.equal((await db.query('select count(*)::int as n from quotes')).rows[0].n, 1);
      assert.equal((await db.query('select count(*)::int as n from test_notifications')).rows[0].n, 1);
      assert.deepEqual((await db.query('select marketing_attribution from quotes')).rows[0].marketing_attribution, contact.marketing_attribution);
      const preview = (await db.query('select design_spec,validation_result from preview_versions')).rows[0];
      assert.equal(preview.design_spec.renderer, renderer);
      if (renderer === 'ai-night-v1') assert.deepEqual(preview.validation_result, goodValidation());
      await assert.rejects(() => submit(contact, 'different/path.png'), /already submitted with a different preview/);
      checks++;
    }
    const previous = { qr_id: 'preserve-existing-qr', utm_source: 'prior-campaign' };
    await seed({ existingAttribution: previous }); await submit();
    assert.deepEqual((await db.query('select marketing_attribution from quotes')).rows[0].marketing_attribution, previous); checks++;
    const access = (await db.query("select has_function_privilege('anon','public.finalize_visualizer_quote(uuid,uuid,text,jsonb)','execute') as anon, has_function_privilege('authenticated','public.finalize_visualizer_quote(uuid,uuid,text,jsonb)','execute') as authenticated, has_function_privilege('service_role','public.finalize_visualizer_quote(uuid,uuid,text,jsonb)','execute') as service_role")).rows[0];
    assert.deepEqual(access, { anon: false, authenticated: false, service_role: true }); checks++;
    const rollback = fs.readFileSync('docs/proposals/visualizer-night-handoff-rollback.sql', 'utf8').replace(/\r\n/g, '\n');
    await db.exec(rollback);
    assert.deepEqual(await meta(), before); checks++;
    assert.deepEqual((await db.query('select marketing_attribution from quotes')).rows[0].marketing_attribution, previous);
    assert.equal((await db.query('select count(*)::int as n from preview_versions')).rows[0].n, 1); checks++;
    await assert.rejects(() => db.exec(rollback), /Finalizer changed since night release/); checks++;
    await db.exec(proposal);
    assert.deepEqual(await meta(), after); checks++;
    await db.exec(rollback.replace(/\n/g, '\r\n'));
    assert.deepEqual(await meta(), before);
    await db.exec(proposal.replace(/\n/g, '\r\n'));
    assert.deepEqual(await meta(), after); checks++;
    console.log(JSON.stringify({ passed: true, checks, isolation: 'PGlite only; no production writes or real notifications', finalizer_md5: (await db.query("select md5(pg_get_functiondef('public.finalize_visualizer_quote(uuid,uuid,text,jsonb)'::regprocedure)) as hash")).rows[0].hash }, null, 2));
  } finally { await db.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
