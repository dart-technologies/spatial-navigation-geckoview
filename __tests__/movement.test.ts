/**
 * Tests for navigation/movement.ts — exercised against a real DOM (happy-dom).
 *
 * Coverage groups:
 *  - ensureValidFocus: keeps live focus, recovers via lastOverlay, position hint, fallback
 *  - moveInDirection: boundary suppression, focusExit messaging, alert fallback
 *  - Position-hint expiry and clearing semantics
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
    setupDomEnv,
    teardownDomEnv,
    attachElement,
    createElement,
    createTestState,
    setActiveElement,
} from './helpers/dom_env';
import { ensureValidFocus, moveInDirection } from '../navigation/movement';
import type { Direction } from '../core/config';

const UP: Direction = { axis: 'y', sign: -1, name: 'up' };

// ---------------------------------------------------------------------------
// ensureValidFocus
// ---------------------------------------------------------------------------

describe('ensureValidFocus', () => {
    beforeEach(() => setupDomEnv());
    afterEach(() => teardownDomEnv());

    test('returns the current active element when it is still focusable', () => {
        const button = attachElement(createElement({ tagName: 'button', id: 'first' }));
        setActiveElement(button);
        const state = createTestState([button], { lastFocusedElement: button });

        assert.equal(ensureValidFocus(state), button);
    });

    test('recovers via lastOverlay when active element is gone', () => {
        const target = attachElement(createElement({ tagName: 'button', id: 'target' }));
        setActiveElement(null);
        const state = createTestState([target], {
            lastFocusedElement: target,
            instrumentation: {
                lastOverlay: 'button#target',
                lastActive: '',
                mismatchCount: 0,
                overlayIndex: -1,
                activeIndex: -1,
                lastMismatch: null,
                lastUpdate: 0,
                lastDirection: '',
            },
        });

        const recovered = ensureValidFocus(state);
        assert.equal(recovered, target);
        assert.equal(document.activeElement, target);
        assert.equal(state.currentIndex, 0);
    });

    test('falls back to first visible element when nothing else matches', () => {
        const alpha = attachElement(
            createElement({ tagName: 'button', id: 'a', rect: { x: 0, y: 0, width: 100, height: 30 } })
        );
        const beta = attachElement(
            createElement({ tagName: 'button', id: 'b', rect: { x: 0, y: 50, width: 100, height: 30 } })
        );
        setActiveElement(null);

        const state = createTestState([alpha, beta]);
        state.lastFocusedElement = null;

        assert.equal(ensureValidFocus(state), alpha);
        assert.equal(state.currentIndex, 0);
    });
});

// ---------------------------------------------------------------------------
// Position-based recovery
// ---------------------------------------------------------------------------

describe('ensureValidFocus: position hint', () => {
    beforeEach(() => setupDomEnv());
    afterEach(() => teardownDomEnv());

    test('uses position hint to pick the closest element', () => {
        const top = attachElement(
            createElement({ tagName: 'button', id: 'top', rect: { x: 100, y: 50, width: 100, height: 50 } })
        );
        const middle = attachElement(
            createElement({
                tagName: 'button',
                id: 'middle',
                rect: { x: 100, y: 200, width: 100, height: 50 },
            })
        );
        const bottom = attachElement(
            createElement({
                tagName: 'button',
                id: 'bottom',
                rect: { x: 100, y: 350, width: 100, height: 50 },
            })
        );

        setActiveElement(null);

        const state = createTestState([top, middle, bottom], {
            lastFocusedElement: null,
            lastFocusPosition: {
                centerX: 155,
                centerY: 220, // closest to middle (centerY=225)
                top: 195,
                left: 105,
                elementDesc: 'button#recycled',
                timestamp: Date.now(),
            },
        });

        assert.equal(ensureValidFocus(state), middle);
        assert.equal(state.currentIndex, 1);
    });

    test('ignores expired position hints (>2s old)', () => {
        const alpha = attachElement(
            createElement({ tagName: 'button', id: 'a', rect: { x: 100, y: 50, width: 100, height: 50 } })
        );
        const beta = attachElement(
            createElement({ tagName: 'button', id: 'b', rect: { x: 100, y: 200, width: 100, height: 50 } })
        );
        setActiveElement(null);

        const state = createTestState([alpha, beta], {
            lastFocusedElement: null,
            lastFocusPosition: {
                centerX: 150,
                centerY: 225,
                top: 200,
                left: 100,
                elementDesc: 'button#old',
                timestamp: Date.now() - 3000,
            },
        });

        // Expired → falls back to first visible → alpha.
        assert.equal(ensureValidFocus(state), alpha);
    });

    test('clears the position hint after a successful recovery', () => {
        const target = attachElement(
            createElement({
                tagName: 'button',
                id: 'target',
                rect: { x: 100, y: 100, width: 100, height: 50 },
            })
        );
        setActiveElement(null);

        const state = createTestState([target], {
            lastFocusedElement: null,
            lastFocusPosition: {
                centerX: 150,
                centerY: 125,
                top: 100,
                left: 100,
                elementDesc: 'button#target',
                timestamp: Date.now(),
            },
        });

        ensureValidFocus(state);
        assert.equal(state.lastFocusPosition, null);
    });

    test('position hint takes precedence when lastOverlay miss happens', () => {
        const farAway = attachElement(
            createElement({ tagName: 'button', id: 'far', rect: { x: 100, y: 0, width: 100, height: 50 } })
        );
        const nearHint = attachElement(
            createElement({ tagName: 'button', id: 'near', rect: { x: 100, y: 300, width: 100, height: 50 } })
        );

        setActiveElement(null);

        const state = createTestState([farAway, nearHint], {
            lastFocusedElement: null,
            instrumentation: {
                lastOverlay: 'button#deleted-element', // doesn't exist
                lastActive: '',
                mismatchCount: 0,
                overlayIndex: -1,
                activeIndex: -1,
                lastMismatch: null,
                lastUpdate: 0,
                lastDirection: '',
            },
            lastFocusPosition: {
                centerX: 145,
                centerY: 320, // close to nearHint (centerY=325)
                top: 295,
                left: 95,
                elementDesc: 'button#recycled',
                timestamp: Date.now(),
            },
        });

        assert.equal(ensureValidFocus(state), nearHint);
    });
});

// ---------------------------------------------------------------------------
// moveInDirection: boundary handling
// ---------------------------------------------------------------------------

describe('moveInDirection: boundary', () => {
    beforeEach(() => setupDomEnv());
    afterEach(() => {
        (globalThis as { browser?: unknown }).browser = undefined;
        teardownDomEnv();
    });

    test('suppresses overlay + cancels pending update on boundary exit', async () => {
        const button = attachElement(createElement({ tagName: 'button', id: 'only' }));
        setActiveElement(button);

        const state = createTestState([button]);
        // Add a fake overlay + pending timer.
        const overlay = attachElement(createElement({ tagName: 'div' }));
        overlay.classList.add('visible');
        state.overlay = overlay;

        let timerFired = false;
        state.updateTimer = setTimeout(() => {
            timerFired = true;
        }, 25) as unknown as number;
        state.activeResizeObserver = { disconnect: () => {} } as unknown as ResizeObserver;

        const moved = moveInDirection(UP, null, state);

        assert.equal(moved, false);
        assert.equal(state.overlaySuppressed, true);
        assert.equal(state.updateTimer, null);
        assert.equal(overlay.classList.contains('visible'), false);

        await new Promise((resolve) => setTimeout(resolve, 50));
        assert.equal(timerFired, false);
    });

    test('posts focusExit + dispatches spatialNavigationExit when bridge is present', () => {
        type MsgShape = { type: string; direction: string; inTrap: boolean };
        type DispatchedShape = { type: string; detail: { direction: string; inTrap: boolean } };

        const button = attachElement(createElement({ tagName: 'button', id: 'only' }));
        setActiveElement(button);
        const state = createTestState([button]);

        const dispatched: DispatchedShape[] = [];
        const origDispatch = document.dispatchEvent.bind(document);
        document.dispatchEvent = (e: Event) => {
            dispatched.push({ type: e.type, detail: (e as CustomEvent).detail });
            return origDispatch(e);
        };

        const sent: MsgShape[] = [];
        (globalThis as { browser?: unknown }).browser = {
            runtime: {
                sendMessage: (msg: unknown, cb?: (resp: unknown) => void) => {
                    sent.push(msg as MsgShape);
                    cb?.({ ok: true });
                },
                lastError: null,
            },
        };

        const moved = moveInDirection(UP, null, state);

        assert.equal(moved, false);
        assert.equal(sent[0]?.type, 'focusExit');
        assert.equal(sent[0]?.direction, 'up');
        assert.equal(sent[0]?.inTrap, false);
        assert.equal(dispatched.find((d) => d.type === 'spatialNavigationExit')?.detail.direction, 'up');
    });

    test('falls back to alert("__FOCUS_EXIT__:up") when no bridge', () => {
        const button = attachElement(createElement({ tagName: 'button', id: 'only' }));
        setActiveElement(button);
        const state = createTestState([button]);

        (globalThis as { browser?: unknown }).browser = undefined;
        let lastAlert: string | undefined;
        (globalThis as { alert?: (m: string) => void }).alert = (m: string) => {
            lastAlert = m;
        };

        const moved = moveInDirection(UP, null, state);

        assert.equal(moved, false);
        assert.equal(lastAlert, '__FOCUS_EXIT__:up');
    });
});
