import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const portal = readFileSync("src/components/portal/ProductionPortalApp.tsx", "utf8");
const activityRoute = readFileSync("src/app/api/auth/activity/route.ts", "utf8");
const usersRoute = readFileSync("src/app/api/admin/users/route.ts", "utf8");
const migration = readFileSync("supabase/migrations/20260903_user_last_active.sql", "utf8");

test("profiles store portal activity with a historical sign-in baseline", () => {
  assert.match(migration, /add column if not exists last_active_at timestamptz/);
  assert.match(migration, /auth_user\.last_sign_in_at/);
  assert.match(migration, /auth_user\.id = profile\.id/);
});

test("activity endpoint authenticates the session and updates only that active profile", () => {
  assert.match(activityRoute, /adminClient\.auth\.getUser\(token\)/);
  assert.match(activityRoute, /\.eq\("id", userData\.user\.id\)/);
  assert.match(activityRoute, /profile\.active === false/);
  assert.match(activityRoute, /update\(\{ last_active_at: lastActiveAt \}\)/);
});

test("portal records visible authenticated activity without retaining last-login UI", () => {
  assert.match(portal, /fetch\("\/api\/auth\/activity"/);
  assert.match(portal, /activityIntervalMs = 5 \* 60 \* 1000/);
  assert.match(portal, /document\.addEventListener\("visibilitychange"/);
  assert.match(portal, />Last active</);
  assert.doesNotMatch(portal, /Last login|lastSignInAt|lastSignInsByUserId/);
  assert.doesNotMatch(usersRoute, /last_sign_in_at|export async function GET/);
});
