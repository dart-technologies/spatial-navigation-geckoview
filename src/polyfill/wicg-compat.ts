/**
 * WICG Spatial Navigation Polyfill Compatibility Layer
 * 
 * Implements the W3C CSS Navigation Level 1 draft APIs:
 * - window.navigate()
 * - Element.prototype.spatialNavigationSearch()
 * - Element.prototype.focusableAreas()
 * - Element.prototype.getSpatialNavigationContainer()
 * - CSS custom properties registration
 * 
 * @see https://drafts.csswg.org/css-nav-1/
 * @see https://github.com/nicjansma/spatialnavigation
 * @version 3.0.0
 */

import type {
    Direction,
    DirectionInfo,
    SpatialNavigationState,
    SpatialNavigationSearchOptions,
    FocusableAreasOptions,
    FocusableEntry
} from '../types/index.js';

// Direction mappings
const directionByName: Record<Direction, DirectionInfo> = {
    up: { axis: 'y', sign: -1, name: 'up' },
    down: { axis: 'y', sign: 1, name: 'down' },
    left: { axis: 'x', sign: -1, name: 'left' },
    right: { axis: 'x', sign: 1, name: 'right' }
};

// Focusable selector
const focusableSelector =
    'a[href], button:not([disabled]), input:not([disabled]), ' +
    'select:not([disabled]), textarea:not([disabled]), ' +
    '[tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

// Reference to global state (set by installWICGPolyfill)
let globalState: SpatialNavigationState | null = null;

// Module references - set externally to avoid circular dependencies
let moveInDirectionFn: ((direction: DirectionInfo, event: Event | null, state: SpatialNavigationState) => boolean) | null = null;
let findDirectionalCandidateFn: ((currentIndex: number, direction: DirectionInfo, state: SpatialNavigationState) => { data: { element: Element } } | null) | null = null;

/**
 * Set module references for functions that would cause circular dependencies.
 * Called externally after modules are loaded.
 */
export function setModuleReferences(
    moveInDirection: typeof moveInDirectionFn,
    findDirectionalCandidate: typeof findDirectionalCandidateFn
): void {
    moveInDirectionFn = moveInDirection;
    findDirectionalCandidateFn = findDirectionalCandidate;
}

/**
 * Install WICG-compatible polyfill APIs on global objects.
 * Should be called after spatial navigation initializes.
 */
export function installWICGPolyfill(state: SpatialNavigationState): void {
    globalState = state;

    // Skip if already installed
    if ('navigate' in window) {
        console.log('[SpatialNav] WICG polyfill already installed');
        return;
    }

    // 1. window.navigate()
    (window as Window).navigate = navigatePolyfill;

    // 2. Element.prototype.spatialNavigationSearch()
    if (!Element.prototype.spatialNavigationSearch) {
        Element.prototype.spatialNavigationSearch = spatialNavigationSearchPolyfill;
    }

    // 3. Element.prototype.focusableAreas()
    if (!Element.prototype.focusableAreas) {
        Element.prototype.focusableAreas = focusableAreasPolyfill;
    }

    // 4. Element.prototype.getSpatialNavigationContainer()
    if (!Element.prototype.getSpatialNavigationContainer) {
        Element.prototype.getSpatialNavigationContainer = getSpatialNavigationContainerPolyfill;
    }

    // 5. Register CSS custom properties
    registerCSSProperties();

    console.log('[SpatialNav] WICG polyfill installed');
}

/**
 * Uninstall the polyfill (for testing).
 */
export function uninstallWICGPolyfill(): void {
    delete (window as Window & { navigate?: unknown }).navigate;
    delete Element.prototype.spatialNavigationSearch;
    delete Element.prototype.focusableAreas;
    delete Element.prototype.getSpatialNavigationContainer;
    globalState = null;
}

// ============================================================================
// window.navigate()
// ============================================================================

