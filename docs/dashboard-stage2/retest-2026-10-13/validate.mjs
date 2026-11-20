// Runs existing, unchanged synthetic regression suites in the clean PR snapshot.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const output = path.resolve(process.argv[2]);
fs.mkdirSync(output, { recursive: true });
const scripts = JSON.parse(fs.readFileSync('package.json')).scripts;
const groups = ['test:dashboard','test:sales','test:fees','test:rentals','test:sales-refresh'];
const files = [...new Set(groups.flatMap(k=>scripts[k].match(/tests\/[^ ]+\.mjs/g)))].sort();
const results = [];
function run(name, args) {
  const started = new Date().toISOString();
  const result = spawnSync(process.execPath,args,{encoding:'utf8',maxBuffer:20e6});
  const text = (result.stdout??'')+(result.stderr??'');
  fs.writeFileSync(path.join(output,`${name}.log`),text);
  const summary = { name, args, started, finished:new Date().toISOString(), exit:result.status,
    totals:Object.fromEntries(['tests','pass','fail','skipped'].map(k=>[k, Number(text.match(new RegExp(`(?:# |ℹ )${k} (\\d+)`))?.[1]??NaN)])) };
  results.push(summary); fs.writeFileSync(path.join(output,'validation.json'),JSON.stringify({groups,files,results},null,2));
  console.log(JSON.stringify(summary));
}
run('regression',['--test','--test-concurrency=2','--test-reporter=tap',...files]);
run('typegen',[require.resolve('next/dist/bin/next'),'typegen']);
run('typescript',[require.resolve('typescript/bin/tsc'),'--noEmit']);
run('changed-file-eslint',[path.join(path.dirname(require.resolve('eslint/package.json')),'bin/eslint.js'),'src/lib/dashboard/read.ts','src/lib/dashboard/read-diagnostics.ts','tests/dashboard-stage2-scheduling.test.mjs','tests/dashboard-read-diagnostics.test.mjs','tests/helpers/dashboard-read-client.mjs','scripts/diagnostics/dashboard-stage2.mjs','scripts/diagnostics/summarize-dashboard-stage2.mjs']);
