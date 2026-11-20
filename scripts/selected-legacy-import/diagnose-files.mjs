import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {read,save,cliPath,SOURCE,root,dir} from './runtime.mjs';
const failed=read('source-file-downloads').filter(f=>!f.sha256),groups={};
for(const f of failed)groups[f.bucket]=(groups[f.bucket]||0)+1;
console.log('Failed downloads by bucket',groups);
for(const bucket of Object.keys(groups)){
 const f=failed.find(f=>f.bucket===bucket);
 try{const output=execFileSync(cliPath,['storage','cp','--experimental','--remote='+SOURCE,'ss:///'+f.bucket+'/'+f.name,'./tmp/selected-legacy-import/retry-'+bucket],{cwd:root,encoding:'utf8',timeout:60000,windowsHide:true,stdio:['ignore','pipe','pipe']});console.log(bucket,'retry succeeded');}
 catch(e){fs.writeFileSync(path.join(dir,'file-error-'+bucket+'.json'),JSON.stringify({key:f.key,stdout:e.stdout,stderr:e.stderr},null,2));const parsed=String(e.stdout||'').split('\n').filter(Boolean).map(s=>{try{return JSON.parse(s);}catch{return{};}});console.log(bucket,parsed.map(x=>x.error||x).filter(x=>Object.keys(x).length));}
}
