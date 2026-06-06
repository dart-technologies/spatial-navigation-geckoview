/**
 * Tests for utils/intersection.ts — IntersectionObserver lifecycle for the
 * focusable cache. Covers syncIntersectionObserver (config-off detach, first
 * create vs re-sync, observe-throw recovery), observeNewElement / unobserveElement
 * null-state + try/catch limbs, detachIntersectionObserver idempotency, and the
 * orphaned-element branch in the IO callback.
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
    syncIntersectionObserver,
    observeNewElement,
    unobserveElement,
    detachIntersectionObserver,
} from '../utils/intersection';
import {
    setupDomEnv,
    teardownDomEnv,
    createElement,
    attachElement,
    createTestState,
    installFakeIntersectionObserver,
    type IntersectionRecorder,
} from './helpers/dom_env';

describe('syncIntersectionObserver', () => {
    let recorder: IntersectionRecorder;

    beforeEach(() => {
        setupDomEnv();
        recorder = installFakeIntersectionObserver();
    });
    afterEach(() => {
        recorder.restore();
        teardownDomEnv();
    });

    test('detaches when observeIntersection is false', () => {
        const el = attachElement(createElement({ tagName: 'button', tabindex: '0' }));
        const state = createTestState([el], {}, { observeIntersection: false });
        // Pre-seed an observer to verify it gets detached.
        syncIntersectionObserver({
            ...state,
            config: { ...state.config, observeIntersection: true },
        } as unknown as typeof state);
        // Now toggle off and re-sync the original.
        const state2 = createTestState([el], {}, { observeIntersection: false });
        // Manually attach an observer object so we can confirm detach clears it.
        state2.intersectionObserver = recorder.lastObserver as unknown as IntersectionObserver;
        syncIntersectionObserver(state2);
        assert.equal(state2.intersectionObserver, null);
    });

    test('creates observer on first call when enabled', () => {
        const el = attachElement(createElement({ tagName: 'button', tabindex: '0' }));
        const state = createTestState([el], {}, { observeIntersection: true });
        syncIntersectionObserver(state);
        assert.notEqual(state.intersectionObserver, null);
        assert.equal(recorder.instances.length, 1);
        assert.equal(recorder.lastObserver?.observed.length, 1);
    });

    test('disconnects existing observer on re-sync (config change)', () => {
        const el = attachElement(createElement({ tagName: 'button', tabindex: '0' }));
        const state = createTestState([el], {}, { observeIntersection: true });
        syncIntersectionObserver(state);
        const first = recorder.lastObserver;
        // Add a second element and re-sync.
        const el2 = attachElement(createElement({ tagName: 'button', tabindex: '0' }));
        state.focusableElements = [el, el2];
        syncIntersectionObserver(state);
        assert.equal(first?.disconnected, true);
        // Same observer instance reused — just re-observed.
        assert.equal(state.intersectionObserver, first as unknown as IntersectionObserver);
    });

    test('swallows observe() throw silently', () => {
        const el = attachElement(createElement({ tagName: 'button', tabindex: '0' }));
        const state = createTestState([el], {}, { observeIntersection: true });
        syncIntersectionObserver(state);
        // Patch observer.observe to throw.
        state.intersectionObserver!.observe = () => {
            throw new Error('detached');
        };
        // Re-sync — must not throw on observe.
        syncIntersectionObserver(state);
        assert.ok(state.intersectionObserver !== null);
    });
});

describe('observeNewElement / unobserveElement', () => {
    let recorder: IntersectionRecorder;

    beforeEach(() => {
        setupDomEnv();
        recorder = installFakeIntersectionObserver();
    });
    afterEach(() => {
        recorder.restore();
        teardownDomEnv();
    });

    test('observeNewElement: no-op when state has no observer', () => {
        const el = attachElement(createElement({ tagName: 'button' }));
        const state = createTestState([], {}, { observeIntersection: true });
        // No observer present.
        observeNewElement(state, el);
        // Must not throw — assertion is that we got here.
        assert.equal(state.intersectionObserver, null);
    });

    test('observeNewElement forwards to observer.observe', () => {
        const state = createTestState([], {}, { observeIntersection: true });
        syncIntersectionObserver(state);
        const obs = recorder.lastObserver!;
        const initial = obs.observed.length;
        const newEl = createElement({ tagName: 'button' });
        observeNewElement(state, newEl);
        assert.equal(obs.observed.length, initial + 1);
    });

    test('observeNewElement swallows observe-throw', () => {
        const el = attachElement(createElement({ tagName: 'button' }));
        const state = createTestState([el], {}, { observeIntersection: true });
        syncIntersectionObserver(state);
        state.intersectionObserver!.observe = () => {
            throw new Error('boom');
        };
        observeNewElement(state, el);
        // No throw → win.
    });

    test('unobserveElement: no-op when state has no observer', () => {
        const el = attachElement(createElement({ tagName: 'button' }));
        const state = createTestState([], {}, { observeIntersection: true });
        unobserveElement(state, el);
        assert.equal(state.intersectionObserver, null);
    });

    test('unobserveElement forwards to observer.unobserve', () => {
        const el = attachElement(createElement({ tagName: 'button' }));
        const state = createTestState([el], {}, { observeIntersection: true });
        syncIntersectionObserver(state);
        const obs = recorder.lastObserver!;
        unobserveElement(state, el);
        assert.ok(obs.unobserved.includes(el));
    });

    test('unobserveElement swallows unobserve-throw', () => {
        const el = attachElement(createElement({ tagName: 'button' }));
        const state = createTestState([el], {}, { observeIntersection: true });
        syncIntersectionObserver(state);
        state.intersectionObserver!.unobserve = () => {
            throw new Error('boom');
        };
        unobserveElement(state, el);
    });
});

describe('detachIntersectionObserver', () => {
    let recorder: IntersectionRecorder;

    beforeEach(() => {
        setupDomEnv();
        recorder = installFakeIntersectionObserver();
    });
    afterEach(() => {
        recorder.restore();
        teardownDomEnv();
    });

    test('disconnects + nulls the observer', () => {
        const el = attachElement(createElement({ tagName: 'button' }));
        const state = createTestState([el], {}, { observeIntersection: true });
        syncIntersectionObserver(state);
        const obs = recorder.lastObserver!;
        detachIntersectionObserver(state);
        assert.equal(obs.disconnected, true);
        assert.equal(state.intersectionObserver, null);
    });

    test('is idempotent — second call with null observer is a no-op', () => {
        const state = createTestState();
        detachIntersectionObserver(state);
        detachIntersectionObserver(state);
        assert.equal(state.intersectionObserver, null);
    });
});

describe('orphaned-element branch in IO callback', () => {
    let recorder: IntersectionRecorder;

    beforeEach(() => {
        setupDomEnv();
        recorder = installFakeIntersectionObserver();
    });
    afterEach(() => {
        recorder.restore();
        teardownDomEnv();
    });

    test('unobserves elements that are no longer in focusableElements', () => {
        const tracked = attachElement(createElement({ tagName: 'button' }));
        const orphan = attachElement(createElement({ tagName: 'button' }));
        const state = createTestState([tracked], {}, { observeIntersection: true });
        syncIntersectionObserver(state);
        // Trigger an IO entry for the orphan — the callback should unobserve.
        recorder.trigger([{ target: orphan, isIntersecting: true }]);
        assert.ok(recorder.lastObserver?.unobserved.includes(orphan));
    });

    test('updates entry geometry when target is tracked', () => {
        const tracked = attachElement(
            createElement({
                tagName: 'button',
                tabindex: '0',
                rect: { x: 0, y: 0, width: 100, height: 40 },
            })
        );
        const state = createTestState([tracked], {}, { observeIntersection: true });
        syncIntersectionObserver(state);

        // Mutate the rect, then fire the IO callback — geometry should refresh.
        const newRect: DOMRect = {
            x: 100,
            y: 200,
            top: 200,
            left: 100,
            right: 200,
            bottom: 240,
            width: 100,
            height: 40,
            toJSON: () => ({}),
        };
        tracked.getBoundingClientRect = () => newRect;
        recorder.trigger([{ target: tracked, isIntersecting: true }]);
        assert.equal(state.focusables[0].left, 100);
        assert.equal(state.focusables[0].top, 200);
    });
});
