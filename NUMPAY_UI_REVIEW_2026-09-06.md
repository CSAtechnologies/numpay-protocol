# NumPay UI review, 2026-09-06

Source: [Hayden Smith, four UI design patterns](https://www.tiktok.com/@haydenschmitty/video/7671140138939960590), supplied as https://vt.tiktok.com/ZSq2aaThk/.
Reviewed the video's frames and burned-in captions. The public embed provided
the video; downloaded reference media and review frames stay locally ignored
under artifacts/video-review/. No transcript or reference media ships with the wallet.

## Applied

- Around 0:19, skeleton loaders: BPAN ownership has a card-shaped loading state
  in both apps. Cached numbers remain visible during refresh. Failed scans show
  an error and Retry instead of "No BPANs yet". Mapping-detail failures preserve
  prior data and show an error instead of inventing an empty mapping list.
- Around 0:32, semantic colors: BPAN extension success/error/caution text uses
  theme-aware tokens. Removed the decorative LIVE badge and mobile green dot,
  which were not backed by a connection health check.
- Around 0:51, clutter: shortened the registry subtitle and registration
  explanation. Retained registration fee, gas/network information, mapping
  choices, transaction state and payment warnings.
- Around 1:32, accessibility: extension tabs have keyboard arrow/Home/End
  navigation, Enter/Space activation and labeled panels. Added visible shared
  keyboard focus, BPAN input/icon labels, selected/checked/expanded states and
  screen-reader loading/error messages. Mobile shared buttons report disabled
  state. Shared mobile press/skeleton animations follow the OS reduced-motion
  setting; skeleton shapes are hidden from accessibility navigation.
- Fixed an already-documented white-label contrast issue. Shared primary
  controls, mobile Receive Copy Address, and BPAN selected controls use darker
  purple action fills. Mobile action gradient stops meet 4.5:1 with white in
  both themes. Decorative logo colors retain their existing ramp.

## Discarded or limited

No marketing prompts, unrelated productivity-screen design, artificial loading
delays, or wholesale redesign. The video's broad legal claim is not treated as
a legal conclusion or a guarantee that the wallet meets every accessibility
requirement. This is a targeted BPAN/shared-control pass, not a full app audit.

Implementation references: [WAI tabs pattern](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/),
[normal-text contrast guidance](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html),
and [React Native accessibility preferences](https://reactnative.dev/docs/accessibilityinfo).

## Validation

- Mobile: all 16 existing test suites passed, including 90 palette contrast
  checks. TypeScript passed after the UI changes.
- Extension: production build passed. Added a real-component server-render
  regression test for loading, empty, failure/retry, cached refresh, control
  labels and tab semantics; it passes and is included in npm test.
- Browser runtime reported no available browser. No visual browser, native
  device, keyboard interaction or screen-reader session was completed for
  these changes. Server-render tests do not establish those results.

Updated 2026-09-07: Ethereum BPAN has since been removed. BPAN is unavailable
until the fresh Base registry is deployed. See NUMPAY_BPAN_BASE_2026-09-06.md.
