/**
 * Configuration management for GeckoView Spatial Navigation System
 *
 * Handles configuration from window.spatialNavConfig or window.flutterSpatialNavConfig (legacy).
 *
 * Features:
 * - Grid mode for aligned layouts (BBC LRUD-inspired)
 * - Configurable overlap threshold (BBC LRUD)
 * - Wrap/cycle navigation at boundaries
 * - CSS custom property integration (WICG)
 * - Distance function selection (euclidean, manhattan, projected)
 */

// Type definitions
export type ScoringMode = 'geometric' | 'grid';
export type DistanceFunction = 'euclidean' | 'manhattan' | 'projected';
export type RefocusStrategy = 'closest' | 'first';
export type BoundaryBehavior = 'wrap' | 'stop' | 'exit';
export type FocusMethod = 'element' | 'contentWindow';
export type DirectionName = 'up' | 'down' | 'left' | 'right';
export type DirectionAxis = 'x' | 'y';
export type OverlayTheme = 'default' | 'high-contrast';

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

// Partial config for user overrides
export type PartialSpatialNavConfig = Partial<SpatialNavConfig> & {
    iframeSupport?: Partial<IframeSupportConfig>;
    focusGroups?: Partial<FocusGroupsConfig>;
};

// Extend Window interface for global config
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
 * Get the current spatial navigation configuration.
 * Merges user-provided config with defaults.
 */
export function getConfig(): SpatialNavConfig {
    // Support both new and legacy config names
    const userConfig = globalScope.spatialNavConfig || globalScope.flutterSpatialNavConfig || {};

    return {
        // Visual styling
        color: userConfig.color || '#FFC107',
        outlineWidth: userConfig.outlineWidth || 3,
        outlineOffset: userConfig.outlineOffset || 3,

        // Overlay/preview visual options
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
        overlayGlowBlur: typeof userConfig.overlayGlowBlur === 'number'
            ? Math.max(0, userConfig.overlayGlowBlur)
            : 14,

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
            focusMethod: userConfig.iframeSupport?.focusMethod || 'element'
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
            '[data-testid="primaryColumn"]'
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
        gridAlignmentTolerance: typeof userConfig.gridAlignmentTolerance === 'number'
            ? userConfig.gridAlignmentTolerance : 20,

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
 */
export function updateConfig(newConfig: PartialSpatialNavConfig): void {
    const existing = globalScope.flutterSpatialNavConfig || {};
    globalScope.flutterSpatialNavConfig = {
        ...existing,
        ...newConfig,
    };
}

/**
 * Direction mappings for arrow keys.
 */
export const directionByKey: Record<string, Direction> = {
    ArrowDown: { axis: 'y', sign: 1, name: 'down' },
    ArrowUp: { axis: 'y', sign: -1, name: 'up' },
    ArrowRight: { axis: 'x', sign: 1, name: 'right' },
    ArrowLeft: { axis: 'x', sign: -1, name: 'left' }
};

export const directionByName: DirectionMap = {
    down: directionByKey.ArrowDown,
    up: directionByKey.ArrowUp,
    right: directionByKey.ArrowRight,
    left: directionByKey.ArrowLeft
};

export const directionKeys: DirectionName[] = ['down', 'up', 'right', 'left'];
