export type ArrearsEpisodeStatus = "open" | "cleared" | "closed_reconciliation_review" | "ended_unreconciled";
export type ArrearsInterventionLevel = "information" | "watch" | "action_required";
export type ArrearsEventType =
  | "first_arrears_notification"
  | "balance_changed"
  | "payment_or_clearance_evidence"
  | "tenancy_ended_or_relet"
  | "recovery_outcome"
  | "owner_decision_requested";
export type EvidenceConfidence = "low" | "medium" | "high";

export type RentalArrearsEpisode = {
  id: string;
  tenancy_id: string;
  agent_tenancy_reference: string | null;
  first_reported_at: string;
  last_reported_at: string;
  cleared_at: string | null;
  initial_reported_amount: number;
  maximum_reported_amount: number;
  latest_reported_amount: number | null;
  status: ArrearsEpisodeStatus;
  intervention_level: ArrearsInterventionLevel;
  owner_action_required: boolean;
  resolution_basis: string | null;
  management_summary: string;
  source_reference: string;
  created_at: string;
  updated_at: string;
};

export type RentalArrearsEvent = {
  id: string;
  episode_id: string;
  event_at: string;
  event_type: ArrearsEventType;
  reported_amount: number | null;
  summary: string;
  source_reference: string;
  source_kind: string | null;
  evidence_confidence: EvidenceConfidence;
  created_at: string;
};

export type RentalImportHealth = {
  id: string;
  building_id: string | null;
  source_reference: string;
  status: "started" | "succeeded" | "failed";
  started_at: string;
  completed_at: string | null;
  data_as_of: string | null;
  episodes_imported: number;
  events_imported: number;
  error_count: number;
  errors: unknown[];
  data_quality_issue_count: number;
  data_quality_issues: unknown[];
  created_at: string;
  updated_at: string;
};

export type TenancyRentRisk = {
  tenancyId: string;
  currentReportedArrears: number | null;
  latestReportDate: string | null;
  rolling12MonthEpisodes: number;
  totalHistoricalEpisodes: number;
  maximumReportedArrears: number;
  longestEpisodeDays: number | null;
  mostRecentOutcome: string | null;
  interventionLevel: ArrearsInterventionLevel;
  reconciliationRequired: boolean;
  repeatArrears: boolean;
  hasCurrentArrears: boolean;
};

export type UnitRentRisk = {
  hasCurrentArrears: boolean;
  repeatArrears: boolean;
  reconciliationRequired: boolean;
  interventionLevel: ArrearsInterventionLevel;
};

export const PROLONGED_ARREARS_EPISODE_DAYS = 30;

const levelOrder: Record<ArrearsInterventionLevel, number> = {
  information: 0,
  watch: 1,
  action_required: 2,
};

function dateOnly(value: string) {
  return value.slice(0, 10);
}

function dateValue(value: string) {
  return Date.parse(`${dateOnly(value)}T00:00:00Z`);
}

