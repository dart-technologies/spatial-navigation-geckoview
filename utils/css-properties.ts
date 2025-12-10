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

import { getConfig, type ScoringMode } from '../core/config';

export type NavContain = 'auto' | 'contain';
export type NavAction = 'auto' | 'focus' | 'scroll';
export type NavFunction = 'normal' | 'grid';

export interface CSSNavProperties {
    contain: NavContain;
    action: NavAction;
    function: NavFunction;
}

/**
 * Get all CSS navigation properties for an element.
 */
export function getCSSNavProperties(element: Element): CSSNavProperties {
    const config = getConfig();

    // Return defaults if CSS properties disabled
    if (!config.useCSSProperties) {
        return {
            contain: 'auto',
            action: 'auto',
            function: 'normal'
        };
    }

    try {
        const style = getComputedStyle(element);

        const containValue = style.getPropertyValue('--spatial-navigation-contain').trim();
        const actionValue = style.getPropertyValue('--spatial-navigation-action').trim();
        const functionValue = style.getPropertyValue('--spatial-navigation-function').trim();

        return {
            contain: containValue === 'contain' ? 'contain' : 'auto',
            action: (actionValue === 'focus' || actionValue === 'scroll') ? actionValue : 'auto',
            function: functionValue === 'grid' ? 'grid' : 'normal'
        };
    } catch {
        return {
            contain: 'auto',
            action: 'auto',
            function: 'normal'
        };
    }
}

/**
 * Get the navigation contain value for an element.
 * If 'contain', navigation should not exit this element's subtree.
 */
export function getCSSNavContain(element: Element): NavContain {
    return getCSSNavProperties(element).contain;
}

/**
 * Get the navigation action for an element.
 * - 'focus': only focus navigation
 * - 'scroll': scroll instead of focusing
 * - 'auto': default behavior
 */
export function getCSSNavAction(element: Element): NavAction {
    return getCSSNavProperties(element).action;
}

/**
 * Get the navigation function for an element.
 * - 'grid': use grid-aligned navigation
 * - 'normal': use standard geometric navigation
 */
export function getCSSNavFunction(element: Element): NavFunction {
    return getCSSNavProperties(element).function;
}

/**
 * Find the nearest navigation container for an element.
 * A container is an element with --spatial-navigation-contain: contain.
 */
