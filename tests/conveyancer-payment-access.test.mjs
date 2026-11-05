import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
const migration='supabase/migrations/20261105140744_conveyancer_agent_fee_payment_access.sql';
const id=n=>'f5110000-0000-4000-8000-'+String(n).padStart(12,'0');
test('payment migration executes with authenticated and service-role identities',async t=>{
 const db=new PGlite();
 try {
 await db.exec(`
 create role authenticated; create role service_role bypassrls;
 create schema auth;
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 create function auth.role() returns text language sql stable as $$ select current_setting('request.jwt.claim.role',true) $$;
 grant usage on schema auth,public to authenticated,service_role;
 create table profiles(id uuid primary key,role text,active boolean,organisation_id uuid);
 create table unit_sale_attempts(id uuid primary key,building_id uuid);
 create table user_building_access(user_id uuid,building_id uuid);
 create table building_organisations(organisation_id uuid,building_id uuid,role_on_project text,active boolean);
 create table unit_sale_invoices(id uuid primary key,sale_attempt_id uuid,invoice_type text,approved_at timestamptz,status text,
 expected_payable_amount numeric,expected_gross_amount numeric,reservation_fee_deduction numeric default 0,agent_contribution_deduction numeric default 0,gross_amount numeric);
 create table unit_sale_invoice_payments(id uuid primary key default gen_random_uuid(),invoice_id uuid,sale_attempt_id uuid,
 payment_source text,payer_type text,amount numeric,paid_at date,recorded_by_user_id uuid,notes text,client_reference uuid unique,voided_at timestamptz);
 `);
 await db.exec(readFileSync(migration,'utf8'));
 await db.query("insert into profiles values($1,'developer',true,null),($2,'conveyancer',true,null),($3,'conveyancer',true,$4),($5,'conveyancer',false,null),($6,'sales_agent',true,null)",[id(1),id(2),id(3),id(4),id(5),id(6)]);
 await db.query('insert into unit_sale_attempts values($1,$2),($3,$4)',[id(10),id(20),id(11),id(21)]);
 await db.query("insert into unit_sale_invoices(id,sale_attempt_id,invoice_type,status,expected_payable_amount) values($1,$2,'sales_agent','approved',100),($3,$4,'sales_agent','approved',100)",[id(30),id(10),id(31),id(11)]);
 await db.query('insert into user_building_access values($1,$2)',[id(2),id(20)]);
 await db.query("insert into building_organisations values($1,$2,'conveyancer',true)",[id(4),id(20)]);
 async function run(name,user,{invoice=id(30),role='authenticated',actor=user,amount=10,expected,setup}={}) {
 await t.test(name,async()=>{
 await db.exec('begin');
 try {
 if(setup)await db.exec(setup);
 await db.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role',$2,true)",[user,role]);
 await db.exec('set local role '+role);
 const call=()=>db.query("select * from record_unit_sale_invoice_payment($1,'other',$2,current_date,null,$3,$4)",[invoice,amount,crypto.randomUUID(),actor]);
 if(expected)await assert.rejects(call(),expected);
 else {const r=(await call()).rows[0];assert.equal(r.created,true);assert.equal(Number(r.paid_amount),amount);assert.equal(Number(r.outstanding_balance),100-amount);}
 }finally{await db.exec('rollback');}
 });
 }
 await run('developer records without allocation',id(1));
 await run('conveyancer records with direct building access',id(2));
 await run('conveyancer records with organisation appointment',id(3));
 await run('service API preserves conveyancer actor',id(2),{role:'service_role'});
 await run('conveyancer cannot record another building',id(2),{invoice:id(31),expected:/sales access/});
 await run('service API cannot bypass conveyancer allocation',id(2),{role:'service_role',invoice:id(31),expected:/sales access/});
 await run('inactive conveyancer denied',id(5),{expected:/Only developers/});
 await run('sales agent denied',id(6),{expected:/Only developers/});
 await run('forged requester denied',id(2),{actor:id(1),expected:/cannot record this payment/});
 await run('inactive organisation appointment denied',id(3),{setup:'update building_organisations set active=false',expected:/sales access/});
 await run('unapproved invoice denied',id(2),{setup:"update unit_sale_invoices set status='uploaded'",expected:/Approve the invoice/});
 await run('overpayment denied',id(2),{amount:101,expected:/outstanding balance/});
 await run('zero amount denied',id(2),{amount:0,expected:/greater than zero/});
 }finally{await db.close();}
});

