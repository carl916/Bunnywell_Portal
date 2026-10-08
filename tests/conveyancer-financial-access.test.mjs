import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { discussionDatabase } from './helpers/discussion-database.mjs';

test('existing forecast RLS denies external aggregate reads while retaining permitted sale records',async t=>{
  const f=await discussionDatabase();t.after(()=>f.db.close());await f.owner();
  await f.db.exec(`create function public.set_updated_at() returns trigger language plpgsql as $$begin new.updated_at=now();return new;end$$;`);
  await f.db.exec(readFileSync('supabase/migrations/20260722_sales_forecasting_core.sql','utf8'));
  await f.db.exec('grant select on sales_forecast_scenarios,sales_forecast_scenario_units to authenticated');
  const scenario=(await f.db.query("insert into sales_forecast_scenarios(building_id,name,results) values($1,'Synthetic forecast',$2) returning id",[f.ids.building,{gdv:1000000,net_proceeds:800000}])).rows[0].id;
  await f.db.query("insert into sales_forecast_scenario_units(scenario_id,building_id,unit_id,strategy,assumed_value) values($1,$2,$3,'sell',250000)",[scenario,f.ids.building,f.ids.unit]);
  for(const user of ['solicitor','agent']){
    await f.as(user);
    assert.equal((await f.db.query('select * from sales_forecast_scenarios')).rows.length,0);
    assert.equal((await f.db.query('select * from sales_forecast_scenario_units')).rows.length,0);
    assert.equal((await f.db.query('select * from unit_sale_attempts where id=$1',[f.ids.sale])).rows.length,1);
  }
  await f.as('developer');assert.equal((await f.db.query('select results from sales_forecast_scenarios')).rows[0].results.gdv,1000000);
  await f.owner();await f.db.query("update profiles set role='admin' where id=$1",[f.ids.developer]);
  await f.as('developer');assert.equal((await f.db.query('select assumed_value from sales_forecast_scenario_units')).rows[0].assumed_value,'250000.00');
});
