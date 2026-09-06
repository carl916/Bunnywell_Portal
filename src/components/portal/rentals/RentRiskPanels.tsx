"use client";

import { AlertTriangle, CheckCircle2, Clock3, ShieldAlert } from "lucide-react";
import {
  deriveTenancyRentRisk,
  interventionLabel,
  rentRiskStatusLabel,
  summarisePortfolioRentRisk,
  type RentalArrearsEpisode,
  type RentalArrearsEvent,
  type RentalImportHealth,
  type UnitRentRisk,
} from "@/lib/rentals/rent-risk";

function formatDate(value?: string | null) {
  if (!value) return "Not recorded";
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })
    .format(new Date(value));
}

function formatReportedArrears(value?: number | null) {
  if (value === null || value === undefined) return "Amount not confirmed";
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function sourceLabel(value: string) {
  return value.length > 72 ? `${value.slice(0, 69)}…` : value;
}

export function RentRiskAttentionBadge({ risk }: { risk?: UnitRentRisk }) {
  if (!risk) return <span className="text-[#89928d]">—</span>;
  if (risk.interventionLevel === "action_required") {
    return <span className="inline-flex items-center gap-1 rounded-full border border-[#e5b9b2] bg-[#fff3f1] px-2.5 py-1 text-xs font-bold text-[#8d382d]"><ShieldAlert size={13} />Action required</span>;
  }
  if (risk.interventionLevel === "watch") {
    return <span className="inline-flex items-center gap-1 rounded-full border border-[#e3c77b] bg-[#fff8e8] px-2.5 py-1 text-xs font-bold text-[#765a18]"><AlertTriangle size={13} />Watch</span>;
  }
  if (risk.hasCurrentArrears) {
    return <span className="inline-flex items-center gap-1 rounded-full border border-[#bfd8df] bg-[#eef8fa] px-2.5 py-1 text-xs font-bold text-[#315f6a]"><Clock3 size={13} />Information</span>;
  }
  return <span className="text-[#89928d]">—</span>;
}

function RiskMetric({ label, value, detail, tone = "normal" }: { label: string; value: string; detail?: string; tone?: "normal" | "attention" }) {
  return <div className="min-w-0 p-3 sm:p-4">
    <p className="text-xs font-bold uppercase tracking-[0.06em] text-[#617169]">{label}</p>
    <p className={`mt-1 text-xl font-bold ${tone === "attention" ? "text-[#8d382d]" : "text-[#0F3D2E]"}`}>{value}</p>
    {detail && <p className="mt-1 text-xs leading-relaxed text-[#6b7770]">{detail}</p>}
  </div>;
}

export function PortfolioRentRiskSection({
  episodes,
  currentTenancyIds,
  imports,
  buildingId,
  asOfDate,
  loading,
}: {
  episodes: RentalArrearsEpisode[];
  currentTenancyIds: string[];
  imports: RentalImportHealth[];
  buildingId: string;
  asOfDate: string;
  loading: boolean;
}) {
  const summary = summarisePortfolioRentRisk(episodes, currentTenancyIds, asOfDate);
  const lastImport = imports
    .filter((run) => !buildingId || run.building_id === buildingId)
    .sort((left, right) => (right.completed_at ?? "").localeCompare(left.completed_at ?? ""))[0] ?? null;

  return <article className="rounded-lg border border-[#d2ddd5] bg-[#f8fbf9] p-4 lg:col-span-2">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <div className="flex items-center gap-2"><ShieldAlert className="h-4 w-4 text-[#617169]" /><h4 className="font-bold text-[#34413a]">Rent risk</h4></div>
        <p className="mt-1 text-sm text-[#617169]">Management signals from material agent reports, not a live rent account.</p>
      </div>
      {lastImport && <span className="rounded-full border border-[#d9ded6] bg-white px-2.5 py-1 text-xs font-semibold text-[#617169]">Data through {formatDate(lastImport.data_as_of)}</span>}
    </div>
    {loading ? <p className="mt-4 text-sm text-[#617169]" role="status">Loading rent-risk data…</p> : <>
      <dl className="mt-4 grid grid-cols-2 divide-x divide-y divide-[#dfe6e1] overflow-hidden rounded-lg border border-[#d9ded6] bg-white lg:grid-cols-4 lg:divide-y-0">
        <RiskMetric label="Current reported episodes" value={String(summary.currentReportedEpisodes)} />
        <RiskMetric label="Repeat-arrears tenancies" value={String(summary.repeatArrearsTenancies)} />
        <RiskMetric label="Current tenancy action required" value={String(summary.actionRequiredTenancies)} tone={summary.actionRequiredTenancies > 0 ? "attention" : "normal"} />
        <RiskMetric label="Last data update" value={lastImport ? formatDate(lastImport.completed_at) : "Not imported"} detail={lastImport ? `${lastImport.episodes_imported} episodes · ${lastImport.events_imported} material events${lastImport.data_quality_issue_count ? ` · ${lastImport.data_quality_issue_count} data-quality issue${lastImport.data_quality_issue_count === 1 ? "" : "s"}` : ""}` : "No successful update for this scope"} />
      </dl>
      {lastImport?.data_quality_issue_count ? <p className="mt-3 text-xs text-[#765a18]">Import health records {lastImport.data_quality_issue_count} source-coverage or attribution issue{lastImport.data_quality_issue_count === 1 ? "" : "s"}. Missing or ambiguous coverage is excluded from current-tenancy reporting.</p> : null}
    </>}
  </article>;
}

export function RentPerformancePanel({
  currentTenancyId,
  episodes,
  events,
  asOfDate,
}: {
  currentTenancyId: string | null;
  episodes: RentalArrearsEpisode[];
  events: RentalArrearsEvent[];
  asOfDate: string;
}) {
  if (!currentTenancyId) return null;

  const tenancyEpisodes = episodes
    .filter((episode) => episode.tenancy_id === currentTenancyId)
    .sort((left, right) => right.first_reported_at.localeCompare(left.first_reported_at));
  const currentMetrics = deriveTenancyRentRisk(currentTenancyId, tenancyEpisodes, asOfDate);

  if (tenancyEpisodes.length === 0) {
    return <section className="rounded-lg border border-[#d9ded6] bg-[#fbfcfa] p-4">
      <div className="flex items-start gap-2">
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#286348]" />
        <div>
          <p className="font-semibold text-[#34413a]">No reported arrears for this tenancy.</p>
          <p className="mt-1 text-xs leading-relaxed text-[#7a847e]">Robinson Jackson’s rent account remains the definitive current position.</p>
        </div>
      </div>
    </section>;
  }

  const currentEpisode = tenancyEpisodes.filter((episode) => episode.status === "open")
    .sort((left, right) => right.last_reported_at.localeCompare(left.last_reported_at))[0] ?? null;

  return <section className="panel min-w-0">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-[#8A6A22]">Rent performance</p>
        <h3 className="mt-1 text-xl font-bold text-[#0F3D2E]">Reported arrears history</h3>
        <p className="mt-1 text-sm text-[#617169]">A concise management history sourced from material agent updates.</p>
      </div>
      <RentRiskAttentionBadge risk={{
        hasCurrentArrears: currentMetrics.hasCurrentArrears,
        repeatArrears: currentMetrics.repeatArrears,
        reconciliationRequired: currentMetrics.reconciliationRequired,
        interventionLevel: currentMetrics.interventionLevel,
      }} />
    </div>

    <div className="mt-4 rounded-lg border border-[#d9ded6] bg-[#fbfcfa] p-4">
      <p className="text-xs font-bold uppercase tracking-[0.06em] text-[#617169]">Current position</p>
      {currentEpisode ? <>
        <p className="numeric-value mt-1 text-2xl font-bold text-[#0F3D2E]">Latest reported arrears {formatReportedArrears(currentEpisode.latest_reported_amount)}</p>
        <p className="mt-1 text-sm text-[#617169]">As at {formatDate(currentEpisode.last_reported_at)} · source: <span title={currentEpisode.source_reference}>{sourceLabel(currentEpisode.source_reference)}</span></p>
        <p className="mt-2 text-sm font-semibold text-[#34413a]">{currentEpisode.owner_action_required ? "Owner decision requested" : "Agent handling · no owner decision currently requested"}</p>
      </> : <div className="mt-2 flex items-start gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#286348]" /><p className="text-sm text-[#617169]">No open arrears episode is reported for the current tenancy.</p></div>}
      <p className="mt-3 text-xs leading-relaxed text-[#6b7770]">Reported balances may have changed since the source date. Robinson Jackson’s rent account remains the definitive current position.</p>
    </div>

    <dl className="mt-4 grid grid-cols-2 divide-x divide-y divide-[#e2e6e0] overflow-hidden rounded-lg border border-[#d9ded6] bg-white lg:grid-cols-5 lg:divide-y-0">
      <RiskMetric label="Current reported position" value={currentMetrics.currentReportedArrears === null ? "No open report" : formatReportedArrears(currentMetrics.currentReportedArrears)} />
      <RiskMetric label="Rolling 12 months" value={`${currentMetrics.rolling12MonthEpisodes} episode${currentMetrics.rolling12MonthEpisodes === 1 ? "" : "s"}`} />
      <RiskMetric label="Historic episodes" value={String(currentMetrics.totalHistoricalEpisodes)} />
      <RiskMetric label="Peak arrears" value={formatReportedArrears(currentMetrics.maximumReportedArrears)} />
      <RiskMetric label="Longest episode" value={currentMetrics.longestEpisodeDays === null ? "—" : `${currentMetrics.longestEpisodeDays} day${currentMetrics.longestEpisodeDays === 1 ? "" : "s"}`} />
    </dl>

    <div className="mt-5">
      <h4 className="font-bold text-[#34413a]">Arrears history</h4>
      <div className="mt-3 grid gap-3">
        {tenancyEpisodes.map((episode) => {
          const eventCount = events.filter((event) => event.episode_id === episode.id).length;
          return <details key={episode.id} className="group rounded-lg border border-[#d9ded6] bg-white p-4 open:bg-[#fbfcfa]">
            <summary className="cursor-pointer list-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#0F3D2E]">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-bold text-[#0F3D2E]">{formatDate(episode.first_reported_at)} · {formatReportedArrears(episode.initial_reported_amount)}</p>
                  <p className="mt-1 text-sm text-[#617169]">{episode.management_summary}</p>
                </div>
                <span className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-bold ${episode.intervention_level === "action_required" ? "border-[#e5b9b2] bg-[#fff3f1] text-[#8d382d]" : episode.intervention_level === "watch" ? "border-[#e3c77b] bg-[#fff8e8] text-[#765a18]" : "border-[#d9ded6] bg-[#f4f5f2] text-[#617169]"}`}>{interventionLabel(episode.intervention_level)}</span>
              </div>
            </summary>
            <dl className="mt-4 grid gap-3 border-t border-[#e4e8e2] pt-4 text-sm sm:grid-cols-2">
              <div><dt className="text-xs font-bold uppercase text-[#617169]">Outcome</dt><dd className="mt-1 text-[#34413a]">{rentRiskStatusLabel(episode.status)}{episode.resolution_basis ? ` · ${episode.resolution_basis.replace(/_/g, " ")}` : ""}</dd></div>
              <div><dt className="text-xs font-bold uppercase text-[#617169]">Latest reported arrears</dt><dd className="numeric-value mt-1 text-[#34413a]">{formatReportedArrears(episode.latest_reported_amount)} as at {formatDate(episode.last_reported_at)}</dd></div>
              <div><dt className="text-xs font-bold uppercase text-[#617169]">Peak reported arrears</dt><dd className="numeric-value mt-1 text-[#34413a]">{formatReportedArrears(episode.maximum_reported_amount)}</dd></div>
              <div><dt className="text-xs font-bold uppercase text-[#617169]">Evidence</dt><dd className="mt-1 text-[#34413a]">{eventCount} material event{eventCount === 1 ? "" : "s"} · source <span className="break-all" title={episode.source_reference}>{sourceLabel(episode.source_reference)}</span></dd></div>
            </dl>
          </details>;
        })}
      </div>
    </div>
  </section>;
}
