import { assertWorkspace, sameScope, type Scope, type Workspace } from "./contracts";
export type State={scope:Scope|null;snapshot:Workspace|null;loading:boolean;error:string};
export function createWorkspaceSession(load:(scope:Scope,signal:AbortSignal)=>Promise<Workspace>, fixtureOnly = true) {
  let state:State={scope:null,snapshot:null,loading:false,error:""},generation=0,controller:AbortController|null=null;
  const listeners=new Set<()=>void>();
  const publish=(next:State)=>{state=next;listeners.forEach(f=>f());};
  return {
    getSnapshot:()=>state,
    subscribe:(f:()=>void)=>{listeners.add(f);return()=>{listeners.delete(f);};},
    async select(scope:Scope,force=false) {
      if(!force&&state.scope&&sameScope(state.scope,scope)&&(state.snapshot||state.loading))return;
      const token=++generation;controller?.abort();controller=new AbortController();const current=controller;
      // Synchronous invalidation before the selected identity can publish any rows.
      publish({scope,snapshot:null,loading:true,error:""});
      try {
        const snapshot=assertWorkspace(await load(scope,current.signal),scope,fixtureOnly);
        if(token!==generation||current.signal.aborted)return;
        publish({scope,snapshot,loading:false,error:""});
      } catch(e) {
        if(token!==generation||current.signal.aborted)return;
        publish({scope,snapshot:null,loading:false,error:e instanceof Error?e.message:"Workspace unavailable"});
      }
    },
    clear(){++generation;controller?.abort();controller=null;publish({scope:null,snapshot:null,loading:false,error:""});},
  };
}

