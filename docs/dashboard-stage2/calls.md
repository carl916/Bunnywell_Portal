# Baseline call inventory

Real staging data, local Node handler, admin/all buildings, ten samples. Times are median milliseconds relative to handler entry; independently computed medians do not form an additive timeline. RTT ends after SDK body consumption. Upstream is the service header, not a PostgreSQL execution plan. Exactly 27 database requests plus one authentication request. No pagination, extra ID batches or retries occurred in these samples.

| Stage | Operation | Calls | Start | Finish | RTT | Upstream | Body | Bytes |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| auth.validate | auth.validate | 1 | 0.27 | 65.36 | 64.97 | 2.5 | 0.31 | — |
| profile.initial | profiles | 1 | 65.47 | 125.42 | 62.86 | 3 | 0.1 | 97 |
| access.initial | user_unit_access | 1 | 125.6 | 222.03 | 84.14 | 2.5 | 0.06 | 2 |
| access.initial | user_building_access | 1 | 125.79 | 189.87 | 64.09 | 2 | 0.09 | 2 |
| access.initial | building_organisations | 1 | 125.85 | 197.41 | 71.55 | 4 | 0.31 | 1061 |
| data | buildings | 1 | 222.21 | 286.92 | 79.13 | 7 | 0.28 | 848 |
| data | units | 1 | 287.12 | 404.76 | 118.48 | 59 | 0.36 | 38012 |
| data | building_floors | 1 | 287.23 | 367.73 | 81.82 | 12.5 | 0.25 | 1737 |
| data | organisations | 1 | 287.26 | 367.94 | 81.96 | 13.5 | 0.28 | 507 |
| data | building_organisations | 1 | 287.28 | 359.31 | 74.7 | 6 | 0.27 | 1061 |
| data | unit_sale_attempts | 1 | 405.07 | 534.89 | 137.02 | 58.5 | 0.51 | 57982 |
| data | snags | 1 | 405.16 | 593.75 | 189.83 | 95 | 0.41 | 30557 |
| data | handovers | 1 | 405.21 | 520.76 | 116.3 | 28.5 | 0.25 | 5780 |
| data | unit_tenancies | 1 | 405.24 | 507.76 | 91.24 | 12 | 0.29 | 8418 |
| data | resident_access_requests | 1 | 405.26 | 531.56 | 119.19 | 4 | 0.08 | 2 |
| data | unit_sale_documents | 1 | 594.21 | 920.74 | 342.93 | 256 | 1.01 | 45476 |
| data | sale_legal_emails | 1 | 594.37 | 836.45 | 237.05 | 134.5 | 0.51 | 24595 |
| data | sale_exchange_deposit_receipts | 1 | 594.42 | 702.32 | 89.44 | 14.5 | 0.28 | 420 |
| data | sale_exchange_deposit_sources | 1 | 594.47 | 785.07 | 178.11 | 87 | 0.24 | 5547 |
| data | sale_workflow_context | 1 | 594.56 | 1379.56 | 793.67 | 616.5 | 20.29 | 327800 |
| data | sale_actor_names | 1 | 594.69 | 965.39 | 383.35 | 283 | 0.32 | 240 |
| data | get_agent_fee_portfolio | 1 | 594.75 | 787.06 | 186.6 | 88 | 0.54 | 36546 |
| data | rental_arrears_episodes | 1 | 594.8 | 721.01 | 139.5 | 50.5 | 0.31 | 7707 |
| data | rental_import_runs | 1 | 594.84 | 746.76 | 150.79 | 17.5 | 0.22 | 302 |
| profile.final | profiles | 1 | 1380.22 | 1434.86 | 58.66 | 3 | 0.11 | 97 |
| access.final | user_unit_access | 1 | 1435.04 | 1500.83 | 87.67 | 2 | 0.07 | 2 |
| access.final | user_building_access | 1 | 1435.17 | 1490.37 | 62.04 | 2 | 0.09 | 2 |
| access.final | building_organisations | 1 | 1435.22 | 1498.65 | 72.67 | 4 | 0.26 | 1061 |

The 27 database calls comprise profiles ×2, user_unit_access ×2, user_building_access ×2, building_organisations ×3, and 18 other sources ×1. The single-building fixture has no tenancies, so skips rental_arrears_episodes: 26 database calls plus authentication. Other datasets can need additional 250-row pages or 150-ID batches; those remain sequential within each source and bounded at 20,000 rows.

In the pre-edit local capture the fee RPC appears as `other`, because the existing diagnostic allowlist omitted its name. The only instrumentation change adds `get_agent_fee_portfolio`; all guards are retained. The paired baseline uses that improved observer with the original reader.
