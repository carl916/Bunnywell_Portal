# Bunnywell Portal System Guide

Version: 2026-06-28

## 1. System Overview

The Bunnywell portal is a developer handover and initial defects reporting portal. It supports internal/pre-PC snag capture, flat handover records, resident access setup, flat-specific records, meter readings, resident routine snag capture during the initial reporting period, contractor follow-up and historical reporting.

The portal is not intended to be a permanent resident portal, maintenance request system, managing agent platform, lettings management tool or long-term building communications system.

Handover and resident snag reporting are separate workflows. Handover relates to a specific flat/unit handover record. Building lifecycle before Practical Completion is called `pre_pc`, not handover.

## 2. User Roles And Access Model

Admin users manage buildings, users, access requests, organisations, handover records, snags, reports and audit history. Admins have access to all buildings by default.

Developer users also have access to all buildings by default and can work across the developer-side workflow.

Developer Representative users are assigned at building level. They are used for employer's agent, project manager or similar project-side representatives.

Contractor users are assigned at building level and work with assigned snags and contractor follow-up actions.

Resident users are assigned to one or more specific flats. A resident is usually linked to one flat, but leaseholders, letting agents or managing agents may be linked to multiple flats across buildings.

Resident type values are Leaseholder, Tenant, Letting Agent and Managing Agent. Resident type is admin context only and does not currently change permissions.

## 2.1 Navigation And Screen Permissions

The portal uses workflow navigation rather than old flat tabs.

Admin and Developer users see Dashboard, Snags, Units and Setup. Setup contains Buildings, People & access and Activity log.

Developer Representative users see Dashboard, Snags and Units. They do not see or access Setup, People & access or Activity log.

Contractor users see Dashboard and Snags. They do not see or access Setup, People & access, Activity log or Units.

Resident users see only My home, My snags and Help. They do not see or access internal Dashboard, Snags, Units, Setup, People & access or Activity log screens.

Navigation hiding is not the only protection. Each protected screen checks the current portal role before rendering. Direct URL access through the `screen` query parameter shows a Not authorised screen when the role is not permitted.

## 3. Authentication And Profile Model

Supabase Auth owns the login account, including email, password, invite links, reset links and auth-level banned/deactivated state.

`public.profiles` is the portal user record. `profiles.id` links to `auth.users.id`. The profile stores display name, email, phone, role, resident type, organisation and active/deactivated status.

Invited users may be created by an admin or by approving a resident access request. Existing users can receive new flat or building access without creating another Auth account.

## 4. Resident Access Request Workflow

Residents request access from `/request-access`. They provide name, email, phone, resident type and one or more requested flats.

Admins and Developers review pending requests in Setup > People & access. The review panel shows requested flats, requester notes, admin notes, whether an existing profile matches the email, and the current access for that user.

If no matching profile exists, the approval action creates or invites the Supabase Auth user, creates the profile and assigns the requested flats.

If a matching profile exists, the approval action updates the resident profile/access and adds only new flat access. Duplicate requested flats are flagged. If every requested flat is already assigned, approval is blocked.

Rejected access requests do not remove or deactivate any existing user profile.

Buildings can disable resident access requests using `allow_resident_access_requests`. This hides the building on the public request form and rejects direct submissions for that building. This setting does not control whether existing approved users can log in, complete handover, or submit routine snags.

## 5. Building And Flat Access Model

Buildings contain floors, units/flats and communal areas. Units contain rooms, private amenities and handover information.

Residents receive flat-level access through `user_unit_access`. Contractors and Developer Representatives receive building-level access through `user_building_access`. Admin and Developer access is derived from role and does not need building assignment.

## 6. Handover Workflow

Flat handover completion is allowed once PC has been confirmed for the building. It is not allowed in `pre_pc`.

Handover can still be completed after the initial defects reporting period has closed. A late handover does not reopen resident routine snag reporting.

The handover record captures recipient details, relationship to the flat, key/fob items, key photos, electricity and water meter readings, meter photos, declaration acceptance, signature and date/time.

Residents can view their handover record after access is assigned. Admin/internal users can complete late handovers for late sales or late occupations.