export function findNavigationContainer(element: Element): Element | null {
    const config = getConfig();

    // Skip if CSS properties disabled
    if (!config.useCSSProperties) {
        return null;
    }

    let current: Element | null = element.parentElement;

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
export function getEffectiveScoringMode(element: Element): ScoringMode {
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
 * Check if navigation should be contained within an element's subtree.
 */
export function isNavigationContained(element: Element): boolean {
    return getCSSNavContain(element) === 'contain';
}

/**
 * Check if an element or its ancestors have containment.
 */
export function hasNavigationContainment(element: Element): {
    contained: boolean;
    container: Element | null;
} {
    const container = findNavigationContainer(element);
    return {
        contained: container !== null,
        container
    };
}

// =============================================================================
// CSS Scroll Snap Integration
// =============================================================================

/**
 * Scroll snap axis type.
 */
export type ScrollSnapAxis = 'x' | 'y' | 'block' | 'inline' | 'both' | 'none';

/**
 * Scroll snap strictness.
 */
export type ScrollSnapStrictness = 'mandatory' | 'proximity' | 'none';

/**
 * Scroll snap alignment.
 */
export type ScrollSnapAlign = 'none' | 'start' | 'end' | 'center';

/**
 * Scroll snap container information.
 */
export interface ScrollSnapInfo {
    /** Whether this element is a scroll snap container */
    isSnapContainer: boolean;
    /** Snap axis (x, y, block, inline, both) */
    axis: ScrollSnapAxis;
    /** Snap strictness (mandatory or proximity) */
    strictness: ScrollSnapStrictness;
    /** Whether container uses mandatory snapping */
    isMandatory: boolean;
    /** Whether snapping is horizontal */
    isHorizontal: boolean;
    /** Whether snapping is vertical */
    isVertical: boolean;
}

/**
 * Scroll snap child alignment information.
 */
export interface ScrollSnapAlignInfo {
    /** Whether this element has snap alignment */
    hasSnapAlign: boolean;
    /** Block (vertical) alignment */
    blockAlign: ScrollSnapAlign;
    /** Inline (horizontal) alignment */
    inlineAlign: ScrollSnapAlign;
}

/**
 * Parse scroll-snap-type CSS value.
 *
 * @param value - CSS scroll-snap-type value (e.g., "y mandatory", "both proximity")
 * @returns Parsed axis and strictness
 */
function parseScrollSnapType(value: string): { axis: ScrollSnapAxis; strictness: ScrollSnapStrictness } {
    const normalized = value.toLowerCase().trim();

    if (!normalized || normalized === 'none') {
        return { axis: 'none', strictness: 'none' };
    }

    const parts = normalized.split(/\s+/);

    let axis: ScrollSnapAxis = 'none';
    let strictness: ScrollSnapStrictness = 'proximity'; // Default per spec

    for (const part of parts) {
        switch (part) {
            case 'x':
            case 'y':
            case 'block':
            case 'inline':
            case 'both':
                axis = part;
                break;
            case 'mandatory':
            case 'proximity':
                strictness = part;
                break;
        }
    }

    return { axis, strictness };
}

/**
 * Parse scroll-snap-align CSS value.
 *
 * @param value - CSS scroll-snap-align value (e.g., "start", "center end")
 * @returns Parsed block and inline alignment
 */
function parseScrollSnapAlign(value: string): { blockAlign: ScrollSnapAlign; inlineAlign: ScrollSnapAlign } {
    const normalized = value.toLowerCase().trim();

    if (!normalized || normalized === 'none') {
        return { blockAlign: 'none', inlineAlign: 'none' };
    }

    const parts = normalized.split(/\s+/);

    // Single value applies to both axes
    if (parts.length === 1) {
        const align = parts[0] as ScrollSnapAlign;
        return { blockAlign: align, inlineAlign: align };
    }

    // Two values: block (first) and inline (second)
    return {
        blockAlign: (parts[0] || 'none') as ScrollSnapAlign,
        inlineAlign: (parts[1] || 'none') as ScrollSnapAlign
    };
}

/**
 * Get scroll snap container information for an element.
 *
 * @param element - Element to check
 * @returns Scroll snap information
 */
export function getScrollSnapInfo(element: Element): ScrollSnapInfo {
    try {
        const style = getComputedStyle(element);
        const snapType = style.scrollSnapType || style.getPropertyValue('scroll-snap-type');

        const { axis, strictness } = parseScrollSnapType(snapType);

        const isSnapContainer = axis !== 'none';
        const isMandatory = strictness === 'mandatory';
        const isHorizontal = axis === 'x' || axis === 'inline' || axis === 'both';
        const isVertical = axis === 'y' || axis === 'block' || axis === 'both';

        return {
            isSnapContainer,
            axis,
            strictness,
            isMandatory,
            isHorizontal,
            isVertical
        };
    } catch {
        return {
            isSnapContainer: false,
            axis: 'none',
            strictness: 'none',
            isMandatory: false,
            isHorizontal: false,
            isVertical: false
        };
    }
}

/**
 * Get scroll snap alignment for an element (as a snap child).
 *
 * @param element - Element to check
 * @returns Scroll snap alignment information
 */
export function getScrollSnapAlign(element: Element): ScrollSnapAlignInfo {
    try {
        const style = getComputedStyle(element);
        const snapAlign = style.scrollSnapAlign || style.getPropertyValue('scroll-snap-align');

        const { blockAlign, inlineAlign } = parseScrollSnapAlign(snapAlign);

        return {
            hasSnapAlign: blockAlign !== 'none' || inlineAlign !== 'none',
            blockAlign,
            inlineAlign
        };
    } catch {
        return {
            hasSnapAlign: false,
            blockAlign: 'none',
            inlineAlign: 'none'
        };
    }
}

/**
 * Find the nearest scroll snap container for an element.
 *
 * @param element - Element to start from
 * @returns Scroll snap container or null
 */
export function findScrollSnapContainer(element: Element): Element | null {
    let current: Element | null = element.parentElement;

    while (current && current !== document.documentElement) {
        const info = getScrollSnapInfo(current);
        if (info.isSnapContainer) {
            return current;
        }
        current = current.parentElement;
    }

    return null;
}

/**
 * Get all snap points within a scroll snap container.
 *
 * @param container - Scroll snap container element
 * @returns Array of elements with scroll-snap-align set
 */
export function getSnapPoints(container: Element): Element[] {
    const snapPoints: Element[] = [];

    // Query all descendants
    const descendants = container.querySelectorAll('*');

    for (const el of Array.from(descendants)) {
        const alignInfo = getScrollSnapAlign(el);
        if (alignInfo.hasSnapAlign) {
            snapPoints.push(el);
        }
    }

    return snapPoints;
}

/**
 * Check if navigation should use grid mode based on scroll snap container.
 *
 * When an element is inside a scroll-snap container with mandatory snapping,
 * grid-mode navigation often provides better UX as items are typically
 * laid out in a grid pattern.
 *
 * @param element - Element to check
 * @returns Whether to prefer grid mode
 */
export function shouldUseGridForScrollSnap(element: Element): boolean {
    const config = getConfig();

    // Respect explicit config setting
    if (config.scoringMode === 'grid') {
        return true;
    }

    // Check if inside a scroll snap container
    const container = findScrollSnapContainer(element);
    if (!container) {
        return false;
    }

    const snapInfo = getScrollSnapInfo(container);

    // Use grid mode for mandatory snap containers (typically carousels, grids)
    return snapInfo.isMandatory;
}

/**
 * Get optimal scroll behavior for an element based on its snap alignment.
 *
 * @param element - Element to scroll to
 * @returns ScrollIntoViewOptions
 */
export function getScrollOptionsForSnapElement(element: Element): ScrollIntoViewOptions {
    const alignInfo = getScrollSnapAlign(element);

    const options: ScrollIntoViewOptions = {
        behavior: 'smooth'
    };

    // Map snap alignment to scrollIntoView options
    switch (alignInfo.blockAlign) {
        case 'start':
            options.block = 'start';
            break;
        case 'end':
            options.block = 'end';
            break;
        case 'center':
            options.block = 'center';
            break;
        default:
            options.block = 'nearest';
    }

    switch (alignInfo.inlineAlign) {
        case 'start':
            options.inline = 'start';
            break;
        case 'end':
            options.inline = 'end';
            break;
        case 'center':
            options.inline = 'center';
            break;
        default:
            options.inline = 'nearest';
    }

    return options;
}
