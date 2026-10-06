# Controlled staging function region A/B

Times are complete browser elapsed seconds, median [p25–p75]; min–max separately. Counts include settlement.

| Profile | Action | n per region | iad1 median [IQR] | fra1 median [IQR] | iad1 min–max | fra1 min–max | Paired fra1−iad1 median | Requests iad1 / fra1 |
|---|---|---:|---:|---:|---:|---:|---:|---|
| desktop | navigation.cold | 8 / 8 | 2.125 [2.095–2.141] | 2.138 [2.132–2.311] | 2.093–2.172 | 2.114–2.689 | 0.044 | 54–54 / 54–54 |
| desktop | navigation.repeat | 8 / 8 | 1.939 [1.927–1.949] | 1.937 [1.917–1.940] | 1.913–1.977 | 1.911–1.956 | -0.000 | 54–54 / 54–54 |
| desktop | exchange.entry | 8 / 8 | 1.894 [1.397–2.029] | 0.867 [0.856–0.880] | 1.373–2.404 | 0.845–0.887 | -1.026 | 1–1 / 1–1 |
| desktop | legal.context_get | 8 / 8 | 1.487 [1.383–1.726] | 0.318 [0.304–0.397] | 1.153–1.962 | 0.289–0.469 | -1.135 | 1–1 / 1–1 |
| desktop | completion.entry | 8 / 8 | 0.051 [0.044–0.053] | 0.053 [0.048–0.055] | 0.042–0.055 | 0.045–0.056 | 0.002 | 0–0 / 0–0 |
| desktop | authority.preview | 8 / 8 | 1.354 [0.866–1.368] | 0.252 [0.244–0.345] | 0.851–1.403 | 0.232–0.351 | -1.021 | 1–1 / 1–1 |
| mobile-throttled | navigation.cold | 8 / 8 | 6.921 [6.909–6.931] | 6.923 [6.912–6.932] | 6.894–7.440 | 6.889–7.428 | -0.001 | 54–54 / 54–54 |
| mobile-throttled | navigation.repeat | 8 / 8 | 3.791 [3.784–3.800] | 3.794 [3.776–3.813] | 3.766–3.834 | 3.752–3.842 | -0.005 | 54–54 / 54–54 |
| mobile-throttled | exchange.entry | 8 / 8 | 1.935 [1.927–1.950] | 0.906 [0.900–0.909] | 1.471–2.423 | 0.896–0.922 | -1.025 | 1–1 / 1–1 |
| mobile-throttled | legal.context_get | 8 / 8 | 1.460 [1.188–1.726] | 0.363 [0.351–0.380] | 0.967–1.775 | 0.315–0.488 | -1.055 | 1–1 / 1–1 |
| mobile-throttled | completion.entry | 8 / 8 | 0.087 [0.083–0.090] | 0.091 [0.088–0.103] | 0.077–0.128 | 0.084–0.111 | 0.003 | 0–0 / 0–0 |
| mobile-throttled | authority.preview | 8 / 8 | 0.907 [0.887–1.056] | 0.397 [0.368–0.426] | 0.875–1.411 | 0.316–0.454 | -0.524 | 1–1 / 1–1 |

Navigation last actual non-poll/non-telemetry request completion excludes the artificial 1.5 second quiet grace and can precede readiness when browser rendering continues. Summary derives this from raw request end offsets; the recorder’s `lastRequestEndMs` field is the maximum of readiness and last completion.

| Profile | Action | iad1 last network completion median | fra1 last network completion median |
|---|---|---:|---:|
| desktop | navigation.cold | 1.937 | 2.045 |
| desktop | navigation.repeat | 1.555 | 1.582 |
| mobile-throttled | navigation.cold | 6.803 | 6.794 |
| mobile-throttled | navigation.repeat | 3.544 | 3.564 |

Function request timing (milliseconds, median [p25–p75]). `TTFB−route` is an infrastructure/network residual, not a pure RTT. Remote spans overlap; do not sum parent and child spans.

