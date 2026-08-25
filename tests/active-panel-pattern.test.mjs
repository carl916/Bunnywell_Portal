import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const hookSource = readFileSync("src/hooks/useActivePanel.ts", "utf8");
const salesSource = readFileSync("src/components/portal/sales/SalesReservationWorkflow.tsx", "utf8");
const portalSource = readFileSync("src/components/portal/ProductionPortalApp.tsx", "utf8");
const cssSource = readFileSync("src/app/globals.css", "utf8");

test("active panels share render-aware, reduced-motion viewport handling", () => {
  assert.match(hookSource, /useLayoutEffect/);
  assert.match(hookSource, /prefers-reduced-motion: reduce/);
  assert.match(hookSource, /isSuitablyPositioned/);
  assert.match(hookSource, /scrollIntoView/);
  assert.match(hookSource, /focus\(\{ preventScroll: true \}\)/);
  assert.match(cssSource, /\.active-panel-target/);
  assert.match(cssSource, /env\(safe-area-inset-top/);
});

test("sales invoice rejection reveals the panel and focuses its reason input", () => {
  assert.match(salesSource, /ref=\{invoiceRejectionPanelRef\}/);
  assert.match(salesSource, /ref=\{invoiceRejectionInputRef\}/);
  assert.match(salesSource, /requestInvoiceRejectionPanel\(\{ focus:/);
});

test("snag creation uses the shared panel transition when opening and continuing", () => {
  assert.match(portalSource, /ref=\{addSnagPanelRef\}/);
  assert.match(portalSource, /setShowAddSnag\(true\);\s*requestAddSnagPanel\(\);/);
  assert.match(portalSource, /onRequestActivePanel\(\{ focus: \(\) => titleInputRef\.current \}\)/);
  assert.doesNotMatch(portalSource, /focusTitleWithoutJump/);
});
