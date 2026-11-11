import fs from 'node:fs';import {sql} from './runtime.mjs';
const result={at:new Date().toISOString(),environment:'bunnywell-backend-foundation',conditions:'Same larger synthetic dataset, 3 warm PostgreSQL execution plans per role/case; authenticated claims + SET LOCAL ROLE. Browser/REST role sessions tested separately.',stages:[]};
function measure(stage){for(const [role,user]of [['developer','b1700000-0000-4000-8000-000000000901'],['conveyancer','b1700000-0000-4000-8000-000000000907']]){
 const q=`select public.workspace_building_facts('b1700000-0000-4000-8000-000000000001',null,null,true)`;
 const output=sql(`begin;create function pg_temp.plan(q text) returns jsonb language plpgsql as $$declare j jsonb;begin execute 'explain(analyze,buffers,format json) '||q into j;return j;end$$;set local role authenticated;select set_config('request.jwt.claims','{"sub":"${user}","role":"authenticated"}',true);select jsonb_agg(pg_temp.plan('${q.replaceAll("'","''")}')) from generate_series(1,3);rollback;`);
 const line=output.split('\n').find(l=>l.startsWith('[['));if(!line)throw Error('Plan unavailable');const plans=JSON.parse(line);result.stages.push({stage,role,samples:plans.map(p=>({executionMs:p[0]['Execution Time'],planningMs:p[0]['Planning Time'],sharedHit:p[0].Plan['Shared Hit Blocks'],sharedRead:p[0].Plan['Shared Read Blocks']}))});console.log(result.stages.at(-1));
}fs.writeFileSync('artifacts/backend-foundation/query-plans.json',JSON.stringify(result,null,2));}
measure('before');sql(fs.readFileSync('docs/architecture-review/index-experiments/permission-query-tuning.sql','utf8'));measure('constant-permission-helpers');sql(fs.readFileSync('docs/architecture-review/index-experiments/read-indexes.sql','utf8'));sql('analyze;');measure('permission-helpers-and-candidate-indexes');

sql(fs.readFileSync('docs/architecture-review/index-experiments/restore.sql','utf8'));
