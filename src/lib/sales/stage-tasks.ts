export type SalesTaskStatus = "complete" | "current" | "locked" | "changes_required" | "awaiting_resubmission";

export type SalesStageTask = {
  title: string;
  status: SalesTaskStatus;
  responsibility?: string;
  completedBy?: string | null;
};

type CompletionDocument = {
  id: string;
  document_type: string;
  status: string;
  approved_at?: string | null;
  updated_at?: string | null;
  redacted_at?: string | null;
  superseded_at?: string | null;
};

type CompletionVersion = {
  document_id: string;
  is_current: boolean;
  uploaded_at: string;
  uploaded_by_user_id?: string | null;
  redacted_at?: string | null;
};

function timestamp(value?: string | null) {
  const parsed = value ? Date.parse(value) : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}

// Use the current persisted versions, never a selected File or an unsaved date.
export function getCompletionDocumentState(
  documents: readonly CompletionDocument[],
  versions: readonly CompletionVersion[],
  latestQueryAt?: string | null,
) {
  const required = ["completion_statement", "statement_of_account"].map((type) => {
    const document = documents.find((item) => item.document_type === type && !item.redacted_at && !item.superseded_at);
    const version = document ? versions.find((item) => item.document_id === document.id && item.is_current && !item.redacted_at) : undefined;
    return { document, version };
  });
  const uploaded = required.every(({ document, version }) => Boolean(document && version));
  const latestUpload = required.map(({ version }) => version).filter((version) => version !== undefined)
    .sort((a, b) => timestamp(b.uploaded_at) - timestamp(a.uploaded_at))[0];
  const approved = uploaded && required.every(({ document, version }) => document?.status === "approved"
    && (!document.approved_at || timestamp(document.approved_at) >= timestamp(version?.uploaded_at)));
  const queryAt = Math.max(timestamp(latestQueryAt), ...required.map(({ document }) =>
    document?.status === "query_raised" ? timestamp(document.updated_at) : 0));
  const hasQuery = queryAt > 0 || required.some(({ document }) => document?.status === "query_raised");
  // A query concerns the document pack. Replacing the relevant document returns
  // the whole pack to review; the developer must approve it explicitly again.
  const needsChanges = !approved && hasQuery && (queryAt === 0 || timestamp(latestUpload?.uploaded_at) <= queryAt);
  return {
    uploaded,
    approved,
    needsChanges,
    canReview: uploaded && !needsChanges,
    uploadedByUserId: uploaded ? latestUpload?.uploaded_by_user_id ?? null : null,
  };
}

export function getReservationTasks({ state, submittedBy, approvedBy }: {
  state: "not_started" | "awaiting_approval" | "approved" | "rejected" | "failed";
  submittedBy?: string | null;
  approvedBy?: string | null;
}): SalesStageTask[] {
  return [
    {
      title: "Record reservation",
      status: state === "approved" || state === "awaiting_approval" ? "complete"
        : state === "rejected" ? "changes_required" : state === "failed" ? "locked" : "current",
      responsibility: "Sales agent",
      completedBy: submittedBy,
    },
    {
      title: "Approve reservation",
      status: state === "approved" ? "complete" : state === "awaiting_approval" ? "current" : "locked",
      responsibility: "Developer",
      completedBy: approvedBy,
    },
  ];
}

export function getExchangeTasks({ reservationApproved, commercialApproved, exchangeRecorded, commercialApprovedBy, exchangeRecordedBy }: {
  reservationApproved: boolean;
  commercialApproved: boolean;
  exchangeRecorded: boolean;
  commercialApprovedBy?: string | null;
  exchangeRecordedBy?: string | null;
}): SalesStageTask[] {
  return [
    { title: "Confirm commercial terms", status: commercialApproved ? "complete" : reservationApproved ? "current" : "locked", completedBy: commercialApprovedBy },
    { title: "Record exchange", status: exchangeRecorded ? "complete" : commercialApproved && reservationApproved ? "current" : "locked", completedBy: exchangeRecordedBy },
  ];
}

export function getCompletionTasks({ exchangeRecorded, completionRecorded, documents, uploadedBy, approvedBy, recordedBy }: {
  exchangeRecorded: boolean;
  completionRecorded: boolean;
  documents: ReturnType<typeof getCompletionDocumentState>;
  uploadedBy?: string | null;
  approvedBy?: string | null;
  recordedBy?: string | null;
}): SalesStageTask[] {
  return [
    {
      title: "Upload completion documents", responsibility: "Solicitor", completedBy: uploadedBy,
      status: !exchangeRecorded ? "locked" : documents.needsChanges ? "changes_required" : documents.uploaded ? "complete" : "current",
    },
    {
      title: "Review completion documents", responsibility: "Developer", completedBy: approvedBy,
      status: !exchangeRecorded ? "locked" : documents.approved ? "complete" : documents.needsChanges ? "awaiting_resubmission" : documents.uploaded ? "current" : "locked",
    },
    {
      title: "Record completion", responsibility: "Solicitor", completedBy: recordedBy,
      status: completionRecorded ? "complete" : exchangeRecorded && documents.approved ? "current" : "locked",
    },
  ];
}

export function currentSalesTask(steps: readonly SalesStageTask[], fallback: string) {
  return steps.find((step) => step.status === "current" || step.status === "changes_required")?.title ?? fallback;
}
