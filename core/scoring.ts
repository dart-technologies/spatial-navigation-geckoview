/**
 * Scoring algorithm for GeckoView Spatial Navigation.
 *
 * Implements geometric and grid-based scoring for directional candidate selection.
 * Uses multi-pass selection with progressively relaxed constraints.
 *
 * See {@link SCORING_CONSTANTS} in `core/config.ts` for the score-weight hierarchy
 * — the comments there explain *why* `SAME_GROUP_BONUS > GROUP_ENTER_LAST_BONUS >
 * GRID_BONUS > scroll-related nudges` is the right ordering.
 */

import { updateEntryGeometry, isRectVisible } from './geometry';
import {
    getConfig,
    SCORING_CONSTANTS,
    type Direction,
    type DistanceFunction,
    type ScoringMode,
} from './config';
import type { SpatialNavState, FocusableEntry } from './state';
import { getEffectiveScoringMode, hasNavigationContainment } from '../utils/css-properties';
import { createLogger } from '../utils/logger';

const log = createLogger('Scoring');

export interface DirectionalMetrics {
    primary: number;
    secondary: number;
    distance: number;
    alignment: number;
    deltaX: number;
    deltaY: number;
    gridAligned: boolean;
}

export interface ScoringOptions {
    strictEdges?: boolean;
    allowOverlap?: boolean;
    requireViewport?: boolean;
    viewportMargin?: number;
    alignmentWeight?: number;
    distanceWeight?: number;
    preferScrollGroup?: boolean;
    overlapThreshold?: number;
    distanceFunction?: DistanceFunction;
    scoringMode?: ScoringMode;
}

export interface NavigationCandidate {
    index: number;
    data: FocusableEntry;
    rect: DOMRect;
    score: number;
    metrics: DirectionalMetrics;
    passIndex?: number;
}

/**
 * Calculate distance between two points using specified function.
 */
export function calculateDistance(
    dx: number,
    dy: number,
    method: DistanceFunction | undefined,
    direction: Direction | null
): number {
    switch (method) {
        case 'manhattan':
            return Math.abs(dx) + Math.abs(dy);
        case 'projected':
            // Project distance along navigation axis (WICG-style).
            // Weight the secondary axis lightly to prefer aligned candidates.
            if (direction) {
                const primary = direction.axis === 'x' ? Math.abs(dx) : Math.abs(dy);
                const secondary = direction.axis === 'x' ? Math.abs(dy) : Math.abs(dx);
                return primary + secondary * SCORING_CONSTANTS.PROJECTED_SECONDARY_WEIGHT;
            }
            return Math.sqrt(dx * dx + dy * dy);
        case 'euclidean':
        default:
            return Math.sqrt(dx * dx + dy * dy);
    }
}

/**
 * Check if two elements are in the same grid row/column.
 * Used for grid mode navigation.
 */
export function isGridAligned(
    current: FocusableEntry,
    candidate: FocusableEntry,
    direction: Direction,
    tolerance: number
): boolean {
    if (direction.axis === 'x') {
        // Horizontal nav: same row → vertical alignment
        const currentMidY = (current.top + current.bottom) / 2;
        const candidateMidY = (candidate.top + candidate.bottom) / 2;
        return Math.abs(currentMidY - candidateMidY) <= tolerance;
    } else {
        // Vertical nav: same column → horizontal alignment
        const currentMidX = (current.left + current.right) / 2;
        const candidateMidX = (candidate.left + candidate.right) / 2;
        return Math.abs(currentMidX - candidateMidX) <= tolerance;
    }
}

/**
 * Compute directional metrics for a candidate element.
 */
