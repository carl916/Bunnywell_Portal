import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const require = createRequire(import.meta.url);
const source = readFileSync(new URL("../src/components/portal/DisplayValue.tsx", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext } });
const compiled = outputText.replaceAll('"react/jsx-runtime"', JSON.stringify(pathToFileURL(require.resolve("react/jsx-runtime")).href));
const { DisplayValue } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
const render = value => renderToStaticMarkup(createElement(DisplayValue, { value }));

test("empty read-only values and existing dash formatters render one muted em dash", () => {
  for (const value of [null, undefined, "", " \t\n ", "-", "—"]) {
    assert.equal(render(value), '<span class="text-[#617169]" data-empty-value="true">—</span>');
  }
});

test("populated values retain their content with no additional element or colour", () => {
  for (const value of [0, "0", "£0.00", false, true, "Example Buyer", "  existing spacing  ", "Awaiting developer approval", "Not handed over"]) {
    assert.equal(render(value), String(value));
  }
  assert.equal(render(createElement("a", { href: "#document" }, "View document")), '<a href="#document">View document</a>');
});
