/**
 * Global type declarations for Spatial Navigation
 *
 * Extends Window interface with WICG polyfill, debug APIs, framework hooks,
 * and the GeckoView WebExtension `browser` global.
 */

import type { SpatialNavState, FocusableEntry } from './core/state';
import type { DirectionName } from './core/config';

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
    interface Window {
        // WICG Spatial Navigation polyfill
        navigate?: (dir: DirectionName) => void;

        // Public state + overlay API (current names)
        spatialNavState?: SpatialNavState;
        showSpatialNavOverlay?: (element: HTMLElement | null) => void;

        // Legacy names (deprecated, will be removed in v4)
        flutterFocusState?: SpatialNavState;
        flutterShowOverlay?: (element: HTMLElement | null) => void;
        flutterSpatialNavConfig?: Record<string, unknown>;

        // Public config slot (read at init)
        spatialNavConfig?: Record<string, unknown>;

        // Runtime debug toggles
        SPATIAL_NAV_DEBUG?: boolean;
        flutterSpatialNavDebug?: boolean;

        // Internal init markers (DO NOT use externally)
        __SPATIAL_NAV_INIT_COMPLETE__?: boolean;
        __SPATIAL_NAV_INIT_COUNT__?: number;
        __SPATIAL_NAV_HANDLERS_ATTACHED__?: boolean;
        __SPATIAL_NAV_HANDLER_ID__?: number;
        __SPATIAL_NAV_KEYDOWN_COUNT__?: number;
        __SPATIAL_NAV_LAST_KEY_TIME__?: number;
        __SPATIAL_NAV_LAST_KEY__?: string;

        // Framework detection hooks
        __REACT_DEVTOOLS_GLOBAL_HOOK__?: unknown;
        __VUE__?: unknown;
        getAllAngularTestabilities?: () => unknown[];
    }

    interface Element {
        spatialNavigationSearch?: (
            dir: DirectionName,
            options?: SpatialNavigationSearchOptions
        ) => Element | null;
        focusableAreas?: (options?: FocusableAreasOptions) => Element[];
        getSpatialNavigationContainer?: () => Element;
    }

    interface Scheduler {
        postTask: (callback: () => void, options?: { priority?: string }) => void;
    }
    const scheduler: Scheduler | undefined;
}

/**
 * Minimal WebExtension API shape we rely on across Firefox (`browser.*`)
 * and Chrome (`chrome.*`). Promise-based calls are typed as Promises; the
 * Chrome callback variant is captured by the `(callback?)` overload on
 * `sendMessage` returning unknown.
 */
export interface BrowserPort {
    name?: string;
    postMessage: (message: unknown) => void;
    onMessage: { addListener: (callback: (message: unknown) => void) => void };
    onDisconnect: { addListener: (callback: () => void) => void };
}

export interface BrowserRuntime {
    connect?: (options: { name: string }) => BrowserPort;
    sendMessage?: (message: unknown, callback?: (response: unknown) => void) => Promise<unknown> | undefined;
    sendNativeMessage?: (appId: string, message: unknown) => Promise<unknown>;
    lastError?: { message?: string } | null;
    onMessage?: {
        addListener: (
            callback: (
                message: unknown,
                sender: unknown,
                sendResponse: (response: unknown) => void
            ) => boolean | void
        ) => void;
    };
}

export interface BrowserAPI {
    runtime?: BrowserRuntime;
}

declare global {
    const browser: BrowserAPI | undefined;
    const chrome: BrowserAPI | undefined;
}