/**
 * Programmatically navigate in a direction.
 * @see https://drafts.csswg.org/css-nav-1/#dom-window-navigate
 */
function navigatePolyfill(dir: Direction): void {
    if (!globalState) {
        console.warn('[SpatialNav] State not initialized');
        return;
    }

    const direction = directionByName[dir];
    if (!direction) {
        console.warn('[SpatialNav] Invalid direction:', dir);
        return;
    }

    // Use module reference to avoid circular dependencies
    if (moveInDirectionFn) {
        moveInDirectionFn(direction, null, globalState);
    } else {
        console.warn('[SpatialNav] moveInDirection not available');
    }
}

// ============================================================================
// Element.prototype.spatialNavigationSearch()
// ============================================================================

/**
 * Find the best navigation target from this element in the given direction.
 * @see https://drafts.csswg.org/css-nav-1/#dom-element-spatialnavigationsearch
 */
function spatialNavigationSearchPolyfill(
    this: Element,
    dir: Direction,
    options: SpatialNavigationSearchOptions = {}
): Element | null {
    if (!globalState) {
        console.warn('[SpatialNav] State not initialized');
        return null;
    }

    const direction = directionByName[dir];
    if (!direction) {
        console.warn('[SpatialNav] Invalid direction:', dir);
        return null;
    }

    // Find this element in the focusables list
    const currentIndex = globalState.focusableElements.indexOf(this);
    if (currentIndex === -1) {
        // Element not in focusables - try to find from provided candidates
        const candidates = options.candidates || [];
        if (candidates.length === 0) {
            return null;
        }

        // Create temporary entry for this element
        const rect = this.getBoundingClientRect();
        const tempEntry: FocusableEntry = {
            element: this,
            index: -1,
            left: rect.left,
            top: rect.top,
            right: rect.right,
            bottom: rect.bottom,
            width: rect.width,
            height: rect.height,
            centerX: rect.left + rect.width / 2,
            centerY: rect.top + rect.height / 2,
            rect,
            scrollKey: 'body'
        };

        // Find best among provided candidates
        return findBestFromCandidates(tempEntry, candidates, direction);
    }

    // Use module reference to avoid circular dependencies
    if (findDirectionalCandidateFn && globalState) {
        const candidate = findDirectionalCandidateFn(currentIndex, direction, globalState);
        return candidate?.data.element ?? null;
    }

    return null;
}

/**
 * Find best candidate from explicit candidates list.
 */
function findBestFromCandidates(
    current: FocusableEntry,
    candidates: Element[],
    direction: DirectionInfo
): Element | null {
    let bestElement: Element | null = null;
    let bestScore = Infinity;

    for (const candidate of candidates) {
        if (candidate === current.element) continue;

        const rect = candidate.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;

        const deltaX = centerX - current.centerX;
        const deltaY = centerY - current.centerY;

        // Check if in correct direction
        if (direction.axis === 'x') {
            if (direction.sign > 0 && deltaX <= 0) continue;
            if (direction.sign < 0 && deltaX >= 0) continue;
        } else {
            if (direction.sign > 0 && deltaY <= 0) continue;
            if (direction.sign < 0 && deltaY >= 0) continue;
        }

        // Calculate score (simple distance-based)
        const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
        const primary = Math.abs(direction.axis === 'x' ? deltaX : deltaY);
        const secondary = Math.abs(direction.axis === 'x' ? deltaY : deltaX);

        // Penalize off-axis distance
        const score = primary * 1000 + secondary * 10 + distance;

        if (score < bestScore) {
            bestScore = score;
            bestElement = candidate;
        }
    }

    return bestElement;
}

// ============================================================================
// Element.prototype.focusableAreas()
// ============================================================================

/**
 * Get all focusable areas within this element.
 * @see https://drafts.csswg.org/css-nav-1/#dom-element-focusableareas
 */
