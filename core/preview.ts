/**
 * Preview management for Spatial Navigation System
 *
 * Manages directional preview indicators showing where focus will move.
 * Includes disabled state animation for boundary conditions.
 */

import type { SpatialNavState } from './state';
import type { Direction, DirectionMap } from './config';
import type { NavigationCandidate, ScoringOptions } from './scoring';
import { calculateVisualRect } from './geometry';

const previewDirectionKeys = ['up', 'down', 'left', 'right'] as const;

/**
 * Constant gap (in CSS pixels) between the focus ring's outer edge and
 * the chevron's near edge. Matches the default `outline-width (3) +
 * outline-offset (3) + 8` of breathing room, so the chevron renders at
 * roughly the same visible distance from the ring across all focused
 * elements regardless of their size. Previously this was proportional
 * to chevron size, which produced visibly inconsistent gaps (tighter on
 * small buttons, wider on large images).
 */
const CHEVRON_RING_GAP = 14;
type PreviewDirection = (typeof previewDirectionKeys)[number];

interface PreviewElement {
    container: HTMLElement;
    arrow: HTMLElement;
}

type PreviewElements = Record<PreviewDirection, PreviewElement>;

type FindCandidateFn = (
    currentIndex: number,
    direction: Direction,
    state: SpatialNavState,
    options?: ScoringOptions
) => NavigationCandidate | null;

type DescribeElementFn = (element: Element | null) => string;

/**
 * Create or retrieve preview elements for all directions.
 *
 * @param state - Global state object
 * @returns Preview elements by direction
 */
export function ensurePreviewElements(state: SpatialNavState): PreviewElements | null {
    if (!state.previewLayer) {
        return null;
    }
    if (!state.previewElements) {
        const elements = {} as PreviewElements;
        previewDirectionKeys.forEach(function (direction) {
            const container = document.createElement('div');
            container.className = 'focus-preview focus-preview-' + direction;
            container.dataset.direction = direction;
            const arrow = document.createElement('div');
            arrow.className = 'focus-preview-arrow';
            container.appendChild(arrow);
            state.previewLayer!.appendChild(container);
            elements[direction] = {
                container: container,
                arrow: arrow,
            };
        });
        state.previewElements = elements;
    }
    return state.previewElements;
}

/**
 * Hide all preview elements.
 *
 * @param state - Global state object
 */
export function hidePreviewElements(state: SpatialNavState): void {
    if (!state.previewElements) {
        return;
    }
    previewDirectionKeys.forEach(function (direction) {
        const entry = state.previewElements![direction];
        if (entry && entry.container) {
            entry.container.className = 'focus-preview focus-preview-' + direction;
            entry.container.style.left = '';
            entry.container.style.top = '';
            entry.container.style.width = '';
            entry.container.style.height = '';
            entry.container.removeAttribute('data-target');
            if (entry.arrow) {
                entry.arrow.style.display = '';
            }
        }
    });
}

/**
 * Show disabled preview (no target in direction).
 *
 * @param entry - Preview element entry
 * @param direction - Direction name
 * @param currentRect - Current element rect
 */
function showDisabledPreview(entry: PreviewElement, direction: string, currentRect: DOMRect | null): void {
    if (!entry || !entry.container || !currentRect) {
        return;
    }
    const size = Math.max(
        16,
        Math.min(32, Math.round(Math.min(currentRect.width, currentRect.height) * 0.35))
    );
    // Constant gap from the ring, matching `showChevronPreview` so the
    // disabled-state preview animates from the same distance.
    const offset = CHEVRON_RING_GAP;
    let left = currentRect.left;
    let top = currentRect.top;

    switch (direction) {
        case 'right':
            left = currentRect.right + offset;
            top = currentRect.top + currentRect.height / 2 - size / 2;
            break;
        case 'left':
            left = currentRect.left - offset - size;
            top = currentRect.top + currentRect.height / 2 - size / 2;
            break;
        case 'down':
            left = currentRect.left + currentRect.width / 2 - size / 2;
            top = currentRect.bottom + offset;
            break;
        case 'up':
            left = currentRect.left + currentRect.width / 2 - size / 2;
            top = currentRect.top - offset - size;
            break;
        default:
            break;
    }

    entry.container.style.left = left + 'px';
    entry.container.style.top = top + 'px';
    entry.container.style.width = size + 'px';
    entry.container.style.height = size + 'px';
    entry.container.style.opacity = '';
    entry.container.className = 'focus-preview focus-preview-' + direction + ' disabled show';
    entry.container.removeAttribute('data-target');
    if (entry.arrow) {
        entry.arrow.style.display = 'none';
    }
}

