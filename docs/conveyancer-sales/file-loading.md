# Conveyancer sale file loading

Phase 2B, 9 October 2026. Conveyancer files now load the selected authorised unit from the first detailed request. The existing loader still returns the complete transaction snapshot. The controlled browser comparison improved actionable readiness with unchanged request counts; these results do not establish live staging latency.

## Implementation

Previously, `SalesWorkspace.tsx` checked whether a requested file was accessible, then mounted `SalesReservationWorkflow.tsx` without passing the selected unit. The workflow initialised its selection from the URL in an effect, while independently calling `loadBuildingSalesData()` with every eligible unit in the building, or all accessible buildings in All buildings mode.

The change is confined to those two application components:

- Resolve `salesUnitId` against authorised portal units, the current building and existing Sales eligibility before mounting the file. Unknown or out-of-scope selections return to the register. The workflow also fails closed if its authorised selection is unavailable.
- Pass the selected ID into the workflow and initialise file selection from it. Keep all authorised unit metadata for navigation, sorted with `sortUnitsByBuildingFloorOrder`, but pass only that unit and its actual building to the existing loader. Building defaults remain scoped even in All buildings mode.
- Key only the file subtree by unit ID. A selection change immediately discards the old component's state; its existing cleanup invalidates pending loads. Identity, role, organisation, building and known access changes retain the existing parent scope isolation.
- Keep the register owner mounted across file navigation. Its snapshots, filters, 60-second navigation threshold, 15-second focus threshold, invalidation and coalescing code are unchanged.

`action-refresh.ts`, the legal context endpoint, mutation handlers and permission rules are unchanged. The loader fetches every visible active/inactive attempt for the selected unit, all associated terms, schedules, documents and versions, invoices, payments, actor names and deposit flags. Its complete-snapshot gate still waits for every required read. Legal controls continue to require the existing legal context and current authority/version checks. PDF contents remain on demand.

Internal users retain the original building-wide loader input and snapshot reuse when selecting another file. Other modules, database schema, RLS and deployment configuration are unchanged. No new loader, cache or business-rule implementation was necessary.

## Controlled browser comparison

Baseline: unchanged Phase 1 staging commit `d954d38b1533705315bb9a7383332d5ad901b61f`, measured before application edits. Both variants used local Next 16.2.7 production builds, the same Chromium version and fixture, and no overlapping benchmark run. Each condition had one excluded warmup and five measured repetitions. Each repetition opened Unit 103 from a loaded register after a fresh page visit. The fixture contained 63 units, 126 attempts, 378 documents and 756 versions, plus terms, schedules, invoices and payments. All API/Supabase traffic was intercepted; no real legal mutation or email occurred.

Desktop: 1440×960, CPU 1×, 40 ms response latency and 5,000,000 decoded bytes/s. Mobile condition: 390×844, CPU throttled 4×, 150 ms latency and 200,000 decoded bytes/s. The fixture adds latency plus body-size/throughput **per response**. This is a deterministic response model, not shared TCP bandwidth, a real handset or deployed database timing.

Times below are medians in milliseconds. Detailed data wait spans the existing Sales coordinator's start through complete snapshot publication. Initial structure is the first animation frame containing the file. Actionable readiness is the first frame where the selected file's legal context has loaded and its permitted “Request authority to serve notice” control is enabled. This measures usable progression, not just a shell or spinner. Counts and decoded JSON body bytes include every request in the opening journey and one second after readiness, excluding earlier page/register loading.

| Measurement | Desktop before | Desktop after | Mobile before | Mobile after |
| --- | ---: | ---: | ---: | ---: |
| Detailed Sales requests | 10 | 10 | 10 | 10 |
| Total opening requests | 16 | 16 | 14 | 14 |
| Detailed decoded bytes | 623,604 | 10,068 | 623,604 | 10,068 |
| Total decoded bytes | 629,298 | 15,762 | 629,246 | 15,710 |
| Detailed data wait | 257 | 164 | 2,813 | 525 |
| Initial file structure | 269 | 180 | 2,878 | 582 |
| Actionable readiness | **330** | **230** | **3,097** | **807** |
| Actionable range | 329–331 | 229–231 | 3,087–3,119 | 791–824 |
| Requests started after readiness within 1 s | 0 | 0 | 0 | 0 |
| Failed responses / requests / browser exceptions | 0 | 0 | 0 | 0 |