| Region | Profile | Action | Endpoint/method | n | Browser request | route | auth | db_read | db_mutation | TTFB−route | Verified |
|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| iad1 | desktop | navigation.cold | /api/auth/activity POST | 8 | 905.6 [785.3–1016.2] | — | — | — | — | — | 8/8 |
| iad1 | desktop | navigation.repeat | /api/auth/activity POST | 8 | 785.5 [736.3–844.1] | — | — | — | — | — | 8/8 |
| iad1 | desktop | exchange.entry | /api/sales/legal GET | 8 | 1524.6 [1243.0–1771.9] | 1364.6 [1122.9–1642.0] | 144.7 [123.8–315.1] | 2269.0 [2048.0–2354.3] | 216.2 [122.5–330.8] | 119.1 [117.8–125.1] | 8/8 |
| iad1 | desktop | legal.context_get | /api/sales/legal GET | 8 | 1476.0 [1365.1–1718.8] | 1347.1 [1142.3–1543.6] | 306.1 [156.9–311.6] | 2292.2 [2093.2–2316.2] | 120.5 [118.4–127.5] | 146.1 [131.3–194.2] | 8/8 |
| iad1 | desktop | authority.preview | /api/sales/legal POST | 8 | 926.0 [704.5–944.9] | 759.0 [508.7–798.2] | 290.2 [140.4–312.7] | 437.9 [255.4–456.9] | — | 169.1 [125.7–192.3] | 8/8 |
| iad1 | mobile-throttled | navigation.cold | /api/auth/activity POST | 8 | 991.9 [847.9–1156.6] | — | — | — | — | — | 8/8 |
| iad1 | mobile-throttled | navigation.repeat | /api/auth/activity POST | 8 | 818.6 [765.3–935.5] | — | — | — | — | — | 8/8 |
| iad1 | mobile-throttled | exchange.entry | /api/sales/legal GET | 8 | 1579.3 [1427.0–1811.6] | 1397.4 [1280.5–1648.7] | 233.7 [140.6–346.8] | 1928.4 [1886.6–2071.1] | 242.7 [134.9–321.0] | 139.1 [130.6–155.4] | 8/8 |
| iad1 | mobile-throttled | legal.context_get | /api/sales/legal GET | 8 | 1446.9 [1169.1–1710.3] | 1249.0 [997.5–1522.5] | 125.9 [116.0–297.5] | 1810.8 [1641.7–1846.3] | 218.2 [123.1–304.2] | 139.9 [131.4–178.1] | 8/8 |
| iad1 | mobile-throttled | authority.preview | /api/sales/legal POST | 8 | 759.0 [688.3–800.8] | 569.3 [509.9–610.4] | 134.1 [116.0–305.6] | 268.2 [260.7–438.8] | — | 158.0 [144.4–185.1] | 8/8 |
| fra1 | desktop | navigation.cold | /api/auth/activity POST | 8 | 939.6 [793.4–1009.9] | — | — | — | — | — | 8/8 |
| fra1 | desktop | navigation.repeat | /api/auth/activity POST | 8 | 916.8 [834.5–939.7] | — | — | — | — | — | 8/8 |
| fra1 | desktop | exchange.entry | /api/sales/legal GET | 8 | 500.2 [466.0–507.6] | 406.7 [384.2–435.2] | 88.4 [78.0–98.8] | 599.5 [557.1–681.0] | 44.1 [36.2–57.9] | 62.6 [58.3–88.5] | 8/8 |
| fra1 | desktop | legal.context_get | /api/sales/legal GET | 8 | 306.4 [291.0–379.1] | 246.2 [223.7–305.3] | 28.7 [21.9–33.7] | 418.8 [378.7–505.7] | 38.9 [33.3–42.7] | 67.8 [57.9–71.7] | 8/8 |
| fra1 | desktop | authority.preview | /api/sales/legal POST | 8 | 184.9 [172.2–209.6] | 126.1 [110.9–149.2] | 34.9 [31.2–39.8] | 82.7 [72.8–88.9] | — | 59.9 [55.9–65.2] | 8/8 |
| fra1 | mobile-throttled | navigation.cold | /api/auth/activity POST | 8 | 984.8 [935.4–1074.6] | — | — | — | — | — | 8/8 |
| fra1 | mobile-throttled | navigation.repeat | /api/auth/activity POST | 8 | 1011.4 [947.9–1038.4] | — | — | — | — | — | 8/8 |
| fra1 | mobile-throttled | exchange.entry | /api/sales/legal GET | 8 | 500.8 [458.5–539.1] | 398.6 [345.8–431.3] | 89.5 [80.2–121.1] | 583.9 [551.1–616.0] | 43.1 [39.7–49.1] | 80.9 [78.7–89.8] | 8/8 |
| fra1 | mobile-throttled | legal.context_get | /api/sales/legal GET | 8 | 342.5 [332.8–362.1] | 236.6 [231.2–257.2] | 31.9 [24.9–38.1] | 392.9 [366.6–435.0] | 38.7 [34.1–41.7] | 74.6 [70.5–82.1] | 8/8 |
| fra1 | mobile-throttled | authority.preview | /api/sales/legal POST | 8 | 219.4 [209.2–227.9] | 112.8 [108.7–128.6] | 39.1 [33.4–41.8] | 69.5 [62.9–91.8] | — | 85.5 [80.1–93.9] | 8/8 |

Samples: 192. HTTP/browser request failures: 0. Browser-to-Supabase Storage requests: 0. Function region matched: 160/160.
