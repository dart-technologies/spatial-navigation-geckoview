/**
 * Global state management for GeckoView Spatial Navigation System
 *
 * Maintains focus state with persistence across page navigations.
 * State is stored on window.spatialNavState to survive SPA navigations.
 */

import type { SpatialNavConfig, DirectionName } from './config';
import type { NavigationCandidate } from './scoring';

// Forward declarations for types from other modules (to avoid circular deps)
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

export interface FocusGroup {
    id: string;
    members: FocusableEntry[];
    lastFocused: FocusableEntry | null;
    options: {
        boundary: 'exit' | 'contain' | 'wrap' | 'stop';
        enterMode: 'default' | 'first' | 'last';
        rememberLast: boolean;
    };
    addMember(entry: FocusableEntry): void;
    removeMember(entry: FocusableEntry): void;
    updateLastFocused(entry: FocusableEntry): void;
}

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
    elementDesc: string;  // describeElement() output for logging
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
    nextTargets: Record<DirectionName, NavigationCandidate | null>;
    noTargetTimers: Partial<Record<DirectionName, ReturnType<typeof setTimeout> | null>>;
    lastFocusedElement: HTMLElement | null;
    lastFocusPosition: FocusPositionHint | null;  // Position hint for recovery
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
}

// Extend Window interface
declare global {
    interface Window {
        spatialNavState?: SpatialNavState;
        flutterFocusState?: SpatialNavState;
    }
}

/**
 * Initialize or retrieve the global spatial navigation state.
 * State persists across page navigations in SPAs.
 */
export function getState(config: SpatialNavConfig): SpatialNavState {
    // Reuse existing state if available (SPA navigation)
    // Support both new and legacy names
    const existingState = window.spatialNavState || window.flutterFocusState;
    const state: SpatialNavState = existingState || {} as SpatialNavState;

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
        lastDirection: ''
    };

    // Performance monitoring
    state.perf = state.perf || {
        refreshCount: 0,
        totalRefreshTime: 0,
        averageRefreshTime: 0,
        lastRefreshTime: 0,
        slowRefreshCount: 0
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
 * Reset state (useful for testing or page reloads).
 */
export function resetState(): void {
    delete window.spatialNavState;
    delete window.flutterFocusState;
}

/**
 * Export instrumentation data for debugging.
 */
export function getInstrumentation(): (Instrumentation & {
    focusablesCount: number;
    currentIndex: number;
    version: string;
}) | null {
    const state = window.spatialNavState || window.flutterFocusState;
    if (!state) return null;

    return {
        ...state.instrumentation,
        focusablesCount: state.focusables.length,
        currentIndex: state.currentIndex,
        version: state.version || '3.0.0',
    };
}
