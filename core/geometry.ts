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
                        ? node.tagName.toLowerCase() + '.' + node.className.toString().trim().split(/\s+/).slice(0, 2).join('.')
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
    let rect = element.getBoundingClientRect();

    // Expansion: Check if element contains a single visual child that's larger
    // (Common in logos or image buttons where the hit area is smaller than the asset)
    const visualChild = element.querySelector('img, svg, video, picture, canvas');
    if (visualChild) {
        const childRect = visualChild.getBoundingClientRect();
        // Only expand if the child is actually larger or significantly offset
        if (childRect.width > rect.width || childRect.height > rect.height ||
            childRect.left < rect.left || childRect.top < rect.top) {

            if ((window as any).flutterSpatialNavDebug) {
                // console.log(`[SpatialNav] Expanding visual rect for ${element.tagName} due to child ${visualChild.tagName}: [${childRect.left.toFixed(1)}, ${childRect.top.toFixed(1)}] ${childRect.width.toFixed(1)}x${childRect.height.toFixed(1)}`);
            }
            // Return a merged rect or just the child rect if it's the primary visual
            // For most "logo" cases, the child rect is exactly what we want to highlight
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

    // Use the base bounding rect for navigation logic (center points, distance, edges)
    // This keeps navigation intuitive regardless of visual expansion (logos, etc.)
    const rect = entry.element.getBoundingClientRect();

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
 * Calculate Euclidean distance between two rects' centers.
 */
export function calculateDistance(rect1: DOMRect, rect2: DOMRect): number {
    const center1 = getCenterPoint(rect1);
    const center2 = getCenterPoint(rect2);
    const dx = center2.x - center1.x;
    const dy = center2.y - center1.y;
    return Math.sqrt(dx * dx + dy * dy);
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
