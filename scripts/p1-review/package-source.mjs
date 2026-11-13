import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';

// Use the existing integration deployment's curated source tree, adding only
// this change's new runtime files. Never include local credentials or evidence.
const baseline=JSON.parse(fs.readFileSync('artifacts/p1-review/source-baseline.json','utf8'));
const files=new Map(baseline.map(f=>[f.file,f]));
const added=execFileSync('git',['diff','--name-only','--diff-filter=A','7acee2a','--','src'],{encoding:'utf8'})+'\n'+execFileSync('git',['ls-files','--others','--exclude-standard','src'],{encoding:'utf8'});
for(const file of added.split(/\r?\n/).filter(Boolean))files.set(file,files.get(file)||{file});
function source(file){
 if(!files.has(file)||file.includes('..')||!/^([a-zA-Z0-9_./()[\]-]+)$/.test(file))throw Error('Invalid source path');
 const local=file==='vercel.json'?'hosted-integration/vercel.json':file;
 let data=fs.readFileSync(local);
 if(createHash('sha1').update(data).digest('hex')===files.get(file).sha)return data;
 if(/\.(?:tsx?|jsx?|mjs|json|css|svg)$/.test(file))data=Buffer.from(data.toString('utf8').replace(/^\uFEFF/,'').replaceAll('\r\n','\n'));
 return data;
}
if(process.argv[2]==='--file'){
 const file=process.argv[3];console.log(JSON.stringify({file,base64:source(file).toString('base64')}));
}else{
 const manifest=[...files.values()].map(({file,sha:previous})=>{const data=source(file),sha=createHash('sha1').update(data).digest('hex');return {file,sha,size:data.length,changed:sha!==previous};});
 fs.mkdirSync('tmp',{recursive:true});fs.writeFileSync('tmp/p1-deployment-manifest.json',JSON.stringify(manifest,null,2));
 console.log(JSON.stringify(manifest));
}
