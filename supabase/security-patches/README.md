# Proposed A1/A2 staging security package

Status: tested locally; **not applied to staging or production**. Target for later approval: `vxkpvdtrldwwqiddoyof`.

The SQL file in this directory restricts all commercial-model overloads and wrappers to the existing authorised server path, validates the active internal actor, scopes new snag uploads, fixes resident room association, and scopes private reports to the building. Public snag-image reading and internal photo maintenance remain intentional. The conveyancer-payment function is not changed.

Deploy the scoped upload-path changes in `ProductionPortalApp.tsx` together with this SQL. Old public object URLs remain valid. New uploads use building/unit or exact-snag paths, including derived images and videos. Private report access remains available to internal users and scoped developer representatives/contractors, including existing signed report links.

Sensitive handover paths are deliberately rejected by the public snag upload policy. Existing handover upload callers must remain unavailable until their private-media integration is approved and complete; this package does not claim those callers are ready. Confirm that impact before staging publication. No automatic remote application script is supplied.

New evidence: `artifacts/backend-foundation/security-tests.json`, 27 checks using real local Auth sessions and Storage/REST requests, including direct permission denials and public reading. The source harness is `scripts/backend-foundation/security-tests.mjs`. The isolated project is `bunnywell-backend-foundation`, loopback API port 55321. Its private credentials and runtime logs are ignored. This is local synthetic evidence, not staging acceptance.

Application is transactional. Before later approval, verify the policy/function definitions still match the reviewed target and recheck current actor/building appointments. Retain a schema-only rollback capture. Do not restore the vulnerable anonymous grants as a routine rollback; disable affected write callers if necessary instead.
