/**
 * Tests for `calculateVisualRect` — the overlay's choice of rect for the
 * focused element. Covers both the shrink-to-fit (link wrapping a
 * dominant image) and expand-to-fit (logo / image-button with overflow)
 * heuristics added 2026-05-13.
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { calculateVisualRect } from '../core/geometry';
import { setupDomEnv, teardownDomEnv, attachElement, createElement, domRect } from './helpers/dom_env';

describe('calculateVisualRect — shrink-to-fit (link-wraps-image bug)', () => {
    beforeEach(() => setupDomEnv({ innerWidth: 1920, innerHeight: 1080 }));
    afterEach(() => teardownDomEnv());

    test('uses the image rect when a link wraps a single dominant image', () => {
        // Card-style link: 600×400 hit area at (0, 0), dominant image
        // 580×360 nested inside. Without the shrink-to-fit fix, the ring
        // would render around the entire 600×400 card.
        const link = attachElement(
            createElement({
                tagName: 'a',
                href: '/dest',
                rect: { x: 0, y: 0, width: 600, height: 400 },
            })
        );
        const img = createElement({
            tagName: 'img',
            rect: { x: 10, y: 20, width: 580, height: 360 },
        });
        link.appendChild(img);

        const rect = calculateVisualRect(link);

        assert.equal(rect.left, 10, 'left should be image left, not card left');
        assert.equal(rect.top, 20, 'top should be image top, not card top');
        assert.equal(rect.width, 580);
        assert.equal(rect.height, 360);
    });

    test('shrinks via a wrapper picture/img (descendant lookup, not just children)', () => {
        // Pages commonly wrap the <img> inside another element (<picture>,
        // <span>) inside the <a>. The selector must catch descendants.
        const link = attachElement(
            createElement({
                tagName: 'a',
                rect: { x: 0, y: 0, width: 500, height: 400 },
            })
        );
        const span = createElement({
            tagName: 'span',
            rect: { x: 0, y: 0, width: 500, height: 400 },
        });
        const img = createElement({
            tagName: 'img',
            rect: { x: 30, y: 30, width: 440, height: 340 },
        });
        span.appendChild(img);
        link.appendChild(span);

        const rect = calculateVisualRect(link);

        assert.equal(rect.left, 30);
        assert.equal(rect.top, 30);
        assert.equal(rect.width, 440);
    });

    test('does NOT shrink when there is meaningful sibling text (icon + label)', () => {
        // A link with [icon + label] should outline the whole link, not
        // just the icon. The text-content guard prevents the regression.
        const link = attachElement(
            createElement({
                tagName: 'a',
                rect: { x: 0, y: 0, width: 200, height: 40 },
                text: 'Sign in',
            })
        );
        const icon = createElement({
            tagName: 'img',
            rect: { x: 4, y: 8, width: 24, height: 24 },
        });
        link.insertBefore(icon, link.firstChild);

        const rect = calculateVisualRect(link);

        assert.equal(rect.width, 200, 'should retain wrapper width when text is present');
        assert.equal(rect.height, 40);
    });

    test('does NOT shrink when the image covers less than 50% of the wrapper area', () => {
        // A small thumbnail in a large card shouldn't pull the ring down
        // to just the thumbnail. Dominant-area threshold prevents the
        // mistake.
        const link = attachElement(
            createElement({
                tagName: 'a',
                rect: { x: 0, y: 0, width: 600, height: 400 },
            })
        );
        const thumbnail = createElement({
            tagName: 'img',
            rect: { x: 10, y: 10, width: 60, height: 60 },
        });
        link.appendChild(thumbnail);
        // 60*60 = 3600 vs 600*400 = 240000 → 1.5%, well below 50%.

        const rect = calculateVisualRect(link);

        assert.equal(rect.width, 600, 'thumbnail well below dominance threshold should not shrink the ring');
        assert.equal(rect.height, 400);
    });

    test('does NOT shrink when multiple visible media children exist', () => {
        // A two-image layout (e.g., before/after pair) is ambiguous. The
        // single-child guard prevents an arbitrary shrink decision.
        const wrapper = attachElement(
            createElement({
                tagName: 'a',
                rect: { x: 0, y: 0, width: 400, height: 200 },
            })
        );
        wrapper.appendChild(
            createElement({
                tagName: 'img',
                rect: { x: 0, y: 0, width: 200, height: 200 },
            })
        );
        wrapper.appendChild(
            createElement({
                tagName: 'img',
                rect: { x: 200, y: 0, width: 200, height: 200 },
            })
        );

        const rect = calculateVisualRect(wrapper);

        assert.equal(rect.width, 400, 'two visible media children → ambiguous → outline the wrapper');
    });

    test('skips aria-hidden media when counting visibility', () => {
        // Two media children but one is aria-hidden (a decorative spacer)
        // → effective single visible child → shrink to the visible one.
        const link = attachElement(
            createElement({
                tagName: 'a',
                rect: { x: 0, y: 0, width: 500, height: 400 },
            })
        );
        link.appendChild(
            createElement({
                tagName: 'img',
                rect: { x: 0, y: 0, width: 1, height: 1 },
                attrs: { 'aria-hidden': 'true' },
            })
        );
        link.appendChild(
            createElement({
                tagName: 'img',
                rect: { x: 20, y: 20, width: 460, height: 360 },
            })
        );

        const rect = calculateVisualRect(link);

        assert.equal(rect.left, 20);
        assert.equal(rect.width, 460);
    });

    test('skips zero-area media (broken / not-yet-loaded images)', () => {
        // A broken `<img>` reports 0×0; the function must not crash and
        // must not "shrink" to nothing.
        const link = attachElement(
            createElement({
                tagName: 'a',
                rect: { x: 0, y: 0, width: 300, height: 200 },
            })
        );
        link.appendChild(
            createElement({
                tagName: 'img',
                rect: { x: 0, y: 0, width: 0, height: 0 },
            })
        );

        const rect = calculateVisualRect(link);

        assert.equal(rect.width, 300);
        assert.equal(rect.height, 200);
    });
});

describe('calculateVisualRect — expand-to-fit (logo / image-button)', () => {
    beforeEach(() => setupDomEnv({ innerWidth: 1920, innerHeight: 1080 }));
    afterEach(() => teardownDomEnv());

    test('expands to the child rect when the visible asset is larger than the hit area', () => {
        // A logo: 200×80 visual but with a tiny 24×24 button hit area
        // inside. The user perceives the 200×80; expand the ring to match.
        const link = attachElement(
            createElement({
                tagName: 'a',
                rect: { x: 50, y: 50, width: 24, height: 24 },
            })
        );
        const logoImg = createElement({
            tagName: 'img',
            rect: { x: 0, y: 0, width: 200, height: 80 },
        });
        link.appendChild(logoImg);

        const rect = calculateVisualRect(link);

        assert.equal(rect.left, 0, 'expanded to image left');
        assert.equal(rect.top, 0, 'expanded to image top');
        assert.equal(rect.width, 200);
        assert.equal(rect.height, 80);
    });

    test('returns element rect when no media child and no shrink/expand applies', () => {
        const btn = attachElement(
            createElement({
                tagName: 'button',
                rect: { x: 100, y: 100, width: 80, height: 40 },
            })
        );

        const rect = calculateVisualRect(btn);

        assert.equal(rect.left, 100);
        assert.equal(rect.top, 100);
        assert.equal(rect.width, 80);
        assert.equal(rect.height, 40);
    });

    test(
        'CLAMPS expand-to-fit to the wrapper rect when the wrapper has ' +
            '`overflow: hidden` — regression for Squarespace ' +
            '`a.summary-thumbnail-container` cards where the inner ' +
            '<img> is laid out larger than the wrapper and clipped. ' +
            'Without the clamp the ring extends ~100 px above/below ' +
            'the visible image into empty space.',
        () => {
            // Wrapper is 307×205 at (224, 2498), the Squarespace pattern.
            // The inner <img> is 307×409 at (224, 2396) — extends 102 px
            // above the wrapper and 102 px below. The wrapper has
            // `overflow: hidden` so only the wrapper-intersected portion
            // of the image is actually painted.
            const wrapper = attachElement(
                createElement({
                    tagName: 'a',
                    rect: { x: 224, y: 2498, width: 307, height: 205 },
                    style: { overflow: 'hidden' },
                })
            );
            const img = createElement({
                tagName: 'img',
                rect: { x: 224, y: 2396, width: 307, height: 409 },
            });
            wrapper.appendChild(img);

            const rect = calculateVisualRect(wrapper);

            // Ring should match the wrapper rect — the visible portion
            // of the image — NOT the full image rect.
            assert.equal(rect.left, 224, 'left clamped to wrapper');
            assert.equal(rect.top, 2498, 'top clamped to wrapper (NOT 2396)');
            assert.equal(rect.width, 307, 'width matches wrapper');
            assert.equal(rect.height, 205, 'height clamped to wrapper (NOT 409)');
        }
    );

    test(
        'EXPANDS to a round/pill parent button container — Squarespace ' +
            '`<div.back-to-top-link>` (50×50 circle, border-radius:50%, ' +
            'white bg) wraps an `<a>` whose box is only 50×36 (the ' +
            'text bounds). Without expand the ring sits at the `<a>` ' +
            'box and the bottom 14 px of the circle is outside the ' +
            'ring.',
        () => {
            const parent = attachElement(
                createElement({
                    tagName: 'div',
                    rect: { x: 679, y: 174, width: 50, height: 50 },
                    style: {
                        borderRadius: '50%',
                        backgroundColor: 'rgb(255, 255, 255)',
                    },
                })
            );
            const a = createElement({
                tagName: 'a',
                rect: { x: 679, y: 176, width: 50, height: 36 },
                text: 'Top',
            });
            parent.appendChild(a);

            const rect = calculateVisualRect(a);

            assert.equal(rect.left, 679);
            assert.equal(rect.top, 174, 'expanded up to parent circle top');
            assert.equal(rect.width, 50);
            assert.equal(rect.height, 50, 'expanded down to parent circle bottom (NOT 36)');
        }
    );

    test(
        'DOES NOT button-parent expand when the parent has a square / ' +
            'rectangular border-radius (e.g., border-radius: 4px on a ' +
            'large container — likely not a button)',
        () => {
            const parent = attachElement(
                createElement({
                    tagName: 'div',
                    rect: { x: 0, y: 0, width: 300, height: 100 },
                    style: {
                        borderRadius: '4px',
                        backgroundColor: 'rgb(240, 240, 240)',
                    },
                })
            );
            const a = createElement({
                tagName: 'a',
                rect: { x: 100, y: 30, width: 60, height: 30 },
                text: 'Link',
            });
            parent.appendChild(a);

            const rect = calculateVisualRect(a);

            // Should return the <a>'s box, not the parent — parent`s
            // 4 px border-radius isn`t enough to suggest "button shape".
            assert.equal(rect.width, 60);
            assert.equal(rect.height, 30);
        }
    );

    test(
        'EXPANDS the visual rect when scrollHeight > clientHeight and ' +
            'overflow is visible — regression for Squarespace "Top" ' +
            'button where the descender of "P" pushes 2 px past the ' +
            '`<a>` box because of tight line-height. The ring needs ' +
            'to cover the visible descender, not stop at the box.',
        () => {
            const a = attachElement(
                createElement({
                    tagName: 'a',
                    rect: { x: 679, y: 176, width: 50, height: 36 },
                    style: { overflow: 'visible' },
                    text: 'Top',
                })
            );
            // Happy-dom tracks scrollWidth/Height from the actual box +
            // children. To stage the "content overflows box" case we
            // patch the getters directly.
            Object.defineProperty(a, 'scrollHeight', { value: 38, configurable: true });
            Object.defineProperty(a, 'clientHeight', { value: 36, configurable: true });
            Object.defineProperty(a, 'scrollWidth', { value: 50, configurable: true });
            Object.defineProperty(a, 'clientWidth', { value: 50, configurable: true });

            const rect = calculateVisualRect(a);

            assert.equal(rect.left, 679);
            assert.equal(rect.top, 176);
            assert.equal(rect.width, 50, 'width unchanged');
            assert.equal(rect.height, 38, 'height expanded by 2 px to cover descender');
        }
    );

    test(
        'DOES NOT scroll-overflow expand for INLINE elements — ' +
            '`scrollWidth`/`scrollHeight` are not well-defined on inline ' +
            'boxes (they typically report the nearest block ancestor`s ' +
            'scrollable area). Without this gate, an inline `<a>` like ' +
            'the Squarespace footer "Privacy" link would expand to ' +
            '~2× width × 2× height because the parent `<p>` reports ' +
            'inherited scroll dimensions.',
        () => {
            const a = attachElement(
                createElement({
                    tagName: 'a',
                    rect: { x: 655, y: 385, width: 37, height: 20 },
                    style: { display: 'inline', overflow: 'visible' },
                    text: 'Terms',
                })
            );
            // Simulate the inline-element scrollWidth/Height quirk: they
            // come from the parent block, NOT this <a>`s own bounds.
            Object.defineProperty(a, 'scrollWidth', { value: 74, configurable: true });
            Object.defineProperty(a, 'clientWidth', { value: 37, configurable: true });
            Object.defineProperty(a, 'scrollHeight', { value: 40, configurable: true });
            Object.defineProperty(a, 'clientHeight', { value: 20, configurable: true });

            const rect = calculateVisualRect(a);

            // Inline element — ring stays at the box, doesn`t double up.
            assert.equal(rect.width, 37, 'width unchanged for inline element');
            assert.equal(rect.height, 20, 'height unchanged for inline element');
        }
    );

    test(
        'DOES NOT scroll-overflow expand when overflow is hidden ' +
            '(content is clipped, not visible — ring stays at the box)',
        () => {
            const div = attachElement(
                createElement({
                    tagName: 'div',
                    rect: { x: 100, y: 100, width: 200, height: 50 },
                    style: { overflow: 'hidden' },
                    text: 'Lots of content that scrolls',
                })
            );
            Object.defineProperty(div, 'scrollHeight', { value: 500, configurable: true });
            Object.defineProperty(div, 'clientHeight', { value: 50, configurable: true });
            Object.defineProperty(div, 'scrollWidth', { value: 200, configurable: true });
            Object.defineProperty(div, 'clientWidth', { value: 200, configurable: true });

            const rect = calculateVisualRect(div);

            // Box rect — overflow:hidden clips the scrolled content
            assert.equal(rect.height, 50, 'height stays at box (NOT 500)');
        }
    );

    test(
        'CLAMPS expand-to-fit through a DESCENDANT clipping wrapper ' +
            '(canonical Squarespace pattern: focused `<a>` has ' +
            '`overflow: visible` but contains a `<div.img-wrapper>` ' +
            'with `overflow: hidden` that does the actual clipping)',
        () => {
            // Focused element — overflow: visible
            const a = attachElement(
                createElement({
                    tagName: 'a',
                    rect: { x: 224, y: 2498, width: 307, height: 205 },
                    style: { overflow: 'visible' },
                })
            );
            // Inner clipping wrapper inside the <a>
            const innerWrapper = createElement({
                tagName: 'div',
                rect: { x: 224, y: 2498, width: 307, height: 205 },
                style: { overflow: 'hidden' },
            });
            a.appendChild(innerWrapper);
            // Over-tall image inside the inner wrapper
            const img = createElement({
                tagName: 'img',
                rect: { x: 224, y: 2396, width: 307, height: 409 },
            });
            innerWrapper.appendChild(img);

            const rect = calculateVisualRect(a);

            // Visible image is clipped by the inner wrapper. Ring
            // should match that clipped area, not the full image rect.
            assert.equal(rect.left, 224);
            assert.equal(rect.top, 2498, 'top clamped via descendant wrapper');
            assert.equal(rect.width, 307);
            assert.equal(rect.height, 205);
        }
    );

    test(
        'DOES NOT clamp when wrapper has `overflow: visible` — preserves ' +
            'the original logo-expand behaviour (small hit area, large ' +
            'overflowing logo image)',
        () => {
            const link = attachElement(
                createElement({
                    tagName: 'a',
                    rect: { x: 50, y: 50, width: 24, height: 24 },
                    style: { overflow: 'visible' },
                })
            );
            const logoImg = createElement({
                tagName: 'img',
                rect: { x: 0, y: 0, width: 200, height: 80 },
            });
            link.appendChild(logoImg);

            const rect = calculateVisualRect(link);

            // Logo expand-to-fit still wins — the wrapper allows overflow.
            assert.equal(rect.left, 0);
            assert.equal(rect.top, 0);
            assert.equal(rect.width, 200);
            assert.equal(rect.height, 80);
        }
    );
});

describe('calculateVisualRect — overlay clamp interaction (bug 2 regression)', () => {
    beforeEach(() => setupDomEnv({ innerWidth: 1200, innerHeight: 800 }));
    afterEach(() => teardownDomEnv());

    // This function only computes the rect — the overlay's clamp is in
    // core/overlay.ts. Sanity-test that the rect itself is preserved
    // edge-flush; the clamp-to-edge fix lives downstream.

    test('preserves edge-flush rect for content touching the viewport left edge', () => {
        const hero = attachElement(
            createElement({
                tagName: 'a',
                rect: { x: 0, y: 0, width: 600, height: 400 },
            })
        );
        const img = createElement({
            tagName: 'img',
            rect: { x: 0, y: 0, width: 600, height: 400 },
        });
        hero.appendChild(img);

        const rect = calculateVisualRect(hero);

        assert.equal(rect.left, 0, 'left edge must remain at 0 — no inward inset at this layer');
        assert.equal(rect.right, 600);
    });
});

// ---------------------------------------------------------------------------
// Cross-strategy composition — strategies must compose, not silently override.
// These tests pin the strategy precedence locked in 2026-05-14: button-parent
// expand runs FIRST (before shrink-to-fit), so icon-only round buttons reach
// their parent's circle bounds instead of collapsing to the SVG. Each test
// stages a multi-strategy scenario and asserts the right strategy wins.
// ---------------------------------------------------------------------------

describe('calculateVisualRect — cross-strategy composition', () => {
    beforeEach(() => setupDomEnv({ innerWidth: 1200, innerHeight: 800 }));
    afterEach(() => teardownDomEnv());

    test(
        'icon-only round button: button-parent (strategy 1) wins over ' +
            'shrink-to-fit (strategy 2). Previously shrink-to-fit fired ' +
            'first and silently collapsed the ring to the inner SVG; the ' +
            'reorder guarantees the ring reaches the parent circle bounds.',
        () => {
            // 48×48 social-icon circle button with white bg + 50% radius
            const parent = attachElement(
                createElement({
                    tagName: 'div',
                    rect: { x: 100, y: 200, width: 48, height: 48 },
                    style: {
                        borderRadius: '50%',
                        backgroundColor: 'rgb(255, 255, 255)',
                    },
                })
            );
            const a = createElement({
                tagName: 'a',
                rect: { x: 100, y: 200, width: 48, height: 48 },
            });
            parent.appendChild(a);
            // Inner SVG icon — sized to about the icon, not the button.
            // Without button-parent expanding FIRST, shrink-to-fit would
            // contract the rect to this 20×20 area.
            const svg = createElement({
                tagName: 'svg',
                rect: { x: 114, y: 214, width: 20, height: 20 },
            });
            a.appendChild(svg);

            const rect = calculateVisualRect(a);

            assert.equal(rect.left, 100, 'parent circle left wins (not SVG)');
            assert.equal(rect.top, 200, 'parent circle top wins (not SVG)');
            assert.equal(rect.width, 48, 'full circle width (NOT 20)');
            assert.equal(rect.height, 48, 'full circle height (NOT 20)');
        }
    );

    test(
        'transparent-background round parent does NOT button-parent expand. ' +
            'The button-parent heuristic requires an opaque background or a ' +
            'visible border so a bare wrapper `<div>` with rounded corners ' +
            'around inline text does not pull the ring outward.',
        () => {
            // Round parent BUT no bg and no border — just inherited transparent
            const parent = attachElement(
                createElement({
                    tagName: 'div',
                    rect: { x: 100, y: 100, width: 80, height: 80 },
                    style: {
                        borderRadius: '50%',
                        // No background-color, no border
                    },
                })
            );
            const a = createElement({
                tagName: 'a',
                rect: { x: 110, y: 130, width: 60, height: 20 },
                text: 'Link',
            });
            parent.appendChild(a);

            const rect = calculateVisualRect(a);

            // Box rect — transparent wrappers don't qualify as buttons.
            assert.equal(rect.left, 110, 'stays at <a> left (not parent)');
            assert.equal(rect.top, 130, 'stays at <a> top (not parent)');
            assert.equal(rect.width, 60);
            assert.equal(rect.height, 20);
        }
    );

    test(
        'button-parent expand wins over scroll-overflow expand. With both ' +
            'signals present (round button parent AND text overflowing the ' +
            '`<a>` box by 2 px), the parent-circle rect dominates because ' +
            'button-parent runs first. We never need to compose the two — ' +
            'the parent already covers the descender.',
        () => {
            const parent = attachElement(
                createElement({
                    tagName: 'div',
                    rect: { x: 200, y: 200, width: 60, height: 60 },
                    style: {
                        borderRadius: '50%',
                        backgroundColor: 'rgb(255, 255, 255)',
                    },
                })
            );
            const a = createElement({
                tagName: 'a',
                rect: { x: 200, y: 212, width: 60, height: 36 },
                style: { overflow: 'visible' },
                text: 'Top',
            });
            parent.appendChild(a);
            // Stage scroll-overflow: descender pushes content past <a> box
            Object.defineProperty(a, 'scrollHeight', { value: 38, configurable: true });
            Object.defineProperty(a, 'clientHeight', { value: 36, configurable: true });
            Object.defineProperty(a, 'scrollWidth', { value: 60, configurable: true });
            Object.defineProperty(a, 'clientWidth', { value: 60, configurable: true });

            const rect = calculateVisualRect(a);

            // Button-parent wins — full 60×60 circle bounds. The descender
            // is inside that envelope already, so scroll-overflow expand
            // never needs to fire.
            assert.equal(rect.left, 200);
            assert.equal(rect.top, 200, 'expanded up to parent (button-parent wins)');
            assert.equal(rect.width, 60);
            assert.equal(rect.height, 60, 'full parent height (NOT 38 from scroll-overflow)');
        }
    );

    test(
        'descendant clip wrapper interacts correctly with shrink-to-fit. ' +
            'Focused `<a>` (350×250) contains an `img-wrapper` div ' +
            '(overflow:hidden, 300×200) which contains an over-tall image ' +
            '(300×400). Shrink-to-fit picks the image as the dominant ' +
            'child; the clip-to-visible-area step then clamps that 300×400 ' +
            'rect to the inner wrapper`s 300×200 bounds.',
        () => {
            const a = attachElement(
                createElement({
                    tagName: 'a',
                    rect: { x: 100, y: 100, width: 350, height: 250 },
                    style: { overflow: 'visible' },
                })
            );
            const innerWrapper = createElement({
                tagName: 'div',
                rect: { x: 125, y: 125, width: 300, height: 200 },
                style: { overflow: 'hidden' },
            });
            a.appendChild(innerWrapper);
            const img = createElement({
                tagName: 'img',
                rect: { x: 125, y: 25, width: 300, height: 400 },
            });
            innerWrapper.appendChild(img);

            const rect = calculateVisualRect(a);

            // Without the descendant clip clamp, this would be 300×400.
            // With it, the visible-image area is 300×200 (clamped by
            // the inner wrapper).
            assert.equal(rect.left, 125);
            assert.equal(rect.top, 125, 'clamped to inner wrapper top');
            assert.equal(rect.width, 300);
            assert.equal(rect.height, 200, 'clamped to inner wrapper height (NOT 400)');
        }
    );
});

// ---------------------------------------------------------------------------
// DoS hardening — the shrink-to-fit media scan must stay bounded and must
// NEVER materialize a full descendant NodeList from page-controlled DOM.
// Regression guard for the fix that replaced `element.querySelectorAll(
// mediaSelector)` (which built the whole match list up front, before the
// processing cap applied) with the shared budget-bounded `walkElementsBounded`
// walker. A focused element wrapping a hostile media subtree must not be able
// to force an unbounded allocation on every focus change / ring redraw.
// ---------------------------------------------------------------------------

/** Shadow `el.querySelectorAll` with a counting passthrough; returns a call-count getter. */
function spyQuerySelectorAll(el: HTMLElement): () => number {
    let calls = 0;
    const real = el.querySelectorAll.bind(el);
    (el as unknown as { querySelectorAll: (...a: unknown[]) => unknown }).querySelectorAll = (
        ...a: unknown[]
    ) => {
        calls += 1;
        return (real as (...x: unknown[]) => unknown)(...a);
    };
    return () => calls;
}

