// Opt-in staging configuration only. Never deploys or assigns an alias.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const registerRoute = 'src/app/api/sales/register/route.ts';
export function stagingRegisterConfig(base, overlay) {
  if (JSON.stringify(Object.keys(overlay).sort()) !== '["functions","regions"]' ||
      JSON.stringify(overlay.regions) !== '["iad1"]' ||
      JSON.stringify(Object.keys(overlay.functions ?? {})) !== JSON.stringify([registerRoute]) ||
      JSON.stringify(overlay.functions[registerRoute]) !== '{"regions":["fra1"]}') {
    throw Error('Unexpected staging register region overlay.');
  }
  if (base.regions && JSON.stringify(base.regions) !== '["iad1"]') {
    throw Error('Default function region changed; review the staging comparison before using this overlay.');
  }
  return { ...base, regions: overlay.regions, functions: {
    ...base.functions,
    [registerRoute]: { ...base.functions?.[registerRoute], ...overlay.functions[registerRoute] },
  } };
}

export function prepareStagingRegisterRegion(root, { check = false } = {}) {
  const read = name => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
  if (!fs.existsSync(path.join(root, registerRoute))) throw Error('Expected Sales register route is missing.');
  const config = stagingRegisterConfig(read('vercel.json'), read('config/vercel.staging-register-region.json'));
  if (check) return config;
  const branch = execFileSync('git', ['branch', '--show-current'], { cwd: root, encoding: 'utf8' }).trim();
  if (branch !== 'staging' || process.env.VERCEL_ENV === 'production') throw Error('Generate this preview configuration from the staging branch only, outside production.');
  const directory = path.join(root, '.vercel');
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'staging-register-region.json'), `${JSON.stringify(config, null, 2)}\n`);
  return config;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const check = process.argv.includes('--check');
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const config = prepareStagingRegisterRegion(root, { check });
  console.log(check ? JSON.stringify(config, null, 2) : 'Prepared .vercel/staging-register-region.json; no deployment or alias change was made.');
}
