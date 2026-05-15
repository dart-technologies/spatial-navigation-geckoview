/**
 * Tests for `showOverlay` — position writing, off-viewport hide, and
 * snap-class behaviour for big position jumps.
 *
 * Why these matter
 * ----------------
 * 1. Off-viewport hide (v3.1.1 regression fix): the clamp math used to
 *    produce non-positive width/height when the focused element was
 *    fully outside the viewport, which CSS renders as 0×0 — the ring
 *    visibly disappeared mid-scroll. We now hide explicitly so scroll-
 *    tracking can re-show it cleanly when the element re-enters viewport.
 *
 * 2. Snap class (v3.1.1): position properties on the overlay no longer
 *    transition at all (v3.1.2 drop) — but the snap class also disables
 *    the remaining `opacity` + `transform` transitions so the overlay
 *    appears instantly when re-entering visibility after off-viewport
 *    or cross-viewport navigation. The earlier-iteration CSS
 *    is great for nudge-moves WITHIN the viewport but produces a
 *    "ring slides through empty space then settles" artifact when the
 *    user navigates to an off-screen target (pass-2 candidate +
 *    `scrollIntoView`). For big position jumps the overlay snaps
 *    (transition: none for one frame), then resumes smooth tracking.
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { ensureOverlay, showOverlay } from '../core/overlay';
import {
    setupDomEnv,
    teardownDomEnv,
    attachElement,
    createElement,
    createTestState,
} from './helpers/dom_env';

interface OverlayElements {
    overlay: HTMLElement;
}

function setupOverlayState() {
    const state = createTestState([]);
    ensureOverlay(state.config, state);

    // ensureOverlay attached host to body; pull out the shadow-root
    // overlay element so tests can inspect its style/classList.
    const host = document.getElementById('spatnav-focus-host');
    if (!host || !host.shadowRoot) {
        throw new Error('overlay host or shadow root missing — ensureOverlay failed');
    }
    const overlay = host.shadowRoot.getElementById('spatnav-focus-overlay') as HTMLElement | null;
    if (!overlay) {
        throw new Error('focus overlay element missing in shadow root');
    }
    // `ensureOverlay` does not populate `state.overlay` — that's done
    // elsewhere in init. Stage it manually for the test.
    state.overlay = overlay;
    return { state, overlay } as { state: typeof state; overlay: HTMLElement };
}

describe('showOverlay — off-viewport behaviour (v3.1.1)', () => {
    beforeEach(() => setupDomEnv({ innerWidth: 1408, innerHeight: 900 }));
    afterEach(() => teardownDomEnv());

    // The contract we want for fully-off-viewport elements:
    //
    //   - The overlay STAYS marked `visible` and STAYS rendered with
    //     positive width/height at the element's actual viewport-space
    //     coordinates (which may be off-screen). The browser clips
    //     off-screen pixels automatically, so the user sees the ring
    //     follow the element as it scrolls out of view — no abrupt
    //     "ring vanishes" mid-scroll.
    //
    //   - A `snap` class is applied so the CSS transition is skipped:
    //     the overlay teleports to the off-viewport coordinates rather
    //     than animating through empty space.
    //
    // The previous (broken) clamp math used `Math.max(-outlineExtent,
    // rect.left)` + `Math.min(viewportW + outlineExtent, rect.right)`
    // and produced NON-POSITIVE width/height when the element was
    // fully outside the viewport. CSS rendered the resulting box as
    // 0×0 (invisible), and an earlier patch made the invisibility
    // explicit via `classList.remove('visible')`. Both behaviours
    // produced the user-reported "focus ring still disappearing after
    // viewport shift" bug.

    test(
        'STAYS visible when focused element is fully BELOW the viewport ' +
            '(repro for "ring disappears after viewport shift")',
        () => {
            const { state, overlay } = setupOverlayState();
            // First render: in-viewport — establishes a non-empty
            // previous-render baseline (matches the real flow where the
            // ring was on the focused element before the page scrolled).
            const inView = attachElement(
                createElement({
                    tagName: 'button',
                    rect: { x: 100, y: 200, width: 80, height: 40 },
                })
            );
            showOverlay(inView as HTMLElement, state);

            // Element now fully below the viewport (innerHeight = 900).
            const offBelow = attachElement(
                createElement({
                    tagName: 'button',
                    rect: { x: 100, y: 5000, width: 80, height: 40 },
                })
            );
            showOverlay(offBelow as HTMLElement, state);

            assert.equal(
                overlay.classList.contains('visible'),
                true,
                'overlay must REMAIN visible — hiding produces the "ring vanishes" ' +
                    'artifact the user reported'
            );
            const w = parseFloat(overlay.style.width);
            const h = parseFloat(overlay.style.height);
            assert.ok(w > 0, `width must be > 0, got ${w}`);
            assert.ok(h > 0, `height must be > 0, got ${h}`);
            // Coordinates should track the actual element rect (off-screen);
            // the browser clips for us.
            assert.equal(parseFloat(overlay.style.top), 5000);
        }
    );

    test('STAYS visible when focused element is fully ABOVE the viewport', () => {
        const { state, overlay } = setupOverlayState();
        const inView = attachElement(
            createElement({
                tagName: 'button',
                rect: { x: 100, y: 200, width: 80, height: 40 },
            })
        );
        showOverlay(inView as HTMLElement, state);

        const offAbove = attachElement(
            createElement({
                tagName: 'button',
                rect: { x: 100, y: -500, width: 80, height: 40 },
            })
        );
        showOverlay(offAbove as HTMLElement, state);

        assert.equal(overlay.classList.contains('visible'), true);
        const w = parseFloat(overlay.style.width);
        const h = parseFloat(overlay.style.height);
        assert.ok(w > 0);
        assert.ok(h > 0);
        assert.equal(parseFloat(overlay.style.top), -500);
    });

    test('STAYS visible when focused element is fully RIGHT of the viewport', () => {
        const { state, overlay } = setupOverlayState();
        const inView = attachElement(
            createElement({
                tagName: 'button',
                rect: { x: 100, y: 200, width: 80, height: 40 },
            })
        );
        showOverlay(inView as HTMLElement, state);

        const offRight = attachElement(
            createElement({
                tagName: 'button',
                rect: { x: 5000, y: 100, width: 80, height: 40 },
            })
        );
        showOverlay(offRight as HTMLElement, state);

        assert.equal(overlay.classList.contains('visible'), true);
        assert.ok(parseFloat(overlay.style.width) > 0);
        assert.ok(parseFloat(overlay.style.height) > 0);
    });

    test('snaps (no CSS transition) when transitioning to fully off-viewport', () => {
        const { state, overlay } = setupOverlayState();
        const inView = attachElement(
            createElement({
                tagName: 'button',
                rect: { x: 100, y: 200, width: 80, height: 40 },
            })
        );
        showOverlay(inView as HTMLElement, state);
        overlay.classList.remove('snap'); // simulate rAF removal

        const offBelow = attachElement(
            createElement({
                tagName: 'button',
                rect: { x: 100, y: 5000, width: 80, height: 40 },
            })
        );
        showOverlay(offBelow as HTMLElement, state);

        assert.equal(
            overlay.classList.contains('snap'),
            true,
            'snap class must be applied so the overlay teleports to off-viewport ' +
                'coords instead of animating through empty space'
        );
    });

    test('shows overlay with positive dimensions when element is in viewport', () => {
        const { state, overlay } = setupOverlayState();
        const target = attachElement(
            createElement({
                tagName: 'button',
                rect: { x: 200, y: 300, width: 100, height: 40 },
            })
        );
        showOverlay(target as HTMLElement, state);
        assert.equal(overlay.classList.contains('visible'), true);
        const w = parseFloat(overlay.style.width);
        const h = parseFloat(overlay.style.height);
        assert.ok(w > 0, `width must be > 0, got ${w}`);
        assert.ok(h > 0, `height must be > 0, got ${h}`);
    });

    test('shows overlay clipped when element is PARTIALLY off-viewport at the bottom edge', () => {
        const { state, overlay } = setupOverlayState();
        // viewport height 900. Element top=850, height=200 → bottom=1050.
        // Partially visible (50px visible at the bottom edge).
        const target = attachElement(
            createElement({
                tagName: 'button',
                rect: { x: 100, y: 850, width: 200, height: 200 },
            })
        );
        showOverlay(target as HTMLElement, state);
        assert.equal(
            overlay.classList.contains('visible'),
            true,
            'overlay should still render on partially-visible elements'
        );
        const w = parseFloat(overlay.style.width);
        const h = parseFloat(overlay.style.height);
        assert.ok(w > 0, `width must be > 0, got ${w}`);
        assert.ok(h > 0, `height must be > 0, got ${h}`);
    });
});

describe('showOverlay — snap class for big jumps (v3.1.1)', () => {
    beforeEach(() => setupDomEnv({ innerWidth: 1408, innerHeight: 900 }));
    afterEach(() => teardownDomEnv());

    test('applies `snap` class when transitioning from hidden to visible', () => {
        const { state, overlay } = setupOverlayState();
        // Overlay starts hidden (no `visible` class).
        assert.equal(overlay.classList.contains('visible'), false);

        const target = attachElement(
            createElement({
                tagName: 'button',
                rect: { x: 200, y: 300, width: 100, height: 40 },
            })
        );
        showOverlay(target as HTMLElement, state);
        assert.equal(
            overlay.classList.contains('snap'),
            true,
            'first visible render must snap so the overlay does not animate ' +
                'from its prior (stale) position'
        );
    });

    test('applies `snap` class when overlay position jumps > 200px (cross-viewport ' + 'navigation)', () => {
        const { state, overlay } = setupOverlayState();
        // First render: small element near top.
        const first = attachElement(
            createElement({
                tagName: 'button',
                rect: { x: 100, y: 50, width: 80, height: 40 },
            })
        );
        showOverlay(first as HTMLElement, state);
        overlay.classList.remove('snap'); // simulate the rAF-removal

        // Second render: element far away (delta-y = 750).
        const second = attachElement(
            createElement({
                tagName: 'button',
                rect: { x: 100, y: 800, width: 80, height: 40 },
            })
        );
        showOverlay(second as HTMLElement, state);
        assert.equal(overlay.classList.contains('snap'), true, 'a 750px vertical jump must trigger snap');
    });

    test(
        'does NOT apply `snap` for small in-viewport nudges (≤ 200px) — those ' +
            'should animate smoothly via the CSS transition',
        () => {
            const { state, overlay } = setupOverlayState();
            const first = attachElement(
                createElement({
                    tagName: 'button',
                    rect: { x: 100, y: 100, width: 80, height: 40 },
                })
            );
            showOverlay(first as HTMLElement, state);
            overlay.classList.remove('snap');

            // Second render: 150px lower — within the smooth-tracking band.
            const second = attachElement(
                createElement({
                    tagName: 'button',
                    rect: { x: 100, y: 250, width: 80, height: 40 },
                })
            );
            showOverlay(second as HTMLElement, state);
            assert.equal(
                overlay.classList.contains('snap'),
                false,
                'small position deltas should NOT snap — CSS transition handles them'
            );
        }
    );
});
