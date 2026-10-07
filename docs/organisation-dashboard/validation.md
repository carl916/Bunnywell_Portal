# Validation and measured limits

## Automated checks

Baseline before implementation: 430 unit tests, 429 passed, one pre-existing failure in `tests/global-building-context.test.mjs:53` because its source assertion rejects the existing AuditLog building filter. Baseline type checking passed. Broad repository lint already reported 324 errors / 5,523 warnings, including generated files and existing hook violations; this is not a clean lint baseline.

Commands used:

```powershell
node --test tests/*.test.mjs
node --test tests/organisation-dashboard*.test.mjs
node node_modules/typescript/bin/tsc --noEmit
node node_modules/eslint/bin/eslint.js src/lib/dashboard src/components/portal/dashboard src/app/api/dashboard tests/organisation-dashboard*.mjs tests/organisation-dashboard*.ts scripts/diagnostics/dashboard*.mjs
node node_modules/next/dist/bin/next build
node node_modules/@playwright/test/cli.js test --config playwright.dashboard.config.ts tests/organisation-dashboard.spec.ts tests/sales-legal-workflow.spec.ts tests/sales-stage-tasks.spec.ts
```

The final full unit run has 469 tests: 468 pass and the same one pre-existing audit-filter assertion fails. The 39 dashboard unit/API/PostgreSQL checks pass. The browser regression run passed all 30 tests (seven new dashboard tests and 23 existing Sales tests). Type checking, targeted lint and the production build pass. Initial sandboxed build could not download the existing Google fonts; the network-enabled build succeeded. Existing changed-file lint is compared against the actual base commit in [numeric evidence](evidence/existing-file-lint-comparison.json); broad legacy lint failures are not suppressed or represented as fixed.

New tests cover organisation continuity, all core sale/document cycles, fee/rental/snags/lifecycle derivation, London DST, complete pagination, mocked route permission/revocation/error boundaries, browser scope/deep links, stale data, hidden/inactive polling and responsive reflow. The PostgreSQL integration uses actual existing legal migrations in PGlite, two developers/two conveyancers, stale version rejection, independent sibling approval and one completion event after repeated confirmation. Its minimal fixture schema is not a substitute for deployed RLS.

## Real staging dry run

Target positively verified: Supabase project `vxkpvdtrldwwqiddoyof` (staging), with local feature code on port 3011. This is **not** a claim that the shared staging UI contains this change. No production database was queried or changed.

The run used existing synthetic building `E2E Completion Upload 2026-09-22`, unit `UPLOAD-3`, sale `4de11b22-918e-475d-b569-a074782efd56`. New temporary `@example.invalid` accounts used direct confirmed creation (no invitation). All 16 accounts across setup/retry/final runs were disabled and banned afterwards. Credentials/tokens/browser state were not saved. Evidence contains synthetic IDs and role labels only.

Verified with real authenticated requests and browser uploads:

- Two distinct developer accounts and two distinct conveyancer accounts received identical respective work for the selected test scope.
- Actual resumable browser upload created two current review tasks. One developer approved the account; another queried the statement. The second conveyancer saw the current query, uploaded a replacement and preserved the sibling approval.
- The real authoritative endpoint rejected approval of the superseded version; current-version approval succeeded.
- A legacy missing contractual date was rejected by completion. That revealed and fixed an incorrect dashboard-ready claim. The existing date-correction endpoint saved synthetic notice/due dates; the warning then cleared.
- A second legacy inconsistency (exchanged attempt, For sale unit) was rejected by completion. The dashboard now surfaces stage reconciliation and withholds readiness. The guard was not weakened and the unit was not force-progressed.
- A second session of the same account saw the same work. Disabling a test account made its still-held JWT return 403 for the dashboard.

[Initial setup attempt](evidence/staging-setup-attempt.json), [document handoffs and discovered date gap](evidence/staging-handoffs.json), [date correction and discovered unit gap](evidence/staging-legacy-date-correction.json), [final continuity/revocation/guard checks](evidence/staging-handoffs-continued.json). Failed intermediate runs are deliberately retained, not rewritten as successful.

Staging writes were limited to synthetic test profiles/access rows, the synthetic attempt's explicit conveyancer assignment, synthetic uploaded document versions/query/approvals and saved notice/due dates. No legal completion, payment or handover was recorded. No legal emails, notifications or invitations were sent by the diagnostic. The unused `DASH-f5ba1e74` setup unit was removed after verifying it had no sale attempt. Existing approved UPLOAD-1/UPLOAD-2 fixtures were not changed. No schema migrations were added or applied.

**Incomplete live coverage:** the full fresh agent reservation → authority email → exchange → notice → completion → handover chain, valid duplicate-completion race, contractor/developer snag handoff, and every restricted role in a real browser were not completed. Relevant rules and mutation guards have local automated coverage, but this does not replace the remaining staging review. Agency isolation is an accepted permission gap, not a passing test.

## Scenario coverage against the request

