# Controlled staging function region A/B

Times are complete browser elapsed seconds, median [p25–p75]; min–max separately. Counts include settlement.

| Profile | Action | n per region | iad1 median [IQR] | fra1 median [IQR] | iad1 min–max | fra1 min–max | Paired fra1−iad1 median | Requests iad1 / fra1 |
|---|---|---:|---:|---:|---:|---:|---:|---|
| desktop | navigation.cold | 8 / 8 | 2.121 [2.096–2.739] | 4.458 [3.512–4.729] | 2.086–3.549 | 3.271–6.424 | 1.551 | 54–54 / 54–54 |
| desktop | navigation.repeat | 8 / 8 | 1.902 [1.878–1.907] | 2.517 [2.386–2.544] | 1.874–2.478 | 1.960–3.022 | 0.592 | 54–54 / 54–54 |
| desktop | exchange.entry | 8 / 8 | 1.896 [1.885–2.394] | 0.865 [0.859–0.874] | 1.381–2.420 | 0.859–0.886 | -1.024 | 1–1 / 1–1 |
| desktop | legal.context_get | 8 / 8 | 1.658 [1.383–1.828] | 0.424 [0.411–0.445] | 1.111–2.020 | 0.316–0.472 | -1.214 | 1–1 / 1–1 |
| desktop | completion.entry | 8 / 8 | 0.045 [0.041–0.049] | 0.051 [0.046–0.054] | 0.041–0.054 | 0.043–0.057 | 0.006 | 0–0 / 0–0 |
| desktop | authority.preview | 8 / 8 | 0.854 [0.848–0.977] | 0.350 [0.342–0.359] | 0.838–1.366 | 0.329–0.849 | -0.502 | 1–1 / 1–1 |
| mobile-throttled | navigation.cold | 8 / 8 | 6.846 [6.820–6.866] | 6.845 [6.812–7.329] | 6.795–7.340 | 6.800–7.362 | 0.006 | 54–54 / 54–54 |
| mobile-throttled | navigation.repeat | 8 / 8 | 3.772 [3.739–3.779] | 3.777 [3.772–3.782] | 3.726–3.791 | 3.758–4.233 | 0.021 | 54–54 / 54–54 |
| mobile-throttled | exchange.entry | 8 / 8 | 2.166 [1.919–2.412] | 0.895 [0.887–0.902] | 1.912–2.438 | 0.876–0.905 | -1.268 | 1–1 / 1–1 |
| mobile-throttled | legal.context_get | 8 / 8 | 1.552 [1.388–1.728] | 0.364 [0.352–0.389] | 1.199–1.801 | 0.320–0.477 | -1.188 | 1–1 / 1–1 |
| mobile-throttled | completion.entry | 8 / 8 | 0.086 [0.082–0.091] | 0.085 [0.083–0.089] | 0.078–0.093 | 0.078–0.090 | -0.000 | 0–0 / 0–0 |
| mobile-throttled | authority.preview | 8 / 8 | 0.906 [0.891–1.058] | 0.370 [0.341–0.418] | 0.866–1.405 | 0.324–0.442 | -0.565 | 1–1 / 1–1 |

Navigation last actual non-poll/non-telemetry request completion excludes the artificial 1.5 second quiet grace and can precede readiness when browser rendering continues. Summary derives this from raw request end offsets; the recorder’s `lastRequestEndMs` field is the maximum of readiness and last completion.

| Profile | Action | iad1 last network completion median | fra1 last network completion median |
|---|---|---:|---:|
| desktop | navigation.cold | 1.967 | 4.157 |
| desktop | navigation.repeat | 1.601 | 2.130 |
| mobile-throttled | navigation.cold | 6.762 | 6.739 |
| mobile-throttled | navigation.repeat | 3.473 | 3.457 |

Function request timing (milliseconds, median [p25–p75]). `TTFB−route` is an infrastructure/network residual, not a pure RTT. Remote spans overlap; do not sum parent and child spans.

