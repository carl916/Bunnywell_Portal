# Separate staging security observations — 11 November 2026

No policy, bucket setting or remote database object was changed. Public access to `snag-images` is retained deliberately for the stated business-continuity requirement.

## Evidence inspected

- `snag-images` remains public.
- Storage metadata: **538 objects — 536 JPEGs and 2 MP4s**.
- Linked `snag_photos` metadata: **201 media records, all attached to developer snagging**; 197 annotated images, two resolution images, one annotated video, one resolution video. No linked resident-defect media in this inspection.
- One representative developer snag photograph showed a door/cabinet defect and loaded successfully in the connected UI. This is a small sample, not a privacy/content audit of all bytes. Thumbnails/derivatives and any unlinked objects have not been fully reconciled to the 201 records.
- Developer snagging can still contain private interior detail. Future resident submissions could include possessions, people, correspondence or identifying information; absence of current resident links does not establish that all bucket content is non-sensitive.

## Existing write-permission issues to review separately

1. **Upload scope is too broad.** The authenticated INSERT policy checks only `bucket_id = 'snag-images'`. It does not itself require an active profile, accessible building/snag, ownership or an authorised object path. Existing authenticated users may be able to upload unrelated public content. No upload exploit was attempted.
   - Recommended separately approved correction: enforce active account + authorised snag/building + controlled object path, with appropriate file-type/size validation. Retain approved independent public reading where needed; changing the bucket to private is not proposed as an automatic fix.

2. **Resident area/unit binding is ineffective.** The snag INSERT policy correctly checks creator identity, resident role/source, accessible unit, routine-defect eligibility and matching unit/building, but its area subquery uses `a.unit_id = a.unit_id`, rather than `a.unit_id = snags.unit_id`. The foreign keys do not enforce the missing relationship. A non-null area belonging to another unit could therefore be associated with an otherwise permitted resident submission. This is an integrity/authorisation weakness in area association, not evidence of an unrestricted write to another building.
   - Recommended separately approved correction: bind the area to the submitted unit (and verify building consistency), with positive/negative policy tests in isolation before any remote migration. No exploit record was created.

UPDATE and DELETE on the bucket require the existing `is_back_office_user()` check: active admin/developer roles via `is_setup_admin()` / `current_app_role()`. They are not granted to every authenticated account. No destructive permission probes were run.

## Later continuity review

Retain the requirement for an independent, regularly refreshed export of records and photographs (including a possible Google Sheets fallback). Assess export cadence, encrypted independent storage, stable record/media IDs, checksums/manifests, version and deletion history, tested restoration, and access to photos without the portal. An outage activity journal needs stable IDs, timestamps, actors, idempotent replay and explicit conflict resolution when reconciling back into the portal.

No backup pipeline, external sharing, notifications or outage-write mechanism was implemented in this read-only integration.
