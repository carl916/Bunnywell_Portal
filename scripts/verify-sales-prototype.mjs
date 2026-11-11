import ts from "typescript";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
const root = process.cwd();
const entry = path.join(root, "src/app/dev/sales-workspace/page.tsx");
const safePackages = new Set(["react", "lucide-react", "next/navigation"]);
const visited = new Set(), packages = new Set();
function inspect(file) {
  if (visited.has(file)) return;
  visited.add(file);
  const source = fs.readFileSync(file, "utf8");
  assert(!/createSupabase|supabase[/.]|\bfetch\s*\(|XMLHttpRequest|sendBeacon|new WebSocket|new EventSource/.test(source), "Unexpected data-service dependency in " + file);
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  for (const node of ast.statements) {
    if (!ts.isImportDeclaration(node) || node.importClause?.isTypeOnly) continue;
    if (node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings) &&
        !node.importClause.name && node.importClause.namedBindings.elements.every(e => e.isTypeOnly)) continue;
    const specifier = node.moduleSpecifier.text;
    if (specifier.endsWith(".css")) continue;
    if (!specifier.startsWith(".") && !specifier.startsWith("@/")) {
      assert(safePackages.has(specifier), "Unexpected runtime package: " + specifier);
      packages.add(specifier); continue;
    }
    const base = specifier.startsWith("@/") ? path.join(root, "src", specifier.slice(2)) : path.resolve(path.dirname(file), specifier);
    const target = [base, base + ".ts", base + ".tsx"].find(f => fs.existsSync(f) && fs.statSync(f).isFile());
    assert(target, "Could not resolve " + specifier);
    inspect(target);
  }
}
inspect(entry);
const page = fs.readFileSync(entry, "utf8");
assert(page.includes('process.env.NODE_ENV !== "development"') && page.includes("notFound()"));
assert(page.includes('process.env.STAGING_WEB_VITALS === "1"'));
const out = path.resolve(root, process.argv[2] || "artifacts/sales-workspace-prototype/import-audit.json");
const result = { passed: true, entry: path.relative(root, entry), runtimeFiles: [...visited].map(f => path.relative(root, f)).sort(), packages: [...packages].sort(), note: "Runtime import graph contains only audited pure helpers, inert UI, React, icons and next/navigation. Root-layout telemetry must be disabled by the documented launch command." };
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(result, null, 2));
console.log("PASS: " + visited.size + " runtime source files; no business-data clients or requests.");

