# Changelog

All notable changes to the Spatial Navigation for GeckoView extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [3.1.0] — 2026-05-15

A feature release focused on input-modality awareness, smarter boundary behavior, and visual-rect accuracy on real-world sites. **One default behavior change**: `boundaryScrollBehavior` now defaults to `'scroll'` (was effectively `'exit'` in 3.0.x). Set `boundaryScrollBehavior: 'exit'` in `window.spatialNavConfig` to preserve the legacy behavior. All other changes are additive.

### Added

- **Input modality watcher** (`core/modality_watcher.ts`). The extension now owns pointer/touch detection: it listens for trusted `pointerdown`/`touchstart` and posts `inputModalityChange` to the native host whenever the user transitions between hardware D-pad/arrow and touch. Replaces the host-app side modality detection previously implemented in `focus_style_manager.dart`. Also writes a legacy `flutter-modality-control:touch` title-channel postback for back-compat with older host wrappers.
- **`visibilityMode`** config key with `'always'` (default) and `'hardware-nav-only'` modes. `'hardware-nav-only'` hides the shadow-DOM overlay subtree until the host sets `data-modality="hardware-nav"` and `data-ring="visible"` attributes on the overlay host. Useful for apps that only want the focus ring visible during keyboard/D-pad navigation.
- **`boundaryScrollBehavior`** config key with `'scroll'` (default), `'exit'`, and `'none'` modes. Replaces the previous always-`focusExit` behavior at scroll-container boundaries. `'scroll'` scrolls the container instead of emitting `focusExit`; `'exit'` preserves 3.0.x behavior; `'none'` does neither.
- **`overlayInnerGlowOpacity`** config key (0–1, default `0.16`). Tunes the inner glow intensity independent of `overlayGlowOpacity` (outer glow).
- **`enableFocusPulse`** config key (default `false`). Adds a subtle CSS pulse animation to the focus ring on each navigation event.
- **`.snap` class on the overlay** for instant cross-viewport jumps. The CSS transition is removed when the overlay needs to jump a large distance (e.g., from one virtual-scroll page to another) to avoid the focus ring "flying" across the screen.
- **`clearOverlaySuppression(state)`** helper in `utils/focus-helpers.ts`. Atomically clears both the `overlaySuppressed` flag and the `suppressRecoveryTimer`, eliminating an orphan-timer race that could leave the overlay hidden indefinitely.
- **`CHEVRON_RING_GAP`** constant (14px) in `core/preview.ts`. Replaces the previous size-proportional chevron gap that grew with overlay size — chevrons now sit a uniform 14px from the focus ring.
- **pageshow modality re-attach** in `main.ts`. After BFCache restore, the modality watcher is reinstalled and the `HANDLER_ID_ATTR` is re-stamped on focusables.
- **`InputModalityChangeMessage`** type in `messaging/types.ts`. Outbound message shape: `{ type: 'inputModalityChange', modality: 'touch' | 'hardware-nav' }`.

### Changed

- **Pass-1 alignment weight raised 10 → 200** in `core/scoring.ts`. Fixes a class of bugs where a horizontal carousel would prefer the title sibling below an item over the next item in the same row. The increased weight makes the scoring prefer same-axis candidates more strongly.
- **`utils/observer.ts` now full-refreshes on `aria-hidden`/`hidden` attribute mutations** (previously only on `style`/`class`). Fixes React re-mount races where the overlay would hide momentarily during reconciliation.
- **Double-`focusExit` collapsed to a single event.** `navigation/movement.ts:MoveInDirectionOptions.notifyOnBoundary` is now used to gate the second-attempt retry path so analytics receive one `focusExit` per user input.
- **`core/geometry.ts` visual-rect logic** now shrinks the focus ring to a dominant media child when one exists, expands it to fit overflowing logo-style content, and clips it to any ancestor `overflow: hidden` wrapper. Fixes the Squarespace "logo overflows its container" case where the focus ring was huge and off-screen.
- **`rollup.config.js` now emits `e2e/fixtures/spatial-navigation.js`** in addition to `dist/` and `extension/`. Keeps the Playwright fixture in sync with the production bundle automatically.

