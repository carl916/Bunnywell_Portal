# Sales loading comparison — 5 October 2026

Five samples per build/profile/action. Readiness is browser wall time to complete Sales controls and the correct unit heading, plus two animation frames. min–max and median absolute deviation (MAD) show variability. Browser polling contributes to the publication-to-ready interval.

| Profile | Journey | Before median (range), MAD | After median (range), MAD | Paired delta median | Instrumented requests | All requests |
|---|---|---|---|---|---|---|
| desktop | navigation.cold | 2.06 s (2.04–2.09), 20 ms | 2.07 s (2.06–2.10), 5 ms | 2 ms | 35 → 35 | 54 → 54 |
| desktop | navigation.repeat | 1.94 s (1.91–1.98), 19 ms | 1.92 s (1.44–1.95), 17 ms | -33 ms | 35 → 35 | 54 → 54 |
| desktop | sales.entry | 1.83 s (1.35–1.84), 4 ms | 1.34 s (1.33–1.85), 6 ms | -12 ms | 10 → 10 | 12 → 12 |
| desktop | exchange.entry | 1.87 s (1.83–2.33), 49 ms | 2.33 s (1.83–2.34), 1 ms | 16 ms | 0 → 0 | 1 → 1 |
| mobile-throttled | navigation.cold | 6.66 s (6.14–6.72), 55 ms | 6.18 s (6.15–6.19), 6 ms | -469 ms | 35 → 35 | 54 → 54 |
| mobile-throttled | navigation.repeat | 3.77 s (3.74–3.80), 8 ms | 3.77 s (3.73–3.81), 18 ms | -1 ms | 35 → 35 | 54 → 54 |
| mobile-throttled | sales.entry | 3.99 s (3.96–4.04), 23 ms | 3.48 s (2.97–3.49), 3 ms | -552 ms | 10 → 10 | 12 → 12 |
| mobile-throttled | exchange.entry | 1.91 s (1.89–2.41), 14 ms | 1.93 s (1.90–2.40), 30 ms | 21 ms | 0 → 0 | 1 → 1 |

Phase medians, milliseconds. Child-read spans overlap versions after the change; do not sum these columns. Pre-Sales includes initial browser load and authorised portal/building context on reload; on Sales entry it is the mount gap. Publication-to-ready includes browser rendering, the independent DOM observer’s polling and two animation frames.

| Profile | Journey | Variant | Pre-Sales | Complete Sales snapshot | Attempts start delay | Attempts read | Related read span | Documents→versions wait | Versions read | Publication→ready | Script / total browser task |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| desktop | navigation.cold | before | 1094 | 770 | 74 | 127 | 308 | 85 | 240 | 198 | 72 / 174 |
| desktop | navigation.cold | after | 1130 | 605 | 0 | 163 | 316 | 1 | 239 | 378 | 73 / 180 |
| desktop | navigation.repeat | before | 839 | 752 | 50 | 140 | 305 | 85 | 246 | 372 | 18 / 103 |
| desktop | navigation.repeat | after | 873 | 591 | 0 | 135 | 309 | 1 | 230 | 423 | 19 / 102 |
| desktop | sales.entry | before | 40 | 1331 | 163 | 361 | 442 | 59 | 405 | 187 | 10 / 133 |
| desktop | sales.entry | after | 43 | 1131 | 1 | 330 | 445 | 1 | 427 | 183 | 9 / 108 |
| mobile-throttled | navigation.cold | before | 4756 | 1398 | 207 | 308 | 492 | 50 | 377 | 408 | 760 / 1311 |
| mobile-throttled | navigation.cold | after | 4737 | 1124 | 1 | 299 | 484 | 3 | 377 | 323 | 773 / 1283 |
| mobile-throttled | navigation.repeat | before | 2154 | 1435 | 178 | 312 | 494 | 51 | 422 | 202 | 71 / 396 |
| mobile-throttled | navigation.repeat | after | 2156 | 1120 | 1 | 290 | 490 | 3 | 391 | 466 | 76 / 403 |
| mobile-throttled | sales.entry | before | 103 | 3534 | 230 | 988 | 1079 | 257 | 1076 | 393 | 44 / 265 |
| mobile-throttled | sales.entry | after | 101 | 3036 | 2 | 889 | 1157 | 3 | 1131 | 254 | 36 / 246 |

