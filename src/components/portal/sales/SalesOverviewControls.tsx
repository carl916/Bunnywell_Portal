"use client";

import { SALES_CATEGORIES, type SalesCategory } from "@/lib/dashboard/work-classification";
import { INITIAL_SALES_OVERVIEW, type SalesOverviewFilters } from "@/lib/sales/developer-overview";
import { formatGbp } from "@/lib/sales/currency";
import styles from "./SalesOverviewControls.module.css";

export type SalesStageTotal = { status: string; label: string; count: number; value: number | null };

export function SalesOverviewControls({ stages, scope, filters, onFilters, loading = false, actionsUnavailable = false, categories = SALES_CATEGORIES }: {
  stages: SalesStageTotal[]; scope: string; filters: SalesOverviewFilters; onFilters: (next: SalesOverviewFilters) => void;
  loading?: boolean; actionsUnavailable?: boolean; categories?: Partial<Record<SalesCategory, string>>;
}) {
  const change = (patch: Partial<SalesOverviewFilters>) => onFilters({ ...filters, ...patch, page: 1 });
  const all = { status: "all", label: "All stages", count: stages.reduce((sum, stage) => sum + stage.count, 0),
    value: stages.some(stage => stage.value !== null) ? stages.reduce((sum, stage) => sum + (stage.value ?? 0), 0) : null };
  return <>
    <p className={styles.scope}>Pipeline scope: {scope}. Totals cover all authorised sales-route units in this scope, before table refinements.</p>
    <div className={styles.stages} role="group" aria-label="Sales stage">
      {[all, ...stages].map(stage => <button key={stage.status} type="button" aria-label={stage.label}
        aria-describedby={`sales-stage-total-${stage.status}`} aria-pressed={filters.stage === stage.status}
        onClick={() => { if (filters.stage !== stage.status) change({ stage: stage.status }); }}>
        <span className={styles.stageLabel}>{stage.label}</span>
        <span className={styles.total} id={`sales-stage-total-${stage.status}`}>
          <strong>{loading ? "—" : stage.count}</strong>
          {stage.value !== null && <span>{loading ? "Loading…" : formatGbp(stage.value)}</span>}
        </span>
      </button>)}
    </div>
    <div className={styles.controls}>
      <label>Action with<select value={filters.work} disabled={actionsUnavailable} onChange={event => change({ work: event.target.value as SalesOverviewFilters["work"] })}>
        <option value="all">All teams</option><option value="ours">Our team</option><option value="others">Other teams</option>
      </select></label>
      <label>Action category<select value={filters.category} disabled={actionsUnavailable} onChange={event => change({ category: event.target.value as SalesOverviewFilters["category"] })}>
        <option value="">All action categories</option>{Object.entries(categories).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </select></label>
      <label className={styles.search}>Search<input type="search" placeholder="Unit or building" value={filters.search} maxLength={200} onChange={event => change({ search: event.target.value })} /></label>
      <button type="button" className="secondary" onClick={() => onFilters(INITIAL_SALES_OVERVIEW)}>Reset filters</button>
    </div>
    <p className={styles.refinements} aria-label="Active refinements">
      {filters.stage === "all" ? "All stages" : stages.find(stage => stage.status === filters.stage)?.label} · {({ all: "All teams", ours: "Our team", others: "Other teams" })[filters.work]} · {filters.category ? SALES_CATEGORIES[filters.category] : "All action categories"}{filters.search.trim() && <> · Search: “{filters.search.trim()}”</>}
    </p>
  </>;
}
