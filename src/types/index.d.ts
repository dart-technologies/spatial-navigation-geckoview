/**
 * GeckoView Spatial Navigation - Type Definitions
 * @version 3.0.0
 * @license MIT
 */

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * Main configuration object for spatial navigation.
 * Can be provided via `window.spatialNavConfig` or programmatically.
 */
export interface SpatialNavigationConfig {
    // === Visual Styling ===
    /** Primary highlight color (hex, rgb, rgba). Default: '#FFC107' (amber) */
    color: string;
    /** Focus outline width in pixels. Default: 3 */
    outlineWidth: number;
    /** Focus outline offset in pixels. Default: 3 */
    outlineOffset: number;
    /** Z-index for overlay layer. Default: 2147483646 */
    overlayZIndex: number;
    /** Scale factor for arrow dimensions. Default: 1.0 */
    arrowScale: number;
    /** RGB color for disabled/boundary indicators. Default: '128, 128, 128' */
    disabledColor: string;
    /** Overlay theme preset. Default: 'default' */
    overlayTheme: 'default' | 'high-contrast';
    /** Safe-area/overscan margin in CSS pixels. Default: 12 */
    safeAreaMargin: number;
    /** Inner scrim opacity (0-1). Default: 0.06 */
    overlayScrimOpacity: number;
    /** Outer glow opacity (0-1). Default: 0.35 */
    overlayGlowOpacity: number;
    /** Outer glow blur radius in CSS pixels. Default: 14 */
    overlayGlowBlur: number;

    // === Dynamic Content Observation ===
    /** Watch for DOM changes. Default: true */
    observeMutations: boolean;
    /** Update on scroll. Default: true */
    observeScroll: boolean;
    /** Debounce delay for mutation handling (ms). Default: 100 */
    mutationDebounce: number;
    /** Minimum scroll distance to trigger update (px). Default: 8 */
    scrollThreshold: number;

    // === Intersection Observer (Lazy-load) ===
    /** Use IntersectionObserver for lazy content. Default: false */
    observeIntersection: boolean;
    /** Root margin for intersection observer. Default: '200px' */
    intersectionRootMargin: string;
    /** Visibility threshold (0-1). Default: 0 */
    intersectionThreshold: number;

    // === Recovery / Refocus ===
    /** Automatically recover focus when lost. Default: true */
    autoRefocus: boolean;
    /** Recovery strategy: 'closest' or 'first'. Default: 'closest' */
    refocusStrategy: 'closest' | 'first';

    // === Shadow DOM ===
    /** Recurse into Shadow DOM for focusable discovery. Default: false */
    traverseShadowDom: boolean;

    // === Virtual Scroll ===
    /** Detect virtual scroll containers (YouTube, Twitter). Default: true */
    observeVirtualContainers: boolean;
    /** CSS selectors for virtual scroll containers */
    virtualContainerSelectors: string[];
    /** Debounce for virtual scroll refresh (ms). Default: 150 */
    virtualScrollDebounce: number;

    // === Accessibility ===
    /** Enable ARIA accessibility features. Default: false */
    enableAria: boolean;
    /** Announce focus changes via ARIA live region. Default: false */
    announceNavigation: boolean;
    /** Announce edge/trap boundaries. Default: false */
    announceBoundaries: boolean;
    /** Include role info in descriptions. Default: false */
    verboseDescriptions: boolean;

    // === Focus Trap Detection ===
    /** Detect modal/dialog focus traps. Default: false */
    focusTrapDetection: boolean;

    // === Performance ===
    /** Defer DOM refresh for React/Vue/Angular. Default: true */
    frameworkAwareRefresh: boolean;
    /** Background candidate pre-computation. Default: true */
    precomputeCandidates: boolean;
    /** Cache timeout for precomputed candidates (ms). Default: 500 */
    precomputeCacheTimeout: number;

    // === Focus Groups ===
    focusGroups: FocusGroupsConfig;

    // === iframe Handling ===
    iframeSupport: IframeSupportConfig;
}

export interface FocusGroupsConfig {
    /** Enable focus groups. Default: false */
    enabled: boolean;
    /** Default rules for groups */
    defaultRules: Record<string, unknown>;
    /** Boundary behavior: 'exit' | 'wrap' | 'stop' | 'contain'. Default: 'exit' */
    boundaryBehavior: 'exit' | 'wrap' | 'stop' | 'contain';
}

export interface IframeSupportConfig {
    /** Enable iframe focus handling. Default: false */
    enabled: boolean;
    /** CSS selector for iframes. Default: 'iframe' */
    selector: string;
    /** Focus method: 'element' or 'contentWindow'. Default: 'element' */
    focusMethod: 'element' | 'contentWindow';
}

// ============================================================================
// State Types
// ============================================================================

