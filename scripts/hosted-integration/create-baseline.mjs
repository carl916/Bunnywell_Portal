import fs from 'node:fs';import crypto from 'node:crypto';import assert from 'node:assert/strict';import {sql,root,project,privateDir,saveEvidence,cli} from './runtime.mjs';import path from 'node:path';
const guard=JSON.parse(fs.readFileSync(path.join(privateDir,'auth-config-after.json'),'utf8').replace(/^\uFEFF/,''));
assert.equal(guard.target.project_ref,project);assert.equal(guard.changes.filter(c=>c.declared).length,0);
const files=['supabase/baseline/application.sql','supabase/security-patches/20261111211706_foundation_scoped_security.sql','supabase/baseline/ownership.sql','supabase/baseline/imports.sql','supabase/baseline/workspace-reads.sql'];
const hashes=[];const sources=files.map((file,i)=>{let text=fs.readFileSync(path.join(root,file),'utf8');hashes.push({file,sha256:crypto.createHash('sha256').update(text.replaceAll('\r\n','\n')).digest('hex')});if(i){assert.equal((text.match(/^begin;\s*$/gim)||[]).length,1);assert.equal((text.match(/^commit;\s*$/gim)||[]).length,1);text=text.replace(/^begin;\s*$/im,'').replace(/^commit;\s*$/im,'');}return text;});
const schemaFile=path.join(privateDir,'baseline.sql');fs.writeFileSync(schemaFile,'BEGIN;\n'+sources.join('\n')+'\nCOMMIT;\n');
const at=new Date().toISOString();const began=Date.now();
try{cli(['db','query','--remote='+project,'--file',schemaFile,'--yes','--output','json']);}catch(e){fs.writeFileSync(path.join(privateDir,'baseline-error.log'),String(e.stderr||e.message));throw Error('New-project baseline transaction failed; inspect private baseline-error.log');}
const counts=sql("select (select count(*) from pg_tables where schemaname='public') as tables,(select count(*) from auth.users) as users,(select count(*) from storage.buckets) as buckets,(select count(*) from public.buildings) as buildings;",{readOnly:true});
saveEvidence('baseline',{at,project,ms:Date.now()-began,transactional:true,files:hashes,counts,legacyAccess:false});console.log(counts);
