/**
 * Global type declarations for Spatial Navigation
 *
 * Extends Window interface with debug APIs and framework detection.
 * Note: spatialNavState/flutterFocusState are declared in core/state.ts
 */

import type { SpatialNavState, FocusableEntry } from './core/state';
import type { DirectionName } from './core/config';

// Define options interfaces first so they can be used in global declarations
export interface SpatialNavigationSearchOptions {
    candidates?: Element[];
    container?: Element;
}

export interface FocusableAreasOptions {
    mode?: 'visible' | 'all';
}

export interface NavigationCandidate {
    index: number;
    data: FocusableEntry;
    rect: DOMRect;
    score: number;
    metrics: {
        primary: number;
        secondary: number;
        distance: number;
        alignment: number;
        deltaX: number;
        deltaY: number;
        gridAligned: boolean;
    };
    passIndex?: number;
}

declare global {
    // WICG Spatial Navigation Polyfill
    interface Window {
        navigate?: (dir: DirectionName) => void;
    }

    interface Element {
        spatialNavigationSearch?: (dir: DirectionName, options?: SpatialNavigationSearchOptions) => Element | null;
        focusableAreas?: (options?: FocusableAreasOptions) => Element[];
        getSpatialNavigationContainer?: () => Element;
    }

    // Overlay API
    interface Window {
        showSpatialNavOverlay?: (element: HTMLElement | null) => void;
        flutterShowOverlay?: (element: HTMLElement | null) => void;

        // Framework detection
        __REACT_DEVTOOLS_GLOBAL_HOOK__?: unknown;
        __VUE__?: unknown;
        getAllAngularTestabilities?: () => unknown[];
    }

    // Scheduler API (Chrome experimental)
    interface Scheduler {
        postTask: (callback: () => void, options?: { priority?: string }) => void;
    }
    const scheduler: Scheduler | undefined;
}

// WebExtension APIs
declare const browser: any;
