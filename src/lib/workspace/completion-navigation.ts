export const completionTasks = ["authority", "notice", "documents", "legal"] as const;
export type CompletionTask = typeof completionTasks[number];
export function completionTask(value: string | null): CompletionTask {
  return completionTasks.includes(value as CompletionTask) ? value as CompletionTask : "authority";
}
