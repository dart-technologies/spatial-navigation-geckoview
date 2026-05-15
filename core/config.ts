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

import { createLogger } from '../utils/logger';

const log = createLogger('Config');

// =============================================================================
// Types
// =============================================================================

export type ScoringMode = 'geometric' | 'grid';
export type DistanceFunction = 'euclidean' | 'manhattan' | 'projected';
export type RefocusStrategy = 'closest' | 'first';
export type BoundaryBehavior = 'wrap' | 'stop' | 'exit';
export type FocusMethod = 'element' | 'contentWindow';
export type DirectionName = 'up' | 'down' | 'left' | 'right';
export type DirectionAxis = 'x' | 'y';
export type OverlayTheme = 'default' | 'high-contrast';
export type PresetName = 'tv' | 'phone' | 'tablet' | 'kiosk';

export interface Direction {
    axis: DirectionAxis;
    sign: 1 | -1;
    name: DirectionName;
}

export type DirectionMap = Record<DirectionName, Direction>;

export interface IframeSupportConfig {
    enabled: boolean;
    selector: string;
    focusMethod: FocusMethod;
}

export interface FocusGroupsConfig {
    enabled: boolean;
    defaultRules: Record<string, unknown>;
    boundaryBehavior: BoundaryBehavior;
}

/**
 * Controls when the focus ring (and the rest of the shadow subtree —
 * preview chevrons, label, debug HUD) is visible.
 *
 * - `always`: legacy default. The overlay is visible whenever the
 *   extension renders it. Suitable for kiosks / fixed hardware-nav
 *   devices that never receive touch input.
 * - `hardware-nav-only`: the host writes `data-modality` / `data-ring`
 *   attributes on the shadow host (`#spatnav-focus-host`); the overlay
 *   is hidden unless modality is `hardware-nav` AND ring is `visible`.
 *   This is the right default for any host that wants touch-aware
 *   focus rings (browser-style apps).
 */
export type OverlayVisibilityMode = 'always' | 'hardware-nav-only';

/**
 * Behaviour when a directional press reaches a boundary (no in-DOM
 * focusable target in that direction).
 *
 * - `exit`: legacy default. Dispatch `spatialNavigationExit` on
 *   `document` and post `focusExit` to the native host. The host
 *   decides what to do (e.g. forward focus to a Flutter widget).
 * - `scroll`: scroll the page by half a viewport in the direction
 *   (only vertical — horizontal page scroll is rare and would feel
 *   wrong). Then suppress the exit notification. After the scroll
 *   settles, the user's next press has new focusables to land on.
 * - `none`: silent. No exit dispatch, no scroll. Suitable for hosts
 *   that handle boundary recovery themselves.
 */
export type BoundaryScrollBehavior = 'exit' | 'scroll' | 'none';

export interface SpatialNavConfig {
    // Visual styling
    color: string;
    outlineWidth: number;
    outlineOffset: number;
    overlayZIndex: number;
    arrowScale: number;
    disabledColor: string;
    overlayTheme: OverlayTheme;
    safeAreaMargin: number;
    overlayScrimOpacity: number;
    overlayGlowOpacity: number;
    overlayGlowBlur: number;
    /**
     * Opacity of the inset 1px highlight rendered inside the focus
     * outline (`--sn-inner-glow-alpha`). Set to `0` to drop the inset
     * highlight entirely — useful for hosts that want a pure outline
     * without decorative chrome.
     *
     * Range `[0, 1]`, default `0.16`.
     */
    overlayInnerGlowOpacity: number;
    /**
     * Controls when the focus ring + previews are rendered. See
     * [OverlayVisibilityMode]. Default `always` for back-compat;
     * touch-aware hosts (browsers) should set `hardware-nav-only`.
     */
    visibilityMode: OverlayVisibilityMode;
    /**
     * Enable the legacy `.pulse` keyframe animation on the focus ring
     * (a small expanding box-shadow ripple). Default `false` — the
     * animation hardcoded amber `rgba(255, 193, 7, …)` from the
     * pre-WCAG-migration era and clashes with the Material Blue 800
     * default focus colour. Enable only if your config sets a custom
     * `color` AND you want the pulse.
     */
    enableFocusPulse: boolean;
    /**
     * Behaviour when a directional press reaches a boundary. See
     * [BoundaryScrollBehavior]. Defaults to `'scroll'` as of v3.1.0 so a
     * directional press at the viewport edge of a long page scrolls into
     * view instead of dropping the keystroke; set `'exit'` to keep the
     * legacy 3.0.x focus-exit-on-boundary behaviour.
     */
    boundaryScrollBehavior: BoundaryScrollBehavior;