function showChevronPreview(
    entry: PreviewElement,
    direction: string,
    currentRect: DOMRect | null,
    safeAreaMargin = 0
): void {
    if (!entry || !entry.container || !currentRect) {
        return;
    }

    const size = Math.max(
        14,
        Math.min(26, Math.round(Math.min(currentRect.width, currentRect.height) * 0.28))
    );
    // Constant chevron-to-ring gap regardless of focused-element size.
    // The previous `offset = max(10, round(size * 0.75))` formula scaled
    // the gap with chevron size, so a small button got a ~11px gap and
    // a large image got a ~17px gap — visually inconsistent (most
    // noticeable on the Dart logo: its ring uses the 200×80 image rect
    // → larger chevron → wider gap; adjacent small links had a tight
    // gap). A constant offset matches the ring's own outline extent
    // (outline width + outline-offset) so the chevron always appears
    // the same fixed distance outside the ring.
    const offset = CHEVRON_RING_GAP;

    let left = currentRect.left;
    let top = currentRect.top;

    switch (direction) {
        case 'right':
            left = currentRect.right + offset;
            top = currentRect.top + currentRect.height / 2 - size / 2;
            break;
        case 'left':
            left = currentRect.left - offset - size;
            top = currentRect.top + currentRect.height / 2 - size / 2;
            break;
        case 'down':
            left = currentRect.left + currentRect.width / 2 - size / 2;
            top = currentRect.bottom + offset;
            break;
        case 'up':
            left = currentRect.left + currentRect.width / 2 - size / 2;
            top = currentRect.top - offset - size;
            break;
        default:
            break;
    }

    const viewportW = window?.innerWidth ?? 0;
    const viewportH = window?.innerHeight ?? 0;

    // The chevron's viewport-hide threshold is derived from the ring's
    // own geometry (`outlineExtent + CHEVRON_RING_GAP`) rather than
    // `safeAreaMargin`. Rationale: `safeAreaMargin` historically meant
    // "the ring stays this far from the viewport edge", but as of the
    // Bug-2 fix the ring is allowed to extend to within `-outlineExtent`
    // of the edge. Using `safeAreaMargin` for chevron clearance would
    // create an inconsistency where the ring can paint at the edge but
    // the chevron is required to stay 12px in. Use a small fixed
    // viewport padding so the chevron has breathing room without
    // depending on a knob that's been retired for ring sizing.
    //
    // `safeAreaMargin` is still consumed by `updateFocusLabel` (the
    // floating debug-label inset). If you want to push the chevron
    // further from the edge, raise `CHEVRON_RING_GAP`.
    //
    // Previously this block clamped the chevron INTO `safeAreaMargin`,
    // which on edge-flush content placed the chevron ON TOP of the
    // focused content. The hide-instead-of-clamp behaviour below stays;
    // only the threshold changed.
    void safeAreaMargin; // kept in signature for back-compat, no longer used here
    const CHEVRON_VIEWPORT_PAD = 4;
    const fitsHorizontally = left >= CHEVRON_VIEWPORT_PAD && left + size <= viewportW - CHEVRON_VIEWPORT_PAD;
    const fitsVertically = top >= CHEVRON_VIEWPORT_PAD && top + size <= viewportH - CHEVRON_VIEWPORT_PAD;
    if (!fitsHorizontally || !fitsVertically) {
        entry.container.style.left = '';
        entry.container.style.top = '';
        entry.container.style.width = '';
        entry.container.style.height = '';
        entry.container.style.opacity = '';
        entry.container.className = 'focus-preview focus-preview-' + direction;
        if (entry.arrow) {
            entry.arrow.style.display = '';
        }
        return;
    }

    entry.container.style.left = left + 'px';
    entry.container.style.top = top + 'px';
    entry.container.style.width = size + 'px';
    entry.container.style.height = size + 'px';
    entry.container.style.opacity = '';
    entry.container.className = 'focus-preview focus-preview-' + direction + ' show';
    if (entry.arrow) {
        entry.arrow.style.display = '';
    }
}

