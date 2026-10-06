# Trinity Point rental transfer

User scope: copy staging rental data, including unit sales status, portfolio membership, tenancies and arrears, to production for 18 Trinity Point units only.

## Production transfer present — verified 6 September, 08:23 UTC

The user supplied a new production preflight export captured at `2026-09-06T08:23:31.222299+00:00`. Comparison with the private transfer manifest confirms:

- All 18 original production unit IDs (69-86) now have `not_for_sale` / `active` status, with the correct building mapping.
- All 29 expected destination tenancy IDs are present. Every returned tenancy field matches the manifest, including building/unit links, source references and start/end dates.
- 13 arrears episodes and 32 arrears events are present in the target scope.
- The expected import-history ID is present with succeeded status.
- The expected new RMJ organisation ID is present as a letting agent.
- No sale attempts were introduced for the target units.

**Do not rerun either import file.** The supplied result is the scope preflight output, not the dedicated transfer verification output: it does not expose the transfer-audit marker, rental amounts or full event contents, so those were not independently compared after execution. The prepared single-statement import includes full inserted-content and non-target-unit checks before it can complete. The dedicated read-only verification remains available if the audit marker needs to be checked. No additional production write is required by the observed results.

## Prepared transfer — awaiting production execution

### SQL Editor error correction

The user reported `42P01: relation "trinity_expected_units" does not exist`. The error means the original temporary table was unavailable to a later statement; the supplied error alone does not establish whether the editor split execution, only a selected fragment was run, or some other transaction/session boundary intervened. It does not establish that RLS should be disabled or that no earlier statement committed.

Use **`trinity-point-production-import-single-statement.sql`** in the private output directory instead of the original import file. This replacement is one atomic `DO` statement, uses local JSON variables instead of temporary tables, and retains the exact original transfer ID and all five data-insert payloads. It checks for an existing transfer, changed unit state, existing tenancies/sales/import runs and RMJ before writing. A conflicting or partially applied state causes it to stop; do not remove those guards. The existing read-only verification file still uses the correct IDs.

The generator now emits the single-statement format for future preparations. This specific replacement was converted from the original artifact without generating new IDs. Byte comparisons confirmed all five data inserts are unchanged, no temporary-table references remain, and state/non-target guards are retained. Syntax/lint checks passed for the JavaScript conversion code; the replacement has not been executed against PostgreSQL here. Production completion remains unconfirmed.

Production preflight captured at `2026-09-06 08:14:59 UTC` confirms all 18 units exist under building `790f1a96-fa42-4afb-af36-f31f4660eac3`, with `for_sale` / `not_in_portfolio` status and no reservation/completion/handover dates. There are no existing tenancy, arrears, import-history or sale-attempt records in the inspected scope. RMJ is absent. The source creator maps by email to the existing active production admin.

Prepared private files in `C:/Users/carlg/AppData/Local/Temp/bunnywell-trinity-transfer-20260906/`:

- `trinity-point-production-import.sql`: one guarded transaction; creates RMJ, changes the 18 allocations and inserts the mapped rental records and one production transfer audit.
- `trinity-point-production-verify.sql`: read-only counts and transfer-audit verification for use after execution or an ambiguous SQL Editor response.
- `transfer-manifest.private.json`: private source-to-destination ID mappings and expected destination records.

Transfer ID: `8d4ac914-a4a6-4916-b44c-ba3e4b3c4f80`.
Source snapshot: `2026-09-06T08:12:22.412Z`.
Source file SHA-256: `028e1e0fb0bc433c8e7cf2e810de711a1f8f2685be4534108752be2e216ab9ad`.

The offline generator is `scripts/prepare-trinity-point-transfer.mjs`. It requires explicit source, preflight and output-directory arguments and rejects outputs inside the repository. Generated files are private data artifacts, not schema migrations. Do not regenerate and run a second import after success: new data IDs would differ and the state guards should reject it. Preserve these files until verification is complete.

Checks completed: JavaScript syntax and ESLint; all non-ID tenancy/arrears/event/import fields preserved; mapped foreign-key relationships valid; seven invalid/conflicting input cases rejected before generating output. The generated SQL has not been executed or rehearsed against PostgreSQL here. Production identity/state guards and row locks are rechecked at execution, and the transaction compares complete inserted record content after PostgreSQL type conversion before committing. A pre/post snapshot comparison rejects changes to non-target units or unrelated target-unit fields. No triggers or RLS are disabled, and no rows are deleted or overwritten outside the 18 allocation updates.

Execution: confirm a recoverable production backup, run the entire private import file together in the production SQL Editor, then return its result. Expected report: 18 units with expected statuses, 29 tenancies, 13 arrears episodes, 32 arrears events, 1 import run, and both audit/letting-agent flags true. Stop on any error. If the response is ambiguous, use the separate read-only verification file before considering any rerun. The other 68 Trinity Point units and all other buildings remain outside the transfer.

## Source inspected

Staging project: `vxkpvdtrldwwqiddoyof.supabase.co`.
Building: Trinity Point, New Road, DA11 0FD.

The building contains 86 units. Exactly 18 have tenancy records or rental portfolio participation: units **69-86**. All 18 are `sale_status = not_for_sale` and `rental_portfolio_status = active`. There are no sale attempts for these units in the staging export.

Related source records:

- 29 tenancies, including historical and current occupancies.
- 13 arrears episodes, preserving attribution and review state.
- 32 append-only arrears events.
- 1 rental import-history record, including its 3 recorded data-quality issues.
- RMJ is the letting agent referenced by the tenancies.
- One existing admin profile is referenced by creation/update fields.

The private snapshot is saved outside the repository in the user's temporary directory as `bunnywell-trinity-staging-transfer.json`. It contains tenant data and must not be committed. Existing contractor/developer building associations were inspected as dependencies, but are outside the requested rental transfer and should not be overwritten.

## Production mapping required

Run `scripts/database/trinity-point-transfer-preflight.sql` in production. Production credentials are not available in the configured local environment; the established SQL Editor flow is required to inspect and apply destination changes.

Map the building by name/address/postcode, units by building and unit number, RMJ by name/type, and the actor profile by email. Never assume staging and production IDs are interchangeable. Inspect existing destination tenancies, arrears, import history and sale attempts before selecting an insertion or reconciliation strategy. Any conflicting or substantive sale workflow must be resolved explicitly before changing its unit's sales position.

## Intended transfer

Prepare one transaction limited to the mapped 18 units. Change only their sales and rental portfolio statuses, preserve rental record relationships and source provenance, and create a production audit record for the transfer. Keep tenancy names, dates, amounts, notes, agent references, arrears amounts/statuses/events and import-health information intact. Preserve existing production building/unit identities and unrelated fields. Reuse an unambiguous RMJ organisation or create only the required letting-agent dependency if absent; do not copy user accounts.

The application represents portfolio membership on `units.rental_portfolio_status`; there is no separate portfolio-entry table in the inspected schema. Do not copy staging sales files, test accounts, unrelated audit history, other buildings, or the other 68 Trinity Point units. For a rerun, compare imported records and stop on differences rather than silently overwriting append-only history or skipping conflicts.

After writing, verify the 18 mapped unit statuses, tenancy/episode/event/import counts and relationships, source-content equivalence after ID remapping, and unchanged statuses for non-target units. No production write has been performed by this task.
