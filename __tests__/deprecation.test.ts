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
});
