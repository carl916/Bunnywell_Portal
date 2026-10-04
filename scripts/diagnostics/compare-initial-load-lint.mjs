import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { ESLint } from 'eslint';
const eslint = new ESLint();
const files = ['src/components/portal/ProductionPortalApp.tsx', 'src/components/portal/sales/SalesReservationWorkflow.tsx', 'src/hooks/usePortalBuildingContext.ts'];
const summaries = [];
for (const file of files) {
  const baseline = execFileSync('git', ['show', `a59f3d3bb98781efd14cb5288e46d6a9bb10e6d3:${file}`], { encoding: 'utf8' });
  const before = (await eslint.lintText(baseline, { filePath: file }))[0];
  const after = (await eslint.lintFiles(file))[0];
  const key = message => `${message.ruleId}: ${message.message.split('\n')[0]}`;
  const count = result => result.messages.filter(message => message.severity === 2).reduce((rows, message) => { const name = key(message); rows[name] = (rows[name] ?? 0) + 1; return rows; }, {});
  const old = count(before), fresh = count(after);
  const addedErrors = Object.entries(fresh).filter(([name, total]) => total > (old[name] ?? 0));
  summaries.push({ file, beforeErrors: before.errorCount, afterErrors: after.errorCount, beforeWarnings: before.warningCount, afterWarnings: after.warningCount, addedErrors, beforeRules: old, afterRules: fresh });
}
fs.writeFileSync('artifacts/performance/initial-load/lint-comparison.json', JSON.stringify(summaries, null, 2));
console.log(JSON.stringify(summaries.map(({ file, beforeErrors, afterErrors, addedErrors }) => ({ file, beforeErrors, afterErrors, addedErrors }))));
if (summaries.some(row => row.addedErrors.length)) process.exitCode = 1;
