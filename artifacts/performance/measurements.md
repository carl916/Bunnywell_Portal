# Recorded performance measurements

Generated from numeric-only samples. All times are milliseconds. HTTP 413 is a failed upload; `status: ok` in raw samples means the diagnostic observed the expected outcome, not that the upload succeeded.

## Live staging workflow

| Profile | Action | n | Median | Slowest | Requests | Pending median / max | POST median | After POST* | Response KiB | HTTP |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| desktop | sale.open.cold | 3 | 4,595 | 5,624 | 115 | — / — | — | — | 1020.8 | — |
| desktop | sale.open.repeat | 3 | 6,013 | 9,079 | 115 | — / — | — | — | 437.8 | — |
| desktop | authority.request | 3 | 5,445 | 10,012 | 37 | 30 / 30 | 776 | 4,206 | 167.2 | 200 |
| desktop | authority.preview_open | 3 | 848 | 1,364 | 1 | 31 / 31 | 785 | 72 | 3.3 | 200 |
| desktop | authority.issue | 3 | 5,429 | 12,546 | 37 | 30 / 31 | 1,623 | 4,038 | 252.0 | 200 |
| desktop | exchange.record | 3 | 4,430 | 9,997 | 37 | 30 / 31 | 1,020 | 3,652 | 172.6 | 200 |
| desktop | completion.open | 3 | 30 | 31 | 0 | 30 / 31 | — | — | 0.0 | — |
| desktop | completion.documents_select.one-1MiB | 3 | 97 | 109 | 0 | 72 / 78 | — | — | 0.0 | — |
| desktop | completion.documents_upload.one-1MiB | 3 | 7,778 | 16,778 | 37 | 29 / 30 | 3,473 | 4,402 | 174.3 | 200 |
| desktop | completion.documents_select.two-1MiB | 3 | 145 | 174 | 0 | 130 / 158 | — | — | 0.0 | — |
| desktop | completion.documents_upload.two-1MiB | 3 | 9,913 | 10,796 | 37–39 | 29 / 30 | 6,325 | 3,858 | 175.8 | 200 |
| desktop | completion.documents_select.two-5MiB | 3 | 593 | 760 | 0 | 561 / 734 | — | — | 0.0 | — |
| desktop | completion.documents_upload.two-5MiB | 3 | 11,814 | 12,547 | 1–3 | 30 / 30 | 11,775 | 39 | 3.0 | 413 |
| desktop | completion.documents_select.two-near-10MiB | 3 | 1,402 | 1,403 | 0 | 1,371 / 1,381 | — | — | 0.0 | — |
| desktop | completion.documents_upload.two-near-10MiB | 3 | 24,329 | 24,746 | 3 | 30 / 31 | 24,289 | 40 | 2.8 | 413 |
| desktop | completion.documents_approve | 3 | 3,964 | 9,996 | 37 | 30 / 31 | 1,078 | 3,284 | 251.0 | 200 |
| desktop | completion.record | 3 | 4,932 | 4,980 | 37 | 31 / 32 | 766 | 4,166 | 174.2 | 200 |
| mobile-throttled | sale.open.cold | 2 | 10,199 | 10,515 | 115 | — / — | — | — | 1025.7 | — |
| mobile-throttled | sale.open.repeat | 2 | 6,559 | 6,792 | 115 | — / — | — | — | 442.7 | — |
| mobile-throttled | authority.request | 2 | 6,747 | 7,556 | 37 | 23 / 24 | 1,101 | 5,646 | 169.6 | 200 |
| mobile-throttled | authority.preview_open | 2 | 847 | 855 | 1 | 23 / 23 | 566 | 281 | 3.3 | 200 |
| mobile-throttled | authority.issue | 2 | 5,492 | 5,542 | 37 | 25 / 26 | 1,118 | 4,374 | 254.2 | 200 |
| mobile-throttled | exchange.record | 2 | 5,222 | 5,455 | 37 | 23 / 24 | 793 | 4,430 | 174.8 | 200 |
| mobile-throttled | completion.open | 2 | 58 | 60 | 0 | 29 / 29 | — | — | 0.0 | — |
| mobile-throttled | completion.documents_select.one-1MiB | 2 | 277 | 282 | 0 | 252 / 257 | — | — | 0.0 | — |
| mobile-throttled | completion.documents_upload.one-1MiB | 2 | 19,074 | 19,441 | 37 | 25 / 27 | 14,381 | 4,693 | 176.4 | 200 |
| mobile-throttled | completion.documents_select.two-1MiB | 2 | 514 | 522 | 0 | 486 / 489 | — | — | 0.0 | — |
| mobile-throttled | completion.documents_upload.two-1MiB | 2 | 30,871 | 30,970 | 39 | 24 / 26 | 25,937 | 4,934 | 179.9 | 200 |
| mobile-throttled | completion.documents_select.two-5MiB | 2 | 2,361 | 2,402 | 0 | 2,329 / 2,373 | — | — | 0.0 | — |
| mobile-throttled | completion.documents_upload.two-5MiB | 2 | 112,311 | 112,321 | 7 | 23 / 25 | 112,221 | 90 | 7.1 | 413 |
| mobile-throttled | completion.documents_select.two-near-10MiB | 2 | 5,121 | 5,581 | 0 | 5,095 / 5,556 | — | — | 0.0 | — |
| mobile-throttled | completion.documents_upload.two-near-10MiB | 2 | 224,245 | 224,262 | 12–13 | 27 / 29 | 224,160 | 85 | 12.8 | 413 |
| mobile-throttled | completion.documents_approve | 2 | 5,770 | 6,000 | 37 | 26 / 26 | 859 | 4,911 | 253.7 | 200 |
| mobile-throttled | completion.record | 2 | 8,865 | 11,124 | 37 | 26 / 28 | 2,397 | 6,468 | 177.1 | 200 |

