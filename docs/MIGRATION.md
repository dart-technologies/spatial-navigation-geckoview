# Migration Guide

## Why v3.0.0 (and not v1.0.0)?

v3.0.0 was the **initial public** release. The internal versions that preceded
it lived inside the [flutter-geckoview](https://github.com/dart-technologies/flutter-geckoview)
host repository. Bumping straight to v3 keeps the version number aligned with
the host and avoids the impression that v1/v2 were ever published.

If you were depending on the bundled-inside-flutter-geckoview build, see the
[Pre-v3 → v3.0.0](#pre-v3--v300) section below.

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
