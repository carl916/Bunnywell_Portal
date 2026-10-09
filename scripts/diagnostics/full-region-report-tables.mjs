// Turn retained timing metadata into reviewable distribution tables.
import fs from 'node:fs';
const directory=process.argv[2]??'test-results';
const browser=JSON.parse(fs.readFileSync(`${directory}/full-region-summary.json`,'utf8'));
const api=JSON.parse(fs.readFileSync(`${directory}/full-region-api.json`,'utf8'));
const n=x=>x==null?'—':Math.round(x).toLocaleString('en-GB');
const distribution=s=>`${n(s.p50)} / ${n(s.p75)} / ${n(s.min)}–${n(s.max)}`;
const q=(v,p)=>{v=v.filter(Number.isFinite).sort((a,b)=>a-b);if(!v.length)return null;const i=(v.length-1)*p;return v[Math.floor(i)]+(v[Math.ceil(i)]-v[Math.floor(i)])*(i-Math.floor(i));};
const stats=v=>({p50:q(v,.5),p75:q(v,.75),min:q(v,0),max:q(v,1)});
const lines=['# Whole portal region trial distributions','','Complete readiness is the later of usable controls plus two animation frames and the final critical request. Visual and actionable times are separate. All durations are milliseconds; bytes are response body bytes reported by Chromium. Polling is counted in requests and bytes but excluded from readiness. Each journey has eight A/B pairs except Snags, which has one per profile. Negative paired B−A means Frankfurt was faster.','','## Browser journeys','','| Role and profile and journey | A p50 / p75 / min–max | B p50 / p75 / min–max | Paired B−A p50 / p75 / min–max | Faster pairs |','|---|---:|---:|---:|---:|'];
for(const r of browser.rows)lines.push(`| ${r.journey} | ${distribution(r.a.ready)} | ${distribution(r.b.ready)} | ${distribution(r.paired)} | ${r.fasterPairs}/${r.paired.n} |`);
lines.push('','## Visual readiness and transferred data','','| Journey | Visual A / B p50 | Actionable A / B p50 | Requests A / B p50 | Bytes A / B p50 |','|---|---:|---:|---:|---:|');
for(const r of browser.rows)lines.push(`| ${r.journey} | ${n(r.a.visual.p50)} / ${n(r.b.visual.p50)} | ${n(r.a.actionable.p50)} / ${n(r.b.actionable.p50)} | ${n(r.a.requests.p50)} / ${n(r.b.requests.p50)} | ${n(r.a.bytes.p50)} / ${n(r.b.bytes.p50)} |`);
const groups=new Map();for(const s of api.samples){const key=`${s.role} ${s.endpoint} ${s.scope}`;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(s);}
lines.push('','## Direct API diagnostics','','Eight alternating pairs per endpoint, measured separately from the final browser batch. API time includes response body transfer; API bytes are decoded UTF-8 JSON size, not compressed wire size. Database spans are sums of overlapping remote fetches, not database CPU time or additive wall time. Uninstrumented endpoints have no inferred server breakdown.','','| Role and endpoint and scope | A p50 / p75 / min–max | B p50 / p75 / min–max | Paired B−A p50 / p75 / min–max | Bytes A / B p50 |','|---|---:|---:|---:|---:|');
const apiRows=[];
for(const [key,samples]of groups){const row={key};for(const variant of ['a','b']){const v=samples.filter(s=>s.variant===variant);row[variant]={duration:stats(v.map(s=>s.durationMs)),bytes:stats(v.map(s=>s.bytes)),spans:{}};for(const name of ['route','auth','db_read'])row[variant].spans[name]=stats(v.map(s=>Number(new RegExp(`(?:^|, )${name};dur=([\\d.]+)`).exec(s.serverTiming??'')?.[1])));}
row.paired=stats(samples.filter(s=>s.variant==='a').map(a=>samples.find(b=>b.variant==='b'&&b.run===a.run).durationMs-a.durationMs));apiRows.push(row);lines.push(`| ${key} | ${distribution(row.a.duration)} | ${distribution(row.b.duration)} | ${distribution(row.paired)} | ${n(row.a.bytes.p50)} / ${n(row.b.bytes.p50)} |`);}
lines.push('','## Server remote spans','','| Endpoint and scope | Route A / B p50 | Auth A / B p50 | Overlapping DB spans A / B p50 |','|---|---:|---:|---:|');
for(const r of apiRows)lines.push(`| ${r.key} | ${n(r.a.spans.route.p50)} / ${n(r.b.spans.route.p50)} | ${n(r.a.spans.auth.p50)} / ${n(r.b.spans.auth.p50)} | ${n(r.a.spans.db_read.p50)} / ${n(r.b.spans.db_read.p50)} |`);
fs.writeFileSync(`${directory}/full-region-distributions.md`,lines.join('\n')+'\n');
fs.writeFileSync(`${directory}/full-region-api-summary.json`,JSON.stringify(apiRows,null,2));
console.log(JSON.stringify({browserJourneys:browser.rows.length,apiJourneys:apiRows.length}));
