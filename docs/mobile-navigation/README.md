# Mobile navigation verification

Branch: `codex/mobile-scroll-navigation`, based on staging `0dc4c6a`.

The shared mobile header becomes a 60px strip (61px including its border) after scrolling beyond the larger of 128px or the expanded header height plus 24px. The full header returns within 24px of the top. The bottom bar hides after 48px of downward travel and returns after 12px upward. Its complete background, shadow and safe-area offset slide away in 160ms; reduced motion disables the transition.

The full header's original document position scrolls above the viewport. No replacement spacer, scroll compensation or content relocation is used when switching header states. One passive document-scroll listener samples once per animation frame, with no per-pixel React updates or layout measurement. ResizeObserver maintains header, bottom clearance and sticky-action offsets. End-of-document clearance stays stable to avoid bottom-scroll clamping when the bar changes visibility.

The existing menu content and visual design now use a modal dialog, explicit Tab wrapping and a body scroll lock. Menu scroll is isolated; Escape, backdrop and Close dismiss it; the originating control is revealed when necessary and focused without scrolling. Refresh/session removal also releases the lock. Existing destinations, role permissions and active styles remain in the shared shell. Approved pipeline/results components and styles are unchanged, as is desktop navigation.

## Screenshots

All screenshots use the repository's synthetic sales fixture; no live data is shown.

| Width | Expanded at top | Downward scroll | Short upward scroll |
| --- | --- | --- | --- |
| 320 | [Expanded](320-expanded.png) | [Compact + hidden bar](320-down.png) | [Compact + visible bar](320-up.png) |
| 360 | [Expanded](360-expanded.png) | [Compact + hidden bar](360-down.png) | [Compact + visible bar](360-up.png) |
| 390 | [Expanded](390-expanded.png) | [Compact + hidden bar](390-down.png) | [Compact + visible bar](390-up.png) |
| 430 | [Expanded](430-expanded.png) | [Compact + hidden bar](430-down.png) | [Compact + visible bar](430-up.png) |

Additional evidence: [menu](390-menu.png), [320px with 200% root text and a long building name](320-enlarged-text.png), [1440px desktop](1440-desktop.png).

## Checks

- **8 focused Chromium browser cases passed:** four mobile widths; long names, 200% text, reduced motion and inert/focused controls; resizing, search focus and Back/Forward restoration; building selection, Refresh, dismissal and restricted roles; touch input with mobile emulation.
- **12 existing sales-overview browser cases passed:** developer/admin/conveyancer layouts and filter stability at 390px and 1440px; loading/refresh; sale return and Back navigation.
- **23 focused Node tests passed:** environment-banner gating, portal lifecycle and sales overview.
- **TypeScript passed:** `npx tsc --noEmit`.
- **Production build passed:** `npm run build -- --webpack` (local only).
- **Focused lint passed:** hook, environment component, new tests and Playwright configuration.
- **Whitespace check passed:** `git diff --check`.

Reproduce against a local server on port 3017 with the existing public client configuration, `NEXT_PUBLIC_SHOW_ENV_BANNER=true` and `NEXT_PUBLIC_PORTAL_ENV=staging`:

```sh
npm run dev -- --webpack --port 3017
npx playwright test --config playwright.mobile-navigation.config.ts tests/mobile-navigation.spec.ts
npx playwright test --config playwright.mobile-navigation.config.ts tests/developer-sales-overview-stability.spec.ts
node --test tests/mobile-environment-banner.test.mjs tests/portal-load-lifecycle.test.mjs tests/developer-sales-overview.test.mjs
```

## Limits and existing failures

- A physical iOS/Android keyboard, browser chrome animation, hardware safe-area inset and Safari were not tested. Chromium viewport/rotation-size changes, focus and touch were exercised; real-device verification remains useful.
- The global-building-context suite passed 5/6 cases. Its existing Audit Log assertion rejects `setBuildingId` in the unchanged Audit Log implementation. Both the test and component match staging.
- Linting the entire `ProductionPortalApp.tsx` reports the same 13 errors as staging (12 hook rules and one unescaped entity). Existing warnings remain; the compact logo adds one warning for using the same native image pattern as the original header.
- The enlarged-text check validates the shared toolbars; it does not redesign existing page content at 200% text size.

No database changes, merge or production deployment are included.
