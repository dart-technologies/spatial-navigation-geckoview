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

import type { SpatialNavConfig, DirectionName } from './config';
import type { NavigationCandidate } from './scoring';
// Type-only import — runtime cycle avoided because TypeScript erases this.
import type { FocusGroup as FocusGroupClass } from './focus_group';

// Forward declaration to avoid circular runtime deps with focus_group.ts.
export interface FocusableEntry {
    element: HTMLElement;
    rect: DOMRect | null;
    width: number;
    height: number;
    left: number;
    right: number;
    top: number;
    bottom: number;
    centerX: number;
    centerY: number;
    scrollKey: string | null;
    groupId: string | null;
    index: number;
}

/**
 * Re-exports the canonical FocusGroup class type from focus_group.ts.
 * Kept as a type alias here so state-shape consumers don't need to know
 * about the concrete class location.
 */
export type FocusGroup = FocusGroupClass;

export interface PreviewElement {
    container: HTMLElement;
    arrow: HTMLElement;
}

export interface PreviewElements {
    up: PreviewElement;
    down: PreviewElement;
    left: PreviewElement;
    right: PreviewElement;
}

export interface Instrumentation {
    lastOverlay: string;
    lastActive: string;
    mismatchCount: number;
    overlayIndex: number;
    activeIndex: number;
    lastMismatch: string | null;
    lastUpdate: number;
    lastDirection: string;
}

export interface PerfMetrics {
    refreshCount: number;
    totalRefreshTime: number;
    averageRefreshTime: number;
    lastRefreshTime: number;
    slowRefreshCount: number;
}

export interface RuntimeContext {
    mode: 'webextension' | 'injected';
    hasBrowser: boolean;
    hasChrome: boolean;
    canConnect: boolean;
    canSendMessage: boolean;
}

export interface FocusTrap {
    element: HTMLElement;
    escapeKey: string | null;
    firstFocusable: HTMLElement | null;
    lastFocusable: HTMLElement | null;
}

export interface PrecomputedTargets {
    up: NavigationCandidate | null;
    down: NavigationCandidate | null;
    left: NavigationCandidate | null;
    right: NavigationCandidate | null;
}

/**
 * Position hint for focus recovery during DOM mutations.
 * Stores geometric coordinates of the last focused element to enable
 * position-based recovery when the actual element is recycled/removed.
 */
export interface FocusPositionHint {
    centerX: number;
    centerY: number;
    top: number;
    left: number;
    elementDesc: string; // describeElement() output for logging
    timestamp: number;
}

// Need a loose type for the framework adapter to avoid circular deps
export interface FrameworkAdapter {
    name: string;
    detect: () => boolean | null | undefined | Element;
    scheduleRefresh: (callback: () => void) => void;
}

export interface SpatialNavState {
    // Core navigation state
    config: SpatialNavConfig;
    version: string;
    currentIndex: number;
    initialized: boolean;
    handlersAttached: boolean;
    runtime: RuntimeContext;

    // Focus tracking arrays
    focusables: FocusableEntry[];
    focusableElements: HTMLElement[];
    focusGroups: Record<string, FocusGroup>;
    lastRefreshTime: number;
    focusableCount: number;

    // Preview/animation state
    previewEnabled: boolean;
    previewElements: PreviewElements | null;
    previewLayer: HTMLElement | null;
    overlay: HTMLElement | null;
    overlayHost: HTMLElement | null;
    activeResizeObserver: ResizeObserver | null;
    updateTimer: number | null;
    overlaySuppressed: boolean;
    /**
     * Pending auto-recover timer set by `suppressOverlay('spatialNavigationExit')`.
     * Cleared when (a) a new navigation succeeds, (b) the timer fires and
     * either re-shows or confirms a genuine exit, or (c) a new suppression
     * call overrides it. Lives on state (not as a module-local) so the
     * `clearOverlaySuppression(state)` helper can atomically clear flag +
     * timer from anywhere in the codebase.
     */
    suppressRecoveryTimer: ReturnType<typeof setTimeout> | null;
    nextTargets: Record<DirectionName, NavigationCandidate | null>;
    noTargetTimers: Partial<Record<DirectionName, ReturnType<typeof setTimeout> | null>>;
    lastFocusedElement: HTMLElement | null;
    lastFocusPosition: FocusPositionHint | null; // Position hint for recovery
    lastMove: {
        fromIndex: number;
        toIndex: number;
        direction: string;
        passIndex: number;
        timestamp: number;
    } | null;
    lastBoundary: string | null;

    // Performance caches
    scrollCache: WeakMap<Element, string>;
    scrollListenerAttached: boolean;

    // Observers
    intersectionObserver: IntersectionObserver | null;
    mutationObserver: MutationObserver | null;

    // Debugging/instrumentation
    emitTitleOnMismatch: boolean;
    instrumentation: Instrumentation;

    // Performance monitoring
    perf: PerfMetrics;

    // Virtual scroll / infinite list state
    virtualContainers: HTMLElement[];
    virtualSentinelObserver: IntersectionObserver | null;
    virtualScrollPending: boolean;

    // Candidate pre-computation cache
    precomputedTargets: PrecomputedTargets | null;
    precomputedForIndex: number;
    precomputedTimestamp: number;
    dirty: boolean;

    // Accessibility announcer
    announcer: HTMLElement | null;

    // Focus trap state
    currentTrap: object | null; // Typed loosely to avoid circular dependency loop with movement.ts types

    // Framework detection cache
    detectedFramework: FrameworkAdapter | boolean | null;

    // Handler ID for stale handler detection
    handlerId: number;

    // Last input modality reported to the native host. Touch by default; flips
    // to hardware-nav when the extension's keydown handler sees a real
    // directional/activation key, and flips back to touch when the in-page
    // pointer watcher observes a trusted, non-synthetic `pointerdown` /
    // `touchstart`. Used to throttle `inputModalityChange` outbound messages
    // so we only post on actual transitions, not on every pointer event.
    lastReportedModality: 'touch' | 'hardware-nav';
}

// Extend Window interface
declare global {
    interface Window {
        spatialNavState?: SpatialNavState;
        flutterFocusState?: SpatialNavState;
    }
}

/**
 * Module-scoped state cache. Authoritative source of truth for state
 * re-entry — we deliberately do NOT read `window.spatialNavState` to
 * prevent a malicious page from pre-populating a trust-boundary-crossing
 * global and hijacking the overlay target / focusables.
 */
let cachedState: SpatialNavState | null = null;

/**
 * Initialize or retrieve the global spatial navigation state.
 * State persists across same-document SPA navigations via the module cache.
 */
export function getState(config: SpatialNavConfig): SpatialNavState {
    const state: SpatialNavState = cachedState ?? ({} as SpatialNavState);
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
 * Reset state (useful for testing or page reloads).
 */
export function resetState(): void {
    cachedState = null;
    delete window.spatialNavState;
    delete window.flutterFocusState;
}

/**
 * Export instrumentation data for debugging.
 */
export function getInstrumentation():
    | (Instrumentation & {
          focusablesCount: number;
          currentIndex: number;
          version: string;
      })
    | null {
    const state = cachedState;
    if (!state) return null;

    return {
        ...state.instrumentation,
        focusablesCount: state.focusables.length,
        currentIndex: state.currentIndex,
        version: state.version || '3.2.0',
    };
}
