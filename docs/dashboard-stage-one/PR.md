# Simplify the internal dashboard into position and attention summaries

Intended base: `staging`

Head: `codex/dashboard-stage-one`

The admin/developer dashboard currently duplicates detailed module worklists. Replace that presentation with building/portfolio position, a compact team-attention table, one dates section and collapsed recent activity. Keep external Sales, contractor and representative layouts, approved working pages, ownership, calculations and access checks unchanged.

Sales counts reuse the canonical row selector and link to the corresponding responsibility view. Fee, snag and rental counts remain non-interactive where the source population or available URL filters cannot provide an exact match; clearly labelled module links remain available. Additional existing work and date exceptions are preserved. No new fetching, schema, workflow or deployment configuration is introduced.

Validation: TypeScript and production build passed; 48 dashboard tests, 308 Sales tests and 11 synthetic browser tests passed. Focused lint is clean. Repository lint has the same 20 errors / 33 warnings as the baseline. Rentals passed 57/58; the failing fee-scope source assertion also fails unchanged on the baseline.

See [the delivery report](README.md) for source/destination mappings, scope limitations and desktop/mobile screenshots. Agent Fees counts explicitly cover active-sale work; full fee portfolio reconciliation remains a recorded limitation. There is no combined dates destination, so remaining exceptions are available in the dashboard disclosure.

Publication note: this PR text is prepared locally. Remote branch/PR creation was blocked by the connector's approval requirement; no preview was deployed and no merge is requested.
