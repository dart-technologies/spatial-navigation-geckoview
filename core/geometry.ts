/**
 * Geometry utilities for GeckoView Spatial Navigation System
 *
 * Handles element position calculations, visibility checks, and rect operations.
 */

import type { SpatialNavState, FocusableEntry } from './state';

export interface Point {
    x: number;
    y: number;
}

const ZERO_RECT: DOMRect =
    typeof DOMRect !== 'undefined'
        ? new DOMRect(0, 0, 0, 0)
        : ({
              x: 0,
              y: 0,
              width: 0,
              height: 0,
              top: 0,
              right: 0,
              bottom: 0,
              left: 0,
              toJSON: () => ({}),
          } as DOMRect);

/**
 * Safe wrapper for `getBoundingClientRect()`.
 *
 * Defends against detached nodes / DOM-thrashing during mutation observer
 * callbacks where calling `getBoundingClientRect()` can throw on some engines.
 * Returns a zero-sized rect on failure so callers never need to null-check.
 */
export function safeGetBoundingClientRect(element: Element | null): DOMRect {
    if (!element || typeof (element as Element).getBoundingClientRect !== 'function') {
        return ZERO_RECT;
    }
    try {
        return element.getBoundingClientRect();
    } catch {
        return ZERO_RECT;
    }
}

/**
 * Resolve the scroll container key for an element.
 * Uses caching to avoid repeated DOM traversals.
 */
export function resolveScrollKey(element: HTMLElement, state: SpatialNavState): string {
    if (!element || element === document.body || element === document.documentElement) {
        return 'body';
    }
    const cached = state.scrollCache.get(element);
    if (cached !== undefined) {
        return cached;
    }
    let node: HTMLElement | null = element;
    while (node && node !== document.body && node !== document.documentElement) {
        const style = window.getComputedStyle(node);
        const overflow = (style.overflow + style.overflowX + style.overflowY).toLowerCase();
        if (overflow.includes('auto') || overflow.includes('scroll')) {
            const key =
                node.id && node.id.length
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
export function calculateVisualRect(element: HTMLElement): DOMRect {
    let rect = safeGetBoundingClientRect(element);

    // For elements like logos/image-buttons whose hit area is smaller than the
    // visual asset, expand the rect to cover the larger child. This makes the
    // focus indicator highlight what the user *sees*, not the tap target.
    const visualChild = element.querySelector('img, svg, video, picture, canvas');
    if (visualChild) {
        const childRect = safeGetBoundingClientRect(visualChild);
        if (
            childRect.width > rect.width ||
            childRect.height > rect.height ||
            childRect.left < rect.left ||
            childRect.top < rect.top
        ) {
            rect = childRect;
        }
    }

    return rect;
}

/**
 * Update geometry properties for a focusable entry.
 * Calculates bounding rect, center point, and scroll container.
 */
export function updateEntryGeometry(entry: FocusableEntry, state: SpatialNavState): FocusableEntry | null {
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
    entry.scrollKey = resolveScrollKey(entry.element as HTMLElement, state);
    return entry;
}

/**
 * Check if a rect is visible within viewport with optional margin.
 */
export function isRectVisible(rect: DOMRect | null, margin?: number): boolean {
    if (!rect) {
        return false;
    }
    const m = Math.max(0, margin || 0);
    const horizontalVisible = rect.right >= -m && rect.left <= window.innerWidth + m;
    const verticalVisible = rect.bottom >= -m && rect.top <= window.innerHeight + m;
    return horizontalVisible && verticalVisible;
}

/**
 * Calculate center point of a rect.
 */
export function getCenterPoint(rect: DOMRect): Point {
    return {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
    };
}

/**
 * Check if two rects overlap.
 */
export function rectsOverlap(rect1: DOMRect, rect2: DOMRect): boolean {
    return !(
        rect1.right < rect2.left ||
        rect1.left > rect2.right ||
        rect1.bottom < rect2.top ||
        rect1.top > rect2.bottom
    );
}

/**
 * Calculate overlap area between two rects.
 */
export function calculateOverlapArea(rect1: DOMRect, rect2: DOMRect): number {
    if (!rectsOverlap(rect1, rect2)) {
        return 0;
    }
    const overlapWidth = Math.min(rect1.right, rect2.right) - Math.max(rect1.left, rect2.left);
    const overlapHeight = Math.min(rect1.bottom, rect2.bottom) - Math.max(rect1.top, rect2.top);
    return overlapWidth * overlapHeight;
}
