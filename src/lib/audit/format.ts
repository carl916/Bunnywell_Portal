import type {
  AuditCategory,
  AuditChange,
  AuditContext,
  AuditEvent,
  AuditProfile,
  AuditSubject,
  NewAuditEvent,
} from "@/lib/audit/types";

const eventLabels: Record<string, string> = {
  building_created: "Building created",
  building_updated: "Building settings updated",
  building_deal_defaults_updated: "Sales defaults updated",
  building_delivery_team_updated: "Delivery team updated",
  building_supporting_trade_added: "Supporting trade added",
  building_supporting_trade_removed: "Supporting trade removed",
  unit_sales_availability_changed: "Sales availability changed",
  unit_added_to_rental_portfolio: "Added to rental portfolio",
  unit_exited_rental_portfolio: "Removed from rental portfolio",
  unit_sale_completed: "Sale completed",
  unit_returned_for_sale: "Returned for sale",
  tenancy_created: "Tenancy created",
  tenancy_updated: "Tenancy updated",
  tenancy_deleted: "Tenancy deleted",
  user_created: "User created",
  user_updated: "User details updated",
  user_reactivated: "User reactivated",
  user_deactivated: "User deactivated",
  user_deleted: "User deleted",
  send_login_reminder: "Login reminder sent",
  send_password_reset: "Password reset sent",
  access_request_approved: "Access request approved",
  access_request_rejected: "Access request rejected",
  access_request_notes_updated: "Access request notes updated",
  organisation_created: "Organisation created",
  organisation_updated: "Organisation updated",
  organisation_deleted: "Organisation deleted",
  report_generated: "Report generated",
  report_sent: "Report sent",
  digest_sent: "Digest sent",
  handover_completed: "Handover completed",
};

const fieldLabels: Record<string, string> = {
  sale_status: "Sales availability",
  sales_availability: "Sales availability",
  rental_portfolio_status: "Rental portfolio",
  workflow_status: "Sales workflow",
  active: "Account status",
  pc_date: "Practical completion date",
  pc_confirmed: "Practical completion confirmed",
  allow_resident_access_requests: "Resident access requests",
  full_name: "Name",
  resident_type: "Resident type",
  organisation_id: "Organisation",
  tenant_name: "Tenant",
  tenancy_start_date: "Tenancy start",
  tenancy_end_date: "Tenancy end",
  monthly_rent: "Monthly rent",
  rent_due_day: "Rent due day",
};

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function metadataValue(metadata: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = metadata[key];
    if (value !== null && value !== undefined && value !== "") return value;
  }
  return null;
}

function metadataId(metadata: Record<string, unknown>, ...keys: string[]) {
  return text(metadataValue(metadata, ...keys));
}