    // Dynamic content observation
    observeMutations: boolean;
    observeScroll: boolean;
    mutationDebounce: number;
    scrollThreshold: number;

    // Intersection observer
    observeIntersection: boolean;
    intersectionRootMargin: string;
    intersectionThreshold: number;

    // Recovery / refocus
    autoRefocus: boolean;
    refocusStrategy: RefocusStrategy;

    // iframe handling
    iframeSupport: IframeSupportConfig;
    focusGroups: FocusGroupsConfig;

    // Shadow DOM
    traverseShadowDom: boolean;

    // Virtual scroll
    observeVirtualContainers: boolean;
    virtualContainerSelectors: string[];
    virtualScrollDebounce: number;

    // Accessibility
    enableAria: boolean;
    announceNavigation: boolean;
    announceBoundaries: boolean;
    verboseDescriptions: boolean;

    // Focus trap detection
    focusTrapDetection: boolean;

    // Framework-aware refresh
    frameworkAwareRefresh: boolean;

    // Candidate pre-computation
    precomputeCandidates: boolean;
    precomputeCacheTimeout: number;

    // Scoring
    scoringMode: ScoringMode;
    distanceFunction: DistanceFunction;
    overlapThreshold: number;
    gridAlignmentTolerance: number;
    wrapNavigation: boolean;
    useCSSProperties: boolean;

    // Element filtering
    minElementSize: number;
}

export type PartialSpatialNavConfig = Partial<SpatialNavConfig> & {
    iframeSupport?: Partial<IframeSupportConfig>;
    focusGroups?: Partial<FocusGroupsConfig>;
};

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
export const SCORING_CONSTANTS = {
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
} as const;

// =============================================================================
// Defaults + accessors
// =============================================================================

declare global {
    interface Window {
        spatialNavConfig?: PartialSpatialNavConfig;
        flutterSpatialNavConfig?: PartialSpatialNavConfig;
    }
}

const globalScope: typeof globalThis & {
    spatialNavConfig?: PartialSpatialNavConfig;
    flutterSpatialNavConfig?: PartialSpatialNavConfig;
} = typeof window !== 'undefined' ? window : globalThis;

/**
 * Default focus indicator color.
 *
 * `#1565C0` — blue 800 — gives ~5.4:1 contrast against white and ~3.2:1
 * against black, both clearing the WCAG 2.1 non-text contrast minimum (3:1).
 * The previous default of `#FFC107` (amber) only achieved ~1.6:1 on white.
 */
export const DEFAULT_FOCUS_COLOR = '#1565C0';

/**
 * Clamp a validated-finite numeric config value into an allowed range,
 * falling back to the default when the user didn't supply one.
 *
 * Used to bound visual-layer values so a malicious page setting e.g.
 * `overlayZIndex: -1` (hides overlay behind page content) or
 * `arrowScale: 1e6` (paint-thread DoS via gigantic borders) cannot
 * produce pathological output.
 */
function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
    return Math.min(Math.max(value, min), max);
}

/**
 * Get the current spatial navigation configuration.
 * Merges user-provided config with defaults.
 */
