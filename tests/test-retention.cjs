const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const ts=require('typescript');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const baseline=JSON.parse(fs.readFileSync(path.resolve(__dirname,'schema-fixture.json'),'utf8'));
const quote=x=>'"'+x.replaceAll('"','""')+'"';
async function main(){
 const db=new PGlite();
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;CREATE SCHEMA private;CREATE SCHEMA extensions;
 CREATE FUNCTION extensions.gen_random_bytes(n integer) RETURNS bytea LANGUAGE sql AS $$SELECT decode(repeat('ab',n),'hex')$$;
 CREATE TABLE private.admin_users(user_id uuid PRIMARY KEY);
 INSERT INTO private.admin_users VALUES('d1e2ff19-84fd-4aca-8e7d-0a6d8dc26666'),('a47b5dfb-f38c-4b2c-9867-0e5b8db7087b');
 CREATE FUNCTION private.is_admin(check_user uuid) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$SELECT EXISTS(SELECT 1 FROM private.admin_users WHERE user_id=check_user)$$;`);
 await db.exec('REVOKE ALL ON FUNCTION private.is_admin(uuid) FROM PUBLIC;');
 for(const t of baseline.tables){
  for(const c of t.columns){const seq=c.default_value?.match(/nextval\('([^']+)'::regclass\)/);if(seq)await db.exec('CREATE SEQUENCE IF NOT EXISTS '+seq[1]);}
  const cols=t.columns.map(c=>quote(c.name)+' '+(c.data_type==='ARRAY'?c.format.slice(1)+'[]':c.format)+(c.identity_generation?' GENERATED '+c.identity_generation+' AS IDENTITY':c.default_value?' DEFAULT '+c.default_value:'')+(!c.options.includes('nullable')?' NOT NULL':'')+(c.options.includes('unique')?' UNIQUE':'')+(c.check?' CHECK('+c.check+')':''));
  if(t.primary_keys.length)cols.push('PRIMARY KEY('+t.primary_keys.map(quote).join(',')+')');
  await db.exec('CREATE TABLE '+t.name+'('+cols.join(',')+');'+(t.rls_enabled?'ALTER TABLE '+t.name+' ENABLE ROW LEVEL SECURITY;':''));
 }
 for(const fk of baseline.fks)await db.exec('ALTER TABLE public.'+quote(fk.table_name.replace(/^public\./,''))+' ADD CONSTRAINT '+quote(fk.conname)+' '+fk.definition);
 await db.exec('GRANT USAGE ON SCHEMA public,private TO service_role; GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role; GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;');
 await db.exec('BEGIN;'+fs.readFileSync(root+'/database/order-retention.sql','utf8'));
 const results=await db.exec(fs.readFileSync(root+'/tests/order-retention.sql','utf8'));
 console.log(JSON.stringify(results.at(-1).rows));
 await db.exec('ROLLBACK;');
 await db.close();
 for(const file of ['supabase/functions/admin-ops-api/index.ts']){
  const source=fs.readFileSync(root+'/'+file,'utf8');
  const result=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022},reportDiagnostics:true});
  const errors=result.diagnostics.filter(d=>d.category===ts.DiagnosticCategory.Error);
  if(errors.length)throw Error(file+': '+errors.map(d=>ts.flattenDiagnosticMessageText(d.messageText,'\n')).join('\n'));
  new vm.Script(result.outputText.replace(/^import .*;$/mg,''));
  console.log(file+': syntax passed');
 }
 const html=fs.readFileSync(root+'/inbox/index.html','utf8');
 const js=html.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
 new vm.Script('(async()=>{'+js.replace(/^import .*;$/mg,'')+'})');
 console.log('Admin HTML script: syntax passed');
}
main().catch(e=>{console.error(e.message);if(e.position)console.error('SQL position '+e.position);process.exitCode=1});