export function computeDirectionalMetrics(
    current: FocusableEntry,
    candidate: FocusableEntry,
    direction: Direction,
    options: ScoringOptions
): DirectionalMetrics | null {
    const config = getConfig();
    const axis = direction.axis;
    const sign = direction.sign;
    const strictEdges = options.strictEdges !== false;
    const allowOverlap = options.allowOverlap === true;
    const overlapThreshold = options.overlapThreshold ?? config.overlapThreshold ?? 0;
    const distanceFunction = options.distanceFunction ?? config.distanceFunction ?? 'euclidean';
    const edgeEps = SCORING_CONSTANTS.EDGE_EPS_BASE + overlapThreshold;

    // Strict edge containment (pass 1)
    if (strictEdges) {
        if (axis === 'x') {
            if (sign > 0 && candidate.left < current.right - edgeEps) return null;
            if (sign < 0 && candidate.right > current.left + edgeEps) return null;
        } else {
            if (sign > 0 && candidate.top < current.bottom - edgeEps) return null;
            if (sign < 0 && candidate.bottom > current.top + edgeEps) return null;
        }
    }

    const deltaX = candidate.centerX - current.centerX;
    const deltaY = candidate.centerY - current.centerY;
    const forwardThreshold = allowOverlap
        ? -(SCORING_CONSTANTS.FORWARD_OVERLAP_TOLERANCE_PX + overlapThreshold)
        : SCORING_CONSTANTS.EPSILON;

    // Forward movement check
    if (axis === 'x') {
        if (sign > 0 && deltaX <= forwardThreshold) return null;
        if (sign < 0 && deltaX >= -forwardThreshold) return null;
    } else {
        if (sign > 0 && deltaY <= forwardThreshold) return null;
        if (sign < 0 && deltaY >= -forwardThreshold) return null;
    }

    const primary = Math.abs(axis === 'x' ? deltaX : deltaY);
    const secondary = Math.abs(axis === 'x' ? deltaY : deltaX);
    const distance = calculateDistance(deltaX, deltaY, distanceFunction, direction);

    // Cone check: reject candidates too far off-axis.
    const coneTolerance = Math.max(
        SCORING_CONSTANTS.CONE_TOLERANCE_BASE_PX,
        primary * SCORING_CONSTANTS.CONE_TOLERANCE_RATIO
    );
    if (secondary > coneTolerance) return null;

    // Alignment score: higher = more aligned. Decays linearly until hitting 0.
    const alignment =
        secondary === 0
            ? SCORING_CONSTANTS.ALIGNMENT_BASE
            : Math.max(
                  0,
                  SCORING_CONSTANTS.ALIGNMENT_BASE - secondary / SCORING_CONSTANTS.ALIGNMENT_DECAY_PX
              );

    const gridAligned = isGridAligned(current, candidate, direction, config.gridAlignmentTolerance);

    return {
        primary,
        secondary,
        distance,
        alignment,
        deltaX,
        deltaY,
        gridAligned,
    };
}

/**
 * Choose the best candidate from all focusables for a given direction.
 * Supports both geometric and grid scoring modes.
 * Respects CSS --spatial-navigation-* properties when enabled.
 */
