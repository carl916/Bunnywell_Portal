# Exchange deposit receipt

Apply `supabase/migrations/20260922d_exchange_deposit_receipts.sql` before deploying the application changes. No production migration was run during this work.

The fourth Exchange task records receipt after legal exchange. It does not gate Exchanged status, Completion, handover, or agent-fee activity. Only an active conveyancer with building access can confirm or correct it; other authorised sale viewers can read it.

Amounts use the executed authority's frozen exchange schedule: explicit expected amount first, then fixed amount, then its saved percentage and contract price. For older authorities without an exchange schedule, the saved commercial percentage is used. The existing schedule models a gross exchange deposit, reservation-fee holder, and separate delayed deposit; it has no separate conveyancer-payable amount. No fees, contributions or reservation payments are deducted automatically.

The migration freezes existing executed authorities. Sales predating these use their retained, locked commercial version, labelled “Historical locked commercial terms”. A missing commercial amount is shown as unavailable and referred to Comments; no amount, receipt, receipt date or confirming actor is invented. Original sale dates and terms are unchanged.

Receipt rows have separate expected and received amounts, an immutable source reference, date, actor snapshot and timestamp. Confirmation fills both amounts from the source. Corrections require a reason and the latest receipt ID, append a revision and activity event, and retain the original. These revisions are corrections to one full receipt, not multiple payments.

Validation: 243 sales tests and 20 discussion tests pass; 18 Exchange/Completion browser tests pass (the old three-task assertion was updated and rerun). The database tests execute the migration in PGlite and cover historical backfill, immutable sources/history, permissions, invalid dates, amount tampering, retries and completion without receipt. TypeScript and focused ESLint pass. Full-project lint remains at its pre-existing 21 errors and 27 warnings.

Screenshots use synthetic local fixtures with no live emails or database writes:

- `outstanding-task.png`: historical sale, developer view.
- `confirmation-form.png`: conveyancer confirmation form.
- `confirmation-mobile.png`: mobile confirmation form.
- `completed-outcome.png`: recorded receipt and actual exchange date.
