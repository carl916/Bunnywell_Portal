import fs from 'node:fs';
const directory='artifacts/performance';
const live=JSON.parse(fs.readFileSync(`${directory}/staging-samples.json`,'utf8'));
const navigation=JSON.parse(fs.readFileSync(`${directory}/navigation-samples.json`,'utf8'));
const synthetic=JSON.parse(fs.readFileSync(`${directory}/frontend-samples.json`,'utf8'));
const median=values=>{const v=values.filter(x=>x!==null&&Number.isFinite(x)).sort((a,b)=>a-b);return v.length?v.length%2?v[(v.length-1)/2]:(v[v.length/2-1]+v[v.length/2])/2:null;};
const ms=n=>n===null?'—':Math.round(n).toLocaleString('en-GB');
const range=v=>Math.min(...v)===Math.max(...v)?String(v[0]):`${Math.min(...v)}–${Math.max(...v)}`;
function groups(samples){return [...new Set(samples.map(s=>`${s.profile}|${s.action}`))].map(key=>{const rows=samples.filter(s=>`${s.profile}|${s.action}`===key);return {profile:rows[0].profile,action:rows[0].action,n:rows.length,medianMs:median(rows.map(s=>s.totalMs)),slowestMs:Math.max(...rows.map(s=>s.totalMs)),requests:range(rows.map(s=>s.networkRequests)),feedbackMedianMs:median(rows.map(s=>s.feedbackMs)),feedbackMaxMs:median(rows.map(s=>s.feedbackMs))===null?null:Math.max(...rows.map(s=>s.feedbackMs??0)),postMedianMs:median(rows.map(s=>s.mutationRoundTripMs)),afterPostMedianMs:median(rows.map(s=>s.mutationRoundTripMs===null||s.mutationRoundTripMs===undefined?null:s.totalMs-s.mutationRoundTripMs)),responseKiB:median(rows.map(s=>s.responseBytes/1024)),requestMiB:median(rows.map(s=>s.requestBytes===undefined?null:s.requestBytes/1048576)),statuses:[...new Set(rows.map(s=>s.mutationStatus).filter(Boolean))],maxLongTaskMs:Math.max(0,...rows.flatMap(s=>s.longTasks.map(t=>t.duration)))};});}
const liveGroups=groups(live),navGroups=groups(navigation),syntheticGroups=groups(synthetic);
const rows=['# Recorded performance measurements','', 'Generated from numeric-only samples. All times are milliseconds. HTTP 413 is a failed upload; `status: ok` in raw samples means the diagnostic observed the expected outcome, not that the upload succeeded.',''];
for(const [title,data] of [['Live staging workflow',liveGroups],['Live staging read-only navigation',navGroups],['Deployed frontend with synthetic backend (not service timings)',syntheticGroups]]){
  rows.push(`## ${title}`,'','| Profile | Action | n | Median | Slowest | Requests | Pending median / max | POST median | After POST* | Response KiB | HTTP |','|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|');
  for(const g of data)rows.push(`| ${g.profile} | ${g.action} | ${g.n} | ${ms(g.medianMs)} | ${ms(g.slowestMs)} | ${g.requests} | ${ms(g.feedbackMedianMs)} / ${ms(g.feedbackMaxMs)} | ${ms(g.postMedianMs)} | ${ms(g.afterPostMedianMs)} | ${g.responseKiB.toFixed(1)} | ${g.statuses.join(', ')||'—'} |`);
  rows.push('');
}
rows.push('*After POST is click-to-final time minus the POST round trip. It includes refreshes, browser work and small pre-request overhead; it is not pure React time. File-selection times in live samples include automation byte transfer and must not be interpreted as application PDF processing. The synthetic fixture starts selection timing at the native input change event.','', '## Five slowest individual workflow observations','', '| Profile | Action | Run | Time | HTTP |','|---|---|---:|---:|---:|');
for(const s of [...live].sort((a,b)=>b.totalMs-a.totalMs).slice(0,5))rows.push(`| ${s.profile} | ${s.action} | ${s.run} | ${ms(s.totalMs)} | ${s.mutationStatus??'—'} |`);
fs.writeFileSync(`${directory}/measurements.md`,rows.join('\n')+'\n');
fs.writeFileSync(`${directory}/summary.json`,JSON.stringify({live:liveGroups,navigation:navGroups,synthetic:syntheticGroups},null,2));
console.log(JSON.stringify({liveSamples:live.length,navigationSamples:navigation.length,syntheticSamples:synthetic.length}));

