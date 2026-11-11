import {spawn} from 'node:child_process';
import {writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const child=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port','0'],{windowsHide:true,env:{...process.env,STAGING_WEB_VITALS:'0',SALES_PERF_LOCAL:'0'},stdio:['ignore','pipe','pipe']});
let output='';
try {
 const origin=await new Promise((resolve,reject)=>{
  const timeout=setTimeout(()=>reject(new Error('Production server did not become ready')),20000);
  const read=data=>{output+=data.toString();if(output.includes('Ready')){const match=output.match(/http:\/\/127\.0\.0\.1:\d+/);if(match){clearTimeout(timeout);resolve(match[0]);}}};
  child.stdout.on('data',read);child.stderr.on('data',read);child.once('error',reject);
  child.once('exit',code=>{clearTimeout(timeout);reject(new Error('Server exited '+code+'\n'+output));});
 });
 const checks=[];
 for(const query of ['','?building=willow&unit=lg10&scenario=completion-review','?building=orchard&unit=orchard-g11&conversation=long']){
  const response=await fetch(origin+'/dev/sales-workspace'+query,{redirect:'manual'});
  assert.equal(response.status,404);checks.push({path:'/dev/sales-workspace'+query,status:response.status});
 }
 await writeFile('artifacts/permanent-discussion/production-check.json',JSON.stringify({passed:true,checks},null,2));
 console.log('PASS: three production route variants return 404');
}finally{child.kill();}
