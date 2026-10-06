# Detailed baseline measurements

Request counts include every request initiated in the action window. “Finished non-vitals” uses the September recorder’s count convention, excluding the newly introduced telemetry. Response bytes are compressed response-body bytes when Playwright can obtain them; incomplete/failed requests have null sizes. Browser failures can include navigation-cancelled requests; HTTP failures and UI outcomes are separate.

| Action | Profile | n | Median / max | Initiated / finished non-vitals | Browser failures / vitals subset | HTTP failures | Median response KiB |
|---|---|---:|---:|---:|---:|---:|---:|
| sale_file.navigation.cold | desktop | 5 | 2.30 s / 2.56 s | 101–117 / 96–107 | 17 / 15 | 0 | 1143.5 |
| sale_file.navigation.cold | mobile-throttled | 5 | 7.91 s / 7.92 s | 101–117 / 95–96 | 79 / 15 | 0 | 1143.3 |
| sale_file.navigation.repeat | desktop | 5 | 1.91 s / 1.97 s | 109–117 / 96–101 | 23 / 15 | 0 | 581.3 |
| sale_file.navigation.repeat | mobile-throttled | 5 | 4.81 s / 4.83 s | 101–108 / 96 | 23 / 15 | 0 | 553.6 |
| sale.open.in_app | desktop | 5 | 0.03 s / 0.03 s | 1–17 / 0 | 0 / 0 | 0 | 0.0 |
| sale.open.in_app | mobile-throttled | 5 | 0.07 s / 0.07 s | 0–1 / 0 | 0 / 0 | 0 | 0.0 |
| progression.stage_change | desktop | 5 | 1.35 s / 1.86 s | 3 / 3 | 0 / 0 | 0 | 34.3 |
| progression.stage_change | mobile-throttled | 5 | 1.44 s / 1.89 s | 3 / 3 | 0 / 0 | 0 | 34.3 |
| completion.open | desktop | 5 | 0.03 s / 0.03 s | 0 / 0 | 0 / 0 | 0 | 0.0 |
| completion.open | mobile-throttled | 5 | 0.06 s / 0.07 s | 0 / 0 | 0 / 0 | 0 | 0.0 |
| sale.open.cold | desktop | 2 | 5.00 s / 5.73 s | 120 / 117 | 6 / 6 | 0 | 1058.2 |
| sale.open.cold | mobile-throttled | 2 | 8.95 s / 8.99 s | 120 / 117 | 6 / 6 | 0 | 1065.6 |
| sale.open.repeat | desktop | 2 | 4.96 s / 5.48 s | 120 / 117 | 6 / 6 | 0 | 468.5 |
| sale.open.repeat | mobile-throttled | 2 | 5.82 s / 5.84 s | 120 / 117 | 6 / 6 | 0 | 475.9 |
| authority.request | desktop | 2 | 4.65 s / 4.93 s | 39 / 38 | 2 / 2 | 0 | 180.2 |
| authority.request | mobile-throttled | 2 | 5.47 s / 5.51 s | 38 / 37 | 2 / 2 | 0 | 182.5 |
| authority.preview_open | desktop | 2 | 1.08 s / 1.33 s | 1 / 1 | 0 / 0 | 0 | 3.6 |
| authority.preview_open | mobile-throttled | 2 | 0.84 s / 0.84 s | 1 / 1 | 0 / 0 | 0 | 3.6 |
| authority.issue | desktop | 2 | 4.43 s / 4.95 s | 38 / 38 | 0 / 0 | 0 | 264.7 |
| authority.issue | mobile-throttled | 2 | 5.26 s / 5.56 s | 37 / 37 | 0 / 0 | 0 | 267.1 |
| exchange.record | desktop | 2 | 3.91 s / 4.40 s | 37 / 37 | 0 / 0 | 0 | 183.0 |
| exchange.record | mobile-throttled | 2 | 5.00 s / 5.05 s | 37 / 37 | 0 / 0 | 0 | 187.8 |
| notice.authority_issue | desktop | 2 | 4.91 s / 4.93 s | 38 / 38 | 0 / 0 | 0 | 264.6 |
| notice.authority_issue | mobile-throttled | 2 | 5.27 s / 5.56 s | 37–38 / 37–38 | 0 / 0 | 0 | 268.1 |
| notice.arrangements_confirm | desktop | 2 | 4.92 s / 5.93 s | 37–38 / 37–38 | 0 / 0 | 0 | 185.4 |
| notice.arrangements_confirm | mobile-throttled | 2 | 7.05 s / 8.11 s | 37 / 37 | 0 / 0 | 0 | 189.1 |
| completion.documents_upload.one-1MiB | desktop | 2 | 10.30 s / 10.78 s | 40 / 40 | 0 / 0 | 0 | 202.3 |
| completion.documents_upload.one-1MiB | mobile-throttled | 2 | 20.10 s / 20.21 s | 40–41 / 40–41 | 0 / 0 | 0 | 191.7 |
| completion.documents_upload.two-1MiB | desktop | 2 | 14.65 s / 15.55 s | 40–41 / 40–41 | 0 / 0 | 0 | 188.7 |
| completion.documents_upload.two-1MiB | mobile-throttled | 2 | 34.52 s / 34.56 s | 43–44 / 43–44 | 0 / 0 | 0 | 198.1 |
| completion.documents_upload.two-5MiB | desktop | 2 | 23.86 s / 24.43 s | 41–42 / 41–42 | 0 / 0 | 0 | 192.4 |
| completion.documents_upload.two-5MiB | mobile-throttled | 2 | 125.38 s / 125.85 s | 48 / 48 | 0 / 0 | 0 | 204.2 |
| completion.documents_upload.two-near-10MiB | desktop | 2 | 37.82 s / 37.86 s | 46 / 46 | 0 / 0 | 0 | 197.0 |
| completion.documents_upload.two-near-10MiB | mobile-throttled | 2 | 238.69 s / 239.11 s | 59 / 59 | 0 / 0 | 0 | 216.2 |
| completion.documents_approve | desktop | 2 | 3.64 s / 3.90 s | 38 / 38 | 0 / 0 | 0 | 265.7 |
| completion.documents_approve | mobile-throttled | 2 | 5.25 s / 5.51 s | 37 / 37 | 0 / 0 | 0 | 267.1 |
| completion.record | desktop | 2 | 4.40 s / 4.91 s | 38–39 / 38–39 | 0 / 0 | 0 | 197.6 |
| completion.record | mobile-throttled | 2 | 5.50 s / 5.99 s | 37–38 / 37–38 | 0 / 0 | 0 | 191.6 |

