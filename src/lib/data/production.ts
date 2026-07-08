export type AppRole = "admin" | "developer" | "developer_representative" | "contractor" | "resident" | "user";
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