function rollingYearStart(asOfDate: string) {
  const date = new Date(`${dateOnly(asOfDate)}T00:00:00Z`);
  date.setUTCFullYear(date.getUTCFullYear() - 1);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function episodeDurationDays(episode: RentalArrearsEpisode, asOfDate: string) {
  const endDate = episode.status === "open"
    ? asOfDate
    : episode.cleared_at ?? episode.last_reported_at;
  return Math.max(0, Math.round((dateValue(endDate) - dateValue(episode.first_reported_at)) / 86_400_000));
}

export function highestInterventionLevel(levels: ArrearsInterventionLevel[]): ArrearsInterventionLevel {
  return levels.reduce<ArrearsInterventionLevel>(
    (highest, level) => levelOrder[level] > levelOrder[highest] ? level : highest,
    "information",
  );
}

export function deriveTenancyRentRisk(
  tenancyId: string,
  allEpisodes: RentalArrearsEpisode[],
  asOfDate: string,
): TenancyRentRisk {
  const episodes = allEpisodes
    .filter((episode) => episode.tenancy_id === tenancyId)
    .sort((left, right) => left.first_reported_at.localeCompare(right.first_reported_at));
  const rollingStart = rollingYearStart(asOfDate);
  const rollingEpisodes = episodes.filter((episode) => dateOnly(episode.last_reported_at) >= rollingStart);
  const currentEpisodes = episodes.filter((episode) => episode.status === "open");
  const reportedCurrentAmounts = currentEpisodes
    .map((episode) => episode.latest_reported_amount)
    .filter((amount): amount is number => amount !== null);
  const currentReportedArrears = currentEpisodes.length === 0
    ? null
    : reportedCurrentAmounts.length === currentEpisodes.length
      ? reportedCurrentAmounts.reduce((total, amount) => total + Number(amount), 0)
      : null;
  const longestEpisodeDays = episodes.length === 0
    ? null
    : Math.max(...episodes.map((episode) => episodeDurationDays(episode, asOfDate)));
  const mostRecent = [...episodes].sort((left, right) => right.last_reported_at.localeCompare(left.last_reported_at))[0];
  const repeatArrears = episodes.length > 1;
  const reconciliationRequired = episodes.some((episode) =>
    episode.status === "ended_unreconciled" || episode.status === "closed_reconciliation_review",
  );
  const worseningBalance = episodes.some((episode) =>
    Number(episode.maximum_reported_amount) > Number(episode.initial_reported_amount),
  );
  const prolongedEpisode = (longestEpisodeDays ?? 0) >= PROLONGED_ARREARS_EPISODE_DAYS;
  const storedLevel = highestInterventionLevel(episodes.map((episode) => episode.intervention_level));
  const ownerDecisionRequired = episodes.some((episode) => episode.owner_action_required);
  const interventionLevel: ArrearsInterventionLevel = ownerDecisionRequired || reconciliationRequired || storedLevel === "action_required"
    ? "action_required"
    : repeatArrears || prolongedEpisode || worseningBalance || storedLevel === "watch"
      ? "watch"
      : "information";

  return {
    tenancyId,
    currentReportedArrears,
    latestReportDate: mostRecent?.last_reported_at ?? null,
    rolling12MonthEpisodes: rollingEpisodes.length,
    totalHistoricalEpisodes: episodes.length,
    maximumReportedArrears: episodes.length === 0
      ? 0
      : Math.max(...episodes.map((episode) => Number(episode.maximum_reported_amount))),
    longestEpisodeDays,
    mostRecentOutcome: mostRecent?.resolution_basis ?? mostRecent?.status ?? null,
    interventionLevel,
    reconciliationRequired,
    repeatArrears,
    hasCurrentArrears: currentEpisodes.length > 0 && (currentReportedArrears === null || currentReportedArrears > 0),
  };
}

export function summarisePortfolioRentRisk(episodes: RentalArrearsEpisode[], tenancyIds: string[], asOfDate: string) {
  const scopedTenancyIds = new Set(tenancyIds);
  const scopedEpisodes = episodes.filter((episode) => scopedTenancyIds.has(episode.tenancy_id));
  const metrics = tenancyIds.map((tenancyId) => deriveTenancyRentRisk(tenancyId, scopedEpisodes, asOfDate));
  return {
    currentReportedEpisodes: scopedEpisodes.filter((episode) => episode.status === "open").length,
    repeatArrearsTenancies: metrics.filter((metric) => metric.repeatArrears).length,
    actionRequiredTenancies: metrics.filter((metric) => metric.interventionLevel === "action_required").length,
  };
}

export function deriveUnitRentRisk(
  currentTenancyId: string | null,
  episodes: RentalArrearsEpisode[],
  asOfDate: string,
): UnitRentRisk {
  const metrics = currentTenancyId ? deriveTenancyRentRisk(currentTenancyId, episodes, asOfDate) : null;
  return {
    hasCurrentArrears: metrics?.hasCurrentArrears ?? false,
    repeatArrears: metrics?.repeatArrears ?? false,
    reconciliationRequired: metrics?.reconciliationRequired ?? false,
    interventionLevel: metrics?.interventionLevel ?? "information",
  };
}

export function tenancyHistoryStatusLabel(state: "scheduled" | "active" | "ended", hasLinkedArrears: boolean) {
  if (state === "ended") return hasLinkedArrears ? "Ended · Arrears recorded" : "Ended";
  return state === "active" ? "Active" : "Scheduled";
}

export function rentRiskStatusLabel(status: ArrearsEpisodeStatus) {
  return {
    open: "Open",
    cleared: "Cleared",
    closed_reconciliation_review: "Closed · reconciliation review",
    ended_unreconciled: "Ended · unreconciled",
  }[status];
}

export function interventionLabel(level: ArrearsInterventionLevel) {
  return {
    information: "Information",
    watch: "Watch",
    action_required: "Action required",
  }[level];
}
