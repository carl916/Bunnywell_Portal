import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  SALE_STATUS_WORKFLOW_ONLY_ERROR,
  updateUnitStructure,
} from "../src/lib/units/structural-update.ts";

const portalSource = readFileSync("src/components/portal/ProductionPortalApp.tsx", "utf8");
const structuralRouteSource = readFileSync("src/app/api/buildings/units/[unitId]/route.ts", "utf8");
const salesRouteSource = readFileSync("src/app/api/sales/reservations/route.ts", "utf8");

function functionBody(source, name, nextName) {
  const start = source.indexOf(`function ${name}`);
  assert.notEqual(start, -1, `${name} should exist`);
  const end = source.indexOf(`function ${nextName}`, start + 1);
  assert.notEqual(end, -1, `${nextName} should follow ${name}`);
  return source.slice(start, end);
}

const validStructuralUpdate = {
  unit_number: "2.04",
  floor: "Second",
  size_sqm: 74.5,
  parking_bays: [18],
  unit_type_id: "two-bedroom-type",
};

test("Building Structure removes the sale-status editor but retains the read-only card badge", () => {
  const unitCard = functionBody(portalSource, "UnitStructureCard", "AreaChip");

  assert.doesNotMatch(unitCard, /editSaleStatus|setEditSaleStatus|adminEditableUnitSaleStatuses/);
  assert.doesNotMatch(unitCard, /option value="(?:for_sale|reserved|exchanged|completed|handed_over)"/);
  assert.match(unitCard, /statusTone\(unit\.sale_status\)/);
  assert.match(unitCard, /statusLabel\(unit\.sale_status\)/);
});

test("a structural update changes allowed fields while preserving a reserved sale status", async () => {
  let unit = {
    id: "unit-204",
    building_id: "building-a",
    unit_number: "2.03",
    floor: "Second",
    size_sqm: 70,
    parking_bays: [],
    unit_type_id: "one-bedroom-type",
    unit_type: "1-bed",
    sale_status: "reserved",
  };
  let receivedPayload;

  const updated = await updateUnitStructure({
    async findUnitTypeName() {
      return "2-bed";
    },
    async updateUnit(unitId, payload) {
      receivedPayload = payload;
      unit = { ...unit, ...payload, id: unitId };
      return unit;
    },
  }, unit.id, validStructuralUpdate);

  assert.equal(updated.size_sqm, 74.5);
  assert.deepEqual(updated.parking_bays, [18]);
  assert.equal(updated.unit_type, "2-bed");
  assert.equal(updated.sale_status, "reserved");
  assert.equal(Object.hasOwn(receivedPayload, "sale_status"), false);
});

test("a tampered structural request containing sale_status is rejected before any update", async () => {
  let updateCalls = 0;
  const originalUnit = { sale_status: "reserved", size_sqm: 70 };

  await assert.rejects(
    updateUnitStructure({
      async findUnitTypeName() {
        return "2-bed";
      },
      async updateUnit() {
        updateCalls += 1;
        return null;
      },
    }, "unit-204", { ...validStructuralUpdate, sale_status: "completed" }),
    { message: SALE_STATUS_WORKFLOW_ONLY_ERROR },
  );

  assert.equal(updateCalls, 0);
  assert.equal(originalUnit.sale_status, "reserved");
  assert.equal(originalUnit.size_sqm, 70);
});

test("the protected route uses the structural allow-list and never forwards an arbitrary request body", () => {
  assert.match(structuralRouteSource, /updateUnitStructure\(/);
  assert.match(structuralRouteSource, /\["admin", "developer"\]\.includes/);
  assert.match(structuralRouteSource, /unit_number: payload\.unit_number/);
  assert.match(structuralRouteSource, /unit_type: payload\.unit_type/);
  assert.doesNotMatch(structuralRouteSource, /\.update\((?:body|payload)\)/);
});

test("reservation approval remains a legitimate workflow writer for the unit summary status", () => {
  const start = salesRouteSource.indexOf("async function approveReservation");
  const end = salesRouteSource.indexOf("async function rejectReservation", start);
  const approval = salesRouteSource.slice(start, end);

  assert.match(approval, /workflow_status: "approved"/);
  assert.match(approval, /rpc: "sales_workflow_mark_unit_reserved"/);
  assert.match(approval, /from\("units"\)\.update\(\{ reservation_date: reservationDate \}\)/);
});
