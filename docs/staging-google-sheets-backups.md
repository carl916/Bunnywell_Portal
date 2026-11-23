# Google Sheets operational backups for Bunnywell Portal Staging

The `portal-sheets-backup` Supabase Edge Function exports one Sales sheet and one Defects sheet for each enabled building. The staging project ref is `vxkpvdtrldwwqiddoyof`. The migration creates the private `sheets_backup` schema with an empty building allowlist. The migration leaves scheduling off.

## Authorise Google and configure staging

1. In a Bunnywell-controlled Google Cloud project, enable **Google Drive API** and **Google Sheets API**. Create a dedicated staging service account without IAM project roles or domain-wide delegation. Create a JSON key for this account and transfer it directly into the staging Edge Function secret `SHEETS_BACKUP_GOOGLE_SERVICE_ACCOUNT`. Keep the key in Bunnywell’s secret manager for rotation. [Google service-account key instructions](https://cloud.google.com/iam/docs/keys-create-delete)
2. In Bunnywell Workspace, create a dedicated staging shared drive such as **Bunnywell Portal Backups — Staging**. In its settings, restrict access to drive members. Add the service account as **Contributor** and add only explicitly authorised users or restricted Bunnywell groups. Give people who can record notes **Contributor** access. Review group membership as well as direct members. Use separate drives for buildings with different authorised audiences. Copy the ID after `/folders/` in each drive’s root URL. The integration creates each building folder and both spreadsheets inside that drive. [Google shared-drive roles](https://support.google.com/a/users/answer/12380484)
3. From staging Supabase **Connect**, use the staging session pooler to connect as the staging database administrator with `psql`. Use the password prompt and verify the server certificate. Run `\password sheets_backup_runner` to set a new password for the export role, then `ALTER ROLE sheets_backup_runner LOGIN;`. Use the staging **transaction pooler** host from **Connect** to construct `SHEETS_BACKUP_DATABASE_URL` as `postgresql://sheets_backup_runner.vxkpvdtrldwwqiddoyof:<URL-encoded-scoped-role-password>@<staging-transaction-pooler-host>:6543/postgres`. The Edge Function requires certificate verification. A direct connection to `db.vxkpvdtrldwwqiddoyof.supabase.co:5432` with the unqualified runner name also works where IPv6 is available.
4. Generate a distinct random trigger secret with at least 32 characters, for example with `openssl rand -hex 32`. In **Edge Functions → Secrets** for **Bunnywell Portal Staging**, save `SHEETS_BACKUP_DATABASE_URL`, `SHEETS_BACKUP_TRIGGER_SECRET`, and the Google JSON secret from step 1. Set the secrets through the staging dashboard or authenticated management CLI. [Bunnywell Portal Staging secrets](https://supabase.com/dashboard/project/vxkpvdtrldwwqiddoyof/functions/secrets)
5. In staging SQL Editor, check the building ID and verify the intended dataset contains only authorised staging fixtures. Insert an allowlist entry with the approved drive ID. Enable one synthetic test building first.

```sql
select id, name, lifecycle_status from public.buildings order by name;

insert into sheets_backup.buildings (building_id, shared_drive_id, enabled)
values ('<staging-building-uuid>', '<staging-shared-drive-id>', true);
```

The service account signs its own OAuth assertions. `drive.file` authorises writes to files created by this integration. `drive.readonly` supports shared-drive membership and sharing checks. The service account should have access only to the approved staging backup drives. Bunnywell Workspace owns the resulting files. The integration creates zero sharing grants and stops exporting to drives that permit non-member access or destinations that report public or domain-wide permissions. If Workspace policy requires an exception to admit the service account, resolve the ownership and authentication model with the Workspace administrator before enabling exports.

## Manual run and validation

Set `SHEETS_BACKUP_TRIGGER_SECRET` in the invoking administrator’s environment using a password manager. A body of `{}` exports both kinds for all enabled buildings. Include `buildingId` and optionally `kind` (`sales` or `defects`) to limit a manual run.

```sh
curl --silent --show-error --fail-with-body \
  --request POST 'https://vxkpvdtrldwwqiddoyof.supabase.co/functions/v1/portal-sheets-backup' \
  --header "Authorization: Bearer ${SHEETS_BACKUP_TRIGGER_SECRET}" \
  --header 'Content-Type: application/json' \
  --data '{"buildingId":"<staging-building-uuid>"}'
```

The function returns `200` for complete success, `207` for a partial run, `409` when all requested exports are leased, and `502` when an attempted run fails to complete any export. The response contains the result for each building and type. Find the staging spreadsheet links and timestamps with this administrator query.

```sql
select b.name, e.kind, e.status, e.last_attempt_at, e.last_success_at, e.row_count, e.error,
  'https://docs.google.com/spreadsheets/d/' || e.spreadsheet_id || '/edit' as spreadsheet
from sheets_backup.exports e
left join public.buildings b on b.id = e.building_id
order by b.name, e.kind;
```

Use an ordinary authorised Drive editor for the live check. Confirm one tab per file, the building and type, and the Europe/London timestamp. Confirm they can enter multiple dated notes in a Working Notes cell and are blocked from editing all managed cells. Use **Data → Filter views** for individual sorting and filtering. During the live test, have a Drive manager sort whole rows including the hidden IDs while the worker is idle and run the export again. Confirm the notes stay with the correct sale or defect. Verify that someone outside the approved drive cannot open either file. Check a synthetic reservation, cancellation and replacement, exchange, completion and a defect status change through the normal staging workflows, then run the export again and compare the rows. Check a defect with an image while signed in with an authorised portal account. The Photos link needs the staging portal and its normal access checks.

## Start or stop the hourly job

After live Google and portal validation, repeat the initial manual sync for each additional authorised staging building. In the staging Supabase Vault, create a secret named `portal_sheets_backup_trigger` with the same value as `SHEETS_BACKUP_TRIGGER_SECRET`. The following SQL requires current success for both types of every enabled building. Run it only after the live validation above.

```sql
do $setup$
begin
  if not exists (select 1 from sheets_backup.buildings where enabled) or exists (
    select 1
    from sheets_backup.buildings b
    cross join (values ('sales'), ('defects')) k(kind)
    left join sheets_backup.exports e on e.building_id = b.building_id and e.kind = k.kind
    where b.enabled and (e.status is distinct from 'succeeded' or e.last_success_at is null)
  ) then
    raise exception 'Run and verify both live exports for each enabled staging building first';
  end if;
  if not exists (select 1 from vault.secrets where name = 'portal_sheets_backup_trigger') then
    raise exception 'Configure the staging Vault trigger secret first';
  end if;
  perform cron.schedule('bunnywell-sheets-backup-staging', '0 * * * *', $job$
    select net.http_post(
      url := 'https://vxkpvdtrldwwqiddoyof.supabase.co/functions/v1/portal-sheets-backup',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization',
        'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'portal_sheets_backup_trigger')),
      body := '{}'::jsonb,
      timeout_milliseconds := 120000
    );
  $job$);
end
$setup$;
```

After the next hour, confirm that the named job ran in **Integrations → Cron**, check the function logs for failed exports, and verify that every `last_success_at` and spreadsheet timestamp advanced. Cron history confirms dispatch. The export table and function logs show the outcome for each sheet. [Supabase scheduled Edge Functions](https://supabase.com/docs/guides/functions/schedule-functions)

To stop hourly runs, execute `select cron.unschedule('bunnywell-sheets-backup-staging');` in staging. To stop a building, set `enabled = false` in `sheets_backup.buildings`. Removing the Edge Function trigger secret disables all invocations. Leave the spreadsheet IDs in place when pausing the integration. An existing in-flight Google write may still complete.

## Reconciliation and recovery

- Sales are keyed by unit ID and active sale-attempt ID. An unsold unit with no buyer reservation has its own row identity. Defects are keyed by defect ID. A superseded sale or removed defect loses its exported details from the current grid. Its location label, ID and notes remain. A historical row with empty Working Notes is hidden. The worker never reuses an old row for another record.
- Transfer relevant Working Notes to the portal through normal workflows during manual reconciliation. Agree with the Workspace administrator how long to retain reconciled notes and how to handle deleted personal data in Google Drive revision history and any Vault retention. Clearing a current cell leaves earlier Google revisions subject to Workspace policy. The backup leaves manual notes in place until an authorised user clears them.
- Private evidence stays in the portal. The spreadsheet shows a durable link to the protected defect record when image evidence is recorded. During a full portal outage the tab still contains the defect and comments. The image files require portal access.
- If a comment cell exceeds 50,000 characters or the atomic batch exceeds 1.8 MB, that spreadsheet keeps the previous copy and records a failure. Check the record ID in the status and use the portal comment history to plan remediation. An ambiguous Sheets write holds its building lease for up to ten minutes to let Google finish before another invocation. The next scheduled run can recover without changing Working Notes.
- If Drive creation timed out, the next run searches for the existing file by private building and type markers. If no file appears and the status reports an unknown creation outcome, a Drive administrator should inspect the building folder and only clear `creation_requested_at` for that exact export after confirming that Drive never created the file. If a stored file is inaccessible, restore access to that file and rerun so its notes stay available.

## Fields and test commands

Sales uses `units`, its unit type and active `unit_sale_attempts` row, current `unit_sale_terms`, exchange deposit evidence and `sale_comments`. Its date columns cover the recorded reservation, exchange, notice, contractual completion deadline and completion. Defects uses `snags` where `source_type = 'developer_snag'`, the related unit or communal area, assigned organisation and trade, image presence, and `snag_events` comments with legacy `snag_comments`. Both types use a protected Portal Comments column and an editable Working Notes column.

```sh
node --test tests/google-sheets-backups.test.mjs
deno check --config supabase/functions/portal-sheets-backup/deno.json supabase/functions/portal-sheets-backup/index.ts
```
