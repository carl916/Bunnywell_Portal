import fs from 'node:fs';
import {SOURCE,DEST,sql,save,buildings,ids} from './runtime.mjs';
const catalog=`select jsonb_build_object(
 'at',now(),
 'columns',(select jsonb_agg(to_jsonb(c) order by table_schema,table_name,ordinal_position) from information_schema.columns c where table_schema in ('public','portal_audit','integration_controls')),
 'constraints',(select jsonb_agg(jsonb_build_object('table',c.conrelid::regclass::text,'name',conname,'type',contype,'definition',pg_get_constraintdef(c.oid),'validated',convalidated,'reference',case when confrelid<>0 then confrelid::regclass::text end)) from pg_constraint c join pg_namespace n on n.oid=c.connamespace where n.nspname in ('public','portal_audit','integration_controls')),
 'triggers',(select jsonb_agg(jsonb_build_object('table',t.tgrelid::regclass::text,'name',tgname,'definition',pg_get_triggerdef(t.oid),'enabled',tgenabled,'function',pg_get_functiondef(t.tgfoid))) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where not t.tgisinternal and n.nspname in ('public','portal_audit','integration_controls')),
 'functions',(select jsonb_agg(pg_get_functiondef(p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','portal_audit','integration_controls') and p.prokind='f'),
 'policies',(select jsonb_agg(to_jsonb(p)) from pg_policies p where schemaname in ('public','portal_audit','storage','integration_controls')),
 'grants',(select jsonb_agg(to_jsonb(g)) from information_schema.role_table_grants g where table_schema in ('public','portal_audit','integration_controls')),
 'tables',(select jsonb_agg(jsonb_build_object('schema',n.nspname,'name',c.relname,'rls',c.relrowsecurity)) from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind='r' and n.nspname in ('public','portal_audit','integration_controls')),
 'buckets',(select jsonb_agg(to_jsonb(b)) from storage.buckets b),
 'extensions',(select jsonb_agg(extname) from pg_extension)
) catalog;`;
for(const [label,p] of [['source',SOURCE],['destination',DEST]]){const data=sql(p,catalog)[0].catalog;save(label+'-catalog',data);console.log(label,data.tables.length,'tables',data.triggers.length,'triggers');}
const exact=sql(SOURCE,`select id,name from buildings where id in (${ids}) order by name`);
for(const b of exact)if(buildings[b.name]!==b.id)throw Error('Building mismatch');
save('source-buildings',exact);console.log(exact);
