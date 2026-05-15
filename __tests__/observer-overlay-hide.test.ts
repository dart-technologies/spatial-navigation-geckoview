/**
 * Regression tests for the mutation-observer overlay-hide path (v3.1.2).
 *
 * The bug
 * -------
 * `utils/observer.ts` previously hid the overlay whenever
 * `state.focusableElements` didn't include the currently-active element
 * after a refresh. On sites with frequent DOM mutations (lazy-loading
 * hero animations on dart.art, React/Vue re-renders) this fired the
 * hide repeatedly during normal interaction — the user-reported
 * "focus ring still disappearing after viewport shift" bug.
 *
 * Root cause: `refreshFocusables` rebuilds `state.focusableElements`
 * with the post-mutation node set. If a focusable was just re-mounted
 * (same logical element, new node identity) OR the refresh was racing
 * a transient render, the active element's identity wasn't in the
 * fresh array. The observer interpreted that as "focus invalidated"
 * and hid the overlay — even though the active element was still
 * connected and a legitimate focus target.
 *
 * The fix: only hide when the active element is genuinely invalid
 * (disconnected, body, documentElement). Otherwise reposition.
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
import { attachMutationObserver } from '../utils/observer';
import { ensureOverlay } from '../core/overlay';

const MUTATION_DEBOUNCE = 100;

function setupOverlayState() {
    const state = createTestState([]);
    ensureOverlay(state.config, state);
    const host = document.getElementById('spatnav-focus-host');
    if (!host || !host.shadowRoot) throw new Error('overlay host missing');
    const overlay = host.shadowRoot.getElementById('spatnav-focus-overlay');
    if (!overlay) throw new Error('overlay missing');
    state.overlay = overlay as HTMLElement;
    return { state, overlay: overlay as HTMLElement };
}

async function waitForObserverFlush(extra = 50): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, MUTATION_DEBOUNCE + extra));
}

describe('mutation observer — overlay-hide policy (v3.1.2)', () => {
    beforeEach(() => setupDomEnv({ innerWidth: 1408, innerHeight: 900 }));
    afterEach(() => teardownDomEnv());

    test(
        'does NOT hide overlay on DOM mutation when active element is still ' +
            'connected (repro for "ring disappears on lazy-load scroll")',
        async () => {
            const { state, overlay } = setupOverlayState();
            const focused = attachElement(
                createElement({
                    tagName: 'button',
                    rect: { x: 100, y: 100, width: 80, height: 40 },
                })
            );
            setActiveElement(focused);
            state.focusableElements = [focused];
            state.focusables = [
                {
                    element: focused,
                    index: 0,
                    left: 100,
                    top: 100,
                    right: 180,
                    bottom: 140,
                    width: 80,
                    height: 40,
                    centerX: 140,
                    centerY: 120,
                    rect: focused.getBoundingClientRect(),
                    scrollKey: 'body',
                    groupId: null,
                } as never,
            ];
            state.currentIndex = 0;
            overlay.classList.add('visible'); // start visible

            attachMutationObserver(state);

            // Simulate a lazy-load: a SIBLING element is appended via
            // DOM mutation. The active focused element stays the same
            // and stays connected. happy-dom's refreshFocusables may or
            // may not re-include it depending on the test fixture, but
            // the OBSERVER must not hide the overlay regardless because
            // `active.isConnected === true`.
            const sibling = createElement({
                tagName: 'div',
                rect: { x: 200, y: 500, width: 100, height: 40 },
            });
            document.body.appendChild(sibling);

            await waitForObserverFlush();

            assert.equal(focused.isConnected, true, 'sanity: active element should still be connected');
            assert.equal(
                overlay.classList.contains('visible'),
                true,
                'overlay MUST remain visible — the active element is still ' +
                    'connected even though a mutation occurred'
            );
        }
    );

    test(
        'DOES hide overlay when the active element is disconnected from the ' + 'DOM (genuine invalidation)',
        async () => {
            const { state, overlay } = setupOverlayState();
            const focused = attachElement(
                createElement({
                    tagName: 'button',
                    rect: { x: 100, y: 100, width: 80, height: 40 },
                })
            );
            setActiveElement(focused);
            state.focusableElements = [focused];
            state.focusables = [
                {
                    element: focused,
                    index: 0,
                    left: 100,
                    top: 100,
                    right: 180,
                    bottom: 140,
                    width: 80,
                    height: 40,
                    centerX: 140,
                    centerY: 120,
                    rect: focused.getBoundingClientRect(),
                    scrollKey: 'body',
                    groupId: null,
                } as never,
            ];
            state.currentIndex = 0;
            overlay.classList.add('visible');

            attachMutationObserver(state);

            // Genuine invalidation: the active element is REMOVED from the DOM.
            focused.remove();

            // Trigger an unrelated mutation so the observer fires.
            const sibling = createElement({ tagName: 'div' });
            document.body.appendChild(sibling);

            await waitForObserverFlush();

            assert.equal(focused.isConnected, false);
            assert.equal(
                overlay.classList.contains('visible'),
                false,
                'overlay must be hidden when the active element is no longer ' +
                    'in the DOM — there is no valid focus target'
            );
        }
    );

    test('DOES hide overlay when active falls back to document.body (no real focus)', async () => {
        const { state, overlay } = setupOverlayState();
        const focused = attachElement(createElement({ tagName: 'button' }));
        setActiveElement(focused);
        state.focusableElements = [focused];
        state.currentIndex = 0;
        overlay.classList.add('visible');

        attachMutationObserver(state);

        // Simulate focus falling back to body (no real focus target).
        setActiveElement(null);
        const sibling = createElement({ tagName: 'div' });
        document.body.appendChild(sibling);

        await waitForObserverFlush();

        assert.equal(
            overlay.classList.contains('visible'),
            false,
            'overlay must hide when active falls back to body / null'
        );
    });
});