## 7. Snag And Defect Workflow

The system distinguishes internal/pre-PC snags from resident routine snags.

Internal/pre-PC snags are developer-side records used by authorised non-resident users before and after PC where their role allows it. These may include unit snags, communal snags, QA items, pre-completion issues or contractor defects.

Resident routine snags are resident-facing reports for their own flat. Residents can submit routine snags only when the building lifecycle is `dlp_active` or `dlp_closing`.

In `pre_pc`, residents cannot submit routine snags yet. Internal users can continue managing pre-PC snags where permitted.

In `post_dlp_readonly`, new routine snag reports are closed. Existing records remain visible based on normal permissions, and late handovers can still be completed.

Typical snag status flow includes Open, Accepted, Assigned to Contractor, Needs More Info, Resolved by Contractor, Closed and Rejected. Priorities P1, P2 and P3 may be applied where the workflow requires SLA handling.

## 8. PC-Based Building Lifecycle

Admins manage three normal building lifecycle inputs:

- `pc_date`: expected or confirmed Practical Completion date.
- `pc_confirmed`: whether PC has actually been confirmed.
- `allow_resident_access_requests`: whether new residents can request access to flats in the building.

The portal calculates:

- `initial_defects_reporting_end`: confirmed PC date plus 12 months.
- `closing_notice_start`: initial defects reporting end minus 2 months.
- `derived_lifecycle_status`: calculated from PC confirmation, PC date and current date.

PC cannot be confirmed unless a PC date has been entered. PC cannot be confirmed using a future date. Once PC is confirmed, the PC date is locked/read-only in the UI unless the admin uses the explicit "Edit confirmed PC date" action. Changing a confirmed PC date recalculates the resident portal lifecycle, closing notice date and initial defects reporting end date.

If an expected/provisional PC date passes without PC confirmation, admins and developers see a dashboard warning. The resident-facing lifecycle does not start until PC has been confirmed.

Lifecycle values are:

- `pre_pc`: PC has not been confirmed. Residents cannot submit routine snags or complete handover yet. Internal users can continue managing pre-PC snags where permitted.
- `dlp_active`: PC is confirmed and the initial defects reporting period is open. Residents can submit routine snags and flat handovers can be completed.
- `dlp_closing`: the closing notice period has started. Residents can still submit routine snags and flat handovers can be completed.
- `post_dlp_readonly`: the initial defects reporting period has closed. Residents can view records and documents but cannot submit new routine snag reports. Flat handovers can still be completed for late sales.
- `archived`: optional future/admin-only state.

The portal should say "initial defects reporting period", "routine snag reporting" and "handover records". It should not say that all rights, warranties or defect routes have ended.

## 9. Post-DLP / Read-Only Mode

After the initial defects reporting period closes, residents can still view:

- Handover records.
- Historic snags.
- Snag outcomes/history.
- Home User Guide.
- O&M links.
- Building documents.
- Useful contacts.

Residents can no longer create new routine snags, create maintenance requests, raise communal management issues or message Bunnywell as if the portal is still an active service desk.

Communal or building management matters should be directed to the managing agent. Residents may also be signposted to the Home User Guide, building documents or `info@bunnywell.co.uk` for guidance.

## 10. Configuration

Key building configuration fields:

- `pc_date`: expected PC date until confirmed; confirmed PC date once `pc_confirmed` is true.
- `pc_confirmed`: starts the resident-facing lifecycle when true and the PC date is today or in the past.
- `allow_resident_access_requests`: controls whether new resident access requests can be submitted for the building.

Compatibility fields such as `practical_completion_date` and `defects_liability_end_date` may still exist for older workflow/reporting support, but the PC-confirmed lifecycle is driven by `pc_date` and `pc_confirmed`.

Environment variables are configured separately per environment. Important names include `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` and the Playwright test account variables. Never commit live secret values.

GitHub Actions Playwright tests run a local build of the portal against the Supabase project configured in repository secrets. The current test baseline uses the staging database and these role accounts: `carl.gilbert@gmail.com` as Admin, `devrep@bunnywell.co.uk` as Developer Representative for Airey Miller on Forum House, `contractor@bunnywell.co.uk` as Benchmark Construction contractor on Forum House, and `resident@bunnywell.co.uk` as a resident for Forum House flats 101 and 201. Resident e2e coverage should remain limited to sign-in and navigation visibility until the resident journey is complete.

