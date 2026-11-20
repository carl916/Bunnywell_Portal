export const completionTasks = ["authority", "notice", "documents", "legal"] as const;
export type CompletionTask = typeof completionTasks[number];
export function completionTask(value: string | null): CompletionTask {
  return completionTasks.includes(value as CompletionTask) ? value as CompletionTask : "authority";
}

export const exchangeTasks = ['request', 'authority', 'record'] as const;
export type ExchangeTask = typeof exchangeTasks[number];
export function exchangeTask(value:string|null, exchanged=false):ExchangeTask {
 return exchangeTasks.includes(value as ExchangeTask)?value as ExchangeTask:exchanged?'record':'authority';
}

export function saleActionDestination(kind: string, anchor: string): {section:string; task?:CompletionTask|ExchangeTask} {
  const section=kind.startsWith("fee_")?"agent-fees":kind.startsWith("reservation")?"reservation":/deposit/.test(kind)?"deposits":/commercial/.test(kind)?"commercial":/^(notice|completion)-/.test(anchor)?"completion":/exchange|authority/.test(kind)&&!/completion/.test(kind)?"exchange":"completion";
  return {section,...(section==="completion"?{task:anchor.includes("authority")?"authority" as const:anchor.includes("arrangements")?"notice" as const:anchor.includes("legal")?"legal" as const:"documents" as const}:section==='exchange'?{task:['record_exchange','exchange_progress'].includes(kind)?'record' as const:['request_authority','authority_follow_up'].includes(kind)?'request' as const:'authority' as const}:{})};
}
