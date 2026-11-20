export class WorkspaceRequestError extends Error {
 constructor(message:string,public status:number){super(message);}
}
export const accessUnavailable=(error:unknown)=>error instanceof WorkspaceRequestError&&[401,403,404].includes(error.status);
export type RecordReadState<T>={key:string;data?:T;loading:boolean;error:string};

// One mounted consumer owns one authorised record. Refreshing never changes
// identity; switching scope discards data. Abort AND generation protect races.
export function createRecordRead<T>(now=Date.now){
 let state:RecordReadState<T>={key:'',loading:false,error:''},generation=0,controller:AbortController|null=null;
 let pending:Promise<void>|null=null,lastLoaded=-Infinity,revision=0,pendingRevision=0;
 const listeners=new Set<()=>void>();
 const publish=(next:RecordReadState<T>)=>{state=next;listeners.forEach(listener=>listener());};
 const store={
  getSnapshot:()=>state,
  subscribe:(listener:()=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener)};},
  load(key:string,read:(signal:AbortSignal)=>Promise<T>,denied?:()=>void):Promise<void>{
   const id=++generation;controller?.abort();const current=controller=new AbortController();
   const requestedRevision=revision;
   pendingRevision=requestedRevision;
   const data=state.key===key?state.data:undefined;
   publish({key,data,loading:true,error:''});
   pending=(async()=>{
   await Promise.resolve();
   try{if(current.signal.aborted)return;const next=await read(current.signal);if(id===generation&&!current.signal.aborted&&requestedRevision===revision){lastLoaded=now();publish({key,data:next,loading:false,error:''});}}
   catch(error){if(id!==generation||current.signal.aborted)return;const revoked=accessUnavailable(error);publish({key,data:revoked?undefined:data,loading:false,error:error instanceof Error?error.message:'Record unavailable.'});if(revoked)denied?.();}
   finally{if(id===generation){pending=null;controller=null;if(state.loading)publish({...state,loading:false});}}
   })();
   return pending;
  },
  ensure(key:string,read:(signal:AbortSignal)=>Promise<T>,denied?:()=>void,maxAge=30_000):Promise<void>{
   if(state.key===key&&pending){
    const id=generation,requestedRevision=pendingRevision;
    return pending.then(()=>{if(id===generation&&requestedRevision!==revision)return store.ensure(key,read,denied,maxAge);});
   }
   if(state.key===key&&state.data!==undefined&&!state.error&&now()-lastLoaded<maxAge)return Promise.resolve();
   const requestedRevision=revision;
   const result=store.load(key,read,denied),id=generation;
   return result.then(()=>{
    // A save while a read is in flight needs one follow-up, never an old response.
    if(id===generation&&requestedRevision!==revision)return store.ensure(key,read,denied,maxAge);
   });
  },
  invalidate(){revision++;lastLoaded=-Infinity;},
  cancel(){generation++;controller?.abort();controller=null;pending=null;if(state.loading)publish({...state,loading:false});},
  clear(){store.cancel();lastLoaded=-Infinity;publish({key:'',loading:false,error:''});},
 };
 return store;
}

// A sale's visible record readers register here. Hidden Activity trees remove
// their effects, so only the current workflow step and Overview gate prefetch.
export function createRecordReadiness(){
 const records=new Map<object,boolean>(),listeners=new Set<()=>void>();
 const notify=()=>listeners.forEach(fn=>fn());
 return {
  getSnapshot:()=>records.size>0&&[...records.values()].every(Boolean),
  subscribe:(fn:()=>void)=>{listeners.add(fn);return()=>{listeners.delete(fn)};},
  set(record:object,ready:boolean){records.set(record,ready);notify();},
  remove(record:object){records.delete(record);notify();},
 };
}
