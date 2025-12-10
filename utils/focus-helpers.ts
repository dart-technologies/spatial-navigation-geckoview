/**
 * Focus recovery and overlay update helpers for Spatial Navigation System
 *
 * These utilities are extracted from handlers.ts to reduce coupling
 * and prevent circular dependencies with observer.ts.
 */

import { showOverlay } from '../core/overlay';
import { updatePreviewVisuals } from '../core/preview';
import { findDirectionalCandidate } from '../core/scoring';
import { directionByName, type DirectionMap } from '../core/config';
import { getActiveElement, describeElement } from './dom';
import { createLogger, DEBUG } from './logger';
import type { SpatialNavState, FocusPositionHint } from '../core/state';

const log = createLogger('Focus');

/**
 * Schedule an overlay update with requestAnimationFrame.
 * Respects overlay suppression state for focus-exit scenarios.
 *
 * @param target - Target element to highlight
 * @param state - Global state object
 */
export function scheduleOverlayUpdate(target: HTMLElement, state: SpatialNavState): void {
    if (state.overlaySuppressed) {
        // Ensure no pending overlay update re-shows the overlay after an exit.
        if (state.updateTimer) {
            cancelAnimationFrame(state.updateTimer);
            state.updateTimer = null;
        }
        if (target && target.nodeType === 1) {
            state.lastFocusedElement = target;
        }
        return;
    }

    if (state.updateTimer) {
        cancelAnimationFrame(state.updateTimer);
    }
    state.updateTimer = requestAnimationFrame(function () {
        if (state.overlaySuppressed) {
            state.updateTimer = null;
            return;
        }
        showOverlay(target, state, true);
        const dirMap = directionByName as DirectionMap;
        updatePreviewVisuals(target, null, findDirectionalCandidate, dirMap, describeElement, state);

        // Update instrumentation for tests
        if (state.instrumentation) {
            state.instrumentation.lastActive = describeElement(target) || 'EMPTY_DESC';
            state.instrumentation.lastOverlay = describeElement(target);
            state.instrumentation.activeIndex = state.focusableElements ? state.focusableElements.indexOf(target) : -1;
            state.instrumentation.lastUpdate = Date.now();
        }
        if (target && target.nodeType === 1) {
            state.lastFocusedElement = target;
        }

        state.updateTimer = null;
    });
}

/**
 * Store the current focus position as a hint for recovery.
 * Called before DOM mutations to preserve geometric position.
 * This prevents "popping to top" when virtual scroll recycles the focused element.
 *
 * @param state - Global state object
 */
export function storePositionHint(state: SpatialNavState): void {
    const active = getActiveElement();
    if (!active || !(active instanceof HTMLElement)) {
        return;
    }

    const currentIndex = state.focusableElements.indexOf(active);
    if (currentIndex === -1) {
        return;
    }

    const entry = state.focusables[currentIndex];
    if (!entry || !entry.rect) {
        return;
    }

    state.lastFocusPosition = {
        centerX: entry.centerX,
        centerY: entry.centerY,
        top: entry.top,
        left: entry.left,
        elementDesc: describeElement(active),
        timestamp: Date.now()
    } as FocusPositionHint;

    if (DEBUG) {
        log.debug(`Stored position hint: ${state.lastFocusPosition.elementDesc} at (${entry.centerX.toFixed(0)}, ${entry.centerY.toFixed(0)})`);
    }
}

/**
 * Clear pending overlay update timer and hide the overlay.
 * Used during focus-exit to prevent stale overlays from appearing.
 *
 * @param state - Global state object
 */
export function clearPendingOverlayUpdate(state: SpatialNavState): void {
    if (state.updateTimer) {
        cancelAnimationFrame(state.updateTimer);
        state.updateTimer = null;
    }
}
