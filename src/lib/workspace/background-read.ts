// Yield through a paint before optional reads. The timeout is only the idle
// callback's starvation bound; browsers without it use the next event-loop turn.
export function scheduleBackgroundRead(read:()=>void){
 let idle:number|undefined,timer:ReturnType<typeof setTimeout>|undefined;
 const frame=requestAnimationFrame(()=>{
  if(typeof window.requestIdleCallback==='function')idle=window.requestIdleCallback(read,{timeout:1000});
  else timer=setTimeout(read,0);
 });
 return()=>{cancelAnimationFrame(frame);if(idle!==undefined)window.cancelIdleCallback(idle);if(timer!==undefined)clearTimeout(timer);};
}
