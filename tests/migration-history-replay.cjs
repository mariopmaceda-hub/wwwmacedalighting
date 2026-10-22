#!/usr/bin/env node
'use strict';
// OFFLINE TEST HARNESS. Never connects to Supabase or executes against a server.
// The catalog fixture contains current column TYPES only, not an authenticated historical
// schema snapshot. Synthetic defaults, keys, policies and private.is_admin are explicitly
// approximations. Recorded migrations create their own later tables/columns in order.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const MIGRATIONS = process.env.MIGRATION_REPLAY_DIR
  ? path.resolve(process.env.MIGRATION_REPLAY_DIR)
  : path.resolve(__dirname, '../supabase/migrations');
const CATALOG = path.join(__dirname, 'migration-prehistory-fixture.json');
const MANIFEST = path.join(__dirname, 'migration-history-manifest.json');
const modulePath = process.env.PGLITE_MODULE || path.dirname(path.dirname(require.resolve('@electric-sql/pglite')));
assert(path.isAbsolute(modulePath), 'PGLITE_MODULE must name the verified local package path');
const packageMeta = JSON.parse(fs.readFileSync(path.join(modulePath, 'package.json')));
assert.equal(packageMeta.name, '@electric-sql/pglite', 'Expected pinned PGlite package');
assert.equal(packageMeta.version, '0.3.14', 'Only reviewed PGlite 0.3.14 is allowed');
assert(process.permission, 'Run Node with --permission and read-only --allow-fs-read paths');
for (const p of ['child', 'worker', 'addons', 'wasi']) assert.equal(process.permission.has(p), false, p + ' permission must remain denied');
assert.equal(process.permission.has('fs.write'), false, 'Harness must have no filesystem-write permission');

// Independent application-level egress barrier, installed BEFORE loading PGlite.
// Node 24 permission mode does not itself deny networking. Block both CommonJS and
// ESM builtin exports, global fetch/WebSocket, sockets, DNS, subprocesses and workers.
let blockedAttempts = 0;
const deny = () => { blockedAttempts++; throw new Error('OFFLINE HARNESS: network/process/worker operation blocked'); };
assert(globalThis.__migrationOfflineGuard, 'Preload tests/offline-network-guard.cjs before this harness');
const block = (object, method) => {
  const descriptor = Object.getOwnPropertyDescriptor(object, method);
  if (descriptor && descriptor.writable === false && descriptor.configurable === false) return; // Already blocked by required preload.
  if (method in object) Object.defineProperty(object, method, { value: deny, writable: false, configurable: false });
};
for (const [name, methods] of Object.entries({
  http: ['request', 'get'], https: ['request', 'get'], http2: ['connect', 'createServer', 'createSecureServer'],
  net: ['connect', 'createConnection', 'createServer'], tls: ['connect', 'createServer'], dgram: ['createSocket'],
  dns: ['lookup', 'lookupService', 'resolve', 'resolve4', 'resolve6', 'resolveAny', 'resolveCname', 'resolveMx', 'resolveTxt', 'reverse'],
  child_process: ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork'],
  worker_threads: ['Worker'], cluster: ['fork']
})) {
  const mod = require('node:' + name);
  for (const method of methods) block(mod, method);
}
block(require('node:net').Socket.prototype, 'connect');
block(require('node:net').Server.prototype, 'listen');
for (const method of ['lookup','lookupService','resolve','resolve4','resolve6','resolveAny','resolveCname','resolveMx','resolveTxt','reverse']) {
  block(require('node:dns').promises, method);
}
block(globalThis, 'fetch');
block(globalThis, 'WebSocket');
require('node:module').syncBuiltinESMExports();
assert.throws(() => require('node:net').connect({ port: 1, host: '127.0.0.1' }), /OFFLINE HARNESS|Outbound networking is disabled/);
assert.throws(() => globalThis.fetch('https://example.invalid'), /OFFLINE HARNESS|Outbound networking is disabled/);
assert.throws(() => new (require('node:dns').Resolver)(), /OFFLINE HARNESS|Outbound networking is disabled/);
assert.throws(() => new (require('node:dns/promises').Resolver)(), /OFFLINE HARNESS|Outbound networking is disabled/);
blockedAttempts = 0; // These deliberate guard self-tests did not open sockets.
globalThis.__migrationOfflineGuard.attempts = 0;
const { PGlite } = require(modulePath);
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
const ident = s => '"' + s.replaceAll('"', '""') + '"';

