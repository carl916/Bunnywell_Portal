import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTypescriptModule } from './helpers/load-typescript-module.mjs';

test('a downloaded PDF is stored without invoking the send action',async()=>{
  const requests=[],uploads=[];
  const client={auth:{getSession:async()=>({data:{session:{access_token:'test-token'}}})},storage:{from:bucket=>({uploadToSignedUrl:async(...args)=>{uploads.push({bucket,args});return{error:null};}})}};
  const {storeGeneratedReport}=loadTypescriptModule('src/lib/reports/store-generated-report.ts');
  await storeGeneratedReport(client,new Blob(['%PDF-test'],{type:'application/pdf'}),{buildingId:'b',locationType:'unit',unitId:'u',communalAreaId:null,locationLabel:'Unit 101',includePhotos:true,includeClosedSnags:false,snagIds:['s'],filename:'report'},async(url,options)=>{
    const body=JSON.parse(options.body);requests.push(body);return Response.json(body.action==='prepare_upload'?{filePath:'reports/b/example.pdf',token:'upload'}:{stored:true});
  });
  assert.deepEqual(requests.map(r=>r.action),['prepare_upload','store']);assert.equal(uploads[0].bucket,'snag-reports');assert.deepEqual(requests[1].snagIds,['s']);
});
test('report archival does not silently succeed when the upload fails',async()=>{
  const {storeGeneratedReport}=loadTypescriptModule('src/lib/reports/store-generated-report.ts');
  const client={auth:{getSession:async()=>({data:{session:{access_token:'test'}}})},storage:{from:()=>({uploadToSignedUrl:async()=>({error:new Error('Upload failed')})})}};
  await assert.rejects(storeGeneratedReport(client,new Blob(['test']),{buildingId:'b'},async()=>Response.json({filePath:'reports/b/test.pdf',token:'test'})),/Upload failed/);
});
test('store endpoint records report items without recipients or outgoing email',async t=>{
  const saved=[],old={...process.env};
  Object.assign(process.env,{NEXT_PUBLIC_SUPABASE_URL:'https://example.test',NEXT_PUBLIC_SUPABASE_ANON_KEY:'anon-test',SUPABASE_SERVICE_ROLE_KEY:'service-test'});
  t.after(()=>{for(const k of ['NEXT_PUBLIC_SUPABASE_URL','NEXT_PUBLIC_SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY'])if(old[k]===undefined)delete process.env[k];else process.env[k]=old[k];});
  const client={auth:{getUser:async()=>({data:{user:{id:'admin'}},error:null})},storage:{from:()=>({info:async()=>({data:{size:100,contentType:'application/pdf'}}),createSignedUrl:async()=>({data:{signedUrl:'https://example.test/signed'}})})},from(table){
    const query={select(){return query;},eq(){return query;},in(){return query;},insert(value){saved.push({table,value});return query;},maybeSingle(){return Promise.resolve({data:table==='profiles'?{id:'admin',active:true,role:'admin'}:{id:'b',name:'Example'}});},single(){return Promise.resolve({data:{id:'report'}});},then(resolve){return Promise.resolve({data:table==='snags'?[{id:'s',building_id:'b',unit_id:'u',status:'open'}]:[],error:null}).then(resolve);}};
    if(table==='snag_report_recipients')throw new Error('No recipients should be created');return query;
  }};
  const route=loadTypescriptModule('src/app/api/snag-reports/send/route.ts',{overrides:{'@supabase/supabase-js':{createClient:()=>client}}});
  const result=await route.POST(new Request('https://portal.example/api/snag-reports/send',{method:'POST',headers:{authorization:'Bearer test','content-type':'application/json'},body:JSON.stringify({action:'store',buildingId:'b',locationType:'unit',unitId:'u',snagIds:['s'],filePath:'reports/b/example.pdf'})}));
  assert.equal(result.status,200);assert.equal((await result.json()).stored,true);
  assert.equal(saved.find(s=>s.table==='snag_reports').value.sent_at,null);assert.equal(saved.find(s=>s.table==='snag_report_items').value[0].snag_id,'s');
});