### Fixed

- `utils/deprecation.ts` setter bug — the deprecation shim was writing to `window['__<name>_value']` instead of updating the closure variable, so writes to deprecated globals were silently lost. Setters now correctly update closure state.
- `utils/logger.ts` DEBUG token replacement — the rollup-replace plugin's literal token replacement now applies to the production bundle correctly, so DEBUG-gated branches tree-shake as expected.

### Migration

Public API is backward-compatible with 3.0.1. The one behavior shift is the `boundaryScrollBehavior` default — apps that depended on the previous always-`focusExit` behavior at scroll boundaries should set `boundaryScrollBehavior: 'exit'` in `window.spatialNavConfig` before upgrading. See [`docs/MIGRATION.md`](docs/MIGRATION.md#v301--v310) for full guidance.

## [3.0.1] — 2026-05-15

A hygiene + security hardening release. No public API changes; default behavior shifts noted under **Behavior changes**. Bundled eight security fixes after the initial hygiene work — see **Security** below.

### Security

Eight hardening fixes addressing CSS injection, DoS, prototype pollution, telemetry exfiltration, and info-disclosure surfaces. All fixes are server- and client-side compatible with existing v3.0.0 deployments — no API or configuration changes required.

- **`d23e1ab`** — Pin native-messaging app id to the hard-coded `flutter_geckoview` constant in both [`background.ts`](background.ts) and [`messaging/geckoview.ts`](messaging/geckoview.ts); strip `nativeAppId` from user-supplied config. Prevents a hostile page from rerouting telemetry to an attacker-controlled native messaging host.
- **`48ace4b`** — Remove `spatial_navigation.debug.js` from `web_accessible_resources` in `manifest.json`. The debug bundle exposed the extension UUID and debug bundle source on `moz-extension://<uuid>/spatial_navigation.debug.js`, allowing fingerprinting and easier reverse-engineering.
- **`cf0c889`** — Validate `disabledColor` config value against an explicit color-syntax allowlist (`#rgb`, `#rrggbb`, `rgb()`, `rgba()`, `hsl()`, `hsla()`, named colors). Stops shadow-DOM CSS injection via crafted strings like `red; --x: url(http://attacker)`.
- **`89faa8c`** — Stop reading `window.spatialNavState` back into the module. State is now a module-private singleton; `window.spatialNavState` is publish-only (for debugging/legacy compatibility). Prevents a page that pre-populates `window.spatialNavState` from hijacking the overlay target or focusables list.
- **`fb92346`** — Clamp all numeric config values (`overlapThreshold`, `gridAlignmentTolerance`, `outlineWidth`, `overlayZIndex`, `boundaryDebounceMs`, `virtualScrollDebounceMs`, etc.) to safe ranges via `NUMBER_RANGES` in `core/config.ts`. Prevents DoS via extreme values (e.g., `overlayZIndex: 2^53` or `overlapThreshold: -Infinity`).
- **`810b97d`** — Convert direction-name lookup tables (`DIRECTION_BY_NAME`, `OPPOSITE_DIRECTION`) to `Object.create(null)` + `Object.freeze`. Closes a prototype-pollution attack surface where `Object.prototype.constructor` lookups could be hijacked.
- **`d25d69f`** — Gate the runtime `SPATIAL_NAV_DEBUG` / `flutterSpatialNavDebug` flag behind build-time `DEBUG`. Production bundles now ignore the runtime flag entirely; only `spatial_navigation.debug.js` honors it. Stops info-disclosure of focus geometry, candidate selection internals, and timing data on production deployments.
- **`ae9562e`** — Cap `virtualContainerSelectors` array length to 32 entries and each entry length to 256 chars. Prevents DoS via a malicious config that supplies millions of selectors to `document.querySelectorAll`.

### Behavior changes (review before upgrading)

- **Debug logging is OFF by default in production builds.** v3.0.0 hardcoded `flutterSpatialNavDebug = true` in `main.ts`, which kept full `console.log` chains running on every keystroke. Production bundles now strip `console.log/info/debug` at build time and the runtime flag defaults off.
  - **Opt back in:** `window.SPATIAL_NAV_DEBUG = true` (or the legacy `window.flutterSpatialNavDebug = true`) before the script loads.
- **Default focus indicator color changed from `#FFC107` (amber, 1.6:1 contrast on white) to `#1565C0` (blue 800, ~5.4:1).** The amber default failed WCAG 2.1 non-text contrast (3:1 minimum). To keep the old color: `window.spatialNavConfig = { color: '#FFC107' }`.
- **Overlay now has `role="presentation"` and `aria-hidden="true"`.** Screen readers no longer try to announce the overlay (which is decorative chrome — focus is communicated via the actual focused element).
- **Legacy `window.flutterFocusState` and `window.flutterShowOverlay` now warn on first access.** They will be removed in v4. Use `window.spatialNavState` and `window.showSpatialNavOverlay` instead.

### Added

- **Config presets** — `applyPreset('tv' | 'phone' | 'tablet' | 'kiosk', overrides?)` for common form factors. See `core/config.ts` (`CONFIG_PRESETS`).
- **Config schema validation** — `validateUserConfig()` checks every key against its declared type and rejects malformed values with a logger warning instead of silently corrupting state. Runs automatically inside `getConfig()` and `updateConfig()`.
- **Bounded reconnect backoff** in `GeckoViewMessagingAdapter`: capped at 30s and 6 attempts (was unbounded `delay * attempts`).
- **Subpath exports actually built**: `dist/core.{js,esm.js}` and `dist/messaging.{js,esm.js}` now exist, matching the package.json `exports` claims.
- **Build-time NODE_ENV replacement** via `@rollup/plugin-replace` so production bundles tree-shake `DEBUG`-gated code.
- **Bundle size budgets** enforced in CI by `scripts/check-bundle-size.mjs`.
- **Coverage reporting** via `c8` (`npm run test:coverage`).
- **Integration tests for messaging adapters** (`__tests__/messaging.test.ts`) and the config validator + presets (`__tests__/validation.test.ts`).
- **GitHub config**: bug/feature issue templates, PR template, Dependabot, CodeQL workflow.
- **TypeDoc** for API docs (`npm run docs`).
- **ESLint + Prettier + .editorconfig + Husky pre-commit + commitlint**.
- **Conventional Commits enforcement** via commitlint (matches the README's existing claim).
- **`SCORING_CONSTANTS`** exported from `core/config.ts`. Score weights are now named constants (`SAME_GROUP_BONUS`, `GRID_BONUS`, etc.) with documented hierarchy. See `docs/SCORING.md`.
- **`safeGetBoundingClientRect()`** in `core/geometry.ts` — defensive wrapper for detached-node throws.
- **`utils/deprecation.ts`** module that wires legacy globals through `Object.defineProperty` getters to fire a single warning per legacy name.
- **WCAG-conforming default contrast** (see Behavior changes).
- **ARIA role on overlay** (see Behavior changes).

### Changed

- **TypeScript `strict: true`** (was `strict: false` with only `noImplicitAny: true`). Fixed all 6 resulting type errors.
- **Logger is now load-bearing** — every source file routes through `createLogger(...)` instead of bare `console.log`. Production bundles emit zero `console.log/info/debug` calls; `console.warn`/`console.error` preserved.
- **Removed `(window as any)` casts** across the codebase in favor of properly extended `Window` interface declarations in `globals.d.ts`.
- **Removed ~14 commented-out `if ((window as any).flutterSpatialNavDebug) console.log(...)` blocks** in `core/scoring.ts` and elsewhere.
- **`main.ts` refactored**: 526 lines → split into `initSpatialNavigation()`, `reinitializeAfterPageshow()`, `installWICGPolyfill()`, `connectToBackground()`. Removed the `"REMOVED: DOM and window guards were causing stale handlers"` apology comment — kept the design rationale as the docstring on `initSpatialNavigation`.
- **`navigation/handlers.ts` refactored**: split out `handleActivationKey`, `dispatchHoverPrime`, `dispatchFullPointerSequence`, `applyClickFeedback` helpers. Tag/input lookups extracted to `Set` constants.
- **Magic numbers extracted to named constants** throughout (`RAPID_REPEAT_THRESHOLD_MS`, `SLOW_REFRESH_THRESHOLD_MS`, `POSITION_HINT_EXPIRY_MS`, `MAX_RECONNECT_DELAY_MS`, etc.).
- **CI hardened**: separate `lint`, `test` (matrix), `coverage`, `build`, `audit`, `visual-tests` jobs. Adds `npm run format:check`, `npm run typecheck:tests`, `npm audit --omit=dev --audit-level=high`, bundle-size budget enforcement, and CodeQL on a separate workflow.

### Removed

- Dead duplicate `calculateDistance(rect1, rect2)` in `core/geometry.ts` (only the multi-method version in `core/scoring.ts` is used).
- Duplicate `FocusGroup` interface in `core/state.ts` (canonical class lives in `core/focus_group.ts`; `state.ts` re-exports it as a type alias).
- Hardcoded debug-by-default and dead commented-out debug blocks (see Changed).

### Documentation

- New: [`docs/SCORING.md`](docs/SCORING.md) — scoring weights and the design rationale.
- New: [`docs/MIGRATION.md`](docs/MIGRATION.md) — v2 → v3 migration notes and the v3.0.0 → v3.0.1 deltas above.
- README updated for new defaults, presets, and accurate config table.

## [3.0.0]

Initial public release.

### Core Features

- **WICG API Compatibility**: Implements standard spatial navigation APIs
  - `window.navigate(direction)` - Programmatic navigation
  - `Element.prototype.spatialNavigationSearch(direction)` - Find next target
  - `Element.prototype.focusableAreas(options)` - Get focusable descendants
  - `Element.prototype.getSpatialNavigationContainer()` - Get navigation container
  - **Runtime CSS custom property reading**:
    - `--spatial-navigation-contain: contain` - Creates navigation boundary
    - `--spatial-navigation-action: focus | scroll` - Override default behavior
    - `--spatial-navigation-function: grid` - Use grid-aligned scoring

- **Geometric Spatial Navigation**: Multi-pass scoring algorithm
  - Three-pass selection with progressively relaxed constraints
  - Configurable distance functions: euclidean, manhattan, projected
  - Grid mode scoring for aligned layouts (BBC LRUD-inspired)
  - Overlap threshold support for flexible hit detection
  - Wrap navigation at container boundaries

- **Focus Groups**: Navigation regions with boundary control
  - `data-focus-group` attribute for defining regions
  - Nested hierarchies via dot-notation IDs (`sidebar.menu.item1`)
  - Boundary modes: exit, contain, wrap, stop
  - Enter modes: default, first, last (with memory)
  - Option inheritance from parent groups
  - `GroupPath` utilities for hierarchy traversal

- **Visual Focus Overlay**: Animated amber outline with directional previews
  - Customizable color, width, and z-index
  - Click animation on Enter key press
  - Direction indicators showing next targets

### Platform Integration

- **Messaging Adapter Pattern**: Abstracted native messaging for cross-platform support
  - `MessagingAdapter` interface for platform-agnostic communication
  - `GeckoViewMessagingAdapter` for WebExtension API
  - `NoopMessagingAdapter` for standalone/testing environments
  - Factory function with auto-detection (`createMessagingAdapter()`)
  - Connection-based messaging with automatic reconnection

- **Native Messaging Protocol**:
  - `spatialNavInit` - Extension initialization notification
  - `focusChange` - Focus movement events
  - `focusExit` - Boundary reached events
  - `configUpdate` - Runtime configuration from native
  - `navigate` / `refresh` - Native-initiated commands

### Advanced Features

- **CSS Scroll Snap Integration**: Enhanced navigation for snap containers
  - `getScrollSnapInfo()` - Detect scroll-snap-type on containers
  - `getScrollSnapAlign()` - Read scroll-snap-align from children
  - `findScrollSnapContainer()` - Find nearest snap container
  - Auto-enable grid mode for mandatory snap containers
  - Optimal scrollIntoView options based on snap alignment

- **Shadow DOM Traversal**: Works with Web Components
  - Configurable via `traverseShadowDom` option
  - Handles slotted content and nested shadow roots
  - O(1) duplicate detection with Set<Element>

- **Virtual Scroll Detection**: Automatic refresh for infinite lists
  - Detects React Virtualized, YouTube, Twitter patterns
  - IntersectionObserver-based sentinel watching
  - Configurable debounce timing

- **Accessibility (ARIA)**: Screen reader support
  - ARIA live region announcements
  - `enableAria`, `announceNavigation`, `announceBoundaries` options
  - Accessible element descriptions

- **Focus Trap Detection**: Modal/dialog awareness
  - Detects `[role="dialog"]`, `[aria-modal="true"]`, framework dialogs
  - Reports escape affordances in events

- **Framework-Aware Refresh**: React/Vue/Angular optimization
  - `requestIdleCallback` scheduling
  - Deferred DOM updates
  - Candidate pre-computation in background

### Developer Experience

- **Strict TypeScript**: Fully typed codebase
  - `noImplicitAny: true` enforcement
  - Type definitions for all public APIs
  - ES Module and CommonJS builds

- **Tree-Shakeable Logging**: Production-optimized debug output
  - `createLogger(namespace)` factory
  - `DEBUG` flag for compile-time elimination
  - `measurePerformance()` decorator

- **Multiple Output Formats**:
  - UMD bundle for general usage (~20KB)
  - ES Module for modern bundlers
  - IIFE for GeckoView extension
  - Debug bundle with source maps (~50KB)

- **GitHub Packages Ready**:
  - Scoped package: `@dart-technologies/spatial-navigation-geckoview`
  - GitHub Actions CI/CD workflows
  - Subpath exports for modular imports

### Configuration Options

| Option                     | Type    | Default       | Description                  |
| -------------------------- | ------- | ------------- | ---------------------------- |
| `color`                    | string  | `'#FFC107'`   | Focus highlight color        |
| `outlineWidth`             | number  | `3`           | Outline width in pixels      |
| `autoRefocus`              | boolean | `true`        | Recover focus when lost      |
| `observeMutations`         | boolean | `true`        | Watch for DOM changes        |
| `observeScroll`            | boolean | `true`        | Update on scroll             |
| `traverseShadowDom`        | boolean | `false`       | Recurse into Shadow DOM      |
| `observeVirtualContainers` | boolean | `true`        | Detect virtual scroll        |
| `enableAria`               | boolean | `false`       | Enable ARIA announcements    |
| `focusTrapDetection`       | boolean | `false`       | Detect modals/dialogs        |
| `precomputeCandidates`     | boolean | `true`        | Background pre-computation   |
| `scoringMode`              | string  | `'geometric'` | Algorithm: geometric or grid |
| `distanceFunction`         | string  | `'euclidean'` | Distance calculation method  |
| `overlapThreshold`         | number  | `0`           | Pixels of overlap allowed    |
| `gridAlignmentTolerance`   | number  | `20`          | Grid alignment tolerance     |
| `wrapNavigation`           | boolean | `false`       | Wrap at boundaries           |
| `useCSSProperties`         | boolean | `true`        | Read CSS custom properties   |