export interface SpatialNavigationState {
    /** Extension version */
    version: string;
    /** Active configuration */
    config: SpatialNavigationConfig;
    /** Array of focusable entry objects */
    focusables: FocusableEntry[];
    /** Array of focusable DOM elements (parallel to focusables) */
    focusableElements: Element[];
    /** Count of focusable elements */
    focusableCount: number;
    /** Index of currently focused element (-1 if none) */
    currentIndex: number;
    /** Last successfully focused element */
    lastFocusedElement: Element | null;
    /** Focus groups by ID */
    focusGroups: Record<string, FocusGroup>;
    /** State dirty flag (needs refresh) */
    dirty: boolean;
    /** Last boundary hit direction */
    lastBoundary: Direction | null;
    /** Current focus trap info */
    currentTrap: FocusTrapInfo | null;
    /** Precomputed navigation targets by direction */
    precomputedTargets: Record<Direction, NavigationCandidate | null> | null;
    /** Index for which targets were precomputed */
    precomputedForIndex: number;
    /** Timestamp of precomputation */
    precomputedTimestamp: number;
    /** Last navigation move info */
    lastMove: NavigationMove | null;
    /** Performance metrics */
    perf: PerformanceMetrics;
    /** Instrumentation for testing */
    instrumentation: InstrumentationData;
    /** Overlay DOM element */
    overlay: HTMLElement | null;
    /** Overlay host (Shadow DOM container) */
    overlayHost: HTMLElement | null;
    /** ARIA announcer element */
    announcer: HTMLElement | null;
    /** Mutation observer instance */
    mutationObserver: MutationObserver | null;
    /** Virtual scroll sentinel observer */
    virtualSentinelObserver: IntersectionObserver | null;
    /** Detected virtual scroll containers */
    virtualContainers: Element[];
    /** Event handlers attached flag */
    handlersAttached: boolean;
    /** Scroll listener attached flag */
    scrollListenerAttached: boolean;
    /** Scroll position cache */
    scrollCache: WeakMap<Element, string>;
}

export interface FocusableEntry {
    /** DOM element */
    element: Element;
    /** Index in focusables array */
    index: number;
    /** Bounding rect left */
    left: number;
    /** Bounding rect top */
    top: number;
    /** Bounding rect right */
    right: number;
    /** Bounding rect bottom */
    bottom: number;
    /** Element width */
    width: number;
    /** Element height */
    height: number;
    /** Center X coordinate */
    centerX: number;
    /** Center Y coordinate */
    centerY: number;
    /** Full bounding rect */
    rect: DOMRect;
    /** Scroll container key */
    scrollKey: string;
    /** Focus group ID if in a group */
    groupId?: string;
}

export interface FocusGroup {
    /** Unique group ID */
    id: string;
    /** Container element */
    element: Element;
    /** Group member entries */
    members: FocusableEntry[];
    /** Group options */
    options: FocusGroupOptions;
    /** Last focused entry in group */
    lastFocused: FocusableEntry | null;
}

export interface FocusGroupOptions {
    /** Boundary behavior: 'exit' | 'contain' | 'wrap' | 'stop' */
    boundary: 'exit' | 'contain' | 'wrap' | 'stop';
    /** Remember last focused element. Default: true */
    rememberLast: boolean;
    /** Entry mode: 'default' | 'last' | 'first'. Default: 'default' */
    enterMode: 'default' | 'last' | 'first';
}

// ============================================================================
// Navigation Types
// ============================================================================

export type Direction = 'up' | 'down' | 'left' | 'right';

export interface DirectionInfo {
    /** Axis: 'x' or 'y' */
    axis: 'x' | 'y';
    /** Sign: 1 for right/down, -1 for left/up */
    sign: 1 | -1;
    /** Direction name */
    name: Direction;
}

export interface NavigationCandidate {
    /** Index in focusables array */
    index: number;
    /** Focusable entry data */
    data: FocusableEntry;
    /** Bounding rect */
    rect: DOMRect;
    /** Computed score (lower is better) */
    score: number;
    /** Detailed metrics */
    metrics: DirectionalMetrics;
    /** Which scoring pass found this candidate (0-2) */
    passIndex?: number;
}

export interface DirectionalMetrics {
    /** Distance along primary axis */
    primary: number;
    /** Distance along secondary axis */
    secondary: number;
    /** Euclidean distance */
    distance: number;
    /** Alignment score (higher is better) */
    alignment: number;
    /** Delta X from current to candidate center */
    deltaX: number;
    /** Delta Y from current to candidate center */
    deltaY: number;
}

export interface NavigationMove {
    /** Index moved from */
    fromIndex: number;
    /** Index moved to */
    toIndex: number;
    /** Direction of move */
    direction: Direction;
    /** Scoring pass that found target (0-2) */
    passIndex: number;
    /** Timestamp of move */
    timestamp: number;
}

export interface FocusTrapInfo {
    /** Trap container element */
    trap: Element;
    /** Key to escape trap (e.g., 'Escape') */
    escapeKey: string;
    /** Close button element if found */
    closeButton: Element | null;
    /** Trap ID for announcements */
    trapId: string;
}

// ============================================================================
// Event Types
// ============================================================================

export interface NavigationEventDetail {
    /** Navigation direction */
    dir: Direction;
    /** Related target (previous/next element) */
    relatedTarget?: Element;
    /** Whether in a focus trap */
    inTrap?: boolean;
    /** Focus trap container */
    trapElement?: Element;
    /** Escape affordance element */
    escapeElement?: Element;
    /** Key to escape trap */
    escapeKey?: string;
}

