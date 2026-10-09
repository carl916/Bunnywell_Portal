# Frankfurt trial archive

Preserved 9 October 2026 for Phase 2D. Start with the [trial report](../staging-full-frankfurt-trial.md). Frankfurt was **not activated**: typical requests improved, but two long dashboard database-read stalls failed the reliability gate. Measurements describe the recorded deployments, not current service health.

## Retained evidence

| Files | Purpose |
| --- | --- |
| `browser.json`, `summary.json`, `distributions.md` | Raw timing metadata for 996 interactions and derived distributions |
| `api.json`, `api-summary.json` | Paired API timings and summaries |
| `dashboard-tail.json` | Focused dashboard follow-up, including the 46.7-second stall and request IDs for investigation |
| `snags-followup.json`, `snags-summary.json` | Separate eight-pair desktop Snags follow-up |
| `assets.json`, `navigation-detail.json` | Asset equivalence and navigation timing evidence |
| `content.json` | Content hash, role and scope checks without business response bodies |
| `environment.json`, `infrastructure.json`, `final-aliases.json`, `final-probes.json` | Recorded deployment identities, region checks and unchanged staging/production evidence |
| `node-tests.txt`, `config-tests.txt`, `functional.txt`, `functional-control.txt` | Original test outcomes, including existing failures and configuration rerun |

The seven `scripts/diagnostics/*region*.mjs` helpers and `playwright.region-trial.config.ts` preserve collection, staging guards, offline summaries and the synthetic-only test selection. The separate [dashboard review](../dashboard-functionality-review.md) is retained as a historical design inventory; its original screenshot and descriptions predate the trial's worklist dashboard.

## Archive hygiene

Timing samples, hashes and request IDs were preserved. Deployment/project identifiers and public deployment URLs remain for correlation. Unnecessary creator metadata and environment-entry IDs/timestamps were removed from `environment.json`. Machine-specific workspace paths were replaced in browser test logs; the Node log retains individual outcomes and totals with a concise failure summary instead of duplicated application source and sandbox stack traces. A hard-coded account email was replaced with a required environment variable in the diagnostic helper.

No credentials, auth state, HAR files or business response bodies are included. Chromium `debug.log` is ignored. Pilot runs, duplicated generated output, local authentication files and temporary reports remain excluded under existing ignore rules. The preservation work did not rerun live benchmarks or alter application code, deployment configuration or production.

## Reuse without contacting services

From the repository root, with dependencies already installed, these PowerShell commands regenerate the main summaries into the ignored `test-results` directory:

```powershell
New-Item -ItemType Directory -Force test-results/frankfurt-offline | Out-Null
node scripts/diagnostics/summarize-full-region.mjs docs/staging-full-frankfurt-trial/browser.json test-results/frankfurt-offline/full-region-summary.json
Copy-Item docs/staging-full-frankfurt-trial/api.json test-results/frankfurt-offline/full-region-api.json
node scripts/diagnostics/full-region-report-tables.mjs test-results/frankfurt-offline
```

For a separately authorised live investigation, follow the report's reproduction instructions and revalidate fixtures and deployment identities first. The staging helper requires `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `PLAYWRIGHT_ADMIN_EMAIL`, `REGISTER_PERF_EMAIL` and `PLAYWRIGHT_ADMIN_PASSWORD` in ignored local environment configuration. Both trial accounts use the configured test password. Never commit these values. Immutable Preview URLs alone do not prove the backend is staging; retain the existing backend and role checks. Keep timed workloads sequential and preserve separate output files for follow-ups.