describe('calculateVisualRect — media scan is bounded (no NodeList materialization)', () => {
    beforeEach(() => setupDomEnv({ innerWidth: 1920, innerHeight: 1080 }));
    afterEach(() => teardownDomEnv());

    test('finds a deeply-nested dominant image via the lazy walk, without calling querySelectorAll', () => {
        const link = attachElement(
            createElement({ tagName: 'a', rect: { x: 0, y: 0, width: 600, height: 400 } })
        );
        // Bury the dominant <img> under a deep chain of benign (non-media)
        // wrappers so this exercises descendant traversal — the case the old
        // `element.querySelectorAll` handled natively — not just direct children.
        let parent: HTMLElement = link;
        for (let i = 0; i < 40; i++) {
            const div = createElement({ tagName: 'div', rect: { x: 0, y: 0, width: 600, height: 400 } });
            parent.appendChild(div);
            parent = div;
        }
        parent.appendChild(
            createElement({ tagName: 'img', rect: { x: 10, y: 20, width: 580, height: 360 } })
        );

        const qsaCalls = spyQuerySelectorAll(link);

        const rect = calculateVisualRect(link);

        assert.equal(
            qsaCalls(),
            0,
            'media scan must not call element.querySelectorAll (would materialize the full NodeList)'
        );
        assert.equal(rect.left, 10, 'the lazy walk still finds the descendant image and shrinks to it');
        assert.equal(rect.width, 580);
    });

    test('caps per-media work on a pathological media subtree (does not touch every descendant)', () => {
        // MEDIA_COUNT is deliberately well above the internal
        // MAX_MEDIA_CANDIDATES cap (1000) in core/geometry.ts, so a bounded
        // scan cannot come close to reaching them all.
        const MEDIA_COUNT = 2500;
        const link = attachElement(
            createElement({ tagName: 'a', rect: { x: 0, y: 0, width: 600, height: 400 } })
        );
        const zero = domRect(0, 0, 0, 0);
        let rectCalls = 0;
        for (let i = 0; i < MEDIA_COUNT; i++) {
            // Broken / not-yet-loaded images report 0×0 — each is *examined*
            // but never counts as "visible", so only the examined-count cap
            // (not the stop-at-two-visible shortcut) can halt the scan.
            const img = createElement({ tagName: 'img' });
            (img as unknown as { getBoundingClientRect: () => DOMRect }).getBoundingClientRect = () => {
                rectCalls += 1;
                return zero;
            };
            link.appendChild(img);
        }

        const qsaCalls = spyQuerySelectorAll(link);

        const rect = calculateVisualRect(link);

        // The definitive regression guard: no full NodeList is ever built.
        assert.equal(qsaCalls(), 0, 'must not materialize the media subtree via querySelectorAll');
        // Boundedness: the scan stops far short of touching all the media.
        assert.ok(
            rectCalls < MEDIA_COUNT,
            `examined media must be bounded below the full ${MEDIA_COUNT} (was ${rectCalls})`
        );
        // The shrink scan is capped at MAX_MEDIA_CANDIDATES (1000); the small
        // margin absorbs the one extra O(1) `querySelector` inspection the
        // expand-to-fit strategy does on the first media child.
        assert.ok(
            rectCalls <= 1100,
            `examined media must stay near the MAX_MEDIA_CANDIDATES cap of 1000, not the full subtree (was ${rectCalls})`
        );
        // Correctness preserved under the pathological input: no visible media
        // → no shrink → the wrapper's own rect, and no crash.
        assert.equal(rect.width, 600, 'no spurious shrink when there are no visible media');
        assert.equal(rect.height, 400);
    });
});
