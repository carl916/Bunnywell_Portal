# Phase 2D Frankfurt dashboard tail latency investigation

9 October 2026. **Recommendation B: retain US East temporarily and conduct a further focused test. Do not activate Frankfurt on shared staging yet.**

## Executive findings

The individual calls behind both original dashboard stalls have been identified by matching the archived Vercel request times, reader dependencies and Supabase gateway logs. The 22.8-second interaction waited on `rental_import_runs`; the 46.7-second request waited on `sale_workflow_context`. The dominant delay was outside the gateway's measured upstream-service processing interval. A further 32.6-second Supabase Auth request during Phase 2D shows that the problem can affect a service other than dashboard/PostgREST reads.

This localises the problem to the hosted HTTP delivery path much more strongly than the previous aggregated `db_read` timing. **The precise transport/proxy fault is not established.** There is no evidence-supported application or database correction to apply yet. No permanent fix, timeout increase, retry, cache, access-check removal or deployment arrangement was introduced.

Thirty clean paired dashboard requests per region confirmed substantial typical Frankfurt improvements, with no measured dashboard request over five seconds. That clean sample does not resolve the original stalls or the separate new Auth stall. The next step is provider correlation of the retained request IDs, followed by a bounded matched test of the specific mechanism identified.

## Environment and controls

Shared staging is commit `805a08e6ff1543f5c5753afbe20527350c7b4db6`, deployment `dpl_GofFrmu6EsMaLuXfaRs52a3QGRRE`, in `iad1`. It includes the preservation PR; its application baseline is unchanged from the completed trial. [Environment evidence](phase2d-dashboard-tail/environment.json).