## Server phases

Medians of each phase are independent. Parent and child phases overlap; do not sum them. `_end` spans are route-entry offsets, and remain in raw JSON.

| Action | Profile | API operation | Span | n | Median / max ms | Calls |
|---|---|---|---|---:|---:|---:|
| sale.open.cold | desktop | context | route | 2 | 1479.30 / 1639.06 | — |
| sale.open.cold | desktop | context | auth | 2 | 265.92 / 345.00 | 1 |
| sale.open.cold | desktop | context | db_read | 2 | 2042.80 / 2483.81 | 8 |
| sale.open.cold | desktop | context | db_mutation | 2 | 300.12 / 303.50 | 1 |
| sale.open.repeat | desktop | context | route | 2 | 1155.40 / 1467.92 | — |
| sale.open.repeat | desktop | context | auth | 2 | 218.03 / 316.59 | 1 |
| sale.open.repeat | desktop | context | db_read | 2 | 1716.35 / 2110.63 | 8 |
| sale.open.repeat | desktop | context | db_mutation | 2 | 122.56 / 122.60 | 1 |
| authority.request | desktop | mutation | route | 2 | 714.50 / 716.85 | — |
| authority.request | desktop | mutation | auth | 2 | 118.87 / 129.37 | 1 |
| authority.request | desktop | mutation | db_read | 2 | 265.63 / 270.92 | 2 |
| authority.request | desktop | mutation | body_read | 2 | 0.20 / 0.27 | 1 |
| authority.request | desktop | mutation | json_parse | 2 | 0.04 / 0.05 | 1 |
| authority.request | desktop | mutation | db_mutation | 2 | 325.74 / 332.12 | 1 |
| authority.request | desktop | context | route | 2 | 1476.13 / 1821.97 | — |
| authority.request | desktop | context | auth | 2 | 230.95 / 333.62 | 1 |
| authority.request | desktop | context | db_read | 2 | 1785.45 / 2025.71 | 9 |
| authority.request | desktop | context | db_mutation | 2 | 215.09 / 319.21 | 1 |
| authority.preview_open | desktop | mutation | route | 2 | 589.97 / 792.28 | — |
| authority.preview_open | desktop | mutation | auth | 2 | 113.72 / 115.97 | 1 |
| authority.preview_open | desktop | mutation | db_read | 2 | 430.66 / 630.75 | 2 |
| authority.preview_open | desktop | mutation | body_read | 2 | 0.24 / 0.24 | 1 |
| authority.preview_open | desktop | mutation | json_parse | 2 | 0.07 / 0.10 | 1 |
| authority.issue | desktop | mutation | route | 2 | 1171.95 / 1315.46 | — |
| authority.issue | desktop | mutation | auth | 2 | 218.72 / 307.78 | 1 |
| authority.issue | desktop | mutation | db_read | 2 | 342.63 / 451.64 | 2 |
| authority.issue | desktop | mutation | body_read | 2 | 0.18 / 0.22 | 1 |
| authority.issue | desktop | mutation | json_parse | 2 | 0.03 / 0.03 | 1 |
| authority.issue | desktop | mutation | db_mutation | 2 | 487.87 / 588.59 | 3 |
| authority.issue | desktop | mutation | email_delivery | 2 | 102.50 / 114.49 | 1 |
| authority.issue | desktop | context | route | 2 | 1262.43 / 1379.25 | — |
| authority.issue | desktop | context | auth | 2 | 208.12 / 300.34 | 1 |
| authority.issue | desktop | context | db_read | 2 | 1913.57 / 2463.01 | 9 |
| authority.issue | desktop | context | db_mutation | 2 | 124.84 / 128.24 | 1 |
| exchange.record | desktop | mutation | route | 2 | 584.20 / 665.90 | — |
| exchange.record | desktop | mutation | auth | 2 | 110.02 / 112.70 | 1 |
| exchange.record | desktop | mutation | db_read | 2 | 339.41 / 426.13 | 2 |
| exchange.record | desktop | mutation | body_read | 2 | 0.14 / 0.17 | 1 |
| exchange.record | desktop | mutation | json_parse | 2 | 0.02 / 0.02 | 1 |
| exchange.record | desktop | mutation | db_mutation | 2 | 131.09 / 134.14 | 1 |
| exchange.record | desktop | context | route | 2 | 1148.75 / 1552.31 | — |
| exchange.record | desktop | context | auth | 2 | 210.71 / 309.12 | 1 |
| exchange.record | desktop | context | db_read | 2 | 1843.89 / 2536.43 | 9 |
| exchange.record | desktop | context | db_mutation | 2 | 230.99 / 330.87 | 1 |
| notice.authority_issue | desktop | mutation | route | 2 | 1315.94 / 1610.49 | — |
| notice.authority_issue | desktop | mutation | auth | 2 | 315.35 / 326.20 | 1 |
| notice.authority_issue | desktop | mutation | db_read | 2 | 332.94 / 435.23 | 2 |
| notice.authority_issue | desktop | mutation | body_read | 2 | 0.13 / 0.13 | 1 |
| notice.authority_issue | desktop | mutation | json_parse | 2 | 0.01 / 0.01 | 1 |
| notice.authority_issue | desktop | mutation | db_mutation | 2 | 583.23 / 785.87 | 3 |
| notice.authority_issue | desktop | mutation | email_delivery | 2 | 76.87 / 77.28 | 1 |
| notice.authority_issue | desktop | context | route | 2 | 1125.29 / 1141.59 | — |
| notice.authority_issue | desktop | context | auth | 2 | 110.22 / 110.76 | 1 |
| notice.authority_issue | desktop | context | db_read | 2 | 1830.68 / 1947.43 | 9 |
| notice.authority_issue | desktop | context | db_mutation | 2 | 122.99 / 129.89 | 1 |
| notice.arrangements_confirm | desktop | mutation | route | 2 | 989.05 / 1258.56 | — |
| notice.arrangements_confirm | desktop | mutation | auth | 2 | 226.79 / 327.85 | 1 |
| notice.arrangements_confirm | desktop | mutation | db_read | 2 | 329.17 / 421.59 | 2 |
| notice.arrangements_confirm | desktop | mutation | multipart_parse | 2 | 2.76 / 3.01 | 1 |
| notice.arrangements_confirm | desktop | mutation | file_prepare | 2 | 0.07 / 0.07 | 1 |
| notice.arrangements_confirm | desktop | mutation | storage_upload | 2 | 294.97 / 365.62 | 1 |
| notice.arrangements_confirm | desktop | mutation | db_mutation | 2 | 129.69 / 134.39 | 1 |
| notice.arrangements_confirm | desktop | context | route | 2 | 1183.14 / 1514.29 | — |
| notice.arrangements_confirm | desktop | context | auth | 2 | 212.53 / 310.68 | 1 |
| notice.arrangements_confirm | desktop | context | db_read | 2 | 1406.74 / 1570.94 | 9 |
| notice.arrangements_confirm | desktop | context | db_mutation | 2 | 218.85 / 320.07 | 1 |
| completion.documents_upload.one-1MiB | desktop | prepare | route | 2 | 1275.07 / 1622.13 | — |
| completion.documents_upload.one-1MiB | desktop | prepare | auth | 2 | 241.97 / 310.50 | 1 |
| completion.documents_upload.one-1MiB | desktop | prepare | db_read | 2 | 256.39 / 344.80 | 1 |
| completion.documents_upload.one-1MiB | desktop | prepare | body_read | 2 | 0.15 / 0.20 | 1 |
| completion.documents_upload.one-1MiB | desktop | prepare | json_parse | 2 | 0.03 / 0.03 | 1 |
| completion.documents_upload.one-1MiB | desktop | prepare | db_rpc | 2 | 230.84 / 324.48 | 1 |
| completion.documents_upload.one-1MiB | desktop | prepare | storage_read | 2 | 324.02 / 337.44 | 1 |
| completion.documents_upload.one-1MiB | desktop | prepare | storage_upload | 2 | 216.09 / 298.30 | 1 |
| completion.documents_upload.one-1MiB | desktop | prepare | upload_prepare | 2 | 774.67 / 964.24 | 1 |
| completion.documents_upload.one-1MiB | desktop | finalize | route | 2 | 3069.53 / 3254.27 | — |
| completion.documents_upload.one-1MiB | desktop | finalize | auth | 2 | 208.91 / 305.73 | 1 |
| completion.documents_upload.one-1MiB | desktop | finalize | db_read | 2 | 224.76 / 311.43 | 1 |
| completion.documents_upload.one-1MiB | desktop | finalize | body_read | 2 | 0.15 / 0.15 | 1 |
| completion.documents_upload.one-1MiB | desktop | finalize | json_parse | 2 | 0.01 / 0.02 | 1 |
| completion.documents_upload.one-1MiB | desktop | finalize | db_rpc | 2 | 262.99 / 265.55 | 2 |
| completion.documents_upload.one-1MiB | desktop | finalize | storage_read | 2 | 2111.41 / 2140.38 | 4 |
| completion.documents_upload.one-1MiB | desktop | finalize | storage_verify | 2 | 2114.63 / 2143.97 | 2 |
| completion.documents_upload.one-1MiB | desktop | finalize | storage_upload | 2 | 253.53 / 284.61 | 1 |
| completion.documents_upload.one-1MiB | desktop | finalize | finalization | 2 | 2633.93 / 2635.28 | 1 |
| completion.documents_upload.one-1MiB | desktop | context | route | 2 | 1060.84 / 1152.58 | — |
| completion.documents_upload.one-1MiB | desktop | context | auth | 2 | 128.58 / 142.64 | 1 |
| completion.documents_upload.one-1MiB | desktop | context | db_read | 2 | 1631.29 / 1810.00 | 9 |
| completion.documents_upload.one-1MiB | desktop | context | db_mutation | 2 | 119.00 / 119.93 | 1 |
| completion.documents_upload.two-1MiB | desktop | prepare | route | 2 | 1102.52 / 1353.87 | — |
| completion.documents_upload.two-1MiB | desktop | prepare | auth | 2 | 213.81 / 304.80 | 1 |
| completion.documents_upload.two-1MiB | desktop | prepare | db_read | 2 | 130.11 / 131.25 | 1 |
| completion.documents_upload.two-1MiB | desktop | prepare | body_read | 2 | 0.14 / 0.17 | 1 |
| completion.documents_upload.two-1MiB | desktop | prepare | json_parse | 2 | 0.03 / 0.03 | 1 |
| completion.documents_upload.two-1MiB | desktop | prepare | db_rpc | 2 | 235.18 / 348.70 | 1 |
| completion.documents_upload.two-1MiB | desktop | prepare | storage_read | 2 | 683.15 / 712.25 | 2 |
| completion.documents_upload.two-1MiB | desktop | prepare | storage_upload | 2 | 341.21 / 396.84 | 2 |
| completion.documents_upload.two-1MiB | desktop | prepare | upload_prepare | 2 | 756.56 / 917.50 | 1 |
| completion.documents_upload.two-1MiB | desktop | finalize | route | 2 | 5866.97 / 6261.71 | — |
| completion.documents_upload.two-1MiB | desktop | finalize | auth | 2 | 210.23 / 304.54 | 1 |
| completion.documents_upload.two-1MiB | desktop | finalize | db_read | 2 | 122.61 / 128.88 | 1 |
| completion.documents_upload.two-1MiB | desktop | finalize | body_read | 2 | 0.15 / 0.15 | 1 |
| completion.documents_upload.two-1MiB | desktop | finalize | json_parse | 2 | 0.01 / 0.02 | 1 |
| completion.documents_upload.two-1MiB | desktop | finalize | db_rpc | 2 | 491.21 / 677.63 | 2 |
| completion.documents_upload.two-1MiB | desktop | finalize | storage_read | 2 | 4487.24 / 4508.91 | 8 |
| completion.documents_upload.two-1MiB | desktop | finalize | storage_verify | 2 | 4491.99 / 4513.57 | 4 |
| completion.documents_upload.two-1MiB | desktop | finalize | storage_upload | 2 | 545.81 / 631.64 | 2 |
| completion.documents_upload.two-1MiB | desktop | finalize | finalization | 2 | 5532.57 / 5826.74 | 1 |
| completion.documents_upload.two-1MiB | desktop | context | route | 2 | 1263.87 / 1596.96 | — |
| completion.documents_upload.two-1MiB | desktop | context | auth | 2 | 236.59 / 329.34 | 1 |
| completion.documents_upload.two-1MiB | desktop | context | db_read | 2 | 1800.26 / 2224.22 | 9 |
| completion.documents_upload.two-1MiB | desktop | context | db_mutation | 2 | 121.31 / 126.89 | 1 |
| completion.documents_upload.two-5MiB | desktop | prepare | route | 2 | 1160.17 / 1245.44 | — |
| completion.documents_upload.two-5MiB | desktop | prepare | auth | 2 | 123.73 / 128.14 | 1 |
| completion.documents_upload.two-5MiB | desktop | prepare | db_read | 2 | 220.31 / 313.51 | 1 |
| completion.documents_upload.two-5MiB | desktop | prepare | body_read | 2 | 0.16 / 0.16 | 1 |
| completion.documents_upload.two-5MiB | desktop | prepare | json_parse | 2 | 0.01 / 0.01 | 1 |
| completion.documents_upload.two-5MiB | desktop | prepare | db_rpc | 2 | 133.42 / 145.64 | 1 |
| completion.documents_upload.two-5MiB | desktop | prepare | storage_read | 2 | 668.02 / 697.35 | 2 |
| completion.documents_upload.two-5MiB | desktop | prepare | storage_upload | 2 | 570.15 / 685.02 | 2 |
| completion.documents_upload.two-5MiB | desktop | prepare | upload_prepare | 2 | 814.32 / 817.92 | 1 |
| completion.documents_upload.two-5MiB | desktop | finalize | route | 2 | 5672.67 / 5760.78 | — |
| completion.documents_upload.two-5MiB | desktop | finalize | auth | 2 | 241.54 / 345.84 | 1 |
| completion.documents_upload.two-5MiB | desktop | finalize | db_read | 2 | 312.43 / 318.91 | 1 |
| completion.documents_upload.two-5MiB | desktop | finalize | body_read | 2 | 0.16 / 0.20 | 1 |
| completion.documents_upload.two-5MiB | desktop | finalize | json_parse | 2 | 0.01 / 0.01 | 1 |
| completion.documents_upload.two-5MiB | desktop | finalize | db_rpc | 2 | 409.74 / 515.28 | 2 |
| completion.documents_upload.two-5MiB | desktop | finalize | storage_read | 2 | 3923.27 / 4228.93 | 8 |
| completion.documents_upload.two-5MiB | desktop | finalize | storage_verify | 2 | 3928.63 / 4233.23 | 4 |
| completion.documents_upload.two-5MiB | desktop | finalize | storage_upload | 2 | 773.80 / 775.35 | 2 |
| completion.documents_upload.two-5MiB | desktop | finalize | finalization | 2 | 5116.95 / 5315.85 | 1 |
| completion.documents_upload.two-5MiB | desktop | context | route | 2 | 1373.20 / 1774.47 | — |
| completion.documents_upload.two-5MiB | desktop | context | auth | 2 | 215.62 / 319.66 | 1 |
| completion.documents_upload.two-5MiB | desktop | context | db_read | 2 | 1962.78 / 2431.10 | 9 |
| completion.documents_upload.two-5MiB | desktop | context | db_mutation | 2 | 123.55 / 125.19 | 1 |
| completion.documents_upload.two-near-10MiB | desktop | prepare | route | 2 | 1140.09 / 1200.52 | — |
| completion.documents_upload.two-near-10MiB | desktop | prepare | auth | 2 | 127.63 / 129.21 | 1 |
| completion.documents_upload.two-near-10MiB | desktop | prepare | db_read | 2 | 136.16 / 136.80 | 1 |
| completion.documents_upload.two-near-10MiB | desktop | prepare | body_read | 2 | 0.14 / 0.15 | 1 |
| completion.documents_upload.two-near-10MiB | desktop | prepare | json_parse | 2 | 0.02 / 0.03 | 1 |
| completion.documents_upload.two-near-10MiB | desktop | prepare | db_rpc | 2 | 139.63 / 148.15 | 1 |
| completion.documents_upload.two-near-10MiB | desktop | prepare | storage_read | 2 | 791.66 / 814.86 | 2 |
| completion.documents_upload.two-near-10MiB | desktop | prepare | storage_upload | 2 | 493.73 / 653.96 | 2 |
| completion.documents_upload.two-near-10MiB | desktop | prepare | upload_prepare | 2 | 874.69 / 932.99 | 1 |
| completion.documents_upload.two-near-10MiB | desktop | finalize | route | 2 | 6148.66 / 6371.87 | — |
| completion.documents_upload.two-near-10MiB | desktop | finalize | auth | 2 | 142.09 / 144.10 | 1 |
| completion.documents_upload.two-near-10MiB | desktop | finalize | db_read | 2 | 142.52 / 161.77 | 1 |
| completion.documents_upload.two-near-10MiB | desktop | finalize | body_read | 2 | 0.15 / 0.16 | 1 |
| completion.documents_upload.two-near-10MiB | desktop | finalize | json_parse | 2 | 0.01 / 0.01 | 1 |
| completion.documents_upload.two-near-10MiB | desktop | finalize | db_rpc | 2 | 418.56 / 519.66 | 2 |
| completion.documents_upload.two-near-10MiB | desktop | finalize | storage_read | 2 | 4382.40 / 4438.08 | 8 |
| completion.documents_upload.two-near-10MiB | desktop | finalize | storage_verify | 2 | 4386.51 / 4442.70 | 4 |
| completion.documents_upload.two-near-10MiB | desktop | finalize | storage_upload | 2 | 1054.51 / 1343.57 | 2 |
| completion.documents_upload.two-near-10MiB | desktop | finalize | finalization | 2 | 5862.41 / 6106.76 | 1 |
| completion.documents_upload.two-near-10MiB | desktop | context | route | 2 | 1136.03 / 1181.10 | — |
| completion.documents_upload.two-near-10MiB | desktop | context | auth | 2 | 122.59 / 126.68 | 1 |
| completion.documents_upload.two-near-10MiB | desktop | context | db_read | 2 | 2109.49 / 2276.12 | 9 |
| completion.documents_upload.two-near-10MiB | desktop | context | db_mutation | 2 | 202.00 / 263.50 | 1 |
| completion.documents_approve | desktop | mutation | route | 2 | 597.18 / 704.36 | — |
| completion.documents_approve | desktop | mutation | auth | 2 | 118.14 / 122.61 | 1 |
| completion.documents_approve | desktop | mutation | db_read | 2 | 336.13 / 439.35 | 2 |
| completion.documents_approve | desktop | mutation | body_read | 2 | 0.12 / 0.13 | 1 |
| completion.documents_approve | desktop | mutation | json_parse | 2 | 0.01 / 0.02 | 1 |
| completion.documents_approve | desktop | mutation | db_mutation | 2 | 139.57 / 140.79 | 1 |
| completion.documents_approve | desktop | context | route | 2 | 950.09 / 1140.53 | — |
| completion.documents_approve | desktop | context | auth | 2 | 124.61 / 136.02 | 1 |
| completion.documents_approve | desktop | context | db_read | 2 | 1525.12 / 1898.01 | 9 |
| completion.documents_approve | desktop | context | db_mutation | 2 | 124.03 / 132.33 | 1 |
| completion.record | desktop | mutation | route | 2 | 527.35 / 561.88 | — |
| completion.record | desktop | mutation | auth | 2 | 129.37 / 141.64 | 1 |
| completion.record | desktop | mutation | db_read | 2 | 249.45 / 260.90 | 2 |
| completion.record | desktop | mutation | body_read | 2 | 0.16 / 0.20 | 1 |
| completion.record | desktop | mutation | json_parse | 2 | 0.03 / 0.04 | 1 |
| completion.record | desktop | mutation | db_mutation | 2 | 144.72 / 156.33 | 1 |
| completion.record | desktop | context | route | 2 | 1165.95 / 1392.91 | — |
| completion.record | desktop | context | auth | 2 | 121.59 / 132.18 | 1 |
| completion.record | desktop | context | db_read | 2 | 1538.18 / 1567.54 | 9 |
| completion.record | desktop | context | db_mutation | 2 | 234.11 / 340.68 | 1 |
| sale.open.cold | mobile-throttled | context | route | 2 | 1057.82 / 1081.13 | — |
| sale.open.cold | mobile-throttled | context | auth | 2 | 135.38 / 136.49 | 1 |
| sale.open.cold | mobile-throttled | context | db_read | 2 | 1526.67 / 1736.87 | 8 |
| sale.open.cold | mobile-throttled | context | db_mutation | 2 | 221.96 / 329.12 | 1 |
| sale.open.repeat | mobile-throttled | context | route | 2 | 976.21 / 1054.60 | — |
| sale.open.repeat | mobile-throttled | context | auth | 2 | 232.85 / 330.60 | 1 |
| sale.open.repeat | mobile-throttled | context | db_read | 2 | 1231.99 / 1305.68 | 8 |
| sale.open.repeat | mobile-throttled | context | db_mutation | 2 | 220.39 / 298.69 | 1 |
| authority.request | mobile-throttled | mutation | route | 2 | 726.58 / 740.71 | — |
| authority.request | mobile-throttled | mutation | auth | 2 | 218.63 / 312.46 | 1 |
| authority.request | mobile-throttled | mutation | db_read | 2 | 358.00 / 437.66 | 2 |
| authority.request | mobile-throttled | mutation | body_read | 2 | 0.16 / 0.17 | 1 |
| authority.request | mobile-throttled | mutation | json_parse | 2 | 0.01 / 0.02 | 1 |
| authority.request | mobile-throttled | mutation | db_mutation | 2 | 145.93 / 147.06 | 1 |
| authority.request | mobile-throttled | context | route | 2 | 918.20 / 938.78 | — |
| authority.request | mobile-throttled | context | auth | 2 | 118.27 / 121.70 | 1 |
| authority.request | mobile-throttled | context | db_read | 2 | 1354.26 / 1406.55 | 9 |
| authority.request | mobile-throttled | context | db_mutation | 2 | 118.61 / 123.47 | 1 |
| authority.preview_open | mobile-throttled | mutation | route | 2 | 373.69 / 376.60 | — |
| authority.preview_open | mobile-throttled | mutation | auth | 2 | 132.11 / 134.05 | 1 |
| authority.preview_open | mobile-throttled | mutation | db_read | 2 | 237.00 / 242.32 | 2 |
| authority.preview_open | mobile-throttled | mutation | body_read | 2 | 0.14 / 0.14 | 1 |
| authority.preview_open | mobile-throttled | mutation | json_parse | 2 | 0.02 / 0.02 | 1 |
| authority.issue | mobile-throttled | mutation | route | 2 | 817.00 / 824.16 | — |
| authority.issue | mobile-throttled | mutation | auth | 2 | 109.13 / 110.40 | 1 |
| authority.issue | mobile-throttled | mutation | db_read | 2 | 238.28 / 246.84 | 2 |
| authority.issue | mobile-throttled | mutation | body_read | 2 | 0.13 / 0.13 | 1 |
| authority.issue | mobile-throttled | mutation | json_parse | 2 | 0.02 / 0.02 | 1 |
| authority.issue | mobile-throttled | mutation | db_mutation | 2 | 373.81 / 375.55 | 3 |
| authority.issue | mobile-throttled | mutation | email_delivery | 2 | 87.09 / 89.43 | 1 |
| authority.issue | mobile-throttled | context | route | 2 | 817.34 / 913.22 | — |
| authority.issue | mobile-throttled | context | auth | 2 | 111.37 / 115.86 | 1 |
| authority.issue | mobile-throttled | context | db_read | 2 | 1216.27 / 1310.31 | 9 |
| authority.issue | mobile-throttled | context | db_mutation | 2 | 125.87 / 141.31 | 1 |
| exchange.record | mobile-throttled | mutation | route | 2 | 514.15 / 515.75 | — |
| exchange.record | mobile-throttled | mutation | auth | 2 | 124.46 / 131.39 | 1 |
| exchange.record | mobile-throttled | mutation | db_read | 2 | 246.91 / 255.01 | 2 |
| exchange.record | mobile-throttled | mutation | body_read | 2 | 0.16 / 0.17 | 1 |
| exchange.record | mobile-throttled | mutation | json_parse | 2 | 0.03 / 0.03 | 1 |
| exchange.record | mobile-throttled | mutation | db_mutation | 2 | 139.47 / 141.75 | 1 |
| exchange.record | mobile-throttled | context | route | 2 | 902.46 / 906.27 | — |
| exchange.record | mobile-throttled | context | auth | 2 | 110.56 / 112.66 | 1 |
| exchange.record | mobile-throttled | context | db_read | 2 | 1286.68 / 1288.99 | 9 |
| exchange.record | mobile-throttled | context | db_mutation | 2 | 114.60 / 116.57 | 1 |
| notice.authority_issue | mobile-throttled | mutation | route | 2 | 806.41 / 829.41 | — |
| notice.authority_issue | mobile-throttled | mutation | auth | 2 | 112.36 / 112.98 | 1 |
| notice.authority_issue | mobile-throttled | mutation | db_read | 2 | 231.64 / 238.75 | 2 |
| notice.authority_issue | mobile-throttled | mutation | body_read | 2 | 0.16 / 0.19 | 1 |
| notice.authority_issue | mobile-throttled | mutation | json_parse | 2 | 0.01 / 0.02 | 1 |
| notice.authority_issue | mobile-throttled | mutation | db_mutation | 2 | 375.59 / 387.62 | 3 |
| notice.authority_issue | mobile-throttled | mutation | email_delivery | 2 | 78.97 / 83.95 | 1 |
| notice.authority_issue | mobile-throttled | context | route | 2 | 835.97 / 887.83 | — |
| notice.authority_issue | mobile-throttled | context | auth | 2 | 125.77 / 141.34 | 1 |
| notice.authority_issue | mobile-throttled | context | db_read | 2 | 1206.39 / 1311.82 | 9 |
| notice.authority_issue | mobile-throttled | context | db_mutation | 2 | 122.59 / 126.12 | 1 |
| notice.arrangements_confirm | mobile-throttled | mutation | route | 2 | 1272.97 / 1434.71 | — |
| notice.arrangements_confirm | mobile-throttled | mutation | auth | 2 | 224.85 / 315.85 | 1 |
| notice.arrangements_confirm | mobile-throttled | mutation | db_read | 2 | 439.42 / 457.68 | 2 |
| notice.arrangements_confirm | mobile-throttled | mutation | multipart_parse | 2 | 1.51 / 2.19 | 1 |
| notice.arrangements_confirm | mobile-throttled | mutation | file_prepare | 2 | 0.14 / 0.25 | 1 |
| notice.arrangements_confirm | mobile-throttled | mutation | storage_upload | 2 | 372.86 / 377.81 | 1 |
| notice.arrangements_confirm | mobile-throttled | mutation | db_mutation | 2 | 229.89 / 322.60 | 1 |
| notice.arrangements_confirm | mobile-throttled | context | route | 2 | 971.26 / 1147.27 | — |
| notice.arrangements_confirm | mobile-throttled | context | auth | 2 | 123.31 / 123.94 | 1 |
| notice.arrangements_confirm | mobile-throttled | context | db_read | 2 | 1384.33 / 1534.26 | 9 |
| notice.arrangements_confirm | mobile-throttled | context | db_mutation | 2 | 122.31 / 126.10 | 1 |
| completion.documents_upload.one-1MiB | mobile-throttled | prepare | route | 2 | 996.31 / 1079.21 | — |
| completion.documents_upload.one-1MiB | mobile-throttled | prepare | auth | 2 | 137.68 / 142.96 | 1 |
| completion.documents_upload.one-1MiB | mobile-throttled | prepare | db_read | 2 | 126.30 / 133.38 | 1 |
| completion.documents_upload.one-1MiB | mobile-throttled | prepare | body_read | 2 | 0.11 / 0.11 | 1 |
| completion.documents_upload.one-1MiB | mobile-throttled | prepare | json_parse | 2 | 0.03 / 0.03 | 1 |
| completion.documents_upload.one-1MiB | mobile-throttled | prepare | db_rpc | 2 | 235.29 / 324.55 | 1 |
| completion.documents_upload.one-1MiB | mobile-throttled | prepare | storage_read | 2 | 258.44 / 351.63 | 1 |
| completion.documents_upload.one-1MiB | mobile-throttled | prepare | storage_upload | 2 | 233.14 / 331.96 | 1 |
| completion.documents_upload.one-1MiB | mobile-throttled | prepare | upload_prepare | 2 | 730.79 / 815.48 | 1 |
| completion.documents_upload.one-1MiB | mobile-throttled | finalize | route | 2 | 2947.20 / 2961.14 | — |
| completion.documents_upload.one-1MiB | mobile-throttled | finalize | auth | 2 | 146.04 / 155.11 | 1 |
| completion.documents_upload.one-1MiB | mobile-throttled | finalize | db_read | 2 | 125.95 / 136.56 | 1 |
| completion.documents_upload.one-1MiB | mobile-throttled | finalize | body_read | 2 | 0.13 / 0.14 | 1 |
| completion.documents_upload.one-1MiB | mobile-throttled | finalize | json_parse | 2 | 0.01 / 0.02 | 1 |
| completion.documents_upload.one-1MiB | mobile-throttled | finalize | db_rpc | 2 | 376.98 / 480.45 | 2 |
| completion.documents_upload.one-1MiB | mobile-throttled | finalize | storage_read | 2 | 1913.97 / 2058.15 | 4 |
| completion.documents_upload.one-1MiB | mobile-throttled | finalize | storage_verify | 2 | 1917.18 / 2061.84 | 2 |
| completion.documents_upload.one-1MiB | mobile-throttled | finalize | storage_upload | 2 | 377.10 / 385.13 | 1 |
| completion.documents_upload.one-1MiB | mobile-throttled | finalize | finalization | 2 | 2673.64 / 2707.25 | 1 |
| completion.documents_upload.one-1MiB | mobile-throttled | context | route | 2 | 872.44 / 935.11 | — |
| completion.documents_upload.one-1MiB | mobile-throttled | context | auth | 2 | 117.41 / 118.80 | 1 |
| completion.documents_upload.one-1MiB | mobile-throttled | context | db_read | 2 | 1364.95 / 1430.40 | 9 |
| completion.documents_upload.one-1MiB | mobile-throttled | context | db_mutation | 2 | 115.69 / 118.33 | 1 |
| completion.documents_upload.two-1MiB | mobile-throttled | prepare | route | 2 | 1058.43 / 1098.90 | — |
| completion.documents_upload.two-1MiB | mobile-throttled | prepare | auth | 2 | 131.30 / 137.23 | 1 |
| completion.documents_upload.two-1MiB | mobile-throttled | prepare | db_read | 2 | 120.27 / 121.35 | 1 |
| completion.documents_upload.two-1MiB | mobile-throttled | prepare | body_read | 2 | 0.12 / 0.13 | 1 |
| completion.documents_upload.two-1MiB | mobile-throttled | prepare | json_parse | 2 | 0.03 / 0.04 | 1 |
| completion.documents_upload.two-1MiB | mobile-throttled | prepare | db_rpc | 2 | 154.69 / 176.76 | 1 |
| completion.documents_upload.two-1MiB | mobile-throttled | prepare | storage_read | 2 | 659.53 / 672.99 | 2 |
| completion.documents_upload.two-1MiB | mobile-throttled | prepare | storage_upload | 2 | 372.20 / 449.74 | 2 |
| completion.documents_upload.two-1MiB | mobile-throttled | prepare | upload_prepare | 2 | 804.91 / 837.93 | 1 |
| completion.documents_upload.two-1MiB | mobile-throttled | finalize | route | 2 | 5418.65 / 5445.04 | — |
| completion.documents_upload.two-1MiB | mobile-throttled | finalize | auth | 2 | 233.21 / 323.71 | 1 |
| completion.documents_upload.two-1MiB | mobile-throttled | finalize | db_read | 2 | 128.10 / 132.41 | 1 |
| completion.documents_upload.two-1MiB | mobile-throttled | finalize | body_read | 2 | 0.10 / 0.10 | 1 |
| completion.documents_upload.two-1MiB | mobile-throttled | finalize | json_parse | 2 | 0.01 / 0.01 | 1 |
| completion.documents_upload.two-1MiB | mobile-throttled | finalize | db_rpc | 2 | 303.18 / 310.83 | 2 |
| completion.documents_upload.two-1MiB | mobile-throttled | finalize | storage_read | 2 | 4217.22 / 4253.05 | 8 |
| completion.documents_upload.two-1MiB | mobile-throttled | finalize | storage_verify | 2 | 4221.01 / 4256.94 | 4 |
| completion.documents_upload.two-1MiB | mobile-throttled | finalize | storage_upload | 2 | 526.85 / 602.11 | 2 |
| completion.documents_upload.two-1MiB | mobile-throttled | finalize | finalization | 2 | 5055.85 / 5176.99 | 1 |
| completion.documents_upload.two-1MiB | mobile-throttled | context | route | 2 | 913.12 / 923.99 | — |
| completion.documents_upload.two-1MiB | mobile-throttled | context | auth | 2 | 122.57 / 125.45 | 1 |
| completion.documents_upload.two-1MiB | mobile-throttled | context | db_read | 2 | 1636.26 / 1643.40 | 9 |
| completion.documents_upload.two-1MiB | mobile-throttled | context | db_mutation | 2 | 137.32 / 138.36 | 1 |
| completion.documents_upload.two-5MiB | mobile-throttled | prepare | route | 2 | 1225.49 / 1411.15 | — |
| completion.documents_upload.two-5MiB | mobile-throttled | prepare | auth | 2 | 116.97 / 125.54 | 1 |
| completion.documents_upload.two-5MiB | mobile-throttled | prepare | db_read | 2 | 132.28 / 139.81 | 1 |
| completion.documents_upload.two-5MiB | mobile-throttled | prepare | body_read | 2 | 0.11 / 0.12 | 1 |
| completion.documents_upload.two-5MiB | mobile-throttled | prepare | json_parse | 2 | 0.01 / 0.01 | 1 |
| completion.documents_upload.two-5MiB | mobile-throttled | prepare | db_rpc | 2 | 335.16 / 338.76 | 1 |
| completion.documents_upload.two-5MiB | mobile-throttled | prepare | storage_read | 2 | 618.49 / 796.35 | 2 |
| completion.documents_upload.two-5MiB | mobile-throttled | prepare | storage_upload | 2 | 468.72 / 491.77 | 2 |
| completion.documents_upload.two-5MiB | mobile-throttled | prepare | upload_prepare | 2 | 974.75 / 1159.40 | 1 |
| completion.documents_upload.two-5MiB | mobile-throttled | finalize | route | 2 | 5865.12 / 6161.52 | — |
| completion.documents_upload.two-5MiB | mobile-throttled | finalize | auth | 2 | 285.23 / 323.88 | 1 |
| completion.documents_upload.two-5MiB | mobile-throttled | finalize | db_read | 2 | 143.22 / 149.62 | 1 |
| completion.documents_upload.two-5MiB | mobile-throttled | finalize | body_read | 2 | 0.12 / 0.14 | 1 |
| completion.documents_upload.two-5MiB | mobile-throttled | finalize | json_parse | 2 | 0.01 / 0.01 | 1 |
| completion.documents_upload.two-5MiB | mobile-throttled | finalize | db_rpc | 2 | 427.94 / 514.44 | 2 |
| completion.documents_upload.two-5MiB | mobile-throttled | finalize | storage_read | 2 | 4289.71 / 4535.67 | 8 |
| completion.documents_upload.two-5MiB | mobile-throttled | finalize | storage_verify | 2 | 4295.40 / 4543.32 | 4 |
| completion.documents_upload.two-5MiB | mobile-throttled | finalize | storage_upload | 2 | 708.69 / 713.84 | 2 |
| completion.documents_upload.two-5MiB | mobile-throttled | finalize | finalization | 2 | 5435.21 / 5763.89 | 1 |
| completion.documents_upload.two-5MiB | mobile-throttled | context | route | 2 | 1202.32 / 1432.83 | — |
| completion.documents_upload.two-5MiB | mobile-throttled | context | auth | 2 | 120.90 / 126.29 | 1 |
| completion.documents_upload.two-5MiB | mobile-throttled | context | db_read | 2 | 1962.11 / 2231.18 | 9 |
| completion.documents_upload.two-5MiB | mobile-throttled | context | db_mutation | 2 | 145.88 / 147.01 | 1 |
| completion.documents_upload.two-near-10MiB | mobile-throttled | prepare | route | 2 | 1143.57 / 1306.09 | — |
| completion.documents_upload.two-near-10MiB | mobile-throttled | prepare | auth | 2 | 141.59 / 143.95 | 1 |
| completion.documents_upload.two-near-10MiB | mobile-throttled | prepare | db_read | 2 | 211.92 / 306.47 | 1 |
| completion.documents_upload.two-near-10MiB | mobile-throttled | prepare | body_read | 2 | 0.11 / 0.11 | 1 |
| completion.documents_upload.two-near-10MiB | mobile-throttled | prepare | json_parse | 2 | 0.02 / 0.03 | 1 |
| completion.documents_upload.two-near-10MiB | mobile-throttled | prepare | db_rpc | 2 | 168.04 / 170.39 | 1 |
| completion.documents_upload.two-near-10MiB | mobile-throttled | prepare | storage_read | 2 | 662.14 / 669.22 | 2 |
| completion.documents_upload.two-near-10MiB | mobile-throttled | prepare | storage_upload | 2 | 438.36 / 512.90 | 2 |
| completion.documents_upload.two-near-10MiB | mobile-throttled | prepare | upload_prepare | 2 | 788.13 / 853.50 | 1 |
| completion.documents_upload.two-near-10MiB | mobile-throttled | finalize | route | 2 | 6719.60 / 6937.35 | — |
| completion.documents_upload.two-near-10MiB | mobile-throttled | finalize | auth | 2 | 279.52 / 299.35 | 1 |
| completion.documents_upload.two-near-10MiB | mobile-throttled | finalize | db_read | 2 | 162.57 / 184.61 | 1 |
| completion.documents_upload.two-near-10MiB | mobile-throttled | finalize | body_read | 2 | 0.13 / 0.15 | 1 |
| completion.documents_upload.two-near-10MiB | mobile-throttled | finalize | json_parse | 2 | 0.01 / 0.01 | 1 |
| completion.documents_upload.two-near-10MiB | mobile-throttled | finalize | db_rpc | 2 | 555.91 / 791.51 | 2 |
| completion.documents_upload.two-near-10MiB | mobile-throttled | finalize | storage_read | 2 | 4563.90 / 4664.44 | 8 |
| completion.documents_upload.two-near-10MiB | mobile-throttled | finalize | storage_verify | 2 | 4568.74 / 4669.68 | 4 |
| completion.documents_upload.two-near-10MiB | mobile-throttled | finalize | storage_upload | 2 | 1147.86 / 1189.62 | 2 |
| completion.documents_upload.two-near-10MiB | mobile-throttled | finalize | finalization | 2 | 6275.34 / 6451.53 | 1 |
| completion.documents_upload.two-near-10MiB | mobile-throttled | context | route | 2 | 1564.14 / 1879.48 | — |
| completion.documents_upload.two-near-10MiB | mobile-throttled | context | auth | 2 | 214.29 / 317.48 | 1 |
| completion.documents_upload.two-near-10MiB | mobile-throttled | context | db_read | 2 | 2144.47 / 2264.59 | 9 |
| completion.documents_upload.two-near-10MiB | mobile-throttled | context | db_mutation | 2 | 232.12 / 324.89 | 1 |
| completion.documents_approve | mobile-throttled | mutation | route | 2 | 897.79 / 1072.20 | — |
| completion.documents_approve | mobile-throttled | mutation | auth | 2 | 209.60 / 299.44 | 1 |
| completion.documents_approve | mobile-throttled | mutation | db_read | 2 | 443.79 / 446.86 | 2 |
| completion.documents_approve | mobile-throttled | mutation | body_read | 2 | 0.23 / 0.35 | 1 |
| completion.documents_approve | mobile-throttled | mutation | json_parse | 2 | 0.04 / 0.05 | 1 |
| completion.documents_approve | mobile-throttled | mutation | db_mutation | 2 | 239.51 / 328.52 | 1 |
| completion.documents_approve | mobile-throttled | context | route | 2 | 1049.84 / 1150.55 | — |
| completion.documents_approve | mobile-throttled | context | auth | 2 | 129.15 / 143.10 | 1 |
| completion.documents_approve | mobile-throttled | context | db_read | 2 | 1513.28 / 1686.04 | 9 |
| completion.documents_approve | mobile-throttled | context | db_mutation | 2 | 118.66 / 124.51 | 1 |
| completion.record | mobile-throttled | mutation | route | 2 | 699.69 / 908.39 | — |
| completion.record | mobile-throttled | mutation | auth | 2 | 214.96 / 318.00 | 1 |
| completion.record | mobile-throttled | mutation | db_read | 2 | 344.27 / 449.19 | 2 |
| completion.record | mobile-throttled | mutation | body_read | 2 | 0.12 / 0.13 | 1 |
| completion.record | mobile-throttled | mutation | json_parse | 2 | 0.01 / 0.02 | 1 |
| completion.record | mobile-throttled | mutation | db_mutation | 2 | 136.78 / 137.73 | 1 |
| completion.record | mobile-throttled | context | route | 2 | 1119.74 / 1497.44 | — |
| completion.record | mobile-throttled | context | auth | 2 | 208.53 / 300.42 | 1 |
| completion.record | mobile-throttled | context | db_read | 2 | 1443.74 / 1681.13 | 9 |
| completion.record | mobile-throttled | context | db_mutation | 2 | 214.76 / 309.47 | 1 |