// Explicitly exclude every ADD COLUMN for prerequisites recorded in the 29 files.
// The exclusions are checked against source declarations below, not silently assumed.
const added = {
  quotes: new Set(('sms_opt_in sms_opt_in_at preview_status preview_source_photo_path preview_image_path preview_generated_at preview_sent_at preview_error preview_attempts preview_version selected_package selected_package_at preview_sms_sid preview_sms_status quote_amount deposit_percent deposit_required deposit_status deposit_paid deposit_checkout_session_id deposit_checkout_url deposit_payment_intent_id deposit_paid_at scheduling_status scheduling_ready_at scheduling_override booking_link booking_link_sent_at installation_start_at cal_booking_uid cal_booking_status cal_booking_start_at cal_booking_end_at cal_booking_updated_at preview_reviewed_at preview_review_action preview_review_note marketing_attribution').split(' ')),
  visualizer_sessions: new Set('contact_profile lead_quote_id photo_views scale_calibration design_revision'.split(' ')),
  maceda_products: new Set('inventory_state procurement_status supplier_asin asset_definition'.split(' ')),
};
const baseTables = ['quotes','maceda_products','visualizer_sessions','visualizer_renders','preview_versions','sms_messages'];
function syntheticDefault(c) {
  if (c.column_name === 'id') return ' default gen_random_uuid()';
  if (!c.not_null && c.column_name !== 'created_at') return '';
  if (c.data_type === 'uuid') return '';
  if (c.data_type.endsWith('[]')) return " default '{}'";
  if (c.data_type === 'jsonb') return " default '{}'::jsonb";
  if (c.data_type === 'boolean') return ' default false';
  if (/^(integer|bigint|smallint|numeric)/.test(c.data_type)) return ' default ' + (c.column_name === 'version' ? 1 : 0);
  if (c.data_type === 'timestamp with time zone') return ' default now()';
  if (c.data_type === 'text') return " default 'SYNTHETIC TEST ONLY'";
  throw new Error('Unknown synthetic-default type: ' + c.data_type);
}