export function getConfig(): SpatialNavConfig {
    const rawUserConfig = globalScope.spatialNavConfig || globalScope.flutterSpatialNavConfig || {};
    const userConfig = validateUserConfig(rawUserConfig as Record<string, unknown>);

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
        boundaryScrollBehavior:
            userConfig.boundaryScrollBehavior === 'exit'
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
        intersectionThreshold:
            typeof userConfig.intersectionThreshold === 'number'
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
        gridAlignmentTolerance:
            typeof userConfig.gridAlignmentTolerance === 'number' ? userConfig.gridAlignmentTolerance : 20,

        // Wrap navigation
        wrapNavigation: userConfig.wrapNavigation === true,

        // CSS custom property integration
        useCSSProperties: userConfig.useCSSProperties !== false,

        // Element filtering
        minElementSize: typeof userConfig.minElementSize === 'number' ? userConfig.minElementSize : 1,
    };
}

/**
 * Update configuration at runtime.
 *
 * Validates the input first; invalid keys are dropped (with a warning) rather
 * than silently corrupting state.
 */
export function updateConfig(newConfig: PartialSpatialNavConfig): void {
    const validated = validateUserConfig(newConfig as Record<string, unknown>);
    const existing = globalScope.spatialNavConfig || globalScope.flutterSpatialNavConfig || {};
    const merged = { ...existing, ...validated };
    globalScope.spatialNavConfig = merged;
    globalScope.flutterSpatialNavConfig = merged;
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
const ENUM_KEYS: Record<string, ReadonlySet<string>> = Object.assign(
    Object.create(null) as Record<string, ReadonlySet<string>>,
    {
        overlayTheme: new Set(['default', 'high-contrast']),
        refocusStrategy: new Set(['closest', 'first']),
        scoringMode: new Set(['geometric', 'grid']),
        distanceFunction: new Set(['euclidean', 'manhattan', 'projected']),
        visibilityMode: new Set(['always', 'hardware-nav-only']),
        boundaryScrollBehavior: new Set(['exit', 'scroll', 'none']),
    }
);
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
const NUMBER_RANGES: Record<string, { min: number; max: number }> = Object.assign(
    Object.create(null) as Record<string, { min: number; max: number }>,
    {
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
        mutationDebounce: { min: 0, max: 5_000 },
        scrollThreshold: { min: 0, max: 1_000 },
        virtualScrollDebounce: { min: 0, max: 5_000 },
        precomputeCacheTimeout: { min: 0, max: 60_000 },
        intersectionThreshold: { min: 0, max: 1 },
        // Scoring thresholds (geometric — capped at 4096px which is well above
        // any plausible viewport edge)
        overlapThreshold: { min: 0, max: 4_096 },
        gridAlignmentTolerance: { min: 0, max: 4_096 },
        minElementSize: { min: 0, max: 4_096 },
    }
);

/**
 * Per-key schemas for nested-object config values. Each validator strips
 * unknown fields and clamps each known field to its declared type/enum.
 *
 * Without this, a page could ship e.g.
 * `{ iframeSupport: { __proto__: { polluted: true } } }` and the un-checked
 * object would land verbatim in `state.config`. The shallow object-shape
 * check in OBJECT_KEYS handling is not enough.
 */
const NESTED_VALIDATORS: Record<string, (raw: Record<string, unknown>) => Record<string, unknown>> =
    Object.assign(Object.create(null) as Record<string, never>, {
        iframeSupport: (raw: Record<string, unknown>) => {
            const allowedFocusMethods = new Set(['element', 'contentWindow']);
            const cleaned: Record<string, unknown> = {};
            if (typeof raw.enabled === 'boolean') cleaned.enabled = raw.enabled;
            if (typeof raw.selector === 'string' && raw.selector.length <= ARRAY_ITEM_MAX_LENGTH) {
                cleaned.selector = raw.selector;
            }
            if (typeof raw.focusMethod === 'string' && allowedFocusMethods.has(raw.focusMethod)) {
                cleaned.focusMethod = raw.focusMethod;
            }
            return cleaned;
        },
        focusGroups: (raw: Record<string, unknown>) => {
            const allowedBoundary = new Set(['wrap', 'stop', 'exit']);
            const cleaned: Record<string, unknown> = {};
            if (typeof raw.enabled === 'boolean') cleaned.enabled = raw.enabled;
            if (typeof raw.boundaryBehavior === 'string' && allowedBoundary.has(raw.boundaryBehavior)) {
                cleaned.boundaryBehavior = raw.boundaryBehavior;
            }
            // defaultRules is a freeform map; pass through only if it's a
            // plain object (no Array, no null), without touching keys.
            if (
                raw.defaultRules &&
                typeof raw.defaultRules === 'object' &&
                !Array.isArray(raw.defaultRules)
            ) {
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
export function validateUserConfig(input: unknown): PartialSpatialNavConfig {
    const out: PartialSpatialNavConfig = {};
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        return out;
    }

    const obj = input as Record<string, unknown>;
    for (const key of Object.keys(obj)) {
        const value = obj[key];

        if (STRING_KEYS.has(key)) {
            if (typeof value === 'string') {
                (out as Record<string, unknown>)[key] = value;
            } else {
                log.warn(`config.${key}: expected string, got ${typeof value} — ignored`);
            }
            continue;
        }

        if (NUMBER_KEYS.has(key)) {
            if (typeof value === 'number' && Number.isFinite(value)) {
                const range = NUMBER_RANGES[key];
                (out as Record<string, unknown>)[key] = range
                    ? Math.min(Math.max(value, range.min), range.max)
                    : value;
            } else {
                log.warn(`config.${key}: expected finite number, got ${typeof value} — ignored`);
            }
            continue;
        }

        if (BOOLEAN_KEYS.has(key)) {
            if (typeof value === 'boolean') {
                (out as Record<string, unknown>)[key] = value;
            } else {
                log.warn(`config.${key}: expected boolean, got ${typeof value} — ignored`);
            }
            continue;
        }

        if (key in ENUM_KEYS) {
            if (typeof value === 'string' && ENUM_KEYS[key].has(value)) {
                (out as Record<string, unknown>)[key] = value;
            } else {
                const allowed = Array.from(ENUM_KEYS[key]).join(', ');
                log.warn(
                    `config.${key}: must be one of [${allowed}] — got ${JSON.stringify(value)}, ignored`
                );
            }
            continue;
        }

        if (ARRAY_KEYS.has(key)) {
            if (Array.isArray(value) && value.every((v) => typeof v === 'string')) {
                // Cap the array to prevent a malicious page from shipping a
                // thousand CSS selectors that get re-run on every mutation;
                // and cap each selector length to prevent catastrophic regex
                // / complex-selector perf attacks via querySelectorAll.
                const capped = (value as string[])
                    .slice(0, ARRAY_MAX_ITEMS)
                    .filter((s) => s.length <= ARRAY_ITEM_MAX_LENGTH);
                if (capped.length !== value.length) {
                    log.warn(
                        `config.${key}: truncated from ${value.length} to ${capped.length} items (caps: ${ARRAY_MAX_ITEMS} items, ${ARRAY_ITEM_MAX_LENGTH} chars each)`
                    );
                }
                (out as Record<string, unknown>)[key] = capped;
            } else {
                log.warn(`config.${key}: expected string[], got ${typeof value} — ignored`);
            }
            continue;
        }

        if (OBJECT_KEYS.has(key)) {
            if (value && typeof value === 'object' && !Array.isArray(value)) {
                const validator = NESTED_VALIDATORS[key];
                (out as Record<string, unknown>)[key] = validator
                    ? validator(value as Record<string, unknown>)
                    : value;
            } else {
                log.warn(`config.${key}: expected object, got ${typeof value} — ignored`);
            }
            continue;
        }

        log.warn(`config.${key}: unknown key — ignored`);
    }

    return out;
}

// =============================================================================
// Presets
// =============================================================================

/**
 * Built-in config presets for common form factors.
 *
 *   tv      — D-pad on Android TV / set-top boxes. Generous overlap, grid mode,
 *             larger overlay; ARIA announcements off (TV remotes don't drive AT).
 *   phone   — Touch-first phone with optional D-pad (e.g., AAOS gear-shift mode).
 *             Strict edges, geometric scoring, smaller overlay.
 *   tablet  — Mid-density tablet; balanced settings.
 *   kiosk   — Locked-down kiosk: wraps at boundaries, ARIA on, no exit events.
 */
export const CONFIG_PRESETS: Record<PresetName, PartialSpatialNavConfig> = {
    tv: {
        scoringMode: 'grid',
        gridAlignmentTolerance: 40,
        overlapThreshold: 8,
        outlineWidth: 4,
        outlineOffset: 4,
        arrowScale: 1.25,
        safeAreaMargin: 24,
        observeVirtualContainers: true,
        focusTrapDetection: true,
    },
    phone: {
        scoringMode: 'geometric',
        gridAlignmentTolerance: 12,
        overlapThreshold: 0,
        outlineWidth: 2,
        outlineOffset: 2,
        arrowScale: 0.85,
        safeAreaMargin: 8,
    },
    tablet: {
        scoringMode: 'geometric',
        gridAlignmentTolerance: 24,
        overlapThreshold: 4,
        outlineWidth: 3,
        outlineOffset: 3,
        arrowScale: 1.0,
        safeAreaMargin: 16,
    },
    kiosk: {
        scoringMode: 'grid',
        gridAlignmentTolerance: 32,
        wrapNavigation: true,
        enableAria: true,
        announceNavigation: true,
        announceBoundaries: true,
        outlineWidth: 4,
        outlineOffset: 4,
        arrowScale: 1.15,
        safeAreaMargin: 20,
    },
} as const;

/**
 * Apply a named preset to the global config slot.
 *
 * Existing user-set values win — the preset only fills in fields the user
 * hasn't already specified. Call before the content script initializes (e.g.,
 * inline before the extension script runs) for the preset to take effect.
 */
export function applyPreset(name: PresetName, overrides: PartialSpatialNavConfig = {}): void {
    const preset = CONFIG_PRESETS[name];
    if (!preset) {
        log.warn(
            `applyPreset: unknown preset "${name}" — must be one of ${Object.keys(CONFIG_PRESETS).join(', ')}`
        );
        return;
    }
    const existing = globalScope.spatialNavConfig || globalScope.flutterSpatialNavConfig || {};
    const merged = { ...preset, ...existing, ...overrides };
    globalScope.spatialNavConfig = merged;
    globalScope.flutterSpatialNavConfig = merged;
    log.info(`applied preset "${name}"`, merged);
}

// =============================================================================
// Direction maps
// =============================================================================

// Null-prototype + frozen lookup tables. A null prototype means that a
// page- or native-host-supplied key like `__proto__` or `constructor`
// yields `undefined` rather than walking up to `Object.prototype` — the
// caller's `if (map[dir])` guard then correctly short-circuits instead of
// silently passing a function object into downstream handlers.
export const directionByKey: Record<string, Direction> = Object.freeze(
    Object.assign(Object.create(null) as Record<string, Direction>, {
        ArrowDown: { axis: 'y', sign: 1, name: 'down' } as Direction,
        ArrowUp: { axis: 'y', sign: -1, name: 'up' } as Direction,
        ArrowRight: { axis: 'x', sign: 1, name: 'right' } as Direction,
        ArrowLeft: { axis: 'x', sign: -1, name: 'left' } as Direction,
    })
);

export const directionByName: DirectionMap = Object.freeze(
    Object.assign(Object.create(null) as DirectionMap, {
        down: directionByKey.ArrowDown,
        up: directionByKey.ArrowUp,
        right: directionByKey.ArrowRight,
        left: directionByKey.ArrowLeft,
    })
);

export const directionKeys: DirectionName[] = ['down', 'up', 'right', 'left'];
