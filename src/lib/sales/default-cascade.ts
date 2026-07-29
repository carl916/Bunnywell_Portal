export type CascadeUnit = {
  id: string;
  sale_status: "for_sale" | "reserved" | "exchanged" | "completed" | "handed_over";
};

export type CascadeSaleAttempt = {
  id: string;
  unit_id: string;
  is_active: boolean;
  workflow_status: string;
  buyer_name?: string | null;
  buyer_person_name?: string | null;
  buyer_company_name?: string | null;
  buyer_email?: string | null;
  buyer_phone?: string | null;
  buyer_solicitor_name?: string | null;
  reservation_submitted_at?: string | null;
  reservation_approved_at?: string | null;
  commercial_approved_at?: string | null;
  exchanged_at?: string | null;
  completed_at?: string | null;
};

export type CascadeSaleDocument = {
  sale_attempt_id: string;
  document_type: string;
  status?: string | null;
  redacted_at?: string | null;
};

export type DefaultCascadeClassification = {
  eligibleUnitIds: string[];
  eligibleAttemptIds: string[];
  draftReservationsSkipped: number;
  reservedSkipped: number;
  exchangedSkipped: number;
  completedSkipped: number;
};

function hasText(value?: string | null) {
  return Boolean(value?.trim());
}

function hasReservationDraftData(attempt: CascadeSaleAttempt, documents: CascadeSaleDocument[]) {
  return hasText(attempt.buyer_name)
    || hasText(attempt.buyer_person_name)
    || hasText(attempt.buyer_company_name)
    || hasText(attempt.buyer_email)
    || hasText(attempt.buyer_phone)
    || hasText(attempt.buyer_solicitor_name)
    || Boolean(attempt.reservation_submitted_at)
    || ["reservation_submitted", "reservation_query_raised"].includes(attempt.workflow_status)
    || documents.some((document) => (
      document.sale_attempt_id === attempt.id
      && document.document_type === "reservation_form"
      && document.status !== "redacted"
      && !document.redacted_at
    ));
}

export function classifyDefaultDealSetupCascade(input: {
  units: CascadeUnit[];
  attempts: CascadeSaleAttempt[];
  documents?: CascadeSaleDocument[];
}): DefaultCascadeClassification {
  const attemptsByUnit = new Map(
    input.attempts
      .filter((attempt) => attempt.is_active)
      .map((attempt) => [attempt.unit_id, attempt]),
  );
  const documents = input.documents ?? [];
  const result: DefaultCascadeClassification = {
    eligibleUnitIds: [],
    eligibleAttemptIds: [],
    draftReservationsSkipped: 0,
    reservedSkipped: 0,
    exchangedSkipped: 0,
    completedSkipped: 0,
  };

  for (const unit of input.units) {
    const attempt = attemptsByUnit.get(unit.id);
    if (unit.sale_status === "reserved" || attempt?.reservation_approved_at || attempt?.commercial_approved_at || ["reservation_approved", "awaiting_commercial_approval", "ready_for_exchange"].includes(attempt?.workflow_status ?? "")) {
      result.reservedSkipped += 1;
      continue;
    }
    if (unit.sale_status === "exchanged" || attempt?.exchanged_at || attempt?.workflow_status === "exchanged" || attempt?.workflow_status === "completion_pending") {
      result.exchangedSkipped += 1;
      continue;
    }
    if (unit.sale_status === "completed" || unit.sale_status === "handed_over" || attempt?.completed_at || attempt?.workflow_status === "completed") {
      result.completedSkipped += 1;
      continue;
    }
    if (unit.sale_status !== "for_sale") continue;
    if (attempt && hasReservationDraftData(attempt, documents)) {
      result.draftReservationsSkipped += 1;
      continue;
    }

    result.eligibleUnitIds.push(unit.id);
    if (attempt) result.eligibleAttemptIds.push(attempt.id);
  }

  return result;
}

export function defaultDealSetupCascadeSummary(input: DefaultCascadeClassification) {
  const forSaleUnitLabel = input.eligibleUnitIds.length === 1 ? "unit" : "units";
  const draftLabel = input.draftReservationsSkipped === 1 ? "reservation draft" : "reservation drafts";
  return `Updated ${input.eligibleUnitIds.length} For Sale ${forSaleUnitLabel}. ${input.draftReservationsSkipped} ${draftLabel} left unchanged. ${input.reservedSkipped} Reserved, ${input.exchangedSkipped} Exchanged and ${input.completedSkipped} Completed units were not changed.`;
}
