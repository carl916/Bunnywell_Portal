import fs from 'node:fs';
const out='artifacts/performance/2026-10-05-targeted-region';
const read=n=>JSON.parse(fs.readFileSync(`${out}/${n}`));
const samples=read('samples.json'), summary=read('summary.json');
const quantile=(a,p)=>{a=a.filter(Number.isFinite).sort((a,b)=>a-b);if(!a.length)return null;const i=(a.length-1)*p;return a[Math.floor(i)]+(a[Math.ceil(i)]-a[Math.floor(i)])*(i-Math.floor(i));};
const stats=a=>({n:a.filter(Number.isFinite).length,median:quantile(a,.5),p25:quantile(a,.25),p75:quantile(a,.75),min:quantile(a,0),max:quantile(a,1)});
const core=r=>r.category!=='other-host'&&!/sale_comment_unread|sale_mentions|sale_activity_page|sale_comment_page|performance\/vitals/.test(r.endpoint);
const completion=s=>Math.max(s.readyMs,...s.requests.filter(core).map(r=>r.endMs??0));
const pairedSettled=summary.groups.map(g=>{
 const a=samples.filter(s=>s.region==='iad1'&&s.profile===g.profile&&s.action===g.action),b=samples.filter(s=>s.region==='fra1'&&s.profile===g.profile&&s.action===g.action);
 const pairs=a.flatMap(s=>{const other=b.find(b=>b.run===s.run);return other?[completion(other)-completion(s)]:[];});
 return {profile:g.profile,action:g.action,pairedCompleteActionFraMinusIadMs:stats(pairs),fraFasterPairs:pairs.filter(p=>p<0).length};
});
const maps=Object.fromEntries(['iad1','fra1'].map(region=>[region,new Map(samples.filter(s=>s.region===region).flatMap(s=>s.requests).filter(r=>r.assetSha256).map(r=>[r.assetPath,r.assetSha256]))]));
const paths=[...new Set([...maps.iad1.keys(),...maps.fra1.keys()])];
const assets=paths.map(path=>({path,iad1Sha256:maps.iad1.get(path)??null,fra1Sha256:maps.fra1.get(path)??null,identical:maps.iad1.get(path)===maps.fra1.get(path)}));
const directReads=[];
for(const region of ['iad1','fra1'])for(const profile of ['desktop','mobile-throttled'])for(const action of ['navigation.cold','navigation.repeat']){
 const selected=samples.filter(s=>s.region===region&&s.profile===profile&&s.action===action);
 const requests=selected.flatMap(s=>s.requests).filter(r=>r.category==='browser-supabase-data'&&core(r));
 directReads.push({region,profile,action,requestCount:requests.length,requestDurationMs:stats(requests.map(r=>r.durationMs)),firstStartMs:stats(selected.map(s=>Math.min(...s.requests.filter(r=>r.category==='browser-supabase-data'&&core(r)).map(r=>r.offsetMs)))),lastEndMs:stats(selected.map(s=>Math.max(...s.requests.filter(r=>r.category==='browser-supabase-data'&&core(r)).map(r=>r.endMs))))});
}
const mutationFile=`${out}/mutation-results.json`;
let mutation=null;
function spans(header){return Object.fromEntries((header??'').split(',').filter(Boolean).map(v=>[v.trim().split(';')[0],Number(/;dur=([\d.]+)/.exec(v)?.[1])]));}
if(fs.existsSync(mutationFile)){
 const r=read('mutation-results.json');
 mutation={completed:r.completed??false,consumedUnits:r.consumedUnits,matchedLegalSnapshots:r.matchedLegalSnapshots,protectedUnchanged:r.protectedUnchanged,failures:r.failures,sampleCount:r.samples.length,samples:r.samples.map(s=>{
  const post=s.requests.find(r=>r.category==='legal'&&r.method==='POST'),refresh=s.requests.filter(r=>r.category==='legal'&&r.method==='GET');
  return {region:s.region,unit:s.unit,profile:s.profile,status:s.status,completeActionMs:Math.max(s.readyMs,s.lastRequestEndMs),readinessMs:s.readyMs,settledRequests:s.settledRequests,legalPostBrowserMs:post?.durationMs,legalPostSpans:spans(post?.serverTiming),contextRefreshBrowserMs:refresh.map(r=>r.durationMs),contextRefreshOffsetMs:refresh.map(r=>r.offsetMs),contextRefreshEndMs:refresh.map(r=>r.endMs),contextRefreshSpans:refresh.map(r=>spans(r.serverTiming)),directRefreshRequests:s.requests.filter(r=>r.category==='direct-supabase').length,storageRequests:s.storageRequests,displayedStateChecked:s.displayedStateChecked,legalRegionsVerified:s.legalRegionsVerified,savedEmailState:s.savedEmailState};
 })};
 if(mutation.samples.length===2){const a=mutation.samples.find(s=>s.region==='iad1'),b=mutation.samples.find(s=>s.region==='fra1');mutation.pairedCompleteActionFraMinusIadMs=b.completeActionMs-a.completeActionMs;mutation.pairedLegalPostFraMinusIadMs=b.legalPostBrowserMs-a.legalPostBrowserMs;}
}
const details={pairedSettled,assets,staticAssetsIdentical:assets.filter(a=>a.identical).length,staticAssetsCompared:assets.length,directReads,mutation};
fs.writeFileSync(`${out}/details.json`,JSON.stringify(details,null,2));
console.log(JSON.stringify({pairedSettled,staticAssetsIdentical:details.staticAssetsIdentical,staticAssetsCompared:assets.length,mutation},null,2));
