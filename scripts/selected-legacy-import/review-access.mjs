import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {read,save,sql,DEST,dir,q,integrationRoot,buildings} from './runtime.mjs';
const credentials=JSON.parse(fs.readFileSync(path.join(integrationRoot,'tmp/hosted-integration/test-access.json')));assert.equal(credentials.project,DEST);
const file=path.join(dir,'review-building-access.json');
const grants=fs.existsSync(file)?read('review-building-access'):[...Object.values(buildings).map(building=>({alias:'conveyancer',building})),...['Forum House','Priors Gate'].map(name=>({alias:'agent',building:buildings[name]}))].map(g=>({...g,id:randomUUID(),user:credentials.accounts.find(a=>a.alias===g.alias).id}));
save('review-building-access',grants);
for(const g of grants){
 const role=g.alias==='agent'?'sales_agent':'conveyancer';
 const [profile]=sql(DEST,`select id,role,active from profiles where id=${q(g.user)}`);assert.equal(profile.role,role);assert.equal(profile.active,true);
 const existing=sql(DEST,`select id,user_id,building_id,role_on_building from user_building_access where user_id=${q(g.user)} and building_id=${q(g.building)}`);
 if(existing.length){assert.equal(existing[0].id,g.id,'Unrecognised existing review access');assert.equal(existing[0].role_on_building,role);continue;}
 sql(DEST,`insert into user_building_access(id,user_id,building_id,role_on_building) values(${q(g.id)},${q(g.user)},${q(g.building)},${q(role)})`,{write:true});
}
console.log('Scoped access added only for existing integration review accounts:',grants.length);