/**
 * Trigger "no target" animation when no element found in direction.
 *
 * @param direction - Direction name
 * @param currentRect - Current element rect
 * @param state - Global state object
 */
export function triggerNoTargetAnimation(
    direction: string,
    currentRect: DOMRect | null,
    state: SpatialNavState
): void {
    // Basic direction validation
    if (!direction || !previewDirectionKeys.includes(direction as PreviewDirection)) {
        return;
    }
    const validDirection = direction as PreviewDirection;

    const elements = ensurePreviewElements(state);
    if (!elements) {
        return;
    }
    const entry = elements[validDirection];
    if (!entry || !entry.container) {
        return;
    }
    showDisabledPreview(entry, validDirection, currentRect);

    if (!state.noTargetTimers) {
        state.noTargetTimers = {};
    }
    if (state.noTargetTimers[validDirection]) {
        clearTimeout(state.noTargetTimers[validDirection]!);
    }
    state.noTargetTimers[validDirection] = setTimeout(function () {
        if (entry.container) {
            entry.container.className = 'focus-preview focus-preview-' + validDirection;
            entry.container.style.left = '';
            entry.container.style.top = '';
            entry.container.style.width = '';
            entry.container.style.height = '';
            entry.container.style.opacity = '';
            if (entry.arrow) {
                entry.arrow.style.display = '';
            }
        }
        state.noTargetTimers![validDirection] = null;
    }, 320);
}

interface TargetsMap {
    up: NavigationCandidate | null;
    down: NavigationCandidate | null;
    left: NavigationCandidate | null;
    right: NavigationCandidate | null;
}

/**
 * Update preview targets for all directions.
 *
 * @param currentIndex - Index of current focused element
 * @param findDirectionalCandidate - Function to find candidate
 * @param directionByName - Direction objects by name
 * @param state - Global state object
 * @returns Targets by direction
 */
export function updatePreviewTargets(
    currentIndex: number,
    findDirectionalCandidate: FindCandidateFn,
    directionByName: DirectionMap,
    state: SpatialNavState
): TargetsMap {
    const result = {} as TargetsMap;
    if (typeof currentIndex !== 'number' || currentIndex < 0 || !state.focusables.length) {
        previewDirectionKeys.forEach(function (direction) {
            result[direction] = null;
        });
        state.nextTargets = result;
        return result;
    }
    // When `boundaryScrollBehavior` is `'scroll'`, a vertical press that
    // hits the boundary triggers `window.scrollBy` — the press IS
    // actionable even with no in-viewport candidate. Show the chevron in
    // that case so the user has a hint of the scroll affordance.
    // Horizontal directions stay strict (no horizontal scroll-on-boundary).
    const scrollOnBoundary = state.config.boundaryScrollBehavior === 'scroll';

    previewDirectionKeys.forEach(function (direction) {
        const dir = directionByName[direction];
        const candidate = findDirectionalCandidate(currentIndex, dir, state);
        // Drop pass-(-1) (wrap-around) — surprising teleport across
        // the page, never represent as a chevron.
        if (candidate && candidate.passIndex === -1) {
            result[direction] = null;
            return;
        }
        // Drop pass-2 ("wide-net, requireViewport:false") chevrons UNLESS
        // (a) `boundaryScrollBehavior` is `'scroll'` AND (b) direction is
        // vertical — in which case the press will scroll the viewport
        // toward the target. Without (a)+(b), pass-2 chevrons would
        // mislead: they'd point to off-screen targets that the move path
        // could reach but the user wouldn't visually expect.
        //
        // Rationale: the move path (handleKeyDown → moveInDirection) calls
        // findDirectionalCandidate directly without this filter, so it can
        // STILL reach those wide-net targets when the user presses an arrow.
        // Filtering at the preview layer (not the move layer) keeps the
        // chevrons honest about close-by reachable targets.
        if (candidate && candidate.passIndex === 2) {
            const isVerticalScroll = scrollOnBoundary && (direction === 'up' || direction === 'down');
            if (!isVerticalScroll) {
                result[direction] = null;
                return;
            }
        }
        result[direction] = candidate;
    });
    state.nextTargets = result;
    return result;
}