## 11. Supabase / Database Overview

Main tables:

- `profiles`: portal user records linked to Supabase Auth users.
- `resident_access_requests`: pending/approved/rejected resident access requests.
- `buildings`: building setup, PC date/confirmation and document links.
- `building_floors`: controlled floor labels per building.
- `units`: flats, floor, unit type, size, parking and sale/handover status.
- `areas`: unit rooms and communal areas.
- `snags`: developer/internal snags and resident routine defects.
- `snag_events`: status/history timeline.
- `snag_photos`: uploaded snag photos.
- `handovers`, `handover_key_items`, `handover_photos`: handover records.
- `meter_readings`: handover and resident meter readings.
- `organisations`: contractors, developer representatives and related organisations.
- `audit_events`: admin/system history.

RLS keeps data access role-aware. Setup-admin access means Admin and Developer only. Developer Representatives and Contractors are scoped by assigned building access. Residents are limited to their assigned flats. Resident snag inserts are blocked unless the building is in `dlp_active` or `dlp_closing`. Handover inserts are blocked unless PC has been confirmed and the unit is completed.

## 12. File And Document Storage

Snag images, annotated photos, handover photos and meter photos are stored in Supabase Storage. Building document links, Home User Guide links and O&M links are stored as URLs on building records.

Access to stored records follows the related database permissions: residents see records linked to their flats, while back-office users see records according to role and building access.

## 13. Admin Operations

Common admin tasks:

- Add users.
- Approve or reject resident access requests.
- Assign users to buildings or flats.
- Deactivate users.
- Manage organisations.
- Enter expected PC date.
- Confirm PC once Practical Completion has actually occurred.
- Edit confirmed PC date using the explicit edit action.
- Allow or disable new resident access requests.
- Complete late handovers after the initial defects reporting period has closed.
- Add or edit building document links.
- View historic records and audit history.

## 14. Deployment And Environments

Typical environments are dev, staging and production. Staging should be used to test access requests, invites, PC confirmation, lifecycle behaviour, handover behaviour and resident read-only mode before production.

Vercel hosts deployments, Supabase provides Auth/Postgres/Storage, and GitHub holds source control and CI workflows. Keep Supabase projects and environment variables separate between dev/staging/prod.

Database migrations, Auth settings and RLS changes require extra care and should be tested outside production first.

## 15. Maintenance Notes For External Helpers

Important code locations:

- `src/components/portal/ProductionPortalApp.tsx`: main authenticated portal UI.
- `src/components/portal/RequestAccessPage.tsx`: public resident access request page.
- `src/app/api/access-requests/route.ts`: public request submission and admin request approval API.
- `src/app/api/admin/users/route.ts`: admin user actions.
- `src/lib/building-lifecycle.ts`: PC-derived lifecycle helper logic.
- `src/lib/data/production.ts`: shared TypeScript data shapes.
- `supabase/migrations`: database migrations and RLS policy changes.
- `docs/bunnywell-portal-system-guide.md`: source for this guide.

Common commands:

- `npm install`: install dependencies.
- `npm.cmd run dev`: run the dev server on Windows.
- `npx.cmd tsc --noEmit`: typecheck.
- `npm.cmd run build`: production build.
- `npm.cmd run lint`: lint.
- `npm.cmd run test:e2e`: Playwright tests.
- `npm.cmd run docs:pdf`: regenerate this PDF guide.

Database migrations and permission changes should be small, reviewed and tested in dev/staging before production.

## 16. Change Log

| Date | Summary | Person/agent |
| --- | --- | --- |
| 2026-06-28 | Added workflow navigation, central screen permissions, direct URL guards, setup-admin RLS split and role-aware data scoping. | Codex |
| 2026-06-28 | Added PC-confirmed lifecycle model, dashboard/building settings PC confirmation, resident reporting gates, handover PC gate and updated system guide. | Codex |
