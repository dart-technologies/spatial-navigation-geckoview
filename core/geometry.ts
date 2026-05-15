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
export function calculateVisualRect(element: HTMLElement): DOMRect {
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
    const isClipped = (cs: CSSStyleDeclaration): boolean => {
        const isClip = (v: string | undefined | null): boolean => !!v && v !== 'visible';
        // Happy-dom (test env) doesn`t reliably resolve shorthand
        // `overflow` → longhand `overflow-x` / `overflow-y`. Production
        // browsers populate the longhands so we check both for stable
        // behaviour across environments.
        return isClip(cs.overflowX) || isClip(cs.overflowY) || isClip(cs.overflow);
    };
    const clipToVisibleArea = (visual: DOMRect, mediaChild: HTMLElement | null): DOMRect => {
        // Walk from the media child up to the focused element (inclusive),
        // intersecting with every element that clips its overflow.
        let left = visual.left;
        let top = visual.top;
        let right = visual.right;
        let bottom = visual.bottom;
        let cursor: HTMLElement | null = mediaChild ?? element;
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
            } catch {
                // No window / non-browser env — stop walking.
                break;
            }
            if (cursor === element) break;
            cursor = cursor.parentElement;
            safety++;
        }
        const width = Math.max(0, right - left);
        const height = Math.max(0, bottom - top);
        if (width <= 0 || height <= 0) return rect;
        // If no clip changed anything, return the original rect (no
        // floating-point drift from constructing a new DOMRect).
        if (
            left === visual.left &&
            top === visual.top &&
            right === visual.right &&
            bottom === visual.bottom
        ) {
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
            const parentExtends =
                parentRect.left < rect.left - epsExtend ||
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
                } else {
                    const radiusPx = parseFloat(radiusStr);
                    if (!Number.isNaN(radiusPx) && smallerDim > 0) {
                        isRound = radiusPx >= smallerDim * 0.25;
                    }
                }
                const bg = pcs.backgroundColor || '';
                const hasOpaqueBg =
                    bg.length > 0 &&
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
    } catch {
        // No window / non-browser env — fall through to next strategy.
    }

    // 2) Shrink-to-fit when the focused element is a link/card wrapping
    //    a single media element. Restrict to descendants (not strict
    //    children) because pages routinely wrap `<img>` in an extra
    //    `<span>` or `<picture>` inside the link.
    const mediaSelector = 'img, picture, svg, video, canvas';
    const mediaCandidates = element.querySelectorAll(mediaSelector);
    if (mediaCandidates.length > 0) {
        const visibleMedia: HTMLElement[] = [];
        for (let i = 0; i < mediaCandidates.length; i++) {
            const child = mediaCandidates[i] as HTMLElement;
            // Skip explicitly-hidden children.
            if (child.getAttribute('aria-hidden') === 'true') continue;
            const childRect = safeGetBoundingClientRect(child);
            if (childRect.width <= 0 || childRect.height <= 0) continue;
            // Skip children whose computed display/visibility hides them.
            // (Robolectric/jsdom test envs always return 'block', so this
            // is a no-op there but matters in production.)
            try {
                const cs = (element.ownerDocument?.defaultView ?? window).getComputedStyle(child);
                if (cs.display === 'none' || cs.visibility === 'hidden') continue;
            } catch {
                // No window / non-browser env — accept the child.
            }
            visibleMedia.push(child);
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
        if (
            childRect.width > rect.width ||
            childRect.height > rect.height ||
            childRect.left < rect.left ||
            childRect.top < rect.top
        ) {
            return clipToVisibleArea(childRect, visualChild as HTMLElement);
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
        const overflowMakesSense =
            display !== 'inline' && display !== 'inline-table' && display !== 'contents';
        const overflowsBox =
            overflowMakesSense &&
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
    } catch {
        // No window / non-browser env — fall back to plain box rect.
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
