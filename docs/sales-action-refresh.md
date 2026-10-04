# Legal action refresh scopes

Baseline: deployed staging commit `b883040b9bfc7b66084d1c4af73c13a179af578b`, 4 October 2026. Previously `SalesLegalWorkflow.run` awaited POST, legal-context GET, building-wide `loadSalesData`, then portal `loadAll`. The latter reads profile/access/setup, snags, handovers, meters and audit data whether or not the legal action changed them. This produced roughly 37–44 requests for the requested actions.

The mutation is still authoritative. Afterwards legal context, affected Sales rows and changed portal data refresh concurrently. Both rejected mutations and successful mutations reconcile: RPC transactions or an accepted email can precede a lost response. Refresh failures do not report action success. An original delivery/finalisation error remains visible; selected upload files and the idempotency request are retained for recovery.

| Action | Sales reads | Shared portal reads |
|---|---|---|
| Request or issue/retry/revoke authority | Affected attempt; actor names for that sale | None |
| Record exchange | Affected attempt; actor names | Affected unit |
| Finalise completion upload | Affected attempt; actor names; that sale's documents with versions | None |
| Approve/query documents | Affected attempt; actor names; that sale's documents with versions | None |
| Record completion | Affected attempt; actor names | Affected unit; global audit page/count if an active rental exits |
| Notice upload/replacement | Affected attempt; actor names; documents with versions | None |
| Deposit confirmation/date correction | Affected attempt; actor names; sale's deposit receipt presence | None |

Every row above also performs one fresh legal-context GET, preserving email delivery history, authority snapshots, deposit details, approval identity, current package/version validation and dates. Actor names merge by identity rather than dropping another sale's actors. Documents replace only the affected sale; their versions replace only the corresponding document IDs. Related Sales reads publish together when they all succeed. Full-load revisions prevent an earlier building load overwriting a later action refresh, and results for an old building are discarded.

Unit replacement updates existing derived building counts, Sales financial/status summaries, unit allocation and handover availability. Legal completion's rental exit is carried in the same unit row. Terms, schedules, invoices and payments are not mutated by these legal RPCs, so their existing figures are retained. Sale activity is invalidated immediately for the affected sale, including a closed activity panel; its existing polling and visibility refresh remain.

Direct upload remains prepare → resumable Storage transfer → finalisation. Preparation/transfer create no visible document version and trigger no success refresh. Finalisation verifies bytes and transactionally registers versions/invalidates approval. Refresh starts after its response, or reconciles on uncertainty, and is measured separately from transfer.

No requested action needs a building-wide Sales reload. Broad loads remain necessary for initial entry, building changes, reservation/commercial/setup operations outside this change, and explicit portal Refresh to discover other users' changes. Portal Refresh now explicitly invalidates both Sales and the current legal context. Existing remount/navigation refreshes, activity polling and visibility listeners remain. The global audit page/count after rental exit is a bounded global ledger read, not a building-wide Sales or portal reload.

Validation and staging measurements are recorded in the accompanying action-refresh report and raw evidence.
