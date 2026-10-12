// No network or real records. Compare the existing and reduced response for
// exactly the same authorised synthetic input and serialize both as UTF-8 JSON.
import { mkdirSync, writeFileSync } from 'node:fs';
import { loadTypescriptModule } from '../../tests/helpers/load-typescript-module.mjs';
import { fixture, unit, sale } from '../../tests/helpers/dashboard-fixture.mjs';
const { deriveDashboard } = loadTypescriptModule('src/lib/dashboard/model.ts');
const { deriveInternalOverview } = loadTypescriptModule('src/lib/dashboard/overview.ts');
const { dashboardResponse } = loadTypescriptModule('src/lib/dashboard/response.ts');
const units = Array.from({ length: 60 }, (_, i) => ({ ...unit, id: `unit-${i}`, unit_number: String(i + 1) }));
const sales = units.map((u, i) => ({ ...sale, id: `sale-${i}`, unit_id: u.id, contractual_completion_date: i < 8 ? '2026-10-08' : '2027-02-01' }));
const input = fixture({ units, sales });
const before = deriveDashboard(input);
before.overview = deriveInternalOverview(input, before);
const after = dashboardResponse(input);
const size = snapshot => Buffer.byteLength(JSON.stringify(snapshot));
const result = { conditions: '60 synthetic authorised sales, eight near-term dates; identical fixed time and input. Uncompressed UTF-8 JSON. Not the staging HAR population.', before: { bytes: size(before), items: before.items.length }, after: { bytes: size(after), items: after.items.length }, reductionPercent: Number(((1 - size(after) / size(before)) * 100).toFixed(1)) };
mkdirSync('docs/dashboard-stage1', { recursive: true });
writeFileSync('docs/dashboard-stage1/payload.json', JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
