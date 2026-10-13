import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

const source = readFileSync(new URL("../src/components/portal/EnvironmentBanner.tsx", import.meta.url), "utf8");
const require = createRequire(import.meta.url);
function render(env, compact) {
  const compiled = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS } }).outputText;
  const exports = {};
  new Function("exports", "require", "process", compiled)(exports, require, { env });
  return renderToStaticMarkup(createElement(exports.EnvironmentBanner, { compact }));
}

test("both warning variants obey the existing environment flag", () => {
  for (const flag of [undefined, "false", "0"]) for (const compact of [false, true]) {
    assert.equal(render({ NEXT_PUBLIC_SHOW_ENV_BANNER: flag, NEXT_PUBLIC_PORTAL_ENV: "staging" }, compact), "");
  }
});

test("staging remains unmistakably not live in full and compact headers", () => {
  const env = { NEXT_PUBLIC_SHOW_ENV_BANNER: "true", NEXT_PUBLIC_PORTAL_ENV: "staging" };
  assert.match(render(env, false), /STAGING - NOT LIVE/);
  assert.match(render(env, true), /Staging · Not live/);
});

test("other environment names keep their meaning", () => {
  assert.match(render({ NEXT_PUBLIC_SHOW_ENV_BANNER: "true" }, true), /NON-PRODUCTION · Not live/);
  assert.doesNotMatch(render({ NEXT_PUBLIC_SHOW_ENV_BANNER: "true", NEXT_PUBLIC_PORTAL_ENV: "production" }, true), /Not live/);
});
