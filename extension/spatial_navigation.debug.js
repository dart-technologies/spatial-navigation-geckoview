var SpatialNavigation = (function (exports) {
    'use strict';

    /**
     * Tree-shakeable Logging System for Spatial Navigation
     *
     * Provides structured logging with:
     * - Build-time DEBUG constant for tree-shaking (replaced by Rollup)
     * - Debug-bundle-only runtime opt-in via window.SPATIAL_NAV_DEBUG /
     *   flutterSpatialNavDebug (gated on DEBUG so a malicious page can't
     *   re-enable verbose logs in a production build)
     * - Namespaced loggers for subsystems
     * - Performance timing utilities
     *
     * Usage:
     *   import { createLogger, DEBUG } from './logger';
     *   const log = createLogger('Movement');
     *   log.debug('Moving focus', { direction: 'down' });
     *
     * Build-time: Rollup replaces `"development"` with "production" or "development".
     * Production bundles tree-shake debug calls and the runtime opt-in; only
     * the debug bundle honours window.SPATIAL_NAV_DEBUG.
     */
    /**
     * Build-time debug flag.
     *
     * Replaced by Rollup's @rollup/plugin-replace at build time. The substitution
     * targets the LITERAL `"development"` token; aliasing the access (e.g.
     * `const env = process.env; env?.NODE_ENV`) defeats the replacement and lets
     * the IIFE run unchanged in browsers — where `typeof process === 'undefined'`
     * is **false** under Webpack-style globals but **true** under content-script
     * isolation, so the original aliased form unintentionally returned `true`
     * (debug enabled) in production extension bundles. The direct comparison
     * below is folded to a literal `false` by Terser in production builds and to
     * `true` in development builds.
     *
     * In production builds this is `false`, allowing Terser to eliminate
     * debug-only code via dead-code elimination.
     */
    const LOG_LEVEL_ORDER = {
        debug: 0,
        info: 1,
        warn: 2,
        error: 3,
        silent: 4,
    };
    let currentLevel = 'debug' ;
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
                timers.set(label, performance.now());
            },
            timeEnd(label) {
                const start = timers.get(label);
                if (start !== undefined) {
                    const duration = performance.now() - start;
                    timers.delete(label);
                    this.debug(`${label}: ${duration.toFixed(2)}ms`);
                }
            },
            group(label) {
                if (!shouldLog('debug'))
                    return;
                console.group(formatMessage(namespace, label));
            },
            groupEnd() {
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
    const log$g = createLogger('Config');
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
     * Clamp a validated-finite numeric config value into an allowed range,
     * falling back to the default when the user didn't supply one.
     *
     * Used to bound visual-layer values so a malicious page setting e.g.
     * `overlayZIndex: -1` (hides overlay behind page content) or
     * `arrowScale: 1e6` (paint-thread DoS via gigantic borders) cannot
     * produce pathological output.
     */
    function clampNumber(value, min, max, fallback) {
        if (typeof value !== 'number' || !Number.isFinite(value))
            return fallback;
        return Math.min(Math.max(value, min), max);
    }
    /**
     * Get the current spatial navigation configuration.
     * Merges user-provided config with defaults.
     */
    function getConfig() {
        const rawUserConfig = globalScope.spatialNavConfig || globalScope.flutterSpatialNavConfig || {};
        const userConfig = validateUserConfig(rawUserConfig);
        return {
            // Visual styling — numeric values are clamped so malicious config
            // can't produce invisible overlays (negative z-index), paint-thread
            // DoS (huge blur/arrow scale), or off-screen overlays (huge margin).
            color: userConfig.color || DEFAULT_FOCUS_COLOR,
            outlineWidth: clampNumber(userConfig.outlineWidth, 1, 20, 3),
            outlineOffset: clampNumber(userConfig.outlineOffset, 0, 50, 3),
            overlayZIndex: clampNumber(userConfig.overlayZIndex, 1, 2147483646, 2147483646),
            arrowScale: clampNumber(userConfig.arrowScale, 0.1, 4, 1.0),
            disabledColor: userConfig.disabledColor || '128, 128, 128',
            overlayTheme: userConfig.overlayTheme === 'high-contrast' ? 'high-contrast' : 'default',
            safeAreaMargin: clampNumber(userConfig.safeAreaMargin, 0, 200, 12),
            overlayScrimOpacity: clampNumber(userConfig.overlayScrimOpacity, 0, 1, 0.06),
            overlayGlowOpacity: clampNumber(userConfig.overlayGlowOpacity, 0, 1, 0.35),
            overlayGlowBlur: clampNumber(userConfig.overlayGlowBlur, 0, 64, 14),
            overlayInnerGlowOpacity: clampNumber(userConfig.overlayInnerGlowOpacity, 0, 1, 0.16),
            visibilityMode: userConfig.visibilityMode === 'hardware-nav-only' ? 'hardware-nav-only' : 'always',
            enableFocusPulse: userConfig.enableFocusPulse === true,
            // Default to `'scroll'` so a directional press at a viewport
            // boundary on a long page scrolls into view instead of silently
            // dropping the keystroke. Hosts that want the legacy
            // exit-to-native behaviour can set `'exit'`.
            boundaryScrollBehavior: userConfig.boundaryScrollBehavior === 'exit'
                ? 'exit'
                : userConfig.boundaryScrollBehavior === 'none'
                    ? 'none'
                    : 'scroll',
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
        };
    }
    // =============================================================================
    // Validation
    // =============================================================================
    const STRING_KEYS = new Set(['color', 'disabledColor', 'intersectionRootMargin']);
    const NUMBER_KEYS = new Set([
        'outlineWidth',
        'outlineOffset',
        'overlayZIndex',
        'arrowScale',
        'safeAreaMargin',
        'overlayScrimOpacity',
        'overlayGlowOpacity',
        'overlayGlowBlur',
        'overlayInnerGlowOpacity',
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
        'enableFocusPulse',
    ]);
    // Null-prototype lookup so attacker keys like `toString` / `hasOwnProperty`
    // don't resolve to Object.prototype methods via the prototype chain — that
    // would make `ENUM_KEYS[key].has(value)` throw TypeError, propagate uncaught
    // out of getConfig(), and abort initSpatialNavigation entirely.
    const ENUM_KEYS = Object.assign(Object.create(null), {
        overlayTheme: new Set(['default', 'high-contrast']),
        refocusStrategy: new Set(['closest', 'first']),
        scoringMode: new Set(['geometric', 'grid']),
        distanceFunction: new Set(['euclidean', 'manhattan', 'projected']),
        visibilityMode: new Set(['always', 'hardware-nav-only']),
        boundaryScrollBehavior: new Set(['exit', 'scroll', 'none']),
    });
    const ARRAY_KEYS = new Set(['virtualContainerSelectors']);
    const OBJECT_KEYS = new Set(['iframeSupport', 'focusGroups']);
    /**
     * Per-array caps applied during validation.
     *
     * A page setting virtualContainerSelectors to, say, 10,000 complex
     * selectors would make every DOM mutation trigger a re-scan under each
     * selector — a CPU DoS vector. Caps chosen generously enough to cover
     * every legitimate use (the default list is 8 selectors).
     */
    const ARRAY_MAX_ITEMS = 32;
    const ARRAY_ITEM_MAX_LENGTH = 256;
    /**
     * Per-key numeric ranges enforced at validation time.
     *
     * The clamps live here (not just in getConfig) so every entry point —
     * getConfig(), updateConfig(), and the native `configUpdate` handler —
     * gets uniform schema enforcement. Otherwise a native push of e.g.
     * `{ safeAreaMargin: 99999 }` would slip through `validateUserConfig`'s
     * type-only check and land in `state.config` unclamped.
     */
    const NUMBER_RANGES = Object.assign(Object.create(null), {
        // Visual styling
        outlineWidth: { min: 1, max: 20 },
        outlineOffset: { min: 0, max: 50 },
        overlayZIndex: { min: 1, max: 2147483646 },
        arrowScale: { min: 0.1, max: 4 },
        safeAreaMargin: { min: 0, max: 200 },
        overlayScrimOpacity: { min: 0, max: 1 },
        overlayGlowOpacity: { min: 0, max: 1 },
        overlayGlowBlur: { min: 0, max: 64 },
        overlayInnerGlowOpacity: { min: 0, max: 1 },
        // Observers and timers (DoS guard — caps at 5s except cache timeout at 1min)
        mutationDebounce: { min: 0, max: 5000 },
        scrollThreshold: { min: 0, max: 1000 },
        virtualScrollDebounce: { min: 0, max: 5000 },
        precomputeCacheTimeout: { min: 0, max: 60000 },
        intersectionThreshold: { min: 0, max: 1 },
        // Scoring thresholds (geometric — capped at 4096px which is well above
        // any plausible viewport edge)
        overlapThreshold: { min: 0, max: 4096 },
        gridAlignmentTolerance: { min: 0, max: 4096 },
        minElementSize: { min: 0, max: 4096 },
    });
    /**
     * Per-key schemas for nested-object config values. Each validator strips
     * unknown fields and clamps each known field to its declared type/enum.
     *
     * Without this, a page could ship e.g.
     * `{ iframeSupport: { __proto__: { polluted: true } } }` and the un-checked
     * object would land verbatim in `state.config`. The shallow object-shape
     * check in OBJECT_KEYS handling is not enough.
     */
    const NESTED_VALIDATORS = Object.assign(Object.create(null), {
        iframeSupport: (raw) => {
            const allowedFocusMethods = new Set(['element', 'contentWindow']);
            const cleaned = {};
            if (typeof raw.enabled === 'boolean')
                cleaned.enabled = raw.enabled;
            if (typeof raw.selector === 'string' && raw.selector.length <= ARRAY_ITEM_MAX_LENGTH) {
                cleaned.selector = raw.selector;
            }
            if (typeof raw.focusMethod === 'string' && allowedFocusMethods.has(raw.focusMethod)) {
                cleaned.focusMethod = raw.focusMethod;
            }
            return cleaned;
        },
        focusGroups: (raw) => {
            const allowedBoundary = new Set(['wrap', 'stop', 'exit']);
            const cleaned = {};
            if (typeof raw.enabled === 'boolean')
                cleaned.enabled = raw.enabled;
            if (typeof raw.boundaryBehavior === 'string' && allowedBoundary.has(raw.boundaryBehavior)) {
                cleaned.boundaryBehavior = raw.boundaryBehavior;
            }
            // defaultRules is a freeform map; pass through only if it's a
            // plain object (no Array, no null), without touching keys.
            if (raw.defaultRules &&
                typeof raw.defaultRules === 'object' &&
                !Array.isArray(raw.defaultRules)) {
                cleaned.defaultRules = raw.defaultRules;
            }
            return cleaned;
        },
    });
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
                    log$g.warn(`config.${key}: expected string, got ${typeof value} — ignored`);
                }
                continue;
            }
            if (NUMBER_KEYS.has(key)) {
                if (typeof value === 'number' && Number.isFinite(value)) {
                    const range = NUMBER_RANGES[key];
                    out[key] = range
                        ? Math.min(Math.max(value, range.min), range.max)
                        : value;
                }
                else {
                    log$g.warn(`config.${key}: expected finite number, got ${typeof value} — ignored`);
                }
                continue;
            }
            if (BOOLEAN_KEYS.has(key)) {
                if (typeof value === 'boolean') {
                    out[key] = value;
                }
                else {
                    log$g.warn(`config.${key}: expected boolean, got ${typeof value} — ignored`);
                }
                continue;
            }
            if (key in ENUM_KEYS) {
                if (typeof value === 'string' && ENUM_KEYS[key].has(value)) {
                    out[key] = value;
                }
                else {
                    const allowed = Array.from(ENUM_KEYS[key]).join(', ');
                    log$g.warn(`config.${key}: must be one of [${allowed}] — got ${JSON.stringify(value)}, ignored`);
                }
                continue;
            }
            if (ARRAY_KEYS.has(key)) {
                if (Array.isArray(value) && value.every((v) => typeof v === 'string')) {
                    // Cap the array to prevent a malicious page from shipping a
                    // thousand CSS selectors that get re-run on every mutation;
                    // and cap each selector length to prevent catastrophic regex
                    // / complex-selector perf attacks via querySelectorAll.
                    const capped = value
                        .slice(0, ARRAY_MAX_ITEMS)
                        .filter((s) => s.length <= ARRAY_ITEM_MAX_LENGTH);
                    if (capped.length !== value.length) {
                        log$g.warn(`config.${key}: truncated from ${value.length} to ${capped.length} items (caps: ${ARRAY_MAX_ITEMS} items, ${ARRAY_ITEM_MAX_LENGTH} chars each)`);
                    }
                    out[key] = capped;
                }
                else {
                    log$g.warn(`config.${key}: expected string[], got ${typeof value} — ignored`);
                }
                continue;
            }
            if (OBJECT_KEYS.has(key)) {
                if (value && typeof value === 'object' && !Array.isArray(value)) {
                    const validator = NESTED_VALIDATORS[key];
                    out[key] = validator
                        ? validator(value)
                        : value;
                }
                else {
                    log$g.warn(`config.${key}: expected object, got ${typeof value} — ignored`);
                }
                continue;
            }
            log$g.warn(`config.${key}: unknown key — ignored`);
        }
        return out;
    }
    // =============================================================================
    // Direction maps
    // =============================================================================
    // Null-prototype + frozen lookup tables. A null prototype means that a
    // page- or native-host-supplied key like `__proto__` or `constructor`
    // yields `undefined` rather than walking up to `Object.prototype` — the
    // caller's `if (map[dir])` guard then correctly short-circuits instead of
    // silently passing a function object into downstream handlers.
    const directionByKey = Object.freeze(Object.assign(Object.create(null), {
        ArrowDown: { axis: 'y', sign: 1, name: 'down' },
        ArrowUp: { axis: 'y', sign: -1, name: 'up' },
        ArrowRight: { axis: 'x', sign: 1, name: 'right' },
        ArrowLeft: { axis: 'x', sign: -1, name: 'left' },
    }));
    const directionByName = Object.freeze(Object.assign(Object.create(null), {
        down: directionByKey.ArrowDown,
        up: directionByKey.ArrowUp,
        right: directionByKey.ArrowRight,
        left: directionByKey.ArrowLeft,
    }));
    const directionKeys = ['down', 'up', 'right', 'left'];

    /**
     * Global state management for GeckoView Spatial Navigation System
     *
     * Maintains focus state across same-document SPA navigations via a
     * module-scoped cache. We also publish the state on `window.spatialNavState`
     * so consumer scripts (debuggers, tests, the legacy Flutter alias) can read
     * it, but — critically — we never read the window copy back. A malicious
     * page could otherwise pre-populate `window.spatialNavState` with a crafted
     * shape and hijack the overlay target, focusables list, or current index.
     */
    /**
     * Module-scoped state cache. Authoritative source of truth for state
     * re-entry — we deliberately do NOT read `window.spatialNavState` to
     * prevent a malicious page from pre-populating a trust-boundary-crossing
     * global and hijacking the overlay target / focusables.
     */
    let cachedState = null;
    /**
     * Initialize or retrieve the global spatial navigation state.
     * State persists across same-document SPA navigations via the module cache.
     */
    function getState(config) {
        const state = cachedState ?? {};
        cachedState = state;
        // Publish to window for consumer access (debug tools, legacy alias).
        // This is write-only from our perspective — we never read it back.
        window.spatialNavState = state;
        window.flutterFocusState = state;
        // Core navigation state
        state.config = config;
        state.version = '3.2.0';
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
        // Null-prototype map: focus-group ids come from the page's `data-focus-group`
        // attribute (attacker-controlled). A plain `{}` would resolve keys like
        // `__proto__`/`constructor` to inherited members, and the truthy result
        // would skip group creation and then throw on `group.addMember`, aborting
        // every keypress. A prototype-less map makes such keys resolve to undefined.
        state.focusGroups = state.focusGroups || Object.create(null);
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
        state.suppressRecoveryTimer = state.suppressRecoveryTimer ?? null;
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
        // Default modality at boot: touch. The pointer watcher in `main.ts` and
        // the keydown handler in `handlers.ts` flip this on real input.
        state.lastReportedModality = state.lastReportedModality || 'touch';
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
     * Calculate the visual bounding rect for an element, balancing two
     * heuristics:
     *
     *  1. **Shrink-to-fit** — when the focused element is a link/card whose
     *     dominant visible content is a single media child (img / picture /
     *     svg / video / canvas), use the child's rect. Outlines what the
     *     user perceives as "the focused thing" instead of the larger
     *     wrapper card. The "single media child" + "no significant text
     *     siblings" gates prevent shrinking icon-plus-label links to their
     *     icon.
     *
     *  2. **Expand-to-fit** — when the focused element has an image-like
     *     child that overflows the hit area (logos, image-buttons), use
     *     the larger child rect so the visual outline matches the visual
     *     asset, not the smaller tap target.
     *
     * Shrink is tried first; if no qualifying single visible media child
     * exists, the expand path falls through. Both paths preserve the
     * original behaviour for elements whose own rect already matches their
     * visible content (the common case — buttons, inputs, plain links).
     */
    function calculateVisualRect(element) {
        const rect = safeGetBoundingClientRect(element);
        // Helper: clip the visual rect to any clipping container between
        // the media child and the focused element (inclusive at both
        // ends). Squarespace`s `a.summary-thumbnail-container` pattern
        // wraps an over-tall `<img>` in an `<div.img-wrapper>` with
        // `overflow: hidden`, all inside the `<a>` (which itself has
        // `overflow: visible`). The visible image is the intersection of
        // the img rect and the img-wrapper rect — NOT the full img rect.
        // Without this clamp the focus ring extends into empty space
        // above/below the visible thumbnail.
        //
        // `mediaChild` is optional: when called from the shrink-to-fit
        // path we already know which child the ring will track; from
        // expand-to-fit we re-discover it. Walking from the child up to
        // (and including) the focused element catches the canonical
        // pattern (inner clipping wrapper) AND the simpler "wrapper itself
        // has overflow: hidden" case in one path.
        const view = element.ownerDocument?.defaultView ?? window;
        const isClipped = (cs) => {
            const isClip = (v) => !!v && v !== 'visible';
            // Happy-dom (test env) doesn`t reliably resolve shorthand
            // `overflow` → longhand `overflow-x` / `overflow-y`. Production
            // browsers populate the longhands so we check both for stable
            // behaviour across environments.
            return isClip(cs.overflowX) || isClip(cs.overflowY) || isClip(cs.overflow);
        };
        const clipToVisibleArea = (visual, mediaChild) => {
            // Walk from the media child up to the focused element (inclusive),
            // intersecting with every element that clips its overflow.
            let left = visual.left;
            let top = visual.top;
            let right = visual.right;
            let bottom = visual.bottom;
            let cursor = mediaChild ?? element;
            let safety = 0;
            while (cursor && safety < 16) {
                try {
                    const cs = view.getComputedStyle(cursor);
                    if (isClipped(cs)) {
                        const cursorRect = safeGetBoundingClientRect(cursor);
                        left = Math.max(left, cursorRect.left);
                        top = Math.max(top, cursorRect.top);
                        right = Math.min(right, cursorRect.right);
                        bottom = Math.min(bottom, cursorRect.bottom);
                    }
                }
                catch {
                    // No window / non-browser env — stop walking.
                    break;
                }
                if (cursor === element)
                    break;
                cursor = cursor.parentElement;
                safety++;
            }
            const width = Math.max(0, right - left);
            const height = Math.max(0, bottom - top);
            if (width <= 0 || height <= 0)
                return rect;
            // If no clip changed anything, return the original rect (no
            // floating-point drift from constructing a new DOMRect).
            if (left === visual.left &&
                top === visual.top &&
                right === visual.right &&
                bottom === visual.bottom) {
                return visual;
            }
            return new DOMRect(left, top, width, height);
        };
        // 1) Button-parent expand (runs BEFORE shrink-to-fit). When the
        //    immediate parent is a visually-distinct round/pill container
        //    (non-trivial border-radius + non-transparent background or
        //    visible border) that extends beyond the focused element, treat
        //    the parent as the "visible button" and expand the ring to its
        //    bounds. Pages sometimes wrap a small focusable in a larger
        //    styled container — Squarespace`s "back-to-top" button is the
        //    canonical case: a `<div.back-to-top-link>` styled as a 50×50
        //    white circle (`border-radius: 50%`) with an `<a>` inside
        //    whose box is 50×36 (just the text bounds).
        //
        //    Runs first because if it fires, the visible button bound is
        //    authoritative — shrink-to-fit would otherwise shrink to an
        //    icon inside the button and miss the visible chrome.
        try {
            const parent = element.parentElement;
            if (parent && parent !== element.ownerDocument?.body) {
                const parentRect = safeGetBoundingClientRect(parent);
                const epsExtend = 2;
                const parentExtends = parentRect.left < rect.left - epsExtend ||
                    parentRect.top < rect.top - epsExtend ||
                    parentRect.right > rect.right + epsExtend ||
                    parentRect.bottom > rect.bottom + epsExtend;
                if (parentExtends) {
                    const pcs = view.getComputedStyle(parent);
                    const smallerDim = Math.min(parentRect.width, parentRect.height);
                    const radiusStr = pcs.borderRadius || '0';
                    let isRound = false;
                    if (radiusStr.includes('%')) {
                        isRound = !/^0(\.0+)?%/.test(radiusStr);
                    }
                    else {
                        const radiusPx = parseFloat(radiusStr);
                        if (!Number.isNaN(radiusPx) && smallerDim > 0) {
                            isRound = radiusPx >= smallerDim * 0.25;
                        }
                    }
                    const bg = pcs.backgroundColor || '';
                    const hasOpaqueBg = bg.length > 0 &&
                        bg !== 'transparent' &&
                        !/rgba?\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*,\s*0(\.0+)?\s*\)/.test(bg);
                    const borderWidthPx = parseFloat(pcs.borderTopWidth || '0');
                    const hasVisibleBorder = borderWidthPx > 0;
                    const reasonablyButtonSized = parentRect.width <= 320 && parentRect.height <= 320;
                    if (isRound && (hasOpaqueBg || hasVisibleBorder) && reasonablyButtonSized) {
                        return clipToVisibleArea(parentRect, parent);
                    }
                }
            }
        }
        catch {
            // No window / non-browser env — fall through to next strategy.
        }
        // 2) Shrink-to-fit when the focused element is a link/card wrapping
        //    a single media element. Restrict to descendants (not strict
        //    children) because pages routinely wrap `<img>` in an extra
        //    `<span>` or `<picture>` inside the link.
        const mediaSelector = 'img, picture, svg, video, canvas';
        const mediaCandidates = element.querySelectorAll(mediaSelector);
        if (mediaCandidates.length > 0) {
            const visibleMedia = [];
            // Bound the per-child getComputedStyle/rect work: only the
            // single-dominant-media case shrinks the ring, so a pathological element
            // with a huge media subtree can't make this scan expensive. Cap the scan,
            // and stop as soon as a second visible media element is found.
            const MAX_MEDIA_CANDIDATES = 1000;
            const limit = Math.min(mediaCandidates.length, MAX_MEDIA_CANDIDATES);
            for (let i = 0; i < limit; i++) {
                const child = mediaCandidates[i];
                // Skip explicitly-hidden children.
                if (child.getAttribute('aria-hidden') === 'true')
                    continue;
                const childRect = safeGetBoundingClientRect(child);
                if (childRect.width <= 0 || childRect.height <= 0)
                    continue;
                // Skip children whose computed display/visibility hides them.
                // (Robolectric/jsdom test envs always return 'block', so this
                // is a no-op there but matters in production.)
                try {
                    const cs = (element.ownerDocument?.defaultView ?? window).getComputedStyle(child);
                    if (cs.display === 'none' || cs.visibility === 'hidden')
                        continue;
                }
                catch {
                    // No window / non-browser env — accept the child.
                }
                visibleMedia.push(child);
                if (visibleMedia.length > 1)
                    break;
            }
            if (visibleMedia.length === 1) {
                const childRect = safeGetBoundingClientRect(visibleMedia[0]);
                const wrapperArea = Math.max(1, rect.width * rect.height);
                const childArea = childRect.width * childRect.height;
                // Only shrink when the media child dominates the wrapper
                // (≥50% of its area). Keeps icon-plus-label links from
                // shrinking to the icon.
                const dominates = childArea / wrapperArea >= 0.5;
                // Don't shrink if there's significant non-media visible text
                // alongside the image (caption-under-photo cards, etc.).
                const text = element.textContent?.trim() ?? '';
                const hasSignificantText = text.length > 0;
                if (dominates && !hasSignificantText) {
                    return clipToVisibleArea(childRect, visibleMedia[0]);
                }
            }
        }
        // 2) Expand-to-fit: for elements like logos / image-buttons whose
        //    hit area is smaller than the visual asset, expand outward.
        //    Preserves the original v3.0.1 behaviour for `overflow: visible`
        //    wrappers. When the wrapper clips its overflow (Squarespace
        //    cards etc.), `clipToWrapperIfNeeded` intersects the expanded
        //    rect with the wrapper`s box so the ring doesn`t extend into
        //    empty space outside the visible thumbnail.
        const visualChild = element.querySelector(mediaSelector);
        if (visualChild) {
            const childRect = safeGetBoundingClientRect(visualChild);
            if (childRect.width > rect.width ||
                childRect.height > rect.height ||
                childRect.left < rect.left ||
                childRect.top < rect.top) {
                return clipToVisibleArea(childRect, visualChild);
            }
        }
        // 4) Scroll-overflow expand: when the element`s rendered content
        //    is taller / wider than its box AND the element renders that
        //    overflow (`overflow: visible`), grow the ring to cover the
        //    overflowing pixels. Squarespace`s "TOP" button is the
        //    canonical case (`<a>` with `display: block`, `line-height:
        //    12px` + `padding-top: 4px` for a 12 px font — the descender
        //    of "P" pushes 2 px past the box).
        //
        //    Skipped for inline (and inline-table/contents) elements:
        //    `scrollWidth`/`scrollHeight` are not well-defined on inline
        //    boxes and tend to report the nearest block ancestor`s
        //    scrollable area, which is unrelated to the element`s own
        //    visible bounds. Without this gate, the ring on an inline
        //    `<a>` like Squarespace footer`s "Privacy" link expands to
        //    ~2× width × 2× height because the parent `<p>` reports
        //    scrollWidth/Height inherited from the block context.
        try {
            const cs = view.getComputedStyle(element);
            const display = cs.display || '';
            const overflowMakesSense = display !== 'inline' && display !== 'inline-table' && display !== 'contents';
            const overflowsBox = overflowMakesSense &&
                ((element.scrollWidth > 0 && element.scrollWidth > element.clientWidth) ||
                    (element.scrollHeight > 0 && element.scrollHeight > element.clientHeight));
            // Only meaningful when the element actually renders its overflow.
            // (`scrollHeight > clientHeight` on `overflow: hidden` means the
            // overflow is clipped and not visible — leave the ring at the box.)
            const showsOverflow = !isClipped(cs);
            if (overflowsBox && showsOverflow) {
                // Build an expanded rect that absorbs the overflow. Overflow
                // direction is determined by writing mode — but for the LTR
                // top-to-bottom case (the only one we`ve seen in the wild),
                // overflow grows down and right from the box`s top-left.
                const dx = Math.max(0, element.scrollWidth - element.clientWidth);
                const dy = Math.max(0, element.scrollHeight - element.clientHeight);
                const expanded = new DOMRect(rect.left, rect.top, rect.width + dx, rect.height + dy);
                return clipToVisibleArea(expanded, element);
            }
        }
        catch {
            // No window / non-browser env — fall back to plain box rect.
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
    const log$f = createLogger('Overlay');
    /**
     * Returns true when build-time DEBUG is on or runtime opt-in is set.
     *
     * The runtime check is gated on the build-time `DEBUG` constant so that
     * production bundles cannot be flipped into debug mode by a malicious
     * page setting `window.SPATIAL_NAV_DEBUG = true`. Debug mode exposes
     * runtime labels, a HUD, and focus element descriptions — not sensitive
     * in isolation, but a page under attack should not be able to enumerate
     * overlay state regardless.
     */
    function isDebugActive() {
        return true;
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
            log$f.error('failed to get overlay reference from shadow DOM');
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
        /* c8 ignore next */ // dead under tsx (isDebugActive() returns true); production bundles fold this to a literal early return
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
        /* c8 ignore next */ // dead under tsx (isDebugActive() returns true); production bundles fold this to a literal early return
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
        /* c8 ignore next */ // dead under tsx (isDebugActive() returns true); production bundles fold this to a literal early return
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
     * Clamp a parsed integer channel to [0, 255]. NaN becomes the fallback.
     *
     * Centralizing this guarantees every RGB component we interpolate into CSS
     * is a structurally-inert integer — template concatenation cannot escape
     * the declaration because the only characters emitted are digits.
     */
    function clampByte(n, fallback) {
        if (!Number.isFinite(n))
            return fallback;
        return Math.max(0, Math.min(255, Math.round(n)));
    }
    /**
     * Parse a color string to RGB. Accepts:
     *   - `#rgb` / `#rrggbb` hex
     *   - `rgb(r, g, b)` / `rgba(r, g, b, a)`
     *   - `"r, g, b"` comma-separated triple (the format used for `disabledColor`)
     *
     * The return value is three validated integers, so callers interpolating
     * `${rgb.r}` into a CSS template cannot leak attacker-controlled characters.
     */
    function parseColor(color, fallback = { r: 21, g: 101, b: 192 }) {
        if (!color || typeof color !== 'string') {
            return fallback;
        }
        if (color.startsWith('#')) {
            const hex = color.slice(1);
            if (hex.length === 3) {
                return {
                    r: clampByte(parseInt(hex[0] + hex[0], 16), fallback.r),
                    g: clampByte(parseInt(hex[1] + hex[1], 16), fallback.g),
                    b: clampByte(parseInt(hex[2] + hex[2], 16), fallback.b),
                };
            }
            else if (hex.length === 6) {
                return {
                    r: clampByte(parseInt(hex.slice(0, 2), 16), fallback.r),
                    g: clampByte(parseInt(hex.slice(2, 4), 16), fallback.g),
                    b: clampByte(parseInt(hex.slice(4, 6), 16), fallback.b),
                };
            }
            return fallback;
        }
        const rgbMatch = color.match(/^\s*rgba?\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
        if (rgbMatch) {
            return {
                r: clampByte(parseInt(rgbMatch[1], 10), fallback.r),
                g: clampByte(parseInt(rgbMatch[2], 10), fallback.g),
                b: clampByte(parseInt(rgbMatch[3], 10), fallback.b),
            };
        }
        // "r, g, b" comma-separated triple — the historical `disabledColor` format.
        const tripleMatch = color.match(/^\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*$/);
        if (tripleMatch) {
            return {
                r: clampByte(parseInt(tripleMatch[1], 10), fallback.r),
                g: clampByte(parseInt(tripleMatch[2], 10), fallback.g),
                b: clampByte(parseInt(tripleMatch[3], 10), fallback.b),
            };
        }
        return fallback;
    }
    /**
     * Generate Shadow DOM CSS for overlay and previews.
     *
     * @internal — exported for tests only. The adversarial test in
     * `__tests__/overlay-css.test.ts` exercises the CSS-injection guard on
     * `disabledColor` and friends.
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
        // Parse `disabledColor` through the same validator as `color` so attacker-
        // controlled CSS cannot break out of the `:host` declaration. The parser
        // returns three integers; concatenating them is structurally safe.
        const disabledRGB = parseColor(config.disabledColor, { r: 128, g: 128, b: 128 });
        const disabledColor = `${disabledRGB.r}, ${disabledRGB.g}, ${disabledRGB.b}`;
        return [
            ':host {',
            `  --sn-focus-rgb: ${colorBase};`,
            `  --sn-disabled-rgb: ${disabledColor};`,
            `  --arrow-width: ${arrowWidth}px;`,
            `  --arrow-length: ${arrowLength}px;`,
            `  --sn-scrim-alpha: ${config.overlayScrimOpacity};`,
            `  --sn-glow-alpha: ${config.overlayGlowOpacity};`,
            `  --sn-glow-blur: ${config.overlayGlowBlur}px;`,
            `  --sn-inner-glow-alpha: ${config.overlayInnerGlowOpacity};`,
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
            // Position properties (left/top/width/height/border-radius) are
            // NOT transitioned: every position write happens during either
            // a navigation move (jumps to a new focusable) or scroll-
            // tracking (page smooth-scrolls, ring must follow 1:1). In
            // both cases the apparent motion is dominated by the page or
            // the focus jump, NOT by an easing curve — adding a 140ms
            // position transition produced a visible "ring slides off and
            // returns to settle" lag against the actual element motion.
            // Opacity + transform stay transitioned so fade-in / fade-out
            // and the show-scale pop-in remain smooth.
            '  transition: opacity 0.12s ease-out, transform 0.12s ease-out;',
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
            // `.snap` is applied for one frame by `showOverlay` when the
            // new position is a big jump (cross-viewport navigation). The
            // overlay snaps to the new coords without animating through
            // the empty intervening space, then the transition is
            // restored for subsequent scroll-tracking updates.
            `#${focusOverlayId}.snap {`,
            '  transition: none !important;',
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
            // Visibility gate — when `visibilityMode === 'hardware-nav-only'`,
            // hide the entire shadow subtree (ring + previews + label + HUD)
            // by default and reveal only when the host writes
            // `data-modality="hardware-nav" data-ring="visible"` on
            // `#spatnav-focus-host`. The host is responsible for writing
            // the attributes; the wrapper (e.g. `FocusStyleManager`) does
            // this from its touch-aware state machine. Default-hidden so a
            // missing attribute keeps the overlay invisible — fail-safe.
            ...(config.visibilityMode === 'hardware-nav-only'
                ? [
                    ':host {',
                    '  opacity: 0;',
                    '  transition: opacity 220ms cubic-bezier(0.2, 0, 0, 1);',
                    '}',
                    ':host([data-modality="hardware-nav"][data-ring="visible"]) {',
                    '  opacity: 1;',
                    '}',
                    '@media (prefers-reduced-motion: reduce) {',
                    '  :host { transition: none; }',
                    '}',
                ]
                : []),
        ].join('\n');
    }
    /**
     * Position and show the focus overlay on an element.
     * If element is null, hides the overlay.
     */
    function showOverlay(element, state, pulse = false) {
        if (!state.overlay || !element) {
            // [diag] log.info survives the debug bundle. Switch the plugin
            // asset bundle to spatial_navigation.debug.js to capture these
            // via adb logcat | grep SpatialNav while debugging the
            // "ring vanishes mid-scroll" bug.
            log$f.info('showOverlay(null) — clearing visible class', {
                hasOverlay: !!state.overlay,
                hasElement: !!element,
                overlaySuppressed: state.overlaySuppressed,
            });
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
        // [diag] Snapshot of the inputs to the position-write inlined in
        // the message string — Gecko's console pipe stringifies the data
        // object as `[object Object]`, hiding the values when read via
        // adb logcat. The inline form survives the pipe.
        const tag = element.tagName.toLowerCase() + (element.id ? '#' + element.id : '');
        log$f.info(`showOverlay(target=${tag}) rect=[L=${rect.left.toFixed(1)} T=${rect.top.toFixed(1)} R=${rect.right.toFixed(1)} B=${rect.bottom.toFixed(1)}] W×H=${rect.width.toFixed(1)}×${rect.height.toFixed(1)} VP=${window.innerWidth}×${window.innerHeight} scrollY=${window.scrollY} prev=(${overlay.style.left || '?'},${overlay.style.top || '?'}) wasVisible=${overlay.classList.contains('visible')} wasSnap=${overlay.classList.contains('snap')}`);
        // Match element's border-radius
        const computed = window.getComputedStyle(element);
        const borderRadius = computed.borderRadius || '4px';
        const effectiveRadius = borderRadius !== '0px' ? borderRadius : '8px';
        const config = state.config;
        const outlineOffset = config.outlineOffset || 3;
        const outlineWidth = config.outlineWidth || 3;
        // The overlay used to inset by `outlineWidth + outlineOffset + 2 +
        // safeAreaMargin`, which produced visibly-short rings around content
        // touching the viewport edge — a hero image flush against the left
        // side rendered with a 20px gap on its left, looking like the
        // outline was cropped mid-stroke. The new policy: clamp ONLY to
        // keep the outline stroke itself visible (outlineWidth + outlineOffset
        // pixels can extend outside the viewport before the stroke vanishes).
        // `safeAreaMargin` is intentionally NOT applied to the ring — it
        // remains a floating-UI inset for chevrons / labels only. Edge-flush
        // content now renders edge-flush rings, matching user perception.
        const outlineExtent = outlineWidth + outlineOffset;
        log$f.debug(`overlay positioned on ${element.tagName.toLowerCase()}${element.id ? '#' + element.id : ''}`, {
            L: rect.left.toFixed(1),
            T: rect.top.toFixed(1),
            W: rect.width.toFixed(1),
            H: rect.height.toFixed(1),
        });
        // Clamp only enough to keep the outline visible. CSS `outline` paints
        // outside the box, so the stroke can extend up to `outlineExtent` px
        // past the viewport edge and still partially render. Clamping the
        // box position by `-outlineExtent` keeps a sliver visible at the
        // hard edge case without insetting away from edge-flush content.
        const clampedLeft = Math.max(-outlineExtent, rect.left);
        const clampedTop = Math.max(-outlineExtent, rect.top);
        const clampedRight = Math.min(window.innerWidth + outlineExtent, rect.right);
        const clampedBottom = Math.min(window.innerHeight + outlineExtent, rect.bottom);
        // If the clamped box has non-positive dimensions, the focused
        // element is fully outside the viewport (mid-scroll into an
        // off-screen navigation target, or page scrolled past the focused
        // element while focus stayed put).
        //
        // Earlier patches tried to handle this by either letting the
        // negative dimensions produce a CSS 0×0 box (invisible) or
        // explicitly removing the `visible` class. Both produced the
        // user-reported "focus ring vanishes after viewport shift" bug
        // because the ring abruptly disappeared mid-scroll.
        //
        // The correct behaviour is to keep the overlay rendered at the
        // element's REAL viewport-space coordinates (which may be off-
        // screen) so the browser clips it naturally. As the page scrolls,
        // the overlay tracks the element off-screen and back on the same
        // motion path — the user perceives a single smooth slide instead
        // of a vanish/reappear.
        const fullyOffViewport = clampedRight <= clampedLeft || clampedBottom <= clampedTop;
        const renderLeft = fullyOffViewport ? rect.left : clampedLeft;
        const renderTop = fullyOffViewport ? rect.top : clampedTop;
        const renderWidth = fullyOffViewport ? Math.max(rect.width, 1) : clampedRight - clampedLeft;
        const renderHeight = fullyOffViewport ? Math.max(rect.height, 1) : clampedBottom - clampedTop;
        if (fullyOffViewport) {
            // [diag] Path matters: fully-off-viewport elements used to be
            // hidden which produced the user-reported vanish. We now render
            // at raw rect coords and let the browser clip.
            log$f.info('showOverlay: fully-off-viewport — render at raw rect (browser clips)', {
                renderLeft: renderLeft.toFixed(1),
                renderTop: renderTop.toFixed(1),
                renderWidth: renderWidth.toFixed(1),
                renderHeight: renderHeight.toFixed(1),
                direction: rect.top > window.innerHeight
                    ? 'below'
                    : rect.bottom < 0
                        ? 'above'
                        : rect.left > window.innerWidth
                            ? 'right'
                            : 'left',
            });
        }
        // Big position jumps (cross-viewport navigation, e.g. user pressed
        // Down on the last visible focusable and we navigated to an
        // off-screen target via pass-2 scoring) should NOT animate the
        // overlay through the empty intervening space. Detect a big jump
        // by comparing the new top/left against the previous render and
        // snap (disable transition for one frame) when the delta exceeds
        // a viewport-derived threshold. Within-viewport nudges still
        // animate smoothly via the default CSS transition.
        //
        // IMPORTANT: capture `overlayWasHidden` BEFORE adding the `visible`
        // class — re-entering visibility from a hidden state is always a
        // snap because there's no meaningful previous render to animate
        // from. Also snap whenever we cross the in-viewport ↔ off-viewport
        // threshold — the apparent motion of the overlay is dominated by
        // the page scroll, not by an easing curve.
        const SNAP_THRESHOLD_PX = 200;
        const prevLeft = parseFloat(overlay.style.left || '0');
        const prevTop = parseFloat(overlay.style.top || '0');
        const overlayWasHidden = !overlay.classList.contains('visible');
        const jumped = overlayWasHidden ||
            fullyOffViewport ||
            Math.abs(renderLeft - prevLeft) > SNAP_THRESHOLD_PX ||
            Math.abs(renderTop - prevTop) > SNAP_THRESHOLD_PX;
        if (jumped) {
            const reason = overlayWasHidden
                ? 'wasHidden'
                : fullyOffViewport
                    ? 'fullyOffViewport'
                    : `delta>${SNAP_THRESHOLD_PX}px`;
            log$f.info(`showOverlay: snap applied (reason=${reason}, dL=${Math.abs(renderLeft - prevLeft).toFixed(1)}, dT=${Math.abs(renderTop - prevTop).toFixed(1)})`);
            overlay.classList.add('snap');
            // Re-enable the transition on the next frame after the new
            // position has been committed. Using TWO rAF ticks ensures the
            // browser has computed layout with `transition: none` before
            // we restore the easing-based transition.
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    overlay.classList.remove('snap');
                });
            });
        }
        overlay.style.display = 'block';
        overlay.classList.add('visible');
        overlay.style.left = renderLeft + 'px';
        overlay.style.top = renderTop + 'px';
        overlay.style.width = renderWidth + 'px';
        overlay.style.height = renderHeight + 'px';
        overlay.style.borderRadius = effectiveRadius;
        updateDebugHud(state);
        updateFocusLabel(state, element, {
            left: renderLeft,
            top: renderTop,
            width: renderWidth});
        // Remove native focus outline
        try {
            element.style.setProperty('outline', 'none', 'important');
            element.style.setProperty('box-shadow', 'none', 'important');
        }
        catch {
            // ignore
        }
        // The `.pulse` keyframe animation hardcodes the legacy amber
        // `rgba(255, 193, 7, …)` fallback and clashes with the
        // Material-Blue-800 default — gated on `enableFocusPulse` so hosts
        // that customise their ring colour can opt back in.
        if (pulse && state.config.enableFocusPulse) {
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
                    // Use the same edge-flush clamp policy as the main path
                    // (see comment in `showOverlay` above for rationale).
                    const outlineOffset = state.config.outlineOffset || 3;
                    const outlineWidth = state.config.outlineWidth || 3;
                    const outlineExtent = outlineWidth + outlineOffset;
                    const left = Math.max(-outlineExtent, newRect.left);
                    const top = Math.max(-outlineExtent, newRect.top);
                    const right = Math.min(window.innerWidth + outlineExtent, newRect.right);
                    const bottom = Math.min(window.innerHeight + outlineExtent, newRect.bottom);
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
        // [diag] Every code path that removes the `visible` class lands here
        // OR in `showOverlay(null)`. If you're chasing a "ring vanishes"
        // bug, the call site appears just above this line in the stack.
        log$f.info('hideOverlay() — removing visible class', {
            wasVisible: state.overlay?.classList.contains('visible'),
            overlaySuppressed: state.overlaySuppressed,
            stack: new Error('hideOverlay call site').stack?.split('\n').slice(1, 4).join(' | '),
        });
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
     * Constant gap (in CSS pixels) between the focus ring's outer edge and
     * the chevron's near edge. Matches the default `outline-width (3) +
     * outline-offset (3) + 8` of breathing room, so the chevron renders at
     * roughly the same visible distance from the ring across all focused
     * elements regardless of their size. Previously this was proportional
     * to chevron size, which produced visibly inconsistent gaps (tighter on
     * small buttons, wider on large images).
     */
    const CHEVRON_RING_GAP = 14;
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
    function showChevronPreview(entry, direction, currentRect, safeAreaMargin = 0) {
        if (!entry || !entry.container || !currentRect) {
            return;
        }
        const size = Math.max(14, Math.min(26, Math.round(Math.min(currentRect.width, currentRect.height) * 0.28)));
        // Constant chevron-to-ring gap regardless of focused-element size.
        // The previous `offset = max(10, round(size * 0.75))` formula scaled
        // the gap with chevron size, so a small button got a ~11px gap and
        // a large image got a ~17px gap — visually inconsistent (most
        // noticeable on the Dart logo: its ring uses the 200×80 image rect
        // → larger chevron → wider gap; adjacent small links had a tight
        // gap). A constant offset matches the ring's own outline extent
        // (outline width + outline-offset) so the chevron always appears
        // the same fixed distance outside the ring.
        const offset = CHEVRON_RING_GAP;
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
        const CHEVRON_VIEWPORT_PAD = 4;
        const fitsHorizontally = left >= CHEVRON_VIEWPORT_PAD && left + size <= viewportW - CHEVRON_VIEWPORT_PAD;
        const fitsVertically = top >= CHEVRON_VIEWPORT_PAD && top + size <= viewportH - CHEVRON_VIEWPORT_PAD;
        if (!fitsHorizontally || !fitsVertically) {
            entry.container.style.left = '';
            entry.container.style.top = '';
            entry.container.style.width = '';
            entry.container.style.height = '';
            entry.container.style.opacity = '';
            entry.container.className = 'focus-preview focus-preview-' + direction;
            if (entry.arrow) {
                entry.arrow.style.display = '';
            }
            return;
        }
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
        // When `boundaryScrollBehavior` is `'scroll'`, a vertical press that
        // hits the boundary triggers `window.scrollBy` — the press IS
        // actionable even with no in-viewport candidate. Show the chevron in
        // that case so the user has a hint of the scroll affordance.
        // Horizontal directions stay strict (no horizontal scroll-on-boundary).
        const scrollOnBoundary = state.config.boundaryScrollBehavior === 'scroll';
        previewDirectionKeys.forEach(function (direction) {
            const dir = directionByName[direction];
            const candidate = findDirectionalCandidate(currentIndex, dir, state);
            // Drop pass-(-1) (wrap-around) — surprising teleport across
            // the page, never represent as a chevron.
            if (candidate && candidate.passIndex === -1) {
                result[direction] = null;
                return;
            }
            // Drop pass-2 ("wide-net, requireViewport:false") chevrons UNLESS
            // (a) `boundaryScrollBehavior` is `'scroll'` AND (b) direction is
            // vertical — in which case the press will scroll the viewport
            // toward the target. Without (a)+(b), pass-2 chevrons would
            // mislead: they'd point to off-screen targets that the move path
            // could reach but the user wouldn't visually expect.
            //
            // Rationale: the move path (handleKeyDown → moveInDirection) calls
            // findDirectionalCandidate directly without this filter, so it can
            // STILL reach those wide-net targets when the user presses an arrow.
            // Filtering at the preview layer (not the move layer) keeps the
            // chevrons honest about close-by reachable targets.
            if (candidate && candidate.passIndex === 2) {
                const isVerticalScroll = scrollOnBoundary && (direction === 'up' || direction === 'down');
                if (!isVerticalScroll) {
                    result[direction] = null;
                    return;
                }
            }
            result[direction] = candidate;
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
        const _rect = calculateVisualRect(currentElement);
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
    const log$e = createLogger('Intersection');
    function supportsIntersectionObserver() {
        return typeof window !== 'undefined' && typeof window.IntersectionObserver !== 'undefined';
    }
    function createObserver(state) {
        if (!supportsIntersectionObserver()) {
            log$e.debug('IntersectionObserver unsupported in this environment');
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
    const log$d = createLogger('DOM');
    /** Threshold above which a focusable refresh is logged as slow (ms). */
    const SLOW_REFRESH_THRESHOLD_MS = 50;
    const focusableSelector = 'a[href], a[aria-haspopup], [role="link"], button:not([disabled]), [role="button"], [aria-haspopup="true"], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';
    // ===== Shadow DOM Traversal =====
    /**
     * Upper bound on elements *visited* during a single focusable scan — light DOM
     * and deep shadow traversal alike. Every discovery walks the tree lazily and
     * stops here, so a hostile/pathological page (millions of nodes, deeply nested
     * shadow roots) can never force a full DOM enumeration. Shared across the
     * recursion via a budget object. Set far above any realistic page.
     */
    const MAX_SCAN_NODES = 100000;
    /**
     * Walk elements under `root` in document (pre-order) order via
     * firstElementChild/nextElementSibling, invoking `visit` for each, until the
     * shared `budget` is exhausted (then truncate with a warning). A lazy, bounded
     * alternative to `querySelectorAll`: it never materializes a full NodeList, so a
     * hostile, very large DOM cannot force a complete enumeration before any cap
     * applies. (TreeWalker would be cleaner but is unreliable under happy-dom.)
     */
    function walkElementsBounded(root, budget, visit) {
        const pending = [];
        let node = root.firstElementChild;
        while (node) {
            if (budget.nodes <= 0) {
                log$d.warn('DOM scan hit node budget; truncating');
                break;
            }
            budget.nodes--;
            visit(node);
            if (node.nextElementSibling)
                pending.push(node.nextElementSibling);
            node = node.firstElementChild ?? pending.pop() ?? null;
        }
    }
    /**
     * Find focusable elements including those in Shadow DOM.
     * Recursively traverses shadow roots; slotted light-DOM content needs no special
     * handling — it is the host's light children, which the same walk already visits.
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
    function findFocusablesDeep(root, config, visited = new Set(), seen = new Set(), budget = { nodes: MAX_SCAN_NODES }) {
        const results = [];
        // Prevent infinite loops with circular shadow DOM references
        if (visited.has(root)) {
            return results;
        }
        if (root.nodeType === 11) {
            // ShadowRoot
            visited.add(root);
        }
        const traverseShadow = !!(config && config.traverseShadowDom);
        // Single lazy, budget-bounded pre-order walk of this root's light tree. Per
        // element: collect it if focusable and descend into its shadow root. One
        // bounded walk (rather than querySelectorAll, which materializes the full
        // match list up front) means a hostile, very large DOM can never force a
        // complete enumeration before the shared node budget applies. The walk stays
        // within this root; the recursion descends across shadow boundaries, sharing
        // the same budget.
        try {
            walkElementsBounded(root, budget, (element) => {
                if (!seen.has(element) && element.matches(focusableSelector)) {
                    seen.add(element);
                    results.push(element);
                }
                if (!traverseShadow) {
                    return;
                }
                // Descend into the element's shadow root, sharing the budget. We do
                // NOT separately resolve <slot> assignments: slotted content is the
                // host's LIGHT-DOM children, which this same walk already visits in
                // the host's containing tree (deduped via `seen`). Calling
                // slot.assignedElements() would materialize the full assigned array
                // up front — exactly what this bounded walk exists to avoid.
                const host = element;
                if (host.shadowRoot && !visited.has(host.shadowRoot)) {
                    results.push(...findFocusablesDeep(host.shadowRoot, config, visited, seen, budget));
                }
            });
        }
        catch (e) {
            log$d.warn('deep DOM traversal error', e);
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
        if (selectors.length === 0) {
            return containers;
        }
        // Validate selectors once on a detached probe (matches() throws on invalid
        // syntax without touching the document), then find matches in a single lazy,
        // budget-bounded walk testing the COMBINED selector list. This avoids
        // querySelectorAll's full match-list materialization — a page matching many
        // of the (default-on) virtual-container selectors cannot force a huge
        // allocation during sentinel setup — while staying one matches() per element
        // regardless of how many selectors are configured.
        const probe = document.createElement('div');
        const valid = selectors.filter((s) => {
            try {
                probe.matches(s);
                return true;
            }
            catch {
                return false;
            }
        });
        if (valid.length === 0) {
            return containers;
        }
        const combined = valid.join(', ');
        const seen = new Set();
        try {
            walkElementsBounded(document, { nodes: MAX_SCAN_NODES }, (el) => {
                if (el.matches(combined)) {
                    const host = el;
                    if (!seen.has(host)) {
                        seen.add(host);
                        containers.push(host);
                    }
                }
            });
        }
        catch (e) {
            log$d.warn('virtual container scan failed', e);
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
        log$d.debug(`detected ${containers.length} virtual scroll containers`);
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
                    log$d.debug('virtual scroll sentinel triggered refresh');
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
            log$d.debug('accessibility announcer created');
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
     * Upper bound on focusable candidates processed per refresh. Each candidate
     * incurs a `getComputedStyle` plus geometry/group work in the loop below, so an
     * uncapped list would let a hostile page that renders millions of focusable
     * elements turn every focus refresh into a denial of service. Set far above any
     * realistic page (you cannot meaningfully D-pad through tens of thousands of
     * targets anyway), so legitimate content is never truncated.
     */
    const MAX_FOCUSABLE_NODES = 50000;
    /**
     * Truncate the focusable-candidate list to `max`, warning once on overflow.
     * Returns the original array reference when under the cap (no copy on the hot
     * path). Final guard on the per-node processing loop, after the bounded scan
     * (which already caps elements visited) and any iframe additions.
     */
    function capFocusableNodes(nodes, max = MAX_FOCUSABLE_NODES) {
        if (nodes.length <= max) {
            return nodes;
        }
        log$d.warn(`focusable candidates (${nodes.length}) exceed cap ${max}; truncating`);
        return nodes.slice(0, max);
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
        // Use Shadow DOM traversal if enabled, otherwise a lazy bounded light-DOM scan.
        let nodes;
        if (config.traverseShadowDom) {
            nodes = findFocusablesDeep(document, config);
            log$d.debug(`shadow DOM traversal found ${nodes.length} focusables`);
        }
        else {
            // Lazy, budget-bounded scan (rather than querySelectorAll, which
            // materializes the full match list) so a hostile page cannot force a
            // complete DOM enumeration before the cap below.
            const collected = [];
            walkElementsBounded(document, { nodes: MAX_SCAN_NODES }, (el) => {
                if (el.matches(focusableSelector)) {
                    collected.push(el);
                }
            });
            nodes = collected;
        }
        log$d.debug(`candidate nodes found: ${nodes.length}`);
        // Add iframes if iframe support is enabled. Lazy bounded scan (rather than
        // querySelectorAll, which materializes the full match list) so a hostile page
        // cannot force a complete enumeration on this opt-in path either.
        if (config.iframeSupport && config.iframeSupport.enabled) {
            try {
                const selector = config.iframeSupport.selector || 'iframe';
                const existing = new Set(nodes);
                walkElementsBounded(document, { nodes: MAX_SCAN_NODES }, (el) => {
                    if (el.matches(selector) && !existing.has(el)) {
                        existing.add(el);
                        nodes.push(el);
                    }
                });
            }
            catch (err) {
                log$d.warn('iframe selector failed', err);
            }
        }
        // Bound the candidate list before the per-node getComputedStyle/geometry
        // pass below — without this, a page rendering millions of focusable elements
        // would make every refresh a DoS.
        nodes = capFocusableNodes(nodes);
        const results = [];
        // Reset groups for fresh discovery
        // We keep the objects if possible to preserve state (lastFocused), but for now simpler to rebuild
        // TODO: Optimize to preserve group state across refreshes
        const oldGroups = state.focusGroups || Object.create(null);
        // Null-prototype map — focus-group ids are page-controlled (`data-focus-group`),
        // so a plain `{}` would let keys like `__proto__`/`constructor` resolve to
        // inherited members and throw on `group.addMember`. See core/state.ts.
        state.focusGroups = Object.create(null);
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
                log$d.warn(`slow refresh: ${duration.toFixed(2)}ms (${results.length} elements)`);
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
     * Focus the initial element on the page.
     *
     * @param force - Force focus even if something is already focused
     * @param state - Global state object
     * @returns True if element was focused
     */
    function focusInitialElement(force, state) {
        if (!state.focusables || state.focusables.length === 0) {
            return false;
        }
        const firstEntry = state.focusables[0];
        if (!firstEntry || !firstEntry.element) {
            return false;
        }
        try {
            firstEntry.element.focus({ preventScroll: true });
            return true;
        }
        catch {
            try {
                firstEntry.element.focus();
                return true;
            }
            catch {
                return false;
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
        log$d.debug('inserted entry', describeElement(el));
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
        log$d.debug('removing entry', describeElement(entry.element));
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
        log$d.debug(`incremental refresh complete: ${state.focusables.length} focusables`);
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
    const log$c = createLogger('Scoring');
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
            // alignmentWeight bumped from 10 → 200 to prevent the
            // "horizontal carousel LEFT picks title-below-sibling" bug:
            // PRIMARY_WEIGHT is 1000 so a single px of primary-axis advantage
            // adds 1000 to a candidate`s score; with alignmentWeight=10, a
            // candidate would need 100+ px of off-axis penalty to flip a 1 px
            // primary win. For a 3-thumbnail carousel where each card`s
            // title sits ~135 px below the card (`a.summary-thumbnail` row
            // at Y=2498, `a.summary-title-link` row at Y=2715), the
            // sibling-thumb on the same row is only 12 px further in the
            // navigation axis than the off-row title — title was winning
            // pass-0 scoring (15,681 vs 26,326). Bumping alignmentWeight to
            // 200 in the strict pass makes the 134 px secondary cost
            // 26,800 — comfortably more than the 12,000 primary advantage —
            // so the row-aligned sibling wins. Pass 1/2 stay relaxed so
            // wrap-row fallback navigation isn`t affected.
            {
                strictEdges: true,
                allowOverlap: false,
                requireViewport: true,
                viewportMargin: 0,
                alignmentWeight: 200,
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
        log$c.debug(`no candidate for ${direction.name} after ${passes.length} passes`);
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
     * Bridge messaging utilities for Spatial Navigation System
     *
     * Centralizes browser/chrome runtime messaging with consistent
     * Promise/callback handling and error formatting.
     */
    const log$b = createLogger('Bridge');
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
                log$b.debug('No extension bridge available');
            }
            return { success: false, error: 'No extension bridge available' };
        }
        try {
            if (options.debug) {
                // Log the message TYPE only — never the body (may carry URLs/coords).
                log$b.debug(`Sending message type: ${String(message?.type)}`);
            }
            if (isFirefoxStyle()) {
                // Firefox-style Promise API
                const result = runtime.sendMessage(message);
                if (result && typeof result.then === 'function') {
                    try {
                        const response = await result;
                        if (options.debug) {
                            log$b.debug('Response received (promise)');
                        }
                        return { success: true, response };
                    }
                    catch (error) {
                        const errorMessage = formatBridgeError(error);
                        log$b.error(`Bridge error (promise): ${errorMessage}`);
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
                            log$b.error(`Bridge error (callback): ${errorMessage}`);
                            resolve({ success: false, error: errorMessage });
                        }
                        else {
                            if (options.debug) {
                                log$b.debug('Response received (callback)');
                            }
                            resolve({ success: true, response: typedResponse });
                        }
                    });
                });
            }
        }
        catch (error) {
            const errorMessage = formatBridgeError(error);
            log$b.error(`Bridge exception: ${errorMessage}`);
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
     * Focus recovery and overlay update helpers for Spatial Navigation System
     *
     * These utilities are extracted from handlers.ts to reduce coupling
     * and prevent circular dependencies with observer.ts.
     */
    const log$a = createLogger('Focus');
    /**
     * Schedule an overlay update with requestAnimationFrame.
     * Respects overlay suppression state for focus-exit scenarios.
     *
     * @param target - Target element to highlight
     * @param state - Global state object
     */
    function scheduleOverlayUpdate(target, state) {
        if (state.overlaySuppressed) {
            // [diag] If "ring vanished" coincides with this branch firing,
            // the bug is upstream — someone set `overlaySuppressed = true`
            // before scroll-tracking could re-position. Cross-reference the
            // adjacent "suppressOverlay(reason=...)" log to identify the
            // culprit.
            // Promoted to log.warn so prod traces show when scheduleOverlayUpdate
            // is gated (this is THE smoking-gun signal for "ring should be
            // visible but isn`t" reports).
            log$a.warn(`scheduleOverlayUpdate: SKIPPED — overlaySuppressed=true target=${target ? target.tagName.toLowerCase() : '(null)'}`);
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
        {
            log$a.debug(`Stored position hint: ${state.lastFocusPosition.elementDesc} at (${entry.centerX.toFixed(0)}, ${entry.centerY.toFixed(0)})`);
        }
    }
    /**
     * Atomically clear `overlaySuppressed` AND any pending auto-recover timer.
     *
     * Centralizes the cleanup that the four ad-hoc clear sites used to
     * duplicate (with subtly different completeness): the moveInDirection
     * entry point, the auto-recover timer callback, the
     * `spatnav-clear-suppress` event listener, and the
     * `spatnav-engage-overlay` event listener. The latter two cancelled the
     * pending timer; the former two did not. If a new
     * `spatialNavigationExit` auto-recover is pending and the user
     * successfully D-pads to a new target (movement.ts:247), the orphan
     * timer would fire 350ms later, observe `!overlaySuppressed`, and
     * harmlessly bail — but on a subsequent suppression race it could
     * resurrect a stale state. One helper, one invariant.
     *
     * @param state - Global state object
     */
    function clearOverlaySuppression(state) {
        state.overlaySuppressed = false;
        if (state.suppressRecoveryTimer != null) {
            clearTimeout(state.suppressRecoveryTimer);
            state.suppressRecoveryTimer = null;
        }
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
    function moveInDirection(direction, event, state, options = {}) {
        const config = state.config;
        const active = getActiveElement();
        const currentIndex = active && active instanceof HTMLElement ? state.focusableElements.indexOf(active) : -1;
        if (currentIndex === -1) {
            // Bail BEFORE clearing `overlaySuppressed` — we never actually
            // attempted navigation. The previous order cleared the
            // suppression flag eagerly at the top of the function, then
            // returned `false` here without showing the overlay or wiring
            // any recovery. That stranded the page in the "not suppressed,
            // not shown" state until a NEW suppression source ran. Now the
            // suppression flag only changes when a real navigation attempt
            // begins.
            return false;
        }
        // Past the bail-out: we have a valid active focusable and are
        // committing to a navigation attempt. Clear any in-flight
        // suppression — AND cancel any pending recovery timer — so the
        // overlay is free to follow the new target. The atomic helper
        // matches the cleanup the listener sites in main.ts do, eliminating
        // the prior asymmetry where a successful nav left an orphan timer
        // that would fire 350ms later on stale state.
        if (state.overlaySuppressed) {
            clearOverlaySuppression(state);
        }
        const currentEntry = state.focusables[currentIndex];
        updateEntryGeometry(currentEntry, state);
        // Use cached candidate if available and fresh
        const target = getCachedOrComputeCandidate(currentIndex, direction, state);
        if (!target) {
            // `notifyOnBoundary` defaults to `true` for backwards compatibility
            // with direct callers (debug menu, scripts). The internal
            // `handleKeyDown` retry sets it `false` on the first attempt to
            // avoid double-firing analytics — see `MoveInDirectionOptions`
            // doc-comment above.
            const notifyOnBoundary = options.notifyOnBoundary !== false;
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
            if (notifyOnBoundary) {
                // `boundaryScrollBehavior` controls what happens here:
                //   - 'scroll': scroll the page by half a viewport in
                //     vertical directions; suppress the host notification.
                //     Falls through to 'exit' when the page is already at
                //     the scroll extent in that direction — without that
                //     fallthrough, the user can't escape the WebView once
                //     they reach top/bottom of the page (no `focusExit` is
                //     ever sent to the host).
                //   - 'none': silent — no exit event, no scroll.
                //   - 'exit' (default): dispatch `spatialNavigationExit` and
                //     post `focusExit` to the native host.
                const boundaryBehavior = config.boundaryScrollBehavior;
                // Whether the exit-branch below was reached via fall-through
                // from `boundaryScrollBehavior === 'scroll'` (no scroll room
                // in the direction). In that case the host's `focusExit`
                // handler should still get the chance to act (e.g. AAOS
                // pulls focus to the address bar on `up`), but the extension
                // MUST NOT pre-emptively suppress the overlay — for `down`
                // at the page bottom the host typically does nothing and
                // the suppress-then-auto-recover dance produces a visible
                // 350ms "ring slides off and returns" artifact with no
                // actual focus change.
                let fellThroughFromScroll = false;
                if (boundaryBehavior === 'scroll' && (direction.name === 'up' || direction.name === 'down')) {
                    const scrollY = window.scrollY;
                    const maxScrollY = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
                    const hasScrollRoom = direction.name === 'up' ? scrollY > 0 : scrollY < maxScrollY - 1; // 1px tolerance for subpixel rounding
                    if (hasScrollRoom) {
                        try {
                            const reducedMotion = window.matchMedia &&
                                window.matchMedia('(prefers-reduced-motion: reduce)').matches;
                            const step = Math.max(120, Math.round(window.innerHeight * 0.5));
                            const delta = direction.name === 'down' ? step : -step;
                            window.scrollBy({
                                top: delta,
                                behavior: reducedMotion ? 'auto' : 'smooth',
                            });
                            log$9.debug(`boundary scroll: ${direction.name} by ${delta}px`);
                        }
                        catch (e) {
                            log$9.debug('boundary scroll failed', e);
                        }
                        if (state.nextTargets) {
                            state.nextTargets[direction.name] = null;
                        }
                        state.currentTrap = trapInfo;
                        return false;
                    }
                    // No scroll room — fall through to the 'exit' branch so
                    // the user can escape (e.g., return to the native
                    // address bar above the WebView). Mark the fall-through
                    // so we skip the local overlay suppress below.
                    fellThroughFromScroll = true;
                    log$9.debug(`boundary ${direction.name}: no scroll room, falling through to exit`);
                }
                if (boundaryBehavior === 'none') {
                    // Silent boundary — no exit dispatch, no scroll.
                    if (state.nextTargets) {
                        state.nextTargets[direction.name] = null;
                    }
                    state.currentTrap = trapInfo;
                    return false;
                }
                // Default 'exit' behaviour. Also reached when
                // `boundaryScrollBehavior === 'scroll'` had no scroll room
                // (see fall-through above).
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
                if (!fellThroughFromScroll) {
                    // Real exit (boundaryScrollBehavior:'exit' OR a
                    // legitimately-unscrollable direction in 'scroll' mode
                    // — i.e. horizontal). Dispatch the custom event so any
                    // wrapper-side suppress-on-exit listener fires.
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
                }
                else {
                    log$9.debug('scroll-fall-through exit — skipping local overlay suppress; ' +
                        'host handler decides whether focus actually leaves');
                }
            }
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
        // log.info (stripped from prod bundle) so debug builds show which
        // element wins the directional scoring without flooding prod
        // logcat at navigation rate. Switch to the .debug.js bundle to
        // capture these via adb when diagnosing "DOWN went somewhere
        // unexpected" reports.
        log$9.info(`moveInDirection(${direction.name}) from=${describeElement(currentEntry.element)} to=${describeElement(target.data.element)} passIndex=${target.passIndex ?? 0}`);
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
                // Add visual breathing room so the focus ring's outer halo
                // (glow box-shadow + outline-offset) isn't clipped by the
                // viewport edge when `block: 'nearest'` would snap the
                // element flush against the edge.
                //
                // Previously this was a follow-up `scrollBy` in a nested
                // `requestAnimationFrame`, which produced a visible
                // "double-stage" focus settle (element snaps to the edge,
                // then jumps 16 px inward one frame later). The fix:
                // temporarily set `scroll-margin` on the target element
                // BEFORE calling `scrollIntoView`. Native scroll math
                // honours `scroll-margin` and bakes the buffer into the
                // SINGLE atomic scroll — no second frame, no visible
                // double-stage.
                //
                // We restore the prior inline `scroll-margin` after a
                // microtask so page styles aren't permanently mutated.
                const el = target.data.element;
                const SCROLL_BUFFER = '16px';
                const prevScrollMargin = el.style.scrollMargin;
                try {
                    el.style.scrollMargin = SCROLL_BUFFER;
                    el.scrollIntoView({ block: block, inline: inline });
                }
                finally {
                    // Restore on the next microtask so the scroll math runs
                    // with the buffer applied, then the inline style is
                    // cleared. We do NOT restore synchronously because some
                    // browsers schedule the scroll computation off the main
                    // thread and might re-read style mid-scroll.
                    queueMicrotask(() => {
                        try {
                            el.style.scrollMargin = prevScrollMargin;
                        }
                        catch {
                            // ignore
                        }
                    });
                }
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
     * Menu-toggle handling helpers for Spatial Navigation.
     *
     * Some sites use hover-driven navigation menus that open on pointer enter and
     * do not reliably close on click/tap. For D-pad/Enter interactions we treat
     * `aria-haspopup`/`aria-expanded` toggles as true toggles: a second press
     * closes them. We try a hover-exit first (cheap, doesn't move focus); if the
     * menu is still open we fall back to a synthetic "outside click".
     */
    const log$8 = createLogger('MenuToggle');
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
        log$8.debug(`menu toggle OPEN (${menuState.reason}) — closing via hover-exit + outside click`, {
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
            log$8.debug(`menu closed via hover-exit (${menuState.reason}) — skipping outside click`);
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
            log$8.debug('menu still open — outside-click fallback', {
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
                    log$8.debug('closing menu toggle via NATIVE outside click', {
                        css: { x: outsideNow.x, y: outsideNow.y, point: outsideNow.label },
                        dpr,
                        final: { x: physicalX, y: physicalY },
                    });
                    const message = {
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
                    };
                    runtime.sendMessage(message);
                }
                catch (e) {
                    log$8.warn('native outside-click failed, using JS fallback', e);
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
    const log$7 = createLogger('Handlers');
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
            log$7.debug(`stale handler blocked: my=${myHandlerId} current=${currentDomHandlerId}`);
            return;
        }
        // 2. Atomic event lock — see file header.
        const timeStamp = Number.isFinite(event.timeStamp) ? event.timeStamp : 0;
        const eventLockKey = `${event.type || 'keydown'}:${event.key || ''}:${timeStamp.toFixed(3)}`;
        const currentLock = document.documentElement.getAttribute(EVENT_LOCK_ATTR);
        if (currentLock === eventLockKey) {
            log$7.debug(`event lock hit: ${eventLockKey}`);
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
        log$7.debug(`keydown #${callCount} key="${event.key}" handler=${myHandlerId} since=${timeSinceLast}ms`);
        window.__SPATIAL_NAV_LAST_KEY_TIME__ = debugNow;
        window.__SPATIAL_NAV_LAST_KEY__ = event.key;
        // 5. Drop rapid same-key repeats — likely synthetic-event duplicates.
        if (event.key === lastKey && timeSinceLast < RAPID_REPEAT_THRESHOLD_MS && timeSinceLast > 0) {
            log$7.debug(`rapid repeat blocked: "${event.key}" within ${timeSinceLast}ms`);
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            return;
        }
        // 6. ENTER and SPACE — activate the focused element.
        if (event.key === 'Enter' || event.key === ' ') {
            // Mark hardware-nav so the next real pointer event flips us back to
            // touch (the modality watcher in `main.ts` reads this).
            state.lastReportedModality = 'hardware-nav';
            handleActivationKey(event, state, myHandlerId);
            return;
        }
        // 7. Arrow keys — directional navigation.
        const keyMap = directionByKey;
        if (!keyMap[event.key])
            return;
        // We're committed to handling a directional key; mark hardware-nav so the
        // pointer watcher resumes transition reporting.
        state.lastReportedModality = 'hardware-nav';
        log$7.debug(`directional key: ${event.key}`);
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
                log$7.debug('no focusable elements found');
                // Block default to keep focus from escaping to the address bar.
                event.preventDefault();
                event.stopPropagation();
                return;
            }
        }
        const validActive = ensureValidFocus(state);
        if (!validActive) {
            log$7.warn('unable to recover focus — aborting navigation');
            event.preventDefault();
            event.stopPropagation();
            return;
        }
        const currentActive = validActive;
        const currentIndex = currentActive ? state.focusableElements.indexOf(currentActive) : -1;
        log$7.debug(`current focus: ${describeElement(currentActive)} (index=${currentIndex})`);
        const dirMap = directionByName;
        const targets = updatePreviewTargets(currentIndex, findDirectionalCandidate, dirMap, state);
        log$7.debug('next targets', {
            up: targets.up?.data ? describeElement(targets.up.data.element) : null,
            down: targets.down?.data ? describeElement(targets.down.data.element) : null,
            left: targets.left?.data ? describeElement(targets.left.data.element) : null,
            right: targets.right?.data ? describeElement(targets.right.data.element) : null,
        });
        const direction = keyMap[event.key];
        log$7.debug(`moving direction: ${direction.name}`);
        // First attempt — silent on boundary so we don't fire focusExit
        // twice per user keypress. The retry below carries the boundary
        // notification (sendFocusExit + spatialNavigationExit dispatch +
        // overlay suppression) — see `MoveInDirectionOptions.notifyOnBoundary`
        // for the analytics-cluster motivation.
        const moved = moveInDirection(direction, event, state, { notifyOnBoundary: false });
        const afterActive = getActiveElement();
        if (!moved) {
            log$7.debug('movement failed — retrying with forced refresh');
            refreshFocusables(state);
            state.lastRefreshTime = Date.now();
            // Retry attempt — this one DOES notify on boundary, so the
            // single user keypress produces at most one focusExit.
            const retryMoved = moveInDirection(direction, event, state, { notifyOnBoundary: true });
            if (!retryMoved) {
                log$7.debug(`boundary reached: ${direction.name}`);
                state.lastBoundary = direction.name;
                event.preventDefault();
                event.stopPropagation();
            }
            else {
                log$7.debug('retry succeeded');
                const newActive = getActiveElement();
                if (newActive)
                    scheduleOverlayUpdate(newActive, state);
            }
        }
        else {
            log$7.debug(`new focus: ${describeElement(afterActive)}`);
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
        log$7.debug(`${event.key === ' ' ? 'SPACE' : 'ENTER'} on ${describeElement(activeElement)}`, {
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
        log$7.debug(`click strategy: ${useNativeClick ? 'NATIVE' : 'JS .click()'}`, {
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
        log$7.debug('hit-test', {
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
            log$7.debug('requesting native MotionEvent injection');
            // Convert CSS px → physical px for Android MotionEvent.
            const dpr = window.devicePixelRatio || 1.0;
            const finalX = x * dpr;
            const finalY = y * dpr;
            log$7.debug('native injection request', {
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
                            log$7.debug('background relay success (promise)', response);
                        })
                            .catch((error) => {
                            log$7.error('background relay failed (promise)', error);
                        });
                    }
                }
                else {
                    // Chrome: callback API
                    sendMessage(message, (response) => {
                        const error = runtimeApi.lastError;
                        if (error) {
                            log$7.error('background relay failed (lastError)', error);
                        }
                        else {
                            log$7.debug('background relay success (callback)', response);
                        }
                    });
                }
            }
            catch (e) {
                log$7.warn('native injection unavailable, falling back to JS .click()', e);
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
     * focused element's viewport position changes. Uses rAF debouncing to
     * coalesce multiple scroll events into one position update per frame.
     *
     * Exported for testing — pin the per-rAF-tick update contract so a
     * future refactor can't reintroduce the "scrollThreshold filter
     * blocks smooth-scroll tracking" regression.
     */
    function attachScrollListener(state) {
        const config = state.config;
        if (config.observeScroll === false) {
            log$7.debug('scroll listener disabled by config');
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
                // `config.scrollThreshold` is retained for back-compat
                // with consumers that set it, but the post-rAF
                // listener architecture no longer needs a px filter —
                // the rAF debounce above already caps the update rate
                // at one per frame, and gating per-frame deltas (which
                // for smooth-scroll are ~1–15 px) caused the
                // "ring stuck while page scrolls" artifact (see fire
                // logic below). The knob is effectively a no-op now.
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
                scrollPositions.set(target, {
                    scrollY: currentScrollY,
                    scrollX: currentScrollX,
                });
                // Fire on ANY frame-over-frame scroll movement (>= 1 px).
                //
                // The earlier `config.scrollThreshold || 8` filter was
                // intended to avoid micro-jitter, but in practice it
                // filtered out the meaningful per-tick deltas of a
                // `behavior:'smooth'` scrollBy — those typically move
                // 4–15 px per frame over ~300 ms. The listener fired
                // exactly once (at the boundary itself) and the focus
                // ring sat at its pre-scroll viewport coords until the
                // smooth scroll finished, producing the user-reported
                // "ring slides off and returns to settle" artifact. The
                // rAF debounce above already caps the update rate at
                // one per frame, so removing the px filter doesn't
                // increase the worst-case overhead — it just keeps the
                // ring honest during smooth-scroll animations.
                //
                // Kept the `cached`/`deltaY`/`deltaX` plumbing because
                // a 0-px scroll event means nothing meaningful changed
                // (e.g., the page emits a stub scroll event right after
                // an instant scrollIntoView that already landed); skip
                // those.
                if (deltaY > 0 || deltaX > 0) {
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
                            // [diag] Scroll tick → overlay update path.
                            // log.debug: fires on every requestAnimationFrame
                            // scroll batch, so log.info would flood debug
                            // bundles. Production strips this entirely.
                            log$7.debug(`scroll listener: update dY=${deltaY} dX=${deltaX} rectT=${rect.top.toFixed(1)} VPh=${window.innerHeight} suppressed=${state.overlaySuppressed} active=${active.tagName.toLowerCase()}${active.id ? '#' + active.id : ''}`);
                            scheduleOverlayUpdate(active, state);
                        }
                    }
                    else {
                        log$7.debug(`scroll listener: NO active focusable hasActive=${!!active} currentIndex=${state.currentIndex}`);
                    }
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
            log$7.debug('state already has handlers, skipping');
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
    const log$6 = createLogger('Observer');
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
                    log$6.debug(`detected framework: ${adapter.name}`);
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
            // Force a full refresh whenever the DOM tree changes OR a visibility-
            // affecting attribute (aria-hidden / hidden) flips. The incremental
            // path inspects only the mutation target, but aria-hidden/hidden on a
            // wrapper transitively excludes/restores every focusable inside —
            // refreshFocusables uses `closest('[aria-hidden="true"]')` and the
            // computed-style display check, both of which see ancestors. Without
            // this, toggling a tab panel's wrapper leaves stale focusables until
            // the next childList mutation.
            const needsFullRefresh = mutationBuffer.some((m) => {
                if (m.type === 'childList')
                    return true;
                if (m.type === 'attributes') {
                    return m.attributeName === 'aria-hidden' || m.attributeName === 'hidden';
                }
                return false;
            });
            // Invalidate precomputed cache
            state.dirty = true;
            state.precomputedTargets = null;
            const doRefresh = () => {
                if (needsFullRefresh) {
                    log$6.debug('childList mutation → full refresh');
                    refreshFocusables(state);
                }
                else {
                    log$6.debug('attribute mutation → incremental update');
                    refreshAttributes(state, mutationBuffer);
                }
                const active = getActiveElement();
                // Earlier versions hid the overlay whenever `state.focusableElements`
                // didn't include the active element. That over-fires:
                //   - React/Vue/etc. re-mount focused elements with new node
                //     identity during render — same logical focus, different
                //     node reference; the new node hadn't yet been picked up
                //     by `refreshFocusables` at this point in the mutation.
                //   - Scroll-driven lazy-loads on rich pages (e.g. dart.art's
                //     hero animations) fire frequent childList mutations
                //     that trigger a full refresh; transient races between
                //     the refresh and the host's still-attached focus
                //     element caused the user-reported "focus ring vanishes
                //     after viewport shift" bug.
                //
                // Only hide if the active element is genuinely no longer a
                // valid focus target — disconnected from the DOM or fallen
                // back to body / documentElement. Otherwise reposition.
                const isValidFocus = !!active &&
                    active instanceof HTMLElement &&
                    active.isConnected &&
                    active !== document.body &&
                    active !== document.documentElement;
                if (isValidFocus) {
                    scheduleOverlayUpdate(active, state);
                }
                else if (state.overlay) {
                    log$6.debug('current focus invalidated by mutation, hiding overlay', {
                        hasActive: !!active,
                        isConnected: active?.isConnected,
                        isBody: active === document.body,
                    });
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
            log$6.debug('mutation observer disabled by config');
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
        log$6.debug('mutation observer attached');
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
    const log$5 = createLogger('Deprecation');
    const warnedKeys = new Set();
    function warnOnce(name, replacement) {
        if (warnedKeys.has(name))
            return;
        warnedKeys.add(name);
        log$5.warn(`\`window.${name}\` is deprecated and will be removed in v4. ` +
            `Use \`window.${replacement}\` instead.`);
    }
    /**
     * Define a one-shot warning getter for a legacy window property.
     * Falls back to plain assignment if `defineProperty` is rejected (some
     * embedded browsers do not allow it on `window`).
     */
    function defineLegacyAlias(name, replacement, value) {
        let currentValue = value;
        try {
            Object.defineProperty(window, name, {
                configurable: true,
                enumerable: true,
                get: () => {
                    warnOnce(name, replacement);
                    return currentValue;
                },
                set: (v) => {
                    warnOnce(name, replacement);
                    currentValue = v;
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
    const log$4 = createLogger('Messaging');
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
                    log$4.error('callback error', error);
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
     * Native-messaging app identifiers — the COMPLETE, hard-coded allowlist of
     * GeckoView host applications this extension will exchange native messages
     * with.
     *
     * SECURITY: this set is frozen and compile-time only. It MUST NOT be derived
     * from any page-visible surface. A page-writable `window.spatialNavConfig
     * .nativeAppId` previously let hostile web content reroute all outbound native
     * traffic to an attacker-registered host (fixed in commit d23e1ab); keeping the
     * allowlist in one frozen constant preserves that invariant while still letting
     * the extension run under more than one host. To add support for a new host,
     * append its registered native-messaging app id here and rebuild — nothing at
     * runtime can extend this set.
     *
     * Order matters: it is the probe order used by the background relay and the
     * content-script fallback. The first host that answers is locked in for the
     * remainder of the session (only one host is registered on any given device,
     * so the others reject without delivering the message).
     */
    const NATIVE_APP_IDS = Object.freeze(['flutter_geckoview', 'react-native-geckoview']);

    /**
     * Native-host sender: selects which GeckoView host to talk to from the
     * hard-coded {@link NATIVE_APP_IDS} allowlist, with probe-and-lock.
     *
     * Used by both the background relay and the content-script `sendNativeMessage`
     * fallback so the host-selection policy lives in exactly one place.
     *
     * SECURITY: candidate app ids come only from the compile-time allowlist — never
     * from page-controlled input (see messaging/native-app-ids.ts). The probe sends
     * the real message; because only one host is registered on a given device, the
     * others reject WITHOUT delivering, so probing cannot leak a message to an
     * unintended host.
     */
    /**
     * Create a stateful native sender. The returned function probes the allowlist
     * in order on first use and locks onto the first host whose promise resolves;
     * subsequent calls reuse the locked host.
     *
     * Failure semantics mirror the raw primitive:
     *  - A SYNCHRONOUS throw from the first/locked attempt propagates synchronously
     *    (a broken API is fatal — we do not probe past it).
     *  - An ASYNCHRONOUS rejection means "this host isn't registered" and advances
     *    to the next candidate.
     *
     * @param appIds - candidate ids in probe order (defaults to the full allowlist;
     *                 overridable only for tests).
     */
    function createNativeSender(appIds = NATIVE_APP_IDS) {
        let resolvedAppId = null;
        let probe = null;
        return function sendToNative(sendNative, message) {
            // Host already locked — reuse it directly.
            if (resolvedAppId !== null) {
                return sendNative(resolvedAppId, message);
            }
            // A probe is already in flight: wait for the lock, then send our OWN
            // message to the chosen host. Do not start a second probe.
            if (probe !== null) {
                return probe.then((result) => result.ok ? sendNative(result.appId, message) : Promise.reject(result.error));
            }
            if (appIds.length === 0) {
                return Promise.reject(new Error('createNativeSender: empty native app id allowlist'));
            }
            // We are the first caller: probe the allowlist with our message. The
            // first attempt runs synchronously so a synchronous throw propagates.
            let chain = sendNative(appIds[0], message).then((response) => {
                resolvedAppId = appIds[0];
                return response;
            });
            // Remaining candidates are tried only on async rejection.
            for (let i = 1; i < appIds.length; i++) {
                const appId = appIds[i];
                chain = chain.catch(() => sendNative(appId, message).then((response) => {
                    resolvedAppId = appId;
                    return response;
                }));
            }
            // Publish the lock for any sends that arrive while this probe runs.
            // `chain` already set `resolvedAppId` before it resolves, so concurrent
            // callers read the locked id; on total failure they get the same error
            // and we reset so the next send re-probes. The onRejected handler also
            // consumes `chain`'s rejection, so the first caller's returned `chain` is
            // the only place the error surfaces (handled by that caller).
            probe = chain.then(() => ({ ok: true, appId: resolvedAppId }), (error) => {
                probe = null;
                return { ok: false, error };
            });
            // The first caller gets the probe's own response (and a synchronous
            // throw above already propagated before `probe` was assigned).
            return chain;
        };
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
    const log$3 = createLogger('Messaging');
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
    const PORT_NAME = 'spatial-nav-content';
    /**
     * Runtime type guard for messages arriving on the native port. The native host
     * is trusted, so this is defense-in-depth: a malformed payload (missing or
     * non-string `type`) is dropped at the boundary instead of being cast and
     * dispatched downstream.
     */
    function isInboundMessage(message) {
        return (typeof message === 'object' &&
            message !== null &&
            typeof message.type === 'string');
    }
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
        constructor() {
            super();
            this.id = 'geckoview';
            this.name = 'GeckoView WebExtension';
            this.port = null;
            this.messageQueue = [];
            this.reconnectAttempts = 0;
            this.reconnectTimer = null;
            /** Probe-and-lock sender over the hard-coded native-app-id allowlist. */
            this.sendToNative = createNativeSender();
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
                        if (!isInboundMessage(message)) {
                            log$3.warn('dropping malformed inbound message');
                            return;
                        }
                        this.handleMessage(message);
                    });
                    this.port.onDisconnect.addListener(() => {
                        this.handleDisconnect();
                    });
                    this.setState('connected');
                    this.reconnectAttempts = 0;
                    this.flushQueue();
                    log$3.debug('connected to background script');
                }
                else {
                    // No persistent connection — `sendNativeMessage` only.
                    this.setState('connected');
                    log$3.debug('using sendNativeMessage mode (no persistent connection)');
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
            log$3.debug('disconnected');
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
                    log$3.warn('port send failed, falling back', error);
                    this.port = null;
                }
            }
            // Fallback to sendNativeMessage, selecting the host from the hard-coded
            // NATIVE_APP_IDS allowlist via probe-and-lock (never page-controlled).
            //
            // `sendToNative` is promise-returning, so a synchronous try/catch only
            // catches launch-path errors (e.g. the API throws synchronously). The
            // async failure case (native host not installed, runtime rejects the
            // message) lands as a promise rejection — we attach `.catch` so the
            // message gets queued for retry and we never leak an unhandled rejection.
            const b = getBrowser();
            const runtime = b?.runtime;
            if (runtime?.sendNativeMessage) {
                // Bound closure preserves `this === runtime` for the native call.
                const sendNative = (appId, msg) => runtime.sendNativeMessage(appId, msg);
                try {
                    this.sendToNative(sendNative, fullMessage).catch((err) => {
                        log$3.warn('sendNativeMessage rejected, requeueing', err);
                        this.queueMessage(fullMessage);
                    });
                    return true;
                }
                catch (err) {
                    log$3.warn('sendNativeMessage threw, requeueing', err);
                    this.queueMessage(fullMessage);
                    return false;
                }
            }
            // Not connected — queue.
            this.queueMessage(fullMessage);
            return false;
        }
        handleMessage(message) {
            log$3.debug('message received', message?.type);
            this.dispatchMessage(message);
        }
        handleDisconnect() {
            log$3.debug('port disconnected');
            this.port = null;
            this.setState('disconnected');
            if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
                log$3.warn(`max reconnect attempts (${MAX_RECONNECT_ATTEMPTS}) reached — giving up`);
                return;
            }
            this.reconnectAttempts++;
            // Exponential backoff capped at MAX_RECONNECT_DELAY_MS.
            const exponentialDelay = INITIAL_RECONNECT_DELAY_MS * Math.pow(2, this.reconnectAttempts - 1);
            const cappedDelay = Math.min(exponentialDelay, MAX_RECONNECT_DELAY_MS);
            log$3.debug(`reconnect attempt ${this.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS} in ${cappedDelay}ms`);
            this.reconnectTimer = setTimeout(() => {
                this.reconnectTimer = null;
                this.connect().catch((error) => {
                    log$3.warn('reconnect failed', error);
                });
            }, cappedDelay);
        }
        queueMessage(message) {
            this.messageQueue.push(message);
            if (this.messageQueue.length > MAX_QUEUE_SIZE) {
                const dropped = this.messageQueue.shift();
                log$3.debug('queue full, dropped oldest message', dropped?.type);
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
    const log$2 = createLogger('Messaging');
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
                log$2.info('noop adapter connected (no-op mode)');
            }
        }
        disconnect() {
            this.setState('disconnected');
            if (this._verbose) {
                log$2.info('noop adapter disconnected');
            }
        }
        send(message) {
            if (this._verbose) {
                log$2.debug('noop adapter message dropped', message.type);
            }
            return true;
        }
    }

    /**
     * Input modality watcher — pointer/touch detection.
     *
     * Owned by the extension as of v3.1. Listens for real
     * `pointerdown` / `touchstart` events on `document` (capture phase, passive)
     * and reports `inputModalityChange: touch` to the native host whenever the
     * extension's locally-tracked `state.lastReportedModality` is currently
     * `hardware-nav` — i.e. when the user has been using the D-pad or arrow keys
     * and now switches back to touch.
     *
     * Filter: `event.isTrusted === false` returns early so synthetic events
     * dispatched by `dispatchFullPointerSequence` in `navigation/handlers.ts`
     * (the Enter/Space → simulated-click sequence) don't flip modality back to
     * touch every time the user activates an element with the D-pad. The browser
     * engine sets `isTrusted` itself; page JS cannot spoof it from a content
     * script's vantage.
     *
     * Back-compat: in addition to the proper `inputModalityChange` outbound
     * message, the watcher writes the legacy `flutter-modality-control:touch`
     * title-channel postback so wrappers older than the plugin-side handler can
     * still consume the signal. The title is restored on the next tick. Slated
     * for removal one extension release after all consuming apps have a Dart
     * handler for `inputModalityChange`.
     */
    const log$1 = createLogger('Main');
    /**
     * Title-prefix used to postback modality changes via `document.title`.
     *
     * Keep in lockstep with `_controlTitlePrefix` in
     * `flutter-geckoview-apps/packages/browse_core/lib/src/focus/focus_style_manager.dart`.
     */
    const MODALITY_TITLE_PREFIX = 'flutter-modality-control:';
    /**
     * Default postback implementation: emits via `postToNative` AND writes the
     * back-compat title channel. `main.ts` builds this around its module-scoped
     * messaging adapter.
     */
    function buildDefaultModalityPostback(postToNative, documentRef = typeof document !== 'undefined' ? document : undefined) {
        return (modality) => {
            postToNative({ type: 'inputModalityChange', modality });
            if (!documentRef)
                return;
            try {
                const prev = documentRef.title;
                documentRef.title = `${MODALITY_TITLE_PREFIX}${modality}`;
                setTimeout(() => {
                    try {
                        documentRef.title = prev;
                    }
                    catch {
                        // ignore title-write failures on detached docs
                    }
                }, 0);
            }
            catch {
                // Title write blocked (e.g., sandboxed iframe).
            }
        };
    }
    /**
     * Install the `pointerdown` / `touchstart` watcher on `document`.
     *
     * Idempotent: subsequent calls against the same document are no-ops (guarded
     * by `window.__spatnavModalityWatcherAttached`). Callers re-clear the marker
     * before re-invocation when a BFCache restore swaps the document.
     *
     * @returns `true` if the watcher was newly attached, `false` if a prior
     *   install was detected (no-op).
     */
    function setupInputModalityWatcher$1(state, postback, options = {}) {
        const win = (options.windowRef ?? (typeof window !== 'undefined' ? window : undefined));
        const doc = options.documentRef ?? (typeof document !== 'undefined' ? document : undefined);
        if (!doc || !win)
            return false;
        if (win.__spatnavModalityWatcherAttached === true)
            return false;
        win.__spatnavModalityWatcherAttached = true;
        const handlePointer = (e) => {
            // Synthetic events from `dispatchEvent` are stamped `isTrusted:
            // false` by the engine — including the click-activation sequence in
            // `handlers.ts:dispatchFullPointerSequence`. Page JS cannot spoof
            // this from a content-script's vantage. We deliberately do NOT
            // rewrite the synthetic events' `pointerType` because page-side
            // tap handlers inspect it to recognise a touch activation.
            if (e.isTrusted === false)
                return;
            if (state.lastReportedModality === 'touch')
                return;
            state.lastReportedModality = 'touch';
            // Belt-and-braces: hide ring + preview chevrons directly via the
            // extension's own DOM manipulation. The wrapper-side shadow-DOM
            // `:host { opacity: 0 }` gate normally handles this — but the
            // wrapper's runJavaScript is async (queued on the platform
            // channel) and there's a window where:
            //   - YouTube / similar SPA fires a `pageshow` or re-init event
            //   - Extension calls `ensureOverlay` → removes old host, creates
            //     fresh host (no wrapper marker style, no `data-modality`)
            //   - User touches before the wrapper's next `_writeHostAttributes`
            //     lands
            // During that race, the extension's `showOverlay(null)` path
            // removes the ring's `.visible` class (ring hides via extension
            // CSS) but the chevrons keep their `.show` class — visible. The
            // synchronous hide here closes that gap regardless of wrapper
            // timing. Idempotent: both helpers no-op when their targets are
            // already hidden.
            hideOverlay(state);
            hidePreviewElements(state);
            postback('touch');
        };
        doc.addEventListener('pointerdown', handlePointer, { passive: true, capture: true });
        doc.addEventListener('touchstart', handlePointer, { passive: true, capture: true });
        log$1.debug('input modality watcher installed');
        return true;
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
    const VERSION = '3.2.0';
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
            ? new GeckoViewMessagingAdapter()
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
     * Install the in-page pointer/touch watcher around the active messaging
     * adapter. Delegates to `core/modality_watcher.ts` so the watcher's
     * filtering + back-compat title-channel logic is testable in isolation.
     */
    function setupInputModalityWatcher(state) {
        setupInputModalityWatcher$1(state, buildDefaultModalityPostback((msg) => {
            postToNative(msg);
        }));
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
                // Bounded lazy scan (page-callable API): cap elements visited and
                // matches collected so a pathological subtree can't force a full
                // materialization here either.
                const all = [];
                walkElementsBounded(this, { nodes: MAX_SCAN_NODES }, (el) => {
                    if (all.length < MAX_FOCUSABLE_NODES && el.matches(selector))
                        all.push(el);
                });
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
        // Re-stamp the handler-id on the new documentElement. The window-level
        // keydown listener captured the original handlerId in closure and short-
        // circuits when the DOM attribute disagrees — without this restamp the
        // listener would silently drop every keystroke after a document swap.
        document.documentElement.setAttribute(HANDLER_ID_ATTR, String(state.handlerId));
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
        // BFCache restore swaps the document — `document.addEventListener`
        // listeners attached to the old document are gone. Clear the install
        // marker so `setupInputModalityWatcher` re-attaches against the fresh
        // document.
        window.__spatnavModalityWatcherAttached = false;
        setupInputModalityWatcher(state);
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
        // 11. Initialize debug API — gated on build-time DEBUG so the production
        // bundle does not expose `window.spatialNavDebug` (page-callable navigation
        // control) or write focused-element descriptions into `document.title`.
        // Terser dead-code-eliminates the whole call in release builds. Mirrors the
        // `isDebugActive()` gate in core/overlay.ts.
        {
            initDebugApi(state);
        }
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
            // [diag] Every set of `overlaySuppressed=true` happens here OR
            // in movement.ts's default-exit branch. If the user-reported
            // "ring vanishes after viewport shift" log trail crosses this
            // function, the boundary-exit fall-through fired (no scroll
            // room, or boundaryScrollBehavior !== 'scroll').
            // Promoted to log.warn (from log.info) so the prod bundle keeps
            // this diagnostic — it`s the smoking-gun signal for "ring vanished
            // / HUD reads suppressed" investigations, but the prod bundle
            // strips console.log/info/debug.
            log.warn(`suppressOverlay(reason=${reason}) scrollY=${window.scrollY} active=${document.activeElement?.tagName?.toLowerCase() ?? '(null)'}`);
            state.overlaySuppressed = true;
            if (state.updateTimer) {
                cancelAnimationFrame(state.updateTimer);
                state.updateTimer = null;
            }
            hideOverlay(state);
            hidePreviewElements(state);
            log.debug(`overlay suppressed (${reason})`);
            // Cancel any pending recovery — the new suppression supersedes.
            if (state.suppressRecoveryTimer != null) {
                clearTimeout(state.suppressRecoveryTimer);
                state.suppressRecoveryTimer = null;
            }
            // Auto-recover for `spatialNavigationExit` only. The other two
            // sources (`window.blur`, `document.hidden`) reflect a genuine
            // exit from the document and should remain suppressed until the
            // host explicitly re-shows or the page becomes visible again.
            //
            // `spatialNavigationExit` fires on internal boundary attempts
            // (no target in DOM in this direction). The user's focus is
            // still on the element they were trying to navigate from — and
            // crucially, the wrapper may have scrolled the page in response
            // to expose more content. After the scroll settles, if focus
            // is still on a real focusable element, the overlay should
            // re-appear: the user is still in the document, not in native
            // UI.
            if (reason !== 'spatialNavigationExit')
                return;
            state.suppressRecoveryTimer = setTimeout(() => {
                state.suppressRecoveryTimer = null;
                // Someone else already cleared suppression (e.g., a
                // subsequent moveInDirection succeeded). Nothing to do.
                if (!state.overlaySuppressed)
                    return;
                const active = document.activeElement;
                // Body / documentElement / null means focus is no longer on
                // a real focusable — focus genuinely left to native UI
                // (e.g., browser chrome). Keep suppressed.
                if (!active || active === document.body || active === document.documentElement) {
                    return;
                }
                if (!(active instanceof HTMLElement))
                    return;
                state.overlaySuppressed = false;
                // [diag] Auto-recover from spatialNavigationExit: 350ms
                // after the suppression, re-show the ring on the active
                // element if it's still a real focusable.
                log.info('suppressOverlay auto-recover firing', {
                    activeTag: active.tagName.toLowerCase(),
                });
                showOverlay(active, state);
                log.debug('overlay auto-recovered after spatialNavigationExit settle');
            }, 350);
        };
        // 16. Install the input-modality watcher (`pointerdown` + `touchstart`).
        //     Reports touch transitions to the native host so consumer wrappers
        //     can hide their focus ring. The wrapper's previous
        //     `runJavaScript`-based install is now redundant.
        setupInputModalityWatcher(state);
        // 17. Hide overlay when focus leaves the document (e.g., returning to address bar)
        window.addEventListener('blur', () => suppressOverlay('window.blur'));
        document.addEventListener('visibilitychange', () => {
            if (document.hidden)
                suppressOverlay('document.hidden');
        });
        // Hide overlay when spatial navigation exits to native UI. Auto-recovers
        // 350ms later if focus is still on a real focusable element — the
        // boundary case where the user pressed a directional key, no target
        // was found, the wrapper scrolled the page, and focus stayed on the
        // previously-focused element.
        document.addEventListener('spatialNavigationExit', () => suppressOverlay('spatialNavigationExit'));
        // Cross-world bridge for the wrapper's `engage-on-transition` hook.
        //
        // The WebExtension content script runs in an isolated JS world —
        // the host's `runJavaScript` (page main world) can't read
        // `window.spatialNavState` or call `window.showSpatialNavOverlay`.
        // They share the same `document`, though, so a CustomEvent fired
        // from the host on `document` IS received here.
        //
        // The host fires this on a touch → hardwareNav transition when the
        // first-press-swallow flag is armed. Without it, the first press
        // from a state where the WebView has no DOM-focused element (cold
        // boot / fresh page / address-bar → WebView focus traversal) flips
        // modality + sets data-ring=visible but the actual
        // #spatnav-focus-overlay element stays display:none. The user
        // would see no ring on the first press and would need to press
        // again to trigger a key dispatch + recovery.
        //
        // Semantics:
        //   - If a real focusable is already DOM-focused: show the ring on
        //     it (preserves "tap a link, press Down, see ring on tapped
        //     element" UX).
        //   - Otherwise: focus the FIRST focusable. The window-level
        //     `focus` capture-listener in `attachHandlers` picks up the
        //     event and triggers `scheduleOverlayUpdate` → `showOverlay`,
        //     putting the ring on the first element.
        // `spatnav-clear-suppress` — lightweight bridge fired by the host on
        // EVERY `notifyHardwareNavActivity` (touch → hardwareNav AND
        // hardwareNav → hardwareNav). Just clears stale `overlaySuppressed`
        // without trampling focus. Needed because `engage-overlay` only fires
        // on the touch → hardwareNav transition (to avoid refocusing the
        // first focusable when the user is mid-navigation), but a prior
        // `window.blur` (host address bar got focus) sets `suppressed = true`
        // and never auto-recovers. If the user comes back to the WebView via
        // D-pad while modality was already hardwareNav, engage doesn`t fire,
        // suppress stays true, the HUD shows "suppressed", and the next
        // `scheduleOverlayUpdate` is silently early-returned.
        document.addEventListener('spatnav-clear-suppress', () => {
            if (state.overlaySuppressed) {
                // log.warn (preserved in prod) — the load-bearing transition
                // when the user returns to the WebView after a `window.blur`
                // (Flutter focus left the WebView temporarily).
                log.warn('spatnav-clear-suppress: clearing stale overlaySuppressed');
                clearOverlaySuppression(state);
            }
            // Re-paint the overlay AND directional chevrons on the current
            // focused focusable, if any. Without this, the `wasTouch=false`
            // path of `notifyHardwareNavActivity` (e.g., user returns to
            // WebView while modality was already hardwareNav) writes
            // `data-ring=visible` on the host but the inner
            // `#spatnav-focus-overlay` stays at `opacity: 0` (no `.visible`
            // class) — host visible, ring invisible. Also: chevron previews
            // are rendered via `updatePreviewVisuals` from the focus
            // capture-listener`s scheduleOverlayUpdate path, which is gated
            // on `state.overlaySuppressed` and silently early-returns when
            // suppress was true at the time of the focus event. After we
            // clear suppress here, we must explicitly call
            // `updatePreviewVisuals` ourselves — otherwise the ring renders
            // but the up/down/left/right chevrons stay invisible (matches
            // the user-reported "DART logo focus ring doesn`t have any
            // arrows" after UP-then-DOWN sequence).
            try {
                const active = document.activeElement;
                if (active &&
                    active !== document.body &&
                    active !== document.documentElement &&
                    active instanceof HTMLElement) {
                    const list = state.focusableElements;
                    if (Array.isArray(list) && list.indexOf(active) !== -1) {
                        showOverlay(active, state);
                        updatePreviewVisuals(active, null, findDirectionalCandidate, directionByName, describeElement, state);
                    }
                }
            }
            catch (e) {
                log.warn('spatnav-clear-suppress re-paint error', e);
            }
        });
        document.addEventListener('spatnav-engage-overlay', () => {
            try {
                if (state.overlaySuppressed) {
                    // log.warn (preserved in prod) — load-bearing recovery from
                    // a stale window.blur/document.hidden suppression.
                    log.warn('engage-overlay: clearing stale overlaySuppressed');
                    clearOverlaySuppression(state);
                }
                const active = document.activeElement;
                const focusables = state.focusableElements;
                if (!Array.isArray(focusables) || focusables.length === 0) {
                    refreshFocusables(state);
                }
                const list = state.focusableElements;
                if (!Array.isArray(list) || list.length === 0) {
                    log.debug('engage-overlay: no focusables to engage');
                    return;
                }
                const activeIsFocusable = !!active &&
                    active !== document.body &&
                    active !== document.documentElement &&
                    list.indexOf(active) !== -1;
                if (activeIsFocusable) {
                    log.info(`engage-overlay: show on active ${describeElement(active)}`);
                    showOverlay(active, state);
                    // Mirror `spatnav-clear-suppress`: render the chevrons
                    // for the current focusable. The `focusInitialElement`
                    // path below relies on the focus event firing
                    // `scheduleOverlayUpdate`, which calls
                    // `updatePreviewVisuals` itself — but the direct
                    // `showOverlay(active)` path above (activeIsFocusable)
                    // does NOT, so the chevrons would be missing for
                    // exactly the same reason as the clear-suppress race.
                    updatePreviewVisuals(active, null, findDirectionalCandidate, directionByName, describeElement, state);
                }
                else {
                    log.info('engage-overlay: focus first focusable');
                    focusInitialElement(true, state);
                }
            }
            catch (e) {
                log.warn('engage-overlay handler error', e);
            }
        });
        // 18. Re-initialize on page navigation
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
    // Gate auto-init so integration tests can import this module without side effects.
    if (!globalThis.__SPATNAV_NO_AUTO_INIT__) {
        initSpatialNavigation();
    }

    exports.initSpatialNavigation = initSpatialNavigation;

    return exports;

})({});
//# sourceMappingURL=spatial_navigation.debug.js.map
