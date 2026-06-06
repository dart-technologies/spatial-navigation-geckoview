/**
 * Tests for utils/focus-helpers.ts — overlay scheduling and position-hint helpers.
 *
 * Covers scheduleOverlayUpdate (suppressed early-return + cancel timer, nested
 * suppression re-check inside the rAF callback, instrumentation write),
 * storePositionHint (null-active short-circuit, no-rect short-circuit, full
 * write), clearOverlaySuppression (atomic flag+timer clear), and
 * clearPendingOverlayUpdate idempotency.
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
    scheduleOverlayUpdate,
    storePositionHint,
    clearPendingOverlayUpdate,
    clearOverlaySuppression,
} from '../utils/focus-helpers';
import {
    setupDomEnv,
    teardownDomEnv,
    createElement,
    attachElement,
    createTestState,
    setActiveElement,
    flushMicrotasks,
} from './helpers/dom_env';

describe('scheduleOverlayUpdate', () => {
    beforeEach(() => setupDomEnv());
    afterEach(() => teardownDomEnv());

    test('suppressed path: stores lastFocusedElement and cancels pending timer', () => {
        const target = attachElement(
            createElement({ tagName: 'button', tabindex: '0', rect: { width: 80, height: 30 } })
        );
        const state = createTestState([target]);
        state.overlaySuppressed = true;
        (state as { updateTimer: unknown }).updateTimer = setTimeout(() => {}, 1000);

        scheduleOverlayUpdate(target, state);
        assert.equal(state.lastFocusedElement, target);
        assert.equal(state.updateTimer, null, 'pending timer was cancelled');
    });

    test('normal path: schedules rAF and runs after a tick', async () => {
        const target = attachElement(
            createElement({ tagName: 'button', tabindex: '0', rect: { width: 80, height: 30 } })
        );
        const state = createTestState([target]);
        state.overlaySuppressed = false;

        scheduleOverlayUpdate(target, state);
        assert.notEqual(state.updateTimer, null, 'rAF timer scheduled');

        // The rAF shim resolves via setTimeout(...,0) — yield.
        await flushMicrotasks();
        // Timer should be cleared after the callback runs.
        assert.equal(state.updateTimer, null);
        // Instrumentation got updated.
        assert.notEqual(state.instrumentation.lastActive, '');
    });

    test('nested suppression: if overlaySuppressed flips true before rAF, callback early-returns', async () => {
        const target = attachElement(
            createElement({ tagName: 'button', tabindex: '0', rect: { width: 80, height: 30 } })
        );
        const state = createTestState([target]);
        state.overlaySuppressed = false;

        scheduleOverlayUpdate(target, state);
        // Race: flip suppressed before the rAF callback fires.
        state.overlaySuppressed = true;
        await flushMicrotasks();
        // Timer cleared; instrumentation NOT updated (lastUpdate stays 0).
        assert.equal(state.updateTimer, null);
        assert.equal(state.instrumentation.lastUpdate, 0);
    });

    test('cancels existing rAF timer before scheduling a new one', () => {
        const target = attachElement(
            createElement({ tagName: 'button', tabindex: '0', rect: { width: 80, height: 30 } })
        );
        const state = createTestState([target]);
        scheduleOverlayUpdate(target, state);
        const firstTimer = state.updateTimer;
        scheduleOverlayUpdate(target, state);
        assert.notEqual(state.updateTimer, firstTimer, 'new timer replaces old');
    });
});

describe('storePositionHint', () => {
    beforeEach(() => setupDomEnv());
    afterEach(() => teardownDomEnv());

    test('no-op when no active element', () => {
        const state = createTestState();
        storePositionHint(state);
        assert.equal(state.lastFocusPosition, null);
    });

    test('no-op when active is not tracked (indexOf === -1)', () => {
        const a = attachElement(createElement({ tagName: 'button', tabindex: '0' }));
        const b = attachElement(
            createElement({ tagName: 'button', tabindex: '0', rect: { width: 80, height: 30 } })
        );
        setActiveElement(a);
        const state = createTestState([b]);
        storePositionHint(state);
        assert.equal(state.lastFocusPosition, null);
    });

    test('writes a full FocusPositionHint when active is tracked with a rect', () => {
        const a = attachElement(
            createElement({
                tagName: 'button',
                tabindex: '0',
                rect: { x: 10, y: 20, width: 80, height: 30 },
            })
        );
        setActiveElement(a);
        const state = createTestState([a]);
        storePositionHint(state);
        assert.notEqual(state.lastFocusPosition, null);
        assert.equal(state.lastFocusPosition!.left, 10);
        assert.equal(state.lastFocusPosition!.top, 20);
        assert.match(state.lastFocusPosition!.elementDesc, /button/);
    });

    test('no-op when entry has no rect (short-circuits before write)', () => {
        const a = attachElement(createElement({ tagName: 'button', tabindex: '0' }));
        setActiveElement(a);
        const state = createTestState([a]);
        // Forcefully strip rect from the only entry to exercise the rect-guard.
        state.focusables[0].rect = null as unknown as DOMRect;
        storePositionHint(state);
        assert.equal(state.lastFocusPosition, null);
    });
});

describe('dispatchNavEvent guards', () => {
    beforeEach(() => setupDomEnv());
    afterEach(() => teardownDomEnv());

    test('returns true when target is null', async () => {
        const { dispatchNavEvent } = await import('../utils/events');
        const result = dispatchNavEvent('navbeforefocus', null as unknown as Element, {
            dir: 'down',
        });
        assert.equal(result, true);
    });

    test('returns true when details is null', async () => {
        const { dispatchNavEvent } = await import('../utils/events');
        const el = createElement({ tagName: 'div' });
        const result = dispatchNavEvent('navbeforefocus', el, null as unknown as { dir: string });
        assert.equal(result, true);
    });

    test('forwards escapeElement and escapeKey when provided', async () => {
        const { dispatchNavEvent } = await import('../utils/events');
        const target = attachElement(createElement({ tagName: 'div' }));
        const escapeEl = createElement({ tagName: 'button' });
        let captured: { escapeElement?: unknown; escapeKey?: unknown } | null = null;
        target.addEventListener('navnotarget', (e) => {
            captured = (e as CustomEvent).detail;
        });
        dispatchNavEvent('navnotarget', target, {
            dir: 'down',
            escapeElement: escapeEl,
            escapeKey: 'Escape',
        });
        assert.equal(captured!.escapeElement, escapeEl);
        assert.equal(captured!.escapeKey, 'Escape');
    });
});

describe('clearOverlaySuppression / clearPendingOverlayUpdate', () => {
    beforeEach(() => setupDomEnv());
    afterEach(() => teardownDomEnv());

    test('clearOverlaySuppression resets flag AND clears recovery timer atomically', () => {
        const state = createTestState();
        state.overlaySuppressed = true;
        (state as { suppressRecoveryTimer: unknown }).suppressRecoveryTimer = setTimeout(() => {}, 1000);
        clearOverlaySuppression(state);
        assert.equal(state.overlaySuppressed, false);
        assert.equal(state.suppressRecoveryTimer, null);
    });

    test('clearOverlaySuppression is idempotent — no-op when timer is null', () => {
        const state = createTestState();
        state.overlaySuppressed = true;
        state.suppressRecoveryTimer = null;
        clearOverlaySuppression(state);
        assert.equal(state.overlaySuppressed, false);
    });

    test('clearPendingOverlayUpdate cancels active rAF timer', () => {
        const state = createTestState();
        (state as { updateTimer: unknown }).updateTimer = 12345;
        clearPendingOverlayUpdate(state);
        assert.equal(state.updateTimer, null);
    });

    test('clearPendingOverlayUpdate is a no-op when no timer is set', () => {
        const state = createTestState();
        state.updateTimer = null;
        clearPendingOverlayUpdate(state);
        assert.equal(state.updateTimer, null);
    });
});