const stubs = `
create role anon; create role authenticated; create role service_role bypassrls;
create schema private; create schema storage; create schema net; create schema cron; create schema vault; create schema extensions;
create function private.is_admin(p_actor uuid) returns boolean language sql immutable as $$select p_actor='90000000-0000-0000-0000-000000000001'::uuid$$;
revoke all on function private.is_admin(uuid) from public,anon,authenticated;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,unique(bucket_id,name));
insert into storage.buckets(id,name,public) values('quote-photos','quote-photos',true);
alter table storage.objects enable row level security;
create policy "Anyone can upload quote photos" on storage.objects for insert to anon with check(false);
create table net.calls(id bigint generated always as identity,url text,headers jsonb,body jsonb,timeout_milliseconds integer);
create function net.http_post(url text,body jsonb default '{}'::jsonb,params jsonb default '{}'::jsonb,headers jsonb default '{}'::jsonb,timeout_milliseconds integer default 5000) returns bigint language plpgsql as $$declare result bigint; begin insert into net.calls(url,headers,body,timeout_milliseconds) values(url,headers,body,timeout_milliseconds) returning id into result; return result; end$$;
create table cron.job(jobid bigint generated always as identity,jobname text unique,schedule text,command text);
create function cron.schedule(p_name text,p_schedule text,p_command text) returns bigint language plpgsql as $$declare result bigint; begin insert into cron.job(jobname,schedule,command) values(p_name,p_schedule,p_command) returning jobid into result; return result; end$$;
create function cron.unschedule(p_id bigint) returns boolean language plpgsql as $$begin delete from cron.job where jobid=p_id; return found; end$$;
create table vault.secrets(id uuid primary key default gen_random_uuid(),name text unique,secret text,description text,created_at timestamptz default now());
create view vault.decrypted_secrets as select id,name,secret as decrypted_secret,description,created_at from vault.secrets;
create function vault.create_secret(p_value text,p_name text,p_description text default null) returns uuid language plpgsql as $$declare result uuid; begin insert into vault.secrets(secret,name,description) values(p_value,p_name,p_description) returning id into result; return result; end$$;
create function vault.update_secret(p_id uuid,p_value text,p_name text,p_description text default null) returns void language sql as $$update vault.secrets set secret=p_value,name=p_name,description=p_description where id=p_id$$;
create function extensions.gen_random_bytes(n integer) returns bytea language sql immutable as $$select decode(repeat('ab',n),'hex')$$;
create function public.gen_random_bytes(n integer) returns bytea language sql immutable as $$select extensions.gen_random_bytes(n)$$;
`;

