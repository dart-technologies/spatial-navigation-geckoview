/**
 * Regression tests for the scroll listener's per-rAF tracking contract
 * (v3.1.3).
 *
 * Background
 * ----------
 * The scroll listener used to filter per-scroll-event deltas by
 * `config.scrollThreshold` (default 8 px) AND only update its cache
 * when the threshold was crossed. That combination made smooth-scroll
 * tracking effectively single-shot: a `behavior:'smooth'`
 * `window.scrollBy(312)` emits ~17 scroll events at 4–15 px per frame,
 * none of which crossed the 8-px threshold relative to the stale cache,
 * so the listener fired exactly ONCE (at the very start) and the focus
 * ring's `position: fixed` viewport coords sat stale for the ~300 ms
 * the smooth scroll took to complete. The user perceived this as the
 * ring "sliding off and returning to settle" — the ring stayed put in
 * viewport space while the focused-element rect drifted across it.
 *
 * The fix:
 *   1. Refresh the scroll-position cache on EVERY rAF tick, not just on
 *      fire. The threshold (if used) now measures frame-to-frame
 *      jitter, not cumulative-since-last-fire drift.
 *   2. Drop the px threshold entirely. The rAF debounce above already
 *      rate-limits to one fire per frame; the px filter only ever
 *      caused stale-ring artifacts. Skip 0-px events (no-op scroll
 *      events some browsers fire after instant scrollIntoView).
 *
 * These tests pin both invariants so a future refactor can't
 * reintroduce the stale period.
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
import { attachScrollListener } from '../navigation/handlers';

async function flushRaf(): Promise<void> {
    // happy-dom shims rAF as setTimeout(0). Drain a couple ticks to let
    // the rAF callback run + any nested microtasks settle.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
}

function setScrollY(y: number): void {
    Object.defineProperty(window, 'scrollY', { value: y, configurable: true });
    Object.defineProperty(window, 'scrollX', { value: 0, configurable: true });
}

function dispatchScroll(): void {
    window.dispatchEvent(new Event('scroll'));
}

describe('attachScrollListener — per-rAF tracking (v3.1.3)', () => {
    beforeEach(() => setupDomEnv({ innerWidth: 1408, innerHeight: 900 }));
    afterEach(() => teardownDomEnv());

    test(
        'fires per-rAF-tick during simulated smooth scroll — does NOT ' +
            'gate on `scrollThreshold` (repro for "ring slides off and ' +
            'returns to settle")',
        async () => {
            // Track every time `currentEntry.rect` gets updated — that's
            // the inside-the-rAF refresh of the focused element's
            // viewport rect. If the scroll listener fires per-frame,
            // every scroll event nudges the rect; if it gates on a
            // threshold, only the events that cross fire and the
            // updates between are skipped.
            const focused = attachElement(
                createElement({
                    tagName: 'button',
                    rect: { x: 100, y: 100, width: 80, height: 40 },
                })
            );
            setActiveElement(focused);
            const state = createTestState(
                [focused],
                { currentIndex: 0 },
                // Even with the legacy threshold configured high, the
                // listener should still fire per-rAF — threshold is a
                // no-op now.
                { scrollThreshold: 100 }
            );
            // Sanity: the createTestState helper merges into a baseline
            // config; pull the entry it built so we can watch rect
            // updates.
            const entry = state.focusables[0];
            assert.ok(entry);

            // Spy: count how many times the listener calls
            // `getBoundingClientRect` on the active element. happy-dom
            // exposes the underlying rect setter via the helper, so we
            // just wrap the method.
            let getRectCalls = 0;
            const origGetBoundingClientRect = focused.getBoundingClientRect.bind(focused);
            focused.getBoundingClientRect = function () {
                getRectCalls++;
                // Return a rect that shifts up as scrollY grows — mimics
                // the page scrolling underneath a fixed-viewport element.
                const top = 100 - window.scrollY;
                return {
                    left: 100,
                    top,
                    right: 180,
                    bottom: top + 40,
                    width: 80,
                    height: 40,
                    x: 100,
                    y: top,
                    toJSON() {
                        return this;
                    },
                } as DOMRect;
            };

            try {
                attachScrollListener(state);

                // Simulate a 300 ms smooth-scrollBy(top: 312) — 17
                // events at ~18 px each. None of these crosses 100 px
                // individually, so the OLD threshold-gated listener
                // would have fired exactly once.
                setScrollY(0);
                dispatchScroll();
                await flushRaf();

                const deltas = [
                    18, 36, 54, 72, 90, 108, 126, 144, 162, 180, 198, 216, 234, 252, 270, 288, 312,
                ];
                for (const y of deltas) {
                    setScrollY(y);
                    dispatchScroll();
                    await flushRaf();
                }

                // The first scroll at scrollY=0 has delta 0 (cache
                // initialised from currentScrollY), so it's a no-op.
                // Each subsequent event should fire (>0 delta) and call
                // getBoundingClientRect once via the listener.
                assert.ok(
                    getRectCalls >= deltas.length,
                    `expected at least ${deltas.length} rect reads (one per non-zero scroll), got ${getRectCalls}`
                );

                // Final entry rect should reflect the LAST scroll
                // position, not the first. Pre-fix the listener fired
                // once at the start and the entry would still hold the
                // first scroll's rect.
                assert.equal(
                    entry.top,
                    100 - 312,
                    'entry rect must reflect the final scroll position, ' + 'not the stale first-event rect'
                );
            } finally {
                focused.getBoundingClientRect = origGetBoundingClientRect;
            }
        }
    );

    test('does NOT fire on a 0-px scroll event (post-scrollIntoView no-op)', async () => {
        const focused = attachElement(
            createElement({
                tagName: 'button',
                rect: { x: 100, y: 100, width: 80, height: 40 },
            })
        );
        setActiveElement(focused);
        const state = createTestState([focused], { currentIndex: 0 });

        let getRectCalls = 0;
        const origGetBoundingClientRect = focused.getBoundingClientRect.bind(focused);
        focused.getBoundingClientRect = function () {
            getRectCalls++;
            return origGetBoundingClientRect();
        };

        try {
            attachScrollListener(state);

            // Initialise the cache by firing one real scroll event.
            setScrollY(100);
            dispatchScroll();
            await flushRaf();
            const baselineCalls = getRectCalls;

            // Now fire scroll events with the SAME scrollY repeatedly.
            // Each has delta=0; the listener should skip.
            for (let i = 0; i < 5; i++) {
                dispatchScroll();
                await flushRaf();
            }

            assert.equal(
                getRectCalls,
                baselineCalls,
                'a 0-px scroll event must NOT trigger an overlay update'
            );
        } finally {
            focused.getBoundingClientRect = origGetBoundingClientRect;
        }
    });

    test('skips when no focused element is in the focusables list', async () => {
        const state = createTestState([], { currentIndex: -1 });
        attachScrollListener(state);

        // Should be a complete no-op — no errors, no fires.
        setScrollY(50);
        dispatchScroll();
        await flushRaf();

        // Nothing crashes; nothing to assert beyond reaching here.
        assert.ok(true);
    });
});
