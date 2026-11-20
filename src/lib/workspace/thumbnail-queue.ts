// Bound concurrent authenticated image reads; queued work is cancelled on unmount.
export function createThumbnailQueue(limit=3){
 let active=0;
 const waiting:Array<()=>void>=[];
 function pump(){while(active<limit&&waiting.length)waiting.shift()!();}
 return function queue<T>(work:()=>Promise<T>,signal:AbortSignal):Promise<T>{
  return new Promise((resolve,reject)=>{
   const cancel=()=>{const index=waiting.indexOf(start);if(index>=0)waiting.splice(index,1);reject(signal.reason??new DOMException("Aborted","AbortError"));};
   const start=()=>{signal.removeEventListener("abort",cancel);if(signal.aborted){cancel();return;}active++;void work().then(resolve,reject).finally(()=>{active--;pump();});};
   if(signal.aborted){cancel();return;}signal.addEventListener("abort",cancel,{once:true});waiting.push(start);pump();
  });
 };
}
export const queueThumbnail=createThumbnailQueue();