| Variant | Diagnostic Preview | Commit | Execution region |
| --- | --- | --- | --- |
| A | [US East](https://bunnywell-portal-6anexmdtv-carl-gilbert-s-projects.vercel.app) | `0e2061d` | `iad1` |
| B | [Frankfurt](https://bunnywell-portal-itw7tq7zq-carl-gilbert-s-projects.vercel.app) | `2e38145` | `fra1` |

Both descend from diagnostic commit `c3ba5a7`, use the same staging Supabase project, dependency lockfile and application tree, and differ only in the isolated `vercel.json` region. All original cron entries are retained. Neither experimental branch is suitable for merging. Only their branch-specific Preview diagnostic flags were added; shared staging and production aliases/settings were not changed. [Final alias identities](phase2d-dashboard-tail/final-aliases.json).

The project uses Node.js 24. No function runtime/resource setting was changed. The available connector did not expose historical CPU/memory or connection-establishment telemetry, so those are not inferred from the application timers.

The probe uses the existing admin and conveyancer test accounts, caller JWT/RLS, safe fixture selection and before/after protected-data hashes. It performs no legal transactions, document uploads or email sends. Authentication creates normal test sessions, which are signed out locally afterwards.

## Original slow requests

The following offsets use each Vercel request's timestamp as zero and Supabase's logged timestamp for each upstream event. They are a cross-system reconstruction, not an original per-fetch trace. The second window contains 28 gateway records for 29 expected calls; its sales-read record is missing. The matching slow calls, surrounding dependency groups and final revalidation are nevertheless visible. [Full chronological gateway evidence](phase2d-dashboard-tail/historical-upstream.json).

| Stage/read | Region | Relative timing | Evidence | Finding |
| --- | --- | --- | --- | --- |
| First request: auth, initial profile/access, dimensions | `fra1` | Logged starts +41 to +251 ms | Vercel `m9pxn-1791548818274-e91f3afac8ec` | Initial validation and dimension reads finish normally |
| First request: module reads | `fra1` | First group starts +326 to +334 ms; related reads from +450 ms | Other related calls take 27–683 ms at origin | Independent reads continue; no general 20-second freeze |
| **Rental import status** | `fra1` | Start +589 ms; origin duration **21,708 ms**; expected end +22,297 ms | Supabase `01a120a1-85af-7077-b80b-a5217be9b013`; ray `a47d6074fe52d28c` | Envoy upstream service **3 ms**, one attempt; blocks `rent_risk` and the final source barrier |
| First request: final profile/access | `fra1` | Starts +22,339 to +22,427 ms | Final access reads take 20–34 ms | Revalidation waits for the slow source; route ends at 22,493 ms; browser ready at 22,790 ms |
| Second request: auth/access/dimensions/modules | `fra1` | Starts +61 to +683 ms | Vercel `qzckf-1791550377451-d895c2bb3cfe` | Other recorded related reads take 59–260 ms |
| **Workflow context RPC** | `fra1` | Logged start +4,532 ms; origin duration **41,874 ms**; expected end +46,406 ms | Supabase `01a120b9-5f9f-7178-9928-83cf1a7ac6bb`; ray `a47d8687089fd28c` | Envoy upstream service **684 ms**, one attempt; blocks history and the final source barrier |
| Second request: final profile/access | `fra1` | Starts +46,446 to +46,551 ms | Final access reads take 43–74 ms | Route ends at 46,650 ms; client finishes at 46,743 ms |

The original `SalesServerTiming.fetch` measures resolution of `fetch`, before the SDK consumes its response body. Its long `db_read` span therefore localises the original dominant wait to the fetch/headers boundary, rather than subsequent dashboard derivation or browser rendering. The second RPC's late logged start leaves approximately four seconds before the logged origin interval unexplained; it must not be silently counted as PostgreSQL execution.

`x-envoy-upstream-service-time` includes upstream processing and the network between Envoy and its upstream; it is **not pure PostgreSQL execution time**. The much larger origin interval points outside that measured segment. [Envoy header definition](https://www.envoyproxy.io/docs/envoy/latest/configuration/http/http_filters/router_filter.html#x-envoy-upstream-service-time).

## Root-cause assessment

| Assessment | Finding and limits |
| --- | --- |
| **Confirmed** | Different upstream operations block dashboard completion: rental import status and workflow context. Their gateway origin intervals account for almost all the corresponding tail delay. HTTP 200 and complete data do not make these waits acceptable. |
| **Strongly supported** | Intermittent delay in the hosted Supabase HTTP delivery path outside the measured Envoy upstream-service segment. The problem spans REST, RPC and Auth, which argues against one dashboard SQL query or one data source being the common cause. |
| **Strongly supported regional association** | In the historical 11:00–14:00 UTC REST log window, FRA ingress had 5 of 6,080 requests over 5 seconds and 2 over 20 seconds; IAD had 0 of 6,042 over 5 seconds. These are unmatched upstream requests, and Cloudflare ingress location is not itself the Vercel execution region. This supports investigation of the FRA delivery path, not proof that geographic placement causes it. [Counts](phase2d-dashboard-tail/historical-colo-summary.json). |
| **Ruled out as the dominant explanation for the original stalls** | Twenty-to-forty-second PostgreSQL execution, response assembly, browser rendering, and pre-route cold-start scheduling do not fit the gateway and route timings. The application has no added retry; the original 28 database fetches match the normal single-building call count. Both slow gateway records report one upstream attempt. |
| **Possible, unverified** | Connection establishment/reuse, packet retransmission, queueing or buffering between edge and gateway, or another provider delivery fault. No socket-level DNS/TCP/TLS timings, packet trace or provider-internal queue spans are available. Single-attempt HTTP metadata does not exclude TCP retransmission or lower-level connection recovery. |
| **Not supported by current observations** | Persistent database overload, lock contention, an event-loop stall or excessive concurrent dashboard requests. Point-in-time database snapshots cannot rule out historical transient pressure. |

PostgreSQL statistics had not been reset since 20 June. Relevant retained statement maxima before and after the test were **32.38 ms** for rental-import reads and **1,052.29 ms** for workflow context. There were no blocked sessions in the final snapshot; 17 database connections were observed against a configured maximum of 60, with only the inspection query active. These are statement aggregates and snapshots, not a per-request database trace. No index, policy, schema, logging level or database setting was changed. Query-plan tuning is not justified as a cure for the observed 20–40-second delivery gap. [Before](phase2d-dashboard-tail/database-before.json), [after](phase2d-dashboard-tail/database-after.json), [statistics semantics](https://supabase.com/docs/guides/database/extensions/pg_stat_statements).

PostgREST emitted `Thread killed by timeout manager` messages, but these are not evidence of a query timeout: the upstream project's [known false-error logging issue](https://github.com/PostgREST/postgrest/issues/4799) explains why that message alone cannot establish causation. Historical Vercel runtime logs were unavailable because the project retained only one hour; the recent diagnostic deployment returned no application log records. Neither result establishes an absence of platform incidents.

### Additional Phase 2D Auth stall

At 16:14:22.937 UTC, Supabase logged `/auth/v1/user` with **32,593 ms origin time**, **4 ms upstream service time**, HTTP 200 and one attempt: request `01a12171-b6d9-717b-b160-2dc858a3dfd4`. This aligns with the long completion of batch 2's access-denial checks. The rejected application response intentionally did not expose a detailed trace, so attribution to the specific check is temporal rather than a trace-ID join. [Evidence](phase2d-dashboard-tail/additional-auth-stall.json).

This is outside the 60 successful dashboard benchmark responses. It shows why their clean result is not a reliability clearance. The probe now times security checks too and stops after a slow check, rather than only watching successful measured requests.

## Controlled regional comparison

Three clean batches contain **30 paired dashboard requests per region**: 15 All buildings and 15 single-building requests. Region order alternates; timed requests are sequential. A supplementary register batch contains eight requests per region, four of each scope. All 76 responses have verified execution regions and matching normalised content hashes. All permitted dashboard sources are complete; register actions remain available. Sixteen anonymous/invalid-scope checks returned the expected 401/403. Protected-data hashes remained unchanged.

API time includes client transport and body transfer. Server time starts inside the route and includes upstream reads and response assembly, but excludes pre-handler platform time. Values below are seconds; no rare-tail percentile is claimed.

| Endpoint and scope | n per region | A API p50 / p75 / max | B API p50 / p75 / max | A server p50 / p75 | B server p50 / p75 | Over 5 / 10 / 20 seconds, A and B |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Dashboard, All buildings | 15 | 3.306 / 3.638 / 4.221 | 1.662 / 1.724 / 2.484 | 3.016 / 3.296 | 1.481 / 1.529 | 0 / 0 / 0 each |
| Dashboard, single building | 15 | 3.193 / 3.394 / 3.904 | 1.429 / 1.490 / 1.736 | 2.945 / 3.053 | 1.311 / 1.386 | 0 / 0 / 0 each |
| Register, All buildings | 4 | 1.998 / 2.076 / 2.248 | 1.117 / 1.526 / 2.420 | 1.747 / 1.836 | 0.973 / 1.050 | 0 / 0 / 0 each |
| Register, single building | 4 | 2.001 / 2.013 / 2.018 | 0.976 / 1.140 / 1.182 | 1.752 / 1.804 | 0.919 / 1.071 | 0 / 0 / 0 each |

Dashboard median API improvements are approximately 50% for All buildings and 55% for one building. Register results are supplementary and too small to characterise rare failures. Its first Frankfurt request spent substantially more time outside the measured route than later requests; this is not proof of a cold start.

| Dashboard individual read | A fetch p50 / max ms | B fetch p50 / max ms | A / B upstream service p50 ms |
| --- | ---: | ---: | ---: |
| Auth validation | 142 / 377 | 48 / 163 | 3 / 3 |
| Initial profile | 121 / 333 | 40 / 87 | 2 / 2 |
| Workflow context | 919 / 1,036 | 747 / 1,001 | 663 / 682 |
| Rental import status | 171 / 391 | 90 / 180 | 14 / 22 |
| Final unit-access check | 127 / 357 | 32 / 73 | 2 / 2 |

The 2,042 retained upstream spans show no SDK retries or fetch/body errors. The largest observed event-loop timer delay was 20.65 ms, and body consumption peaked at 143.76 ms. At most 11 upstream reads overlapped within a dashboard response. The diagnostic counter observed one opted-in request per instance at entry; it is not a platform-wide concurrency measurement. The shared register reader made 17 calls per response and showed no severe stall in this batch. Shared auth/access/HTTP dependencies mean it cannot be assumed immune to the delivery problem.

Raw [measurements](phase2d-dashboard-tail/measurements.json) and [per-read distributions](phase2d-dashboard-tail/summary.json) retain request IDs, safe operation labels, stages, relative start/header/body/end offsets, available row counts, pages/batches, retry counts and gateway timing headers. DNS/TCP/TLS details are unavailable. Text-body timing includes consumption/decoding; subsequent JSON parsing and business derivation are contained in the gaps between recorded stages, not separately attributed CPU spans.

Excluded setup work: automatically created builds preceding the diagnostic flags; a two-request US East pilot before Frankfurt was ready; an initial register probe rejected by its own wrong completeness-field assertion; and one full dashboard batch that overlapped the preceding batch's trailing integrity/security checks. The overlapping batch was replaced, not selectively trimmed for its latency values. Its responses were all under five seconds.

## Dashboard orchestration

The read order is auth → profile → initial access snapshot → buildings → four parallel dimensions → five parallel module sources → up to eleven related reads → final profile/access snapshot → derivation. Related-ID batches are sequential in groups of 150, with 250-row pagination and complete-count checks. Current measured datasets needed one page and one related-ID batch for each operation; pagination did not generate these tails.

The entire worklist waits at each source-group barrier. Rental import freshness is unrelated to most Sales tasks, but a slow rental read prevents those tasks from being returned. Workflow history also gates the response. Those are real amplification mechanisms, not proof that the parallel burst causes the network fault. Moving dependencies or capping concurrency would be a separate measured experiment, not a justified permanent fix at this point.

The queried sources support summaries, ownership, deadlines, financial gates, recent activity and freshness/completeness states. Client-side module filters do not reduce server work. Buildings, organisations and permission relationships include all RLS-visible records where needed for scope and ownership; source rows are then scoped to accessible building IDs or bounded related IDs. The global pending-access read is filtered by the model's accessible unit/building context. The two permission snapshots are required revocation checks, not removable duplicate reads.

The workflow RPC is the normal longest service operation and returned about 347 KB in the All-buildings example. That is an independent future optimisation candidate, but normal sub-second processing and a 684 ms service interval during the original stall do not explain its 41.9-second origin wait. No business calculation or shared reader was removed.

The worklist polls every 60 seconds, skips hidden documents and already-active requests, and gates focus refresh by age. The UI aborts at 30 seconds; a 46.7-second direct API success would not be a successful ordinary UI load. The known visibility-listener failure is in the conveyancer UI fixture; the focused API probes have no browser listeners, so it cannot explain their stalls. The Audit Log assertion concerns a different component and cannot affect this read path.

## Diagnostic changes and verification

Only temporary instrumentation was implemented: [read-diagnostics.ts](../src/lib/dashboard/read-diagnostics.ts), the [dashboard route](../src/app/api/dashboard/route.ts), and the [register route](../src/app/api/sales/register/route.ts). The data reader, model, permissions and business workflows remain unchanged. There is no before/after latency claim for a corrective fix because no corrective fix was made.

Detailed traces require both diagnostic flags, `VERCEL_ENV=preview`, the exact staging backend, an explicit probe header, an authorised admin/conveyancer profile and a successful response. They are bounded, compressed metadata in a private response header. No ordinary-use log stream, sensitive URLs, credentials, response bodies or error messages are retained. Production and non-opted-in requests cannot emit the trace. [Guard and response-consumption tests](../tests/dashboard-read-diagnostics.test.mjs).

Validation: TypeScript and targeted ESLint passed; 50 focused unit tests passed; 31 of 32 additional regression tests passed, with the existing Audit Log building-context assertion still failing. Synthetic dashboard/conveyancer browser tests passed 32 of 33, with the existing visibility count **13 versus 10** still failing. Neither was changed or reported as passing. [Test evidence](phase2d-dashboard-tail/validation.txt).

Four additional role/scope comparisons verified that the unchanged trial baseline, the diagnostic build without opt-in, and the retained traced responses have identical normalised response hashes. Ordinary requests contain no detailed trace header. [Equivalence and integrity evidence](phase2d-dashboard-tail/equivalence.json). Shared staging and production retain their original aliases.

## Next decision and remaining risks

**B is the supported recommendation.** Keep the current US East arrangement temporarily. Frankfurt's typical gains remain attractive, and this evidence does not justify abandoning the whole-application option in favour of permanent targeted overrides. It also does not justify activation while a shared Auth read can still stall for more than 30 seconds.

1. Give Supabase the three request IDs above, UTC windows, CF rays for the original requests, origin/service gaps and paired deployment identities. Request correlation of edge-to-gateway queue/connect/response-header timings and connection recovery. The packet is prepared here; no support message has been sent.
2. Obtain provider-level confirmation of the delayed segment and compare the FRA and IAD paths. Historical Vercel logs cannot be recovered from the current retention window; capture any new platform request telemetry promptly alongside these traces.
3. If a specific connection/reuse or gateway mechanism is identified, run a staging-only, matched experiment that changes only that mechanism. Any connection-strategy, infrastructure, schema or broad orchestration change needs approval before implementation.
4. Repeat at least 30 pairs across multiple separated batches after the correction, including auth/access checks and the register; compare full response hashes, source completeness and revocation behaviour. A clean batch alone is insufficient: demonstrate why the identified failure mechanism is removed or bounded.

Remaining limits are the missing socket/provider spans, incomplete historical log coverage, small rare-event sample, point-in-time database pressure checks, and no direct measurement of original event-loop/body timings. The two original slow operations are identified; **the exact cause of their delivery delays remains unresolved**. Leave activation and any permanent infrastructure change for a separate review.

## Reuse

Run the [paired probe](../scripts/diagnostics/dashboard-tail-probe.mjs) only against revalidated authorised staging Previews, with `FULL_REGION_TARGETS`, `PHASE2D_OUTPUT` under ignored `test-results/`, and optional mode/round settings. Supply the existing credentials through ignored local configuration, including `REGISTER_PERF_EMAIL`; never commit them. Wait for a batch's final integrity result before starting another. A stop marker requires investigation before explicit resume.

Rebuild summaries offline with `node scripts/diagnostics/summarize-dashboard-tail.mjs docs/phase2d-dashboard-tail/measurements.json test-results/phase2d-summary.json`. The regenerated output was checked against the committed summary. Evidence contains only sanitised timing/count/hash metadata and public deployment identities.
