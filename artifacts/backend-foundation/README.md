# Foundation evidence

All results in this directory are from newly executed local checks unless explicitly identified as historical. No staging acceptance or production timing is implied.

Use performance-paired.json for comparisons: 54 paired API samples and 36 usable-screen samples, three warm repeats for each role/screen/path. Both paths used the same frozen synthetic population (407 selected-building rows), validated sessions and the same server. Further synthetic regression records may have been added afterward. performance-before.json and performance-after.json are earlier pre-validation observations and are retained for provenance only; do not use those earlier runs as final acceptance evidence.

query-plans.json records rejected tuning experiments. Their candidate indexes/policy changes were removed. baseline-parity.json compares both disposable project schemas, including the final concurrent-area guard. The first creation preceded seeding; the second has a separate clean-creation record. The small guard addendum was verified on both after creation.

Offline Node/PGlite tests, real Auth/Storage/database route tests, PostgreSQL constraint transactions and Chromium navigation tests have separate files and methods. No passwords, service keys, cookies or session tokens belong here. Private runtime files are under the ignored backend-local, backend-rehearsal-two and tmp directories.
