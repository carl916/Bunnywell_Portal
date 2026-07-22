export type AppRole = "admin" | "developer" | "developer_representative" | "sales_agent" | "conveyancer" | "contractor" | "resident" | "user";
export type ResidentType = "leaseholder" | "tenant" | "letting_agent" | "managing_agent";

export type Building = {
  id: string;
  name: string;
  address_line_1: string | null;
  address_line_2: string | null;
  town: string | null;
  postcode: string | null;
  pc_date: string | null;
  pc_confirmed: boolean | null;
  practical_completion_date: string | null;
  defects_liability_end_date: string | null;
  dlp_end_date: string | null;
  dlp_closing_notice_start_date: string | null;
  archive_date: string | null;
  lifecycle_status: string | null;
  status: string;
  allow_resident_access_requests: boolean | null;
  notes: string | null;
  photo_url: string | null;
  documents_url: string | null;
  home_user_guide_url: string | null;
};

export type Organisation = {
  id: string;
  name: string;
  type: string;
  main_contact_name: string | null;
  email: string | null;
  phone: string | null;
};

export type BuildingOrganisationRole = "main_contractor" | "developer_representative" | "supporting_trade";

export type BuildingOrganisation = {
  id: string;
  building_id: string;
  organisation_id: string;
  role_on_project: BuildingOrganisationRole | string | null;
  trade_type?: string | null;
  active?: boolean | null;
  notes?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type BuildingFloor = {
  id: string;
  building_id: string;
  name: string;
  sort_order: number;
};

export type Unit = {
  id: string;
  building_id: string;
  unit_type_id: string | null;
  unit_number: string;
  floor: string | null;
  unit_type: string | null;
  size_sqm: number | null;
  sale_status: "for_sale" | "reserved" | "exchanged" | "completed" | "handed_over";
  completion_date: string | null;
  handover_date: string | null;
  parking_bays: number[] | null;
  notes: string | null;
};

export type UnitSaleRecord = {
  id: string;
  building_id: string;
  unit_id: string;
  buyer_name: string | null;
  buyer_email: string | null;
  buyer_phone: string | null;
  reservation_date: string | null;
  target_exchange_date: string | null;
  actual_exchange_date: string | null;
  target_completion_date: string | null;
  actual_completion_date: string | null;
  contract_price: number | null;
  estimated_list_price: number | null;
  list_price: number | null;
  reservation_fee: number | null;
  reservation_fee_holder: string | null;
  deposit_amount: number | null;
  incentives_value: number | null;
  parking_value: number | null;
  other_concessions_value: number | null;
  comparable_units_count: number | null;
  spreadsheet_source: string | null;
  source_row_number: number | null;
  expected_exchange_label: string | null;
  parking_spaces_count: number | null;
  parking_allocation: string | null;
  agent_fee_percent: number | null;
  agent_fee_amount: number | null;
  solicitor_fee_amount: number | null;
  agent_gross_invoice_amount: number | null;
  agent_invoice_reference: string | null;
  agent_invoice_date: string | null;
  agent_invoice_status: string | null;
  amount_permitted_to_release: number | null;
  amount_paid_from_first_payment: number | null;
  first_payment_made_at: string | null;
  invoice_shortfall_amount: number | null;
  invoice_shortfall_paid_at: string | null;
  developer_contribution_value: number | null;
  agent_contribution_value: number | null;
  completion_funds_adjustment: number | null;
  agent_invoice_deduction_value: number | null;
  incentive_summary: string | null;
  imported_at: string | null;
  reservation_form_status: string | null;
  reservation_form_url: string | null;
  reservation_form_uploaded_at: string | null;
  incentives_approval_status: string | null;
  incentives_approved_at: string | null;
  exchange_approval_status: string | null;
  exchange_approval_requested_at: string | null;
  exchange_approval_approved_at: string | null;
  agent_invoice_url: string | null;
  agent_invoice_uploaded_at: string | null;
  agent_invoice_approved_at: string | null;
  completion_statement_status: string | null;
  completion_statement_url: string | null;
  completion_statement_uploaded_at: string | null;
  completion_statement_approved_at: string | null;
  statement_of_account_status: string | null;
  statement_of_account_url: string | null;
  statement_of_account_uploaded_at: string | null;
  statement_of_account_approved_at: string | null;
  sales_agent: string | null;
  buyer_solicitor: string | null;
  developer_solicitor: string | null;
  key_risks: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

export type UnitSaleNote = {
  id: string;
  sale_record_id: string;
  building_id: string;
  unit_id: string;
  category: "general" | "blocker" | "buyer_update" | "solicitor_update" | "strategy" | "financial" | string;
  body: string;
  visibility: "admin_developer" | string;
  source_label: string | null;
  source_row_number: number | null;
  source_import_key: string | null;
  created_by: string | null;
  created_at: string;
};

export type Area = {
  id: string;
  building_id: string;
  unit_id: string | null;
  area_type: "unit_room" | "communal_area" | "private_amenity";
  name: string;
  floor: string | null;
  sort_order: number;
};

export type UnitType = {
  id: string;
  name: string;
  description: string | null;
};

export type UnitTypeArea = {
  id: string;
  unit_type_id: string;
  name: string;
  sort_order: number;
  optional: boolean;
};

export type Trade = {
  id: string;
  name: string;
  sort_order: number;
  active: boolean;
};

export type ProductionSnag = {
  id: string;
  building_id: string | null;
  unit_id: string | null;
  area_id: string | null;
  source_type: "developer_snag" | "leaseholder_defect" | "imported_report";
  created_by?: string | null;
  created_by_user_id: string | null;
  title: string;
  description: string | null;
  trade_id: string | null;
  priority_code: "P1" | "P2" | "P3" | null;
  status: string;
  assigned_to_organisation_id: string | null;
  assigned_to_user_id: string | null;
  sla_due_date: string | null;
  image_path?: string | null;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
};

export type SnagPhoto = {
  id: string;
  snag_id: string;
  file_url: string;
  photo_type: "original" | "annotated" | "resolution_photo";
  caption: string | null;
  uploaded_by_user_id: string | null;
  created_at: string;
};

export type SnagEvent = {
  id: string;
  snag_id: string;
  event_type: string;
  old_value: string | null;
  new_value: string | null;
  comment: string | null;
  created_by_user_id: string | null;
  created_at: string;
};

export type Handover = {
  id: string;
  unit_id: string;
  handover_by_user_id: string | null;
  recipient_name: string;
  recipient_email: string | null;
  recipient_phone: string | null;
  recipient_capacity: string | null;
  number_of_keys: number;
  signature_url: string | null;
  handover_date: string;
  handover_datetime: string | null;
  recipient_relationship: string | null;
  recipient_relationship_other: string | null;
  declaration_accepted: boolean | null;
  notes: string | null;
  created_at: string;
};

export type HandoverKeyItem = {
  id: string;
  handover_id: string;
  key_type: string;
  quantity: number;
  notes: string | null;
  sort_order: number;
  created_at: string;
};

export type HandoverPhoto = {
  id: string;
  handover_id: string;
  file_url: string;
  photo_type: "keys" | "other";
  caption: string | null;
  uploaded_by_user_id: string | null;
  created_at: string;
};

export type MeterReading = {
  id: string;
  building_id: string;
  unit_id: string;
  handover_id: string | null;
  meter_type: "electricity" | "water" | "heat";
  meter_serial_number: string | null;
  reading_value: string;
  reading_date: string;
  photo_url: string | null;
  notes: string | null;
  created_by_user_id: string | null;
  created_at: string;
};

export function slaForPriority(priority: "P1" | "P2" | "P3", defectsLiabilityEnd?: string | null) {
  const due = new Date();

  if (priority === "P1") {
    due.setHours(due.getHours() + 24);
    return due.toISOString();
  }

  if (priority === "P2") {
    due.setDate(due.getDate() + 28);
    return due.toISOString();
  }

  return defectsLiabilityEnd ? new Date(defectsLiabilityEnd).toISOString() : null;
}
