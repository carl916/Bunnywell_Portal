import type { SalesStageTask, SalesTaskStatus } from "@/lib/sales/stage-tasks";
import styles from "./SalesStageTasks.module.css";

const statusLabels: Record<SalesTaskStatus, string> = {
  complete: "Complete",
  current: "Current",
  locked: "Locked",
  changes_required: "Changes required",
  awaiting_resubmission: "Awaiting resubmission",
};

export function SalesStageTasks({ stage, steps }: { stage: string; steps: readonly SalesStageTask[] }) {
  return (
    <div className={`mt-6 ${styles.container}`}>
      <h4 className="text-sm font-bold text-[#0F3D2E]">{stage} tasks</h4>
      <ol className={`${styles.steps} ${steps.length === 3 ? styles.threeSteps : ""}`} aria-label={`${stage} tasks`}>
        {steps.map((step, index) => (
          <li key={step.title} className={`${styles.card} ${styles[step.status]}`} aria-current={step.status === "current" || step.status === "changes_required" ? "step" : undefined}>
            <div className={styles.heading}>
              <span className="text-xs font-bold uppercase text-[#617169]">Step {index + 1}</span>
              <span className={`${styles.status} text-xs font-bold`}>{statusLabels[step.status]}</span>
            </div>
            <p className="mt-1 font-bold text-[#0F3D2E]">{step.title}</p>
            {step.status === "complete"
              ? step.completedBy && <p className="mt-1 text-xs text-[#617169]">by {step.completedBy}</p>
              : step.responsibility && <p className="mt-1 text-xs text-[#617169]">{step.responsibility}</p>}
          </li>
        ))}
      </ol>
    </div>
  );
}