export interface NavigationEvent extends CustomEvent<NavigationEventDetail> {
    type: 'navbeforefocus' | 'navnotarget';
}

export interface SpatialNavigationExitEvent extends CustomEvent<{
    direction: Direction;
    inTrap: boolean;
    trapInfo: FocusTrapInfo | null;
}> {
    type: 'spatialNavigationExit';
}

// ============================================================================
// Messaging Types (Native App Communication)
// ============================================================================

export type MessageType =
    | 'spatialNavInit'
    | 'focusChange'
    | 'focusExit'
    | 'boundary'
    | 'configUpdate'
    | 'error';

export interface NativeMessage {
    /** Message type */
    type: MessageType;
    /** Extension version */
    version: string;
    /** Event timestamp */
    timestamp: number;
    /** Current page URL */
    url?: string;
    /** Message payload */
    payload?: unknown;
}

export interface FocusChangeMessage extends NativeMessage {
    type: 'focusChange';
    payload: {
        direction: Direction;
        fromElement: ElementDescriptor | null;
        toElement: ElementDescriptor;
        passIndex: number;
    };
}

export interface FocusExitMessage extends NativeMessage {
    type: 'focusExit';
    payload: {
        direction: Direction;
        inTrap: boolean;
        trapId?: string;
        escapeKey?: string;
    };
}

export interface ElementDescriptor {
    /** Tag name (lowercase) */
    tagName: string;
    /** Element ID if present */
    id?: string;
    /** Class names (first 2) */
    className?: string;
    /** Text content (truncated) */
    text?: string;
    /** Bounding rect */
    rect: { x: number; y: number; width: number; height: number };
    /** ARIA label if present */
    ariaLabel?: string;
}

// ============================================================================
// Performance & Instrumentation
// ============================================================================

export interface PerformanceMetrics {
    /** Number of DOM refreshes */
    refreshCount: number;
    /** Total refresh time (ms) */
    totalRefreshTime: number;
    /** Average refresh time (ms) */
    averageRefreshTime: number;
    /** Last refresh time (ms) */
    lastRefreshTime: number;
    /** Count of slow refreshes (>50ms) */
    slowRefreshCount: number;
}

export interface InstrumentationData {
    /** Description of last active element */
    lastActive: string;
    /** Description of last overlay target */
    lastOverlay: string;
    /** Index of active element */
    activeIndex: number;
    /** Last update timestamp */
    lastUpdate: number;
    /** Last navigation direction */
    lastDirection?: Direction;
}

// ============================================================================
// WICG Compatibility Extensions
// ============================================================================

export interface SpatialNavigationSearchOptions {
    /** Candidate elements to consider */
    candidates?: Element[];
    /** Container to search within */
    container?: Element;
}

export interface FocusableAreasOptions {
    /** 'visible' (default) or 'all' */
    mode?: 'visible' | 'all';
}

// Extend global interfaces
/*
declare global {
    interface Window {
        // ... (Conflicts with internal types)
        navigate?(dir: Direction): void;
        spatialNavState?: SpatialNavigationState;
        spatialNavConfig?: Partial<SpatialNavigationConfig>;
        flutterFocusState?: SpatialNavigationState;
        flutterSpatialNavConfig?: Partial<SpatialNavigationConfig>;
        flutterShowOverlay?(element: Element | null): void;
    }

    interface Element {
        spatialNavigationSearch?(
            dir: Direction,
            options?: SpatialNavigationSearchOptions
        ): Element | null;
        focusableAreas?(options?: FocusableAreasOptions): Element[];
        getSpatialNavigationContainer?(): Element;
    }

    interface WindowEventMap {
        'navbeforefocus': NavigationEvent;
        'navnotarget': NavigationEvent;
        'spatialNavigationExit': SpatialNavigationExitEvent;
    }

    interface DocumentEventMap {
        'navbeforefocus': NavigationEvent;
        'navnotarget': NavigationEvent;
        'spatialNavigationExit': SpatialNavigationExitEvent;
    }
}
*/

// ============================================================================
// Public API Exports
// ============================================================================

/**
 * Initialize spatial navigation on the page.
 * Called automatically when the extension loads, but can be called manually.
 */
export declare function initSpatialNavigation(
    config?: Partial<SpatialNavigationConfig>
): SpatialNavigationState;

/**
 * Update configuration at runtime.
 */
export declare function updateConfig(
    newConfig: Partial<SpatialNavigationConfig>
): void;

/**
 * Programmatically navigate in a direction.
 */
export declare function navigate(dir: Direction): boolean;

/**
 * Refresh the focusable elements list.
 */
export declare function refreshFocusables(): void;

/**
 * Show the focus overlay on a specific element.
 */
export declare function showOverlay(element: Element | null): void;

/**
 * Get the current spatial navigation state.
 */
export declare function getState(): SpatialNavigationState;

/**
 * Install WICG-compatible polyfill APIs.
 */
export declare function installWICGPolyfill(): void;
