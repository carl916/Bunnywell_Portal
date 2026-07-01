export type BuildingLifecycleStatus = "pre_pc" | "dlp_active" | "dlp_closing" | "post_dlp_readonly" | "archived";

export type BuildingLifecycleInput = {
  status?: string | null;
  pc_date?: string | null;
  pc_confirmed?: boolean | null;
  practical_completion_date?: string | null;
};

export function dateOnly(value: Date = new Date()) {
  return value.toISOString().slice(0, 10);
}

export function addMonthsToDateString(value: string, months: number) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCMonth(date.getUTCMonth() + months);
  return date.toISOString().slice(0, 10);
}

export function expectedPcDate(building?: BuildingLifecycleInput | null) {
  return building?.pc_date ?? building?.practical_completion_date ?? null;
}

export function confirmedPcDate(building?: BuildingLifecycleInput | null) {
  if (!building?.pc_confirmed) return null;
  return expectedPcDate(building);
}

export function initialDefectsReportingEndDate(building?: BuildingLifecycleInput | null) {
  const pcDate = confirmedPcDate(building);
  return pcDate ? addMonthsToDateString(pcDate, 12) : null;
}

export function closingNoticeStartDate(building?: BuildingLifecycleInput | null) {
  const reportingEnd = initialDefectsReportingEndDate(building);
  return reportingEnd ? addMonthsToDateString(reportingEnd, -2) : null;
}

export function derivedBuildingLifecycleStatus(
  building?: BuildingLifecycleInput | null,
  today = dateOnly(),
): BuildingLifecycleStatus {
  if (!building) return "pre_pc";
  if (building.status === "archived") return "archived";

  const pcDate = confirmedPcDate(building);
  if (!pcDate || pcDate > today) return "pre_pc";

  const reportingEnd = initialDefectsReportingEndDate(building);
  if (reportingEnd && today >= reportingEnd) return "post_dlp_readonly";

  const closingStart = closingNoticeStartDate(building);
  if (closingStart && today >= closingStart) return "dlp_closing";

  return "dlp_active";
}

export function buildingAllowsResidentRoutineSnags(building?: BuildingLifecycleInput | null) {
  return ["dlp_active", "dlp_closing"].includes(derivedBuildingLifecycleStatus(building));
}

export function buildingAllowsFlatHandover(building?: BuildingLifecycleInput | null) {
  const pcDate = confirmedPcDate(building);
  return Boolean(building && building.status !== "archived" && pcDate && pcDate <= dateOnly());
}

export function pcConfirmationError(pcDate?: string | null) {
  if (!pcDate) return "Enter the Practical Completion date before confirming PC.";
  if (pcDate > dateOnly()) {
    return "PC can only be confirmed once Practical Completion has actually occurred. Enter today's date or a past date.";
  }
  return "";
}

export function hasPassedExpectedPcWarning(building?: BuildingLifecycleInput | null, today = dateOnly()) {
  const pcDate = expectedPcDate(building);
  return Boolean(building && !building.pc_confirmed && pcDate && today > pcDate);
}

export function lifecycleLabel(status: BuildingLifecycleStatus) {
  const labels: Record<BuildingLifecycleStatus, string> = {
    pre_pc: "Pre-PC",
    dlp_active: "DLP active",
    dlp_closing: "Closing soon",
    post_dlp_readonly: "Post-DLP read-only",
    archived: "Archived",
  };

  return labels[status];
}

export function lifecycleEffectSummary(status: BuildingLifecycleStatus) {
  const summaries: Record<BuildingLifecycleStatus, string> = {
    pre_pc: "PC has not been confirmed. Residents cannot submit routine snags or complete handover yet. Internal users can continue managing pre-PC snags where permitted.",
    dlp_active: "Residents can submit routine snag reports, view handover records and access documents. Flat handovers can be completed.",
    dlp_closing: "Residents can still submit routine snag reports, but will see a closing notice. Flat handovers can be completed.",
    post_dlp_readonly: "Residents can view previous snags, handover records and documents. New routine snag reports are closed. Flat handovers can still be completed for late sales.",
    archived: "This building is archived. Existing records remain available to authorised users.",
  };

  return summaries[status];
}
