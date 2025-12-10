/**
 * Debug utilities for Spatial Navigation System
 *
 * Exposes window.spatialNavDebug API for instrumentation and testing.
 */

import { directionByName, directionKeys, type DirectionName, type DirectionMap } from '../core/config';
import { refreshFocusables, getActiveElement, describeElement } from './dom';
import { moveInDirection } from '../navigation/movement';
import { hidePreviewElements, updatePreviewVisuals } from '../core/preview';
import { findDirectionalCandidate } from '../core/scoring';
import type { SpatialNavState, Instrumentation } from '../core/state';

interface DebugApi {
    move: (directionName: string) => boolean;
    setPreviewEnabled: (enabled: boolean) => boolean;
    previewTargets: (label?: string) => Record<string, string>;
    snapshot: (label?: string) => Instrumentation;
}

declare global {
    interface Window {
        flutterFocusDebug: Partial<DebugApi>;
        flutterFocusInstrumentation?: Instrumentation;
        flutterSpatNavPerf?: () => object;
    }
}

/**
 * Initialize debug API on window object.
 *
 * @param state - Global state object
 */
export function initDebugApi(state: SpatialNavState): void {
    window.flutterFocusDebug = window.flutterFocusDebug || {};

    // Expose instrumentation for tests
    window.flutterFocusInstrumentation = state.instrumentation;

    // Programmatic movement
    window.flutterFocusDebug.move = function (directionName: string): boolean {
        // Safe cast as we check for validity
        const direction = directionByName[directionName as DirectionName];
        if (!direction) {
            return false;
        }
        refreshFocusables(state);
        const moved = moveInDirection(direction, null, state);
        try {
            document.title = 'focusDebugMove:' + JSON.stringify({
                direction: directionName,
                moved: !!moved,
                active: describeElement(getActiveElement()),
                timestamp: Date.now()
            });
        } catch (err) {
            // ignore serialization issues
        }
        return moved;
    };

    // Toggle preview visuals
    window.flutterFocusDebug.setPreviewEnabled = function (enabled: boolean): boolean {
        state.previewEnabled = enabled !== false;
        if (!state.previewEnabled) {
            hidePreviewElements(state);
            state.nextTargets = { up: null, down: null, left: null, right: null };
        } else {
            const active = getActiveElement() as HTMLElement | null;
            if (active) {
                const dirMap = directionByName as DirectionMap;
                updatePreviewVisuals(active, null, findDirectionalCandidate, dirMap, describeElement, state);
            }
        }
        try {
            document.title = 'focusPreviewToggle:' + JSON.stringify({
                enabled: state.previewEnabled,
                timestamp: Date.now()
            });
        } catch (err) {
            // ignore serialization issues
        }
        return state.previewEnabled;
    };

    // Inspect current targets
    window.flutterFocusDebug.previewTargets = function (label?: string): Record<string, string> {
        const summary: Record<string, string> = {};
        directionKeys.forEach(function (direction) {
            const entry = state.nextTargets && state.nextTargets[direction];
            summary[direction] =
                entry && entry.data && entry.data.element ? describeElement(entry.data.element) : '[blocked]';
        });
        try {
            document.title = 'focusPreview:' + JSON.stringify({
                label: label || '',
                targets: summary,
                timestamp: Date.now()
            });
        } catch (err) {
            // ignore serialization issues
        }
        return summary;
    };

    // Snapshot instrumentation metrics
    window.flutterFocusDebug.snapshot = function (label?: string): Instrumentation {
        const inst = state.instrumentation;
        try {
            document.title = 'focusInstrumentation:' + JSON.stringify({
                label: label || '',
                lastOverlay: inst.lastOverlay || '',
                lastActive: inst.lastActive || '',
                mismatchCount: inst.mismatchCount || 0,
                overlayIndex: typeof inst.overlayIndex === 'number' ? inst.overlayIndex : -1,
                activeIndex: typeof inst.activeIndex === 'number' ? inst.activeIndex : -1,
                focusableCount: state.focusableCount || 0,
                lastDirection: inst.lastDirection || '',
                timestamp: Date.now()
            });
        } catch (err) {
            // ignore
        }
        return inst;
    };

    // Expose performance monitoring (TODO 4)
    window.flutterSpatNavPerf = function (): object {
        return state.perf || {};
    };
}
