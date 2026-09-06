function dateOnly(value) {
  return String(value).slice(0, 10);
}

function normalizedEvidence(value) {
  return String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function tenancyContains(tenancy, reportedAt) {
  const date = dateOnly(reportedAt);
  return tenancy.tenancy_start_date <= date && (!tenancy.tenancy_end_date || tenancy.tenancy_end_date >= date);
}

function evidenceMatches(episode, tenancy) {
  const tenancySource = normalizedEvidence(tenancy.source_reference);
  const importKey = normalizedEvidence(episode.tenancy_import_key);
  const agentReference = normalizedEvidence(episode.agent_tenancy_reference);
  const tenantEvidence = normalizedEvidence(episode.tenant_name_evidence);
  const tenantName = normalizedEvidence(tenancy.tenant_name);

  return Boolean(
    (importKey && tenancySource && (tenancySource === importKey || tenancySource.includes(importKey)))
    || (agentReference && tenancySource && tenancySource.includes(agentReference))
    || (tenantEvidence && tenantName && tenantEvidence === tenantName)
  );
}

export function attributeArrearsEpisode(episode, unit, tenancies) {
  const dateCandidates = tenancies.filter((tenancy) =>
    tenancy.unit_id === unit.id && tenancyContains(tenancy, episode.first_reported_at));

  if (dateCandidates.length === 1) {
    return { status: "matched", tenancy: dateCandidates[0], candidateTenancyIds: [dateCandidates[0].id] };
  }

  const evidenceCandidates = dateCandidates.filter((tenancy) => evidenceMatches(episode, tenancy));
  if (evidenceCandidates.length === 1) {
    return { status: "matched", tenancy: evidenceCandidates[0], candidateTenancyIds: dateCandidates.map((tenancy) => tenancy.id) };
  }

  const candidateCount = dateCandidates.length;
  return {
    status: "review_required",
    tenancy: null,
    candidateTenancyIds: dateCandidates.map((tenancy) => tenancy.id),
    reason: candidateCount === 0
      ? `Episode date ${dateOnly(episode.first_reported_at)} did not fall within a recorded tenancy for unit ${episode.unit_number}.`
      : `Episode date ${dateOnly(episode.first_reported_at)} matched ${candidateCount} tenancies for unit ${episode.unit_number}; source evidence did not identify one tenancy.`,
  };
}

