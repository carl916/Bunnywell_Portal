import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const portal = readFileSync("src/components/portal/ProductionPortalApp.tsx", "utf8");
const allocation = readFileSync("src/components/portal/UnitAllocationWorkspace.tsx", "utf8");
const styles = readFileSync("src/app/globals.css", "utf8");

function functionBody(source, name, nextName) {
  const start = source.indexOf(`function ${name}`);
  assert.notEqual(start, -1, `${name} should exist`);
  const end = source.indexOf(`function ${nextName}`, start + 1);
  assert.notEqual(end, -1, `${nextName} should follow ${name}`);
  return source.slice(start, end);
}

test("Setup uses a compact accessible horizontal sub-navigation", () => {
  const setup = functionBody(portal, "SetupSection", "Dashboard");
  assert.match(setup, /overflow-x-auto border-b/);
  assert.match(setup, /role="tab"/);
  assert.match(setup, /aria-selected=\{activeTab === item\}/);
  assert.doesNotMatch(setup, /sm:grid-cols-4/);
});

test("Buildings presents lifecycle, delivery team and sales setup as summaries with explicit edit modes", () => {
  const buildings = functionBody(portal, "AdminSetup", "BuildingSalesSetup");
  const sales = functionBody(portal, "BuildingSalesSetup", "BuildingDeliveryTeam");
  const delivery = functionBody(portal, "BuildingDeliveryTeam", "DeveloperSnagging");

  assert.match(buildings, /Building lifecycle/);
  assert.match(buildings, /editingSettingsSection === "lifecycle"/);
  assert.match(buildings, /cancelBuildingSettings/);
  assert.match(buildings, /Building overview/);
  assert.match(buildings, /onBuildingContextChange\(building\.id\)/);
  assert.doesNotMatch(buildings, /aria-label="Change building"/);
  assert.doesNotMatch(buildings, />Working building</);
  assert.match(sales, /if \(!isEditing\)/);
  assert.match(sales, /applySalesValues\(savedValues\)/);
  assert.match(delivery, /!isEditing \? \(/);
  assert.match(delivery, /Supporting trades/);
  assert.match(delivery, /Save changes/);
});

test("Building structure keeps full edit capability behind compact unit rows", () => {
  const floor = functionBody(portal, "FloorBlock", "CommunalAreaRow");
  const unit = functionBody(portal, "UnitStructureCard", "AreaChip");
  assert.match(floor, />Unit<\/span><span>Type<\/span><span>Area<\/span><span>Parking<\/span><span>Sale status/);
  assert.match(unit, /editing \? \(/);
  assert.match(unit, /Rooms/);
  assert.match(unit, /Private amenity/);
  assert.match(unit, /lg:grid-cols-\[10rem_9rem_6rem_6rem_minmax\(12rem,1fr\)_auto\]/);
});

test("Unit allocation inherits the global building context and keeps actions beside their state", () => {
  assert.match(allocation, /buildingContextId: string/);
  assert.match(allocation, /const buildingFilter = buildingContextId/);
  assert.doesNotMatch(allocation, /allocationBuildingId/);
  assert.doesNotMatch(allocation, /aria-label="Building context"/);
  assert.match(allocation, /Current scope[\s\S]*SummaryMetric/);
  assert.match(allocation, /selectedIds\.length > 0/);
  assert.match(allocation, /Select units to make bulk changes/);
  assert.match(allocation, /function SalesAvailabilityMenu/);
  assert.match(allocation, /document\.addEventListener\("pointerdown", handlePointerDown\)/);
  assert.match(allocation, /xl:hidden/);
  assert.doesNotMatch(allocation, />Actions<\/th>/);
  assert.doesNotMatch(allocation, /Remove from rental portfolio/);
  assert.doesNotMatch(allocation, /Add to rental portfolio/);
});

test("Unit allocation actions share one quiet icon-and-label treatment", () => {
  assert.match(allocation, /function AllocationAction/);
  assert.match(allocation, /CircleMinus, CirclePlus, ExternalLink, Pencil/);
  assert.match(allocation, /<Pencil size=\{16\}/);
  assert.match(allocation, /<CircleMinus size=\{16\}/);
  assert.match(allocation, /<ExternalLink size=\{16\}/);
  assert.doesNotMatch(allocation, /className="[^"]*underline[^"]*"[^>]*>(?:Change|Remove|Open file)/);
  assert.match(styles, /\.allocation-action \{[\s\S]*font-size: 0\.9375rem;[\s\S]*font-weight: 600;[\s\S]*line-height: 1\.25rem;/);
  assert.match(styles, /\.allocation-action:focus-visible/);
  assert.match(allocation, /function AllocationStatusActionCell/);
  assert.match(styles, /\.allocation-status-action-cell \{[\s\S]*grid-template-columns: 10\.25rem max-content;[\s\S]*white-space: nowrap;/);
  assert.match(styles, /\.allocation-cell-actions \{[\s\S]*gap: 0\.125rem;/);
});