export function chooseBestCandidate(
    currentIndex: number,
    direction: Direction,
    options: ScoringOptions,
    state: SpatialNavState
): NavigationCandidate | null {
    const config = getConfig();
    const currentEntry = state.focusables[currentIndex];
    if (!currentEntry || !currentEntry.element) {
        return null;
    }
    updateEntryGeometry(currentEntry, state);

    const strictEdges = options.strictEdges !== false;
    const allowOverlap = options.allowOverlap === true;
    const requireViewport = options.requireViewport !== false;
    const viewportMargin = options.viewportMargin ?? 0;
    const alignmentWeight = options.alignmentWeight ?? SCORING_CONSTANTS.ALIGNMENT_BASE;
    const distanceWeight = options.distanceWeight ?? 1;
    const preferScrollGroup = options.preferScrollGroup !== false;

    const effectiveScoringMode =
        config.useCSSProperties && currentEntry.element
            ? getEffectiveScoringMode(currentEntry.element)
            : (options.scoringMode ?? config.scoringMode ?? 'geometric');
    const gridBonus = effectiveScoringMode === 'grid' ? SCORING_CONSTANTS.GRID_BONUS : 0;

    const containmentInfo =
        config.useCSSProperties && currentEntry.element
            ? hasNavigationContainment(currentEntry.element)
            : { contained: false, container: null };

    const candidates: NavigationCandidate[] = [];

    for (let i = 0; i < state.focusables.length; i++) {
        if (i === currentIndex) continue;

        const candidateEntry = state.focusables[i];
        if (!candidateEntry || !candidateEntry.element) continue;

        updateEntryGeometry(candidateEntry, state);

        const minSize = config.minElementSize || 1;
        if (!candidateEntry.rect || candidateEntry.width < minSize || candidateEntry.height < minSize) {
            continue;
        }

        if (requireViewport && !isRectVisible(candidateEntry.rect, viewportMargin)) {
            continue;
        }

        // CSS containment: stay within the container if current element is contained.
        if (containmentInfo.contained && containmentInfo.container && candidateEntry.element) {
            if (!containmentInfo.container.contains(candidateEntry.element)) {
                continue;
            }
        }

        const metrics = computeDirectionalMetrics(currentEntry, candidateEntry, direction, {
            strictEdges,
            allowOverlap,
            overlapThreshold: options.overlapThreshold,
            distanceFunction: options.distanceFunction,
        });

        if (!metrics) continue;

        // Linear score: lower = better. Primary axis dominates by 1000x.
        let score =
            metrics.primary * SCORING_CONSTANTS.PRIMARY_WEIGHT +
            metrics.secondary * alignmentWeight +
            metrics.distance * distanceWeight;

        if (gridBonus && metrics.gridAligned) {
            score -= gridBonus;
        }

        // Focus group logic — see SCORING_CONSTANTS for the bonus hierarchy rationale.
        const currentGroupId = currentEntry.groupId;
        const candidateGroupId = candidateEntry.groupId;

        if (currentGroupId) {
            const currentGroup = state.focusGroups[currentGroupId];
            const isSameGroup = currentGroupId === candidateGroupId;

            // Boundary: contain → don't allow crossing the group's boundary
            if (currentGroup && currentGroup.options.boundary === 'contain' && !isSameGroup) {
                continue;
            }

            if (isSameGroup) {
                score -= SCORING_CONSTANTS.SAME_GROUP_BONUS;
            }
        }

        if (candidateGroupId && candidateGroupId !== currentGroupId) {
            const candidateGroup = state.focusGroups[candidateGroupId];
            // enterMode=last: only allow entry via the remembered last-focused element.
            if (candidateGroup && candidateGroup.options.enterMode === 'last' && candidateGroup.lastFocused) {
                if (candidateEntry.element !== candidateGroup.lastFocused.element) {
                    continue;
                }
                score -= SCORING_CONSTANTS.GROUP_ENTER_LAST_BONUS;
            }
        }

        if (preferScrollGroup) {
            if (candidateEntry.scrollKey && candidateEntry.scrollKey === currentEntry.scrollKey) {
                score -= SCORING_CONSTANTS.SAME_SCROLL_BONUS;
            } else {
                score += SCORING_CONSTANTS.DIFFERENT_SCROLL_PENALTY;
            }
        }

        if (!isRectVisible(candidateEntry.rect, 0)) {
            score += SCORING_CONSTANTS.OFFSCREEN_PENALTY;
        }

        candidates.push({
            index: i,
            data: candidateEntry,
            rect: candidateEntry.rect,
            score,
            metrics,
        });
    }

    if (!candidates.length) return null;

    // Sort by score (lower wins), then distance as tiebreaker.
    candidates.sort((a, b) => {
        if (effectiveScoringMode === 'grid') {
            if (a.metrics.gridAligned !== b.metrics.gridAligned) {
                return a.metrics.gridAligned ? -1 : 1;
            }
        }
        if (a.score !== b.score) {
            return a.score - b.score;
        }
        return a.metrics.distance - b.metrics.distance;
    });

    return candidates[0];
}

