/**
 * Tests for the legacy alias / deprecation shim.
 *
 * Hosts on v2 wrote `window.flutterFocusState = customState`. When v3
 * routes that name through a getter/setter, the setter must round-trip
 * the value back through the getter — otherwise consumer writes are
 * silently lost.
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { setupDomEnv, teardownDomEnv } from './helpers/dom_env';
import { installLegacyDeprecations } from '../utils/deprecation';
import type { SpatialNavState } from '../core/state';

function fakeState(): SpatialNavState {
    return { currentIndex: -1, focusables: [] } as unknown as SpatialNavState;
}

describe('defineLegacyAlias getter/setter symmetry', () => {
    beforeEach(() => setupDomEnv());
    afterEach(() => teardownDomEnv());

    test('reading the alias returns the original value', () => {
        const state = fakeState();
        installLegacyDeprecations(state, () => {});
        assert.equal((window as unknown as Record<string, unknown>).flutterFocusState, state);
    });

    test('writes via the alias round-trip through subsequent reads', () => {
        installLegacyDeprecations(fakeState(), () => {});

        const replacement = { currentIndex: 99, focusables: [] } as unknown as SpatialNavState;
        (window as unknown as Record<string, unknown>).flutterFocusState = replacement;

        assert.equal(
            (window as unknown as Record<string, unknown>).flutterFocusState,
            replacement,
            'setter must update what the getter returns'
        );
    });

    test('setter does not leak a __flutterFocusState_value side property', () => {
        installLegacyDeprecations(fakeState(), () => {});
        (window as unknown as Record<string, unknown>).flutterFocusState = fakeState();

        assert.equal(
            (window as unknown as Record<string, unknown>).__flutterFocusState_value,
            undefined,
            'must not leave a stray side bucket on window'
        );
    });

    test('flutterShowOverlay alias delegates to the overlay handler', () => {
        const calls: Array<HTMLElement | null> = [];
        installLegacyDeprecations(fakeState(), (el) => calls.push(el));
        const showFn = (window as unknown as { flutterShowOverlay: (el: HTMLElement | null) => void })
            .flutterShowOverlay;
        showFn(null);
        assert.equal(calls.length, 1);
        assert.equal(calls[0], null);
    });

    test('defineLegacyAlias falls back to plain assignment when defineProperty throws', () => {
        // Patch Object.defineProperty on this window to throw for one specific name.
        const orig = Object.defineProperty;
        const patched = function (
            target: unknown,
            name: PropertyKey,
            descriptor: PropertyDescriptor
        ): unknown {
            if (target === window && name === 'flutterFocusState') {
                throw new Error('embedded-browser-rejects-defineProperty');
            }
            return (orig as unknown as (t: unknown, n: PropertyKey, d: PropertyDescriptor) => unknown)(
                target,
                name,
                descriptor
            );
        };
        (Object as unknown as { defineProperty: unknown }).defineProperty = patched;

        try {
            const state = fakeState();
            installLegacyDeprecations(state, () => {});
            assert.equal(
                (window as unknown as Record<string, unknown>).flutterFocusState,
                state,
                'fallback assignment must still expose the value'
            );
        } finally {
            (Object as unknown as { defineProperty: unknown }).defineProperty = orig;
        }
    });
});

// ---------------------------------------------------------------------------
// installDebugDeprecations
// ---------------------------------------------------------------------------

import { installDebugDeprecations } from '../utils/deprecation';
import type { SpatialNavDebugApi } from '../utils/debug';

describe('installDebugDeprecations', () => {
    beforeEach(() => setupDomEnv());
    afterEach(() => teardownDomEnv());

    test('installs flutterFocusDebug / flutterFocusInstrumentation / flutterSpatNavPerf aliases', () => {
        const state = fakeState();
        state.instrumentation = {
            lastOverlay: '',
            lastActive: '',
            mismatchCount: 0,
            overlayIndex: -1,
            activeIndex: -1,
            lastMismatch: null,
            lastUpdate: 0,
            lastDirection: '',
        } as unknown as typeof state.instrumentation;
        state.perf = {
            refreshCount: 0,
            totalRefreshTime: 0,
            averageRefreshTime: 0,
            lastRefreshTime: 0,
            slowRefreshCount: 0,
        };

        const api: SpatialNavDebugApi = {
            move: () => true,
            setPreviewEnabled: () => true,
            previewTargets: () => ({}),
            snapshot: () => state.instrumentation,
        };

        installDebugDeprecations(state, api);

        const w = window as unknown as Record<string, unknown>;
        assert.equal(w.flutterFocusDebug, api);
        assert.equal(w.flutterFocusInstrumentation, state.instrumentation);
        assert.equal(typeof w.flutterSpatNavPerf, 'function');
        assert.deepEqual((w.flutterSpatNavPerf as () => object)(), state.perf);
    });

    test('flutterSpatNavPerf returns empty object when state.perf is falsy', () => {
        const state = fakeState();
        state.instrumentation = {} as unknown as typeof state.instrumentation;
        state.perf = undefined as unknown as typeof state.perf;
        const api: SpatialNavDebugApi = {
            move: () => true,
            setPreviewEnabled: () => true,
            previewTargets: () => ({}),
            snapshot: () => state.instrumentation,
        };
        installDebugDeprecations(state, api);
        const fn = (window as unknown as { flutterSpatNavPerf: () => object }).flutterSpatNavPerf;
        assert.deepEqual(fn(), {});
    });
});
