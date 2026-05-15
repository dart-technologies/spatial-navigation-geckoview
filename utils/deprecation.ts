/**
 * Deprecation helpers for legacy `flutter*` window APIs.
 *
 * The library renamed its public globals in v3.0.0 (`flutterFocusState` →
 * `spatialNavState`, `flutterShowOverlay` → `showSpatialNavOverlay`). Removing
 * the old names immediately would break flutter-geckoview hosts that took the
 * v2 API as a hard dependency. We keep the legacy names alive for one major
 * version, but route the first read through a getter that warns once.
 *
 * Schedule:
 *   - v3.x — legacy aliases work, log a warning on first access
 *   - v4.0 — legacy aliases removed
 */

import { createLogger } from './logger';
import type { SpatialNavState, Instrumentation } from '../core/state';
import { showOverlay } from '../core/overlay';
import type { SpatialNavDebugApi } from './debug';

const log = createLogger('Deprecation');

const warnedKeys = new Set<string>();

function warnOnce(name: string, replacement: string): void {
    if (warnedKeys.has(name)) return;
    warnedKeys.add(name);
    log.warn(
        `\`window.${name}\` is deprecated and will be removed in v4. ` +
            `Use \`window.${replacement}\` instead.`
    );
}

/**
 * Define a one-shot warning getter for a legacy window property.
 * Falls back to plain assignment if `defineProperty` is rejected (some
 * embedded browsers do not allow it on `window`).
 */
function defineLegacyAlias<T>(name: string, replacement: string, value: T): void {
    let currentValue: T = value;
    try {
        Object.defineProperty(window, name, {
            configurable: true,
            enumerable: true,
            get: () => {
                warnOnce(name, replacement);
                return currentValue;
            },
            set: (v: T) => {
                warnOnce(name, replacement);
                currentValue = v;
            },
        });
    } catch {
        (window as unknown as Record<string, T>)[name] = value;
    }
}

/**
 * Install legacy state/overlay aliases that warn on first access.
 *
 * Properties:
 *   - `window.flutterFocusState`        → `window.spatialNavState`
 *   - `window.flutterShowOverlay(el)`   → `window.showSpatialNavOverlay(el)`
 */
export function installLegacyDeprecations(
    state: SpatialNavState,
    overlayHandler: (el: HTMLElement | null) => void
): void {
    defineLegacyAlias<SpatialNavState>('flutterFocusState', 'spatialNavState', state);

    const legacyShow = (element: HTMLElement | null) => {
        warnOnce('flutterShowOverlay', 'showSpatialNavOverlay');
        overlayHandler(element);
    };
    window.flutterShowOverlay = legacyShow;

    // Reference showOverlay so tree-shaking doesn't drop the import in the
    // legacy code path; the alias above does call into it indirectly.
    void showOverlay;
}

/**
 * Install legacy debug-API aliases that warn on first access.
 *
 * Properties:
 *   - `window.flutterFocusDebug`         → `window.spatialNavDebug`
 *   - `window.flutterFocusInstrumentation` → `window.spatialNavInstrumentation`
 *   - `window.flutterSpatNavPerf`        → `window.spatialNavPerf`
 */
export function installDebugDeprecations(state: SpatialNavState, api: SpatialNavDebugApi): void {
    defineLegacyAlias<Partial<SpatialNavDebugApi>>('flutterFocusDebug', 'spatialNavDebug', api);
    defineLegacyAlias<Instrumentation>(
        'flutterFocusInstrumentation',
        'spatialNavInstrumentation',
        state.instrumentation
    );

    const legacyPerf = () => {
        warnOnce('flutterSpatNavPerf', 'spatialNavPerf');
        return state.perf || {};
    };
    window.flutterSpatNavPerf = legacyPerf;
}
