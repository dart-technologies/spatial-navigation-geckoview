# Changelog

All notable changes to the Spatial Navigation for GeckoView extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `color` | string | `'#FFC107'` | Focus highlight color |
| `outlineWidth` | number | `3` | Outline width in pixels |
| `autoRefocus` | boolean | `true` | Recover focus when lost |
| `observeMutations` | boolean | `true` | Watch for DOM changes |
| `observeScroll` | boolean | `true` | Update on scroll |
| `traverseShadowDom` | boolean | `false` | Recurse into Shadow DOM |
| `observeVirtualContainers` | boolean | `true` | Detect virtual scroll |
| `enableAria` | boolean | `false` | Enable ARIA announcements |
| `focusTrapDetection` | boolean | `false` | Detect modals/dialogs |
| `precomputeCandidates` | boolean | `true` | Background pre-computation |
| `scoringMode` | string | `'geometric'` | Algorithm: geometric or grid |
| `distanceFunction` | string | `'euclidean'` | Distance calculation method |
| `overlapThreshold` | number | `0` | Pixels of overlap allowed |
| `gridAlignmentTolerance` | number | `20` | Grid alignment tolerance |
| `wrapNavigation` | boolean | `false` | Wrap at boundaries |
| `useCSSProperties` | boolean | `true` | Read CSS custom properties |
