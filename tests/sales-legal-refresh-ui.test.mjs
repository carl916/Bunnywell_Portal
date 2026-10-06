import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTypescriptModule } from './helpers/load-typescript-module.mjs';

const context={snapshot:{building:{id:'building',name:'Test building'},plot:'Fixture',buyer:'Test buyer',terms:{},schedule:[],conveyancer:{shared_system_email:'legal@example.test'},sales_agent:{shared_system_email:'sales@example.test'},approver:{name:'Test developer'}},attempt:{workflow_status:'exchanged',exchanged_at:'2026-10-04'},emails:[],documents:[],events:[],actors:[]};
function nodes(node) { return [node,...(Array.isArray(node?.props?.children)?node.props.children:[node?.props?.children]).flat(Infinity).filter(Boolean).flatMap(nodes)]; }

for (const action of ['request_authority','send','confirm_exchange','finalize_completion_upload','approve_completion_package','confirm_completion']) {
  for (const failed of [false,true]) for (const savedEmail of action==='send' && failed ? [true,false] : [action==='send']) test(`legal UI ${action}: ${failed?'uncertain mutation reconciles and keeps failure':'success waits for scoped refresh'}${action==='send'?(savedEmail?' with saved email':' without saved email'):''}`,async()=>{
    const savedFetch=globalThis.fetch;const calls=[],states=[],changes=[],notices=[],previewWrites=[];let index=0;
    const react={useState(initial){const value=index++===0?context:typeof initial==='function'?initial():initial;const stateIndex=index-1;return [value,next=>{states.push(next);if(stateIndex===10)previewWrites.push(next);}];},useRef(initial){return {current:initial===''?'saved-instruction':initial};},useCallback(fn){return fn;},useEffect(){}};
    const {SalesLegalWorkflow}=loadTypescriptModule('src/components/portal/sales/SalesLegalWorkflow.tsx',{overrides:{react,'react/jsx-runtime':{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})},'@/lib/supabase/client':{createSupabaseBrowserClient:()=>({auth:{getSession:async()=>({data:{session:{access_token:'test'}},error:null})}})},'@/lib/sales/performance':{beginSalesMeasurement:()=>({mark(){},painted(){},finish(){}}),legalPerformanceAction:()=>action,salesNavigationReady(){}}}});
    globalThis.fetch=async(_url,options)=>{calls.push(options.method);return {ok:options.method==='GET'||!failed,json:async()=>options.method==='GET'?{...context,emails:savedEmail?[{id:'saved-instruction'}]:[],attempt:{...context.attempt,workflow_status:'completion_pending'}}:failed?{error:'Saved state may differ: delivery or finalisation uncertain'}:{}};};
    try {
      const tree=SalesLegalWorkflow({saleId:'sale-A',stage:'completion',role:'admin',onNotice:message=>notices.push(message),onChanged:async(sale,action)=>changes.push({sale,action})});
      const documents=nodes(tree).find(node=>node?.props?.run&&node?.props?.saleId==='sale-A');
      assert.ok(documents);
      assert.equal(await documents.props.run({action},'Success'),!failed);
      assert.deepEqual(calls,['POST','GET']);assert.deepEqual(changes,[{sale:'sale-A',action}]);
      assert.ok(states.some(state=>state?.attempt?.workflow_status==='completion_pending'));
      assert.deepEqual(notices,failed?[]:['Success']);
      if(failed)assert.ok(states.some(state=>state?.message?.includes('uncertain')));
      if(action==='send'&&failed)assert.deepEqual(previewWrites,savedEmail?[null]:[],'only a recorded email dismisses the obsolete preview');
    } finally {globalThis.fetch=savedFetch;}
  });
}