Request phase medians (TTFB / body transfer), milliseconds. TTFB combines network, queueing and server processing; it is not a pure database duration. Timings are Playwright request timings; total request elapsed also includes browser/protocol observation overhead.

| Profile | Journey | Resource | Before TTFB / transfer | After TTFB / transfer |
|---|---|---|---|---|
| desktop | navigation.cold | building_sale_defaults | 45 / 25 | 67 / 40 |
| desktop | navigation.cold | unit_sale_attempts | 93 / 34 | 112 / 53 |
| desktop | navigation.cold | unit_sale_documents | 186 / 40 | 171 / 42 |
| desktop | navigation.cold | unit_sale_payment_schedule | 216 / 45 | 195 / 50 |
| desktop | navigation.cold | unit_sale_document_versions | 186 / 49 | 182 / 57 |
| desktop | navigation.repeat | building_sale_defaults | 47 / 1 | 52 / 2 |
| desktop | navigation.repeat | unit_sale_attempts | 95 / 44 | 102 / 40 |
| desktop | navigation.repeat | unit_sale_documents | 166 / 50 | 186 / 35 |
| desktop | navigation.repeat | unit_sale_payment_schedule | 188 / 43 | 211 / 41 |
| desktop | navigation.repeat | unit_sale_document_versions | 181 / 61 | 176 / 56 |
| desktop | sales.entry | building_sale_defaults | 162 / 1 | 151 / 1 |
| desktop | sales.entry | unit_sale_attempts | 195 / 149 | 193 / 138 |
| desktop | sales.entry | unit_sale_documents | 259 / 144 | 263 / 117 |
| desktop | sales.entry | unit_sale_payment_schedule | 320 / 119 | 306 / 154 |
| desktop | sales.entry | unit_sale_document_versions | 273 / 132 | 276 / 152 |
| mobile-throttled | navigation.cold | building_sale_defaults | 171 / 30 | 171 / 28 |
| mobile-throttled | navigation.cold | unit_sale_attempts | 175 / 130 | 180 / 116 |
| mobile-throttled | navigation.cold | unit_sale_documents | 219 / 213 | 217 / 230 |
| mobile-throttled | navigation.cold | unit_sale_payment_schedule | 257 / 238 | 279 / 207 |
| mobile-throttled | navigation.cold | unit_sale_document_versions | 213 / 169 | 212 / 155 |
| mobile-throttled | navigation.repeat | building_sale_defaults | 171 / 2 | 169 / 1 |
| mobile-throttled | navigation.repeat | unit_sale_attempts | 176 / 137 | 174 / 109 |
| mobile-throttled | navigation.repeat | unit_sale_documents | 244 / 207 | 236 / 213 |
| mobile-throttled | navigation.repeat | unit_sale_payment_schedule | 298 / 196 | 282 / 226 |
| mobile-throttled | navigation.repeat | unit_sale_document_versions | 251 / 156 | 219 / 172 |
| mobile-throttled | sales.entry | building_sale_defaults | 227 / 2 | 209 / 1 |
| mobile-throttled | sales.entry | unit_sale_attempts | 323 / 665 | 291 / 594 |
| mobile-throttled | sales.entry | unit_sale_documents | 366 / 490 | 335 / 582 |
| mobile-throttled | sales.entry | unit_sale_payment_schedule | 406 / 679 | 397 / 821 |
| mobile-throttled | sales.entry | unit_sale_document_versions | 300 / 773 | 348 / 782 |

All 80 measured journeys passed: zero application, HTTP or page errors, zero unfinished-request timeouts. 60 observed function invocations ran in iad1, including 20 legal GETs. Rendered progression hashes match for every paired action/profile. All 16 supplementary fixture/profile/build checks passed against independently read contract prices, completed legal status and current document filenames; commercial, financial and completion text hashes match across builds. Completed fixture fingerprints (attempts, units, terms, schedule, invoices, payments, deposits, legal emails/events, documents and versions) are unchanged. Raw business bodies and DOM text are not retained.
