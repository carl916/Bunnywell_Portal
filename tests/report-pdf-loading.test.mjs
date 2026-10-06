import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import { jsPDF } from 'jspdf';

// Exercise the actual nested report builder with deterministic, offline data.
// This adapter leaves its PDF layout/image code intact and intercepts only the
// module loader and existing outer component values.
const source = fs.readFileSync('src/components/portal/ProductionPortalApp.tsx', 'utf8');
const tree = ts.createSourceFile('portal.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let builder;
function visit(node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === 'buildReportPdf') builder = node.getText(tree);
  ts.forEachChild(node, visit);
}
visit(tree);
assert.ok(builder);
const compiled = ts.transpileModule(`${builder}\nexports.build = buildReportPdf;`, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
function fixture(loader) {
  const values = {
    brand: { green: '#0f3d2e', gold: '#d6a23a' },
    imageUrlToDataUrl: async () => `data:image/png;base64,${fs.readFileSync('public/bunnywell-report-logo.png').toString('base64')}`,
    building: { name: 'Test building' }, locationLabel: 'Unit 1',
    reportSnags: [{ id:'snag', title:'Offline report fixture', description:'Description retained after lazy loading', status:'open', trade_id:'trade', area_id:'area', created_at:'2026-10-05' }],
    trades: [{id:'trade',name:'Plumbing'}], areas: [{id:'area',name:'Kitchen'}], includePhotos:false, photos:[],
    primarySnagMedia: () => undefined, snagReportImageUrl: () => '', statusLabel: () => 'Open',
    formatDate: () => '5 October 2026', formatDateTime: () => '5 October 2026', require: loader,
  };
  const exports = {};
  new Function(...Object.keys(values), 'exports', compiled)(...Object.values(values), exports);
  return exports.build;
}

test('report PDF dependency is loaded on demand and the real generator preserves report content', async () => {
  let loads = 0;
  const build = fixture(name => { assert.equal(name,'jspdf'); loads++; return {jsPDF}; });
  assert.equal(loads,0);
  const pdf = await build();
  assert.equal(loads,1);
  assert.equal(pdf.getNumberOfPages(),2);
  assert.equal(pdf.internal.pageSize.getWidth().toFixed(2),'595.28');
  const content = pdf.output();
  assert.match(content,/^%PDF-/);
  for (const text of ['SNAGGING REPORT','Test building','Unit 1','Offline report fixture','Description retained after lazy loading','Plumbing','Kitchen','Page 2 of 2']) assert.ok(content.includes(text),text);
});

test('a failed dependency load rejects report generation rather than returning an incomplete PDF', async () => {
  const failure = new Error('Offline chunk failed');
  const build = fixture(() => { throw failure; });
  await assert.rejects(build(), error => error === failure);
});