/**
 * Find directional candidate using multi-pass selection.
 * Uses progressively relaxed constraints across 3 passes; each pass exits
 * early on first hit. Wraps to the opposite edge if `wrapNavigation` is set
 * and no candidate is found.
 */
export function findDirectionalCandidate(
    currentIndex: number,
    direction: Direction | null,
    state: SpatialNavState
): NavigationCandidate | null {
    if (!direction) return null;

    const passes: ScoringOptions[] = [
        // Pass 1: strict — same viewport, strict edges
        {
            strictEdges: true,
            allowOverlap: false,
            requireViewport: true,
            viewportMargin: 0,
            alignmentWeight: 10,
            distanceWeight: 1,
            preferScrollGroup: true,
        },
        // Pass 2: relaxed — wider viewport, allow overlap
        {
            strictEdges: false,
            allowOverlap: true,
            requireViewport: true,
            viewportMargin: 160,
            alignmentWeight: 8,
            distanceWeight: 0.9,
            preferScrollGroup: true,
        },
        // Pass 3: permissive — any element, no viewport requirement
        {
            strictEdges: false,
            allowOverlap: true,
            requireViewport: false,
            viewportMargin: 0,
            alignmentWeight: 6,
            distanceWeight: 0.7,
            preferScrollGroup: false,
        },
    ];

    for (let i = 0; i < passes.length; i++) {
        const candidate = chooseBestCandidate(currentIndex, direction, passes[i], state);
        if (candidate) {
            candidate.passIndex = i;
            return candidate;
        }
    }

    log.debug(`no candidate for ${direction.name} after ${passes.length} passes`);

    const config = getConfig();
    if (config.wrapNavigation) {
        return findWrapCandidate(currentIndex, direction, state);
    }
    return null;
}

/**
 * Find wrap navigation candidate — returns element at the opposite edge.
 * Used when wrapNavigation is enabled and normal navigation hits a boundary.
 */
export function findWrapCandidate(
    currentIndex: number,
    direction: Direction,
    state: SpatialNavState
): NavigationCandidate | null {
    const currentEntry = state.focusables[currentIndex];
    if (!currentEntry || !currentEntry.element) return null;

    updateEntryGeometry(currentEntry, state);
    const config = getConfig();

    const useGridAlignment = config.scoringMode === 'grid';
    const tolerance = config.gridAlignmentTolerance;

    const candidates: Array<{
        index: number;
        data: typeof currentEntry;
        position: number;
        gridAligned: boolean;
    }> = [];

    for (let i = 0; i < state.focusables.length; i++) {
        if (i === currentIndex) continue;

        const entry = state.focusables[i];
        if (!entry || !entry.element) continue;

        updateEntryGeometry(entry, state);
        if (!entry.rect || entry.width <= 1 || entry.height <= 1) continue;

        const gridAligned = useGridAlignment
            ? isGridAligned(currentEntry, entry, direction, tolerance)
            : false;

        // Position value chooses element at opposite edge:
        //   down  → smallest top   (topmost)
        //   up    → largest bottom (bottommost)
        //   right → smallest left  (leftmost)
        //   left  → largest right  (rightmost)
        let position: number;
        switch (direction.name) {
            case 'down':
                position = entry.top;
                break;
            case 'up':
                position = -entry.bottom;
                break;
            case 'right':
                position = entry.left;
                break;
            case 'left':
                position = -entry.right;
                break;
        }

        candidates.push({ index: i, data: entry, position, gridAligned });
    }

    if (!candidates.length) return null;

    candidates.sort((a, b) => {
        if (useGridAlignment && a.gridAligned !== b.gridAligned) {
            return a.gridAligned ? -1 : 1;
        }
        return a.position - b.position;
    });

    const best = candidates[0];

    return {
        index: best.index,
        data: best.data,
        rect: best.data.rect!,
        score: 0,
        metrics: {
            primary: 0,
            secondary: 0,
            distance: 0,
            alignment: 0,
            deltaX: 0,
            deltaY: 0,
            gridAligned: best.gridAligned,
        },
        passIndex: -1, // wrap pass marker
    };
}