(async () => {
  const notices = [];
  const db = new PGlite(); // No dataDir: filesystem is entirely in WASM memory.
  const results = { passed: false, engine: 'PGlite 0.3.14 in-memory', migrations_applied: [], checks: [], adapters: [],
    baseline: { provenance: 'Current catalog types/nullability, not exact historical schema',
      approximations: ['Only six existing prerequisite relations; recorded later tables/views excluded.',
        'Synthetic defaults, id primary keys, no inferred historic foreign keys/check constraints.',
        'Synthetic pre-existing quote/storage INSERT policies and service-role grants/BYPASSRLS (not superuser).',
        'private.is_admin permits only a fixed synthetic test UUID.',
        'Inert SQL Vault/entropy/net/cron stubs; no extension binaries, workers, or callbacks.'] },
    production_equivalence: false, deployment_authorized: false };
  let stage = 'load sources';
  const check = (name, condition) => { assert(condition, name); results.checks.push(name); };
  const one = async (sql, params) => (await db.query(sql, params)).rows[0];
  try {
    const files = fs.readdirSync(MIGRATIONS).filter(f => /^\d{14}_.+\.sql$/.test(f)).sort();
    const sourceManifest = JSON.parse(fs.readFileSync(MANIFEST));
    const manifest = sourceManifest.migrations;
    assert.equal(files.length, 29);
    assert.deepEqual(files, manifest.map(m => m.file).sort());
    const sources = files.map(file => ({ file, version: file.slice(0,14), bytes: fs.readFileSync(path.join(MIGRATIONS,file)) }));
    for (const source of sources) assert.equal(hash(source.bytes), manifest.find(m => m.version === source.version).sha256, 'Pinned candidate source hash: ' + source.file);
    const originalHashes = sources.map(s => hash(s.bytes));
    const sourceText = sources.map(s => s.bytes.toString('utf8')).join('\n');
    const discovered = {};
    for (const statement of sourceText.matchAll(/alter\s+table\s+public\.(\w+)\s+([\s\S]*?);/gi)) {
      for (const column of statement[2].matchAll(/add\s+column\s+(?:if\s+not\s+exists\s+)?(\w+)/gi)) (discovered[statement[1]] ??= new Set()).add(column[1]);
    }
    for (const table of baseTables) assert.deepEqual([...(added[table] || [])].sort(), [...(discovered[table] || [])].sort(), 'Baseline exclusions match recorded ADD COLUMN: ' + table);
    const preview = sources.find(s => s.version === sourceManifest.sanitized_tail.version).bytes.toString('utf8');
    const tail = preview.slice(preview.indexOf(sourceManifest.sanitized_tail.starts_with));
    assert.equal(hash(Buffer.from(tail)), sourceManifest.sanitized_tail.sha256);
    check('Literal Vault provisioning prefix absent; canonical retained tail verified', !/vault\.(?:create_secret|update_secret)\s*\(/i.test(preview));

    stage = 'synthetic prehistory';
    await db.exec(stubs);
    const columns = JSON.parse(fs.readFileSync(CATALOG)).columns;
    check('Synthetic fixture excludes every recorded later column', columns.every(c => !(added[c.relation_name] || new Set()).has(c.column_name)));
    for (const table of baseTables) {
      const tableColumns = columns.filter(c => c.relation_name === table && !(added[table] || new Set()).has(c.column_name));
      assert(tableColumns.length, 'Catalog missing ' + table);
      await db.exec(`create table public.${ident(table)}(${tableColumns.map(c => ident(c.column_name) + ' ' + c.data_type + syntheticDefault(c) + (c.not_null ? ' not null' : '') + (c.column_name === 'id' ? ' primary key' : '')).join(',')});`);
    }
    await db.exec(`alter table public.quotes enable row level security; create policy "Anyone can submit quote" on public.quotes for insert to anon with check(false); grant usage on schema public,private,storage,net,vault to service_role; grant all on all tables in schema public,storage,net,vault to service_role; grant usage,select on all sequences in schema net to service_role;`);
    check('No later migration tables/views precreated', !(await one("select to_regclass('public.lead_management') is not null or to_regclass('public.admin_lead_records') is not null or to_regclass('public.pe_providers') is not null as exists")).exists);
    let preNight;
    const finalizerMeta = () => one("select pg_get_functiondef(oid) as definition,md5(pg_get_functiondef(oid)) as md5,proacl::text as acl,proowner,proconfig,prosecdef from pg_proc where oid='public.finalize_visualizer_quote(uuid,uuid,text,jsonb)'::regprocedure");
    for (const source of sources) {
      stage = source.file;
      let sql = source.bytes.toString('utf8');
      for (const declaration of ['create extension if not exists pg_net;', 'create extension if not exists pg_cron with schema pg_catalog;']) {
        if (sql.includes(declaration)) {
          assert.equal(sql.split(declaration).length - 1, 1);
          sql = sql.replace(declaration, '-- TEST ADAPTER: extension replaced by inert SQL stubs.');
          results.adapters.push({ file: source.file, removed_statement: declaration, reason: 'Unsupported extension only; all remaining SQL executed unchanged' });
        }
      }
      if (source.version === '20261010053304') preNight = await finalizerMeta();
      await db.exec(sql);
      results.migrations_applied.push(source.version);
      if (source.version === '20261010053304') {
        const after = await finalizerMeta();
        const oldGuard = sql.match(/old_guard text := \$old_guard\$([\s\S]*?)\$old_guard\$/)[1];
        const newGuard = sql.match(/new_guard text := \$new_guard\$([\s\S]*?)\$new_guard\$/)[1];
        assert.equal(preNight.md5, '49d3758d14cb54863e605b5a44b49bd3');
        assert.equal(after.definition, preNight.definition.replace(oldGuard,newGuard));
        for (const key of ['acl','proowner','proconfig','prosecdef']) assert.deepEqual(after[key],preNight[key]);
        check('Exact pre-night finalizer checksum, intended guard-only change and permission preservation', true);
      }
    }
    stage = 'post-replay assertions';
    check('All 29 migrations executed in order', results.migrations_applied.length === 29);
    check('No migration invoked HTTP', (await one('select count(*)::int n from net.calls')).n === 0);
    const cron = await one('select count(*)::int n,min(schedule) schedule from cron.job');
    check('Two-minute cron intention stored but never executed', cron.n === 1 && cron.schedule === '*/2 * * * *');
    check('No real extension loaded', (await one("select count(*)::int n from pg_extension where extname in ('pg_net','pg_cron','supabase_vault')")).n === 0);
    check('Missing preview token remains unprovisioned', (await one("select count(*)::int n from vault.secrets where name='maceda_preview_webhook_token'")).n === 0);
    const permissions = await one("select has_function_privilege('anon','public.finalize_visualizer_quote(uuid,uuid,text,jsonb)','execute') a,has_function_privilege('authenticated','public.finalize_visualizer_quote(uuid,uuid,text,jsonb)','execute') u,has_function_privilege('service_role','public.finalize_visualizer_quote(uuid,uuid,text,jsonb)','execute') s,has_function_privilege('anon','public.store_stripe_deposit_webhook_secret(text)','execute') w,has_function_privilege('authenticated','public.get_maceda_deposit_trigger_token()','execute') t");
    assert.deepEqual(permissions,{ a:false,u:false,s:true,w:false,t:false });
    check('Finalizer and secret RPC permission boundaries preserved', true);
    const productAccess = await one("select count(*)::int n from pg_tables where schemaname='public' and tablename like 'pe\\_%' escape '\\' and (not rowsecurity or has_table_privilege('anon',quote_ident(schemaname)||'.'||quote_ident(tablename),'SELECT') or has_table_privilege('authenticated',quote_ident(schemaname)||'.'||quote_ident(tablename),'SELECT'))");
    check('Product Engine tables RLS-enabled and not readable by public client roles', productAccess.n === 0);

    const beforeNotice = notices.length;
    await db.exec("insert into public.quotes(id,name,phone,email,address,sms_opt_in,photo_paths) values('40000000-0000-0000-0000-000000000001','SYNTHETIC','0000000000','test@example.invalid','TEST ONLY',true,array['synthetic/photo.jpg']);", { onNotice: notice => notices.push(notice.message || String(notice)) });
    check('Missing preview token emits warning and skips callback', notices.slice(beforeNotice).some(n => n.includes('preview webhook token is missing')) && (await one('select count(*)::int n from net.calls')).n === 0);
    // Explicitly provoke a deposit callback; it must be an inert recorded intention.
    await db.exec("update public.quotes set quote_amount=100,deposit_status='awaiting_deposit' where id='40000000-0000-0000-0000-000000000001';");
    check('Deposit callback reaches only inert SQL recorder', (await one('select count(*)::int n from net.calls')).n === 1);

    const sid='10000000-0000-0000-0000-000000000001',rid='20000000-0000-0000-0000-000000000001',qid='30000000-0000-0000-0000-000000000001';
    const dest=qid+'/visualizer-'+rid+'.png';
    const contact={name:'SYNTHETIC TEST',phone:'0000000000',email:'test@example.invalid',address:'TEST ONLY',sms_opt_in:true,marketing_attribution:{utm_source:'door_hanger',landing_page:'/christmas-light-installation-pasadena/',email:'must-not-persist@example.invalid'}};
    const good={passed:true,review:{pass:true,night:true,photorealistic:true,architecture_preserved:true,selection_followed:true,failures:[]}};
    async function seed(renderer='ai-night-v1',validation=good) {
      await db.exec('truncate public.quotes,public.visualizer_sessions,public.visualizer_renders,public.preview_versions,storage.objects,net.calls cascade;');
      await db.query("insert into public.visualizer_sessions(id,session_token_hash,status,current_render_id,design_revision) values($1,'SYNTHETIC','render_ready',$2,1)",[sid,rid]);
      await db.query("insert into public.visualizer_renders(id,session_id,stage,design_spec,validation_result) values($1,$2,'ready',$3,$4)",[rid,sid,JSON.stringify({contract_version:'maceda-concept/1',renderer,design_revision:1,source_photo_path:'synthetic/photo.jpg',selected_zones:['main_roofline']}),JSON.stringify(validation)]);
      await db.query('insert into public.quotes(id,visualizer_session_id) values($1,$2)',[qid,sid]);
      await db.query("insert into storage.objects(bucket_id,name) values('quote-previews',$1)",[dest]);
    }
    const submit = c => db.query('select public.finalize_visualizer_quote($1,$2,$3,$4) result',[sid,rid,dest,JSON.stringify(c || contact)]);
    for (const role of ['anon','authenticated']) {
      await seed(); await db.exec('set role '+role);
      try { await assert.rejects(() => submit(), /permission denied for function finalize_visualizer_quote/); }
      finally { await db.exec('reset role'); }
      check('Finalizer invocation actually denied for '+role,true);
    }
    await seed('ai-night-v1',{passed:true,review:{...good.review,architecture_preserved:false}});
    await assert.rejects(() => submit(), /Night preview has not passed review/);
    check('Rejected night review creates no preview or owner notifications',(await one('select count(*)::int n from public.preview_versions')).n===0 && (await one('select count(*)::int n from private.owner_notifications')).n===0);
    await seed(); await db.exec('update public.visualizer_sessions set design_revision=2');
    await assert.rejects(() => submit(), /Design changed/); check('Stale design rejected',true);
    await seed(); await db.exec('delete from storage.objects');
    await assert.rejects(() => submit(), /transfer incomplete/); check('Missing transferred image rejected',true);
    for (const renderer of ['deterministic-v1','ai-night-v1']) {
      await seed(renderer,renderer==='ai-night-v1'?good:{});
      await db.exec('set role service_role');
      try {
        assert.equal((await submit()).rows[0].result.preview_attached,true); await submit(); await submit();
      } finally { await db.exec('reset role'); }
      assert.equal((await one('select count(*)::int n from public.preview_versions')).n,1);
      assert.equal((await one('select count(*)::int n from private.owner_notifications')).n,2);
      const attribution=(await one('select marketing_attribution from public.quotes')).marketing_attribution;
      assert.equal(attribution.utm_source,'door_hanger'); assert.equal(attribution.landing_page,'/christmas-light-installation-pasadena/'); assert.equal(attribution.email,undefined);
      await db.exec("update public.quotes set marketing_attribution='{\"utm_source\":\"flyer\"}'");
      assert.equal((await one('select marketing_attribution from public.quotes')).marketing_attribution.utm_source,'door_hanger');
      check(renderer+' handoff succeeds as synthetic non-superuser service_role; owner outbox deduped; attribution sanitized/preserved',true);
    }
    check('Owner sending stays disabled by default',(await one('select enabled from private.owner_notification_config')).enabled===false);
    check('No actual network API was used', blockedAttempts===0 && globalThis.__migrationOfflineGuard.attempts===0);
    for (let i=0;i<sources.length;i++) assert.equal(hash(fs.readFileSync(path.join(MIGRATIONS,sources[i].file))),originalHashes[i]);
    check('All candidate source hashes unchanged after test',true);
    results.passed=true;
    results.network={node_permission_mode:true,node_builtin_barrier:true,actual_network_api_attempts:blockedAttempts+globalThis.__migrationOfflineGuard.attempts,external_callbacks_executed:0,cron_workers:0};
    results.warnings=['Not a proof of exact production/fresh-install schema equivalence.', 'No real Supabase extension, external provider, live secrets or customer records were exercised.', 'Production migrations/history must not be replayed or repaired by this test.'];
    console.log(JSON.stringify(results,null,2));
  } catch (error) {
    console.error(JSON.stringify({...results,stage,error:String(error.message).slice(0,500),sqlstate:error.code || null,network_api_attempts:blockedAttempts},null,2));
    process.exitCode=1;
  } finally { await db.close(); }
})().catch(error => { console.error(JSON.stringify({passed:false,error:String(error.message).slice(0,500)}));process.exitCode=1; });
