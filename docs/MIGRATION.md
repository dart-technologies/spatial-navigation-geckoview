# Migration Guide

## Why v3.0.0 (and not v1.0.0)?

v3.0.0 was the **initial public** release. The internal versions that preceded
it lived inside the [flutter-geckoview](https://github.com/dart-technologies/flutter-geckoview)
host repository. Bumping straight to v3 keeps the version number aligned with
the host and avoids the impression that v1/v2 were ever published.

If you were depending on the bundled-inside-flutter-geckoview build, see the
[Pre-v3 → v3.0.0](#pre-v3--v300) section below.

## v3.0.1 → v3.1.0

A feature release. Additive only — no API removals, no behavior changes that
require code changes on the host side. **One default behavior shifted**: at
scroll-container boundaries, the extension now scrolls the container instead
of immediately emitting `focusExit`. Read on if you depend on the old behavior.

### Behavior changes

#### 1. `focusExit` is no longer the default at scroll-container boundaries

In 3.0.x, when navigation reached the edge of a scrollable container, the
extension emitted `focusExit` to the native host. In 3.1.0, the new
`boundaryScrollBehavior` config defaults to `'scroll'`, which scrolls the
container instead. `focusExit` is now only emitted when:

- the container cannot scroll further in the requested direction, AND
- there are no focusable candidates beyond the boundary.

**Keep 3.0.x behavior:**

```js
window.spatialNavConfig = { boundaryScrollBehavior: 'exit' };
```

**Other modes:**

- `'scroll'` (default) — scroll the container; fall back to `focusExit` only when scrolling is exhausted.
- `'exit'` — never scroll; emit `focusExit` immediately on boundary (matches 3.0.x).
- `'none'` — neither scroll nor exit. Useful for static layouts where the boundary should be silently absorbed.

### New optional features

These are additive — opt in if you want them, otherwise nothing changes.

#### Input modality watcher (always on)

The extension now owns pointer/touch detection. It posts an
`inputModalityChange` message to the native host whenever the user transitions
between hardware D-pad/arrow keys and touch:

```ts
{ type: 'inputModalityChange', modality: 'touch' | 'hardware-nav' }
```

For back-compat with older host wrappers that read modality from the document
title, the watcher also writes `document.title = 'flutter-modality-control:touch'`
briefly before restoring the previous title. This title-channel postback is
slated for removal one extension release after all consuming apps have a
proper `inputModalityChange` handler.

**For host-app integrators**: if your app was previously implementing pointer
detection itself (e.g., in `focus_style_manager.dart`), remove that code — the
extension now handles it. Subscribe to `inputModalityChange` on your
messaging port instead.

#### Hardware-nav-only overlay mode

Hide the focus ring until the user actually starts using the D-pad:

```js
window.spatialNavConfig = { visibilityMode: 'hardware-nav-only' };
```

When set, the overlay's shadow subtree is `display: none` until the host
sets `data-modality="hardware-nav"` and `data-ring="visible"` attributes
on the overlay host element (`#spatnav-focus-host`). The host app is
responsible for setting these attributes based on the
`inputModalityChange` events.

#### Focus pulse animation

Add a subtle pulse to the focus ring on each navigation:

```js
window.spatialNavConfig = { enableFocusPulse: true };
```

#### New visual options

| Option                    | Type    | Default    | Range                             | Description                |
| ------------------------- | ------- | ---------- | --------------------------------- | -------------------------- |
| `overlayInnerGlowOpacity` | number  | `0.16`     | 0–1                               | Inner-glow opacity         |
| `enableFocusPulse`        | boolean | `false`    | —                                 | Focus-ring pulse animation |
| `visibilityMode`          | string  | `'always'` | `'always'`, `'hardware-nav-only'` | Overlay visibility gating  |
| `boundaryScrollBehavior`  | string  | `'scroll'` | `'scroll'`, `'exit'`, `'none'`    | Scroll-boundary behavior   |

### Internals (for library extenders)

- `core/modality_watcher.ts` is a new module. Imported by `main.ts` via
  `setupInputModalityWatcher`. The watcher is platform-agnostic — it does not
  import the messaging adapter directly; `main.ts` builds a `ModalityPostback`
  closure around the active adapter.
- `utils/focus-helpers.ts:clearOverlaySuppression(state)` is a new helper that
  atomically clears `state.overlaySuppressed` and `state.suppressRecoveryTimer`.
  Use this instead of clearing the two fields by hand — it eliminates an
  orphan-timer race that could leave the overlay hidden indefinitely.
- `navigation/movement.ts:MoveInDirectionOptions.notifyOnBoundary` is a new
  optional flag. Used internally to gate the second-attempt retry path so
  `focusExit` analytics fire once per user input, not twice.
- `core/scoring.ts` pass-1 alignment weight raised 10 → 200. If your code reads
  `SCORING_CONSTANTS.PASS_1_ALIGNMENT_WEIGHT`, the value changed; behavior
  consequences are listed in [`docs/SCORING.md`](SCORING.md).
- `core/geometry.ts:safeGetBoundingClientRect` now applies visual-rect
  shrink-to-media-child, expand-to-fit-overflowing-content, and ancestor
  `overflow: hidden` clipping. If you call this from a wrapper, the returned
  rect may differ from `element.getBoundingClientRect()`.

## v3.0.0 → v3.0.1

A hygiene + hardening release. **No public API removals.** Three behaviors
changed defaults — most consumers won't need to do anything, but read the
list below before upgrading.

### Behavior changes

#### 1. Debug logging defaults to OFF in production

v3.0.0 hardcoded `(window as any).flutterSpatialNavDebug = true` in `main.ts`
on every page load, which kept verbose `console.log` chains running on every
keystroke. v3.0.1 removes the hardcoded enable and the production bundles
strip `console.log/info/debug` at build time.

**If you relied on the verbose logs:**

```html
<script>
  // Set BEFORE the extension loads.
  window.SPATIAL_NAV_DEBUG = true;
</script>
```

The legacy `window.flutterSpatialNavDebug = true` flag also still works.

#### 2. Default focus indicator color is now `#1565C0` (blue 800)

The old default `#FFC107` (amber) had ~1.6:1 contrast against white, failing
the WCAG 2.1 non-text contrast minimum (3:1). The new default clears 5.4:1
on white and 3.2:1 on black.

**To keep the amber color:**

```js
window.spatialNavConfig = { color: '#FFC107' };
```

#### 3. Overlay marked decorative for screen readers

The overlay now has `role="presentation"` and `aria-hidden="true"`. Screen
readers (TalkBack on Android TV) no longer try to announce the focus
indicator chrome — focus is announced via the focused element itself.

If you were relying on the overlay being announced (e.g., a custom AT
implementation that targeted `#spatnav-focus-host`), migrate to listening to
the `navbeforefocus` / `focus` events on the actual focused elements
instead.

#### 4. Security hardening defaults

v3.0.1 bundled eight security fixes (see [`CHANGELOG.md`](../CHANGELOG.md#301--2026-05-15)
for the full list). The behavior shifts visible to integrators:

- **`nativeAppId` is no longer settable from user config.** The native-messaging
  host id is now pinned to the hard-coded `flutter_geckoview` constant in
  `background.ts` and `messaging/geckoview.ts`. If you were setting
  `window.spatialNavConfig.nativeAppId`, the value is silently dropped at
  validation time. To use a different host id, repackage the extension with
  the constants changed at build time.
- **`disabledColor` is now strictly validated.** Strings that aren't a
  recognized CSS color (`#rgb`, `#rrggbb`, `rgb()`, `rgba()`, `hsl()`,
  `hsla()`, named colors) fall back to the `'128, 128, 128'` default. Strings
  like `"red; --x: url(http://attacker)"` no longer reach the shadow-DOM
  stylesheet. Same validator runs on `color`.
- **Numeric config values are clamped to safe ranges.** See the
  [Safe-range clamping table in README](../README.md#safe-range-clamping-301).
  Most consumers will not notice — the bounds are generous (e.g., `outlineWidth`
  is `1..20`, `safeAreaMargin` is `0..200`). Values outside the range are
  corrected to the nearest bound; a warning is logged.
- **`virtualContainerSelectors` is capped** at 32 entries × 256 chars each.
  If your config supplies more, the surplus is truncated with a warning.
- **`spatial_navigation.debug.js` no longer ships in the extension package**
  via `web_accessible_resources`. The debug bundle is still in the npm
  tarball under `extension/spatial_navigation.debug.js`, but it cannot be
  loaded from `moz-extension://<uuid>/...` URLs in the browser. To run with
  debug logging, replace `content_scripts[0].js` in your `manifest.json`
  with the debug bundle path during development.
- **The runtime `SPATIAL_NAV_DEBUG` flag is build-time gated.** Setting
  `window.SPATIAL_NAV_DEBUG = true` has no effect on the production bundle —
  the conditional is removed at minify time. Load the debug bundle if you
  need verbose logs.
- **`window.spatialNavState` is publish-only** — the module no longer reads
  it back. If a page pre-populates `window.spatialNavState` before the
  content script runs, it cannot hijack the extension's internal state.
  Consumers that rely on reading the state object are unaffected.
- **Direction lookup tables are frozen** (`DIRECTION_BY_NAME`,
  `OPPOSITE_DIRECTION`). Mutating these is no longer possible from page
  scope. No public surface change.

### Soft deprecations

These names still work but log a one-time warning. They will be removed
in v4:

| Deprecated                       | Use instead                      |
| -------------------------------- | -------------------------------- |
| `window.flutterFocusState`       | `window.spatialNavState`         |
| `window.flutterShowOverlay()`    | `window.showSpatialNavOverlay()` |
| `window.flutterSpatialNavConfig` | `window.spatialNavConfig`        |
| `window.flutterSpatialNavDebug`  | `window.SPATIAL_NAV_DEBUG`       |

The new names existed in v3.0.0 — this release just adds the migration
warning.

### New optional features

These are additive — opt in if you want them, otherwise nothing changes.

- **Config presets**: `applyPreset('tv' | 'phone' | 'tablet' | 'kiosk', overrides?)`.
  Set sensible defaults for the form factor in one call. See
  [`docs/PRESETS.md`](PRESETS.md).
- **Config schema validation**: malformed values in `window.spatialNavConfig`
  are now dropped with a console warning instead of silently corrupting state.
- **Subpath imports**: `import { ... } from '@dart-technologies/spatial-navigation-geckoview/core'`
  and `/messaging` now actually have buildable bundles behind them (previously
  the export paths in package.json pointed at non-existent files).

### For library authors integrating spatial navigation

If you ship a wrapper around this library, a few internal types moved:

- `FocusGroup` — formerly an interface in `core/state.ts`, now the canonical
  class from `core/focus_group.ts` (re-exported as a type alias from
  `core/state.ts` for backward compatibility).
- `calculateDistance` — the `(rect1, rect2)` signature in `core/geometry.ts`
  has been removed (it was unused). The `(dx, dy, method, direction)` form in
  `core/scoring.ts` is the only public version.

## Pre-v3 → v3.0.0

If you were consuming an internal build from the flutter-geckoview repo,
the public API names changed:

| Pre-v3                      | v3.0.0+                        |
| --------------------------- | ------------------------------ |
| `window.flutterFocusState`  | `window.spatialNavState`       |
| `window.flutterShowOverlay` | `window.showSpatialNavOverlay` |

Pre-v3 names are kept as aliases (with deprecation warnings as of v3.0.1).
They will be removed in v4.

The configuration object likewise renamed:

| Pre-v3                                   | v3.0.0+                           |
| ---------------------------------------- | --------------------------------- |
| `window.flutterSpatialNavConfig = {...}` | `window.spatialNavConfig = {...}` |

Both names are still read at init time.