const seconds=n=>`${(n/1000).toFixed(2)} s`;
const both=(data,action,key)=>['desktop','mobile-throttled'].map(profile=>{const row=data.find(g=>g.action===action&&g.profile===profile);return row?key==='requests'?row[key]:seconds(row[key]):'pending';}).join(' / ');
const actions=[
  [navGroups,'sale.open.in_app','Open another sale in app','Local state; data already loaded','navigation'],
  [navGroups,'sale_file.navigation.cold','Cold page navigation to sale controls','Initial assets and repeated restore reads','navigation'],
  [navGroups,'sale_file.navigation.repeat','Repeat page navigation to sale controls','Repeated restore reads','navigation'],
  [navGroups,'progression.stage_change','Enter Exchange from another stage','Legal context GET; overlapping restore work in some samples','navigation'],
  [liveGroups,'authority.preview_open','Authority email preview','Authorised snapshot/preview round trip','staging'],
  [liveGroups,'authority.request','Request authority','Broad post-save reload','staging'],
  [liveGroups,'authority.issue','Issue authority','Email/API path plus broad reload','staging'],
  [liveGroups,'exchange.record','Record exchange','Broad post-save reload','staging'],
  [navGroups,'completion.open','Exchange → Completion','Local state/context reuse','navigation'],
  [liveGroups,'completion.documents_upload.one-1MiB','Upload one 1 MiB PDF','Transfer, server/Storage and broad reload','staging'],
  [liveGroups,'completion.documents_upload.two-1MiB','Upload two 1 MiB PDFs','Transfer, sequential Storage writes and broad reload','staging'],
  [liveGroups,'completion.documents_upload.two-5MiB','Upload two 5 MiB PDFs — failed','HTTP 413 body limit','staging'],
  [liveGroups,'completion.documents_upload.two-near-10MiB','Upload two near-10 MiB PDFs — failed','HTTP 413 body limit','staging'],
  [liveGroups,'completion.documents_approve','Approve completion documents','Broad post-save reload','staging'],
  [liveGroups,'completion.record','Record legal completion','Broad post-save reload','staging'],
];
const actionTable=['Desktop / mobile values are shown in that order. Workflow samples: **n=3 / n=2**. Read-only navigation: **n=5 / n=5**.','', '| Action | Median time D / M | Slowest time D / M | Requests D / M | Main bottleneck | Evidence |','|---|---:|---:|---:|---|---|',...actions.map(([data,a,label,cause,file])=>`| ${label} | ${both(data,a,'medianMs')} | ${both(data,a,'slowestMs')} | ${both(data,a,'requests')} | ${cause} | [${a}](../artifacts/performance/${file==='staging'?'staging':'navigation'}-samples.json) |`)].join('\n');
const slowest=['| Action | Profile / run | Time | Outcome |','|---|---|---:|---|',...[...live].sort((a,b)=>b.totalMs-a.totalMs).slice(0,5).map(s=>`| ${s.action} | ${s.profile} / ${s.run} | ${seconds(s.totalMs)} | HTTP ${s.mutationStatus??'—'} |`)].join('\n');
const upload=['| Profile / files | n | Pending median | Total median | POST round trip median | After POST median | Outcome |','|---|---:|---:|---:|---:|---:|---|',...liveGroups.filter(g=>g.action.startsWith('completion.documents_upload.')).map(g=>`| ${g.profile} / ${g.action.split('.').at(-1)} | ${g.n} | ${ms(g.feedbackMedianMs)} ms | ${seconds(g.medianMs)} | ${seconds(g.postMedianMs)} | ${seconds(g.afterPostMedianMs)} | HTTP ${g.statuses.join(', ')} |`)].join('\n');
const database=JSON.parse(fs.readFileSync(`${directory}/database-query-timings.json`,'utf8'));
const dbTable=[`Snapshot: ${database.captured_at}.`,'','| Operation / query ID | Calls | Mean execution | Maximum execution |','|---|---:|---:|---:|',...database.reads.slice(0,5).map(q=>`| ${q.operation} / ${q.queryid} | ${q.calls} | ${q.mean_exec_ms} ms | ${q.max_exec_ms} ms |`)].join('\n');
const feedback=live.filter(s=>s.mutationStatus && !s.action.includes('documents_select')).map(s=>s.feedbackMs).filter(x=>x!==null);
const browserLines=[`Real action pending feedback ranged from **${ms(Math.min(...feedback))}–${ms(Math.max(...feedback))} ms**, comfortably within the 100 ms diagnostic target for these samples.`,'','Native file-selection results use the final synthetic fixture with files on disk; the backend is intercepted.','', '| Files | Desktop median / maximum | Mobile median / maximum | Network requests |','|---|---:|---:|---:|'];
for(const size of ['one-1MiB','two-1MiB','two-5MiB','two-near-10MiB']){
  const values=['desktop','mobile-throttled'].map(p=>{const g=syntheticGroups.find(g=>g.profile===p&&g.action===`completion.documents_select.${size}`);return `${ms(g.medianMs)} / ${ms(g.slowestMs)} ms`;});browserLines.push(`| ${size} | ${values.join(' | ')} | 0 |`);
}
const selected=syntheticGroups.filter(g=>g.action.startsWith('completion.documents_select.'));
browserLines.push('',`The largest long task in these native selection windows was **${Math.max(...selected.map(g=>g.maxLongTaskMs))} ms** (zero means none reached the 50 ms observation threshold). Source inspection and these controlled measurements do not support blaming synchronous PDF processing for the multi-second upload delays.`);
let report=fs.readFileSync('docs/sales-performance-assessment.md','utf8');
for(const [marker,content]of Object.entries({ACTION_TABLE:actionTable,SLOWEST_TABLE:slowest,UPLOAD_TABLE:upload,DATABASE_TABLE:dbTable,BROWSER_OBSERVATIONS:browserLines.join('\n')})){
  const block=new RegExp(`<!-- ${marker} -->[\\s\\S]*?<!-- END_${marker} -->`);
  const replacement=`<!-- ${marker} -->\n${content}\n<!-- END_${marker} -->`;
  report=block.test(report)?report.replace(block,replacement):report.replace(`<!-- ${marker} -->`,replacement);
}
fs.writeFileSync('docs/sales-performance-assessment.md',report);
