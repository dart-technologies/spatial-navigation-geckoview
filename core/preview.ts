/**
 * Preview management for Spatial Navigation System
 *
 * Manages directional preview indicators showing where focus will move.
 * Includes disabled state animation for boundary conditions.
 */

import type { SpatialNavState } from './state';
import type { Direction, DirectionMap } from './config';
import type { NavigationCandidate, ScoringOptions } from './scoring';

const previewDirectionKeys = ['up', 'down', 'left', 'right'] as const;
type PreviewDirection = typeof previewDirectionKeys[number];

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
                arrow: arrow
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
    const size = Math.max(16, Math.min(32, Math.round(Math.min(currentRect.width, currentRect.height) * 0.35)));
    const offset = Math.max(8, Math.round(size * 0.6));
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

function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
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

    const size = Math.max(14, Math.min(26, Math.round(Math.min(currentRect.width, currentRect.height) * 0.28)));
    const offset = Math.max(10, Math.round(size * 0.75));

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
    const safe = Math.max(0, safeAreaMargin || 0);
    left = clamp(left, safe, Math.max(safe, viewportW - safe - size));
    top = clamp(top, safe, Math.max(safe, viewportH - safe - size));

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
export function triggerNoTargetAnimation(direction: string, currentRect: DOMRect | null, state: SpatialNavState): void {
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
    previewDirectionKeys.forEach(function (direction) {
        const dir = directionByName[direction];
        result[direction] = findDirectionalCandidate(currentIndex, dir, state);
    });
    state.nextTargets = result;

    if ((window as any).flutterSpatialNavDebug) {
        const desc = (c: NavigationCandidate | null) => c?.data?.element ? (c.data.element.tagName.toLowerCase() + (c.data.element.id ? '#' + c.data.element.id : '') + (c.data.element.textContent ? ` ("${c.data.element.textContent.trim().substring(0, 15)}")` : '')) : 'null';
        // console.log(`[SpatialNav] Targets for focus #${currentIndex}: UP=${desc(result.up)}, DOWN=${desc(result.down)}, LEFT=${desc(result.left)}, RIGHT=${desc(result.right)}`);
    }

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

    // Unused but kept for API compatibility or future use
    const _rect =
        currentRect && typeof currentRect.left === 'number'
            ? currentRect
            : currentElement.getBoundingClientRect();

    const targets = updatePreviewTargets(state.currentIndex, findDirectionalCandidate, directionByName, state);

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
