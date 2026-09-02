import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workspace = readFileSync("src/components/portal/rentals/RentalsWorkspace.tsx", "utf8");
const performance = readFileSync("src/lib/rentals/performance.ts", "utf8");

test("Rentals Overview consumes one shared reporting model", () => {
  assert.match(workspace, /calculateRentalPerformance\(scopedUnits, scopedTenancies/);
  assert.match(workspace, /calculateUnitRentalPerformance\(unit, tenancies/);
  assert.match(performance, /export function calculateRentalPerformance/);
  assert.match(performance, /export function calculateUnitRentalPerformance/);
});

test("Overview separates current position, performance, attention and the rental portfolio", () => {
  for (const label of ["Current position", "Performance", "Management attention", "Rental portfolio"]) {
    assert.match(workspace, new RegExp(label, "i"));
  }
  assert.doesNotMatch(workspace, /Data coverage/i);
  assert.match(workspace, /Monthly rent roll/);
  assert.match(workspace, /Annualised rent roll/);
  assert.match(workspace, /Historical occupancy/);
  assert.match(workspace, /Estimated void rent loss/);
  assert.match(workspace, /Current vs first achieved/);
});

test("reporting-period selector exposes lifetime, YTD and last 12 months", () => {
  assert.match(workspace, /aria-label="Reporting period"/);
  assert.match(workspace, /value="lifetime">Since first recorded tenancy/);
  assert.match(workspace, /value="ytd">Year to date/);
  assert.match(workspace, /value="last_12_months">Last 12 months/);
  assert.match(workspace, /setReportingPeriod/);
});

test("management attention is derived rather than stored", () => {
  assert.match(workspace, /Longest recorded void/);
  assert.match(workspace, /Largest current rent reduction/);
  assert.match(workspace, /Upcoming fixed-term dates/);
  assert.match(workspace, /Current voids/);
  assert.doesNotMatch(workspace, /performance_status|traffic_light|rag_status/i);
});

test("management table adapts building context and avoids repetitive sales position", () => {
  assert.match(workspace, /\{!buildingId && <th[^>]*>Building<\/th>\}/);
  assert.match(workspace, /Also for sale/);
  assert.match(workspace, /Performance \/ attention/);
  assert.match(workspace, /Rent below first achieved/);
  assert.match(workspace, /Tenancy ending within 90 days/);
  assert.doesNotMatch(workspace, /\["Unit", "Building", "Sales position"/);
  for (const heading of ["Occupancy", "Current rent", "Rent movement", "Current tenancy", "Tenancies", "Recorded void", "Next event"]) {
    assert.match(workspace, new RegExp(`"${heading}"`));
  }
});

test("Rental File is compact and History displays lifetime performance", () => {
  assert.match(workspace, /Rental file/);
  assert.match(workspace, /Rental portfolio/);
  assert.match(workspace, /Occupied/);
  assert.match(workspace, /Open sale file/);
  assert.match(workspace, /Lifetime performance from the first recorded tenancy/);
  for (const label of ["Recorded tenancies", "Recorded void", "Estimated void loss", "First achieved rent", "Current rent", "Rent movement"]) {
    assert.match(workspace, new RegExp(label));
  }
});

test("Rental File restores the portfolio position and offers discreet adjacent-unit navigation", () => {
  assert.match(workspace, /rentalListScrollYRef\.current = window\.scrollY/);
  assert.match(workspace, /window\.scrollTo\(\{ top: savedScrollY, behavior: "auto" \}\)/);
  assert.match(workspace, /getElementById\("rental-unit-list"\).*scrollIntoView/);
  assert.match(workspace, /previousUnit && <button[^>]+aria-label=\{`Previous rental unit/);
  assert.match(workspace, /nextUnit && <button[^>]+aria-label=\{`Next rental unit/);
  assert.match(workspace, /adjacentRentalUnits\(filteredUnits, selectedUnitId\)/);
});

test("Current tenancy prioritises core information and subdues provenance", () => {
  assert.match(workspace, />Tenant<\/dt>/);
  assert.match(workspace, />Tenancy<\/dt>/);
  assert.match(workspace, />Rent<\/dt>/);
  assert.match(workspace, />Deposit<\/dt>/);
  assert.match(workspace, />Letting agent<\/dt>/);
  assert.match(workspace, /Source \/ reference/);
  assert.match(workspace, /text-sm text-\[#617169\]/);
  assert.doesNotMatch(workspace, /sm:grid-cols-3"><SummaryCard/);
});

test("placeholder tenant names remain visually distinguishable", () => {
  assert.match(performance, /tenant\\s\+\\d\+\\s\*\\\(name not supplied\\\)/);
  assert.match(workspace, /isRealTenantName\(active\.tenant_name\)/);
});
