// Generates an opt-in preview configuration; never deploys or assigns an alias.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = name => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
const base = read('vercel.json');
const overlay = read('config/vercel.staging-legal-region.json');
const legalRoute = 'src/app/api/sales/legal/route.ts';
if (!fs.existsSync(path.join(root, legalRoute))) throw Error('Expected Sales legal route is missing.');
if (JSON.stringify(overlay.regions) !== '["iad1"]' ||
    JSON.stringify(Object.keys(overlay.functions)) !== JSON.stringify([legalRoute]) ||
    JSON.stringify(overlay.functions[legalRoute].regions) !== '["fra1"]') {
  throw Error('Unexpected staging region overlay.');
}
const config = {
  ...base,
  regions: overlay.regions,
  functions: {
    ...base.functions,
    [legalRoute]: { ...base.functions?.[legalRoute], ...overlay.functions[legalRoute] },
  },
};
if (process.argv.includes('--check')) {
  console.log(JSON.stringify(config, null, 2));
} else {
  const branch = execFileSync('git', ['branch', '--show-current'], { cwd: root, encoding: 'utf8' }).trim();
  if (branch !== 'staging') throw Error('Generate this preview configuration from the staging branch only.');
  const directory = path.join(root, '.vercel');
  fs.mkdirSync(directory, { recursive: true });
  const destination = path.join(directory, 'staging-legal-region.json');
  fs.writeFileSync(destination, `${JSON.stringify(config, null, 2)}\n`);
  console.log('Prepared .vercel/staging-legal-region.json; no deployment or alias change was made.');
}
