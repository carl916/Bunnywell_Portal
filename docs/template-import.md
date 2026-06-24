# Cleanup Template Import

Use this after validating `docs/bunnywell-database-cleanup-template-v2.xlsx` and clearing the target database.

## Dev / Staging

Dev and staging can create or update users from the `Users Access` tab.

```powershell
npm.cmd install
npm.cmd run import:template
```

The importer reads `.env.local`:

```text
NEXT_PUBLIC_SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
PLAYWRIGHT_ADMIN_EMAIL
PLAYWRIGHT_ADMIN_PASSWORD
PLAYWRIGHT_CONTRACTOR_EMAIL
PLAYWRIGHT_CONTRACTOR_PASSWORD
PLAYWRIGHT_RESIDENT_EMAIL
PLAYWRIGHT_RESIDENT_PASSWORD
```

For users in `Users Access` that do not match one of the Playwright email variables, the script will generate a password and print it at the end. To set one default password for all newly-created non-Playwright users, add:

```text
IMPORT_DEFAULT_USER_PASSWORD=
```

## Production

Production import skips all user changes.

```powershell
npm.cmd install
npm.cmd run import:template:prod
```

Production still imports buildings, building floors, unit types, unit room rules, units, generated unit rooms, communal areas, organisations, and building-organisation links.

## Notes

- Units marked `handed_over` are inserted as `completed`, then a basic handover record is created so the database trigger moves the unit to `handed_over` correctly.
- Building floors are derived from the `floor` values in the `Units` and `Communal Areas` tabs.
- The importer expects the target database to have already been cleared or to contain only records you are happy for it to update by name/reference.
- Run dev first, then staging, then production.