/**
 * Update preview visuals based on current focus and available targets.
 *
 * @param currentElement - Currently focused element
 * @param currentRect - Current element rect
 * @param findDirectionalCandidate - Function to find candidates
 * @param directionByName - Direction objects by name
 * @param describeElement - Function to describe element for data attr
 * @param state - Global state object
 */
export function updatePreviewVisuals(
    currentElement: HTMLElement | null,
    currentRect: DOMRect | null,
    findDirectionalCandidate: FindCandidateFn,
    directionByName: DirectionMap,
    describeElement: DescribeElementFn,
    state: SpatialNavState
): void {
    const elements = ensurePreviewElements(state);
    if (!elements) {
        state.nextTargets = { up: null, down: null, left: null, right: null };
        return;
    }
    if (!state.previewEnabled || !currentElement) {
        hidePreviewElements(state);
        state.nextTargets = { up: null, down: null, left: null, right: null };
        return;
    }

    // CRITICAL: chevrons must be positioned against the SAME rect that
    // the focus ring uses — the visual rect from `calculateVisualRect`.
    // The ring expands to cover overflowing images (logos, image-buttons)
    // and shrinks to fit the dominant image inside a wrapper. Using
    // `getBoundingClientRect()` here previously produced two visible
    // bugs:
    //
    //   - Dart-logo class: focused `<a>` had a small (24×24) hit area
    //     but the `<img>` inside was 200×80. Ring rendered around the
    //     200×80 image; chevron positioned against the 24×24 hit area
    //     landed bottom-right of the ring instead of vertically centred.
    //   - "Chevron sometimes still inside the ring at edges": the
    //     `fitsHorizontally/Vertically` check in `showChevronPreview`
    //     used the smaller rect to compute "is there room outside?".
    //     The ring's actual extent was larger, so chevrons that fit
    //     outside the smaller rect ended up inside the larger ring.
    //
    // We unconditionally use the visual rect. The `currentRect`
    // parameter is retained for API compatibility but ignored —
    // callers who construct a rect manually are out of luck, but no
    // production caller does so; all paths flow from the focused
    // element which `calculateVisualRect` can reconstruct.
    void currentRect;
    const _rect = calculateVisualRect(currentElement);

    const targets = updatePreviewTargets(
        state.currentIndex,
        findDirectionalCandidate,
        directionByName,
        state
    );

    previewDirectionKeys.forEach(function (direction) {
        const entry = elements[direction];
        if (!entry || !entry.container) {
            return;
        }
        const candidate = targets[direction];
        if (!candidate || !candidate.data || !candidate.data.element) {
            if (entry.container.className.indexOf('disabled') === -1) {
                entry.container.className = 'focus-preview focus-preview-' + direction;
                entry.container.style.left = '';
                entry.container.style.top = '';
                entry.container.style.width = '';
                entry.container.style.height = '';
                entry.container.style.opacity = '';
                entry.container.removeAttribute('data-target');
            }
            if (entry.arrow) {
                entry.arrow.style.display = '';
            }
            return;
        }

        // Show directional chevrons around the current focus ring (TV-friendly, low clutter).
        showChevronPreview(entry, direction, _rect, state.config.safeAreaMargin ?? 0);
        entry.container.setAttribute('data-target', describeElement(candidate.data.element));
    });
}