Detailed payload decreased 98.4%; median actionable wait decreased 30.3% on desktop and 73.9% in the mobile model. There were no readiness regressions among the five measured samples or duplicate detailed loads. Desktop opens the docked conversation, explaining its two additional discussion requests. Opening the file made no register request. Rendering and the required legal context still add time after detailed publication; these figures do not isolate pure CPU paint time from that subsequent read.

[All samples, including warmups](file-loading-measurements.json). Reproduce with a separately started local production server on port 3011:

```powershell
$env:SALE_FILE_PERF = 'selected-unit' # use baseline against the unchanged staging build
node node_modules/@playwright/test/cli.js test --config playwright.sale-file-performance.config.ts
```

Build with the same public fixture configuration for both runs (`NEXT_PUBLIC_SUPABASE_URL=https://fixture.supabase.co`, `NEXT_PUBLIC_SUPABASE_ANON_KEY=fixture-key`). Use the locally installed Playwright browser path when needed. The harness logs JSON and saves it under ignored `test-results/`.

## Validation

| Check | Result |
| --- | --- |
| `npm run test:sales` | 278 passed, including local PostgreSQL permissions, actors, authority, completion and financial rules |
| `npm run test:sales-refresh` | 55 passed, including complete snapshots, mutation reconciliation, register freshness and identity isolation |
| Handoffs, discussion and performance Node suites | 20 passed, including real SQL in local PGlite for stale versions, colleague handoffs, revocation and discussion access |
| New selected-unit browser tests | 12 passed |
| Existing register browser tests | 26 passed |
| Existing load/error/concurrency browser tests | 5 passed |
| Existing legal/stage browser cases | 23 passed after correcting one test's upload-completion wait; the failed case was rerun separately |
| Performance harness | Both conditions passed; 24 total openings including four warmups |
| TypeScript and production build | Passed |
| Changed-file ESLint | No new errors or warnings; the same two existing `react-hooks/set-state-in-effect` errors in `SalesReservationWorkflow.tsx` remain |
| Whitespace checks | Passed |

The browser tests inspect actual query filters from the first request, including all attempt IDs and document IDs passed to dependent reads. They verify historical reservation documents, financial figures, legal progression, direct URLs, cross-building defaults, canonical ordering, unit selection and browser Back, late success/error responses, 401/403 failures, explicit recovery, access revocation and scoped mutation reconciliation. Developer and admin tests confirm building-wide details and zero extra detailed reads when opening another file. The unchanged register suite verifies logout/role/organisation isolation, filters/pagination, both back paths and freshness/invalidation. Its delayed-refresh test rendered the retained register in 15 ms, and three immediate returns caused zero extra register reads.

The shared browser fixture now honours PostgREST `in` filters so the tests cannot silently return unrelated rows. The document replacement test now waits for saved version history rather than the filename also shown on a pending upload card. This corrects test synchronisation without changing upload behaviour or relaxing assertions.

## Remaining limits

The measured gains depend on payload size and transport. Authenticated live conveyancer latency was not measured; the user authorised controlled fixtures. JWT/RLS and server validation remain authoritative, while browser fixtures validate client behaviour rather than every deployed permission combination.

The existing attempts → documents → versions dependency chain still requires multiple round trips. Legal context loads after the complete detailed snapshot, with some overlapping metadata. A hard navigation also loads portal identity/access/building/unit metadata before Sales. These costs remain for later work; this change only removes unrelated detailed unit data. The existing loader's server row limits are also unchanged.

The feature branch targets `staging` for review. No merge, shared staging alias deployment, production change, migration, RLS change or region change is part of this work.
