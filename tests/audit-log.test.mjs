import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const portal = readFileSync("src/components/portal/ProductionPortalApp.tsx", "utf8");
const component = readFileSync("src/components/portal/audit/AuditLog.tsx", "utf8");
const formatter = readFileSync("src/lib/audit/format.ts", "utf8");
const migration = readFileSync("supabase/migrations/20260831b_audit_log_structure.sql", "utf8");

test("Setup presents the mature view as Audit log while retaining the historic route", () => {
  assert.match(portal, /setup_activity:\s*\{\s*label: "Audit log"/);
  assert.match(portal, /activity_log: "setup_activity"/);
  assert.match(portal, /<AuditLog/);
  assert.doesNotMatch(portal, /function AuditPanel/);
});

test("Audit log supports the required toolbar, quick filters and responsive detail view", () => {
  assert.match(component, /\["all", "sales", "rentals", "users", "setup", "security", "reports"\]/);
  for (const label of ["All buildings", "All events", "All users", "Any date", "Reset"]) {
    assert.match(component, new RegExp(label));
  }
  for (const heading of ["Date", "Activity", "Subject", "Change", "User"]) {
    assert.match(component, new RegExp(`>${heading}<`));
  }
  assert.match(component, /role="dialog"/);
  assert.match(component, /aria-modal="true"/);
  assert.match(component, /md:hidden/);
  assert.match(component, /hidden md:block/);
});

test("Formatting hides machine enums and redacts sensitive technical metadata", () => {
  assert.match(formatter, /not_for_sale: "Not for sale"/);
  assert.match(formatter, /for_sale: "For sale"/);
  assert.match(formatter, /not_in_portfolio: "Not included"/);
  assert.match(formatter, /sensitiveKey = \/\(password\|passcode\|token\|secret\|session/);
  assert.match(formatter, /sanitizeAuditMetadata/);
});

test("Schema extension is nullable, indexed and leaves audit RLS untouched", () => {
  assert.match(migration, /add column if not exists category text/);
  assert.match(migration, /previous_value jsonb/);
  assert.match(migration, /new_value jsonb/);
  assert.match(migration, /action_id uuid/);
  assert.match(migration, /audit_events_category_created_at_idx/);
  assert.doesNotMatch(migration, /drop table|delete from|alter policy|drop policy/i);
});
