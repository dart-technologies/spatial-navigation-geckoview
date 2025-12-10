/**
 * Scoring algorithm for GeckoView Spatial Navigation System
 *
 * Implements geometric and grid-based scoring for directional candidate selection.
 * Uses multi-pass selection with progressively relaxed constraints.
 *
 * Features:
 * - Grid mode for aligned layouts (BBC LRUD-inspired)
 * - Multiple distance functions (euclidean, manhattan, projected)
 * - Configurable overlap threshold
 * - CSS custom property integration
 */

import { updateEntryGeometry, isRectVisible } from './geometry';
import { getConfig, type Direction, type DistanceFunction, type ScoringMode } from './config';
import type { SpatialNavState, FocusableEntry } from './state';
import { getEffectiveScoringMode, hasNavigationContainment } from '../utils/css-properties';
import { describeElement } from '../utils/dom';

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
            // Project distance along navigation axis (WICG-style)
            if (direction) {
                const primary = direction.axis === 'x' ? Math.abs(dx) : Math.abs(dy);
                const secondary = direction.axis === 'x' ? Math.abs(dy) : Math.abs(dx);
                // Weight primary axis 2x to prefer aligned elements
                return primary + secondary * 0.5;
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
        // Horizontal navigation: check if on same row (vertical alignment)
        const currentMidY = (current.top + current.bottom) / 2;
        const candidateMidY = (candidate.top + candidate.bottom) / 2;
        return Math.abs(currentMidY - candidateMidY) <= tolerance;
    } else {
        // Vertical navigation: check if on same column (horizontal alignment)
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
    const EPSILON = 1;
    const EDGE_EPS = 4 + overlapThreshold;

    const candDesc = describeElement(candidate.element);

    // Strict edge checking (pass 1)
    if (strictEdges) {
        if (axis === 'x') {
            if (sign > 0 && candidate.left < current.right - EDGE_EPS) {
                // if ((window as any).flutterSpatialNavDebug) console.log(`[SpatialNav] Reject ${candDesc}: strictEdge right (cand.left ${candidate.left.toFixed(1)} < curr.right ${current.right.toFixed(1)})`);
                return null;
            }
            if (sign < 0 && candidate.right > current.left + EDGE_EPS) {
                // if ((window as any).flutterSpatialNavDebug) console.log(`[SpatialNav] Reject ${candDesc}: strictEdge left (cand.right ${candidate.right.toFixed(1)} > curr.left ${current.left.toFixed(1)})`);
                return null;
            }
        } else {
            if (sign > 0 && candidate.top < current.bottom - EDGE_EPS) {
                // if ((window as any).flutterSpatialNavDebug) console.log(`[SpatialNav] Reject ${candDesc}: strictEdge down (cand.top ${candidate.top.toFixed(1)} < curr.bottom ${current.bottom.toFixed(1)})`);
                return null;
            }
            if (sign < 0 && candidate.bottom > current.top + EDGE_EPS) {
                // if ((window as any).flutterSpatialNavDebug) console.log(`[SpatialNav] Reject ${candDesc}: strictEdge up (cand.bottom ${candidate.bottom.toFixed(1)} > curr.top ${current.top.toFixed(1)})`);
                return null;
            }
        }
    }

    const deltaX = candidate.centerX - current.centerX;
    const deltaY = candidate.centerY - current.centerY;
    const forwardThreshold = allowOverlap ? -(12 + overlapThreshold) : EPSILON;

    // Forward movement check
    if (axis === 'x') {
        if (sign > 0 && deltaX <= forwardThreshold) {
            // if ((window as any).flutterSpatialNavDebug) console.log(`[SpatialNav] Reject ${candDesc}: notForward right (deltaX ${deltaX.toFixed(1)} <= ${forwardThreshold.toFixed(1)})`);
            return null;
        }
        if (sign < 0 && deltaX >= -forwardThreshold) {
            // if ((window as any).flutterSpatialNavDebug) console.log(`[SpatialNav] Reject ${candDesc}: notForward left (deltaX ${deltaX.toFixed(1)} >= ${(-forwardThreshold).toFixed(1)})`);
            return null;
        }
    } else {
        if (sign > 0 && deltaY <= forwardThreshold) {
            // if ((window as any).flutterSpatialNavDebug) console.log(`[SpatialNav] Reject ${candDesc}: notForward down (deltaY ${deltaY.toFixed(1)} <= ${forwardThreshold.toFixed(1)})`);
            return null;
        }
        if (sign < 0 && deltaY >= -forwardThreshold) {
            // if ((window as any).flutterSpatialNavDebug) console.log(`[SpatialNav] Reject ${candDesc}: notForward up (deltaY ${deltaY.toFixed(1)} >= ${(-forwardThreshold).toFixed(1)})`);
            return null;
        }
    }

    // Calculate alignment and distance
    const primary = Math.abs(axis === 'x' ? deltaX : deltaY);
    const secondary = Math.abs(axis === 'x' ? deltaY : deltaX);
    const distance = calculateDistance(deltaX, deltaY, distanceFunction, direction);

    // Cone check: reject candidates that are too far off-axis
    if (secondary > Math.max(4, primary * 3)) {
        // if ((window as any).flutterSpatialNavDebug) console.log(`[SpatialNav] Reject ${candidate.element?.id || candidate.element?.tagName}: offAxisCone (primary ${primary.toFixed(1)}, secondary ${secondary.toFixed(1)})`);
        return null;
    }

    // Alignment score: higher is better (more aligned)
    const alignment = secondary === 0 ? 10 : Math.max(0, 10 - secondary / 50);

    // Grid alignment check
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

    // Extract options with defaults
    const strictEdges = options.strictEdges !== false;
    const allowOverlap = options.allowOverlap === true;
    const requireViewport = options.requireViewport !== false;
    const viewportMargin = options.viewportMargin ?? 0;
    const alignmentWeight = options.alignmentWeight ?? 10;
    const distanceWeight = options.distanceWeight ?? 1;
    const preferScrollGroup = options.preferScrollGroup !== false;

    // Get effective scoring mode (combines config + CSS property)
    const effectiveScoringMode = config.useCSSProperties && currentEntry.element
        ? getEffectiveScoringMode(currentEntry.element)
        : (options.scoringMode ?? config.scoringMode ?? 'geometric');
    const gridBonus = effectiveScoringMode === 'grid' ? 500 : 0;

    // Check for CSS navigation containment
    const containmentInfo = config.useCSSProperties && currentEntry.element
        ? hasNavigationContainment(currentEntry.element)
        : { contained: false, container: null };

    const candidates: NavigationCandidate[] = [];

    // Evaluate all focusables as candidates
    for (let i = 0; i < state.focusables.length; i++) {
        if (i === currentIndex) {
            continue;
        }
        const candidateEntry = state.focusables[i];
        if (!candidateEntry || !candidateEntry.element) {
            continue;
        }
        updateEntryGeometry(candidateEntry, state);

        // Skip tiny or invalid rects
        const minSize = config.minElementSize || 1;
        if (!candidateEntry.rect || candidateEntry.width < minSize || candidateEntry.height < minSize) {
            continue;
        }

        // Viewport visibility check
        if (requireViewport && !isRectVisible(candidateEntry.rect, viewportMargin)) {
            continue;
        }

        // CSS containment check: if current is contained, only allow candidates within same container
        if (containmentInfo.contained && containmentInfo.container && candidateEntry.element) {
            if (!containmentInfo.container.contains(candidateEntry.element)) {
                continue; // Skip candidates outside the navigation container
            }
        }

        // Compute directional metrics with full options
        const metrics = computeDirectionalMetrics(currentEntry, candidateEntry, direction, {
            strictEdges,
            allowOverlap,
            overlapThreshold: options.overlapThreshold,
            distanceFunction: options.distanceFunction,
        });

        if (!metrics) {
            // Log rejection reason only in debug mode or for specific IDs
            /*
            if ((window as any).flutterSpatialNavDebug) {
                console.log(`[SpatialNav] Candidate '${candidateEntry.element?.id || candidateEntry.element?.tagName}' rejected by metrics in direction ${direction.name}`);
            }
            */
            continue;
        }

        // Calculate score: lower is better
        let score =
            metrics.primary * 1000 +
            metrics.secondary * alignmentWeight +
            metrics.distance * distanceWeight;

        // Grid mode bonus for aligned elements
        if (gridBonus && metrics.gridAligned) {
            score -= gridBonus;
        }

        // Focus Group Logic
        const currentGroupId = currentEntry.groupId;
        const candidateGroupId = candidateEntry.groupId;

        if (currentGroupId) {
            const currentGroup = state.focusGroups[currentGroupId];
            const isSameGroup = currentGroupId === candidateGroupId;

            // Boundary: contain - prevent leaving group
            if (currentGroup && currentGroup.options.boundary === 'contain' && !isSameGroup) {
                continue;
            }

            // Priority: prefer staying in group
            if (isSameGroup) {
                score -= 2000;
            }
        }

        // Group Entry Logic
        if (candidateGroupId && candidateGroupId !== currentGroupId) {
            const candidateGroup = state.focusGroups[candidateGroupId];
            // If entering a group with 'last' mode, only allow entry via lastFocused
            if (candidateGroup && candidateGroup.options.enterMode === 'last' && candidateGroup.lastFocused) {
                if (candidateEntry.element !== candidateGroup.lastFocused.element) {
                    continue;
                }
                score -= 1000;
            }
        }

        // Prefer elements in same scroll container
        if (preferScrollGroup) {
            if (candidateEntry.scrollKey && candidateEntry.scrollKey === currentEntry.scrollKey) {
                score -= 150;
            } else {
                score += 75;
            }
        }

        // Penalty for off-screen elements
        if (!isRectVisible(candidateEntry.rect, 0)) {
            score += 120;
        }

        if ((window as any).flutterSpatialNavDebug) {
            // console.log(`[SpatialNav] Candidate '${candidateEntry.element?.id || candidateEntry.element?.tagName}' ACCEPTED for ${direction.name}. Score: ${score.toFixed(1)} (P=${metrics.primary.toFixed(1)}, S=${metrics.secondary.toFixed(1)}, D=${metrics.distance.toFixed(1)})`);
        }

        candidates.push({
            index: i,
            data: candidateEntry,
            rect: candidateEntry.rect,
            score,
            metrics,
        });
    }

    if (!candidates.length) {
        return null;
    }

    // Sort by score (lower is better), then by distance
    candidates.sort((a, b) => {
        // Grid mode: grid-aligned elements first
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
 * Uses progressively relaxed constraints across 3 passes.
 * If wrapNavigation is enabled and no candidate found, wraps to opposite edge.
 */
export function findDirectionalCandidate(
    currentIndex: number,
    direction: Direction | null,
    state: SpatialNavState
): NavigationCandidate | null {
    if (!direction) {
        return null;
    }

    const currentEntry = state.focusables[currentIndex];
    if (currentEntry && (window as any).flutterSpatialNavDebug) {
        // console.log(`[SpatialNav] findDirectionalCandidate: dir=${direction.name}, focus=${describeElement(currentEntry.element)}, rect=[L:${currentEntry.left.toFixed(1)}, T:${currentEntry.top.toFixed(1)}, R:${currentEntry.right.toFixed(1)}, B:${currentEntry.bottom.toFixed(1)}], center=(${currentEntry.centerX.toFixed(1)}, ${currentEntry.centerY.toFixed(1)})`);
        // console.log(`[SpatialNav] Viewport: ${window.innerWidth}x${window.innerHeight}, Total focusables: ${state.focusables.length}`);
    }

    // Three-pass selection with progressively relaxed constraints
    const passes: ScoringOptions[] = [
        // Pass 1: Strict - same viewport, strict edges
        {
            strictEdges: true,
            allowOverlap: false,
            requireViewport: true,
            viewportMargin: 0,
            alignmentWeight: 10,
            distanceWeight: 1,
            preferScrollGroup: true,
        },
        // Pass 2: Relaxed - wider viewport, allow overlap
        {
            strictEdges: false,
            allowOverlap: true,
            requireViewport: true,
            viewportMargin: 160,
            alignmentWeight: 8,
            distanceWeight: 0.9,
            preferScrollGroup: true,
        },
        // Pass 3: Permissive - any element, no viewport requirement
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

    // No candidate found - try wrap navigation if enabled
    if ((window as any).flutterSpatialNavDebug) {
        // console.log(`[SpatialNav] No candidate found for ${direction.name} after ${passes.length} passes`);
    }

    const config = getConfig();
    if (config.wrapNavigation) {
        return findWrapCandidate(currentIndex, direction, state);
    }

    return null;
}


/**
 * Find wrap navigation candidate - returns element at opposite edge.
 * Used when wrapNavigation is enabled and normal navigation hits a boundary.
 */
export function findWrapCandidate(
    currentIndex: number,
    direction: Direction,
    state: SpatialNavState
): NavigationCandidate | null {
    const currentEntry = state.focusables[currentIndex];
    if (!currentEntry || !currentEntry.element) {
        return null;
    }

    // For wrap, we want the element at the opposite edge
    // - down: wrap to topmost element
    // - up: wrap to bottommost element
    // - right: wrap to leftmost element
    // - left: wrap to rightmost element

    updateEntryGeometry(currentEntry, state);
    const config = getConfig();

    // If in grid mode, try to stay in same row/column
    const useGridAlignment = config.scoringMode === 'grid';
    const tolerance = config.gridAlignmentTolerance;

    let candidates: Array<{ index: number; data: typeof currentEntry; position: number; gridAligned: boolean }> = [];

    for (let i = 0; i < state.focusables.length; i++) {
        if (i === currentIndex) continue;

        const entry = state.focusables[i];
        if (!entry || !entry.element) continue;

        updateEntryGeometry(entry, state);
        if (!entry.rect || entry.width <= 1 || entry.height <= 1) continue;

        // Check grid alignment for row/column wrap
        const gridAligned = useGridAlignment
            ? isGridAligned(currentEntry, entry, direction, tolerance)
            : false;

        // Get position value based on direction (opposite edge)
        let position: number;
        switch (direction.name) {
            case 'down':
                position = entry.top; // Want smallest top (topmost)
                break;
            case 'up':
                position = -entry.bottom; // Want largest bottom (bottommost)
                break;
            case 'right':
                position = entry.left; // Want smallest left (leftmost)
                break;
            case 'left':
                position = -entry.right; // Want largest right (rightmost)
                break;
        }

        candidates.push({
            index: i,
            data: entry,
            position,
            gridAligned,
        });
    }

    if (!candidates.length) {
        return null;
    }

    // Sort: grid-aligned first (if grid mode), then by position
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
        passIndex: -1, // Wrap pass
    };
}

