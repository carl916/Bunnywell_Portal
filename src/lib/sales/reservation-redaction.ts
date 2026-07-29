export type ReservationRedactionPatch = {
  buyer_name: null;
  buyer_person_name: null;
  buyer_company_name: null;
  buyer_email: null;
  buyer_phone: null;
  buyer_solicitor_name: null;
  buyer_solicitor_email: null;
  buyer_solicitor_phone: null;
  is_active: false;
  workflow_status: "fallen_through";
  fall_through_reason: string;
  fallen_through_at: string;
  stage_entered_at: string;
  redacted_at: string;
  redacted_by_user_id: string;
  redaction_note: string;
  updated_by_user_id: string;
  updated_at: string;
};

export function buildFailedReservationRedactionPatch({
  reason,
  redactedByUserId,
  timestamp,
}: {
  reason: string;
  redactedByUserId: string;
  timestamp: string;
}): ReservationRedactionPatch {
  const cleanReason = reason.trim() || "Reservation failed.";

  return {
    buyer_name: null,
    buyer_person_name: null,
    buyer_company_name: null,
    buyer_email: null,
    buyer_phone: null,
    buyer_solicitor_name: null,
    buyer_solicitor_email: null,
    buyer_solicitor_phone: null,
    is_active: false,
    workflow_status: "fallen_through",
    fall_through_reason: cleanReason,
    fallen_through_at: timestamp,
    stage_entered_at: timestamp,
    redacted_at: timestamp,
    redacted_by_user_id: redactedByUserId,
    redaction_note: cleanReason,
    updated_by_user_id: redactedByUserId,
    updated_at: timestamp,
  };
}
