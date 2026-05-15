# Spatial Navigation for GeckoView

[![Version](https://img.shields.io/badge/version-3.1.0-blue.svg)](https://github.com/dart-technologies/spatial-navigation-geckoview)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![CI](https://github.com/dart-technologies/spatial-navigation-geckoview/actions/workflows/ci.yml/badge.svg)](https://github.com/dart-technologies/spatial-navigation-geckoview/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@dart-technologies/spatial-navigation-geckoview)](https://github.com/dart-technologies/spatial-navigation-geckoview/packages)

A GeckoView web extension providing **WICG-compatible spatial navigation** for Android TV, AAOS, and D-pad/keyboard navigation. Designed for seamless integration with [flutter-geckoview](https://github.com/dart-technologies/flutter-geckoview) and other GeckoView host applications.

## Features

### Core Navigation

- ✅ **Geometric spatial navigation** - Multi-pass scoring algorithm for accurate directional navigation
- ✅ **Focus groups** - Define navigation regions with `data-focus-group` attributes
- ✅ **WICG API compatibility** - `window.navigate()`, `Element.spatialNavigationSearch()`, etc.
- ✅ **Visual focus overlay** - Animated amber outline with directional previews
- ✅ **Scroll container awareness** - Handles nested scrollable regions

### Platform Integration

- ✅ **Native messaging** - Bidirectional communication with GeckoView host apps
- ✅ **Focus exit events** - Notify native app when navigation leaves web content
- ✅ **Config updates** - Runtime configuration from native layer

### Advanced Features

- ✅ **Input modality awareness** _(3.1+)_ - Detects touch vs hardware-nav; posts `inputModalityChange` to the native host on transitions
- ✅ **Configurable boundary behavior** _(3.1+)_ - Scroll container on boundary by default; opt into `focusExit` or no-op
- ✅ **Visual-rect accuracy** _(3.1+)_ - Focus ring fits dominant media children, expands for overflowing logos, clips to ancestor `overflow: hidden`
- ✅ **Hardware-nav-only overlay mode** _(3.1+)_ - Hide the focus ring until the user starts D-pad navigation
- ✅ **Shadow DOM traversal** - Works with Web Components (Shoelace, Material Web)
- ✅ **Virtual scroll detection** - Automatic refresh for React Virtualized, YouTube, Twitter
- ✅ **Focus trap detection** - Handles modals/dialogs with escape affordances
- ✅ **ARIA accessibility** - Optional live region announcements
- ✅ **Framework-aware refresh** - Deferred updates for React/Vue/Angular
- ✅ **Strict TypeScript** - Fully typed codebase with `strict: true`
- ✅ **Performance** - <5ms navigation latency (benchmarked for 1000+ elements)

## Installation

### GitHub Packages (npm)

```bash
# Configure npm to use GitHub Packages for @dart-technologies scope
echo "@dart-technologies:registry=https://npm.pkg.github.com" >> .npmrc

# Install the package
npm install @dart-technologies/spatial-navigation-geckoview
```

### Git Submodule (recommended for flutter-geckoview)

For Flutter/native projects that bundle the extension as an asset:

```bash
# Add as submodule
git submodule add https://github.com/dart-technologies/spatial-navigation-geckoview.git lib/assets/spatial_navigation

# Initialize and update
git submodule update --init --recursive

# Build the extension
cd lib/assets/spatial_navigation
npm install
npm run build:all
```

**Update submodule to latest:**

```bash
cd lib/assets/spatial_navigation
git pull origin main
npm install
npm run build:all
cd ../../..
git add lib/assets/spatial_navigation
git commit -m "chore: update spatial-navigation-geckoview submodule"
```

### Manual Installation

Clone and build:

```bash
git clone https://github.com/dart-technologies/spatial-navigation-geckoview.git
cd spatial-navigation-geckoview
npm install
npm run build:all
```

## Usage

### GeckoView Integration

```kotlin
// Install extension in GeckoView
runtime.webExtensionController
    .ensureBuiltIn(
        "resource://android/assets/spatial_navigation/",
        "spatial-navigation@geckoview.dev"
    )
    .accept(
        { extension ->
            Log.i("SpatialNav", "Extension installed: ${extension.id}")
            setupMessageDelegate(extension)
        },
        { error -> Log.e("SpatialNav", "Install failed", error) }
    )

// Handle messages from extension
private fun setupMessageDelegate(extension: WebExtension) {
    extension.setMessageDelegate(object : WebExtension.MessageDelegate {
        override fun onMessage(
            nativeApp: String,
            message: Any,
            sender: WebExtension.MessageSender
        ): GeckoResult<Any>? {
            val json = message as? JSONObject ?: return null
            when (json.getString("type")) {
                "spatialNavInit" -> Log.d("SpatialNav", "Initialized: ${json.getString("url")}")
                "focusExit" -> handleFocusExit(json.getString("direction"))
            }
            return null
        }
    }, "geckoview-spatial-nav")
}
```

### Web Page Configuration

```html
<!-- Optional: Configure via global -->
<script>
  window.spatialNavConfig = {
    color: '#00BCD4', // Teal focus color
    outlineWidth: 4,
    autoRefocus: true,
    enableAria: true, // Enable accessibility
    traverseShadowDom: true, // For Web Components
  };
</script>

<!-- Focus groups for navigation regions -->
<nav data-focus-group="main-nav;boundary=contain">
  <button>Home</button>
  <button>Search</button>
</nav>

<main data-focus-group="content;enterMode=last">
  <!-- Content area remembers last focused element -->
</main>
```

### Form-factor presets

For one-line setup of the most common environments, use `applyPreset()`:

```html
<script>
  // Apply BEFORE the extension's content script runs
  spatialNavigation.applyPreset('tv'); // Android TV / set-top
  // or 'phone', 'tablet', 'kiosk'
</script>
```

User-set values in `window.spatialNavConfig` always win over preset defaults.
See [`docs/PRESETS.md`](docs/PRESETS.md) for what each preset configures.

### Programmatic Navigation

```javascript
// WICG-compatible API
window.navigate('down'); // Move focus down
window.navigate('right'); // Move focus right

// Find next target without moving
const next = document.activeElement.spatialNavigationSearch('down');
console.log('Next target:', next);

// Get focusable elements in container
const focusables = document.body.focusableAreas({ mode: 'visible' });

// Get navigation container
const container = button.getSpatialNavigationContainer();
```

## Configuration

All options can be set via `window.spatialNavConfig`:

### Visual Options

| Option                    | Type    | Default           | Description                                      |
| ------------------------- | ------- | ----------------- | ------------------------------------------------ |
| `color`                   | string  | `'#1565C0'`       | Focus highlight color (blue 800, WCAG-compliant) |
| `outlineWidth`            | number  | `3`               | Outline width in CSS pixels                      |
| `outlineOffset`           | number  | `3`               | Outline offset in CSS pixels                     |
| `overlayZIndex`           | number  | `2147483646`      | Overlay z-index                                  |
| `arrowScale`              | number  | `1.0`             | Directional chevron scale                        |
| `disabledColor`           | string  | `'128, 128, 128'` | Disabled/boundary indicator RGB string           |
| `overlayTheme`            | string  | `'default'`       | `'default'` or `'high-contrast'` preset          |
| `safeAreaMargin`          | number  | `12`              | Safe-area/overscan margin in CSS pixels          |
| `overlayScrimOpacity`     | number  | `0.06`            | Inner scrim opacity (0–1)                        |
| `overlayGlowOpacity`      | number  | `0.35`            | Outer glow opacity (0–1)                         |
| `overlayInnerGlowOpacity` | number  | `0.16`            | Inner glow opacity (0–1) _(3.1+)_                |
| `overlayGlowBlur`         | number  | `14`              | Outer glow blur radius in CSS pixels             |
| `enableFocusPulse`        | boolean | `false`           | Pulse animation on focus change _(3.1+)_         |
| `visibilityMode`          | string  | `'always'`        | `'always'` or `'hardware-nav-only'` _(3.1+)_     |
| `autoRefocus`             | boolean | `true`            | Recover focus when lost                          |

### Observation Options

| Option                     | Type    | Default | Description                |
| -------------------------- | ------- | ------- | -------------------------- |
| `observeMutations`         | boolean | `true`  | Watch for DOM changes      |
| `observeScroll`            | boolean | `true`  | Update on scroll           |
| `traverseShadowDom`        | boolean | `false` | Recurse into Shadow DOM    |
| `observeVirtualContainers` | boolean | `true`  | Detect virtual scroll      |
| `enableAria`               | boolean | `false` | Enable ARIA announcements  |
| `focusTrapDetection`       | boolean | `false` | Detect modals/dialogs      |
| `precomputeCandidates`     | boolean | `true`  | Background pre-computation |

### Scoring Options

| Option                   | Type    | Default       | Description                                           |
| ------------------------ | ------- | ------------- | ----------------------------------------------------- |
| `scoringMode`            | string  | `'geometric'` | Algorithm: `'geometric'` or `'grid'`                  |
| `distanceFunction`       | string  | `'euclidean'` | Distance: `'euclidean'`, `'manhattan'`, `'projected'` |
| `overlapThreshold`       | number  | `0`           | Pixels of overlap allowed (BBC LRUD)                  |
| `gridAlignmentTolerance` | number  | `20`          | Pixels tolerance for grid alignment                   |
| `wrapNavigation`         | boolean | `false`       | Wrap focus at container boundaries                    |
| `boundaryScrollBehavior` | string  | `'scroll'`    | `'scroll'`, `'exit'`, `'none'` _(3.1+)_               |
| `useCSSProperties`       | boolean | `true`        | Read `--spatial-navigation-*` CSS                     |

For the underlying score formula and weight hierarchy, see [`docs/SCORING.md`](docs/SCORING.md).
Inputs are validated against a schema — malformed values are dropped with a warning rather than silently corrupting state.

#### Safe-range clamping (3.0.1+, extended in 3.1.0)

Every numeric config value is clamped to a safe range at config read time. Out-of-range values are corrected to the nearest bound. This stops a malicious config from making the overlay invisible, off-screen, or paint-thread-prohibitive, or from setting observer debounces / cache timeouts to hostile extremes.

**Visual styling**

| Option                    | Min   | Max          | Default      |
| ------------------------- | ----- | ------------ | ------------ |
| `outlineWidth`            | `1`   | `20`         | `3`          |
| `outlineOffset`           | `0`   | `50`         | `3`          |
| `overlayZIndex`           | `1`   | `2147483646` | `2147483646` |
| `arrowScale`              | `0.1` | `4`          | `1.0`        |
| `safeAreaMargin`          | `0`   | `200`        | `12`         |
| `overlayScrimOpacity`     | `0`   | `1`          | `0.06`       |
| `overlayGlowOpacity`      | `0`   | `1`          | `0.35`       |
| `overlayGlowBlur`         | `0`   | `64`         | `14`         |
| `overlayInnerGlowOpacity` | `0`   | `1`          | `0.16`       |

**Observers and timers** _(3.1+)_

| Option                   | Min | Max     | Default |
| ------------------------ | --- | ------- | ------- |
| `mutationDebounce`       | `0` | `5000`  | `100`   |
| `scrollThreshold`        | `0` | `1000`  | `8`     |
| `virtualScrollDebounce`  | `0` | `5000`  | `150`   |
| `precomputeCacheTimeout` | `0` | `60000` | `500`   |
| `intersectionThreshold`  | `0` | `1`     | `0`     |

**Scoring** _(3.1+)_

| Option                   | Min | Max    | Default |
| ------------------------ | --- | ------ | ------- |
| `overlapThreshold`       | `0` | `4096` | `0`     |
| `gridAlignmentTolerance` | `0` | `4096` | `20`    |
| `minElementSize`         | `0` | `4096` | `1`     |

`color` and `disabledColor` are validated against an allowlist of CSS color syntaxes (`#rgb`, `#rrggbb`, `rgb()`, `rgba()`, `hsl()`, `hsla()`, named colors) by the same `parseColor()` validator. Strings that don't match the allowlist fall back to the default — they cannot inject arbitrary CSS into the shadow-DOM `:host` block.

`virtualContainerSelectors` is capped at **32 entries**; each entry is capped at **256 characters**. Excess entries are dropped with a warning. This prevents DoS via a config that supplies millions of selectors to `document.querySelectorAll`.

`iframeSupport` and `focusGroups` nested objects are field-validated _(3.1+)_: unknown keys are dropped, `focusMethod`/`boundaryBehavior` enums are checked against allowlists, and only plain objects (no Arrays, no `null` prototypes) are accepted.

### Focus Group Options

```html
<div data-focus-group="id;boundary=contain;enterMode=last;remember=true"></div>
```

- `boundary`: `exit` (default), `contain`, `wrap`, `stop`
- `enterMode`: `default`, `first`, `last`
- `remember`: `true` (default), `false`

## Events

### Navigation Events (WICG-compatible)

```javascript
// Before focus changes (cancelable)
document.addEventListener('navbeforefocus', (e) => {
  console.log('Moving', e.detail.dir, 'to', e.target);
  // e.preventDefault() to cancel
});

// When hitting boundary
document.addEventListener('navnotarget', (e) => {
  console.log('Boundary reached:', e.detail.dir);
  if (e.detail.inTrap) {
    console.log('In trap, escape:', e.detail.escapeKey);
  }
});
```

### Focus Exit Events

```javascript
// When navigation leaves web content
document.addEventListener('spatialNavigationExit', (e) => {
  console.log('Exiting web content:', e.detail.direction);
  // Native app handles from here
});
```

## Native Messaging Protocol

### Messages from Extension → Native

| Type                  | Payload                                            | Description                                              |
| --------------------- | -------------------------------------------------- | -------------------------------------------------------- |
| `spatialNavInit`      | `{ url, version }`                                 | Extension initialized                                    |
| `focusChange`         | `{ direction, fromElement, toElement }`            | Focus moved                                              |
| `focusExit`           | `{ direction, inTrap }`                            | Reached boundary (when `boundaryScrollBehavior: 'exit'`) |
| `inputModalityChange` | `{ modality: 'touch' \| 'hardware-nav' }` _(3.1+)_ | User switched between touch and D-pad                    |

### Messages from Native → Extension

| Type           | Payload         | Description        |
| -------------- | --------------- | ------------------ |
| `navigate`     | `{ direction }` | Request navigation |
| `configUpdate` | `{ ...config }` | Update config      |
| `refresh`      | `{}`            | Re-scan focusables |

## Debug logging

Logging is **off by default** in production builds.

For verbose `[SpatialNav:*]` logs during development, load the **debug bundle**
(`extension/spatial_navigation.debug.js`) instead of the minified production
bundle. In the debug bundle, set `window.SPATIAL_NAV_DEBUG = true` (or the
legacy `window.flutterSpatialNavDebug`) before the extension content script
runs:

```html
<script>
  // Debug bundle only — has no effect in production builds.
  window.SPATIAL_NAV_DEBUG = true;
</script>
```

The production bundle ignores this flag intentionally: page-settable globals
should not control log emission from a content script that runs on every
URL. Terser also drops `console.log/info/debug` at minification, so
`warn`/`error` are the only levels that fire in production.

## Building

```bash
npm install
npm run build:all          # Build + copy to extension/
npm run build              # Build to dist/ only
npm test                   # Unit tests (Node native runner)
npm run test:coverage      # With c8 coverage report
npm run test:benchmark     # Performance benchmarks
npm run test:visual        # Playwright visual regression
npm run lint               # ESLint
npm run format:check       # Prettier
npm run typecheck          # tsc --noEmit (strict mode)
npm run size               # Bundle size budget check
npm run docs               # Generate TypeDoc
```

### Output Files

| File                                          | Format  | Size   | Use Case                                    |
| --------------------------------------------- | ------- | ------ | ------------------------------------------- |
| `dist/spatial-navigation.js`                  | UMD     | ~75KB  | General usage                               |
| `dist/spatial-navigation.esm.js`              | ESM     | ~75KB  | Modern bundlers                             |
| `dist/spatial-navigation.extension.js`        | IIFE    | ~75KB  | GeckoView extension                         |
| `dist/spatial-navigation.debug.js`            | IIFE    | ~220KB | Development (with sourcemaps)               |
| `dist/core.js` / `dist/core.esm.js`           | UMD/ESM | ~38KB  | Core algorithms only (no overlay/messaging) |
| `dist/messaging.js` / `dist/messaging.esm.js` | UMD/ESM | ~5KB   | Messaging adapters only                     |
| `dist/background.js`                          | IIFE    | ~2KB   | WebExtension background relay               |

## Migration

Upgrading from a previous version? See [`docs/MIGRATION.md`](docs/MIGRATION.md) for:

- **v3.0.0 → v3.0.1** — debug-by-default removed, focus color changed for WCAG contrast, deprecation warnings on `flutter*` aliases, eight security hardening defaults.
- **v3.0.1 → v3.1.0** — new `inputModalityChange` message, `boundaryScrollBehavior` default changed to `'scroll'`, optional `visibilityMode: 'hardware-nav-only'`.

## Security

To report a vulnerability, see [`SECURITY.md`](SECURITY.md). v3.0.1 ships eight security hardening fixes — see the [3.0.1 changelog entry](CHANGELOG.md#301--2026-05-15) for the full list.

## Architecture

- [`docs/SCORING.md`](docs/SCORING.md) — score weights and the design rationale
- [`docs/PRESETS.md`](docs/PRESETS.md) — TV / phone / tablet / kiosk presets
- [`docs/MIGRATION.md`](docs/MIGRATION.md) — version migration notes
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — dev setup, testing, PR conventions

## Comparison with Other Libraries

### vs WICG Polyfill

| Feature          | WICG Polyfill | This Extension |
| ---------------- | ------------- | -------------- |
| W3C API          | Full          | Partial        |
| CSS Properties   | Yes           | Yes            |
| Visual Overlay   | No            | Yes            |
| Native Messaging | No            | Yes            |
| Virtual Scroll   | No            | Yes            |

### vs Pathduck/spatialnavigation

| Feature         | Pathduck   | This Extension   |
| --------------- | ---------- | ---------------- |
| Sections        | Yes        | Focus Groups     |
| Visual Feedback | Class only | Animated overlay |
| React/Vue       | No         | Framework-aware  |
| Shadow DOM      | No         | Yes              |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development guidelines.

## License

MIT