function sentenceCase(value: string) {
  const spaced = value.replace(/[_-]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").trim().toLowerCase();
  return spaced ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : "Event";
}

export function formatAuditEventType(eventType: string) {
  return eventLabels[eventType] ?? sentenceCase(eventType);
}

export function formatAuditEntityType(entityType: string) {
  const labels: Record<string, string> = {
    building: "Building",
    unit: "Unit",
    user: "User",
    profile: "User",
    organisation: "Organisation",
    tenancy: "Tenancy",
    report: "Report",
    handover: "Handover",
    access_request: "Access request",
  };
  return labels[entityType] ?? sentenceCase(entityType);
}

export function getAuditCategory(event: Pick<AuditEvent, "event_type" | "entity_type" | "category">): AuditCategory {
  if (event.category && ["sales", "rentals", "users", "setup", "security", "reports", "system"].includes(event.category)) {
    return event.category as AuditCategory;
  }
  const value = `${event.event_type} ${event.entity_type}`.toLowerCase();
  if (/(password|login|security|auth)/.test(value)) return "security";
  if (/(report|digest)/.test(value)) return "reports";
  if (/(tenan|rental|rent_)/.test(value)) return "rentals";
  if (/(sale|reservation|exchange|completion|deal)/.test(value)) return "sales";
  if (/(user|profile|access_request)/.test(value)) return "users";
  if (/(building|organisation|handover|trade|unit)/.test(value)) return "setup";
  return "system";
}

export function formatAuditCategory(category: AuditCategory) {
  return category === "users" ? "Users" : category.charAt(0).toUpperCase() + category.slice(1);
}

export function formatAuditField(field: string) {
  return fieldLabels[field] ?? sentenceCase(field);
}

export function formatAuditValue(value: unknown, field = ""):
  string {
  if (value === null || value === undefined || value === "") return "Not set";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.length ? value.map((item) => formatAuditValue(item)).join(", ") : "None";
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return text(record.name) ?? text(record.label) ?? "Updated";
  }
  const raw = String(value);
  const enumLabels: Record<string, string> = {
    for_sale: "For sale",
    not_for_sale: "Not for sale",
    not_released: "Not released",
    under_offer: "Under offer",
    reserved: "Reserved",
    exchanged: "Exchanged",
    completed: "Completed",
    not_in_portfolio: "Not included",
    exited: "Removed",
    owner_occupier: "Owner-occupier",
    leaseholder: "Leaseholder",
  };
  if (raw === "active" && field.includes("rental")) return "Included";
  if (raw === "active" && field === "active") return "Active";
  if (raw === "inactive" && field === "active") return "Inactive";
  if (enumLabels[raw]) return enumLabels[raw];
  if (/^\d{4}-\d{2}-\d{2}(T|$)/.test(raw)) {
    const date = new Date(raw.length === 10 ? `${raw}T00:00:00` : raw);
    if (!Number.isNaN(date.valueOf())) return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(date);
  }
  if (field.includes("rent") && /^\d+(\.\d+)?$/.test(raw)) {
    return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 2 }).format(Number(raw));
  }
  return raw.includes("_") ? sentenceCase(raw) : raw;
}

export function profileName(profile?: AuditProfile | null) {
  return profile?.full_name || profile?.name || profile?.email || "Unknown user";
}

export function getAuditSubject(event: AuditEvent, context: AuditContext): AuditSubject {
  const metadata = event.metadata ?? {};
  const unitId = event.unit_id
    ?? metadataId(metadata, "unit_id", "unitId")
    ?? (event.entity_type === "unit" ? event.entity_id : null);
  const unit = context.units.find((item) => item.id === unitId);
  const buildingId = event.building_id
    ?? metadataId(metadata, "building_id", "buildingId")
    ?? unit?.building_id
    ?? (event.entity_type === "building" ? event.entity_id : null);
  const building = context.buildings.find((item) => item.id === buildingId);
  const affectedUserId = event.affected_user_id
    ?? metadataId(metadata, "affected_user_id", "affectedUserId", "user_id", "userId")
    ?? (["user", "profile"].includes(event.entity_type) ? event.entity_id : null);
  const affectedUser = context.profiles.find((item) => item.id === affectedUserId);

  if (unit) return { primary: `Unit ${unit.unit_number}`, secondary: building?.name ?? null, buildingId, unitId, affectedUserId };
  if (affectedUser) return { primary: profileName(affectedUser), secondary: "User account", buildingId, unitId, affectedUserId };
  if (building) return { primary: building.name, secondary: "Building", buildingId, unitId, affectedUserId };
  if (event.entity_type === "organisation") {
    const organisation = context.organisations.find((item) => item.id === event.entity_id);
    const name = organisation?.name ?? text(metadataValue(metadata, "organisation", "name"));
    if (name) return { primary: name, secondary: "Organisation", buildingId, unitId, affectedUserId };
  }
  const metadataSubject = text(metadataValue(metadata, "unit_number", "unitNumber", "email", "tenant_name", "tenantName", "building", "building_name", "name"));
  return {
    primary: metadataSubject ?? event.summary ?? formatAuditEntityType(event.entity_type),
    secondary: metadataSubject ? formatAuditEntityType(event.entity_type) : null,
    buildingId,
    unitId,
    affectedUserId,
  };
}

function comparable(value: unknown) {
  return JSON.stringify(value) ?? String(value);
}

