/**
 * Regression test for state-pollution via window.spatialNavState.
 *
 * Before the fix, getState() read `window.spatialNavState` as the
 * authoritative re-entry source — a malicious page could pre-populate the
 * global with a crafted state and hijack the overlay target, current
 * index, or focusables list. The fix switches to a module-scoped cache
 * and treats window.spatialNavState as write-only.
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { getState, resetState } from '../core/state';
import { getConfig } from '../core/config';
import { setupDomEnv, teardownDomEnv } from './helpers/dom_env';

describe('state pollution via window.spatialNavState', () => {
    beforeEach(() => {
        setupDomEnv();
        resetState();
    });

    afterEach(() => {
        resetState();
        teardownDomEnv();
    });

    test('ignores attacker-provided currentIndex on window.spatialNavState', () => {
        // Simulate a malicious page pre-populating the global before the
        // content script runs.
        (window as unknown as Record<string, unknown>).spatialNavState = {
            currentIndex: 999999,
            focusables: [{ evil: true }],
            lastFocusedElement: { tagName: 'FAKE' },
        };

        const state = getState(getConfig());

        assert.equal(state.currentIndex, -1, 'defaults to -1, not attacker value');
        assert.deepEqual(state.focusables, [], 'defaults to empty, not attacker array');
        assert.equal(state.lastFocusedElement, null, 'defaults to null, not attacker element');
    });

    test('ignores attacker-provided window.flutterFocusState (legacy alias)', () => {
        (window as unknown as Record<string, unknown>).flutterFocusState = {
            currentIndex: 42,
            overlaySuppressed: true,
        };

        const state = getState(getConfig());

        assert.equal(state.currentIndex, -1);
        assert.equal(state.overlaySuppressed, false);
    });

    test('module cache preserves state across repeat getState calls', () => {
        const first = getState(getConfig());
        first.currentIndex = 5;

        const second = getState(getConfig());

        assert.equal(second, first, 'same reference returned');
        assert.equal(second.currentIndex, 5, 'module cache preserved');
    });

    test('resetState clears module cache and window globals', () => {
        const first = getState(getConfig());
        first.currentIndex = 7;

        resetState();

        const fresh = getState(getConfig());
        assert.notEqual(fresh, first, 'new object after reset');
        assert.equal(fresh.currentIndex, -1, 'defaults restored after reset');
    });
});
