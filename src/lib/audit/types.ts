export type AuditCategory = "sales" | "rentals" | "users" | "setup" | "security" | "reports" | "system";

export type AuditEvent = {
  id: string;
  event_type: string;
  entity_type: string;
  entity_id: string | null;
  summary: string;
  metadata: Record<string, unknown>;
  created_by_user_id: string | null;
  created_at: string;
  category?: string | null;
  actor_organisation_id?: string | null;
  building_id?: string | null;
  unit_id?: string | null;
  affected_user_id?: string | null;
  field_name?: string | null;
  previous_value?: unknown;
  new_value?: unknown;
  action_id?: string | null;
  source?: string | null;
};

export type NewAuditEvent = Omit<AuditEvent, "id" | "created_at" | "created_by_user_id">;

export type AuditProfile = {
  id: string;
  email: string;
  name?: string | null;
  full_name?: string | null;
  organisation_id?: string | null;
};

export type AuditBuilding = { id: string; name: string };
export type AuditUnit = { id: string; building_id: string; unit_number: string };
export type AuditOrganisation = { id: string; name: string };

export type AuditContext = {
  profiles: AuditProfile[];
  buildings: AuditBuilding[];
  units: AuditUnit[];
  organisations: AuditOrganisation[];
};

export type AuditChange = {
  field: string;
  previous: unknown;
  next: unknown;
};

export type AuditSubject = {
  primary: string;
  secondary: string | null;
  buildingId: string | null;
  unitId: string | null;
  affectedUserId: string | null;
};
