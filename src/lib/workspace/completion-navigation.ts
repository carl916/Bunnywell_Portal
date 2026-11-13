export const completionTasks = ["authority", "notice", "documents", "legal"] as const;
export type CompletionTask = typeof completionTasks[number];
export function completionTask(value: string | null): CompletionTask {
  return completionTasks.includes(value as CompletionTask) ? value as CompletionTask : "authority";
}

export function saleActionDestination(kind: string, anchor: string): {section:string; task?:CompletionTask} {
  const section=kind.startsWith("fee_")?"agent-fees":kind.startsWith("reservation")?"reservation":/deposit/.test(kind)?"deposits":/commercial/.test(kind)?"commercial":/^(notice|completion)-/.test(anchor)?"completion":/exchange|authority/.test(kind)&&!/completion/.test(kind)?"exchange":"completion";
  return {section,...(section==="completion"?{task:anchor.includes("authority")?"authority" as const:anchor.includes("arrangements")?"notice" as const:anchor.includes("legal")?"legal" as const:"documents" as const}:{})};
}