| Requested cases | Evidence and limit |
| --- | --- |
| 1–3 equivalent colleagues/shared logins/developer team | Pure derivation, real staging separate accounts, successive shared session, PostgreSQL full legal handoff |
| 4 agency separation | Not satisfied by existing building-wide access; explicitly retained at user direction |
| 5 correspondence does not grant rights | JWT/RLS read path, assignment independent from routing; full restricted colleague live matrix pending |
| 6–7 role differences, tampering, revocation | Mocked route tests plus existing permissions/PostgreSQL suites; real inactive-token rejection; complete live role matrix pending |
| 8 unread independence/visible filters | Pure model has no unread/login inputs; browser reset controls; mentions remain separate |
| 9–12 reservation/commercial/authority cycles | Pure, existing browser and PostgreSQL tests; full fresh live chain pending |
| 13–14 deposit/notice | Canonical helpers, pure and existing browser suites; no new gate; legacy date gap fixed from live evidence |
| 15–17 documents/versions/approval locks | Pure, browser, PostgreSQL and real staging uploads/query/replacement/stale approval rejection |
| 18 saved dates/today/completed | Pure London-date tests, existing browser date-edit tests and real legacy correction |
| 19 eligible handover/late handover | Canonical helper and pure tests; real handover pending |
| 20 active attempts/multiple tasks | Pure tests, shared grouping/counts, browser pagination |
| 21 concurrent stale mutation/repetition | Real stale approval rejection; PostgreSQL repeated completion has one event; live valid completion race pending |
| 22 delivery freshness/no sending | Read route never invokes provider/expiry/send; no persisted provider checked-at exists |
| 23–26 snag teams/cycles/trade/resident urgency | Pure rules and exact browser snag drill-through; real two-role mutation handoff pending |
| 27 invoice states | Canonical portfolio helper and existing/pure tests; real financial action intentionally not performed |
| 28–29 rentals/episodes/freshness | Existing canonical and new pure tests; no live importer mutation |
| 30 resident access >100 | 301-request route fixture, shared complete read, exact request destination |
| 31 buildings/overlap | Pure tests and explicit overlap labels |
| 32 row limits | Counted pagination tests including smaller provider pages, truncation/change/errors; browser 23 records / ten-row pages |
| 33 London DST/precision | Deterministic date tests across both clock changes |
| 34 honest failures/zero/no access | Pure/API tests and stale browser refresh/403 clearing |
| 35 exact destinations/back | Browser completion and snag destinations, scope/version URL tests; exhaustive live module navigation pending |
| 36 no fake activity | Read-only summary route tests; existing deliberate-unit-open intent; domain-only activity avoids generic audit duplication |
| 37 refresh | Browser controlled clock: minute polling, hidden/inactive pause, refresh, scope and revocation; no full portal polling |
| 38 responsive/accessibility | Synthetic 320/360/390/768/1280/1440 widths, keyboard focus and no horizontal overflow; screenshots included |

## Performance comparison

Same deterministic intercepted records, role, scope and five journeys, Chromium, local Next 16.2.7 development server, warm assets, three samples. Baseline is an exported checkout of `1dfbeea`; after is feature code. API/auth/PostgREST response counts and uncompressed body bytes exclude JavaScript/assets. Durations end when the expected UI is visible; bodies settle through network-idle. Empty/small synthetic tables make this a request-shape comparison, not a production latency or scalability benchmark. Building-change readiness is a UI check; network settlement captures the summary fetch separately.

| Journey | Baseline visible ms (3) | After visible ms (3) | Data requests before → after | Body bytes before → after |
| --- | --- | --- | --- | --- |
| Dashboard opening | 278 / 318 / 278 | 222 / 233 / 260 | 25 → 19 | 1,724 → 8,847 |
| Building change | 21 / 24 / 23 | 41 / 39 / 40 | 0 → 3 | 0 → 7,168 |
| External Sales landing | 329 / 334 / 338 | 318 / 340 / 327 | 37 → 29 | 2,237 → 8,035 |
| Open Exchange task | 385 / 389 / 428 | 356 / 368 / 372 | 39 → 30 | 5,683 → 5,665 |
| Legal mutation then Sales landing | 149 / 174 / 167 | 179 / 224 / 166 | 7 → 8 | 3,946 → 9,793 |

[Raw baseline](evidence/performance-baseline.json) and [raw after](evidence/performance-after.json) include request categories. The richer read model adds payload and refresh cost. Building change and mutation return are slower in these samples; do not claim an across-the-board speedup. Operational detail deferral reduces initial and task-opening requests. Existing lazy legal history, upload handling and timing instrumentation remain intact.

Final real staging summary reads against the local server returned HTTP 200 with all nine sources ready, `private, no-store`: 1,049 / 773 / 685 ms, 17,108 bytes each, three records/nine tasks. Those are fixture facts at the measured time, not portfolio facts. See [sanitised read evidence](evidence/staging-read.json). No comparable old live aggregate endpoint existed, so these are not labelled before/after backend measurements.
