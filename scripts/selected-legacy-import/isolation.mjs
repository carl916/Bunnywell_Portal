import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {dir,cli,DEST,sql,keys,save} from './runtime.mjs';
const work=path.join(dir,'isolation-config');fs.mkdirSync(path.join(work,'supabase'),{recursive:true});
fs.writeFileSync(path.join(work,'supabase/config.toml'),`project_id="selected-legacy-import-read-only-check"
[auth]
enable_signup=false
[auth.hook.send_email]
enabled=true
uri="pg-functions://postgres/integration_controls/block_delivery"
[auth.hook.send_sms]
enabled=true
uri="pg-functions://postgres/integration_controls/block_delivery"
`);
const cfg=JSON.parse(cli(['config','diff','--remote='+DEST,'--workdir',work,'--output-format','json']));
save('outbound-config-check',cfg);
const drift=(cfg.changes||[]).filter(c=>c.declared);
assert.equal(drift.length,0,'Outbound isolation differs from required blocked configuration; inspect private diff');
const db=sql(DEST,"select (select count(*) from pg_extension where extname in ('pg_net','pg_cron','http')) outbound_extensions,has_function_privilege('supabase_auth_admin','integration_controls.block_delivery(jsonb)','EXECUTE') auth_hook_can_execute,not has_function_privilege('anon','integration_controls.block_delivery(jsonb)','EXECUTE') anonymous_denied,pg_get_functiondef('integration_controls.block_delivery(jsonb)'::regprocedure) hook_definition")[0];
assert.equal(db.outbound_extensions,0);assert(db.auth_hook_can_execute&&db.anonymous_denied);assert.match(db.hook_definition,/http_code.{0,4}403/);
const k=keys(DEST),response=await fetch('https://'+DEST+'.supabase.co/auth/v1/settings',{headers:{apikey:k.anon},redirect:'error'});assert(response.ok);const settings=await response.json();assert.equal(settings.disable_signup,true);
save('outbound-isolation',{at:new Date().toISOString(),project:DEST,configDrift:0,db,publicSignupDisabled:settings.disable_signup});console.log('Verified current email/SMS hooks block delivery; signup disabled; no cron/network extensions.');
