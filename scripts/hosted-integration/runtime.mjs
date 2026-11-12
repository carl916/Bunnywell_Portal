import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
export const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
export const project='mmwzhzziqvjbsphrkbqr',origin='https://'+project+'.supabase.co';
export const vercelProject='prj_YMaQDDgEtACwTijrmmh1SxQwsfe5',team='team_x65ctL8Fot37UcabAkdh8f72';
export const privateDir=path.join(root,'tmp/hosted-integration');
fs.mkdirSync(privateDir,{recursive:true});
export function cli(args){return execFileSync(process.execPath,[path.join(path.dirname(process.execPath),'node_modules/npm/bin/npx-cli.js'),'--yes','supabase@3.0.0',...args],{cwd:root,encoding:'utf8',timeout:180000,maxBuffer:8e6,windowsHide:true,stdio:['ignore','pipe','pipe']});}
export function sql(query,{readOnly=false}={}){
 const file=path.join(privateDir,'query-'+crypto.randomUUID()+'.sql');fs.writeFileSync(file,query);
 try{return cli(['db','query','--remote='+project,'--file',file,'--output','json',...(readOnly?['--read-only']:['--yes'])]);}
 finally{fs.unlinkSync(file);}
}
export function keys(){
 const all=JSON.parse(fs.readFileSync(path.join(privateDir,'api-keys.json'),'utf8').replace(/^\uFEFF/,''));
 const anon=all.find(k=>k.name==='anon')?.api_key;
 const service=all.find(k=>k.name==='service_role')?.api_key;
 for(const key of [anon,service])if(!key||JSON.parse(Buffer.from(key.split('.')[1],'base64url')).ref!==project)throw Error('Wrong hosted key project');
 return{anon,service};
}
export async function api(route,{method='GET',body,token,admin=false,headers={}}={}){
 if(!route.startsWith('/')||route.startsWith('//'))throw Error('Relative new-project route required');
 const k=keys();const key=admin?k.service:k.anon;
 return fetch(origin+route,{method,redirect:'error',headers:{apikey:key,Authorization:'Bearer '+(token??key),...(body&&!Buffer.isBuffer(body)?{'Content-Type':'application/json'}:{}),...headers},...(body?{body:Buffer.isBuffer(body)?body:JSON.stringify(body)}:{})});
}
export function saveEvidence(name,value){fs.mkdirSync(path.join(root,'artifacts/hosted-integration'),{recursive:true});fs.writeFileSync(path.join(root,'artifacts/hosted-integration',name+'.json'),JSON.stringify(value,null,2)+'\n');}