## Live staging read-only navigation

| Profile | Action | n | Median | Slowest | Requests | Pending median / max | POST median | After POST* | Response KiB | HTTP |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| desktop | sale_file.navigation.cold | 5 | 2,087 | 2,131 | 95–99 | — / — | — | — | 1153.6 | — |
| desktop | sale_file.navigation.repeat | 5 | 1,912 | 1,946 | 95–104 | — / — | — | — | 580.7 | — |
| desktop | sale.open.in_app | 5 | 34 | 40 | 0 | — / — | — | — | 0.0 | — |
| desktop | progression.stage_change | 5 | 4,380 | 4,414 | 3–18 | — / — | — | — | 26.6 | — |
| desktop | completion.open | 5 | 30 | 33 | 0 | — / — | — | — | 0.0 | — |
| mobile-throttled | sale_file.navigation.cold | 5 | 7,817 | 7,850 | 93–95 | — / — | — | — | 1128.2 | — |
| mobile-throttled | sale_file.navigation.repeat | 5 | 4,807 | 4,881 | 95–97 | — / — | — | — | 559.6 | — |
| mobile-throttled | sale.open.in_app | 5 | 70 | 87 | 0 | — / — | — | — | 0.0 | — |
| mobile-throttled | progression.stage_change | 5 | 1,904 | 2,973 | 3–11 | — / — | — | — | 27.3 | — |
| mobile-throttled | completion.open | 5 | 73 | 74 | 0 | — / — | — | — | 0.0 | — |

## Deployed frontend with synthetic backend (not service timings)

