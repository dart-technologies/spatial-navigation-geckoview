/**
 * Preview UI tests — chevrons positioned around the focus ring.
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { directionByName, type Direction } from '../core/config';
import { updatePreviewTargets, updatePreviewVisuals } from '../core/preview';
import {
    setupDomEnv,
    teardownDomEnv,
    attachElement,
    createElement,
    createTestState,
} from './helpers/dom_env';
import type { NavigationCandidate } from '../core/scoring';

function makePreviewLayer(): {
    layer: HTMLElement;
    entries: Record<'up' | 'down' | 'left' | 'right', { container: HTMLElement; arrow: HTMLElement }>;
} {
    const layer = attachElement(createElement({ tagName: 'div', id: 'preview-layer' }));
    const directions = ['up', 'down', 'left', 'right'] as const;
    const entries = {} as Record<
        'up' | 'down' | 'left' | 'right',
        { container: HTMLElement; arrow: HTMLElement }
    >;
    for (const dir of directions) {
        const container = createElement({ tagName: 'div', className: `focus-preview focus-preview-${dir}` });
        const arrow = createElement({ tagName: 'div', className: 'focus-preview-arrow' });
        container.appendChild(arrow);
        layer.appendChild(container);
        entries[dir] = { container, arrow };
    }
    return { layer, entries };
}

describe('updatePreviewVisuals', () => {
    beforeEach(() => setupDomEnv({ innerWidth: 1920, innerHeight: 1080 }));
    afterEach(() => teardownDomEnv());

    test('positions the right chevron just outside the current rect', () => {
        const current = attachElement(
            createElement({ tagName: 'button', rect: { x: 100, y: 100, width: 100, height: 40 } })
        );
        const target = attachElement(
            createElement({ tagName: 'button', rect: { x: 300, y: 100, width: 100, height: 40 } })
        );

        const { layer, entries } = makePreviewLayer();
        const state = createTestState([current, target], {
            previewEnabled: true,
            previewLayer: layer,
            previewElements: entries,
        });
        state.currentIndex = 0;

        const findCandidate = (_idx: number, dir: Direction): NavigationCandidate | null =>
            dir.name === 'right'
                ? ({ data: { element: target }, index: 1 } as unknown as NavigationCandidate)
                : null;

        updatePreviewVisuals(
            current,
            current.getBoundingClientRect(),
            findCandidate,
            directionByName,
            (el) => (el ? 'candidate' : ''),
            state
        );

        // size = clamp(14..26, round(min(100,40)*0.28)=11) → 14
        // offset = CHEVRON_RING_GAP (14) — constant, no longer scales
        // with chevron size. right edge 200 + 14 = 214.
        assert.equal(entries.right.container.style.left, '214px');
        assert.equal(entries.right.container.style.width, '14px');
        assert.equal(entries.right.container.className, 'focus-preview focus-preview-right show');
    });

    test('hides the chevron when there is no room outside the focused element at viewport edge (2026-05-13)', () => {
        // Previously, an edge-flush element with a candidate in the
        // "no-room" direction caused the chevron to be CLAMPED into the
        // safe-area margin — placing it on top of the focused element.
        // The visual bug: a right-chevron for an element flush against
        // the right viewport edge rendered INSIDE the focus ring,
        // blocking the underlying image. The new policy: hide rather
        // than misplace. The target is still recorded in
        // state.nextTargets for ARIA / next-press semantics.
        const current = attachElement(
            createElement({ tagName: 'button', rect: { x: 10, y: 10, width: 50, height: 30 } })
        );
        const target = attachElement(
            createElement({ tagName: 'button', rect: { x: 200, y: 10, width: 50, height: 30 } })
        );

        teardownDomEnv();
        setupDomEnv({ innerWidth: 300, innerHeight: 300 });

        const current2 = attachElement(
            createElement({ tagName: 'button', rect: { x: 10, y: 10, width: 50, height: 30 } })
        );
        const target2 = attachElement(
            createElement({ tagName: 'button', rect: { x: 200, y: 10, width: 50, height: 30 } })
        );
        void current;
        void target;

        const { layer, entries } = makePreviewLayer();
        const state = createTestState(
            [current2, target2],
            {
                previewEnabled: true,
                previewLayer: layer,
                previewElements: entries,
            },
            { safeAreaMargin: 20 }
        );
        state.currentIndex = 0;

        const findCandidate = (_idx: number, dir: Direction): NavigationCandidate | null =>
            dir.name === 'left'
                ? ({ data: { element: target2 }, index: 1 } as unknown as NavigationCandidate)
                : null;

        updatePreviewVisuals(
            current2,
            current2.getBoundingClientRect(),
            findCandidate,
            directionByName,
            (el) => (el ? 'candidate' : ''),
            state
        );

        // Left-chevron has no room: element left edge = 10, size ~= 14,
        // offset >= 10, so chevron's right edge would land at ~10 -
        // offset - size + size = -10, well outside the viewport. Hide.
        assert.equal(entries.left.container.style.left, '');
        assert.equal(entries.left.container.style.top, '');
        assert.equal(entries.left.container.className, 'focus-preview focus-preview-left');
        // State should still record the target.
        assert.equal(state.nextTargets.left?.data.element, target2);
    });

    test('hides right-chevron when focused element is flush against the right viewport edge', () => {
        teardownDomEnv();
        setupDomEnv({ innerWidth: 400, innerHeight: 300 });
        const current = attachElement(
            createElement({ tagName: 'button', rect: { x: 380, y: 100, width: 20, height: 40 } })
        );
        const target = attachElement(
            createElement({ tagName: 'button', rect: { x: 100, y: 100, width: 50, height: 40 } })
        );
        const { layer, entries } = makePreviewLayer();
        const state = createTestState(
            [current, target],
            {
                previewEnabled: true,
                previewLayer: layer,
                previewElements: entries,
            },
            { safeAreaMargin: 12 }
        );
        state.currentIndex = 0;
        const findCandidate = (_idx: number, dir: Direction): NavigationCandidate | null =>
            dir.name === 'right'
                ? ({ data: { element: target }, index: 1 } as unknown as NavigationCandidate)
                : null;
        updatePreviewVisuals(
            current,
            current.getBoundingClientRect(),
            findCandidate,
            directionByName,
            (el) => (el ? 'candidate' : ''),
            state
        );
        // Right-chevron would render outside the viewport's right edge —
        // hide cleanly rather than clamping back into the focus ring.
        assert.equal(entries.right.container.className, 'focus-preview focus-preview-right');
        assert.equal(entries.right.container.style.left, '');
    });

    test('chevron-to-ring gap is constant across element sizes (variable-gap fix — 2026-05-13)', () => {
        // The chevron's `offset` from the focused-element edge used to
        // scale with chevron size (`max(10, round(size * 0.75))`), so
        // small elements got a tight gap (~11 px) while large elements
        // got a wide gap (~17 px). With the visual-rect fix from
        // earlier in the day, the Dart logo's ring uses the larger
        // image rect → larger chevron → noticeably wider gap than
        // adjacent small links. We now use a constant gap so all
        // chevrons appear the same distance from the ring.
        teardownDomEnv();
        setupDomEnv({ innerWidth: 1920, innerHeight: 1080 });

        // Small element: 30×30
        const small = attachElement(
            createElement({ tagName: 'button', rect: { x: 100, y: 100, width: 30, height: 30 } })
        );
        const smallTarget = attachElement(
            createElement({ tagName: 'button', rect: { x: 400, y: 100, width: 30, height: 30 } })
        );
        const smallLayer = makePreviewLayer();
        const smallState = createTestState([small, smallTarget], {
            previewEnabled: true,
            previewLayer: smallLayer.layer,
            previewElements: smallLayer.entries,
        });
        smallState.currentIndex = 0;
        updatePreviewVisuals(
            small,
            small.getBoundingClientRect(),
            (_i, dir) =>
                dir.name === 'right'
                    ? ({ data: { element: smallTarget }, index: 1 } as unknown as NavigationCandidate)
                    : null,
            directionByName,
            (el) => (el ? 'candidate' : ''),
            smallState
        );
        const smallGap = parseInt(smallLayer.entries.right.container.style.left, 10) - 130;

        // Large element: 300×200
        const large = attachElement(
            createElement({ tagName: 'button', rect: { x: 100, y: 400, width: 300, height: 200 } })
        );
        const largeTarget = attachElement(
            createElement({ tagName: 'button', rect: { x: 800, y: 400, width: 50, height: 40 } })
        );
        const largeLayer = makePreviewLayer();
        const largeState = createTestState([large, largeTarget], {
            previewEnabled: true,
            previewLayer: largeLayer.layer,
            previewElements: largeLayer.entries,
        });
        largeState.currentIndex = 0;
        updatePreviewVisuals(
            large,
            large.getBoundingClientRect(),
            (_i, dir) =>
                dir.name === 'right'
                    ? ({ data: { element: largeTarget }, index: 1 } as unknown as NavigationCandidate)
                    : null,
            directionByName,
            (el) => (el ? 'candidate' : ''),
            largeState
        );
        const largeGap = parseInt(largeLayer.entries.right.container.style.left, 10) - 400;

        assert.equal(
            smallGap,
            largeGap,
            'chevron-to-ring gap must be identical for small and large focused elements'
        );
        assert.equal(smallGap, 14, 'gap should be the CHEVRON_RING_GAP constant (14)');
    });

    test('chevron centers on the VISUAL rect, not the small hit-area rect (Dart-logo class — 2026-05-13)', () => {
        // The focused `<a>` is a small 24×24 hit area, but the `<img>`
        // inside is 200×80 — the expand-to-fit path makes the ring
        // wrap the image. Previously, `updatePreviewVisuals` computed
        // chevron position from `getBoundingClientRect()` (the small
        // hit area), so the chevron ended up at the bottom-right
        // corner of the ring instead of vertically centred. The fix:
        // always use `calculateVisualRect()` for chevron positioning,
        // matching the rect the ring uses.
        teardownDomEnv();
        setupDomEnv({ innerWidth: 1920, innerHeight: 1080 });

        const link = attachElement(
            createElement({
                tagName: 'a',
                rect: { x: 100, y: 100, width: 24, height: 24 },
            })
        );
        const logoImg = createElement({
            tagName: 'img',
            rect: { x: 50, y: 50, width: 200, height: 80 },
        });
        link.appendChild(logoImg);

        const target = attachElement(
            createElement({
                tagName: 'a',
                rect: { x: 500, y: 80, width: 50, height: 40 },
            })
        );

        const { layer, entries } = makePreviewLayer();
        const state = createTestState([link, target], {
            previewEnabled: true,
            previewLayer: layer,
            previewElements: entries,
        });
        state.currentIndex = 0;
        const findCandidate = (_idx: number, dir: Direction): NavigationCandidate | null =>
            dir.name === 'right'
                ? ({ data: { element: target }, index: 1 } as unknown as NavigationCandidate)
                : null;

        updatePreviewVisuals(
            link,
            // Pass the small hit-area rect; the implementation MUST
            // ignore this and compute the visual rect itself.
            link.getBoundingClientRect(),
            findCandidate,
            directionByName,
            (el) => (el ? 'candidate' : ''),
            state
        );

        // The visual rect (image rect) is at (50, 50, 200, 80).
        // Right chevron's top should center on visualRect's vertical
        // midpoint, i.e. 50 + 80/2 - size/2 = 90 - size/2.
        // Chevron `size` = clamp(14..26, round(min(200,80)*0.28)=22) → 22.
        // Expected top = 90 - 11 = 79.
        assert.equal(
            entries.right.container.style.top,
            '79px',
            'chevron must vertically center on the VISUAL rect (image), not the hit-area rect'
        );

        // Chevron `left` = visualRect.right + CHEVRON_RING_GAP (constant 14)
        //                = 250 + 14 = 264.
        assert.equal(
            entries.right.container.style.left,
            '264px',
            'chevron must be positioned just OUTSIDE the visual rect (ring extent), not the hit-area rect'
        );
        assert.equal(entries.right.container.className, 'focus-preview focus-preview-right show');
    });

    test('hides down-chevron when focused element is flush against the bottom viewport edge', () => {
        teardownDomEnv();
        setupDomEnv({ innerWidth: 600, innerHeight: 400 });
        const current = attachElement(
            createElement({ tagName: 'button', rect: { x: 100, y: 380, width: 80, height: 20 } })
        );
        const target = attachElement(
            createElement({ tagName: 'button', rect: { x: 100, y: 100, width: 80, height: 40 } })
        );
        const { layer, entries } = makePreviewLayer();
        const state = createTestState(
            [current, target],
            {
                previewEnabled: true,
                previewLayer: layer,
                previewElements: entries,
            },
            { safeAreaMargin: 12 }
        );
        state.currentIndex = 0;
        const findCandidate = (_idx: number, dir: Direction): NavigationCandidate | null =>
            dir.name === 'down'
                ? ({ data: { element: target }, index: 1 } as unknown as NavigationCandidate)
                : null;
        updatePreviewVisuals(
            current,
            current.getBoundingClientRect(),
            findCandidate,
            directionByName,
            (el) => (el ? 'candidate' : ''),
            state
        );
        assert.equal(entries.down.container.className, 'focus-preview focus-preview-down');
    });

    test('hides the chevron when no candidate exists in that direction', () => {
        const current = attachElement(
            createElement({ tagName: 'button', rect: { x: 100, y: 100, width: 100, height: 40 } })
        );

        const { layer, entries } = makePreviewLayer();
        const state = createTestState([current], {
            previewEnabled: true,
            previewLayer: layer,
            previewElements: entries,
        });
        state.currentIndex = 0;

        updatePreviewVisuals(
            current,
            current.getBoundingClientRect(),
            () => null,
            directionByName,
            () => '',
            state
        );

        assert.equal(entries.up.container.className, 'focus-preview focus-preview-up');
        assert.equal(entries.up.container.style.left, '');
    });
});

describe('updatePreviewTargets — passIndex filter (2026-05-13)', () => {
    beforeEach(() => setupDomEnv({ innerWidth: 1920, innerHeight: 1080 }));
    afterEach(() => teardownDomEnv());

    // Background: `findDirectionalCandidate` runs up to three scoring
    // passes. Passes 0 and 1 are strict (in-viewport, in-cone). Pass 2 is
    // a wide-net fallback with `requireViewport:false` that returns any
    // focusable in the DOM within a generous ±36° cone — including
    // far-away off-screen elements. There is also a wrap-around pass
    // (passIndex === -1) used when the user navigates past the visual
    // boundary.
    //
    // Before this fix, `updatePreviewTargets` returned ALL candidate
    // passes for the preview chevrons. On YouTube's right rail, the
    // pass-2 candidate to the left was a far-off-screen element across
    // the entire page — the user saw a "press left to navigate" chevron,
    // pressed left, and either focus jumped silently to an unseen
    // element or `applyFocus` rejected and nothing visible happened.
    // The preview had lied.
    //
    // Move-logic (`handleKeyDown → moveInDirection → findDirectionalCandidate`)
    // is unchanged — power users can still reach pass-2 targets by
    // pressing the key. Only the preview UI filters them out.

    test('drops pass-2 wide-net candidates from preview targets', () => {
        const current = attachElement(
            createElement({ tagName: 'button', rect: { x: 1500, y: 500, width: 100, height: 40 } })
        );
        const farLeft = attachElement(
            createElement({ tagName: 'button', rect: { x: 10, y: 50, width: 100, height: 40 } })
        );

        const state = createTestState([current, farLeft], {});
        state.currentIndex = 0;

        // Mock find: only "left" has a candidate, and it comes from
        // pass 2 (wide-net, off-screen). The filter should drop it.
        const findCandidate = (_idx: number, dir: Direction): NavigationCandidate | null =>
            dir.name === 'left'
                ? ({
                      data: { element: farLeft },
                      index: 1,
                      passIndex: 2,
                  } as unknown as NavigationCandidate)
                : null;

        const result = updatePreviewTargets(0, findCandidate, directionByName, state);

        assert.equal(
            result.left,
            null,
            'pass-2 candidate must be filtered from preview — chevron should not promise an unreachable target'
        );
        assert.equal(result.up, null);
        assert.equal(result.down, null);
        assert.equal(result.right, null);
    });

    test(
        'KEEPS pass-2 candidates for up/down when boundaryScrollBehavior is "scroll" ' +
            '(press IS actionable via window.scrollBy)',
        () => {
            const current = attachElement(
                createElement({ tagName: 'button', rect: { x: 100, y: 100, width: 100, height: 40 } })
            );
            const farDown = attachElement(
                createElement({ tagName: 'button', rect: { x: 100, y: 2000, width: 100, height: 40 } })
            );

            const state = createTestState(
                [current, farDown],
                {},
                {
                    boundaryScrollBehavior: 'scroll',
                }
            );
            state.currentIndex = 0;

            const candidate: NavigationCandidate = {
                data: { element: farDown },
                index: 1,
                passIndex: 2,
            } as unknown as NavigationCandidate;

            const findCandidate = (_idx: number, dir: Direction): NavigationCandidate | null =>
                dir.name === 'down' ? candidate : null;

            const result = updatePreviewTargets(0, findCandidate, directionByName, state);

            assert.equal(
                result.down,
                candidate,
                'pass-2 vertical chevron must be kept when scroll-on-boundary is enabled — ' +
                    'pressing down WILL scroll into view'
            );
        }
    );

    test(
        'still DROPS pass-2 horizontal candidates even when boundaryScrollBehavior is "scroll" ' +
            '(no horizontal page scroll auto-recovery)',
        () => {
            const current = attachElement(
                createElement({ tagName: 'button', rect: { x: 1500, y: 500, width: 100, height: 40 } })
            );
            const farLeft = attachElement(
                createElement({ tagName: 'button', rect: { x: 10, y: 50, width: 100, height: 40 } })
            );

            const state = createTestState(
                [current, farLeft],
                {},
                {
                    boundaryScrollBehavior: 'scroll',
                }
            );
            state.currentIndex = 0;

            const findCandidate = (_idx: number, dir: Direction): NavigationCandidate | null =>
                dir.name === 'left'
                    ? ({
                          data: { element: farLeft },
                          index: 1,
                          passIndex: 2,
                      } as unknown as NavigationCandidate)
                    : null;

            const result = updatePreviewTargets(0, findCandidate, directionByName, state);

            assert.equal(
                result.left,
                null,
                'horizontal pass-2 chevron must still be filtered — boundaryScrollBehavior:scroll ' +
                    'only handles vertical (up/down)'
            );
        }
    );

    test('drops wrap-around (passIndex === -1) candidates from preview targets', () => {
        const current = attachElement(
            createElement({ tagName: 'button', rect: { x: 1500, y: 500, width: 100, height: 40 } })
        );
        const wrapTarget = attachElement(
            createElement({ tagName: 'button', rect: { x: 200, y: 50, width: 100, height: 40 } })
        );

        const state = createTestState([current, wrapTarget], {});
        state.currentIndex = 0;

        const findCandidate = (_idx: number, dir: Direction): NavigationCandidate | null =>
            dir.name === 'down'
                ? ({
                      data: { element: wrapTarget },
                      index: 1,
                      passIndex: -1,
                  } as unknown as NavigationCandidate)
                : null;

        const result = updatePreviewTargets(0, findCandidate, directionByName, state);

        assert.equal(
            result.down,
            null,
            'wrap-pass candidate must be filtered from preview — wrapping is surprising as a preview hint'
        );
    });

    test('keeps pass-0 (strict in-viewport) candidates in preview targets', () => {
        const current = attachElement(
            createElement({ tagName: 'button', rect: { x: 100, y: 100, width: 100, height: 40 } })
        );
        const closeTarget = attachElement(
            createElement({ tagName: 'button', rect: { x: 300, y: 100, width: 100, height: 40 } })
        );

        const state = createTestState([current, closeTarget], {});
        state.currentIndex = 0;

        const passZeroCandidate: NavigationCandidate = {
            data: { element: closeTarget },
            index: 1,
            passIndex: 0,
        } as unknown as NavigationCandidate;

        const findCandidate = (_idx: number, dir: Direction): NavigationCandidate | null =>
            dir.name === 'right' ? passZeroCandidate : null;

        const result = updatePreviewTargets(0, findCandidate, directionByName, state);

        assert.equal(result.right, passZeroCandidate);
    });

    test('keeps pass-1 (relaxed in-viewport) candidates in preview targets', () => {
        const current = attachElement(
            createElement({ tagName: 'button', rect: { x: 100, y: 100, width: 100, height: 40 } })
        );
        const reachableTarget = attachElement(
            createElement({ tagName: 'button', rect: { x: 100, y: 300, width: 100, height: 40 } })
        );

        const state = createTestState([current, reachableTarget], {});
        state.currentIndex = 0;

        const passOneCandidate: NavigationCandidate = {
            data: { element: reachableTarget },
            index: 1,
            passIndex: 1,
        } as unknown as NavigationCandidate;

        const findCandidate = (_idx: number, dir: Direction): NavigationCandidate | null =>
            dir.name === 'down' ? passOneCandidate : null;

        const result = updatePreviewTargets(0, findCandidate, directionByName, state);

        assert.equal(result.down, passOneCandidate);
    });

    test('handles missing passIndex (candidates without the field) as accepted', () => {
        // Defensive: legacy / synthetic candidates that don't carry a
        // passIndex should still appear in the preview (better to show
        // a hint than silently drop). passIndex is `?: number` in the
        // NavigationCandidate type.
        const current = attachElement(
            createElement({ tagName: 'button', rect: { x: 100, y: 100, width: 100, height: 40 } })
        );
        const target = attachElement(
            createElement({ tagName: 'button', rect: { x: 300, y: 100, width: 100, height: 40 } })
        );

        const state = createTestState([current, target], {});
        state.currentIndex = 0;

        const synthetic: NavigationCandidate = {
            data: { element: target },
            index: 1,
            // no passIndex field
        } as unknown as NavigationCandidate;

        const findCandidate = (_idx: number, dir: Direction): NavigationCandidate | null =>
            dir.name === 'right' ? synthetic : null;

        const result = updatePreviewTargets(0, findCandidate, directionByName, state);

        assert.equal(result.right, synthetic);
    });
});
