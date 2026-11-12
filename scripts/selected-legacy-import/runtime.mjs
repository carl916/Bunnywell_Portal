import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
export const root=path.resolve(import.meta.dirname,'../..');
export const dir=path.resolve(process.env.SELECTED_LEGACY_IMPORT_DATA||path.join(root,'tmp/selected-legacy-import'));
export const integrationRoot=process.env.BUNNYWELL_INTEGRATION_WORKSPACE||'C:/Users/carlg/.codex/worktrees/wider-workspace-integration/Bunnywell_Portal';
export const SOURCE='vxkpvdtrldwwqiddoyof',DEST='mmwzhzziqvjbsphrkbqr';
export const buildings={
 'Forum House':'e120ef73-a720-4a25-ab99-362f21612118',
 'Priors Gate':'35de5f9d-3217-4a11-beaf-83519bda9e5b',
 'Trinity Point':'1f13454f-2e25-4ecd-8d9b-a9d0b9b4e14c',
};
fs.mkdirSync(dir,{recursive:true});
export const cliPath=process.env.SUPABASE_CLI_PATH||'C:/Users/carlg/AppData/Local/npm-cache/_npx/b118335b4cfa220d/node_modules/@supabase/cli-windows-x64/bin/supabase.exe';
export function cli(args){try{return execFileSync(cliPath,args,{cwd:root,encoding:'utf8',timeout:180000,maxBuffer:100e6,windowsHide:true,stdio:['ignore','pipe','pipe']});}catch(e){const f=path.join(dir,'last-cli-error.txt');fs.writeFileSync(f,String(e.stderr||e.stdout||e.message));throw Error('Supabase command failed; private details saved to '+f);}}
export function sql(project,query,{write=false}={}){
 if(![SOURCE,DEST].includes(project)||write&&project!==DEST)throw Error('Forbidden project/write');
 const f=path.join(dir,'query-'+randomUUID()+'.sql');fs.writeFileSync(f,query);
 try{const out=cli(['db','query','--remote='+project,'--file',f,'--output','json',...(write?['--yes']:['--read-only'])]);return JSON.parse(out).rows;}
 finally{fs.unlinkSync(f);}
}
export const q=s=>"'"+String(s).replaceAll("'","''")+"'";
export const ident=s=>'"'+s.replaceAll('"','""')+'"';
export const ids=Object.values(buildings).map(q).join(',');
export function save(name,value){fs.writeFileSync(path.join(dir,name+'.json'),JSON.stringify(value,null,2)+'\n');}
export const read=name=>JSON.parse(fs.readFileSync(path.join(dir,name+'.json'),'utf8'));
export const hash=x=>createHash('sha256').update(typeof x==='string'||Buffer.isBuffer(x)?x:JSON.stringify(x)).digest('hex');
export function keys(project){
 if(project!==DEST)throw Error('Source credentials must not be exported; use authenticated CLI downloads');
 const p=path.join(integrationRoot,'tmp/hosted-integration/api-keys.json');
 if(!fs.existsSync(p))throw Error('Missing private keys');
 const k=JSON.parse(fs.readFileSync(p,'utf8').replace(/^\uFEFF/,''));
 const service=k.find(x=>x.name==='service_role')?.api_key,anon=k.find(x=>x.name==='anon')?.api_key;
 for(const key of [service,anon])if(!key||JSON.parse(Buffer.from(key.split('.')[1],'base64url')).ref!==project)throw Error('Wrong key project');
 return{service,anon};
}
export async function storage(project,bucket,name,{bytes,contentType='application/octet-stream'}={}){
 if(bytes&&project!==DEST)throw Error('Source write forbidden');
 const key=keys(project).service;
 return fetch('https://'+project+'.supabase.co/storage/v1/object/'+encodeURIComponent(bucket)+'/'+name.split('/').map(encodeURIComponent).join('/'),{method:bytes?'POST':'GET',redirect:'error',headers:{apikey:key,Authorization:'Bearer '+key,...(bytes?{'Content-Type':contentType,'x-upsert':'false'}:{})},...(bytes?{body:bytes}:{})});
}
