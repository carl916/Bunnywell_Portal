import { roles, type Role, type Scenario, type Section } from "./model";

type TaskCopy = { action: string; waiting: string; owner: Role; person: string; detail: string; deadline?: string; section: Section; recorded?: boolean };
// Fixture presentation only: ownership is not a permission grant or a workflow gate.
const tasks: Record<Scenario["id"], TaskCopy> = {
  "completion-review": { action: "Review both completion documents", waiting: "Awaiting developer document approval", owner: "developer", person: "Dana Miller", detail: "Completion statement and statement of account", deadline: "Completion due 3 Nov 2026", section: "completion" },
  "completion-query": { action: "Revise the queried completion statement", waiting: "Awaiting revised completion statement", owner: "conveyancer", person: "Jamie Ellis", detail: "Correct the service-charge apportionment to 3 November", deadline: "Completion due 3 Nov 2026", section: "completion" },
  "completion-completed": { action: "Review legal completion record", waiting: "Review legal completion record", owner: "conveyancer", person: "Jamie Ellis", detail: "Completed 3 Nov 2026 at 10:30", section: "completion", recorded: true },
  "fees-submit": { action: "Submit exchange fee invoice", waiting: "Awaiting exchange fee invoice", owner: "sales_agent", person: "Sam Taylor", detail: "Expected gross invoice £7,650", section: "agent-fees" },
  "fees-review": { action: "Review the £200 invoice discrepancy", waiting: "Awaiting developer invoice review", owner: "developer", person: "Dana Miller", detail: "Submitted £7,850; expected £7,650", section: "agent-fees" },
  "fees-paid": { action: "Reconcile outstanding agent fee payment", waiting: "Awaiting fee payment update", owner: "developer", person: "Dana Miller", detail: "£2,150 outstanding after credits and part payment", section: "agent-fees" },
  "reservation-draft": { action: "Prepare and submit reservation", waiting: "Awaiting reservation submission", owner: "sales_agent", person: "Sam Taylor", detail: "Buyer details and reservation form · draft 5 Oct", section: "reservation" },
  "reservation-review": { action: "Review submitted reservation", waiting: "Awaiting developer reservation approval", owner: "developer", person: "Dana Miller", detail: "Buyer details, form and agreed terms · submitted 6 Oct", section: "reservation" },
  "reservation-approved": { action: "Submit exchange fee invoice", waiting: "Awaiting exchange fee invoice", owner: "sales_agent", person: "Sam Taylor", detail: "Reservation approved 7 Oct · expected gross invoice £7,650", section: "agent-fees" },
};
export const queues = ["Our actions", "Waiting on others", "Recorded"] as const;
export function taskPresentation(scenario: Pick<Scenario, "id">, role: Role) {
  const task = tasks[scenario.id];
  const ours = task.owner === role;
  return { ...task, title: ours ? task.action : task.waiting, queue: task.recorded ? "Recorded" : ours ? "Our actions" : "Waiting on others", responsibility: task.person + " · " + roles[task.owner] };
}
export function roleContext(scenario: Pick<Scenario, "id">, role: Role) {
  const task = taskPresentation(scenario, role);
  return task.queue + " · " + task.responsibility + (task.deadline ? " · " + task.deadline : "");
}