export function getAuditChanges(event: AuditEvent): AuditChange[] {
  const metadata = event.metadata ?? {};
  const changes: AuditChange[] = [];
  const add = (field: string, previous: unknown, next: unknown) => {
    if (previous === undefined && next === undefined) return;
    if (comparable(previous) === comparable(next)) return;
    changes.push({ field: formatAuditField(field), previous, next });
  };

  if (event.field_name) add(event.field_name, event.previous_value, event.new_value);
  const structured = metadata.changes;
  if (Array.isArray(structured)) {
    structured.forEach((change) => {
      if (!change || typeof change !== "object") return;
      const item = change as Record<string, unknown>;
      const field = text(item.field) ?? text(item.field_name);
      if (field) add(field, item.previous ?? item.old, item.next ?? item.new);
    });
  }

  const knownPairs = [
    ["sale_status", "old_sale_status", "new_sale_status"],
    ["rental_portfolio_status", "old_rental_portfolio_status", "new_rental_portfolio_status"],
    ["workflow_status", "old_workflow_status", "new_workflow_status"],
    ["status", "old_status", "new_status"],
  ] as const;
  knownPairs.forEach(([field, oldKey, newKey]) => add(field, metadata[oldKey], metadata[newKey]));

  const oldRecord = metadata.old;
  const newRecord = metadata.new;
  if (oldRecord && newRecord && typeof oldRecord === "object" && typeof newRecord === "object") {
    const oldValues = oldRecord as Record<string, unknown>;
    const newValues = newRecord as Record<string, unknown>;
    const fields = new Set([...Object.keys(oldValues), ...Object.keys(newValues)]);
    fields.forEach((field) => {
      if (["updated_at", "created_at", "id"].includes(field)) return;
      add(field, oldValues[field], newValues[field]);
    });
  }

  if ((event.event_type === "user_deactivated" || event.event_type === "user_reactivated") && !changes.length) {
    const next = metadata.active === true ? "active" : "inactive";
    add("active", next === "active" ? "inactive" : "active", next);
  }
  return changes.slice(0, 12);
}

export function auditChangeSummary(event: AuditEvent, changes = getAuditChanges(event)) {
  if (changes.length) {
    const first = changes[0];
    return `${formatAuditValue(first.previous, first.field.toLowerCase())} → ${formatAuditValue(first.next, first.field.toLowerCase())}`;
  }
  const explicit: Record<string, string> = {
    user_created: "Account created",
    user_deleted: "Account deleted",
    send_login_reminder: "Reminder email sent",
    send_password_reset: "Reset email sent",
    report_generated: "Report created",
    report_sent: "Report delivered",
    digest_sent: "Digest delivered",
    handover_completed: "Handover recorded",
    tenancy_created: "Tenancy record created",
    tenancy_deleted: "Tenancy record removed",
  };
  return explicit[event.event_type] ?? event.summary ?? formatAuditEventType(event.event_type);
}

const sensitiveKey = /(password|passcode|token|secret|session|authorization|cookie|reset.*(?:url|link)|magic.*link)/i;

export function sanitizeAuditMetadata(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeAuditMetadata);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !sensitiveKey.test(key))
      .map(([key, item]) => [key, sanitizeAuditMetadata(item)]),
  );
}

export function buildAuditInsert(event: NewAuditEvent, actor: AuditProfile) {
  const metadata = event.metadata ?? {};
  const changes = getAuditChanges({
    ...event,
    id: "pending",
    created_at: new Date().toISOString(),
    created_by_user_id: actor.id,
  });
  const firstChange = changes[0];
  return {
    ...event,
    category: getAuditCategory(event),
    actor_organisation_id: actor.organisation_id ?? null,
    building_id: metadataId(metadata, "building_id", "buildingId"),
    unit_id: metadataId(metadata, "unit_id", "unitId"),
    affected_user_id: metadataId(metadata, "affected_user_id", "affectedUserId")
      ?? (["user", "profile"].includes(event.entity_type) ? event.entity_id : null),
    field_name: firstChange?.field ?? null,
    previous_value: firstChange?.previous ?? null,
    new_value: firstChange?.next ?? null,
    action_id: metadataId(metadata, "action_id", "actionId", "batch_identifier", "batchIdentifier"),
    source: text(metadataValue(metadata, "source")),
    created_by_user_id: actor.id,
  };
}
