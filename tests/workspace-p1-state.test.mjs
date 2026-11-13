import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTypescriptModule} from './helpers/load-typescript-module.mjs';
const {createWorkspaceCredentials, createWorklistCache, filterWorklist} = loadTypescriptModule('src/lib/workspace/client-state.ts');
const session=(token='first',id='alice')=>({access_token:token,expires_at:100,user:{id}});
const scope={identity:'alice',role:'developer',organisationId:'org',accessRevision:'one',buildingId:'building-a'};
const row=(n)=>({buildingId:'building-a',unitId:String(n),saleId:String(n),unitNumber:String(n),buyerLabel:'Fictional buyer',stage:n%2?'exchanged':'for_sale',actions:[],historical:false});
const all=Array.from({length:45},(_,n)=>row(n+1));
const snapshot={scope,rows:all.slice(0,20),filterRows:all,counts:{units:45,complete:true,stages:{for_sale:22,exchanged:23}},page:{number:1,pages:3,total:45,size:20}};
test('credentials retain reader identity during focus/token rotation, but revoke old readers on identity change/sign-out',()=>{
 const store=createWorkspaceCredentials(),first=store.update(session());
 assert.equal(store.update(session()),first);assert.equal(store.update(session('rotated')),first);assert.equal(first.access_token,'rotated');
 const second=store.update(session('bob-token','bob'));assert.notEqual(first,second);assert.throws(()=>first.access_token,/Session changed/);
 store.clear();assert.throws(()=>second.access_token,/Session changed/);
});
test('complete authorised worklist filters all pages, clamps page, preserves floor order and global counts',()=>{
 const result=filterWorklist(snapshot,new URLSearchParams({stage:'exchanged',page:'5'}));
 assert.deepEqual(result.rows.map(r=>r.unitNumber),['41','43','45']);assert.equal(result.page.number,2);assert.equal(result.page.total,23);
 assert.equal(result.counts,snapshot.counts);assert.equal(result.filteredCounts.units,23);
 assert.equal(filterWorklist(snapshot,new URLSearchParams({q:'fictional buyer',stage:'missing'})).page.pages,1);
 assert.throws(()=>filterWorklist(snapshot,new URLSearchParams({queue:'unauthorised'})));
});
test('cache refuses incomplete, oversized, foreign, stale or revoked access and invalidates after writes',()=>{
 let time=0;const cache=createWorklistCache(()=>time),p=new URLSearchParams({page:'2'});
 cache.put({...snapshot,filterRows:undefined});assert.equal(cache.get(scope,p),null);
 cache.put(snapshot);assert.equal(cache.get(scope,p).rows[0].unitNumber,'21');
 for(const change of [{identity:'bob'},{role:'conveyancer'},{organisationId:'other'},{accessRevision:'two'},{buildingId:'building-b'}])assert.equal(cache.get({...scope,...change},p),null);
 time=30000;assert.equal(cache.get(scope,p),null);time=0;cache.clear();assert.equal(cache.get(scope,p),null);
 cache.put({...snapshot,filterRows:[{...all[0],buildingId:'building-b'}]});assert.equal(cache.get(scope,p),null);
 cache.put({...snapshot,filterRows:Array(201).fill(all[0])});assert.equal(cache.get(scope,p),null);
});
