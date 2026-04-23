(function () {
    'use strict';

    /**
     * Tree-shakeable Logging System for Spatial Navigation
     *
     * Provides structured logging with:
     * - Build-time DEBUG constant for tree-shaking (replaced by Rollup)
     * - Runtime opt-in via window.SPATIAL_NAV_DEBUG / flutterSpatialNavDebug
     * - Namespaced loggers for subsystems
     * - Performance timing utilities
     *
     * Usage:
     *   import { createLogger, DEBUG } from './logger';
     *   const log = createLogger('Movement');
     *   log.debug('Moving focus', { direction: 'down' });
     *
     * Build-time: Rollup replaces `"development"` with "production" or "development".
     * Production builds tree-shake debug calls; runtime opt-in still works for live debugging.
     */
    /**
     * Build-time debug flag.
     * Replaced by Rollup's @rollup/plugin-replace at build time.
     * In production builds this is `false`, allowing Terser to eliminate debug-only code.
     */
    const DEBUG = /* @__PURE__ */ (() => {
        if (typeof process !== 'undefined') {
            const env = process.env;
            if (env?.NODE_ENV === 'production')
                return false;
        }
        return true;
    })();
    /**
     * Runtime debug flag — checked on every log call.
     * Lets users enable verbose logging in a production build by setting
     * `window.SPATIAL_NAV_DEBUG = true` (or the legacy `flutterSpatialNavDebug = true`).
     */
    function isRuntimeDebugEnabled() {
        if (typeof window === 'undefined')
            return false;
        const w = window;
        return w.SPATIAL_NAV_DEBUG === true || w.flutterSpatialNavDebug === true;
    }
    const LOG_LEVEL_ORDER = {
        debug: 0,
        info: 1,
        warn: 2,
        error: 3,
        silent: 4,
    };
    let currentLevel = DEBUG ? 'debug' : 'warn';
    function shouldLog(level) {
        return LOG_LEVEL_ORDER[level] >= LOG_LEVEL_ORDER[currentLevel];
    }
    function formatMessage(namespace, message) {
        return `[SpatialNav:${namespace}] ${message}`;
    }
    /**
     * Create a namespaced logger.
     *
     * @param namespace - Logger namespace (e.g., 'Movement', 'Scoring', 'DOM')
     */
    function createLogger(namespace) {
        const timers = new Map();
        return {
            debug(message, data) {
                // Tree-shakeable in production: when DEBUG is false at build time,
                // this whole branch can be removed by Terser unless runtime opt-in fires.
                if (!DEBUG && !isRuntimeDebugEnabled())
                    return;
                if (!shouldLog('debug'))
                    return;
                if (data !== undefined) {
                    console.log(formatMessage(namespace, message), data);
                }
                else {
                    console.log(formatMessage(namespace, message));
                }
            },
            info(message, data) {
                if (!shouldLog('info'))
                    return;
                if (data !== undefined) {
                    console.info(formatMessage(namespace, message), data);
                }
                else {
                    console.info(formatMessage(namespace, message));
                }
            },
            warn(message, data) {
                if (!shouldLog('warn'))
                    return;
                if (data !== undefined) {
                    console.warn(formatMessage(namespace, message), data);
                }
                else {
                    console.warn(formatMessage(namespace, message));
                }
            },
            error(message, data) {
                if (!shouldLog('error'))
                    return;
                if (data !== undefined) {
                    console.error(formatMessage(namespace, message), data);
                }
                else {
                    console.error(formatMessage(namespace, message));
                }
            },
            time(label) {
                if (!DEBUG && !isRuntimeDebugEnabled())
                    return;
                timers.set(label, performance.now());
            },
            timeEnd(label) {
                if (!DEBUG && !isRuntimeDebugEnabled())
                    return;
                const start = timers.get(label);
                if (start !== undefined) {
                    const duration = performance.now() - start;
                    timers.delete(label);
                    this.debug(`${label}: ${duration.toFixed(2)}ms`);
                }
            },
            group(label) {
                if (!DEBUG && !isRuntimeDebugEnabled())
                    return;
                if (!shouldLog('debug'))
                    return;
                console.group(formatMessage(namespace, label));
            },
            groupEnd() {
                if (!DEBUG && !isRuntimeDebugEnabled())
                    return;
                if (!shouldLog('debug'))
                    return;
                console.groupEnd();
            },
        };
    }

    /**
     * Configuration management for GeckoView Spatial Navigation.
     *
     * Reads from `window.spatialNavConfig` (or the legacy `window.flutterSpatialNavConfig`),
     * validates user input against a schema, and merges with defaults.
     *
     * Public surface:
     *   - {@link getConfig} — get the merged effective config
     *   - {@link updateConfig} — patch config at runtime
     *   - {@link validateUserConfig} — sanitize an arbitrary input record
     *   - {@link CONFIG_PRESETS} / {@link applyPreset} — TV / phone / tablet / kiosk profiles
     *   - {@link SCORING_CONSTANTS} — score weights used by the scoring algorithm
     */
    const log$f = createLogger('Config');
    // =============================================================================
    // Scoring constants
    // =============================================================================
    /**
     * Score-weight constants used by the scoring algorithm.
     *
     * The implicit hierarchy is intentional:
     *
     *   SAME_GROUP_BONUS (2000)
     *     > GROUP_ENTER_LAST_BONUS (1000)
     *     > GRID_BONUS (500)
     *     > SAME_SCROLL_BONUS (150)
     *     > OFFSCREEN_PENALTY (120)
     *     > DIFFERENT_SCROLL_PENALTY (75)
     *
     * "Stay in the same focus group" outranks every other consideration so users
     * don't spuriously jump out of a logical region (sidebar, modal, list). Inside
     * the same group, grid alignment beats scroll-container co-location, and the
     * smaller scroll-related nudges only act as tiebreakers between otherwise
     * equivalent candidates.
     *
     * If you tune these, the test suite in `__tests__/scoring.test.ts` exercises
     * the boundaries — keep that suite green.
     */
    const SCORING_CONSTANTS = {
        /** Tiny epsilon for float comparisons (px). */
        EPSILON: 1,
        /** Allowed overlap when checking strict-edge containment (px, before adding overlapThreshold). */
        EDGE_EPS_BASE: 4,
        /**
         * When `allowOverlap` is true, candidates may overlap the current element by this many
         * pixels in the navigation axis (before adding overlapThreshold).
         */
        FORWARD_OVERLAP_TOLERANCE_PX: 12,
        /** Off-axis spread allowed inside the navigation cone, base value (px). */
        CONE_TOLERANCE_BASE_PX: 4,
        /** Off-axis spread is also bounded by `primary * CONE_TOLERANCE_RATIO`. */
        CONE_TOLERANCE_RATIO: 3,
        /** Alignment baseline — perfect alignment scores this. */
        ALIGNMENT_BASE: 10,
        /** Alignment decay rate (px). Larger = more forgiving. */
        ALIGNMENT_DECAY_PX: 50,
        /** Projected-distance secondary axis weight (lower = strongly prefer aligned candidates). */
        PROJECTED_SECONDARY_WEIGHT: 0.5,
        /** Score weight applied to primary-axis distance — dominant factor in the linear score. */
        PRIMARY_WEIGHT: 1000,
        /** Bonus (subtracted from score) when a grid-aligned candidate is found in grid mode. */
        GRID_BONUS: 500,
        /** Bonus (subtracted) when candidate is in the same focus group as the current element. */
        SAME_GROUP_BONUS: 2000,
        /** Bonus (subtracted) when entering a group via its remembered last-focused element. */
        GROUP_ENTER_LAST_BONUS: 1000,
        /** Bonus (subtracted) when candidate shares the current element's scroll container. */
        SAME_SCROLL_BONUS: 150,
        /** Penalty (added) when candidate is in a different scroll container. */
        DIFFERENT_SCROLL_PENALTY: 75,
        /** Penalty (added) when candidate is off-screen. */
        OFFSCREEN_PENALTY: 120,
    };
    const globalScope = typeof window !== 'undefined' ? window : globalThis;
    /**
     * Default focus indicator color.
     *
     * `#1565C0` — blue 800 — gives ~5.4:1 contrast against white and ~3.2:1
     * against black, both clearing the WCAG 2.1 non-text contrast minimum (3:1).
     * The previous default of `#FFC107` (amber) only achieved ~1.6:1 on white.
     */
    const DEFAULT_FOCUS_COLOR = '#1565C0';
    /**
     * Get the current spatial navigation configuration.
     * Merges user-provided config with defaults.
     */
    function getConfig() {
        const rawUserConfig = globalScope.spatialNavConfig || globalScope.flutterSpatialNavConfig || {};
        const userConfig = validateUserConfig(rawUserConfig);
        return {
            // Visual styling
            color: userConfig.color || DEFAULT_FOCUS_COLOR,
            outlineWidth: userConfig.outlineWidth || 3,
            outlineOffset: userConfig.outlineOffset || 3,
            overlayZIndex: userConfig.overlayZIndex || 2147483646,
            arrowScale: typeof userConfig.arrowScale === 'number' ? userConfig.arrowScale : 1.0,
            disabledColor: userConfig.disabledColor || '128, 128, 128',
            overlayTheme: userConfig.overlayTheme === 'high-contrast' ? 'high-contrast' : 'default',
            safeAreaMargin: typeof userConfig.safeAreaMargin === 'number' ? Math.max(0, userConfig.safeAreaMargin) : 12,
            overlayScrimOpacity: typeof userConfig.overlayScrimOpacity === 'number'
                ? Math.min(Math.max(userConfig.overlayScrimOpacity, 0), 1)
                : 0.06,
            overlayGlowOpacity: typeof userConfig.overlayGlowOpacity === 'number'
                ? Math.min(Math.max(userConfig.overlayGlowOpacity, 0), 1)
                : 0.35,
            overlayGlowBlur: typeof userConfig.overlayGlowBlur === 'number' ? Math.max(0, userConfig.overlayGlowBlur) : 14,
            // Dynamic content observation
            observeMutations: userConfig.observeMutations !== false,
            observeScroll: userConfig.observeScroll !== false,
            mutationDebounce: userConfig.mutationDebounce || 100,
            scrollThreshold: userConfig.scrollThreshold || 8,
            // Intersection observer (lazy-load support)
            observeIntersection: userConfig.observeIntersection === true,
            intersectionRootMargin: userConfig.intersectionRootMargin || '200px',
            intersectionThreshold: typeof userConfig.intersectionThreshold === 'number'
                ? Math.min(Math.max(userConfig.intersectionThreshold, 0), 1)
                : 0,
            // Recovery / refocus
            autoRefocus: userConfig.autoRefocus !== false,
            refocusStrategy: userConfig.refocusStrategy || 'closest',
            // iframe handling
            iframeSupport: {
                enabled: userConfig.iframeSupport?.enabled === true,
                selector: userConfig.iframeSupport?.selector || 'iframe',
                focusMethod: userConfig.iframeSupport?.focusMethod || 'element',
            },
            focusGroups: {
                enabled: userConfig.focusGroups?.enabled ?? false,
                defaultRules: userConfig.focusGroups?.defaultRules ?? {},
                boundaryBehavior: userConfig.focusGroups?.boundaryBehavior ?? 'exit',
            },
            // Shadow DOM traversal
            traverseShadowDom: userConfig.traverseShadowDom === true,
            // Virtual scroll / infinite list support
            observeVirtualContainers: userConfig.observeVirtualContainers !== false,
            virtualContainerSelectors: userConfig.virtualContainerSelectors || [
                '[data-virtualized]',
                '.ReactVirtualized__Grid',
                '.ReactVirtualized__List',
                '[data-testid="virtuoso-item-list"]',
                '.infinite-scroll-component',
                '[data-infinite-scroll]',
                'ytd-rich-grid-renderer',
                '[data-testid="primaryColumn"]',
            ],
            virtualScrollDebounce: userConfig.virtualScrollDebounce || 150,
            // Accessibility / ARIA announcements
            enableAria: userConfig.enableAria === true,
            announceNavigation: userConfig.announceNavigation === true,
            announceBoundaries: userConfig.announceBoundaries === true,
            verboseDescriptions: userConfig.verboseDescriptions === true,
            // Focus trap detection
            focusTrapDetection: userConfig.focusTrapDetection === true,
            // Framework-aware refresh
            frameworkAwareRefresh: userConfig.frameworkAwareRefresh !== false,
            // Candidate pre-computation
            precomputeCandidates: userConfig.precomputeCandidates !== false,
            precomputeCacheTimeout: userConfig.precomputeCacheTimeout || 500,
            // Scoring algorithm mode
            scoringMode: userConfig.scoringMode || 'geometric',
            distanceFunction: userConfig.distanceFunction || 'euclidean',
            // Overlap threshold
            overlapThreshold: typeof userConfig.overlapThreshold === 'number' ? userConfig.overlapThreshold : 0,
            // Grid mode settings
            gridAlignmentTolerance: typeof userConfig.gridAlignmentTolerance === 'number' ? userConfig.gridAlignmentTolerance : 20,
            // Wrap navigation
            wrapNavigation: userConfig.wrapNavigation === true,
            // CSS custom property integration
            useCSSProperties: userConfig.useCSSProperties !== false,
            // Element filtering
            minElementSize: typeof userConfig.minElementSize === 'number' ? userConfig.minElementSize : 1,
            // Native app identifier (matches the host app's WebExtension registration).
            nativeAppId: userConfig.nativeAppId || 'flutter_geckoview',
        };
    }
    // =============================================================================
    // Validation
    // =============================================================================
    const STRING_KEYS = new Set(['color', 'disabledColor', 'intersectionRootMargin', 'nativeAppId']);
    const NUMBER_KEYS = new Set([
        'outlineWidth',
        'outlineOffset',
        'overlayZIndex',
        'arrowScale',
        'safeAreaMargin',
        'overlayScrimOpacity',
        'overlayGlowOpacity',
        'overlayGlowBlur',
        'mutationDebounce',
        'scrollThreshold',
        'intersectionThreshold',
        'virtualScrollDebounce',
        'precomputeCacheTimeout',
        'overlapThreshold',
        'gridAlignmentTolerance',
        'minElementSize',
    ]);
    const BOOLEAN_KEYS = new Set([
        'observeMutations',
        'observeScroll',
        'observeIntersection',
        'autoRefocus',
        'traverseShadowDom',
        'observeVirtualContainers',
        'enableAria',
        'announceNavigation',
        'announceBoundaries',
        'verboseDescriptions',
        'focusTrapDetection',
        'frameworkAwareRefresh',
        'precomputeCandidates',
        'wrapNavigation',
        'useCSSProperties',
    ]);
    const ENUM_KEYS = {
        overlayTheme: new Set(['default', 'high-contrast']),
        refocusStrategy: new Set(['closest', 'first']),
        scoringMode: new Set(['geometric', 'grid']),
        distanceFunction: new Set(['euclidean', 'manhattan', 'projected']),
    };
    const ARRAY_KEYS = new Set(['virtualContainerSelectors']);
    const OBJECT_KEYS = new Set(['iframeSupport', 'focusGroups']);
    /**
     * Sanitize an arbitrary user-provided config object.
     *
     * Each key is checked against its expected type; mismatched values are
     * dropped with a logger warning so the caller knows something they wrote was
     * ignored. Unknown keys are also dropped (defends against typos and stale
     * docs).
     */
    function validateUserConfig(input) {
        const out = {};
        if (!input || typeof input !== 'object' || Array.isArray(input)) {
            return out;
        }
        const obj = input;
        for (const key of Object.keys(obj)) {
            const value = obj[key];
            if (STRING_KEYS.has(key)) {
                if (typeof value === 'string') {
                    out[key] = value;
                }
                else {
                    log$f.warn(`config.${key}: expected string, got ${typeof value} — ignored`);
                }
                continue;
            }
            if (NUMBER_KEYS.has(key)) {
                if (typeof value === 'number' && Number.isFinite(value)) {
                    out[key] = value;
                }
                else {
                    log$f.warn(`config.${key}: expected finite number, got ${typeof value} — ignored`);
                }
                continue;
            }
            if (BOOLEAN_KEYS.has(key)) {
                if (typeof value === 'boolean') {
                    out[key] = value;
                }
                else {
                    log$f.warn(`config.${key}: expected boolean, got ${typeof value} — ignored`);
                }
                continue;
            }
            if (key in ENUM_KEYS) {
                if (typeof value === 'string' && ENUM_KEYS[key].has(value)) {
                    out[key] = value;
                }
                else {
                    const allowed = Array.from(ENUM_KEYS[key]).join(', ');
                    log$f.warn(`config.${key}: must be one of [${allowed}] — got ${JSON.stringify(value)}, ignored`);
                }
                continue;
            }
            if (ARRAY_KEYS.has(key)) {
                if (Array.isArray(value) && value.every((v) => typeof v === 'string')) {
                    out[key] = value;
                }
                else {
                    log$f.warn(`config.${key}: expected string[], got ${typeof value} — ignored`);
                }
                continue;
            }
            if (OBJECT_KEYS.has(key)) {
                if (value && typeof value === 'object' && !Array.isArray(value)) {
                    out[key] = value;
                }
                else {
                    log$f.warn(`config.${key}: expected object, got ${typeof value} — ignored`);
                }
                continue;
            }
            log$f.warn(`config.${key}: unknown key — ignored`);
        }
        return out;
    }
    // =============================================================================
    // Direction maps
    // =============================================================================
    const directionByKey = {
        ArrowDown: { axis: 'y', sign: 1, name: 'down' },
        ArrowUp: { axis: 'y', sign: -1, name: 'up' },
        ArrowRight: { axis: 'x', sign: 1, name: 'right' },
        ArrowLeft: { axis: 'x', sign: -1, name: 'left' },
    };
    const directionByName = {
        down: directionByKey.ArrowDown,
        up: directionByKey.ArrowUp,
        right: directionByKey.ArrowRight,
        left: directionByKey.ArrowLeft,
    };
    const directionKeys = ['down', 'up', 'right', 'left'];

    /**
     * Global state management for GeckoView Spatial Navigation System
     *
     * Maintains focus state with persistence across page navigations.
     * State is stored on window.spatialNavState to survive SPA navigations.
     */
    /**
     * Initialize or retrieve the global spatial navigation state.
     * State persists across page navigations in SPAs.
     */
    function getState(config) {
        // Reuse existing state if available (SPA navigation)
        // Support both new and legacy names
        const existingState = window.spatialNavState || window.flutterFocusState;
        const state = existingState || {};
        // Persist to both names for compatibility
        window.spatialNavState = state;
        window.flutterFocusState = state;
        // Core navigation state
        state.config = config;
        state.version = '3.0.0';
        state.currentIndex = typeof state.currentIndex === 'number' ? state.currentIndex : -1;
        state.initialized = !!state.initialized;
        state.handlersAttached = !!state.handlersAttached;
        state.runtime = state.runtime || {
            mode: 'injected',
            hasBrowser: false,
            hasChrome: false,
            canConnect: false,
            canSendMessage: false,
        };
        // Focus tracking arrays
        state.focusables = Array.isArray(state.focusables) ? state.focusables : [];
        state.focusableElements = Array.isArray(state.focusableElements) ? state.focusableElements : [];
        state.focusGroups = state.focusGroups || {};
        state.lastRefreshTime = state.lastRefreshTime || 0;
        state.focusableCount = state.focusableCount || 0;
        // Preview/animation state
        state.previewEnabled = state.previewEnabled !== undefined ? !!state.previewEnabled : true;
        state.previewElements = state.previewElements || null;
        state.previewLayer = state.previewLayer || null;
        state.overlay = state.overlay || null;
        state.overlayHost = state.overlayHost || null;
        state.activeResizeObserver = state.activeResizeObserver || null;
        state.updateTimer = state.updateTimer || null;
        state.overlaySuppressed = state.overlaySuppressed ?? false;
        state.nextTargets = state.nextTargets || { up: null, down: null, left: null, right: null };
        state.noTargetTimers = state.noTargetTimers || { up: null, down: null, left: null, right: null };
        state.lastFocusedElement = state.lastFocusedElement || null;
        state.lastFocusPosition = state.lastFocusPosition || null;
        state.lastMove = state.lastMove || null;
        state.lastBoundary = state.lastBoundary || null;
        // Performance caches
        state.scrollCache = state.scrollCache || new WeakMap();
        state.scrollListenerAttached = !!state.scrollListenerAttached;
        // Observers
        state.intersectionObserver = state.intersectionObserver || null;
        state.mutationObserver = state.mutationObserver || null;
        // Debugging/instrumentation
        state.emitTitleOnMismatch = !!state.emitTitleOnMismatch;
        state.instrumentation = state.instrumentation || {
            lastOverlay: '',
            lastActive: '',
            mismatchCount: 0,
            overlayIndex: -1,
            activeIndex: -1,
            lastMismatch: null,
            lastUpdate: 0,
            lastDirection: '',
        };
        // Performance monitoring
        state.perf = state.perf || {
            refreshCount: 0,
            totalRefreshTime: 0,
            averageRefreshTime: 0,
            lastRefreshTime: 0,
            slowRefreshCount: 0,
        };
        // Virtual scroll / infinite list state
        state.virtualContainers = state.virtualContainers || [];
        state.virtualSentinelObserver = state.virtualSentinelObserver || null;
        state.virtualScrollPending = false;
        // Candidate pre-computation cache
        state.precomputedTargets = state.precomputedTargets || null;
        state.precomputedForIndex = state.precomputedForIndex ?? -1;
        state.precomputedTimestamp = state.precomputedTimestamp ?? 0;
        state.dirty = state.dirty ?? false;
        // Accessibility announcer
        state.announcer = state.announcer || null;
        // Focus trap state
        state.currentTrap = state.currentTrap || null;
        // Framework detection cache
        state.detectedFramework = state.detectedFramework || null;
        // Handler ID for stale handler detection (0 means not yet assigned)
        state.handlerId = state.handlerId || 0;
        return state;
    }

    /**
     * Geometry utilities for GeckoView Spatial Navigation System
     *
     * Handles element position calculations, visibility checks, and rect operations.
     */
    const ZERO_RECT = typeof DOMRect !== 'undefined'
        ? new DOMRect(0, 0, 0, 0)
        : {
            x: 0,
            y: 0,
            width: 0,
            height: 0,
            top: 0,
            right: 0,
            bottom: 0,
            left: 0,
            toJSON: () => ({}),
        };
    /**
     * Safe wrapper for `getBoundingClientRect()`.
     *
     * Defends against detached nodes / DOM-thrashing during mutation observer
     * callbacks where calling `getBoundingClientRect()` can throw on some engines.
     * Returns a zero-sized rect on failure so callers never need to null-check.
     */
    function safeGetBoundingClientRect(element) {
        if (!element || typeof element.getBoundingClientRect !== 'function') {
            return ZERO_RECT;
        }
        try {
            return element.getBoundingClientRect();
        }
        catch {
            return ZERO_RECT;
        }
    }
    /**
     * Resolve the scroll container key for an element.
     * Uses caching to avoid repeated DOM traversals.
     */
    function resolveScrollKey(element, state) {
        if (!element || element === document.body || element === document.documentElement) {
            return 'body';
        }
        const cached = state.scrollCache.get(element);
        if (cached !== undefined) {
            return cached;
        }
        let node = element;
        while (node && node !== document.body && node !== document.documentElement) {
            const style = window.getComputedStyle(node);
            const overflow = (style.overflow + style.overflowX + style.overflowY).toLowerCase();
            if (overflow.includes('auto') || overflow.includes('scroll')) {
                const key = node.id && node.id.length
                    ? '#' + node.id
                    : node.className && node.className.toString().trim().length
                        ? node.tagName.toLowerCase() +
                            '.' +
                            node.className.toString().trim().split(/\s+/).slice(0, 2).join('.')
                        : node.tagName.toLowerCase();
                state.scrollCache.set(element, key);
                return key;
            }
            node = node.parentElement;
        }
        state.scrollCache.set(element, 'body');
        return 'body';
    }
    /**
     * Calculate the visual bounding rect for an element, potentially expanding
     * it to encompass a larger visual child (logo, image, etc).
     */
    function calculateVisualRect(element) {
        let rect = safeGetBoundingClientRect(element);
        // For elements like logos/image-buttons whose hit area is smaller than the
        // visual asset, expand the rect to cover the larger child. This makes the
        // focus indicator highlight what the user *sees*, not the tap target.
        const visualChild = element.querySelector('img, svg, video, picture, canvas');
        if (visualChild) {
            const childRect = safeGetBoundingClientRect(visualChild);
            if (childRect.width > rect.width ||
                childRect.height > rect.height ||
                childRect.left < rect.left ||
                childRect.top < rect.top) {
                rect = childRect;
            }
        }
        return rect;
    }
    /**
     * Update geometry properties for a focusable entry.
     * Calculates bounding rect, center point, and scroll container.
     */
    function updateEntryGeometry(entry, state) {
        if (!entry || !entry.element || typeof entry.element.getBoundingClientRect !== 'function') {
            return null;
        }
        // Use the base bounding rect for navigation logic (center points, distance, edges).
        // Visual expansion (logos, image-buttons) only affects the overlay rect via
        // calculateVisualRect; navigation distances stay anchored to the real target.
        const rect = safeGetBoundingClientRect(entry.element);
        entry.left = rect.left;
        entry.top = rect.top;
        entry.right = rect.right;
        entry.bottom = rect.bottom;
        entry.width = rect.width;
        entry.height = rect.height;
        entry.centerX = rect.left + rect.width / 2;
        entry.centerY = rect.top + rect.height / 2;
        entry.rect = rect;
        entry.scrollKey = resolveScrollKey(entry.element, state);
        return entry;
    }
    /**
     * Check if a rect is visible within viewport with optional margin.
     */
    function isRectVisible(rect, margin) {
        if (!rect) {
            return false;
        }
        const m = Math.max(0, margin || 0);
        const horizontalVisible = rect.right >= -m && rect.left <= window.innerWidth + m;
        const verticalVisible = rect.bottom >= -m && rect.top <= window.innerHeight + m;
        return horizontalVisible && verticalVisible;
    }

    /**
     * Runtime & platform detection.
     *
     * GeckoView can run this bundle either:
     *  - As a WebExtension content script (browser/chrome runtime APIs available)
     *  - As an injected script (no extension runtime APIs)
     *
     * Other hosts (ReactNative WebView, iOS WKWebView, Android WebView) expose
     * different globals — {@link detectPlatform} returns a discriminated enum so
     * the messaging factory can pick the right adapter.
     */
    function globalHost() {
        return globalThis;
    }
    // ---------------------------------------------------------------------------
    // Fine-grained runtime context (consumed by state / debug HUD)
    // ---------------------------------------------------------------------------
    /**
     * Build a detailed runtime-context object used by the debug HUD and the
     * {@link formatRuntimeLabel} instrumentation.
     */
    function detectRuntimeContext() {
        const g = globalHost();
        const hasBrowser = typeof g.browser !== 'undefined' && !!g.browser;
        const hasChrome = typeof g.chrome !== 'undefined' && !!g.chrome;
        const runtime = g.browser?.runtime ?? g.chrome?.runtime;
        const canConnect = typeof runtime?.connect === 'function';
        const canSendMessage = typeof runtime?.sendMessage === 'function';
        // If either browser/chrome exists, treat this as WebExtension mode.
        const mode = hasBrowser || hasChrome ? 'webextension' : 'injected';
        return { mode, hasBrowser, hasChrome, canConnect, canSendMessage };
    }
    function formatRuntimeLabel(context) {
        if (context.mode === 'webextension') {
            const bridge = context.canSendMessage ? 'bridge:on' : 'bridge:off';
            return `WebExtension (${bridge})`;
        }
        return 'Injected (no bridge)';
    }

    /**
     * Overlay management for GeckoView Spatial Navigation System
     *
     * Creates and manages Shadow DOM overlay for visual focus indicators.
     * Includes main focus overlay and directional preview elements.
     */
    const log$e = createLogger('Overlay');
    /** Returns true when build-time DEBUG is on or runtime opt-in is set. */
    function isDebugActive() {
        if (DEBUG)
            return true;
        if (typeof window === 'undefined')
            return false;
        return window.SPATIAL_NAV_DEBUG === true || window.flutterSpatialNavDebug === true;
    }
    // Constants
    const styleId = 'spatnav-focus-styles';
    const overlayHostId = 'spatnav-focus-host';
    const focusOverlayId = 'spatnav-focus-overlay';
    const overlayLabelId = 'spatnav-focus-label';
    const debugHudId = 'spatnav-debug-hud';
    const themeAttr = 'data-spatnav-theme';
    const runtimeAttr = 'data-spatnav-runtime';
    /**
     * Ensure CSS styles are injected into document head.
     * Removes default focus outlines since Shadow DOM provides visual indicator.
     */
    function ensureStyles(_config) {
        const css = `
/* GeckoView Spatial Nav: Shadow DOM overlay provides focus indicator */
*:focus,
*:focus-visible,
*:focus-within,
a:focus, a:focus-visible,
a:link:focus, a:visited:focus, a:hover:focus, a:active:focus,
button:focus, button:focus-visible,
input:focus, input:focus-visible,
select:focus, textarea:focus,
[tabindex]:focus, [tabindex]:focus-visible,
[contenteditable]:focus,
body *:focus, body *:focus-visible {
    outline: none !important;
    outline-width: 0 !important;
    outline-style: none !important;
    outline-color: transparent !important;
    box-shadow: none !important;
    -webkit-focus-ring-color: transparent !important;
    -webkit-tap-highlight-color: transparent !important;
}
/* Also suppress Firefox-specific focus rings */
*::-moz-focus-inner {
    border: 0 !important;
}

/* Spatial navigation press feedback */
.spatnav-pressed {
    transform: scale(0.97) !important;
    transition: transform 0.09s ease-out !important;
    will-change: transform;
}
@media (prefers-reduced-motion: reduce) {
    .spatnav-pressed {
        transition: none !important;
        transform: none !important;
    }
}
`;
        let style = document.getElementById(styleId);
        if (!style) {
            style = document.createElement('style');
            style.id = styleId;
            document.head.appendChild(style);
        }
        style.textContent = css;
    }
    /**
     * Create or retrieve the Shadow DOM overlay host.
     * Sets up focus overlay and preview layer with CSS transitions.
     */
    function ensureOverlay(config, state) {
        if (!document.body) {
            return;
        }
        // Always remove and recreate to ensure clean state
        let host = document.getElementById(overlayHostId);
        if (host) {
            host.remove();
        }
        host = document.createElement('div');
        host.id = overlayHostId;
        host.style.cssText = `position: fixed; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; z-index: ${config.overlayZIndex || 2147483646};`;
        host.setAttribute(themeAttr, config.overlayTheme || 'default');
        // Decorative — focus is communicated via the actual focused element. The
        // overlay is purely visual chrome and should NOT be announced by AT.
        host.setAttribute('role', 'presentation');
        host.setAttribute('aria-hidden', 'true');
        document.body.appendChild(host);
        const shadow = host.attachShadow({ mode: 'open' });
        const shadowStyle = document.createElement('style');
        shadowStyle.textContent = generateShadowCSS(config);
        shadow.appendChild(shadowStyle);
        // Preview layer for directional indicators
        const previewLayer = document.createElement('div');
        previewLayer.id = 'focus-preview-layer';
        shadow.appendChild(previewLayer);
        // Main focus overlay
        const overlay = document.createElement('div');
        overlay.id = focusOverlayId;
        overlay.style.display = 'none';
        overlay.style.transform = 'translate3d(0, 0, 0)';
        shadow.appendChild(overlay);
        // Focus label (debug mode only)
        const focusLabel = document.createElement('div');
        focusLabel.id = overlayLabelId;
        const labelText = document.createElement('span');
        labelText.className = 'sn-label-text';
        const labelRuntime = document.createElement('span');
        labelRuntime.className = 'sn-label-badge sn-label-runtime';
        const labelSuppressed = document.createElement('span');
        labelSuppressed.className = 'sn-label-badge sn-label-suppressed';
        focusLabel.appendChild(labelText);
        focusLabel.appendChild(labelRuntime);
        focusLabel.appendChild(labelSuppressed);
        shadow.appendChild(focusLabel);
        // Debug HUD (always visible in debug mode)
        const hud = document.createElement('div');
        hud.id = debugHudId;
        hud.style.display = 'none';
        shadow.appendChild(hud);
        // Update state references
        const overlayRef = host.shadowRoot?.getElementById(focusOverlayId);
        if (overlayRef) {
            state.overlay = overlayRef;
            updateRuntimeLabel(state);
            updateDebugHud(state);
        }
        else {
            log$e.error('failed to get overlay reference from shadow DOM');
        }
        if (host.shadowRoot) {
            const previewRef = host.shadowRoot.getElementById('focus-preview-layer');
            if (previewRef) {
                state.previewLayer = previewRef;
            }
        }
        state.overlayHost = host;
    }
    function updateRuntimeLabel(state) {
        if (!state.overlay)
            return;
        // Only show the runtime label in debug mode.
        if (!isDebugActive()) {
            state.overlay.removeAttribute(runtimeAttr);
            return;
        }
        const runtime = state.runtime;
        if (!runtime) {
            state.overlay.removeAttribute(runtimeAttr);
            return;
        }
        const label = formatRuntimeLabel(runtime);
        state.overlay.setAttribute(runtimeAttr, label);
    }
    function updateDebugHud(state) {
        const shadow = state.overlayHost?.shadowRoot;
        if (!shadow)
            return;
        const hud = shadow.getElementById(debugHudId);
        if (!hud)
            return;
        if (!isDebugActive()) {
            hud.style.display = 'none';
            return;
        }
        const runtime = state.runtime ? formatRuntimeLabel(state.runtime) : 'unknown';
        const suppressed = state.overlaySuppressed ? 'suppressed' : 'active';
        hud.textContent = `SpatialNav · ${runtime} · ${suppressed}`;
        const safe = Math.max(0, state.config?.safeAreaMargin ?? 0);
        hud.style.left = safe + 8 + 'px';
        hud.style.top = safe + 8 + 'px';
        hud.style.display = 'block';
    }
    function getElementLabelText(element) {
        const ariaLabel = element.getAttribute('aria-label')?.trim();
        if (ariaLabel)
            return ariaLabel;
        const ariaLabelledBy = element.getAttribute('aria-labelledby')?.trim();
        if (ariaLabelledBy) {
            const ids = ariaLabelledBy.split(/\s+/).filter(Boolean);
            for (const id of ids) {
                const labelEl = document.getElementById(id);
                const text = labelEl?.textContent?.trim();
                if (text)
                    return text;
            }
        }
        const title = element.getAttribute('title')?.trim();
        if (title)
            return title;
        const alt = element.getAttribute('alt')?.trim();
        if (alt)
            return alt;
        const text = element.textContent?.replace(/\s+/g, ' ').trim();
        if (text)
            return text;
        const role = element.getAttribute('role')?.trim();
        if (role)
            return role;
        return element.tagName.toLowerCase();
    }
    function truncateLabel(text, maxChars) {
        if (!text)
            return '';
        const normalized = text.replace(/\s+/g, ' ').trim();
        if (normalized.length <= maxChars)
            return normalized;
        return normalized.slice(0, Math.max(0, maxChars - 1)).trimEnd() + '…';
    }
    function updateFocusLabel(state, focusedElement, overlayRect) {
        const shadow = state.overlayHost?.shadowRoot;
        if (!shadow)
            return;
        const label = shadow.getElementById(overlayLabelId);
        if (!label)
            return;
        if (!isDebugActive()) {
            label.classList.remove('visible');
            return;
        }
        const textEl = label.querySelector('.sn-label-text');
        const runtimeEl = label.querySelector('.sn-label-runtime');
        const suppressedEl = label.querySelector('.sn-label-suppressed');
        const raw = getElementLabelText(focusedElement);
        const text = truncateLabel(raw, 48);
        if (textEl) {
            textEl.textContent = text;
            textEl.setAttribute('title', raw);
        }
        if (runtimeEl) {
            const runtime = state.runtime ? formatRuntimeLabel(state.runtime) : 'unknown';
            runtimeEl.textContent = runtime;
            runtimeEl.style.display = runtime ? '' : 'none';
        }
        if (suppressedEl) {
            suppressedEl.textContent = state.overlaySuppressed ? 'suppressed' : '';
            suppressedEl.style.display = state.overlaySuppressed ? '' : 'none';
        }
        // Position inside the overlay, with a small inset. Clamp to viewport.
        const inset = 6;
        const safe = Math.max(0, state.config?.safeAreaMargin ?? 0);
        const maxLeft = Math.max(0, (window?.innerWidth ?? 0) - safe - 1);
        const maxTop = Math.max(0, (window?.innerHeight ?? 0) - safe - 1);
        const left = Math.min(Math.max(safe, overlayRect.left + inset), maxLeft);
        const top = Math.min(Math.max(safe, overlayRect.top + inset), maxTop);
        label.style.left = left + 'px';
        label.style.top = top + 'px';
        // Keep label reasonably sized, favoring the overlay width.
        const maxWidth = Math.min(Math.max(120, overlayRect.width - inset * 2), Math.max(120, (window?.innerWidth ?? 0) - safe * 2 - inset * 2));
        label.style.maxWidth = maxWidth + 'px';
        label.classList.add('visible');
    }
    /**
     * Parse color string to extract RGB components for opacity variants.
     */
    function parseColor(color) {
        // Default matches DEFAULT_FOCUS_COLOR (#1565C0) in core/config.ts — kept in
        // sync so a missing/malformed user color doesn't fall back to amber.
        const defaultRGB = { r: 21, g: 101, b: 192 };
        if (!color || typeof color !== 'string') {
            return defaultRGB;
        }
        // Handle hex colors
        if (color.startsWith('#')) {
            const hex = color.slice(1);
            if (hex.length === 3) {
                return {
                    r: parseInt(hex[0] + hex[0], 16),
                    g: parseInt(hex[1] + hex[1], 16),
                    b: parseInt(hex[2] + hex[2], 16),
                };
            }
            else if (hex.length === 6) {
                return {
                    r: parseInt(hex.slice(0, 2), 16),
                    g: parseInt(hex.slice(2, 4), 16),
                    b: parseInt(hex.slice(4, 6), 16),
                };
            }
        }
        // Handle rgb/rgba
        const rgbMatch = color.match(/rgba?\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
        if (rgbMatch) {
            return {
                r: parseInt(rgbMatch[1], 10),
                g: parseInt(rgbMatch[2], 10),
                b: parseInt(rgbMatch[3], 10),
            };
        }
        return defaultRGB;
    }
    /**
     * Generate Shadow DOM CSS for overlay and previews.
     */
    function generateShadowCSS(config) {
        let rgb = parseColor(config.color);
        // Auto-adjust for dark mode
        const isDarkMode = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
        if (isDarkMode) {
            const luminance = (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;
            if (luminance < 0.5) {
                rgb = {
                    r: Math.min(255, Math.round(rgb.r * 1.3)),
                    g: Math.min(255, Math.round(rgb.g * 1.3)),
                    b: Math.min(255, Math.round(rgb.b * 1.3)),
                };
            }
        }
        const colorBase = `${rgb.r}, ${rgb.g}, ${rgb.b}`;
        const overlayZIndex = config.overlayZIndex || 2147483646;
        const previewZIndex = overlayZIndex - 1;
        const arrowScale = config.arrowScale || 1.0;
        const arrowWidth = Math.round(8 * arrowScale);
        const arrowLength = Math.round(12 * arrowScale);
        const disabledColor = config.disabledColor || '128, 128, 128';
        return [
            ':host {',
            `  --sn-focus-rgb: ${colorBase};`,
            `  --sn-disabled-rgb: ${disabledColor};`,
            `  --arrow-width: ${arrowWidth}px;`,
            `  --arrow-length: ${arrowLength}px;`,
            `  --sn-scrim-alpha: ${config.overlayScrimOpacity};`,
            `  --sn-glow-alpha: ${config.overlayGlowOpacity};`,
            `  --sn-glow-blur: ${config.overlayGlowBlur}px;`,
            '  --sn-inner-glow-alpha: 0.16;',
            '  --sn-label-bg: rgba(0, 0, 0, 0.62);',
            '  --sn-label-fg: rgba(255, 255, 255, 0.92);',
            '  --sn-label-muted: rgba(255, 255, 255, 0.72);',
            '}',
            `:host([${themeAttr}="high-contrast"]) {`,
            '  --sn-scrim-alpha: 0.14;',
            '  --sn-glow-alpha: 0.55;',
            '  --sn-glow-blur: 18px;',
            '  --sn-inner-glow-alpha: 0.22;',
            '  --sn-label-bg: rgba(0, 0, 0, 0.78);',
            '}',
            `#${focusOverlayId} {`,
            '  position: fixed;',
            '  pointer-events: none;',
            '  overflow: visible;',
            '  will-change: left, top, width, height, border-radius, opacity, transform;',
            '  transition: left 0.14s cubic-bezier(0.2, 0.0, 0.2, 1), top 0.14s cubic-bezier(0.2, 0.0, 0.2, 1), width 0.14s cubic-bezier(0.2, 0.0, 0.2, 1), height 0.14s cubic-bezier(0.2, 0.0, 0.2, 1), border-radius 0.14s cubic-bezier(0.2, 0.0, 0.2, 1), opacity 0.12s ease-out, transform 0.12s ease-out;',
            `  outline: ${config.outlineWidth}px solid rgb(var(--sn-focus-rgb));`,
            `  outline-offset: ${config.outlineOffset}px;`,
            `  background-color: rgba(var(--sn-focus-rgb), var(--sn-scrim-alpha));`,
            `  box-shadow: 0 0 var(--sn-glow-blur) rgba(var(--sn-focus-rgb), var(--sn-glow-alpha)), inset 0 0 0 1px rgba(var(--sn-focus-rgb), var(--sn-inner-glow-alpha));`,
            '  border-radius: 8px;',
            '  box-sizing: border-box;',
            `  z-index: ${overlayZIndex};`,
            '  opacity: 0;',
            '}',
            `#${overlayLabelId} {`,
            '  position: fixed;',
            '  pointer-events: none;',
            `  z-index: ${overlayZIndex + 2};`,
            '  padding: 4px 8px;',
            '  border-radius: 999px;',
            '  background: var(--sn-label-bg);',
            '  color: var(--sn-label-fg);',
            '  font: 12px/1.2 system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;',
            '  letter-spacing: 0.2px;',
            '  display: flex;',
            '  gap: 6px;',
            '  align-items: center;',
            '  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.28);',
            '  opacity: 0;',
            '  transform: translate3d(0, 0, 0);',
            '  transition: opacity 0.12s ease-out, transform 0.12s ease-out;',
            '}',
            `#${overlayLabelId}.visible {`,
            '  opacity: 1;',
            '}',
            `#${overlayLabelId} .sn-label-text {`,
            '  min-width: 0;',
            '  overflow: hidden;',
            '  text-overflow: ellipsis;',
            '  white-space: nowrap;',
            '}',
            `#${overlayLabelId} .sn-label-badge {`,
            '  padding: 1px 6px;',
            '  border-radius: 999px;',
            '  font: 10px/1.2 ui-monospace, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;',
            '  background: rgba(255, 255, 255, 0.14);',
            '  color: var(--sn-label-muted);',
            '  white-space: nowrap;',
            '}',
            `#${overlayLabelId} .sn-label-suppressed {`,
            '  background: rgba(255, 64, 64, 0.22);',
            '  color: rgba(255, 220, 220, 0.95);',
            '}',
            `#${debugHudId} {`,
            '  position: fixed;',
            '  pointer-events: none;',
            '  display: none;',
            `  z-index: ${overlayZIndex + 3};`,
            '  left: 8px;',
            '  top: 8px;',
            '  padding: 4px 8px;',
            '  border-radius: 999px;',
            '  background: rgba(0, 0, 0, 0.58);',
            '  color: rgba(255, 255, 255, 0.9);',
            '  font: 11px/1.2 ui-monospace, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;',
            '  letter-spacing: 0.2px;',
            '  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.22);',
            '}',
            `#${focusOverlayId}.visible {`,
            '  opacity: 1;',
            '}',
            `#${focusOverlayId}.click-animate {`,
            '  transform: scale(0.96) !important;',
            '  transition: transform 0.09s ease-out !important;',
            '}',
            '#focus-preview-layer {',
            '  position: fixed;',
            '  inset: 0;',
            '  pointer-events: none;',
            `  z-index: ${previewZIndex};`,
            '}',
            '.focus-preview {',
            '  position: fixed;',
            '  pointer-events: none;',
            `  border: 1px solid rgba(var(--sn-focus-rgb), 0.4);`,
            `  background-color: rgba(var(--sn-focus-rgb), 0.10);`,
            '  border-radius: 999px;',
            '  opacity: 0;',
            '  transform: translate3d(0, 0, 0);',
            '  transition: opacity 0.16s cubic-bezier(0.4, 0.0, 0.2, 1), transform 0.16s cubic-bezier(0.4, 0.0, 0.2, 1);',
            '}',
            '.focus-preview.show {',
            '  opacity: 0.92;',
            '}',
            '.focus-preview.disabled {',
            `  border: 2px solid rgba(var(--sn-disabled-rgb), 0.7);`,
            `  background-color: rgba(var(--sn-disabled-rgb), 0.2);`,
            '}',
            '.focus-preview.disabled.show {',
            '  opacity: 0.9;',
            '  animation: focusPreviewPulse 0.32s ease-out;',
            '}',
            '@keyframes focusPreviewPulse {',
            '  0% { opacity: 0; transform: translate3d(0, 0, 0) scale(0.85); }',
            '  55% { opacity: 0.9; }',
            '  100% { opacity: 0; transform: translate3d(0, 0, 0) scale(1.08); }',
            '}',
            '@keyframes focusPulse {',
            '  0% { box-shadow: 0 0 0 0 rgba(var(--focus-color, 255, 193, 7), 0.6); }',
            '  70% { box-shadow: 0 0 0 12px rgba(var(--focus-color, 255, 193, 7), 0); }',
            '  100% { box-shadow: 0 0 0 0 rgba(var(--focus-color, 255, 193, 7), 0); }',
            '}',
            `#${focusOverlayId}.pulse {`,
            '  animation: focusPulse 0.6s ease-out;',
            '}',
            '.focus-preview-arrow {',
            '  position: absolute;',
            '  width: 0;',
            '  height: 0;',
            '  opacity: 0;',
            '  transition: opacity 0.24s cubic-bezier(0.4, 0.0, 0.2, 1);',
            '}',
            '.focus-preview.show .focus-preview-arrow {',
            '  opacity: 1;',
            '}',
            '.focus-preview-right .focus-preview-arrow {',
            '  top: 50%;',
            '  left: 50%;',
            '  transform: translate(-50%, -50%);',
            `  border-top: var(--arrow-width) solid transparent;`,
            `  border-bottom: var(--arrow-width) solid transparent;`,
            `  border-left: var(--arrow-length) solid rgba(var(--sn-focus-rgb), 0.95);`,
            '}',
            '.focus-preview-left .focus-preview-arrow {',
            '  top: 50%;',
            '  left: 50%;',
            '  transform: translate(-50%, -50%);',
            `  border-top: var(--arrow-width) solid transparent;`,
            `  border-bottom: var(--arrow-width) solid transparent;`,
            `  border-right: var(--arrow-length) solid rgba(var(--sn-focus-rgb), 0.95);`,
            '}',
            '.focus-preview-down .focus-preview-arrow {',
            '  top: 50%;',
            '  left: 50%;',
            '  transform: translate(-50%, -50%);',
            `  border-left: var(--arrow-width) solid transparent;`,
            `  border-right: var(--arrow-width) solid transparent;`,
            `  border-top: var(--arrow-length) solid rgba(var(--sn-focus-rgb), 0.95);`,
            '}',
            '.focus-preview-up .focus-preview-arrow {',
            '  top: 50%;',
            '  left: 50%;',
            '  transform: translate(-50%, -50%);',
            `  border-left: var(--arrow-width) solid transparent;`,
            `  border-right: var(--arrow-width) solid transparent;`,
            `  border-bottom: var(--arrow-length) solid rgba(var(--sn-focus-rgb), 0.95);`,
            '}',
            '@media (prefers-reduced-motion: reduce) {',
            `  #${focusOverlayId},`,
            '  .focus-preview,',
            `  #${overlayLabelId},`,
            '  .focus-preview-arrow {',
            '    transition: none;',
            '  }',
            `  #${focusOverlayId}.pulse {`,
            '    animation: none;',
            '  }',
            '}',
        ].join('\n');
    }
    /**
     * Position and show the focus overlay on an element.
     * If element is null, hides the overlay.
     */
    function showOverlay(element, state, pulse = false) {
        if (!state.overlay || !element) {
            if (state.overlay) {
                state.overlay.classList.remove('visible');
            }
            const shadow = state.overlayHost?.shadowRoot;
            const label = shadow?.getElementById(overlayLabelId);
            if (label) {
                label.classList.remove('visible');
            }
            updateDebugHud(state);
            return;
        }
        // Get the visual bounds using our consolidated logic
        const rect = calculateVisualRect(element);
        const overlay = state.overlay;
        // Match element's border-radius
        const computed = window.getComputedStyle(element);
        const borderRadius = computed.borderRadius || '4px';
        const effectiveRadius = borderRadius !== '0px' ? borderRadius : '8px';
        const config = state.config;
        const outlineOffset = config.outlineOffset || 3;
        const outlineWidth = config.outlineWidth || 3;
        const safeAreaMargin = Math.max(0, config.safeAreaMargin ?? 0);
        const totalMargin = outlineWidth + outlineOffset + 2 + safeAreaMargin; // Extra safety buffer
        log$e.debug(`overlay positioned on ${element.tagName.toLowerCase()}${element.id ? '#' + element.id : ''}`, {
            L: rect.left.toFixed(1),
            T: rect.top.toFixed(1),
            W: rect.width.toFixed(1),
            H: rect.height.toFixed(1),
        });
        overlay.style.display = 'block';
        overlay.classList.add('visible');
        // Apply positions with viewport clamping to prevent outline from being cut at edges
        const left = Math.max(totalMargin, rect.left);
        const top = Math.max(totalMargin, rect.top);
        const right = Math.min(window.innerWidth - totalMargin, rect.right);
        const bottom = Math.min(window.innerHeight - totalMargin, rect.bottom);
        overlay.style.left = left + 'px';
        overlay.style.top = top + 'px';
        overlay.style.width = right - left + 'px';
        overlay.style.height = bottom - top + 'px';
        overlay.style.borderRadius = effectiveRadius;
        updateDebugHud(state);
        updateFocusLabel(state, element, { left, top, width: right - left});
        // Remove native focus outline
        try {
            element.style.setProperty('outline', 'none', 'important');
            element.style.setProperty('box-shadow', 'none', 'important');
        }
        catch {
            // ignore
        }
        if (pulse) {
            overlay.classList.remove('pulse');
            void overlay.offsetWidth;
            overlay.classList.add('pulse');
        }
        // ResizeObserver
        if (state.activeResizeObserver) {
            state.activeResizeObserver.disconnect();
            state.activeResizeObserver = null;
        }
        if (typeof ResizeObserver !== 'undefined') {
            const ro = new ResizeObserver(() => {
                const currentActive = state.lastFocusedElement;
                if (currentActive === element) {
                    // FIX: Use calculateVisualRect here too to maintain the logo/image expansion
                    const newRect = calculateVisualRect(element);
                    // Also apply clamping here for consistency
                    const outlineOffset = state.config.outlineOffset || 3;
                    const outlineWidth = state.config.outlineWidth || 3;
                    const safeAreaMargin = Math.max(0, state.config.safeAreaMargin ?? 0);
                    const totalMargin = outlineWidth + outlineOffset + 2 + safeAreaMargin;
                    const left = Math.max(totalMargin, newRect.left);
                    const top = Math.max(totalMargin, newRect.top);
                    const right = Math.min(window.innerWidth - totalMargin, newRect.right);
                    const bottom = Math.min(window.innerHeight - totalMargin, newRect.bottom);
                    overlay.style.left = left + 'px';
                    overlay.style.top = top + 'px';
                    overlay.style.width = right - left + 'px';
                    overlay.style.height = bottom - top + 'px';
                }
            });
            ro.observe(element);
            state.activeResizeObserver = ro;
        }
    }
    /**
     * Hide the focus overlay.
     */
    function hideOverlay(state) {
        if (state.overlay) {
            state.overlay.classList.remove('visible');
        }
        if (state.activeResizeObserver) {
            state.activeResizeObserver.disconnect();
            state.activeResizeObserver = null;
        }
        const shadow = state.overlayHost?.shadowRoot;
        const label = shadow?.getElementById(overlayLabelId);
        if (label) {
            label.classList.remove('visible');
        }
        updateDebugHud(state);
    }

    /**
     * Preview management for Spatial Navigation System
     *
     * Manages directional preview indicators showing where focus will move.
     * Includes disabled state animation for boundary conditions.
     */
    const previewDirectionKeys = ['up', 'down', 'left', 'right'];
    /**
     * Create or retrieve preview elements for all directions.
     *
     * @param state - Global state object
     * @returns Preview elements by direction
     */
    function ensurePreviewElements(state) {
        if (!state.previewLayer) {
            return null;
        }
        if (!state.previewElements) {
            const elements = {};
            previewDirectionKeys.forEach(function (direction) {
                const container = document.createElement('div');
                container.className = 'focus-preview focus-preview-' + direction;
                container.dataset.direction = direction;
                const arrow = document.createElement('div');
                arrow.className = 'focus-preview-arrow';
                container.appendChild(arrow);
                state.previewLayer.appendChild(container);
                elements[direction] = {
                    container: container,
                    arrow: arrow,
                };
            });
            state.previewElements = elements;
        }
        return state.previewElements;
    }
    /**
     * Hide all preview elements.
     *
     * @param state - Global state object
     */
    function hidePreviewElements(state) {
        if (!state.previewElements) {
            return;
        }
        previewDirectionKeys.forEach(function (direction) {
            const entry = state.previewElements[direction];
            if (entry && entry.container) {
                entry.container.className = 'focus-preview focus-preview-' + direction;
                entry.container.style.left = '';
                entry.container.style.top = '';
                entry.container.style.width = '';
                entry.container.style.height = '';
                entry.container.removeAttribute('data-target');
                if (entry.arrow) {
                    entry.arrow.style.display = '';
                }
            }
        });
    }
    function clamp$1(value, min, max) {
        return Math.min(Math.max(value, min), max);
    }
    function showChevronPreview(entry, direction, currentRect, safeAreaMargin = 0) {
        if (!entry || !entry.container || !currentRect) {
            return;
        }
        const size = Math.max(14, Math.min(26, Math.round(Math.min(currentRect.width, currentRect.height) * 0.28)));
        const offset = Math.max(10, Math.round(size * 0.75));
        let left = currentRect.left;
        let top = currentRect.top;
        switch (direction) {
            case 'right':
                left = currentRect.right + offset;
                top = currentRect.top + currentRect.height / 2 - size / 2;
                break;
            case 'left':
                left = currentRect.left - offset - size;
                top = currentRect.top + currentRect.height / 2 - size / 2;
                break;
            case 'down':
                left = currentRect.left + currentRect.width / 2 - size / 2;
                top = currentRect.bottom + offset;
                break;
            case 'up':
                left = currentRect.left + currentRect.width / 2 - size / 2;
                top = currentRect.top - offset - size;
                break;
        }
        const viewportW = window?.innerWidth ?? 0;
        const viewportH = window?.innerHeight ?? 0;
        const safe = Math.max(0, safeAreaMargin || 0);
        left = clamp$1(left, safe, Math.max(safe, viewportW - safe - size));
        top = clamp$1(top, safe, Math.max(safe, viewportH - safe - size));
        entry.container.style.left = left + 'px';
        entry.container.style.top = top + 'px';
        entry.container.style.width = size + 'px';
        entry.container.style.height = size + 'px';
        entry.container.style.opacity = '';
        entry.container.className = 'focus-preview focus-preview-' + direction + ' show';
        if (entry.arrow) {
            entry.arrow.style.display = '';
        }
    }
    /**
     * Update preview targets for all directions.
     *
     * @param currentIndex - Index of current focused element
     * @param findDirectionalCandidate - Function to find candidate
     * @param directionByName - Direction objects by name
     * @param state - Global state object
     * @returns Targets by direction
     */
    function updatePreviewTargets(currentIndex, findDirectionalCandidate, directionByName, state) {
        const result = {};
        if (typeof currentIndex !== 'number' || currentIndex < 0 || !state.focusables.length) {
            previewDirectionKeys.forEach(function (direction) {
                result[direction] = null;
            });
            state.nextTargets = result;
            return result;
        }
        previewDirectionKeys.forEach(function (direction) {
            const dir = directionByName[direction];
            result[direction] = findDirectionalCandidate(currentIndex, dir, state);
        });
        state.nextTargets = result;
        return result;
    }
    /**
     * Update preview visuals based on current focus and available targets.
     *
     * @param currentElement - Currently focused element
     * @param currentRect - Current element rect
     * @param findDirectionalCandidate - Function to find candidates
     * @param directionByName - Direction objects by name
     * @param describeElement - Function to describe element for data attr
     * @param state - Global state object
     */
    function updatePreviewVisuals(currentElement, currentRect, findDirectionalCandidate, directionByName, describeElement, state) {
        const elements = ensurePreviewElements(state);
        if (!elements) {
            state.nextTargets = { up: null, down: null, left: null, right: null };
            return;
        }
        if (!state.previewEnabled || !currentElement) {
            hidePreviewElements(state);
            state.nextTargets = { up: null, down: null, left: null, right: null };
            return;
        }
        // Unused but kept for API compatibility or future use
        const _rect = currentElement.getBoundingClientRect();
        const targets = updatePreviewTargets(state.currentIndex, findDirectionalCandidate, directionByName, state);
        previewDirectionKeys.forEach(function (direction) {
            const entry = elements[direction];
            if (!entry || !entry.container) {
                return;
            }
            const candidate = targets[direction];
            if (!candidate || !candidate.data || !candidate.data.element) {
                if (entry.container.className.indexOf('disabled') === -1) {
                    entry.container.className = 'focus-preview focus-preview-' + direction;
                    entry.container.style.left = '';
                    entry.container.style.top = '';
                    entry.container.style.width = '';
                    entry.container.style.height = '';
                    entry.container.style.opacity = '';
                    entry.container.removeAttribute('data-target');
                }
                if (entry.arrow) {
                    entry.arrow.style.display = '';
                }
                return;
            }
            // Show directional chevrons around the current focus ring (TV-friendly, low clutter).
            showChevronPreview(entry, direction, _rect, state.config.safeAreaMargin ?? 0);
            entry.container.setAttribute('data-target', describeElement(candidate.data.element));
        });
    }

    /**
     * Focus Group logic for GeckoView Spatial Navigation System
     *
     * Manages navigation regions (Focus Groups) defined by data-focus-group attributes.
     *
     * Features:
     * - Flat focus groups: data-focus-group="sidebar"
     * - Nested hierarchies: data-focus-group="sidebar.menu" (child of sidebar)
     * - Boundary modes: exit, contain, wrap, stop
     * - Enter modes: default, first, last
     * - Last-focused memory for enter-mode="last"
     *
     * Hierarchy Example:
     *   <nav data-focus-group="sidebar">
     *     <div data-focus-group="sidebar.header">...</div>
     *     <ul data-focus-group="sidebar.menu;boundary=contain">
     *       <li data-focus-group="sidebar.menu.item1">...</li>
     *       <li data-focus-group="sidebar.menu.item2">...</li>
     *     </ul>
     *     <div data-focus-group="sidebar.footer">...</div>
     *   </nav>
     */
    /**
     * Path utilities for hierarchical group IDs.
     */
    const GroupPath = {
        /**
         * Get the parent path of a group ID.
         * e.g., "sidebar.menu.item1" -> "sidebar.menu"
         */
        parent(id) {
            const lastDot = id.lastIndexOf('.');
            return lastDot > 0 ? id.substring(0, lastDot) : null;
        },
        /**
         * Get the depth of a group ID.
         * e.g., "sidebar" -> 1, "sidebar.menu" -> 2, "sidebar.menu.item1" -> 3
         */
        depth(id) {
            return id.split('.').length;
        },
        /**
         * Check if `childId` is a descendant of `parentId`.
         * e.g., isDescendant("sidebar.menu.item1", "sidebar") -> true
         */
        isDescendant(childId, parentId) {
            return childId.startsWith(parentId + '.');
        },
        /**
         * Check if two IDs are siblings (same parent).
         */
        areSiblings(id1, id2) {
            const parent1 = GroupPath.parent(id1);
            const parent2 = GroupPath.parent(id2);
            return parent1 === parent2;
        },
        /**
         * Get all ancestor IDs for a group.
         * e.g., "sidebar.menu.item1" -> ["sidebar.menu", "sidebar"]
         */
        ancestors(id) {
            const result = [];
            let current = GroupPath.parent(id);
            while (current) {
                result.push(current);
                current = GroupPath.parent(current);
            }
            return result;
        },
        /**
         * Get the root ID (first segment).
         * e.g., "sidebar.menu.item1" -> "sidebar"
         */
        root(id) {
            const firstDot = id.indexOf('.');
            return firstDot > 0 ? id.substring(0, firstDot) : id;
        },
        /**
         * Get the leaf name (last segment).
         * e.g., "sidebar.menu.item1" -> "item1"
         */
        leaf(id) {
            const lastDot = id.lastIndexOf('.');
            return lastDot > 0 ? id.substring(lastDot + 1) : id;
        },
    };
    /**
     * Represents a logical group of focusable elements.
     * Supports hierarchical nesting via dot-notation IDs.
     */
    class FocusGroup {
        constructor(id, element, options = {}) {
            /** Parent group (if nested) */
            this.parent = null;
            /** Child groups */
            this.children = new Map();
            this.id = id;
            this.element = element;
            this.members = [];
            this.options = {
                boundary: options.boundary || 'exit',
                rememberLast: options.rememberLast !== false,
                enterMode: options.enterMode || 'default',
                priority: options.priority ?? 0,
                inheritOptions: options.inheritOptions !== false,
                ...options,
            };
            this.lastFocused = null;
            this._depth = GroupPath.depth(id);
        }
        /**
         * Get the depth of this group in the hierarchy.
         */
        get depth() {
            return this._depth;
        }
        /**
         * Get the parent group ID (or null if root).
         */
        get parentId() {
            return GroupPath.parent(this.id);
        }
        /**
         * Check if this is a root-level group.
         */
        get isRoot() {
            return this._depth === 1;
        }
        /**
         * Get effective options, inheriting from parent if enabled.
         */
        getEffectiveOptions() {
            if (!this.options.inheritOptions || !this.parent) {
                return this.options;
            }
            const parentOptions = this.parent.getEffectiveOptions();
            return {
                ...parentOptions,
                ...this.options,
                // Don't inherit ID-specific options
                priority: this.options.priority,
            };
        }
        /**
         * Set the parent group reference.
         */
        setParent(parent) {
            this.parent = parent;
            parent.children.set(this.id, this);
        }
        /**
         * Remove this group from its parent.
         */
        removeFromParent() {
            if (this.parent) {
                this.parent.children.delete(this.id);
                this.parent = null;
            }
        }
        addMember(entry) {
            if (!this.members.includes(entry)) {
                this.members.push(entry);
                entry.groupId = this.id;
            }
        }
        removeMember(entry) {
            const index = this.members.indexOf(entry);
            if (index > -1) {
                this.members.splice(index, 1);
            }
            if (entry.groupId === this.id) {
                entry.groupId = null;
            }
        }
        updateLastFocused(entry) {
            if (this.members.includes(entry)) {
                this.lastFocused = entry;
                // Also update ancestors' lastFocused if they don't have their own
                let ancestor = this.parent;
                while (ancestor) {
                    if (!ancestor.lastFocused || !document.body.contains(ancestor.lastFocused.element)) {
                        // Find the member in ancestor that contains this entry
                        const memberInAncestor = ancestor.members.find((m) => m.element.contains(entry.element) || m.element === entry.element);
                        if (memberInAncestor) {
                            ancestor.lastFocused = memberInAncestor;
                        }
                    }
                    ancestor = ancestor.parent;
                }
            }
        }
        getPreferredEntry() {
            const effectiveOptions = this.getEffectiveOptions();
            if (effectiveOptions.enterMode === 'last' &&
                this.lastFocused &&
                document.body.contains(this.lastFocused.element)) {
                return this.lastFocused;
            }
            if (effectiveOptions.enterMode === 'first' || effectiveOptions.enterMode === 'default') {
                return this.members[0];
            }
            return this.members[0];
        }
        /**
         * Get all descendant groups (recursive).
         */
        getAllDescendants() {
            const result = [];
            for (const child of this.children.values()) {
                result.push(child);
                result.push(...child.getAllDescendants());
            }
            return result;
        }
        /**
         * Get all member elements including those in descendant groups.
         */
        getAllMembers() {
            const result = [...this.members];
            for (const child of this.children.values()) {
                result.push(...child.getAllMembers());
            }
            return result;
        }
        /**
         * Find a child group by relative path.
         * e.g., for group "sidebar", findChild("menu.item1") returns "sidebar.menu.item1"
         */
        findChild(relativePath) {
            const fullId = this.id + '.' + relativePath;
            return this.children.get(fullId) ?? null;
        }
        /**
         * Check if navigation can exit this group in a given direction.
         */
        canExit() {
            const effectiveOptions = this.getEffectiveOptions();
            return effectiveOptions.boundary === 'exit' || effectiveOptions.boundary === 'wrap';
        }
        /**
         * Check if navigation should wrap within this group.
         */
        shouldWrap() {
            const effectiveOptions = this.getEffectiveOptions();
            return effectiveOptions.boundary === 'wrap';
        }
    }
    /**
     * Parse focus group options from data-focus-group attribute.
     * Format: "id;options" or just "id"
     * Options: boundary=contain,remember=true
     */
    function parseFocusGroupAttribute(attrValue) {
        if (!attrValue)
            return null;
        const parts = attrValue.split(';');
        const id = parts[0].trim();
        const options = {};
        if (parts.length > 1) {
            parts.slice(1).forEach((part) => {
                const [key, value] = part.split('=').map((s) => s.trim());
                if (key && value) {
                    if (value === 'true')
                        options[key] = true;
                    else if (value === 'false')
                        options[key] = false;
                    else
                        options[key] = value;
                }
            });
        }
        // Map attribute keys to internal options
        const mappedOptions = {};
        if (options.boundary)
            mappedOptions.boundary = options.boundary;
        if (options.remember !== undefined)
            mappedOptions.rememberLast = options.remember;
        if (options.enter)
            mappedOptions.enterMode = options.enter;
        return { id, options: mappedOptions };
    }
    /**
     * Find the nearest focus group container for an element.
     */
    function findFocusGroupContainer(element) {
        let current = element;
        while (current && current !== document.body) {
            if (current.hasAttribute('data-focus-group')) {
                return current;
            }
            current = current.parentElement;
        }
        return null;
    }

    /**
     * IntersectionObserver helpers for Spatial Navigation.
     *
     * Keeps geometry in sync for lazily-loaded elements that enter the viewport.
     */
    const log$d = createLogger('Intersection');
    function supportsIntersectionObserver() {
        return typeof window !== 'undefined' && typeof window.IntersectionObserver !== 'undefined';
    }
    function createObserver(state) {
        if (!supportsIntersectionObserver()) {
            log$d.debug('IntersectionObserver unsupported in this environment');
            return null;
        }
        const config = state.config; // Assuming proper config
        const options = {
            root: null,
            rootMargin: config.intersectionRootMargin || '200px',
            threshold: config.intersectionThreshold || 0,
        };
        const observer = new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
                const element = entry.target;
                if (!state.focusableElements) {
                    return;
                }
                const idx = state.focusableElements.indexOf(element);
                if (idx === -1) {
                    observer.unobserve(element);
                    return;
                }
                const focusEntry = state.focusables && state.focusables[idx];
                if (focusEntry) {
                    updateEntryGeometry(focusEntry, state);
                }
            });
        }, options);
        return observer;
    }
    function syncIntersectionObserver(state) {
        const config = state.config;
        if (!config.observeIntersection || !supportsIntersectionObserver()) {
            detachIntersectionObserver(state);
            return;
        }
        if (!state.intersectionObserver) {
            state.intersectionObserver = createObserver(state);
        }
        else {
            // If config changed, we might need to recreate, but for now assuming just re-syncing targets
            state.intersectionObserver.disconnect();
        }
        if (!state.intersectionObserver) {
            return;
        }
        if (Array.isArray(state.focusableElements)) {
            state.focusableElements.forEach((element) => {
                try {
                    if (state.intersectionObserver) {
                        state.intersectionObserver.observe(element);
                    }
                }
                catch {
                    // Ignore observation failures (detached nodes, etc.).
                }
            });
        }
    }
    function observeNewElement(state, element) {
        if (!state || !element || !state.intersectionObserver) {
            return;
        }
        try {
            state.intersectionObserver.observe(element);
        }
        catch {
            // ignore
        }
    }
    function unobserveElement(state, element) {
        if (!state || !element || !state.intersectionObserver) {
            return;
        }
        try {
            state.intersectionObserver.unobserve(element);
        }
        catch {
            // ignore
        }
    }
    function detachIntersectionObserver(state) {
        if (state && state.intersectionObserver) {
            state.intersectionObserver.disconnect();
            state.intersectionObserver = null;
        }
    }

    /**
     * DOM utilities for Spatial Navigation System
     *
     * Handles element discovery, focus management, and element description.
     * Features Shadow DOM traversal, virtual scroll detection, and accessibility announcer.
     */
    const log$c = createLogger('DOM');
    /** Threshold above which a focusable refresh is logged as slow (ms). */
    const SLOW_REFRESH_THRESHOLD_MS = 50;
    const focusableSelector = 'a[href], a[aria-haspopup], [role="link"], button:not([disabled]), [role="button"], [aria-haspopup="true"], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';
    // ===== Shadow DOM Traversal =====
    /**
     * Find focusable elements including those in Shadow DOM.
     * Recursively traverses shadow roots and flattens slot assignments.
     *
     * Performance optimizations:
     * - Uses Set<Element> for O(1) duplicate detection instead of Array.includes() O(n)
     * - Single pass through light DOM elements
     * - Early bailout for non-Shadow DOM mode
     *
     * @param root - Root node to search from (document, shadowRoot, or element)
     * @param config - Configuration object
     * @param visited - Set of visited shadow roots (to prevent infinite loops)
     * @param seen - Set of already-found elements (for deduplication)
     * @returns Array of focusable elements
     */
    function findFocusablesDeep(root, config, visited = new Set(), seen = new Set()) {
        const results = [];
        // Prevent infinite loops with circular shadow DOM references
        if (visited.has(root)) {
            return results;
        }
        if (root.nodeType === 11) {
            // ShadowRoot
            visited.add(root);
        }
        // Light DOM focusables
        try {
            const lightFocusables = root.querySelectorAll(focusableSelector);
            for (const el of lightFocusables) {
                if (!seen.has(el)) {
                    seen.add(el);
                    results.push(el);
                }
            }
        }
        catch {
            // querySelectorAll may fail on some shadow roots
        }
        // Only traverse Shadow DOM if enabled (expensive operation)
        if (!config || !config.traverseShadowDom) {
            return results;
        }
        // Traverse into shadow roots
        try {
            const allElements = root.querySelectorAll('*');
            for (const element of allElements) {
                const host = element;
                if (host.shadowRoot && !visited.has(host.shadowRoot)) {
                    const shadowFocusables = findFocusablesDeep(host.shadowRoot, config, visited, seen);
                    results.push(...shadowFocusables);
                }
            }
        }
        catch (e) {
            log$c.warn('shadow DOM traversal error', e);
        }
        // Flatten slot assignments (distributed content)
        try {
            const slots = root.querySelectorAll('slot');
            for (const slot of slots) {
                const assigned = slot.assignedElements({ flatten: true });
                for (const el of assigned) {
                    // O(1) duplicate check with Set
                    if (!seen.has(el) && el.matches && el.matches(focusableSelector)) {
                        seen.add(el);
                        results.push(el);
                    }
                    // Also check shadow roots of assigned elements
                    if (el.shadowRoot && config.traverseShadowDom && !visited.has(el.shadowRoot)) {
                        const nestedFocusables = findFocusablesDeep(el.shadowRoot, config, visited, seen);
                        results.push(...nestedFocusables);
                    }
                }
            }
        }
        catch {
            // Slots may not be supported or accessible
        }
        return results;
    }
    // ===== Virtual Scroll / Infinite List Support =====
    /**
     * Detect virtual scroll containers on the page.
     *
     * @param config - Configuration object with virtualContainerSelectors
     * @returns Array of detected virtual containers
     */
    function detectVirtualContainers(config) {
        if (!config || !config.observeVirtualContainers) {
            return [];
        }
        const selectors = config.virtualContainerSelectors || [];
        const containers = [];
        for (const selector of selectors) {
            try {
                const found = document.querySelectorAll(selector);
                for (const el of Array.from(found)) {
                    if (!containers.includes(el)) {
                        containers.push(el);
                    }
                }
            }
            catch {
                // Invalid selector, skip
            }
        }
        return containers;
    }
    /**
     * Attach sentinel observers to virtual scroll containers.
     * Triggers refresh when sentinel elements become visible (indicating scroll near boundary).
     *
     * @param state - Global state object
     */
    function attachVirtualScrollSentinels(state) {
        const config = state.config; // Assuming initialized state has config
        if (!config.observeVirtualContainers) {
            return;
        }
        // Disconnect existing observer
        if (state.virtualSentinelObserver) {
            state.virtualSentinelObserver.disconnect();
            state.virtualSentinelObserver = null;
        }
        const containers = detectVirtualContainers(config);
        state.virtualContainers = containers;
        if (containers.length === 0) {
            return;
        }
        log$c.debug(`detected ${containers.length} virtual scroll containers`);
        const debounceMs = config.virtualScrollDebounce || 150;
        let debounceTimer = null;
        const observer = new IntersectionObserver((entries) => {
            const shouldRefresh = entries.some((entry) => entry.isIntersecting);
            if (shouldRefresh && !state.virtualScrollPending) {
                state.virtualScrollPending = true;
                if (debounceTimer) {
                    clearTimeout(debounceTimer);
                }
                debounceTimer = setTimeout(() => {
                    log$c.debug('virtual scroll sentinel triggered refresh');
                    refreshFocusables(state);
                    state.virtualScrollPending = false;
                    state.dirty = true; // Invalidate precomputed cache
                }, debounceMs);
            }
        }, {
            rootMargin: '300px',
            threshold: 0,
        });
        // Observe sentinel elements (first and last visible children)
        for (const container of containers) {
            const children = container.children;
            if (children.length > 2) {
                // Observe elements near the boundaries
                observer.observe(children[1]);
                observer.observe(children[Math.floor(children.length / 2)]);
                observer.observe(children[children.length - 2]);
            }
            else if (children.length > 0) {
                observer.observe(children[0]);
                if (children.length > 1) {
                    observer.observe(children[children.length - 1]);
                }
            }
        }
        state.virtualSentinelObserver = observer;
    }
    // ===== Accessibility Announcer =====
    /**
     * Setup ARIA live region for accessibility announcements.
     *
     * @param state - Global state object
     */
    function setupAccessibilityAnnouncer(state) {
        const config = state.config;
        if (!config.enableAria) {
            return;
        }
        let announcer = document.getElementById('spatnav-announcer');
        if (!announcer) {
            announcer = document.createElement('div');
            announcer.id = 'spatnav-announcer';
            announcer.setAttribute('aria-live', 'polite');
            announcer.setAttribute('aria-atomic', 'true');
            announcer.setAttribute('role', 'status');
            announcer.className = 'sr-only';
            announcer.style.cssText =
                'position: absolute !important;' +
                    'width: 1px !important;' +
                    'height: 1px !important;' +
                    'padding: 0 !important;' +
                    'margin: -1px !important;' +
                    'overflow: hidden !important;' +
                    'clip: rect(0, 0, 0, 0) !important;' +
                    'white-space: nowrap !important;' +
                    'border: 0 !important;';
            document.body.appendChild(announcer);
            log$c.debug('accessibility announcer created');
        }
        state.announcer = announcer;
    }
    /**
     * Announce a message via ARIA live region.
     *
     * @param message - Message to announce
     * @param state - Global state object
     * @param priority - 'polite' or 'assertive'
     */
    function announce(message, state, priority = 'polite') {
        const config = state.config;
        if (!config.enableAria || !state.announcer) {
            return;
        }
        // Set priority
        state.announcer.setAttribute('aria-live', priority);
        // Clear then set to trigger announcement (required for repeated messages)
        state.announcer.textContent = '';
        requestAnimationFrame(() => {
            if (state.announcer) {
                state.announcer.textContent = message;
            }
        });
    }
    /**
     * Get a verbose description of an element for accessibility.
     *
     * @param el - Element to describe
     * @param config - Configuration object
     * @returns Verbose description
     */
    function getAccessibleDescription(el, config) {
        if (!el || !el.tagName) {
            return '';
        }
        const parts = [];
        // Get accessible name (aria-label > aria-labelledby > innerText > title)
        const ariaLabel = el.getAttribute('aria-label');
        const ariaLabelledBy = el.getAttribute('aria-labelledby');
        const title = el.getAttribute('title');
        if (ariaLabel) {
            parts.push(ariaLabel);
        }
        else if (ariaLabelledBy) {
            const labelEl = document.getElementById(ariaLabelledBy);
            if (labelEl) {
                parts.push(labelEl.textContent?.trim() || '');
            }
        }
        else {
            const text = el.textContent?.trim().substring(0, 50);
            if (text) {
                parts.push(text);
            }
        }
        if (title && !parts.includes(title)) {
            parts.push(title);
        }
        // Add role information
        const role = el.getAttribute('role') || el.tagName.toLowerCase();
        const roleNames = {
            a: 'link',
            button: 'button',
            input: el.type || 'text field',
            select: 'dropdown',
            textarea: 'text area',
            checkbox: 'checkbox',
            radio: 'radio button',
        };
        const roleName = roleNames[role] || role;
        if (config && config.verboseDescriptions) {
            return `${parts.join(', ')} (${roleName})`;
        }
        return parts.join(', ') || roleName;
    }
    /**
     * Get the currently active element (focused).
     * Ignores body/documentElement.
     *
     * @returns Active element or null
     */
    function getActiveElement() {
        const active = document.activeElement;
        if (!active || active === document.body || active === document.documentElement) {
            return null;
        }
        return active;
    }
    /**
     * Create a short string description of an element for debugging.
     * Format: tag#id.class1.class2
     *
     * @param el - Element to describe
     * @returns Description string
     */
    function describeElement(el) {
        if (!el || !el.tagName) {
            return '';
        }
        const id = el.id ? '#' + el.id : '';
        let classes = '';
        if (typeof el.className === 'string' && el.className.trim().length > 0) {
            classes = '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.');
        }
        const text = el.textContent ? ` ("${el.textContent.trim().substring(0, 20)}")` : '';
        return el.tagName.toLowerCase() + id + classes + text;
    }
    /**
     * Refresh the list of focusable elements in the state.
     * Scans DOM for elements matching focusableSelector and updates geometry.
     * Supports Shadow DOM traversal and virtual scroll detection.
     *
     * @param state - Global state object
     */
    function refreshFocusables(state) {
        const startTime = performance.now(); // TODO 4: Performance monitoring
        const config = state.config;
        // Use Shadow DOM traversal if enabled, otherwise standard querySelectorAll
        let nodes;
        if (config.traverseShadowDom) {
            nodes = findFocusablesDeep(document, config);
            log$c.debug(`shadow DOM traversal found ${nodes.length} focusables`);
        }
        else {
            nodes = Array.from(document.querySelectorAll(focusableSelector));
        }
        log$c.debug(`candidate nodes found: ${nodes.length}`);
        // Add iframes if iframe support is enabled
        if (config.iframeSupport && config.iframeSupport.enabled) {
            try {
                const iframeNodes = Array.from(document.querySelectorAll(config.iframeSupport.selector || 'iframe'));
                iframeNodes.forEach((iframe) => {
                    if (!nodes.includes(iframe)) {
                        nodes.push(iframe);
                    }
                });
            }
            catch (err) {
                log$c.warn('iframe selector failed', err);
            }
        }
        const results = [];
        // Reset groups for fresh discovery
        // We keep the objects if possible to preserve state (lastFocused), but for now simpler to rebuild
        // TODO: Optimize to preserve group state across refreshes
        const oldGroups = state.focusGroups || {};
        state.focusGroups = {};
        for (let i = 0; i < nodes.length; i++) {
            const el = nodes[i];
            if (!el || typeof el.getBoundingClientRect !== 'function') {
                continue;
            }
            const style = window.getComputedStyle(el);
            if (!style ||
                style.visibility === 'hidden' ||
                style.display === 'none' ||
                el.disabled) {
                continue;
            }
            const entry = {
                element: el,
                index: i,
            };
            updateEntryGeometry(entry, state);
            const minSize = state.config.minElementSize || 1;
            if (!entry.rect ||
                entry.width <= 1 ||
                entry.height <= 1 ||
                entry.width < minSize ||
                entry.height < minSize) {
                continue;
            }
            const ariaHidden = el.closest('[aria-hidden="true"]');
            if (ariaHidden) {
                continue;
            }
            // Off-screen elements remain in the candidate list — many apps host
            // legitimate off-screen content (carousels, virtual lists). The
            // scorer applies an OFFSCREEN_PENALTY rather than excluding them.
            // Focus Group Logic
            const groupContainer = findFocusGroupContainer(el);
            if (groupContainer) {
                const attr = groupContainer.getAttribute('data-focus-group');
                const parsed = parseFocusGroupAttribute(attr);
                if (parsed && parsed.id) {
                    let group = state.focusGroups[parsed.id];
                    if (!group) {
                        // Restore old group state if available to keep lastFocused
                        const oldGroup = oldGroups[parsed.id];
                        group = new FocusGroup(parsed.id, groupContainer, parsed.options);
                        if (oldGroup) {
                            group.lastFocused = oldGroup.lastFocused;
                        }
                        state.focusGroups[parsed.id] = group;
                    }
                    group.addMember(entry);
                }
            }
            results.push(entry);
        }
        // Update indices in final array
        results.forEach((entry, index) => {
            entry.index = index;
        });
        state.focusables = results;
        state.focusableElements = results.map((item) => item.element);
        state.focusableCount = results.length;
        state.currentIndex = state.focusableElements.indexOf(document.activeElement);
        syncIntersectionObserver(state);
        // Update lastFocused for active group
        if (state.currentIndex !== -1) {
            const activeEntry = state.focusables[state.currentIndex];
            if (activeEntry && activeEntry.groupId) {
                const group = state.focusGroups[activeEntry.groupId];
                if (group) {
                    group.updateLastFocused(activeEntry);
                }
            }
        }
        // TODO 4: Performance monitoring (end)
        const duration = performance.now() - startTime;
        if (state.perf) {
            state.perf.refreshCount++;
            state.perf.totalRefreshTime += duration;
            state.perf.averageRefreshTime = state.perf.totalRefreshTime / state.perf.refreshCount;
            state.perf.lastRefreshTime = duration;
            if (duration > SLOW_REFRESH_THRESHOLD_MS) {
                state.perf.slowRefreshCount++;
                log$c.warn(`slow refresh: ${duration.toFixed(2)}ms (${results.length} elements)`);
            }
        }
    }
    /**
     * Simulate pointer events (hover) for an element transition.
     * Dispatches mouseout/mouseleave on oldEl and mouseover/mouseenter on newEl.
     *
     * @param oldEl - Element losing focus
     * @param newEl - Element gaining focus
     */
    function simulatePointerEvents(oldEl, newEl) {
        if (oldEl) {
            try {
                oldEl.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, cancelable: true, view: window }));
                oldEl.dispatchEvent(new MouseEvent('mouseleave', { bubbles: false, cancelable: false, view: window }));
            }
            catch {
                /* ignore */
            }
        }
        if (newEl) {
            try {
                newEl.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true, view: window }));
                newEl.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false, cancelable: false, view: window }));
                // Some sites might need mousemove to trigger tooltips
                newEl.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, view: window }));
            }
            catch {
                /* ignore */
            }
        }
    }
    /**
     * Insert a new focusable entry into the state.
     * LLM 2: Incremental diffing for attribute mutations.
     *
     * @param el - Element to insert
     * @param state - Global state object
     */
    function insertEntry(el, state) {
        if (!el || typeof el.getBoundingClientRect !== 'function') {
            return;
        }
        const style = window.getComputedStyle(el);
        if (!style ||
            style.visibility === 'hidden' ||
            style.display === 'none' ||
            el.disabled) {
            return;
        }
        const entry = { element: el };
        updateEntryGeometry(entry, state);
        if (!entry.rect || entry.width <= 1 || entry.height <= 1) {
            return;
        }
        // Handle focus groups
        const groupContainer = findFocusGroupContainer(el);
        if (groupContainer) {
            const attr = groupContainer.getAttribute('data-focus-group');
            const parsed = parseFocusGroupAttribute(attr);
            if (parsed && parsed.id) {
                const group = state.focusGroups[parsed.id];
                if (group) {
                    group.addMember(entry);
                }
            }
        }
        state.focusables.push(entry);
        state.focusableElements.push(el);
        // Re-index all entries
        state.focusables.forEach((e, i) => (e.index = i));
        state.focusableCount = state.focusables.length;
        observeNewElement(state, el);
        log$c.debug('inserted entry', describeElement(el));
    }
    /**
     * Remove a focusable entry from the state by index.
     * LLM 2: Incremental diffing for attribute mutations.
     *
     * @param idx - Index to remove
     * @param state - Global state object
     */
    function removeEntry(idx, state) {
        if (idx < 0 || idx >= state.focusables.length) {
            return;
        }
        const entry = state.focusables[idx];
        log$c.debug('removing entry', describeElement(entry.element));
        // Remove from focus group
        if (entry.groupId) {
            const group = state.focusGroups[entry.groupId];
            if (group) {
                group.removeMember(entry);
            }
        }
        state.focusables.splice(idx, 1);
        state.focusableElements.splice(idx, 1);
        unobserveElement(state, entry.element);
        if (state.lastFocusedElement === entry.element) {
            state.lastFocusedElement = null;
        }
        // Re-index
        state.focusables.forEach((e, i) => (e.index = i));
        state.focusableCount = state.focusables.length;
        // Update currentIndex if needed
        if (state.currentIndex === idx) {
            state.currentIndex = -1;
        }
        else if (state.currentIndex > idx) {
            state.currentIndex--;
        }
    }
    /**
     * Refresh focusables based on attribute mutations (incremental update).
     * LLM 2: Only updates elements that changed, avoiding full DOM scan.
     * FIX (MEDIUM): Check visibility and disabled state, not just selector match
     *
     * @param state - Global state object
     * @param mutationList - List of mutations from MutationObserver
     */
    function refreshAttributes(state, mutationList) {
        for (const mutation of mutationList) {
            if (mutation.type === 'attributes') {
                const el = mutation.target;
                const idx = state.focusableElements.indexOf(el);
                // FIX (MEDIUM): Check both selector AND visibility/disabled state
                const matchesSelector = el.matches && el.matches(focusableSelector);
                let isFocusableNow = false;
                if (matchesSelector) {
                    // Reuse same visibility/disabled logic from full scan
                    const style = window.getComputedStyle(el);
                    const isVisible = style && style.visibility !== 'hidden' && style.display !== 'none';
                    const isEnabled = !el.disabled;
                    const notAriaHidden = el.getAttribute('aria-hidden') !== 'true';
                    isFocusableNow = isVisible && isEnabled && notAriaHidden;
                }
                if (idx === -1 && isFocusableNow) {
                    // Element became focusable
                    insertEntry(el, state);
                }
                else if (idx !== -1 && !isFocusableNow) {
                    // Element no longer focusable (hidden, disabled, or removed from DOM)
                    removeEntry(idx, state);
                }
                else if (idx !== -1) {
                    // Element still focusable, update geometry
                    const entry = state.focusables[idx];
                    updateEntryGeometry(entry, state);
                }
            }
        }
        log$c.debug(`incremental refresh complete: ${state.focusables.length} focusables`);
    }

    /**
     * CSS Custom Property Integration for Spatial Navigation
     *
     * Reads WICG-defined CSS custom properties at runtime:
     * - --spatial-navigation-contain: auto | contain
     * - --spatial-navigation-action: auto | focus | scroll
     * - --spatial-navigation-function: normal | grid
     *
     * Also detects CSS Scroll Snap containers for enhanced grid navigation:
     * - scroll-snap-type: x | y | block | inline | both (mandatory | proximity)
     * - scroll-snap-align: start | end | center
     *
     * @see https://drafts.csswg.org/css-nav-1/#css-properties
     * @see https://drafts.csswg.org/css-scroll-snap-1/
     */
    /**
     * Get all CSS navigation properties for an element.
     */
    function getCSSNavProperties(element) {
        const config = getConfig();
        // Return defaults if CSS properties disabled
        if (!config.useCSSProperties) {
            return {
                contain: 'auto',
                action: 'auto',
                function: 'normal',
            };
        }
        try {
            const style = getComputedStyle(element);
            const containValue = style.getPropertyValue('--spatial-navigation-contain').trim();
            const actionValue = style.getPropertyValue('--spatial-navigation-action').trim();
            const functionValue = style.getPropertyValue('--spatial-navigation-function').trim();
            return {
                contain: containValue === 'contain' ? 'contain' : 'auto',
                action: actionValue === 'focus' || actionValue === 'scroll' ? actionValue : 'auto',
                function: functionValue === 'grid' ? 'grid' : 'normal',
            };
        }
        catch {
            return {
                contain: 'auto',
                action: 'auto',
                function: 'normal',
            };
        }
    }
    /**
     * Get the navigation contain value for an element.
     * If 'contain', navigation should not exit this element's subtree.
     */
    function getCSSNavContain(element) {
        return getCSSNavProperties(element).contain;
    }
    /**
     * Get the navigation function for an element.
     * - 'grid': use grid-aligned navigation
     * - 'normal': use standard geometric navigation
     */
    function getCSSNavFunction(element) {
        return getCSSNavProperties(element).function;
    }
    /**
     * Find the nearest navigation container for an element.
     * A container is an element with --spatial-navigation-contain: contain.
     */
    function findNavigationContainer(element) {
        const config = getConfig();
        // Skip if CSS properties disabled
        if (!config.useCSSProperties) {
            return null;
        }
        let current = element.parentElement;
        while (current && current !== document.documentElement) {
            if (getCSSNavContain(current) === 'contain') {
                return current;
            }
            current = current.parentElement;
        }
        return null;
    }
    /**
     * Get effective scoring mode for an element.
     * Combines config setting with CSS --spatial-navigation-function.
     */
    function getEffectiveScoringMode(element) {
        const config = getConfig();
        // Config override takes precedence
        if (config.scoringMode === 'grid') {
            return 'grid';
        }
        // Check CSS property if enabled
        if (config.useCSSProperties) {
            const cssFunction = getCSSNavFunction(element);
            if (cssFunction === 'grid') {
                return 'grid';
            }
        }
        return 'geometric';
    }
    /**
     * Check if an element or its ancestors have containment.
     */
    function hasNavigationContainment(element) {
        const container = findNavigationContainer(element);
        return {
            contained: container !== null,
            container,
        };
    }

    /**
     * Scoring algorithm for GeckoView Spatial Navigation.
     *
     * Implements geometric and grid-based scoring for directional candidate selection.
     * Uses multi-pass selection with progressively relaxed constraints.
     *
     * See {@link SCORING_CONSTANTS} in `core/config.ts` for the score-weight hierarchy
     * — the comments there explain *why* `SAME_GROUP_BONUS > GROUP_ENTER_LAST_BONUS >
     * GRID_BONUS > scroll-related nudges` is the right ordering.
     */
    const log$b = createLogger('Scoring');
    /**
     * Calculate distance between two points using specified function.
     */
    function calculateDistance(dx, dy, method, direction) {
        switch (method) {
            case 'manhattan':
                return Math.abs(dx) + Math.abs(dy);
            case 'projected':
                // Project distance along navigation axis (WICG-style).
                // Weight the secondary axis lightly to prefer aligned candidates.
                if (direction) {
                    const primary = direction.axis === 'x' ? Math.abs(dx) : Math.abs(dy);
                    const secondary = direction.axis === 'x' ? Math.abs(dy) : Math.abs(dx);
                    return primary + secondary * SCORING_CONSTANTS.PROJECTED_SECONDARY_WEIGHT;
                }
                return Math.sqrt(dx * dx + dy * dy);
            case 'euclidean':
            default:
                return Math.sqrt(dx * dx + dy * dy);
        }
    }
    /**
     * Check if two elements are in the same grid row/column.
     * Used for grid mode navigation.
     */
    function isGridAligned(current, candidate, direction, tolerance) {
        if (direction.axis === 'x') {
            // Horizontal nav: same row → vertical alignment
            const currentMidY = (current.top + current.bottom) / 2;
            const candidateMidY = (candidate.top + candidate.bottom) / 2;
            return Math.abs(currentMidY - candidateMidY) <= tolerance;
        }
        else {
            // Vertical nav: same column → horizontal alignment
            const currentMidX = (current.left + current.right) / 2;
            const candidateMidX = (candidate.left + candidate.right) / 2;
            return Math.abs(currentMidX - candidateMidX) <= tolerance;
        }
    }
    /**
     * Compute directional metrics for a candidate element.
     */
    function computeDirectionalMetrics(current, candidate, direction, options) {
        const config = getConfig();
        const axis = direction.axis;
        const sign = direction.sign;
        const strictEdges = options.strictEdges !== false;
        const allowOverlap = options.allowOverlap === true;
        const overlapThreshold = options.overlapThreshold ?? config.overlapThreshold ?? 0;
        const distanceFunction = options.distanceFunction ?? config.distanceFunction ?? 'euclidean';
        const edgeEps = SCORING_CONSTANTS.EDGE_EPS_BASE + overlapThreshold;
        // Strict edge containment (pass 1)
        if (strictEdges) {
            if (axis === 'x') {
                if (sign > 0 && candidate.left < current.right - edgeEps)
                    return null;
                if (sign < 0 && candidate.right > current.left + edgeEps)
                    return null;
            }
            else {
                if (sign > 0 && candidate.top < current.bottom - edgeEps)
                    return null;
                if (sign < 0 && candidate.bottom > current.top + edgeEps)
                    return null;
            }
        }
        const deltaX = candidate.centerX - current.centerX;
        const deltaY = candidate.centerY - current.centerY;
        const forwardThreshold = allowOverlap
            ? -(SCORING_CONSTANTS.FORWARD_OVERLAP_TOLERANCE_PX + overlapThreshold)
            : SCORING_CONSTANTS.EPSILON;
        // Forward movement check
        if (axis === 'x') {
            if (sign > 0 && deltaX <= forwardThreshold)
                return null;
            if (sign < 0 && deltaX >= -forwardThreshold)
                return null;
        }
        else {
            if (sign > 0 && deltaY <= forwardThreshold)
                return null;
            if (sign < 0 && deltaY >= -forwardThreshold)
                return null;
        }
        const primary = Math.abs(axis === 'x' ? deltaX : deltaY);
        const secondary = Math.abs(axis === 'x' ? deltaY : deltaX);
        const distance = calculateDistance(deltaX, deltaY, distanceFunction, direction);
        // Cone check: reject candidates too far off-axis.
        const coneTolerance = Math.max(SCORING_CONSTANTS.CONE_TOLERANCE_BASE_PX, primary * SCORING_CONSTANTS.CONE_TOLERANCE_RATIO);
        if (secondary > coneTolerance)
            return null;
        // Alignment score: higher = more aligned. Decays linearly until hitting 0.
        const alignment = secondary === 0
            ? SCORING_CONSTANTS.ALIGNMENT_BASE
            : Math.max(0, SCORING_CONSTANTS.ALIGNMENT_BASE - secondary / SCORING_CONSTANTS.ALIGNMENT_DECAY_PX);
        const gridAligned = isGridAligned(current, candidate, direction, config.gridAlignmentTolerance);
        return {
            primary,
            secondary,
            distance,
            alignment,
            deltaX,
            deltaY,
            gridAligned,
        };
    }
    /**
     * Choose the best candidate from all focusables for a given direction.
     * Supports both geometric and grid scoring modes.
     * Respects CSS --spatial-navigation-* properties when enabled.
     */
    function chooseBestCandidate(currentIndex, direction, options, state) {
        const config = getConfig();
        const currentEntry = state.focusables[currentIndex];
        if (!currentEntry || !currentEntry.element) {
            return null;
        }
        updateEntryGeometry(currentEntry, state);
        const strictEdges = options.strictEdges !== false;
        const allowOverlap = options.allowOverlap === true;
        const requireViewport = options.requireViewport !== false;
        const viewportMargin = options.viewportMargin ?? 0;
        const alignmentWeight = options.alignmentWeight ?? SCORING_CONSTANTS.ALIGNMENT_BASE;
        const distanceWeight = options.distanceWeight ?? 1;
        const preferScrollGroup = options.preferScrollGroup !== false;
        const effectiveScoringMode = config.useCSSProperties && currentEntry.element
            ? getEffectiveScoringMode(currentEntry.element)
            : (options.scoringMode ?? config.scoringMode ?? 'geometric');
        const gridBonus = effectiveScoringMode === 'grid' ? SCORING_CONSTANTS.GRID_BONUS : 0;
        const containmentInfo = config.useCSSProperties && currentEntry.element
            ? hasNavigationContainment(currentEntry.element)
            : { contained: false, container: null };
        const candidates = [];
        for (let i = 0; i < state.focusables.length; i++) {
            if (i === currentIndex)
                continue;
            const candidateEntry = state.focusables[i];
            if (!candidateEntry || !candidateEntry.element)
                continue;
            updateEntryGeometry(candidateEntry, state);
            const minSize = config.minElementSize || 1;
            if (!candidateEntry.rect || candidateEntry.width < minSize || candidateEntry.height < minSize) {
                continue;
            }
            if (requireViewport && !isRectVisible(candidateEntry.rect, viewportMargin)) {
                continue;
            }
            // CSS containment: stay within the container if current element is contained.
            if (containmentInfo.contained && containmentInfo.container && candidateEntry.element) {
                if (!containmentInfo.container.contains(candidateEntry.element)) {
                    continue;
                }
            }
            const metrics = computeDirectionalMetrics(currentEntry, candidateEntry, direction, {
                strictEdges,
                allowOverlap,
                overlapThreshold: options.overlapThreshold,
                distanceFunction: options.distanceFunction,
            });
            if (!metrics)
                continue;
            // Linear score: lower = better. Primary axis dominates by 1000x.
            let score = metrics.primary * SCORING_CONSTANTS.PRIMARY_WEIGHT +
                metrics.secondary * alignmentWeight +
                metrics.distance * distanceWeight;
            if (gridBonus && metrics.gridAligned) {
                score -= gridBonus;
            }
            // Focus group logic — see SCORING_CONSTANTS for the bonus hierarchy rationale.
            const currentGroupId = currentEntry.groupId;
            const candidateGroupId = candidateEntry.groupId;
            if (currentGroupId) {
                const currentGroup = state.focusGroups[currentGroupId];
                const isSameGroup = currentGroupId === candidateGroupId;
                // Boundary: contain → don't allow crossing the group's boundary
                if (currentGroup && currentGroup.options.boundary === 'contain' && !isSameGroup) {
                    continue;
                }
                if (isSameGroup) {
                    score -= SCORING_CONSTANTS.SAME_GROUP_BONUS;
                }
            }
            if (candidateGroupId && candidateGroupId !== currentGroupId) {
                const candidateGroup = state.focusGroups[candidateGroupId];
                // enterMode=last: only allow entry via the remembered last-focused element.
                if (candidateGroup && candidateGroup.options.enterMode === 'last' && candidateGroup.lastFocused) {
                    if (candidateEntry.element !== candidateGroup.lastFocused.element) {
                        continue;
                    }
                    score -= SCORING_CONSTANTS.GROUP_ENTER_LAST_BONUS;
                }
            }
            if (preferScrollGroup) {
                if (candidateEntry.scrollKey && candidateEntry.scrollKey === currentEntry.scrollKey) {
                    score -= SCORING_CONSTANTS.SAME_SCROLL_BONUS;
                }
                else {
                    score += SCORING_CONSTANTS.DIFFERENT_SCROLL_PENALTY;
                }
            }
            if (!isRectVisible(candidateEntry.rect, 0)) {
                score += SCORING_CONSTANTS.OFFSCREEN_PENALTY;
            }
            candidates.push({
                index: i,
                data: candidateEntry,
                rect: candidateEntry.rect,
                score,
                metrics,
            });
        }
        if (!candidates.length)
            return null;
        // Sort by score (lower wins), then distance as tiebreaker.
        candidates.sort((a, b) => {
            if (effectiveScoringMode === 'grid') {
                if (a.metrics.gridAligned !== b.metrics.gridAligned) {
                    return a.metrics.gridAligned ? -1 : 1;
                }
            }
            if (a.score !== b.score) {
                return a.score - b.score;
            }
            return a.metrics.distance - b.metrics.distance;
        });
        return candidates[0];
    }
    /**
     * Find directional candidate using multi-pass selection.
     * Uses progressively relaxed constraints across 3 passes; each pass exits
     * early on first hit. Wraps to the opposite edge if `wrapNavigation` is set
     * and no candidate is found.
     */
    function findDirectionalCandidate(currentIndex, direction, state) {
        if (!direction)
            return null;
        const passes = [
            // Pass 1: strict — same viewport, strict edges
            {
                strictEdges: true,
                allowOverlap: false,
                requireViewport: true,
                viewportMargin: 0,
                alignmentWeight: 10,
                distanceWeight: 1,
                preferScrollGroup: true,
            },
            // Pass 2: relaxed — wider viewport, allow overlap
            {
                strictEdges: false,
                allowOverlap: true,
                requireViewport: true,
                viewportMargin: 160,
                alignmentWeight: 8,
                distanceWeight: 0.9,
                preferScrollGroup: true,
            },
            // Pass 3: permissive — any element, no viewport requirement
            {
                strictEdges: false,
                allowOverlap: true,
                requireViewport: false,
                viewportMargin: 0,
                alignmentWeight: 6,
                distanceWeight: 0.7,
                preferScrollGroup: false,
            },
        ];
        for (let i = 0; i < passes.length; i++) {
            const candidate = chooseBestCandidate(currentIndex, direction, passes[i], state);
            if (candidate) {
                candidate.passIndex = i;
                return candidate;
            }
        }
        log$b.debug(`no candidate for ${direction.name} after ${passes.length} passes`);
        const config = getConfig();
        if (config.wrapNavigation) {
            return findWrapCandidate(currentIndex, direction, state);
        }
        return null;
    }
    /**
     * Find wrap navigation candidate — returns element at the opposite edge.
     * Used when wrapNavigation is enabled and normal navigation hits a boundary.
     */
    function findWrapCandidate(currentIndex, direction, state) {
        const currentEntry = state.focusables[currentIndex];
        if (!currentEntry || !currentEntry.element)
            return null;
        updateEntryGeometry(currentEntry, state);
        const config = getConfig();
        const useGridAlignment = config.scoringMode === 'grid';
        const tolerance = config.gridAlignmentTolerance;
        const candidates = [];
        for (let i = 0; i < state.focusables.length; i++) {
            if (i === currentIndex)
                continue;
            const entry = state.focusables[i];
            if (!entry || !entry.element)
                continue;
            updateEntryGeometry(entry, state);
            if (!entry.rect || entry.width <= 1 || entry.height <= 1)
                continue;
            const gridAligned = useGridAlignment
                ? isGridAligned(currentEntry, entry, direction, tolerance)
                : false;
            // Position value chooses element at opposite edge:
            //   down  → smallest top   (topmost)
            //   up    → largest bottom (bottommost)
            //   right → smallest left  (leftmost)
            //   left  → largest right  (rightmost)
            let position;
            switch (direction.name) {
                case 'down':
                    position = entry.top;
                    break;
                case 'up':
                    position = -entry.bottom;
                    break;
                case 'right':
                    position = entry.left;
                    break;
                case 'left':
                    position = -entry.right;
                    break;
            }
            candidates.push({ index: i, data: entry, position, gridAligned });
        }
        if (!candidates.length)
            return null;
        candidates.sort((a, b) => {
            if (useGridAlignment && a.gridAligned !== b.gridAligned) {
                return a.gridAligned ? -1 : 1;
            }
            return a.position - b.position;
        });
        const best = candidates[0];
        return {
            index: best.index,
            data: best.data,
            rect: best.data.rect,
            score: 0,
            metrics: {
                primary: 0,
                secondary: 0,
                distance: 0,
                alignment: 0,
                deltaX: 0,
                deltaY: 0,
                gridAligned: best.gridAligned,
            },
            passIndex: -1, // wrap pass marker
        };
    }

    /**
     * Event utilities for WICG-compliant Navigation Events
     *
     * Implements dispatchNavEvent for navbeforefocus and navnotarget events.
     * Spec: https://drafts.csswg.org/css-nav-1/#events-navigationevent
     */
    /**
     * Dispatch a standard navigation event.
     *
     * @param type - Event type ('navbeforefocus' or 'navnotarget')
     * @param target - Target element to dispatch event on
     * @param details - Event details
     * @returns False if preventDefault() was called, true otherwise
     */
    function dispatchNavEvent(type, target, details) {
        if (!target || !details) {
            return true;
        }
        // Build detail payload with all provided fields
        const detail = {
            dir: details.dir,
            relatedTarget: details.relatedTarget || null,
        };
        // Forward focus-trap metadata for navnotarget events
        if (details.inTrap !== undefined) {
            detail.inTrap = !!details.inTrap;
        }
        if (details.trapElement) {
            detail.trapElement = details.trapElement;
        }
        if (details.escapeElement) {
            detail.escapeElement = details.escapeElement;
        }
        if (details.escapeKey) {
            detail.escapeKey = details.escapeKey;
        }
        const event = new CustomEvent(type, {
            bubbles: true,
            cancelable: true,
            detail: detail,
        });
        return target.dispatchEvent(event);
    }

    /**
     * JSON utilities for Spatial Navigation System
     *
     * Provides safe JSON serialization shared across all modules.
     */
    /**
     * Safely serialize any value to JSON, handling Error objects and circular references.
     * This is used for logging and debugging across the entire spatial navigation system.
     *
     * @param value - The value to serialize
     * @returns JSON string representation
     */
    function safeJson(value) {
        if (value instanceof Error) {
            return JSON.stringify({
                name: value.name,
                message: value.message,
                stack: value.stack,
            });
        }
        if (value &&
            typeof value === 'object' &&
            'message' in value &&
            typeof value.message === 'string') {
            try {
                return JSON.stringify({
                    ...value,
                    message: value.message,
                });
            }
            catch {
                // Fall through to best-effort stringify below.
            }
        }
        try {
            return JSON.stringify(value);
        }
        catch {
            return String(value);
        }
    }
    /**
     * Safely get an attribute from an element, handling any exceptions.
     *
     * @param el - The element to get the attribute from
     * @param attr - The attribute name
     * @returns The attribute value or null
     */
    function safeGetAttr(el, attr) {
        try {
            return el.getAttribute(attr);
        }
        catch {
            return null;
        }
    }

    /**
     * Bridge messaging utilities for Spatial Navigation System
     *
     * Centralizes browser/chrome runtime messaging with consistent
     * Promise/callback handling and error formatting.
     */
    const log$a = createLogger('Bridge');
    /**
     * Get the runtime API (browser.runtime or chrome.runtime).
     * Returns null if no extension bridge is available.
     */
    function getRuntimeApi() {
        const globalAny = globalThis;
        const runtime = globalAny.browser?.runtime ?? globalAny.chrome?.runtime;
        if (!runtime || typeof runtime.sendMessage !== 'function') {
            return null;
        }
        return runtime;
    }
    /**
     * Check if the extension bridge is available for sending messages.
     */
    function canSendMessage() {
        return getRuntimeApi() !== null;
    }
    /**
     * Check if this is running as a Firefox-style extension (Promise API).
     */
    function isFirefoxStyle() {
        const globalAny = globalThis;
        const runtime = getRuntimeApi();
        return runtime !== null && globalAny.browser?.runtime === runtime;
    }
    /**
     * Send a message to the background script.
     * Handles both Firefox Promise API and Chrome callback API.
     *
     * @param message - The message to send
     * @param options - Optional configuration
     * @returns Promise resolving to the bridge result
     */
    async function sendBridgeMessage(message, options = {}) {
        const runtime = getRuntimeApi();
        if (!runtime) {
            if (options.debug) {
                log$a.debug('No extension bridge available');
            }
            return { success: false, error: 'No extension bridge available' };
        }
        try {
            if (options.debug) {
                log$a.debug(`Sending message: ${safeJson(message)}`);
            }
            if (isFirefoxStyle()) {
                // Firefox-style Promise API
                const result = runtime.sendMessage(message);
                if (result && typeof result.then === 'function') {
                    try {
                        const response = await result;
                        if (options.debug) {
                            log$a.debug(`Response (promise): ${safeJson(response)}`);
                        }
                        return { success: true, response };
                    }
                    catch (error) {
                        const errorMessage = formatBridgeError(error);
                        log$a.error(`Bridge error (promise): ${errorMessage}`);
                        return { success: false, error: errorMessage };
                    }
                }
                return { success: true };
            }
            else {
                // Chrome-style callback API
                return new Promise((resolve) => {
                    runtime.sendMessage(message, (response) => {
                        const typedResponse = response;
                        const runtimeWithError = runtime;
                        const lastError = runtimeWithError.lastError;
                        if (lastError) {
                            const errorMessage = formatBridgeError(lastError);
                            log$a.error(`Bridge error (callback): ${errorMessage}`);
                            resolve({ success: false, error: errorMessage });
                        }
                        else {
                            if (options.debug) {
                                log$a.debug(`Response (callback): ${safeJson(typedResponse)}`);
                            }
                            resolve({ success: true, response: typedResponse });
                        }
                    });
                });
            }
        }
        catch (error) {
            const errorMessage = formatBridgeError(error);
            log$a.error(`Bridge exception: ${errorMessage}`);
            return { success: false, error: errorMessage };
        }
    }
    /**
     * Format bridge error for consistent logging.
     */
    function formatBridgeError(error) {
        if (error instanceof Error) {
            return `${error.name}: ${error.message}`;
        }
        if (typeof error === 'object' && error !== null && 'message' in error) {
            return String(error.message);
        }
        return String(error);
    }
    /**
     * Send a focus exit message to the native layer.
     * Falls back to alert() when no extension bridge is available (injected scripts).
     *
     * @param direction - Exit direction (up, down, left, right)
     * @param inTrap - Whether focus is in a trap (dialog, modal)
     * @param options - Optional configuration
     */
    async function sendFocusExit(direction, inTrap, options = { useFallback: true }) {
        // Check if bridge is available
        if (!canSendMessage()) {
            // Fallback for injected scripts (no extension context)
            if (options.useFallback) {
                try {
                    // Use globalThis.alert to ensure we use the mocked version in tests
                    globalThis.alert?.(`__FOCUS_EXIT__:${direction}`);
                }
                catch {
                    // Ignore if alert is not available
                }
            }
            return { success: false, error: 'No extension bridge available' };
        }
        return sendBridgeMessage({
            type: 'focusExit',
            direction,
            inTrap,
        });
    }

    /**
     * Movement logic for Spatial Navigation System
     *
     * Handles directional movement, focus updates, and scroll alignment.
     * Features focus trap detection, accessibility announcements, and candidate caching.
     */
    const log$9 = createLogger('Movement');
    /** Position-hint expiry — older hints are stale for recovery. */
    const POSITION_HINT_EXPIRY_MS = 2000;
    /**
     * Detect if element is within a focus trap (modal, dialog, overlay).
     *
     * @param element - Element to check
     * @param config - Configuration object
     * @returns Trap info or null
     */
    function detectFocusTrap(element, config) {
        if (!config || !config.focusTrapDetection) {
            return null;
        }
        const trapSelectors = [
            '[role="dialog"]',
            '[aria-modal="true"]',
            '.modal:not([style*="display: none"]):not([style*="visibility: hidden"])',
            '.overlay:not([style*="display: none"])',
            '[data-focus-trap]',
            '.MuiDialog-root', // Material UI
            '.ReactModal__Content', // react-modal
            '.chakra-modal__content', // Chakra UI
        ];
        for (const selector of trapSelectors) {
            try {
                const trap = element.closest(selector);
                if (trap) {
                    // Find escape mechanism
                    const closeButton = trap.querySelector('[data-dismiss], [aria-label*="close" i], [aria-label*="Close" i], ' +
                        'button[class*="close" i], .close-button, [data-testid*="close" i]');
                    const escapeKey = trap.dataset.escapeKey || 'Escape';
                    return {
                        trap,
                        escapeKey,
                        closeButton,
                        trapId: trap.id || trap.getAttribute('aria-labelledby') || 'dialog',
                    };
                }
            }
            catch {
                // Invalid selector, continue
            }
        }
        return null;
    }
    /**
     * Pre-compute directional candidates in background for performance.
     *
     * @param state - Global state object
     */
    function precomputeCandidates(state) {
        const config = state.config;
        if (!config.precomputeCandidates) {
            return;
        }
        const schedulePrecompute = (callback) => {
            if (typeof requestIdleCallback !== 'undefined') {
                requestIdleCallback(callback, { timeout: 100 });
            }
            else {
                setTimeout(callback, 50);
            }
        };
        schedulePrecompute(() => {
            const active = getActiveElement();
            // active may be Element, but state.focusableElements is HTMLElement[]
            const currentIndex = active && active instanceof HTMLElement ? state.focusableElements.indexOf(active) : -1;
            if (currentIndex === -1) {
                return;
            }
            // Only recompute if index changed or cache is dirty
            if (state.precomputedForIndex === currentIndex && !state.dirty) {
                return;
            }
            const targets = {};
            const dirMap = directionByName;
            for (const [name, dir] of Object.entries(dirMap)) {
                targets[name] = findDirectionalCandidate(currentIndex, dir, state);
            }
            // PrecomputedTargets interface in state.ts is strict with keys; the
            // runtime targets shape always covers all four directions.
            state.precomputedTargets = targets;
            state.precomputedForIndex = currentIndex;
            state.precomputedTimestamp = Date.now();
            state.dirty = false;
            log$9.debug(`pre-computed candidates for index ${currentIndex}`);
        });
    }
    /**
     * Get cached candidate or compute fresh.
     *
     * @param currentIndex - Current focus index
     * @param direction - Direction object
     * @param state - Global state object
     * @returns Candidate or null
     */
    function getCachedOrComputeCandidate(currentIndex, direction, state) {
        const config = state.config;
        const cacheTimeout = config.precomputeCacheTimeout || 500;
        const cacheAge = Date.now() - (state.precomputedTimestamp || 0);
        const cacheValid = state.precomputedForIndex === currentIndex &&
            !state.dirty &&
            cacheAge < cacheTimeout &&
            state.precomputedTargets;
        if (cacheValid &&
            state.precomputedTargets &&
            state.precomputedTargets[direction.name]) {
            log$9.debug(`using cached candidate for ${direction.name}`);
            return state.precomputedTargets[direction.name];
        }
        return findDirectionalCandidate(currentIndex, direction, state);
    }
    /**
     * Move focus in the specified direction.
     * Includes focus trap detection, accessibility announcements, and candidate caching.
     *
     * @param direction - Direction object {axis, sign, name}
     * @param event - Original keyboard event (optional)
     * @param state - Global state object
     * @returns True if focus moved, false otherwise
     */
    function moveInDirection(direction, event, state) {
        if (state.overlaySuppressed) {
            state.overlaySuppressed = false;
        }
        const config = state.config;
        const active = getActiveElement();
        const currentIndex = active && active instanceof HTMLElement ? state.focusableElements.indexOf(active) : -1;
        if (currentIndex === -1) {
            return false;
        }
        const currentEntry = state.focusables[currentIndex];
        updateEntryGeometry(currentEntry, state);
        // Use cached candidate if available and fresh
        const target = getCachedOrComputeCandidate(currentIndex, direction, state);
        if (!target) {
            // Focus trap detection
            const trapInfo = detectFocusTrap(currentEntry.element, config);
            // Dispatch navnotarget event with trap info
            dispatchNavEvent('navnotarget', currentEntry.element, {
                dir: direction.name,
                inTrap: !!trapInfo,
                trapElement: trapInfo?.trap,
                escapeElement: trapInfo?.closeButton ?? undefined,
                escapeKey: trapInfo?.escapeKey,
            });
            // Accessibility announcement for boundaries
            if (config.announceBoundaries) {
                if (trapInfo) {
                    announce(`In ${trapInfo.trapId}. Press ${trapInfo.escapeKey} to close.`, state, 'polite');
                }
                else {
                    announce(`Edge of content. Cannot move ${direction.name}.`, state, 'polite');
                }
            }
            log$9.debug(`boundary reached, notifying native: ${direction.name}`);
            sendFocusExit(direction.name, !!trapInfo)
                .then((result) => {
                if (!result.success) {
                    log$9.debug('focusExit relay error', result.error);
                }
            })
                .catch((e) => {
                log$9.debug('focusExit error', e);
            });
            // Also dispatch custom event for web app listeners
            try {
                const exitEvent = new CustomEvent('spatialNavigationExit', {
                    detail: {
                        direction: direction.name,
                        inTrap: !!trapInfo,
                        trapInfo: trapInfo,
                    },
                    bubbles: true,
                    cancelable: false,
                });
                document.dispatchEvent(exitEvent);
            }
            catch (e) {
                log$9.warn('failed to dispatch exit event', e);
            }
            // Hide overlay & previews while focus exits to native UI.
            // Without suppression, mutation/scroll observers can re-show the overlay.
            state.overlaySuppressed = true;
            if (state.updateTimer) {
                cancelAnimationFrame(state.updateTimer);
                state.updateTimer = null;
            }
            hideOverlay(state);
            hidePreviewElements(state);
            if (state.nextTargets) {
                state.nextTargets[direction.name] = null;
            }
            // Update current trap state
            state.currentTrap = trapInfo;
            return false;
        }
        // Dispatch navbeforefocus event (cancelable)
        const canMove = dispatchNavEvent('navbeforefocus', target.data.element, {
            dir: direction.name,
            relatedTarget: currentEntry.element,
        });
        if (!canMove) {
            // Web app called preventDefault() on navbeforefocus — cancel navigation.
            log$9.debug('navigation cancelled by navbeforefocus handler');
            if (event) {
                event.preventDefault();
                event.stopPropagation();
            }
            return false;
        }
        if (event) {
            event.preventDefault();
            event.stopPropagation();
        }
        state.lastMove = {
            fromIndex: currentIndex,
            toIndex: target.index,
            direction: direction.name,
            passIndex: typeof target.passIndex === 'number' ? target.passIndex : 0,
            timestamp: Date.now(),
        };
        simulatePointerEvents(currentEntry.element, target.data.element);
        const focusApplied = applyFocus(target.data.element, state);
        if (!focusApplied) {
            return false;
        }
        // FIX: Update state.currentIndex immediately so scroll listeners and other logic
        // see the correct active element.
        state.currentIndex = target.index;
        // Clear trap state when successfully moving
        state.currentTrap = null;
        // Accessibility announcement for successful navigation
        if (config.announceNavigation) {
            const description = getAccessibleDescription(target.data.element, config);
            announce(description, state, 'polite');
        }
        // Update instrumentation immediately for tests
        if (state.instrumentation) {
            state.instrumentation.lastActive = describeElement(target.data.element);
            state.instrumentation.lastOverlay = describeElement(target.data.element);
            state.instrumentation.activeIndex = target.data.index;
            state.instrumentation.lastUpdate = Date.now();
            state.instrumentation.lastDirection = direction.name;
        }
        // Schedule pre-computation for next navigation
        precomputeCandidates(state);
        requestAnimationFrame(function () {
            try {
                const style = window.getComputedStyle(target.data.element);
                const snapAlign = style.scrollSnapAlign;
                let block = 'nearest';
                let inline = 'nearest';
                if (snapAlign && snapAlign !== 'none') {
                    if (snapAlign.includes('start'))
                        block = 'start';
                    else if (snapAlign.includes('center'))
                        block = 'center';
                    else if (snapAlign.includes('end'))
                        block = 'end';
                    // Also handle inline/x-axis if needed, but usually block is primary for vertical lists
                    if (snapAlign.includes('start'))
                        inline = 'start';
                    else if (snapAlign.includes('center'))
                        inline = 'center';
                    else if (snapAlign.includes('end'))
                        inline = 'end';
                }
                target.data.element.scrollIntoView({ block: block, inline: inline });
            }
            catch {
                // ignore scroll failures
            }
        });
        return true;
    }
    /**
     * Ensure there is a valid focused element before processing navigation.
     * Attempts to recover focus if the current element was removed from the DOM.
     * Uses position-based recovery to prevent "popping to top" during virtual scroll.
     *
     * @param state - Global state object
     * @returns Valid focused element or null if none available
     */
    function ensureValidFocus(state) {
        if (state.config && state.config.autoRefocus === false) {
            return getActiveElement();
        }
        const active = getActiveElement();
        if (active && active instanceof HTMLElement && state.focusableElements.includes(active)) {
            return active;
        }
        const lastElement = state.lastFocusedElement;
        if (lastElement && state.focusableElements.includes(lastElement)) {
            // If focus was lost (e.g. due to scrolling/touch), re-apply focus to the last known
            // element so the next D-pad press continues navigation instead of "boundary" no-op.
            if (applyFocus(lastElement, state)) {
                state.currentIndex = state.focusableElements.indexOf(lastElement);
                return lastElement;
            }
        }
        log$9.debug('focus lost, attempting recovery');
        // 1. Recover via stored element description from the last overlay update.
        const lastOverlay = state.instrumentation?.lastOverlay;
        if (lastOverlay) {
            const recovered = state.focusables.find((entry) => {
                return describeElement(entry.element) === lastOverlay;
            });
            if (recovered?.element && applyFocus(recovered.element, state)) {
                log$9.debug(`recovered via lastOverlay: ${lastOverlay}`);
                state.currentIndex = state.focusableElements.indexOf(recovered.element);
                return recovered.element;
            }
        }
        // 2. Position-based recovery using a stored geometric hint.
        // Prevents "popping to top" when virtual scroll recycles the focused element.
        const positionHint = state.lastFocusPosition;
        const hintAgeMs = positionHint ? Date.now() - positionHint.timestamp : Infinity;
        if (positionHint && hintAgeMs < POSITION_HINT_EXPIRY_MS && state.focusables.length > 0) {
            log$9.debug(`using position hint (${hintAgeMs}ms old)`);
            let bestEntry = null;
            let bestDistance = Infinity;
            for (const entry of state.focusables) {
                if (!entry.rect)
                    continue;
                const dx = entry.centerX - positionHint.centerX;
                const dy = entry.centerY - positionHint.centerY;
                const distance = Math.sqrt(dx * dx + dy * dy);
                if (distance < bestDistance) {
                    bestDistance = distance;
                    bestEntry = entry;
                }
            }
            if (bestEntry?.element && applyFocus(bestEntry.element, state)) {
                log$9.debug(`position-based recovery: ${describeElement(bestEntry.element)} at ${bestDistance.toFixed(0)}px`);
                state.currentIndex = state.focusableElements.indexOf(bestEntry.element);
                state.lastFocusPosition = null;
                return bestEntry.element;
            }
        }
        // 3. Strategy fallback: visible element or first.
        const strategy = state.config?.refocusStrategy ?? 'closest';
        const fallbackEntry = strategy === 'first'
            ? state.focusables[0]
            : state.focusables.find((entry) => entry.rect && isRectVisible(entry.rect, 0)) ||
                state.focusables[0];
        if (fallbackEntry?.element && applyFocus(fallbackEntry.element, state)) {
            log$9.debug(`fallback recovery: ${describeElement(fallbackEntry.element)}`);
            state.currentIndex = state.focusableElements.indexOf(fallbackEntry.element);
            return fallbackEntry.element;
        }
        return null;
    }
    function applyFocus(element, state) {
        if (!element) {
            return null;
        }
        const htmlEl = element;
        const tagName = (htmlEl.tagName || '').toLowerCase();
        try {
            // Handle IFrames separately
            if (tagName === 'iframe' && state.config?.iframeSupport?.enabled) {
                const iframeEl = htmlEl;
                if (state.config.iframeSupport.focusMethod === 'contentWindow' &&
                    iframeEl.contentWindow &&
                    typeof iframeEl.contentWindow.focus === 'function') {
                    iframeEl.contentWindow.focus();
                    state.lastFocusedElement = htmlEl;
                    return element;
                }
            }
            const focusWithFallback = () => {
                if (typeof htmlEl.focus !== 'function')
                    return;
                try {
                    htmlEl.focus({ preventScroll: true });
                }
                catch {
                    // Some pages/browsers don't support focus options.
                    try {
                        htmlEl.focus();
                    }
                    catch {
                        // ignore
                    }
                }
            };
            // Standard focus call
            focusWithFallback();
            // Verify focus was accepted
            if (document.activeElement !== htmlEl) {
                // Attempt to make it focusable if it's not
                if (!htmlEl.hasAttribute('tabindex')) {
                    log$9.debug(`element not accepting focus, setting tabindex="-1": ${describeElement(htmlEl)}`);
                    htmlEl.setAttribute('tabindex', '-1');
                    focusWithFallback();
                }
            }
            if (document.activeElement === htmlEl) {
                state.lastFocusedElement = htmlEl;
                return element;
            }
            log$9.debug(`focus call failed to change activeElement for ${describeElement(htmlEl)}; current=${describeElement(document.activeElement)}`);
        }
        catch (e) {
            log$9.warn('error during applyFocus', e);
        }
        // Fallback: update state anyway if we're sure this is what we want?
        // Usually it's better to NOT update state if focus didn't move,
        // but some apps manage focus manually on click/keydown.
        // For now, only update if it's actually active.
        if (document.activeElement === htmlEl) {
            state.lastFocusedElement = htmlEl;
            return element;
        }
        return null;
    }

    /**
     * Click/hit-testing helpers for Spatial Navigation.
     *
     * Kept separate from handlers.ts to reduce file size and make the
     * click path easier to test and reason about.
     */
    function clamp(value, min, max) {
        return Math.min(Math.max(value, min), max);
    }
    function clampToViewport(x, y) {
        const maxX = Math.max(0, (window?.innerWidth ?? 0) - 1);
        const maxY = Math.max(0, (window?.innerHeight ?? 0) - 1);
        return {
            x: clamp(x, 0, maxX),
            y: clamp(y, 0, maxY),
        };
    }
    function isHitWithinTarget(hit, target) {
        if (!hit)
            return false;
        if (hit === target)
            return true;
        try {
            return target.contains(hit);
        }
        catch {
            return false;
        }
    }
    function pickClickPoint(target) {
        const rect = target.getBoundingClientRect();
        const inset = 1;
        const points = [
            { label: 'center', x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
            { label: 'top-left', x: rect.left + inset, y: rect.top + inset },
            { label: 'top-right', x: rect.right - inset, y: rect.top + inset },
            { label: 'bottom-left', x: rect.left + inset, y: rect.bottom - inset },
            { label: 'bottom-right', x: rect.right - inset, y: rect.bottom - inset },
            { label: 'top-center', x: rect.left + rect.width / 2, y: rect.top + inset },
            { label: 'bottom-center', x: rect.left + rect.width / 2, y: rect.bottom - inset },
            { label: 'center-left', x: rect.left + inset, y: rect.top + rect.height / 2 },
            { label: 'center-right', x: rect.right - inset, y: rect.top + rect.height / 2 },
        ];
        for (const point of points) {
            const clamped = clampToViewport(point.x, point.y);
            const hit = document.elementFromPoint(clamped.x, clamped.y);
            if (isHitWithinTarget(hit, target)) {
                return { x: clamped.x, y: clamped.y, label: point.label, hit };
            }
        }
        const fallback = clampToViewport(points[0].x, points[0].y);
        return {
            x: fallback.x,
            y: fallback.y,
            label: 'center',
            hit: document.elementFromPoint(fallback.x, fallback.y),
        };
    }

    /**
     * Focus recovery and overlay update helpers for Spatial Navigation System
     *
     * These utilities are extracted from handlers.ts to reduce coupling
     * and prevent circular dependencies with observer.ts.
     */
    const log$8 = createLogger('Focus');
    /**
     * Schedule an overlay update with requestAnimationFrame.
     * Respects overlay suppression state for focus-exit scenarios.
     *
     * @param target - Target element to highlight
     * @param state - Global state object
     */
    function scheduleOverlayUpdate(target, state) {
        if (state.overlaySuppressed) {
            // Ensure no pending overlay update re-shows the overlay after an exit.
            if (state.updateTimer) {
                cancelAnimationFrame(state.updateTimer);
                state.updateTimer = null;
            }
            if (target && target.nodeType === 1) {
                state.lastFocusedElement = target;
            }
            return;
        }
        if (state.updateTimer) {
            cancelAnimationFrame(state.updateTimer);
        }
        state.updateTimer = requestAnimationFrame(function () {
            if (state.overlaySuppressed) {
                state.updateTimer = null;
                return;
            }
            showOverlay(target, state, true);
            const dirMap = directionByName;
            updatePreviewVisuals(target, null, findDirectionalCandidate, dirMap, describeElement, state);
            // Update instrumentation for tests
            if (state.instrumentation) {
                state.instrumentation.lastActive = describeElement(target) || 'EMPTY_DESC';
                state.instrumentation.lastOverlay = describeElement(target);
                state.instrumentation.activeIndex = state.focusableElements
                    ? state.focusableElements.indexOf(target)
                    : -1;
                state.instrumentation.lastUpdate = Date.now();
            }
            if (target && target.nodeType === 1) {
                state.lastFocusedElement = target;
            }
            state.updateTimer = null;
        });
    }
    /**
     * Store the current focus position as a hint for recovery.
     * Called before DOM mutations to preserve geometric position.
     * This prevents "popping to top" when virtual scroll recycles the focused element.
     *
     * @param state - Global state object
     */
    function storePositionHint(state) {
        const active = getActiveElement();
        if (!active || !(active instanceof HTMLElement)) {
            return;
        }
        const currentIndex = state.focusableElements.indexOf(active);
        if (currentIndex === -1) {
            return;
        }
        const entry = state.focusables[currentIndex];
        if (!entry || !entry.rect) {
            return;
        }
        state.lastFocusPosition = {
            centerX: entry.centerX,
            centerY: entry.centerY,
            top: entry.top,
            left: entry.left,
            elementDesc: describeElement(active),
            timestamp: Date.now(),
        };
        if (DEBUG) {
            log$8.debug(`Stored position hint: ${state.lastFocusPosition.elementDesc} at (${entry.centerX.toFixed(0)}, ${entry.centerY.toFixed(0)})`);
        }
    }

    /**
     * Menu-toggle handling helpers for Spatial Navigation.
     *
     * Some sites use hover-driven navigation menus that open on pointer enter and
     * do not reliably close on click/tap. For D-pad/Enter interactions we treat
     * `aria-haspopup`/`aria-expanded` toggles as true toggles: a second press
     * closes them. We try a hover-exit first (cheap, doesn't move focus); if the
     * menu is still open we fall back to a synthetic "outside click".
     */
    const log$7 = createLogger('MenuToggle');
    const NAV_ROOT_DEPTH_LIMIT = 12;
    const HOVER_EXIT_INSET_PX = 8;
    const FALLBACK_FOCUS_RESTORE_DELAY_MS = 120;
    function isMenuToggleElement(el) {
        const ariaHasPopup = safeGetAttr(el, 'aria-haspopup');
        const ariaExpanded = safeGetAttr(el, 'aria-expanded');
        return (ariaHasPopup !== null && ariaHasPopup !== 'false') || ariaExpanded !== null;
    }
    function isElementVisible(el) {
        if (!el)
            return false;
        try {
            const style = window.getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden')
                return false;
            if (typeof style.opacity === 'string' && style.opacity.length && parseFloat(style.opacity) <= 0)
                return false;
        }
        catch {
            // Fall through to geometry checks below.
        }
        try {
            const rect = el.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
        }
        catch {
            return false;
        }
    }
    function looksLikeSubmenu(el) {
        const tag = el.tagName.toLowerCase();
        if (tag === 'ul' || tag === 'ol')
            return true;
        const role = safeGetAttr(el, 'role');
        if (role === 'menu' || role === 'listbox')
            return true;
        const className = safeGetAttr(el, 'class') || '';
        if (/(menu|submenu|dropdown|child)/i.test(className))
            return true;
        try {
            return !!el.querySelector?.('a[href], button, [role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"]');
        }
        catch {
            return false;
        }
    }
    function findNavigationRoot(start) {
        let current = start;
        let depth = 0;
        while (current && depth < NAV_ROOT_DEPTH_LIMIT) {
            const tagName = current.tagName?.toLowerCase();
            if (tagName === 'nav' || tagName === 'header')
                return current;
            const role = safeGetAttr(current, 'role');
            if (role === 'navigation')
                return current;
            const id = safeGetAttr(current, 'id') || '';
            if (id && /nav/i.test(id) && id.length <= 48) {
                try {
                    if (current.querySelector?.('a, [role="menuitem"], [role="link"]')) {
                        return current;
                    }
                }
                catch {
                    return current;
                }
            }
            current = current.parentElement;
            depth += 1;
        }
        return null;
    }
    function findAssociatedSubmenu(toggle) {
        const ariaControls = safeGetAttr(toggle, 'aria-controls');
        if (ariaControls) {
            const controlled = document.getElementById(ariaControls);
            if (controlled && controlled.nodeType === 1)
                return controlled;
        }
        const nextSibling = toggle.nextElementSibling;
        if (nextSibling && nextSibling.nodeType === 1 && looksLikeSubmenu(nextSibling)) {
            return nextSibling;
        }
        // Common wrappers for drop-down menus.
        const container = toggle.closest?.('.folder-parent, li, nav, header, [role="menuitem"]');
        if (container) {
            for (const child of Array.from(container.children)) {
                if (child === toggle)
                    continue;
                if (child.nodeType === 1 && looksLikeSubmenu(child)) {
                    return child;
                }
            }
        }
        return null;
    }
    function detectMenuToggleState(toggle) {
        const ariaExpanded = safeGetAttr(toggle, 'aria-expanded');
        const submenu = findAssociatedSubmenu(toggle);
        if (ariaExpanded === 'true') {
            return { isOpen: true, ariaExpanded, submenu, reason: 'aria-expanded' };
        }
        if (ariaExpanded === 'false') {
            return { isOpen: false, ariaExpanded, submenu, reason: 'aria-expanded' };
        }
        if (submenu && isElementVisible(submenu)) {
            return { isOpen: true, ariaExpanded, submenu, reason: 'submenu-visible' };
        }
        if (submenu) {
            return { isOpen: false, ariaExpanded, submenu, reason: 'submenu-hidden' };
        }
        return { isOpen: false, ariaExpanded, submenu: null, reason: 'no-submenu' };
    }
    function isWithinAny(hit, roots) {
        if (!hit)
            return false;
        for (const root of roots) {
            if (!root)
                continue;
            if (hit === root)
                return true;
            try {
                if (root.contains(hit))
                    return true;
            }
            catch {
                // ignore
            }
        }
        return false;
    }
    function looksInteractive(el) {
        if (!el)
            return false;
        try {
            const tagName = el.tagName?.toLowerCase();
            if (!tagName)
                return false;
            if (tagName === 'a')
                return safeGetAttr(el, 'href') !== null;
            if (tagName === 'button' || tagName === 'input' || tagName === 'select' || tagName === 'textarea')
                return true;
            const role = safeGetAttr(el, 'role');
            if (role === 'button' || role === 'menuitem' || role === 'link')
                return true;
            const tabIndex = safeGetAttr(el, 'tabindex');
            if (tabIndex !== null && tabIndex !== '-1')
                return true;
            return false;
        }
        catch {
            return false;
        }
    }
    function pickOutsidePoint(options) {
        const inset = HOVER_EXIT_INSET_PX;
        const { toggleRect, submenuRect, exclusions } = options;
        const points = [];
        if (submenuRect) {
            points.push({
                label: 'submenu-below',
                x: submenuRect.left + submenuRect.width / 2,
                y: submenuRect.bottom + inset,
            });
            points.push({ label: 'submenu-right', x: submenuRect.right + inset, y: submenuRect.top + inset });
            points.push({ label: 'submenu-left', x: submenuRect.left - inset, y: submenuRect.top + inset });
            points.push({
                label: 'submenu-above',
                x: submenuRect.left + submenuRect.width / 2,
                y: submenuRect.top - inset,
            });
        }
        points.push({
            label: 'toggle-below',
            x: toggleRect.left + toggleRect.width / 2,
            y: toggleRect.bottom + inset,
        });
        points.push({
            label: 'toggle-above',
            x: toggleRect.left + toggleRect.width / 2,
            y: toggleRect.top - inset,
        });
        points.push({
            label: 'viewport-center',
            x: (window?.innerWidth ?? 0) / 2,
            y: (window?.innerHeight ?? 0) / 2,
        });
        points.push({ label: 'viewport-top-left', x: inset, y: inset });
        points.push({ label: 'viewport-top-right', x: (window?.innerWidth ?? 0) - inset, y: inset });
        points.push({ label: 'viewport-bottom-left', x: inset, y: (window?.innerHeight ?? 0) - inset });
        points.push({
            label: 'viewport-bottom-right',
            x: (window?.innerWidth ?? 0) - inset,
            y: (window?.innerHeight ?? 0) - inset,
        });
        let fallback = null;
        for (const point of points) {
            const clamped = clampToViewport(point.x, point.y);
            const hit = document.elementFromPoint(clamped.x, clamped.y);
            if (isWithinAny(hit, exclusions))
                continue;
            const candidate = { x: clamped.x, y: clamped.y, label: point.label, hit };
            if (!looksInteractive(hit)) {
                return candidate;
            }
            if (!fallback)
                fallback = candidate;
        }
        if (fallback)
            return fallback;
        const center = clampToViewport(toggleRect.left + toggleRect.width / 2, toggleRect.top + toggleRect.height / 2);
        return {
            x: center.x,
            y: center.y,
            label: 'toggle-center',
            hit: document.elementFromPoint(center.x, center.y),
        };
    }
    function dispatchHoverExit(target, clientX, clientY) {
        const commonOptions = {
            bubbles: true,
            cancelable: true,
            view: window,
            clientX,
            clientY,
            buttons: 0,
            detail: 0,
        };
        if (typeof PointerEvent === 'function') {
            const pointerExit = {
                ...commonOptions,
                pointerId: 1,
                pointerType: 'mouse',
                isPrimary: true,
                button: -1,
                pressure: 0,
            };
            target.dispatchEvent(new PointerEvent('pointerout', pointerExit));
            target.dispatchEvent(new PointerEvent('pointerleave', pointerExit));
        }
        target.dispatchEvent(new MouseEvent('mouseout', commonOptions));
        target.dispatchEvent(new MouseEvent('mouseleave', commonOptions));
    }
    function tryCloseOpenMenuToggle(options) {
        const { actionElement, state, event, handlerId, runtimeApi, canRequestNativeClick } = options;
        const menuState = detectMenuToggleState(actionElement);
        if (!menuState.isOpen)
            return false;
        const closeHandlerId = handlerId;
        const menuContainer = actionElement.closest?.('.folder-parent') ||
            actionElement.parentElement ||
            actionElement;
        const navRoot = findNavigationRoot(actionElement);
        const exclusions = [menuContainer, menuState.submenu, actionElement, navRoot].filter(Boolean);
        const submenuRect = menuState.submenu ? menuState.submenu.getBoundingClientRect() : null;
        const toggleRect = actionElement.getBoundingClientRect();
        const outside = pickOutsidePoint({ toggleRect, submenuRect, exclusions });
        log$7.debug(`menu toggle OPEN (${menuState.reason}) — closing via hover-exit + outside click`, {
            toggle: describeElement(actionElement),
            ariaExpanded: menuState.ariaExpanded,
            submenu: menuState.submenu ? describeElement(menuState.submenu) : null,
            navRoot: navRoot ? describeElement(navRoot) : null,
            outside: { label: outside.label, x: outside.x, y: outside.y, hit: describeElement(outside.hit) },
        });
        // 1. Try to close hover-driven menus first (no focus disruption).
        dispatchHoverExit(actionElement, outside.x, outside.y);
        if (menuState.submenu) {
            dispatchHoverExit(menuState.submenu, outside.x, outside.y);
        }
        // 2. If hover-exit closed the menu, skip the outside click entirely.
        //    Outside clicks can steal focus or accidentally trigger nav chrome.
        const afterHover = detectMenuToggleState(actionElement);
        if (!afterHover.isOpen) {
            log$7.debug(`menu closed via hover-exit (${menuState.reason}) — skipping outside click`);
            state.dirty = true;
            try {
                actionElement.focus?.();
                scheduleOverlayUpdate(actionElement, state);
            }
            catch {
                // ignore
            }
            event.preventDefault();
            event.stopPropagation();
            return true;
        }
        // 3. Still open — synthetic outside click as fallback. Defer to a later
        //    task to let any close transitions settle and avoid re-entrancy.
        setTimeout(() => {
            const currentDomHandlerId = document.documentElement.getAttribute('data-spatnav-handler-id');
            if (String(closeHandlerId) !== currentDomHandlerId)
                return;
            const stillOpen = detectMenuToggleState(actionElement);
            if (!stillOpen.isOpen)
                return;
            const toggleRectNow = actionElement.getBoundingClientRect();
            const submenuRectNow = stillOpen.submenu ? stillOpen.submenu.getBoundingClientRect() : submenuRect;
            const outsideNow = pickOutsidePoint({
                toggleRect: toggleRectNow,
                submenuRect: submenuRectNow,
                exclusions,
            });
            log$7.debug('menu still open — outside-click fallback', {
                toggle: describeElement(actionElement),
                outside: {
                    label: outsideNow.label,
                    x: outsideNow.x,
                    y: outsideNow.y,
                    hit: describeElement(outsideNow.hit),
                },
            });
            const runtime = runtimeApi;
            // Native injection produces a Trusted MotionEvent — many sites only
            // close menus on real input. Falls back to JS click otherwise.
            if (canRequestNativeClick && runtime && typeof runtime.sendMessage === 'function') {
                const dpr = window.devicePixelRatio || 1;
                const physicalX = outsideNow.x * dpr;
                const physicalY = outsideNow.y * dpr;
                try {
                    log$7.debug('closing menu toggle via NATIVE outside click', {
                        css: { x: outsideNow.x, y: outsideNow.y, point: outsideNow.label },
                        dpr,
                        final: { x: physicalX, y: physicalY },
                    });
                    runtime.sendMessage({
                        type: 'simulateClick',
                        x: physicalX,
                        y: physicalY,
                        debug: {
                            cssX: outsideNow.x,
                            cssY: outsideNow.y,
                            point: outsideNow.label,
                            hit: describeElement(outsideNow.hit),
                            context: 'menuToggleClose',
                        },
                    });
                }
                catch (e) {
                    log$7.warn('native outside-click failed, using JS fallback', e);
                }
            }
            else {
                const hit = outsideNow.hit;
                try {
                    if (hit && typeof hit.dispatchEvent === 'function') {
                        hit.dispatchEvent(new MouseEvent('mousedown', {
                            bubbles: true,
                            cancelable: true,
                            view: window,
                            clientX: outsideNow.x,
                            clientY: outsideNow.y,
                            buttons: 1,
                            detail: 1,
                        }));
                        hit.dispatchEvent(new MouseEvent('mouseup', {
                            bubbles: true,
                            cancelable: true,
                            view: window,
                            clientX: outsideNow.x,
                            clientY: outsideNow.y,
                            buttons: 1,
                            detail: 1,
                        }));
                    }
                    if (hit && typeof hit.click === 'function') {
                        hit.click();
                    }
                    else if (typeof document.body?.click === 'function') {
                        document.body.click();
                    }
                }
                catch {
                    // ignore
                }
            }
            // Restore focus to the toggle after the outside-click has propagated.
            // Native injection typically moves focus to the clicked element.
            setTimeout(() => {
                const currentId2 = document.documentElement.getAttribute('data-spatnav-handler-id');
                if (String(closeHandlerId) !== currentId2)
                    return;
                try {
                    actionElement.focus?.();
                    scheduleOverlayUpdate(actionElement, state);
                }
                catch {
                    // ignore
                }
            }, FALLBACK_FOCUS_RESTORE_DELAY_MS);
        }, 0);
        state.dirty = true;
        event.preventDefault();
        event.stopPropagation();
        return true;
    }

    /**
     * Event handlers for Spatial Navigation.
     *
     * Manages keyboard event listeners and orchestrates navigation. Two
     * GeckoView-specific defenses live here that are easy to break in refactors:
     *
     * 1. **Stale-handler guard via DOM attribute.** Content scripts can be re-injected
     *    on every navigation. Each injection runs in an isolated world with its own
     *    `window` global, so a window-keyed flag can't see prior installs. The DOM,
     *    however, is shared. We stamp `data-spatnav-handler-id` on `documentElement`
     *    on each `attachHandlers()` and check it inside every keydown — older
     *    handlers see a mismatch and short-circuit.
     *
     * 2. **Atomic event lock per keypress.** Synthetic `KeyboardEvent`s in GeckoView
     *    can have a non-unique or constant `timeStamp` (e.g. 0). To prevent
     *    duplicate handling across overlapping handlers/isolated worlds we set a
     *    DOM attribute lock keyed by `type:key:timeStamp` before any other work,
     *    and clear it at the end of the current task (microtask if available).
     *    The lock release is critical — without it, subsequent presses get blocked.
     */
    const log$6 = createLogger('Handlers');
    // --- Constants -------------------------------------------------------------
    /** Discard rapid same-key repeats fired within this many milliseconds. */
    const RAPID_REPEAT_THRESHOLD_MS = 50;
    /** Throttle for refreshing the focusable cache during keydown bursts. */
    const REFRESH_THROTTLE_MS = 150;
    /** Click-animation pulse duration. */
    const CLICK_ANIMATION_MS = 150;
    /** DOM attributes used for cross-world coordination. */
    const HANDLER_ID_ATTR = 'data-spatnav-handler-id';
    const HANDLER_COUNTER_ATTR = 'data-spatnav-handler-counter';
    const EVENT_LOCK_ATTR = 'data-spatnav-event-lock';
    // Tags that should receive a Trusted-event native click rather than a JS .click().
    // These categories often gate behavior (lightboxes, players, popovers) on
    // `event.isTrusted` being true, which only native MotionEvent injection provides.
    const NATIVE_CLICK_TAGS = new Set(['div', 'span', 'button', 'video', 'img']);
    // Native `<input>` types that don't carry editable text — Enter/Space should still
    // activate them rather than insert a newline/space.
    const NON_EDITABLE_INPUT_TYPES = new Set(['button', 'submit', 'reset', 'checkbox', 'radio', 'image', 'file']);
    // =============================================================================
    // Keydown handler
    // =============================================================================
    /**
     * Handle key down events for spatial navigation.
     */
    function handleKeyDown(event, state) {
        if (!event)
            return;
        // 1. Stale-handler guard — see file header.
        const myHandlerId = state.handlerId;
        const currentDomHandlerId = document.documentElement.getAttribute(HANDLER_ID_ATTR);
        if (String(myHandlerId) !== currentDomHandlerId) {
            log$6.debug(`stale handler blocked: my=${myHandlerId} current=${currentDomHandlerId}`);
            return;
        }
        // 2. Atomic event lock — see file header.
        const timeStamp = Number.isFinite(event.timeStamp) ? event.timeStamp : 0;
        const eventLockKey = `${event.type || 'keydown'}:${event.key || ''}:${timeStamp.toFixed(3)}`;
        const currentLock = document.documentElement.getAttribute(EVENT_LOCK_ATTR);
        if (currentLock === eventLockKey) {
            log$6.debug(`event lock hit: ${eventLockKey}`);
            return;
        }
        document.documentElement.setAttribute(EVENT_LOCK_ATTR, eventLockKey);
        const clearLock = () => {
            try {
                const lockValue = document.documentElement.getAttribute(EVENT_LOCK_ATTR);
                if (lockValue !== eventLockKey)
                    return;
                document.documentElement.removeAttribute(EVENT_LOCK_ATTR);
            }
            catch {
                // Ignore — DOM may be detached during unload.
            }
        };
        if (typeof queueMicrotask === 'function') {
            queueMicrotask(clearLock);
        }
        else {
            setTimeout(clearLock, 0);
        }
        // 3. Stop other handlers (older handlers without the lock check) from running.
        event.stopImmediatePropagation();
        // 4. Track keydown stats for the debug API.
        const debugNow = Date.now();
        window.__SPATIAL_NAV_KEYDOWN_COUNT__ = (window.__SPATIAL_NAV_KEYDOWN_COUNT__ || 0) + 1;
        const callCount = window.__SPATIAL_NAV_KEYDOWN_COUNT__;
        const lastTime = window.__SPATIAL_NAV_LAST_KEY_TIME__ || 0;
        const lastKey = window.__SPATIAL_NAV_LAST_KEY__ || '';
        const timeSinceLast = debugNow - lastTime;
        log$6.debug(`keydown #${callCount} key="${event.key}" handler=${myHandlerId} since=${timeSinceLast}ms`);
        window.__SPATIAL_NAV_LAST_KEY_TIME__ = debugNow;
        window.__SPATIAL_NAV_LAST_KEY__ = event.key;
        // 5. Drop rapid same-key repeats — likely synthetic-event duplicates.
        if (event.key === lastKey && timeSinceLast < RAPID_REPEAT_THRESHOLD_MS && timeSinceLast > 0) {
            log$6.debug(`rapid repeat blocked: "${event.key}" within ${timeSinceLast}ms`);
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            return;
        }
        // 6. ENTER and SPACE — activate the focused element.
        if (event.key === 'Enter' || event.key === ' ') {
            handleActivationKey(event, state, myHandlerId);
            return;
        }
        // 7. Arrow keys — directional navigation.
        const keyMap = directionByKey;
        if (!keyMap[event.key])
            return;
        log$6.debug(`directional key: ${event.key}`);
        const now = Date.now();
        const lastRefresh = state.lastRefreshTime || 0;
        if (state.dirty || now - lastRefresh > REFRESH_THROTTLE_MS) {
            refreshFocusables(state);
            state.lastRefreshTime = now;
            state.dirty = false;
        }
        if (state.focusables.length === 0) {
            refreshFocusables(state);
            state.lastRefreshTime = Date.now();
            if (state.focusables.length === 0) {
                log$6.debug('no focusable elements found');
                // Block default to keep focus from escaping to the address bar.
                event.preventDefault();
                event.stopPropagation();
                return;
            }
        }
        const validActive = ensureValidFocus(state);
        if (!validActive) {
            log$6.warn('unable to recover focus — aborting navigation');
            event.preventDefault();
            event.stopPropagation();
            return;
        }
        const currentActive = validActive;
        const currentIndex = currentActive ? state.focusableElements.indexOf(currentActive) : -1;
        log$6.debug(`current focus: ${describeElement(currentActive)} (index=${currentIndex})`);
        const dirMap = directionByName;
        const targets = updatePreviewTargets(currentIndex, findDirectionalCandidate, dirMap, state);
        log$6.debug('next targets', {
            up: targets.up?.data ? describeElement(targets.up.data.element) : null,
            down: targets.down?.data ? describeElement(targets.down.data.element) : null,
            left: targets.left?.data ? describeElement(targets.left.data.element) : null,
            right: targets.right?.data ? describeElement(targets.right.data.element) : null,
        });
        const direction = keyMap[event.key];
        log$6.debug(`moving direction: ${direction.name}`);
        const moved = moveInDirection(direction, event, state);
        const afterActive = getActiveElement();
        if (!moved) {
            log$6.debug('movement failed — retrying with forced refresh');
            refreshFocusables(state);
            state.lastRefreshTime = Date.now();
            const retryMoved = moveInDirection(direction, event, state);
            if (!retryMoved) {
                log$6.debug(`boundary reached: ${direction.name}`);
                state.lastBoundary = direction.name;
                event.preventDefault();
                event.stopPropagation();
            }
            else {
                log$6.debug('retry succeeded');
                const newActive = getActiveElement();
                if (newActive)
                    scheduleOverlayUpdate(newActive, state);
            }
        }
        else {
            log$6.debug(`new focus: ${describeElement(afterActive)}`);
            if (afterActive)
                scheduleOverlayUpdate(afterActive, state);
        }
    }
    // =============================================================================
    // Enter / Space activation
    // =============================================================================
    function handleActivationKey(event, state, handlerId) {
        const activeElement = getActiveElement();
        if (!activeElement)
            return;
        const tagName = activeElement.tagName.toLowerCase();
        const htmlElement = activeElement;
        const inputElement = activeElement;
        const isEditable = htmlElement.isContentEditable ||
            tagName === 'textarea' ||
            (tagName === 'input' && !NON_EDITABLE_INPUT_TYPES.has(inputElement.type || ''));
        if (isEditable)
            return;
        const href = safeGetAttr(activeElement, 'href');
        const role = safeGetAttr(activeElement, 'role');
        const ariaHasPopup = safeGetAttr(activeElement, 'aria-haspopup');
        const ariaExpanded = safeGetAttr(activeElement, 'aria-expanded');
        log$6.debug(`${event.key === ' ' ? 'SPACE' : 'ENTER'} on ${describeElement(activeElement)}`, {
            tagName,
            role,
            hasHref: !!href,
            ariaHasPopup,
            ariaExpanded,
        });
        // Prefer the nearest menu-toggle element; many nav menus attach handlers to the toggle.
        let actionElement = activeElement;
        try {
            const menuToggle = activeElement.closest?.('[aria-haspopup], [aria-expanded]');
            if (menuToggle)
                actionElement = menuToggle;
        }
        catch {
            // ignore
        }
        const actionTag = actionElement.tagName.toLowerCase();
        const actionRole = safeGetAttr(actionElement, 'role');
        const isMenuToggle = isMenuToggleElement(actionElement);
        // Native click is needed for elements that gate behavior on Trusted events:
        // anchors without href, role=button divs/spans, custom interactive elements,
        // or media (lightboxes/players). See NATIVE_CLICK_TAGS.
        const wantsNativeClick = (actionTag === 'a' && !actionElement.hasAttribute('href')) ||
            NATIVE_CLICK_TAGS.has(actionTag) ||
            actionRole === 'button';
        // `browser` (Firefox) and `chrome` (Chromium) may both be undeclared in
        // standalone/test environments — use globalThis lookup so a missing global
        // doesn't throw ReferenceError.
        const g = globalThis;
        const runtimeApi = g.browser?.runtime ?? g.chrome?.runtime;
        const canRequestNativeClick = !!runtimeApi && typeof runtimeApi.sendMessage === 'function';
        if (isMenuToggle) {
            const didClose = tryCloseOpenMenuToggle({
                actionElement,
                state,
                event,
                handlerId,
                runtimeApi,
                canRequestNativeClick,
            });
            if (didClose)
                return;
        }
        const useNativeClick = canRequestNativeClick && wantsNativeClick;
        log$6.debug(`click strategy: ${useNativeClick ? 'NATIVE' : 'JS .click()'}`, {
            actionTag,
            actionRole,
            isMenuToggle,
            runtimeMode: state.runtime?.mode,
        });
        // Pick a coordinate that hits the visible target.
        const actionRect = actionElement.getBoundingClientRect();
        const actionCenter = clampToViewport(actionRect.left + actionRect.width / 2, actionRect.top + actionRect.height / 2);
        const initialHit = document.elementFromPoint(actionCenter.x, actionCenter.y) || actionElement;
        const clickTarget = isMenuToggle ? actionElement : initialHit;
        const picked = pickClickPoint(clickTarget);
        const x = picked.x;
        const y = picked.y;
        log$6.debug('hit-test', {
            action: describeElement(actionElement),
            clickTarget: describeElement(clickTarget),
            actionCenter: { x: actionCenter.x, y: actionCenter.y, hit: describeElement(initialHit) },
            picked: { x, y, label: picked.label, hit: describeElement(picked.hit) },
        });
        const commonOptions = {
            bubbles: true,
            cancelable: true,
            view: window,
            clientX: x,
            clientY: y,
            buttons: 1,
            detail: 1,
        };
        if (useNativeClick) {
            dispatchHoverPrime(clickTarget, commonOptions);
            if (typeof htmlElement.focus === 'function')
                htmlElement.focus();
            log$6.debug('requesting native MotionEvent injection');
            // Convert CSS px → physical px for Android MotionEvent.
            const dpr = window.devicePixelRatio || 1.0;
            const finalX = x * dpr;
            const finalY = y * dpr;
            log$6.debug('native injection request', {
                css: { x, y, point: picked.label },
                dpr,
                final: { x: finalX, y: finalY },
            });
            try {
                const message = {
                    type: 'simulateClick',
                    x: finalX,
                    y: finalY,
                };
                const sendMessage = runtimeApi.sendMessage;
                if (typeof sendMessage !== 'function') {
                    throw new Error('runtime.sendMessage unavailable');
                }
                if (g.browser?.runtime === runtimeApi) {
                    // Firefox: Promise API
                    const result = sendMessage(message);
                    if (result && typeof result.then === 'function') {
                        result
                            .then((response) => {
                            log$6.debug('background relay success (promise)', response);
                        })
                            .catch((error) => {
                            log$6.error('background relay failed (promise)', error);
                        });
                    }
                }
                else {
                    // Chrome: callback API
                    sendMessage(message, (response) => {
                        const error = runtimeApi.lastError;
                        if (error) {
                            log$6.error('background relay failed (lastError)', error);
                        }
                        else {
                            log$6.debug('background relay success (callback)', response);
                        }
                    });
                }
            }
            catch (e) {
                log$6.warn('native injection unavailable, falling back to JS .click()', e);
                try {
                    if (typeof clickTarget.click === 'function') {
                        clickTarget.click();
                    }
                    else {
                        htmlElement.click();
                    }
                }
                catch {
                    htmlElement.click();
                }
                event.preventDefault();
                event.stopPropagation();
                return;
            }
            applyClickFeedback(state, htmlElement);
            event.preventDefault();
            event.stopPropagation();
            return;
        }
        // JS click simulation (no extension bridge or doesn't need trusted event).
        dispatchFullPointerSequence(clickTarget, htmlElement, commonOptions);
        try {
            if (typeof clickTarget.click === 'function') {
                clickTarget.click();
            }
            else {
                htmlElement.click();
            }
        }
        catch {
            htmlElement.click();
        }
        applyClickFeedback(state, htmlElement);
        event.preventDefault();
        event.stopPropagation();
    }
    function dispatchHoverPrime(target, opts) {
        if (typeof PointerEvent === 'function') {
            const pointerHover = {
                ...opts,
                pointerId: 1,
                pointerType: 'touch',
                isPrimary: true,
                button: 0,
                pressure: 0,
            };
            target.dispatchEvent(new PointerEvent('pointerover', pointerHover));
            target.dispatchEvent(new PointerEvent('pointerenter', pointerHover));
        }
        target.dispatchEvent(new MouseEvent('mouseover', opts));
        target.dispatchEvent(new MouseEvent('mouseenter', opts));
    }
    function dispatchFullPointerSequence(target, activeElement, opts) {
        if (typeof PointerEvent === 'function') {
            const pointerBase = {
                ...opts,
                pointerId: 1,
                pointerType: 'touch',
                isPrimary: true,
                button: 0,
                pressure: 0.5,
            };
            target.dispatchEvent(new PointerEvent('pointerover', pointerBase));
            target.dispatchEvent(new PointerEvent('pointerenter', pointerBase));
            target.dispatchEvent(new PointerEvent('pointerdown', pointerBase));
        }
        target.dispatchEvent(new MouseEvent('mouseover', opts));
        target.dispatchEvent(new MouseEvent('mouseenter', opts));
        target.dispatchEvent(new MouseEvent('mousedown', opts));
        if (typeof activeElement.focus === 'function')
            activeElement.focus();
        target.dispatchEvent(new MouseEvent('mouseup', opts));
        if (typeof PointerEvent === 'function') {
            const pointerUp = {
                ...opts,
                pointerId: 1,
                pointerType: 'touch',
                isPrimary: true,
                button: 0,
                pressure: 0,
            };
            target.dispatchEvent(new PointerEvent('pointerup', pointerUp));
        }
    }
    function applyClickFeedback(state, activeElement) {
        if (!state.overlay)
            return;
        state.overlay.classList.remove('click-animate');
        void state.overlay.offsetWidth; // force reflow so the animation restarts
        state.overlay.classList.add('click-animate');
        activeElement.classList.add('spatnav-pressed');
        setTimeout(() => {
            if (state.overlay)
                state.overlay.classList.remove('click-animate');
            activeElement.classList.remove('spatnav-pressed');
        }, CLICK_ANIMATION_MS);
    }
    // =============================================================================
    // Scroll listener
    // =============================================================================
    /**
     * Attach a scroll listener (capture phase) that updates the overlay when the
     * focused element's viewport position changes. Uses rAF + per-element scroll
     * cache to coalesce updates and skip jitter from smooth-scrolling.
     */
    function attachScrollListener(state) {
        const config = state.config;
        if (config.observeScroll === false) {
            log$6.debug('scroll listener disabled by config');
            return;
        }
        const scrollPositions = new WeakMap();
        let scrollTimer = null;
        window.addEventListener('scroll', (event) => {
            if (scrollTimer)
                return;
            scrollTimer = requestAnimationFrame(() => {
                const rawTarget = event && event.target ? event.target : window;
                if (!rawTarget) {
                    scrollTimer = null;
                    return;
                }
                const target = rawTarget === document ? window : rawTarget;
                const threshold = config.scrollThreshold || 8;
                let currentScrollY;
                let currentScrollX;
                if (target === window) {
                    currentScrollY = window.scrollY;
                    currentScrollX = window.scrollX;
                }
                else if (target.scrollTop !== undefined) {
                    currentScrollY = target.scrollTop;
                    currentScrollX = target.scrollLeft;
                }
                else {
                    scrollTimer = null;
                    return;
                }
                const cached = scrollPositions.get(target) || {
                    scrollY: currentScrollY,
                    scrollX: currentScrollX,
                };
                const deltaY = Math.abs(currentScrollY - cached.scrollY);
                const deltaX = Math.abs(currentScrollX - cached.scrollX);
                // Only update if scroll moved past threshold (prevents smooth-scroll jitter).
                if (deltaY > threshold || deltaX > threshold) {
                    const active = getActiveElement();
                    if (active && state.currentIndex !== -1) {
                        const currentEntry = state.focusables[state.currentIndex];
                        if (currentEntry) {
                            const rect = active.getBoundingClientRect();
                            currentEntry.left = rect.left;
                            currentEntry.top = rect.top;
                            currentEntry.right = rect.right;
                            currentEntry.bottom = rect.bottom;
                            currentEntry.centerX = rect.left + rect.width / 2;
                            currentEntry.centerY = rect.top + rect.height / 2;
                            currentEntry.rect = rect;
                            scheduleOverlayUpdate(active, state);
                        }
                    }
                    scrollPositions.set(target, {
                        scrollY: currentScrollY,
                        scrollX: currentScrollX,
                    });
                }
                scrollTimer = null;
            });
        }, {
            capture: true, // Catch overflow:auto sub-scrollers in capture phase
            passive: true, // Don't block scrolling
        });
        state.scrollListenerAttached = true;
    }
    // =============================================================================
    // Public attachment
    // =============================================================================
    /**
     * Attach global event listeners.
     *
     * Generates a fresh `handlerId` and stamps it on the DOM so that older handlers
     * (from prior content-script injections) self-disable on the next keypress.
     *
     * Why state-only guard, not window-level: window properties live in isolated
     * worlds, so a window flag from a previous injection wouldn't be visible here
     * — we'd attach a duplicate handler. The DOM attribute is shared; the
     * stale-handler guard inside `handleKeyDown` deduplicates at event time.
     */
    function attachHandlers(state) {
        // Bump the handler counter on the DOM (shared across isolated worlds).
        const counterAttr = document.documentElement.getAttribute(HANDLER_COUNTER_ATTR);
        const existingCounter = parseInt(counterAttr || '0', 10);
        const newCounter = existingCounter + 1;
        document.documentElement.setAttribute(HANDLER_COUNTER_ATTR, String(newCounter));
        // Compose a unique handler ID from time + counter + random — same-millisecond
        // inits still get distinct IDs.
        const handlerId = (Date.now() % 100000) * 1000 + newCounter * 100 + Math.floor(Math.random() * 100);
        if (state.handlersAttached) {
            log$6.debug('state already has handlers, skipping');
            return;
        }
        document.documentElement.setAttribute(HANDLER_ID_ATTR, String(handlerId));
        state.handlerId = handlerId;
        window.__SPATIAL_NAV_HANDLER_ID__ = handlerId;
        window.__SPATIAL_NAV_KEYDOWN_COUNT__ = 0;
        // Capture handlerId in closure — `state.handlerId` gets overwritten by newer handlers.
        const capturedHandlerId = handlerId;
        window.addEventListener('keydown', function (e) {
            const currentDomHandlerId = document.documentElement.getAttribute(HANDLER_ID_ATTR);
            if (String(capturedHandlerId) !== currentDomHandlerId) {
                return;
            }
            handleKeyDown(e, state);
        }, true);
        window.addEventListener('focus', function (e) {
            const target = e.target;
            if (target === window || target === document)
                return;
            refreshFocusables(state);
            scheduleOverlayUpdate(target, state);
        }, true);
        attachScrollListener(state);
        state.handlersAttached = true;
    }

    /**
     * Mutation Observer utilities for Spatial Navigation System
     *
     * Handles DOM mutation detection with buffered architecture and conditional refresh.
     * Features framework-aware refresh scheduling for React/Vue/Angular.
     */
    const log$5 = createLogger('Observer');
    /** Mutation attributes worth observing — narrow filter improves perf on busy SPAs. */
    const RELEVANT_ATTRIBUTES = [
        'style',
        'class',
        'disabled',
        'hidden',
        'aria-hidden',
        'tabindex',
        'contenteditable',
    ];
    // Mutation buffer for batching changes
    const mutationBuffer = [];
    let mutationTimer = null;
    /**
     * Framework adapters for delayed refresh after reconciliation.
     */
    const frameworkAdapters = {
        react: {
            name: 'React',
            detect: () => {
                const hasHook = typeof window !== 'undefined' && window.__REACT_DEVTOOLS_GLOBAL_HOOK__;
                const reactRoot = document.querySelector('[data-reactroot]');
                const reactId = document.querySelector('[data-reactid]');
                return !!(hasHook || reactRoot || reactId);
            },
            scheduleRefresh: (callback) => {
                // React uses scheduler internally; use postTask if available
                if (typeof scheduler !== 'undefined' && scheduler.postTask) {
                    scheduler.postTask(callback, { priority: 'background' });
                }
                else if (typeof requestIdleCallback !== 'undefined') {
                    requestIdleCallback(callback, { timeout: 200 });
                }
                else {
                    // Fallback: wait for microtask + rAF
                    Promise.resolve().then(() => requestAnimationFrame(callback));
                }
            },
        },
        vue: {
            name: 'Vue',
            detect: () => {
                const hasVue = typeof window !== 'undefined' && window.__VUE__;
                const vueData = document.querySelector('[data-v-]');
                const vueApp = document.querySelector('.__vue_app__');
                return !!(hasVue || vueData || vueApp);
            },
            scheduleRefresh: (callback) => {
                // Vue uses nextTick which schedules after microtasks
                Promise.resolve().then(() => setTimeout(callback, 50));
            },
        },
        angular: {
            name: 'Angular',
            detect: () => {
                const hasTestability = typeof window !== 'undefined' && typeof window.getAllAngularTestabilities === 'function';
                const ngVersion = document.querySelector('[ng-version]');
                const appRoot = document.querySelector('app-root');
                return !!(hasTestability || ngVersion || appRoot);
            },
            scheduleRefresh: (callback) => {
                // Use Angular's testability API if available
                if (typeof window.getAllAngularTestabilities === 'function') {
                    const testabilities = window.getAllAngularTestabilities();
                    if (testabilities && testabilities.length > 0) {
                        testabilities[0].whenStable(callback);
                        return;
                    }
                }
                // Fallback: wait for zone.js to settle
                setTimeout(callback, 100);
            },
        },
        svelte: {
            name: 'Svelte',
            detect: () => {
                return !!(typeof window !== 'undefined' && document.querySelector('[class*="svelte-"]'));
            },
            scheduleRefresh: (callback) => {
                // Svelte is synchronous, just use microtask
                Promise.resolve().then(callback);
            },
        },
    };
    /**
     * Detect which framework is being used (cached).
     *
     * @param state - Global state object
     * @returns Framework adapter or null
     */
    function detectFramework(state) {
        // Use cached result if available
        if (state.detectedFramework) {
            return state.detectedFramework;
        }
        if (state.detectedFramework === false) {
            return null;
        }
        for (const [, adapter] of Object.entries(frameworkAdapters)) {
            try {
                if (adapter.detect()) {
                    log$5.debug(`detected framework: ${adapter.name}`);
                    state.detectedFramework = adapter;
                    return adapter;
                }
            }
            catch {
                // Detection failed, try next.
            }
        }
        state.detectedFramework = false; // Mark as "no framework detected"
        return null;
    }
    /**
     * Schedule a refresh with framework-aware timing.
     *
     * @param callback - Refresh callback
     * @param state - Global state object
     */
    function scheduleFrameworkAwareRefresh(callback, state) {
        const config = state.config;
        if (!config.frameworkAwareRefresh) {
            // Framework-aware refresh disabled, run immediately
            callback();
            return;
        }
        const framework = detectFramework(state);
        if (framework) {
            framework.scheduleRefresh(callback);
        }
        else {
            // No framework detected, run immediately
            callback();
        }
    }
    /**
     * Process buffered mutations with conditional refresh strategy.
     * Uses framework-aware scheduling for optimal performance.
     *
     * @param state - Global state object
     */
    function flushMutations(state) {
        if (mutationBuffer.length === 0)
            return;
        const config = state.config;
        const debounce = config.mutationDebounce || 100;
        if (mutationTimer)
            clearTimeout(mutationTimer);
        mutationTimer = setTimeout(() => {
            // CRITICAL: Store position hint BEFORE any refresh to enable geometric recovery
            // This prevents "popping to top" when virtual scroll recycles the focused element
            storePositionHint(state);
            // Check if we need full refresh (DOM structure changed)
            const needsFullRefresh = mutationBuffer.some((m) => m.type === 'childList');
            // Invalidate precomputed cache
            state.dirty = true;
            state.precomputedTargets = null;
            const doRefresh = () => {
                if (needsFullRefresh) {
                    log$5.debug('childList mutation → full refresh');
                    refreshFocusables(state);
                }
                else {
                    log$5.debug('attribute mutation → incremental update');
                    refreshAttributes(state, mutationBuffer);
                }
                const active = getActiveElement();
                if (active && state.focusableElements && state.focusableElements.includes(active)) {
                    scheduleOverlayUpdate(active, state);
                }
                else if (state.overlay) {
                    log$5.debug('current focus invalidated by mutation, hiding overlay');
                    hideOverlay(state);
                }
            };
            // Use framework-aware scheduling
            scheduleFrameworkAwareRefresh(doRefresh, state);
            mutationBuffer.length = 0; // Clear buffer
            mutationTimer = null;
        }, debounce);
    }
    /**
     * Attach MutationObserver with buffered architecture.
     *
     * @param state - Global state object
     */
    function attachMutationObserver(state) {
        if (state.mutationObserver)
            return;
        const config = state.config;
        if (config.observeMutations === false) {
            log$5.debug('mutation observer disabled by config');
            return;
        }
        const observer = new MutationObserver((mutations) => {
            const relevantMutations = mutations.filter((mutation) => {
                if (mutation.type === 'childList') {
                    return mutation.addedNodes.length > 0 || mutation.removedNodes.length > 0;
                }
                if (mutation.type === 'attributes') {
                    return RELEVANT_ATTRIBUTES.includes(mutation.attributeName || '');
                }
                return false;
            });
            if (relevantMutations.length > 0) {
                mutationBuffer.push(...relevantMutations);
                flushMutations(state);
            }
        });
        observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: RELEVANT_ATTRIBUTES,
        });
        state.mutationObserver = observer;
        log$5.debug('mutation observer attached');
    }

    /**
     * Deprecation helpers for legacy `flutter*` window APIs.
     *
     * The library renamed its public globals in v3.0.0 (`flutterFocusState` →
     * `spatialNavState`, `flutterShowOverlay` → `showSpatialNavOverlay`). Removing
     * the old names immediately would break flutter-geckoview hosts that took the
     * v2 API as a hard dependency. We keep the legacy names alive for one major
     * version, but route the first read through a getter that warns once.
     *
     * Schedule:
     *   - v3.x — legacy aliases work, log a warning on first access
     *   - v4.0 — legacy aliases removed
     */
    const log$4 = createLogger('Deprecation');
    const warnedKeys = new Set();
    function warnOnce(name, replacement) {
        if (warnedKeys.has(name))
            return;
        warnedKeys.add(name);
        log$4.warn(`\`window.${name}\` is deprecated and will be removed in v4. ` +
            `Use \`window.${replacement}\` instead.`);
    }
    /**
     * Define a one-shot warning getter for a legacy window property.
     * Falls back to plain assignment if `defineProperty` is rejected (some
     * embedded browsers do not allow it on `window`).
     */
    function defineLegacyAlias(name, replacement, value) {
        try {
            Object.defineProperty(window, name, {
                configurable: true,
                enumerable: true,
                get: () => {
                    warnOnce(name, replacement);
                    return value;
                },
                set: (v) => {
                    warnOnce(name, replacement);
                    window[`__${name}_value`] = v;
                },
            });
        }
        catch {
            window[name] = value;
        }
    }
    /**
     * Install legacy state/overlay aliases that warn on first access.
     *
     * Properties:
     *   - `window.flutterFocusState`        → `window.spatialNavState`
     *   - `window.flutterShowOverlay(el)`   → `window.showSpatialNavOverlay(el)`
     */
    function installLegacyDeprecations(state, overlayHandler) {
        defineLegacyAlias('flutterFocusState', 'spatialNavState', state);
        const legacyShow = (element) => {
            warnOnce('flutterShowOverlay', 'showSpatialNavOverlay');
            overlayHandler(element);
        };
        window.flutterShowOverlay = legacyShow;
    }
    /**
     * Install legacy debug-API aliases that warn on first access.
     *
     * Properties:
     *   - `window.flutterFocusDebug`         → `window.spatialNavDebug`
     *   - `window.flutterFocusInstrumentation` → `window.spatialNavInstrumentation`
     *   - `window.flutterSpatNavPerf`        → `window.spatialNavPerf`
     */
    function installDebugDeprecations(state, api) {
        defineLegacyAlias('flutterFocusDebug', 'spatialNavDebug', api);
        defineLegacyAlias('flutterFocusInstrumentation', 'spatialNavInstrumentation', state.instrumentation);
        const legacyPerf = () => {
            warnOnce('flutterSpatNavPerf', 'spatialNavPerf');
            return state.perf || {};
        };
        window.flutterSpatNavPerf = legacyPerf;
    }

    /**
     * Debug utilities for Spatial Navigation.
     *
     * Exposes `window.spatialNavDebug` (programmatic move, preview toggle,
     * instrumentation snapshot). The legacy `flutterFocusDebug`,
     * `flutterFocusInstrumentation`, and `flutterSpatNavPerf` names are kept as
     * deprecated aliases via {@link installDebugDeprecations} in
     * {@link ./deprecation}; they will be removed in v4.
     */
    /**
     * Install the debug API on `window.spatialNavDebug` and wire the legacy
     * `flutterFocusDebug` / `flutterFocusInstrumentation` / `flutterSpatNavPerf`
     * aliases through the deprecation module.
     */
    function initDebugApi(state) {
        const api = {
            move: (directionName) => {
                const direction = directionByName[directionName];
                if (!direction)
                    return false;
                refreshFocusables(state);
                const moved = moveInDirection(direction, null, state);
                try {
                    document.title =
                        'focusDebugMove:' +
                            JSON.stringify({
                                direction: directionName,
                                moved: !!moved,
                                active: describeElement(getActiveElement()),
                                timestamp: Date.now(),
                            });
                }
                catch {
                    // Title serialization can fail on detached docs.
                }
                return moved;
            },
            setPreviewEnabled: (enabled) => {
                state.previewEnabled = enabled !== false;
                if (!state.previewEnabled) {
                    hidePreviewElements(state);
                    state.nextTargets = { up: null, down: null, left: null, right: null };
                }
                else {
                    const active = getActiveElement();
                    if (active) {
                        const dirMap = directionByName;
                        updatePreviewVisuals(active, null, findDirectionalCandidate, dirMap, describeElement, state);
                    }
                }
                try {
                    document.title =
                        'focusPreviewToggle:' +
                            JSON.stringify({ enabled: state.previewEnabled, timestamp: Date.now() });
                }
                catch {
                    // ignore
                }
                return state.previewEnabled;
            },
            previewTargets: (label) => {
                const summary = {};
                directionKeys.forEach((direction) => {
                    const entry = state.nextTargets && state.nextTargets[direction];
                    summary[direction] =
                        entry && entry.data && entry.data.element
                            ? describeElement(entry.data.element)
                            : '[blocked]';
                });
                try {
                    document.title =
                        'focusPreview:' +
                            JSON.stringify({ label: label || '', targets: summary, timestamp: Date.now() });
                }
                catch {
                    // ignore
                }
                return summary;
            },
            snapshot: (label) => {
                const inst = state.instrumentation;
                try {
                    document.title =
                        'focusInstrumentation:' +
                            JSON.stringify({
                                label: label || '',
                                lastOverlay: inst.lastOverlay || '',
                                lastActive: inst.lastActive || '',
                                mismatchCount: inst.mismatchCount || 0,
                                overlayIndex: typeof inst.overlayIndex === 'number' ? inst.overlayIndex : -1,
                                activeIndex: typeof inst.activeIndex === 'number' ? inst.activeIndex : -1,
                                focusableCount: state.focusableCount || 0,
                                lastDirection: inst.lastDirection || '',
                                timestamp: Date.now(),
                            });
                }
                catch {
                    // ignore
                }
                return inst;
            },
        };
        window.spatialNavDebug = api;
        window.spatialNavInstrumentation = state.instrumentation;
        window.spatialNavPerf = () => state.perf || {};
        // Legacy aliases — fire warning on first access.
        installDebugDeprecations(state, api);
    }

    /**
     * Abstract Messaging Adapter Interface
     *
     * Defines the contract for native messaging implementations.
     * Allows spatial navigation to work with different webview hosts:
     * - GeckoView (WebExtension API)
     * - react-native-webview (postMessage bridge)
     * - WKWebView (webkit.messageHandlers)
     * - Android WebView (JavascriptInterface)
     */
    const log$3 = createLogger('Messaging');
    /**
     * Base class with common functionality for messaging adapters.
     */
    class BaseMessagingAdapter {
        constructor() {
            this._state = 'disconnected';
            this.messageCallbacks = new Set();
            this.eventHandlers = {};
        }
        get state() {
            return this._state;
        }
        onMessage(callback) {
            this.messageCallbacks.add(callback);
            return () => {
                this.messageCallbacks.delete(callback);
            };
        }
        on(events) {
            this.eventHandlers = { ...this.eventHandlers, ...events };
        }
        /**
         * Dispatch a message to all registered callbacks.
         */
        dispatchMessage(message) {
            for (const callback of this.messageCallbacks) {
                try {
                    callback(message);
                }
                catch (error) {
                    log$3.error('callback error', error);
                }
            }
            this.eventHandlers.onMessage?.(message);
        }
        /**
         * Update connection state and emit events.
         */
        setState(newState) {
            const oldState = this._state;
            this._state = newState;
            if (oldState !== newState) {
                if (newState === 'connected') {
                    this.eventHandlers.onConnect?.();
                }
                else if (newState === 'disconnected' && oldState === 'connected') {
                    this.eventHandlers.onDisconnect?.();
                }
            }
        }
        /**
         * Emit an error event.
         */
        emitError(error) {
            this._state = 'error';
            this.eventHandlers.onError?.(error);
        }
    }

    /**
     * GeckoView Messaging Adapter
     *
     * Implements native messaging for the GeckoView WebExtension environment.
     * Uses `browser.runtime.connect()` for a persistent connection to the
     * background script, falling back to `browser.runtime.sendNativeMessage()`
     * for one-shot messages when no persistent channel is available.
     *
     * Reconnect strategy:
     *   - Each disconnect schedules a reconnect with exponential backoff
     *   - Backoff is capped at MAX_RECONNECT_DELAY_MS (30s) to prevent
     *     unbounded growth on a flapping native side
     *   - Outbound queue is bounded at MAX_QUEUE_SIZE so a long disconnect
     *     can't blow up memory
     *
     * @see https://firefox-source-docs.mozilla.org/mobile/android/geckoview/consumer/web-extensions.html
     */
    const log$2 = createLogger('Messaging');
    /**
     * Safe accessor for the WebExtension `browser` global. In standalone/test
     * environments the global may be entirely absent — `typeof` guards against
     * `ReferenceError` that would otherwise be thrown by direct access.
     */
    function getBrowser() {
        if (typeof browser !== 'undefined')
            return browser;
        return undefined;
    }
    /** Default native app identifier — override via constructor options. */
    const DEFAULT_NATIVE_APP_ID = 'flutter_geckoview';
    const PORT_NAME = 'spatial-nav-content';
    /** Cap reconnect backoff so a flapping native peer doesn't push delay to infinity. */
    const MAX_RECONNECT_DELAY_MS = 30000;
    /** Initial reconnect backoff (doubled on each failure, capped at MAX_RECONNECT_DELAY_MS). */
    const INITIAL_RECONNECT_DELAY_MS = 1000;
    /** Maximum reconnect attempts before giving up entirely. */
    const MAX_RECONNECT_ATTEMPTS = 6;
    /** Outbound queue size — drops oldest message past this. */
    const MAX_QUEUE_SIZE = 100;
    /**
     * GeckoView WebExtension messaging adapter.
     *
     * Connects to the background script which relays messages to the native app.
     */
    class GeckoViewMessagingAdapter extends BaseMessagingAdapter {
        constructor(options = {}) {
            super();
            this.id = 'geckoview';
            this.name = 'GeckoView WebExtension';
            this.port = null;
            this.messageQueue = [];
            this.reconnectAttempts = 0;
            this.reconnectTimer = null;
            this.nativeAppId = options.nativeAppId ?? DEFAULT_NATIVE_APP_ID;
        }
        isAvailable() {
            const b = getBrowser();
            return (b?.runtime !== undefined &&
                (typeof b.runtime.connect === 'function' || typeof b.runtime.sendNativeMessage === 'function'));
        }
        async connect() {
            if (!this.isAvailable()) {
                throw new Error('GeckoView WebExtension API not available');
            }
            this.setState('connecting');
            try {
                const b = getBrowser();
                if (b?.runtime?.connect) {
                    this.port = b.runtime.connect({ name: PORT_NAME });
                    this.port.onMessage.addListener((message) => {
                        this.handleMessage(message);
                    });
                    this.port.onDisconnect.addListener(() => {
                        this.handleDisconnect();
                    });
                    this.setState('connected');
                    this.reconnectAttempts = 0;
                    this.flushQueue();
                    log$2.debug('connected to background script');
                }
                else {
                    // No persistent connection — `sendNativeMessage` only.
                    this.setState('connected');
                    log$2.debug('using sendNativeMessage mode (no persistent connection)');
                }
            }
            catch (error) {
                this.emitError(error);
                throw error;
            }
        }
        disconnect() {
            if (this.reconnectTimer) {
                clearTimeout(this.reconnectTimer);
                this.reconnectTimer = null;
            }
            this.port = null;
            this.messageQueue = [];
            this.reconnectAttempts = 0;
            this.setState('disconnected');
            log$2.debug('disconnected');
        }
        send(message) {
            const fullMessage = {
                ...message,
                timestamp: message.timestamp ?? Date.now(),
            };
            // Try persistent connection first.
            if (this.port) {
                try {
                    this.port.postMessage(fullMessage);
                    return true;
                }
                catch (error) {
                    log$2.warn('port send failed, falling back', error);
                    this.port = null;
                }
            }
            // Fallback to sendNativeMessage.
            const b = getBrowser();
            if (b?.runtime?.sendNativeMessage) {
                try {
                    b.runtime.sendNativeMessage(this.nativeAppId, fullMessage);
                    return true;
                }
                catch {
                    this.queueMessage(fullMessage);
                    return false;
                }
            }
            // Not connected — queue.
            this.queueMessage(fullMessage);
            return false;
        }
        handleMessage(message) {
            log$2.debug('message received', message?.type);
            this.dispatchMessage(message);
        }
        handleDisconnect() {
            log$2.debug('port disconnected');
            this.port = null;
            this.setState('disconnected');
            if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
                log$2.warn(`max reconnect attempts (${MAX_RECONNECT_ATTEMPTS}) reached — giving up`);
                return;
            }
            this.reconnectAttempts++;
            // Exponential backoff capped at MAX_RECONNECT_DELAY_MS.
            const exponentialDelay = INITIAL_RECONNECT_DELAY_MS * Math.pow(2, this.reconnectAttempts - 1);
            const cappedDelay = Math.min(exponentialDelay, MAX_RECONNECT_DELAY_MS);
            log$2.debug(`reconnect attempt ${this.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS} in ${cappedDelay}ms`);
            this.reconnectTimer = setTimeout(() => {
                this.reconnectTimer = null;
                this.connect().catch((error) => {
                    log$2.warn('reconnect failed', error);
                });
            }, cappedDelay);
        }
        queueMessage(message) {
            this.messageQueue.push(message);
            if (this.messageQueue.length > MAX_QUEUE_SIZE) {
                const dropped = this.messageQueue.shift();
                log$2.debug('queue full, dropped oldest message', dropped?.type);
            }
        }
        flushQueue() {
            while (this.messageQueue.length > 0) {
                const message = this.messageQueue.shift();
                if (message) {
                    this.send(message);
                }
            }
        }
    }

    /**
     * No-op Messaging Adapter
     *
     * A silent adapter for environments without native messaging support.
     * All operations succeed silently without side effects.
     *
     * Use cases:
     * - Standalone web pages without native host
     * - Testing/development environments
     * - Graceful degradation when native messaging unavailable
     */
    const log$1 = createLogger('Messaging');
    /**
     * No-op messaging adapter that silently accepts all messages.
     */
    class NoopMessagingAdapter extends BaseMessagingAdapter {
        constructor(verbose = false) {
            super();
            this.id = 'noop';
            this.name = 'No-op (Standalone)';
            this._verbose = verbose;
        }
        isAvailable() {
            // Always available as a fallback
            return true;
        }
        async connect() {
            this.setState('connected');
            if (this._verbose) {
                log$1.info('noop adapter connected (no-op mode)');
            }
        }
        disconnect() {
            this.setState('disconnected');
            if (this._verbose) {
                log$1.info('noop adapter disconnected');
            }
        }
        send(message) {
            if (this._verbose) {
                log$1.debug('noop adapter message dropped', message.type);
            }
            return true;
        }
    }

    /**
     * GeckoView Spatial Navigation — content-script entry point.
     *
     * Orchestrates initialization of all spatial navigation modules. Loaded by the
     * WebExtension manifest as a content script (`run_at: document_end`).
     *
     * Init pipeline (see {@link initSpatialNavigation}):
     *   1. Load and validate user config
     *   2. Build global state
     *   3. Connect background-script port for native messaging
     *   4. Install overlay + accessibility announcer
     *   5. Discover focusables and attach observers
     *   6. Attach keyboard handlers
     *   7. Install WICG polyfill
     *   8. Wire blur/visibility/exit listeners
     *
     * @see https://drafts.csswg.org/css-nav-1/
     * @see https://firefox-source-docs.mozilla.org/mobile/android/geckoview/consumer/web-extensions.html
     */
    const log = createLogger('Main');
    const STYLE_ID = 'spatnav-focus-styles';
    const OVERLAY_HOST_ID = 'spatnav-focus-host';
    const VERSION = '3.0.0';
    // Debounce window for the pageshow re-init handler. Below this threshold we
    // treat consecutive events as the same logical navigation.
    const PAGESHOW_DEBOUNCE_MS = 100;
    let messagingAdapter = null;
    /**
     * Connect to native layer via a MessagingAdapter.
     *
     * The adapter owns connection lifecycle, reconnect backoff, and the port
     * abstraction. This function only wires response routing into the spatial
     * navigation state.
     */
    function connectMessaging(state) {
        if (messagingAdapter)
            return messagingAdapter;
        // Pick an adapter based on which WebExtension bridge (if any) is available.
        const adapter = typeof browser !== 'undefined' && browser?.runtime
            ? new GeckoViewMessagingAdapter({ nativeAppId: state.config.nativeAppId })
            : new NoopMessagingAdapter();
        messagingAdapter = adapter;
        adapter.onMessage((message) => handleNativeResponse(message, state));
        adapter.connect().catch((e) => {
            log.debug('native connection failed', e.message);
        });
        return adapter;
    }
    /**
     * Handle responses from native layer.
     */
    function handleNativeResponse(message, state) {
        if (!message || !message.type)
            return;
        switch (message.type) {
            case 'configUpdate': {
                const cfg = message.config;
                if (cfg) {
                    // Re-validate any runtime config push from native to keep the
                    // schema-validation guarantee end-to-end.
                    const validated = validateUserConfig(cfg);
                    Object.assign(state.config, validated);
                    log.info('Config updated from native', validated);
                }
                break;
            }
            case 'navigate': {
                const dir = message.direction;
                if (dir && directionByName[dir]) {
                    moveInDirection(directionByName[dir], null, state);
                }
                break;
            }
            case 'refresh':
                refreshFocusables(state);
                break;
            default:
                log.debug('Unknown message type', message.type);
        }
    }
    /**
     * Send a message to the native layer via the active messaging adapter.
     */
    function postToNative(message) {
        return messagingAdapter?.send(message) ?? false;
    }
    /**
     * Install WICG-compatible APIs on global objects.
     *
     * Idempotent: each method is feature-detected, so existing browser-native
     * implementations (or earlier polyfill installs) are not clobbered.
     */
    function installWICGPolyfill(state) {
        if ('navigate' in window) {
            return;
        }
        window.navigate = function (dir) {
            const direction = directionByName[dir];
            if (direction) {
                moveInDirection(direction, null, state);
            }
        };
        if (!Element.prototype.spatialNavigationSearch) {
            Element.prototype.spatialNavigationSearch = function (dir, _options = {}) {
                const direction = directionByName[dir];
                if (!direction)
                    return null;
                const el = this;
                const index = state.focusableElements.indexOf(el);
                if (index === -1)
                    return null;
                const candidate = findDirectionalCandidate(index, direction, state);
                if (!candidate) {
                    log.debug(`spatialNavigationSearch: no candidate for ${direction.name}`);
                }
                return candidate?.data.element ?? null;
            };
        }
        if (!Element.prototype.focusableAreas) {
            const selector = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';
            Element.prototype.focusableAreas = function (options = { mode: 'visible' }) {
                const all = Array.from(this.querySelectorAll(selector));
                if (options.mode === 'all')
                    return all;
                return all.filter((el) => {
                    const style = window.getComputedStyle(el);
                    if (style.visibility === 'hidden' || style.display === 'none')
                        return false;
                    const rect = el.getBoundingClientRect();
                    return rect.width > 0 && rect.height > 0;
                });
            };
        }
        if (!Element.prototype.getSpatialNavigationContainer) {
            Element.prototype.getSpatialNavigationContainer = function () {
                // Walk ancestors looking for an explicit focus group, a CSS-marked
                // navigation container, or a scroll container. Falls back to the
                // document root.
                // eslint-disable-next-line @typescript-eslint/no-this-alias
                let walker = this;
                while (walker && walker !== document.documentElement) {
                    if (walker.hasAttribute('data-focus-group'))
                        return walker;
                    const style = window.getComputedStyle(walker);
                    const overflow = (style.overflow + style.overflowX + style.overflowY).toLowerCase();
                    if (overflow.includes('auto') || overflow.includes('scroll'))
                        return walker;
                    walker = walker.parentElement;
                }
                return document.documentElement;
            };
        }
        log.debug('WICG polyfill installed');
    }
    /**
     * Re-attach DOM-tied resources after a same-document SPA navigation.
     *
     * Why we need this: when GeckoView swaps the document during pageshow, the
     * styles, overlay host, and observer instances are torn off the DOM, but the
     * window-level event listeners survive. This rebuilds the DOM-side state in
     * place rather than letting the page run with broken visuals.
     */
    function reinitializeAfterPageshow(state) {
        const config = state.config;
        const hasStyle = !!document.getElementById(STYLE_ID);
        const hasOverlayHost = !!document.getElementById(OVERLAY_HOST_ID);
        const overlayAttached = !!state.overlayHost && !!document.body && document.body.contains(state.overlayHost);
        log.debug('pageshow audit', {
            readyState: document.readyState,
            hasStyle,
            hasOverlayHost,
            overlayAttached,
            focusableCount: state.focusableCount,
        });
        const needsStyles = !hasStyle;
        const needsOverlay = !hasOverlayHost || !overlayAttached;
        if (!needsStyles && !needsOverlay) {
            log.debug('pageshow: DOM intact, no re-init needed');
            return;
        }
        log.debug('pageshow: re-initializing', { needsStyles, needsOverlay });
        if (needsOverlay) {
            state.overlayHost = null;
            state.overlay = null;
        }
        if (needsStyles) {
            ensureStyles();
        }
        if (needsOverlay) {
            ensureOverlay(config, state);
        }
        if (state.mutationObserver) {
            state.mutationObserver.disconnect();
            state.mutationObserver = null;
        }
        attachMutationObserver(state);
        if (state.virtualSentinelObserver) {
            state.virtualSentinelObserver.disconnect();
            state.virtualSentinelObserver = null;
        }
        attachVirtualScrollSentinels(state);
        refreshFocusables(state);
        showOverlay(null, state);
    }
    /**
     * Run the full initialization pipeline.
     *
     * Multiple init attempts can occur if GeckoView re-injects the content
     * script: each call gets fresh state and a new handler ID. Stale handlers from
     * prior injections short-circuit themselves via the DOM-level `data-spatnav-handler-id`
     * attribute (see {@link ./navigation/handlers.ts}). That event-level guard is
     * the dedup mechanism — we deliberately do **not** also gate at the init level,
     * because past attempts to do so left stale handlers attached after navigation.
     */
    function initSpatialNavigation() {
        // Bump the global init counter so the debug API can surface multi-injection issues.
        window.__SPATIAL_NAV_INIT_COUNT__ = (window.__SPATIAL_NAV_INIT_COUNT__ || 0) + 1;
        const initAttempt = window.__SPATIAL_NAV_INIT_COUNT__;
        log.debug(`init attempt #${initAttempt}`, {
            url: location.href.substring(0, 100),
            readyState: document.readyState,
            hasBody: !!document.body,
            isTop: window === window.top,
        });
        // Skip iframes — only the top-level frame should host navigation, otherwise
        // analytics/tracking iframes also load the extension and double-handle keys.
        if (window !== window.top) {
            log.debug('Skipping iframe', window.location.href.substring(0, 80));
            return;
        }
        // GeckoView fires multiple document states during navigation. Wait for a
        // real document with a body before initializing.
        if (location.href === 'about:blank') {
            log.debug('Skipping about:blank');
            return;
        }
        if (document.readyState === 'loading' && !document.body) {
            log.debug('Skipping loading document without body');
            return;
        }
        document.documentElement.setAttribute('data-spatnav-init', String(initAttempt));
        window.__SPATIAL_NAV_INIT_COMPLETE__ = true;
        // 1. Load + validate configuration
        const config = getConfig();
        // 2. Initialize global state
        const state = getState(config);
        state.version = VERSION;
        state.runtime = detectRuntimeContext();
        log.info(`runtime mode: ${formatRuntimeLabel(state.runtime)}`, state.runtime);
        log.info(`init v${state.version}`, location.href);
        // 3. Connect to background script for native messaging
        connectMessaging(state);
        // 4. Send native message to confirm initialization
        postToNative({
            type: 'spatialNavInit',
            version: state.version,
            url: location.href,
            timestamp: Date.now(),
        });
        // 5. Setup visual overlay
        ensureStyles();
        ensureOverlay(config, state);
        // 6. Setup accessibility announcer
        setupAccessibilityAnnouncer(state);
        // 7. Discover focusable elements
        refreshFocusables(state);
        // 8. Attach virtual scroll sentinels
        attachVirtualScrollSentinels(state);
        if (state.instrumentation) {
            const active = getActiveElement();
            state.instrumentation.lastActive = describeElement(active);
            state.instrumentation.activeIndex = state.currentIndex;
        }
        // 9. Attach event handlers.
        // Reset handlersAttached so a fresh handler ID supersedes any stale handler
        // from a prior injection (see comment on initSpatialNavigation).
        state.handlersAttached = false;
        attachHandlers(state);
        // 10. Attach mutation observer
        attachMutationObserver(state);
        // 11. Initialize debug API
        initDebugApi(state);
        // 12. Install WICG polyfill
        installWICGPolyfill(state);
        // 13. Expose public API
        window.spatialNavState = state;
        window.showSpatialNavOverlay = (element) => showOverlay(element, state);
        // 14. Install legacy aliases with deprecation warnings (removed in v4)
        installLegacyDeprecations(state, (element) => showOverlay(element, state));
        // 15. Don't auto-focus initial element — wait for user navigation from the
        //     host app. Auto-focusing causes a ghost overlay before the user
        //     enters web content.
        showOverlay(null, state);
        state.initialized = true;
        log.info('initialization complete');
        const suppressOverlay = (reason) => {
            state.overlaySuppressed = true;
            if (state.updateTimer) {
                cancelAnimationFrame(state.updateTimer);
                state.updateTimer = null;
            }
            hideOverlay(state);
            hidePreviewElements(state);
            log.debug(`overlay suppressed (${reason})`);
        };
        // 16. Hide overlay when focus leaves the document (e.g., returning to address bar)
        window.addEventListener('blur', () => suppressOverlay('window.blur'));
        document.addEventListener('visibilitychange', () => {
            if (document.hidden)
                suppressOverlay('document.hidden');
        });
        // Hide overlay when spatial navigation exits to native UI
        document.addEventListener('spatialNavigationExit', () => suppressOverlay('spatialNavigationExit'));
        // 17. Re-initialize on page navigation
        let lastPageshowTime = 0;
        window.addEventListener('pageshow', () => {
            const now = Date.now();
            if (now - lastPageshowTime < PAGESHOW_DEBOUNCE_MS) {
                log.debug('pageshow debounced');
                return;
            }
            lastPageshowTime = now;
            reinitializeAfterPageshow(state);
        });
    }
    initSpatialNavigation();

})();
//# sourceMappingURL=spatial_navigation.debug.js.map
