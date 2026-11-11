# Measured index and permission-query experiments

These candidate SQL files are retained as evidence, not included in the baseline or staging security package. Three warm PostgreSQL plans per role were measured on the larger synthetic dataset. No consistent improvement in the building-facts read was established. The four candidate indexes were removed and the three SELECT policies restored; `restore.sql` records the exact reversal.

The fixture has substantial units, sales, documents and snags, but limited photo/event history. The results do not establish that a photo or history index is never useful. Benchmark a representative history population before proposing those indexes later. Do not apply advisor output wholesale.

`benchmark-plans.mjs` is an explicit local experiment and restores its changes at the end. Results are in `artifacts/backend-foundation/query-plans.json`. Caller JWT claims with `SET LOCAL ROLE authenticated` were used for EXPLAIN; genuine Auth-session HTTP tests are separate.
