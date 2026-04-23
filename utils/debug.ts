/**
 * Debug utilities for Spatial Navigation.
 *
 * Exposes `window.spatialNavDebug` (programmatic move, preview toggle,
 * instrumentation snapshot). The legacy `flutterFocusDebug`,
 * `flutterFocusInstrumentation`, and `flutterSpatNavPerf` names are kept as
 * deprecated aliases via {@link installDebugDeprecations} in
 * {@link ./deprecation}; they will be removed in v4.
 */

import { directionByName, directionKeys, type DirectionName, type DirectionMap } from '../core/config';
import { refreshFocusables, getActiveElement, describeElement } from './dom';
import { moveInDirection } from '../navigation/movement';
import { hidePreviewElements, updatePreviewVisuals } from '../core/preview';
import { findDirectionalCandidate } from '../core/scoring';
import { installDebugDeprecations } from './deprecation';
import type { SpatialNavState, Instrumentation } from '../core/state';

export interface SpatialNavDebugApi {
    move: (directionName: string) => boolean;
    setPreviewEnabled: (enabled: boolean) => boolean;
    previewTargets: (label?: string) => Record<string, string>;
    snapshot: (label?: string) => Instrumentation;
}

declare global {
    interface Window {
        // Current names
        spatialNavDebug?: Partial<SpatialNavDebugApi>;
        spatialNavInstrumentation?: Instrumentation;
        spatialNavPerf?: () => object;

        // Legacy names (deprecated, removed in v4)
        flutterFocusDebug?: Partial<SpatialNavDebugApi>;
        flutterFocusInstrumentation?: Instrumentation;
        flutterSpatNavPerf?: () => object;
    }
}

/**
 * Install the debug API on `window.spatialNavDebug` and wire the legacy
 * `flutterFocusDebug` / `flutterFocusInstrumentation` / `flutterSpatNavPerf`
 * aliases through the deprecation module.
 */
export function initDebugApi(state: SpatialNavState): void {
    const api: SpatialNavDebugApi = {
        move: (directionName: string): boolean => {
            const direction = directionByName[directionName as DirectionName];
            if (!direction) return false;
            refreshFocusables(state);
            const moved = moveInDirection(direction, null, state);
            try {
                document.title =
                    'focusDebugMove:' +
                    JSON.stringify({
                        direction: directionName,
                        moved: !!moved,
                        active: describeElement(getActiveElement()),
                        timestamp: Date.now(),
                    });
            } catch {
                // Title serialization can fail on detached docs.
            }
            return moved;
        },

        setPreviewEnabled: (enabled: boolean): boolean => {
            state.previewEnabled = enabled !== false;
            if (!state.previewEnabled) {
                hidePreviewElements(state);
                state.nextTargets = { up: null, down: null, left: null, right: null };
            } else {
                const active = getActiveElement() as HTMLElement | null;
                if (active) {
                    const dirMap = directionByName as DirectionMap;
                    updatePreviewVisuals(
                        active,
                        null,
                        findDirectionalCandidate,
                        dirMap,
                        describeElement,
                        state
                    );
                }
            }
            try {
                document.title =
                    'focusPreviewToggle:' +
                    JSON.stringify({ enabled: state.previewEnabled, timestamp: Date.now() });
            } catch {
                // ignore
            }
            return state.previewEnabled;
        },

        previewTargets: (label?: string): Record<string, string> => {
            const summary: Record<string, string> = {};
            directionKeys.forEach((direction) => {
                const entry = state.nextTargets && state.nextTargets[direction];
                summary[direction] =
                    entry && entry.data && entry.data.element
                        ? describeElement(entry.data.element)
                        : '[blocked]';
            });
            try {
                document.title =
                    'focusPreview:' +
                    JSON.stringify({ label: label || '', targets: summary, timestamp: Date.now() });
            } catch {
                // ignore
            }
            return summary;
        },

        snapshot: (label?: string): Instrumentation => {
            const inst = state.instrumentation;
            try {
                document.title =
                    'focusInstrumentation:' +
                    JSON.stringify({
                        label: label || '',
                        lastOverlay: inst.lastOverlay || '',
                        lastActive: inst.lastActive || '',
                        mismatchCount: inst.mismatchCount || 0,
                        overlayIndex: typeof inst.overlayIndex === 'number' ? inst.overlayIndex : -1,
                        activeIndex: typeof inst.activeIndex === 'number' ? inst.activeIndex : -1,
                        focusableCount: state.focusableCount || 0,
                        lastDirection: inst.lastDirection || '',
                        timestamp: Date.now(),
                    });
            } catch {
                // ignore
            }
            return inst;
        },
    };

    window.spatialNavDebug = api;
    window.spatialNavInstrumentation = state.instrumentation;
    window.spatialNavPerf = () => state.perf || {};

    // Legacy aliases — fire warning on first access.
    installDebugDeprecations(state, api);
}