| Region | Profile | Action | Endpoint/method | n | Browser request | route | auth | db_read | db_mutation | TTFB−route | Verified |
|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| iad1 | desktop | navigation.cold | /api/auth/activity POST | 8 | 952.4 [777.3–979.9] | — | — | — | — | — | 8/8 |
| iad1 | desktop | navigation.repeat | /api/auth/activity POST | 8 | 1006.7 [917.1–1072.5] | — | — | — | — | — | 8/8 |
| iad1 | desktop | exchange.entry | /api/sales/legal GET | 8 | 1665.9 [1556.8–1917.5] | 1523.3 [1346.8–1783.6] | 132.8 [123.6–207.5] | 2443.5 [2165.9–2687.0] | 313.2 [259.2–336.3] | 131.8 [126.3–152.4] | 8/8 |
| iad1 | desktop | legal.context_get | /api/sales/legal GET | 8 | 1649.3 [1374.2–1807.3] | 1449.8 [1252.1–1596.4] | 235.4 [149.4–318.2] | 2050.4 [1734.2–2315.2] | 318.0 [142.0–325.0] | 158.1 [118.3–195.2] | 8/8 |
| iad1 | desktop | authority.preview | /api/sales/legal POST | 8 | 711.0 [658.4–745.2] | 577.6 [517.2–590.5] | 125.3 [118.1–131.6] | 446.1 [391.3–459.6] | — | 121.4 [116.7–142.6] | 8/8 |
| iad1 | mobile-throttled | navigation.cold | /api/auth/activity POST | 8 | 851.0 [831.7–914.5] | — | — | — | — | — | 8/8 |
| iad1 | mobile-throttled | navigation.repeat | /api/auth/activity POST | 8 | 810.9 [727.9–1075.1] | — | — | — | — | — | 8/8 |
| iad1 | mobile-throttled | exchange.entry | /api/sales/legal GET | 8 | 1860.5 [1608.9–1981.9] | 1695.5 [1437.0–1805.7] | 335.3 [272.2–352.1] | 2123.1 [1947.4–2238.6] | 232.4 [134.7–326.9] | 138.5 [133.6–145.9] | 8/8 |
| iad1 | mobile-throttled | legal.context_get | /api/sales/legal GET | 8 | 1535.9 [1368.1–1713.7] | 1321.4 [1194.2–1528.2] | 117.7 [112.4–127.4] | 1878.8 [1720.6–2046.3] | 221.8 [128.3–302.0] | 164.6 [154.7–168.3] | 8/8 |
| iad1 | mobile-throttled | authority.preview | /api/sales/legal POST | 8 | 773.6 [572.3–807.7] | 573.8 [394.7–632.3] | 132.0 [119.7–209.6] | 372.8 [265.3–475.6] | — | 155.5 [143.7–168.6] | 8/8 |
| fra1 | desktop | navigation.cold | /api/auth/activity POST | 8 | 311.1 [260.4–374.1] | — | — | — | — | — | 8/8 |
| fra1 | desktop | navigation.repeat | /api/auth/activity POST | 8 | 366.0 [325.6–402.6] | — | — | — | — | — | 8/8 |
| fra1 | desktop | exchange.entry | /api/sales/legal GET | 8 | 433.8 [422.7–461.1] | 310.1 [289.0–342.0] | 43.5 [33.2–46.4] | 568.2 [556.4–650.5] | 31.9 [30.1–34.5] | 137.7 [101.7–144.3] | 8/8 |
| fra1 | desktop | legal.context_get | /api/sales/legal GET | 8 | 417.1 [395.6–434.8] | 269.9 [239.5–296.1] | 36.8 [29.0–38.4] | 416.6 [385.4–442.9] | 36.3 [32.6–38.8] | 125.9 [120.8–141.4] | 8/8 |
| fra1 | desktop | authority.preview | /api/sales/legal POST | 8 | 243.2 [226.9–265.7] | 110.4 [107.3–115.0] | 30.0 [22.1–33.5] | 73.5 [69.0–77.4] | — | 130.3 [116.4–138.4] | 8/8 |
| fra1 | mobile-throttled | navigation.cold | /api/auth/activity POST | 8 | 257.0 [233.5–291.1] | — | — | — | — | — | 8/8 |
| fra1 | mobile-throttled | navigation.repeat | /api/auth/activity POST | 8 | 239.9 [222.2–242.4] | — | — | — | — | — | 8/8 |
| fra1 | mobile-throttled | exchange.entry | /api/sales/legal GET | 8 | 418.6 [392.4–452.4] | 329.1 [304.7–370.7] | 58.3 [49.8–70.5] | 556.5 [520.7–637.4] | 31.0 [29.3–35.3] | 73.8 [61.2–78.7] | 8/8 |
| fra1 | mobile-throttled | legal.context_get | /api/sales/legal GET | 8 | 346.7 [332.6–380.6] | 234.2 [227.7–260.7] | 32.1 [21.1–44.0] | 366.9 [346.3–431.6] | 28.1 [24.8–31.7] | 79.1 [69.2–100.2] | 8/8 |
| fra1 | mobile-throttled | authority.preview | /api/sales/legal POST | 8 | 215.7 [201.4–237.2] | 112.5 [99.3–119.7] | 37.1 [36.5–43.1] | 61.9 [60.5–68.7] | — | 88.9 [81.9–96.4] | 8/8 |

Samples: 192. HTTP/browser request failures: 0. Browser-to-Supabase Storage requests: 0. Function region matched: 160/160.
