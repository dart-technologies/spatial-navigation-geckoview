# Spatial Navigation for GeckoView

[![Version](https://img.shields.io/badge/version-3.0.0-blue.svg)](https://github.com/dart-technologies/spatial-navigation-geckoview)
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
- ✅ **Shadow DOM traversal** - Works with Web Components (Shoelace, Material Web)
- ✅ **Virtual scroll detection** - Automatic refresh for React Virtualized, YouTube, Twitter
- ✅ **Focus trap detection** - Handles modals/dialogs with escape affordances
- ✅ **ARIA accessibility** - Optional live region announcements
- ✅ **Framework-aware refresh** - Deferred updates for React/Vue/Angular
- ✅ **Strict TypeScript** - Fully typed codebase with `noImplicitAny: true`
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
    color: '#00BCD4',           // Teal focus color
    outlineWidth: 4,
    autoRefocus: true,
    enableAria: true,           // Enable accessibility
    traverseShadowDom: true,    // For Web Components
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

### Programmatic Navigation

```javascript
// WICG-compatible API
window.navigate('down');    // Move focus down
window.navigate('right');   // Move focus right

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

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `color` | string | `'#FFC107'` | Focus highlight color (amber) |
| `outlineWidth` | number | `3` | Outline width in CSS pixels |
| `outlineOffset` | number | `3` | Outline offset in CSS pixels |
| `overlayZIndex` | number | `2147483646` | Overlay z-index |
| `arrowScale` | number | `1.0` | Directional chevron scale |
| `disabledColor` | string | `'128, 128, 128'` | Disabled/boundary indicator RGB string |
| `overlayTheme` | string | `'default'` | `'default'` or `'high-contrast'` preset |
| `safeAreaMargin` | number | `12` | Safe-area/overscan margin in CSS pixels |
| `overlayScrimOpacity` | number | `0.06` | Inner scrim opacity (0–1) |
| `overlayGlowOpacity` | number | `0.35` | Outer glow opacity (0–1) |
| `overlayGlowBlur` | number | `14` | Outer glow blur radius in CSS pixels |
| `autoRefocus` | boolean | `true` | Recover focus when lost |

### Observation Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `observeMutations` | boolean | `true` | Watch for DOM changes |
| `observeScroll` | boolean | `true` | Update on scroll |
| `traverseShadowDom` | boolean | `false` | Recurse into Shadow DOM |
| `observeVirtualContainers` | boolean | `true` | Detect virtual scroll |
| `enableAria` | boolean | `false` | Enable ARIA announcements |
| `focusTrapDetection` | boolean | `false` | Detect modals/dialogs |
| `precomputeCandidates` | boolean | `true` | Background pre-computation |

### Scoring Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `scoringMode` | string | `'geometric'` | Algorithm: `'geometric'` or `'grid'` |
| `distanceFunction` | string | `'euclidean'` | Distance: `'euclidean'`, `'manhattan'`, `'projected'` |
| `overlapThreshold` | number | `0` | Pixels of overlap allowed (BBC LRUD) |
| `gridAlignmentTolerance` | number | `20` | Pixels tolerance for grid alignment |
| `wrapNavigation` | boolean | `false` | Wrap focus at container boundaries |
| `useCSSProperties` | boolean | `true` | Read `--spatial-navigation-*` CSS |

### Focus Group Options

```html
<div data-focus-group="id;boundary=contain;enterMode=last;remember=true">
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

| Type | Payload | Description |
|------|---------|-------------|
| `spatialNavInit` | `{ url, version }` | Extension initialized |
| `focusChange` | `{ direction, fromElement, toElement }` | Focus moved |
| `focusExit` | `{ direction, inTrap }` | Reached boundary |

### Messages from Native → Extension

| Type | Payload | Description |
|------|---------|-------------|
| `navigate` | `{ direction }` | Request navigation |
| `configUpdate` | `{ ...config }` | Update config |
| `refresh` | `{}` | Re-scan focusables |

## Building

```bash
# Install dependencies
npm install

# Build all outputs
npm run build:all

# Build minified only
npm run build

# Build debug (unminified)
npm run build:debug

# Run tests
# Run tests
npm test

# Run performance benchmarks
npm run test:benchmark
```

### Output Files

| File | Format | Size | Use Case |
|------|--------|------|----------|
| `dist/spatial-navigation.js` | UMD | ~20KB | General usage |
| `dist/spatial-navigation.esm.js` | ESM | ~20KB | Modern bundlers |
| `dist/spatial-navigation.extension.js` | IIFE | ~20KB | GeckoView extension |
| `dist/spatial-navigation.debug.js` | IIFE | ~50KB | Development |

## Comparison with Other Libraries

### vs WICG Polyfill

| Feature | WICG Polyfill | This Extension |
|---------|---------------|----------------|
| W3C API | Full | Partial |
| CSS Properties | Yes | Yes |
| Visual Overlay | No | Yes |
| Native Messaging | No | Yes |
| Virtual Scroll | No | Yes |

### vs Pathduck/spatialnavigation

| Feature | Pathduck | This Extension |
|---------|----------|----------------|
| Sections | Yes | Focus Groups |
| Visual Feedback | Class only | Animated overlay |
| React/Vue | No | Framework-aware |
| Shadow DOM | No | Yes |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development guidelines.

## License

MIT
