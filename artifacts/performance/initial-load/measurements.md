| Build | Profile | Navigation | n | Controls median / slowest | Last background work median | Requests at controls / settled | Core at controls / settled | Telemetry / polling |
|---|---|---|---:|---:|---:|---|---|---|
| instrumented-before-clean | desktop | cold | 5 | 2.10 / 2.21 s | 2.78 s | 96–112 / 115 | 94–110 / 112 | 0 / 3 |
| instrumented-before-clean | desktop | repeat | 5 | 1.91 / 1.95 s | 2.41 s | 112 / 115 | 110 / 112 | 0 / 3 |
| instrumented-before-clean | mobile-throttled | cold | 5 | 7.84 / 7.86 s | 9.43 s | 97–98 / 115 | 95–96 / 112 | 0 / 3 |
| instrumented-before-clean | mobile-throttled | repeat | 5 | 4.76 / 4.85 s | 6.15 s | 98 / 115 | 96 / 112 | 0 / 3 |
| after-final | desktop | cold | 5 | 2.09 / 2.16 s | 1.88 s | 54 / 54 | 52 / 52 | 0 / 2 |
| after-final | desktop | repeat | 5 | 1.91 / 1.94 s | 1.45 s | 54 / 54 | 52 / 52 | 0 / 2 |
| after-final | mobile-throttled | cold | 5 | 7.32 / 7.38 s | 6.85 s | 54 / 54 | 52 / 52 | 0 / 2 |
| after-final | mobile-throttled | repeat | 5 | 3.75 / 3.79 s | 3.42 s | 54 / 54 | 52 / 52 | 0 / 2 |

Core excludes Web Vitals and discussion polling. Background work ends at the last observed non-poll/non-telemetry request completion; the recording continues for 1.5 seconds of quiet. Readiness matches the October baseline: the completed sale’s Completion navigation control is visible, plus two animation frames. It does not force a function cold start.
