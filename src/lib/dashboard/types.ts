import type { Building, BuildingFloor, BuildingOrganisation, ProductionSnag, SnagEvent, Unit } from "../data/production";
import type { LegalEmail } from "../sales/legal-workflow";
import type { UnitTenancy } from "../rentals/tenancies";
import type { RentalArrearsEpisode } from "../rentals/rent-risk";
import type { WorkDeadline } from "./dates";

export type WorkModule = "sales" | "snags" | "other";
export type WorkParty = { kind: "developer" | "sales_agent" | "conveyancer" | "contractor" | "unallocated"; organisationId: string | null; label: string };
export type WorkContext = { id: string; text: string; at: string; account: string | null };
export type WorkDestination = { screen: "sales" | "snags" | "units" | "rentals" | "setup_people" | "setup_buildings"; buildingId: string; unitId?: string; saleId?: string; snagId?: string; requestId?: string; section?: string; anchor?: string; filter?: string; source?: string; versionId?: string };
export type WorkItem = {
  id: string; recordKey: string; module: WorkModule; source: string; kind: string;
  buildingId: string; unitId: string | null; reference: string; position: string; action: string;
  responsibility: WorkParty; ours: boolean; canAct: boolean;
  waiting: { since: string | null; precision: "date" | "instant"; basis: string; fallback: boolean };
  deadline: WorkDeadline | null; urgent: boolean; cycleId: string | null;
  context: WorkContext | null; destination: WorkDestination | null;
  countingUnit: "task" | "document" | "invoice" | "unit" | "episode" | "request";
};
export type WorkRow = { key: string; buildingName: string; reference: string; items: WorkItem[] };
export type WorkViewer = { id: string; role: string; organisation_id: string | null; organisationName?: string | null };
export type WorkSale = {
  id: string; building_id: string; unit_id: string; is_active: boolean; workflow_status: string;
  sales_agent_organisation_id: string | null; conveyancer_organisation_id: string | null;
  reservation_submitted_at: string | null; reservation_rejected_at: string | null; reservation_rejection_reason: string | null;
  reservation_approved_at: string | null; commercial_approved_at: string | null;
  exchanged_at: string | null; completed_at: string | null; legal_completed_at: string | null; redacted_at: string | null;
  authority_requested_at: string | null; completion_authority_requested_at: string | null; completion_authority_given_at: string | null;
  completion_arrangements_confirmed_at: string | null; completion_legacy_stage: "authority" | "arrangements" | null;
  completion_notice_issued_at: string | null; contractual_completion_date: string | null; created_at: string;
};
export type WorkDocument = {
  id: string; sale_attempt_id: string; document_type: string; status: string; query_note: string | null;
  approved_version_id: string | null; approved_at: string | null; updated_at: string; updated_by_user_id?: string | null;
  unit_sale_document_versions: { id: string; is_current: boolean; redacted_at: string | null; uploaded_at: string }[];
};
export type WorkAuthority = Pick<LegalEmail, "id" | "sale_attempt_id" | "kind" | "version" | "issued_at" | "expires_at" | "revoked_at" | "replaced_by" | "exchanged_at" | "delivery_status" | "sent_at" | "resend_message_id">;
export type WorkSaleEvent = { id: string; sale_attempt_id: string; event_type: string; created_at: string; created_by_user_id: string | null; actor_name?: string | null; summary?: string; version_id?: string | null; metadata?: { versionId?: string; queryNote?: string } };
export type WorkInvoice = { id: string; sale_attempt_id: string; status: string; fee_milestone: "exchange" | "completion"; gross_amount: number | null; expected_payable_amount: number | null; reservation_fee_deduction?: number | null; agent_contribution_deduction?: number | null; approved_at: string | null; created_at: string };
export type WorkTerms = { sale_attempt_id: string; contract_price: number | null; exchange_agent_fee_percent: number | null; completion_agent_fee_percent: number | null; vat_rate: number | null };
export type SourceState = { key: string; label: string; state: "ready" | "unavailable" | "not_permitted"; detail?: string; asOf: string | null };
export type DashboardInput = {
  viewer: WorkViewer; now: number; buildingId: string; buildings: Building[]; units: Unit[]; floors: BuildingFloor[];
  organisations: { id: string; name: string }[]; buildingOrganisations: BuildingOrganisation[];
  saleActors?: { id: string; display_name: string }[]; sales: WorkSale[]; documents: WorkDocument[]; authorities: WorkAuthority[]; saleEvents: WorkSaleEvent[];
  deposits: { sale_attempt_id: string; source_id: string; expected_amount: number; received_amount: number }[];
  depositSources: { id: string; sale_attempt_id: string; source_kind: string; expected_amount: number | null }[];
  invoices: WorkInvoice[]; terms: WorkTerms[]; payments: { invoice_id: string; amount: number; voided_at: string | null }[];
  snags: (ProductionSnag & { snag_events: SnagEvent[] })[]; handovers: { unit_id: string }[];
  tenancies: UnitTenancy[]; arrears: RentalArrearsEpisode[];
  rentalImports: { id: string; building_id: string | null; status: string; data_as_of: string | null; started_at: string; completed_at: string | null; error_count: number; data_quality_issue_count: number }[];
  accessRequests: { id: string; created_at: string; requested_units: { building_id: string }[] }[];
  sources: SourceState[];
};
export type PortfolioSummary = { key: string; label: string; value: number | null; unit: string; detail?: string; module: WorkModule; filter?: string };
export type DashboardSnapshot = {
  asOf: string; scope: { buildingId: string; label: string; team: string; identity: string }; sources: SourceState[];
  items: WorkItem[]; summaries: PortfolioSummary[];
  activity: (WorkContext & { recordKey: string; destination: WorkDestination })[];
  buildings: { id: string; name: string; sales: number | null; rentals: number | null; snags: number | null; defects: number | null }[];
};
