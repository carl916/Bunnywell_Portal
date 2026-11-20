import {SOURCE,sql,read,save,ids} from './runtime.mjs';
const extraction=read('source-extraction');
const requests=sql(SOURCE,`select coalesce(jsonb_agg(to_jsonb(r)),'[]') data from resident_access_requests r where exists(select 1 from units u where u.building_id in (${ids}) and r.requested_units::text like '%'||u.id::text||'%') or exists(select 1 from buildings b where b.id in (${ids}) and r.requested_units::text like '%'||b.id::text||'%')`)[0].data;
extraction.data.resident_access_requests=requests;extraction.supplementedAt=new Date().toISOString();save('source-extraction',extraction);save('source-counts',Object.fromEntries(Object.entries(extraction.data).map(([t,r])=>[t,r.length])));
console.log('Additional scoped resident access history',requests.length);