| Profile | Action | n | Median | Slowest | Requests | Pending median / max | POST median | After POST* | Response KiB | HTTP |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| desktop | sale.open.cold | 5 | 416 | 449 | 103–130 | — / — | — | — | 638.3 | — |
| desktop | sale.open.repeat | 5 | 410 | 430 | 98–111 | — / — | — | — | 638.1 | — |
| desktop | progression.stage_change | 5 | 30 | 31 | 0 | — / — | — | — | 0.0 | — |
| desktop | authority.preview_open | 5 | 79 | 80 | 1 | 31 / 37 | — | — | 11.9 | — |
| desktop | authority.request | 5 | 129 | 130 | 35 | 30 / 30 | — | — | 3.2 | — |
| desktop | authority.issue | 5 | 129 | 131 | 35 | 30 / 31 | — | — | 15.2 | — |
| desktop | exchange.record | 5 | 127 | 131 | 35 | 31 / 33 | — | — | 15.4 | — |
| desktop | completion.open | 5 | 31 | 46 | 0 | 31 / 35 | — | — | 0.0 | — |
| desktop | completion.documents_select.one-1MiB | 5 | 25 | 47 | 0 | 25 / 34 | — | — | 0.0 | — |
| desktop | completion.documents_upload.one-1MiB | 5 | 129 | 145 | 36 | 29 / 31 | — | — | 16.4 | — |
| desktop | completion.documents_select.two-1MiB | 5 | 24 | 32 | 0 | 24 / 32 | — | — | 0.0 | — |
| desktop | completion.documents_upload.two-1MiB | 5 | 114 | 128 | 36 | 29 / 30 | — | — | 17.9 | — |
| desktop | completion.documents_select.two-5MiB | 5 | 23 | 38 | 0 | 21 / 23 | — | — | 0.0 | — |
| desktop | completion.documents_upload.two-5MiB | 5 | 115 | 126 | 36 | 30 / 31 | — | — | 19.0 | — |
| desktop | completion.documents_select.two-near-10MiB | 5 | 34 | 43 | 0 | 25 / 32 | — | — | 0.0 | — |
| desktop | completion.documents_upload.two-near-10MiB | 5 | 130 | 131 | 36 | 31 / 33 | — | — | 20.1 | — |
| desktop | completion.documents_approve | 5 | 129 | 131 | 36 | 31 / 31 | — | — | 20.3 | — |
| desktop | completion.record | 5 | 129 | 129 | 36 | 31 / 32 | — | — | 20.4 | — |
| mobile-throttled | sale.open.cold | 5 | 3,966 | 4,106 | 112–129 | — / — | — | — | 639.1 | — |
| mobile-throttled | sale.open.repeat | 5 | 3,961 | 4,170 | 96–119 | — / — | — | — | 638.5 | — |
| mobile-throttled | progression.stage_change | 5 | 48 | 66 | 0 | — / — | — | — | 0.0 | — |
| mobile-throttled | authority.preview_open | 5 | 143 | 188 | 1 | 32 / 36 | — | — | 11.9 | — |
| mobile-throttled | authority.request | 5 | 321 | 336 | 35 | 35 / 37 | — | — | 3.2 | — |
| mobile-throttled | authority.issue | 5 | 356 | 386 | 35 | 38 / 44 | — | — | 15.2 | — |
| mobile-throttled | exchange.record | 5 | 340 | 411 | 35 | 39 / 41 | — | — | 15.4 | — |
| mobile-throttled | completion.open | 5 | 57 | 96 | 0 | 25 / 27 | — | — | 0.0 | — |
| mobile-throttled | completion.documents_select.one-1MiB | 5 | 50 | 85 | 0 | 20 / 31 | — | — | 0.0 | — |
| mobile-throttled | completion.documents_upload.one-1MiB | 5 | 273 | 306 | 36 | 24 / 25 | — | — | 16.4 | — |
| mobile-throttled | completion.documents_select.two-1MiB | 5 | 38 | 72 | 0 | 22 / 26 | — | — | 0.0 | — |
| mobile-throttled | completion.documents_upload.two-1MiB | 5 | 258 | 303 | 36 | 25 / 28 | — | — | 17.9 | — |
| mobile-throttled | completion.documents_select.two-5MiB | 5 | 50 | 85 | 0 | 25 / 32 | — | — | 0.0 | — |
| mobile-throttled | completion.documents_upload.two-5MiB | 5 | 292 | 318 | 36 | 24 / 27 | — | — | 19.0 | — |
| mobile-throttled | completion.documents_select.two-near-10MiB | 5 | 42 | 92 | 0 | 31 / 39 | — | — | 0.0 | — |
| mobile-throttled | completion.documents_upload.two-near-10MiB | 5 | 290 | 348 | 36 | 25 / 26 | — | — | 20.1 | — |
| mobile-throttled | completion.documents_approve | 5 | 356 | 411 | 36 | 44 / 50 | — | — | 20.3 | — |
| mobile-throttled | completion.record | 5 | 377 | 569 | 36 | 23 / 48 | — | — | 20.4 | — |

*After POST is click-to-final time minus the POST round trip. It includes refreshes, browser work and small pre-request overhead; it is not pure React time. File-selection times in live samples include automation byte transfer and must not be interpreted as application PDF processing. The synthetic fixture starts selection timing at the native input change event.

## Five slowest individual workflow observations

| Profile | Action | Run | Time | HTTP |
|---|---|---:|---:|---:|
| mobile-throttled | completion.documents_upload.two-near-10MiB | 4 | 224,262 | 413 |
| mobile-throttled | completion.documents_upload.two-near-10MiB | 5 | 224,228 | 413 |
| mobile-throttled | completion.documents_upload.two-5MiB | 4 | 112,321 | 413 |
| mobile-throttled | completion.documents_upload.two-5MiB | 5 | 112,300 | 413 |
| mobile-throttled | completion.documents_upload.two-1MiB | 4 | 30,970 | 200 |
