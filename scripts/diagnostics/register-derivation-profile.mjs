import fs from 'node:fs';
import { loadTypescriptModule } from '../../tests/helpers/load-typescript-module.mjs';
import { fixture, unit, sale } from '../../tests/helpers/dashboard-fixture.mjs';
const { deriveSalesRegister } = loadTypescriptModule('src/lib/sales/register.ts');
const results = [];
for (const size of [63, 134, 601]) {
  const input = fixture({ viewer: { id: 'viewer', role: 'conveyancer', organisation_id: 'legal-org' },
    units: Array.from({ length: size }, (_, i) => ({ ...unit, id: `u${i}`, unit_number: String(i + 1) })),
    sales: Array.from({ length: size }, (_, i) => ({ ...sale, id: `s${i}`, unit_id: `u${i}` })),
  });
  const samples = [];
  for (let run = 0; run < 9; run++) { const start = performance.now(); deriveSalesRegister(input); if (run) samples.push(performance.now() - start); }
  results.push({ size, samples });
}
fs.mkdirSync('test-results', { recursive: true });
fs.writeFileSync('test-results/register-synthetic-cpu.json', JSON.stringify(results, null, 2));
console.log(JSON.stringify(results));
