import { createRequire } from "node:module";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

// Exercise real route/component code with explicit test adapters, without a
// running server or a connection to a project database.
/** @param {string} filename @param {{ overrides?: Record<string, unknown>, exports?: string[] }} options */
export function loadTypescriptModule(filename, { overrides = {}, exports: extraExports = [] } = {}) {
  const cache = new Map();
  function load(file, addedExports = []) {
    const absolute = path.resolve(file);
    if (cache.has(absolute)) return cache.get(absolute).exports;
    const loadedModule = { exports: {} };
    cache.set(absolute, loadedModule);
    const nativeRequire = createRequire(absolute);
    const source = readFileSync(absolute, "utf8") + (addedExports.length ? `\nexport { ${addedExports.join(", ")} };` : "");
    const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
    const require = (name) => {
      if (Object.hasOwn(overrides, name)) return overrides[name];
      if (name.endsWith(".module.css")) {
        return new Proxy({}, { get: (_, key) => key === "__esModule" ? false : String(key) });
      }
      if (name.startsWith("@/") || name.startsWith(".")) {
        const base = name.startsWith("@/") ? path.resolve("src", name.slice(2)) : path.resolve(path.dirname(absolute), name);
        const target = [base, `${base}.ts`, `${base}.tsx`].find((candidate) => existsSync(candidate));
        if (target && /\.tsx?$/.test(target)) return load(target);
      }
      return nativeRequire(name);
    };
    new Function("require", "module", "exports", output)(require, loadedModule, loadedModule.exports);
    return loadedModule.exports;
  }
  return load(filename, extraExports);
}