function focusableAreasPolyfill(
    this: Element,
    options: FocusableAreasOptions = { mode: 'visible' }
): Element[] {
    const all = Array.from(this.querySelectorAll(focusableSelector));

    if (options.mode === 'all') {
        return all;
    }

    // Filter to visible elements
    return all.filter(el => {
        const style = window.getComputedStyle(el);
        if (style.visibility === 'hidden' || style.display === 'none') {
            return false;
        }

        const rect = el.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) {
            return false;
        }

        // Check if in viewport
        return (
            rect.bottom >= 0 &&
            rect.top <= window.innerHeight &&
            rect.right >= 0 &&
            rect.left <= window.innerWidth
        );
    });
}

// ============================================================================
// Element.prototype.getSpatialNavigationContainer()
// ============================================================================

/**
 * Get the spatial navigation container for this element.
 * @see https://drafts.csswg.org/css-nav-1/#dom-element-getspatialnavigationcontainer
 */
function getSpatialNavigationContainerPolyfill(this: Element): Element {
    let current: Element | null = this;

    while (current && current !== document.documentElement) {
        // Check for explicit focus group
        if (current.hasAttribute('data-focus-group')) {
            return current;
        }

        // Check CSS property
        const contain = getCSSNavContain(current);
        if (contain === 'contain') {
            return current;
        }

        // Check if this is a scroll container
        if (isScrollContainer(current)) {
            return current;
        }

        current = current.parentElement;
    }

    return document.documentElement;
}

/**
 * Check if element is a scroll container.
 */
function isScrollContainer(element: Element): boolean {
    const style = window.getComputedStyle(element);
    const overflow = (style.overflow + style.overflowX + style.overflowY).toLowerCase();

    if (overflow.includes('auto') || overflow.includes('scroll')) {
        // Also check if actually scrollable
        return element.scrollHeight > element.clientHeight ||
            element.scrollWidth > element.clientWidth;
    }

    return false;
}

// ============================================================================
// CSS Custom Properties
// ============================================================================

/**
 * Register CSS custom properties for spatial navigation.
 */
function registerCSSProperties(): void {
    if (!CSS || !('registerProperty' in CSS)) {
        console.log('[SpatialNav] CSS.registerProperty not supported');
        return;
    }

    const properties = [
        {
            name: '--spatial-navigation-contain',
            syntax: 'auto | contain',
            inherits: false,
            initialValue: 'auto'
        },
        {
            name: '--spatial-navigation-action',
            syntax: 'auto | focus | scroll',
            inherits: false,
            initialValue: 'auto'
        },
        {
            name: '--spatial-navigation-function',
            syntax: 'normal | grid',
            inherits: false,
            initialValue: 'normal'
        }
    ];

    for (const prop of properties) {
        try {
            CSS.registerProperty(prop);
        } catch (e) {
            // Already registered or syntax not supported
        }
    }
}

/**
 * Get the spatial-navigation-contain value for an element.
 */
export function getCSSNavContain(element: Element): 'auto' | 'contain' {
    try {
        const value = getComputedStyle(element)
            .getPropertyValue('--spatial-navigation-contain')
            .trim();
        return value === 'contain' ? 'contain' : 'auto';
    } catch {
        return 'auto';
    }
}

/**
 * Get the spatial-navigation-action value for an element.
 */
export function getCSSNavAction(element: Element): 'auto' | 'focus' | 'scroll' {
    try {
        const value = getComputedStyle(element)
            .getPropertyValue('--spatial-navigation-action')
            .trim();
        if (value === 'focus' || value === 'scroll') {
            return value;
        }
        return 'auto';
    } catch {
        return 'auto';
    }
}

/**
 * Get the spatial-navigation-function value for an element.
 */
export function getCSSNavFunction(element: Element): 'normal' | 'grid' {
    try {
        const value = getComputedStyle(element)
            .getPropertyValue('--spatial-navigation-function')
            .trim();
        return value === 'grid' ? 'grid' : 'normal';
    } catch {
        return 'normal';
    }
}
