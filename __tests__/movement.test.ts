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
const DOWN: Direction = { axis: 'y', sign: 1, name: 'down' };
const LEFT: Direction = { axis: 'x', sign: -1, name: 'left' };

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

        // Force the legacy exit-on-boundary path; the new 3.1.0 default is
        // `'scroll'`, which never suppresses the overlay.
        const state = createTestState([button], undefined, { boundaryScrollBehavior: 'exit' });
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
        // Force legacy exit-on-boundary path (default is now `'scroll'`).
        const state = createTestState([button], undefined, { boundaryScrollBehavior: 'exit' });

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

    test(
        'notifyOnBoundary:false skips focusExit relay + spatialNavigationExit + ' +
            'overlay suppression (analytics-cluster fix — phase A regression)',
        () => {
            // The first of the two-attempt navigate-and-retry sequence in
            // handlers.ts MUST be silent on boundary: no `sendFocusExit`
            // to the native host, no `spatialNavigationExit` CustomEvent,
            // no overlay suppression. Otherwise each user keypress at a
            // boundary fires the boundary pipeline twice (first attempt +
            // retry both notify), producing the "Focus Exit clustered in
            // 2 / 4 / 8 events on Mixpanel" bug.
            type MsgShape = { type: string; direction: string; inTrap: boolean };
            type DispatchedShape = {
                type: string;
                detail: { direction: string; inTrap: boolean };
            };

            const button = attachElement(createElement({ tagName: 'button', id: 'only' }));
            setActiveElement(button);
            const state = createTestState([button]);

            const overlay = attachElement(createElement({ tagName: 'div' }));
            overlay.classList.add('visible');
            state.overlay = overlay;

            const dispatched: DispatchedShape[] = [];
            const origDispatch = document.dispatchEvent.bind(document);
            document.dispatchEvent = (e: Event) => {
                dispatched.push({
                    type: e.type,
                    detail: (e as CustomEvent).detail,
                });
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

            const moved = moveInDirection(UP, null, state, {
                notifyOnBoundary: false,
            });

            assert.equal(moved, false);
            // No focusExit bridge message
            assert.equal(
                sent.find((m) => m.type === 'focusExit'),
                undefined,
                'must not relay focusExit when notifyOnBoundary is false'
            );
            // No spatialNavigationExit CustomEvent
            assert.equal(
                dispatched.find((d) => d.type === 'spatialNavigationExit'),
                undefined,
                'must not dispatch spatialNavigationExit when notifyOnBoundary is false'
            );
            // Overlay not suppressed
            assert.equal(
                state.overlaySuppressed,
                false,
                'must not suppress overlay when notifyOnBoundary is false'
            );
            assert.equal(overlay.classList.contains('visible'), true, 'overlay should remain visible');
        }
    );

    test(
        'notifyOnBoundary:true is the default (back-compat) — verifies the ' +
            'option opts OUT of notification, not IN',
        () => {
            type MsgShape = { type: string; direction: string };
            const button = attachElement(createElement({ tagName: 'button', id: 'only' }));
            setActiveElement(button);
            const state = createTestState([button]);

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

            // Call without options — back-compat path used by every
            // direct caller in production today.
            moveInDirection(UP, null, state);

            assert.equal(
                sent.find((m) => m.type === 'focusExit')?.direction,
                'up',
                'default behaviour must still notify (back-compat)'
            );
        }
    );

    test(
        'scrollIntoView temporarily sets inline scroll-margin: 16px then ' +
            'restores it (single-frame scroll buffer — phase A regression)',
        async () => {
            // The previous "follow-up scrollBy in nested rAF" produced a
            // visible double-stage settle. Current implementation sets
            // inline `scroll-margin` BEFORE scrollIntoView so the buffer
            // is included in the SINGLE atomic scroll, then restores the
            // prior inline style on the next microtask. Pin both:
            //   (1) scroll-margin IS set to 16px during the scroll
            //   (2) scroll-margin returns to its prior value within a
            //       microtask of the call
            const current = attachElement(
                createElement({
                    tagName: 'button',
                    id: 'current',
                    rect: { x: 0, y: 0, width: 100, height: 30 },
                })
            );
            const target = attachElement(
                createElement({
                    tagName: 'button',
                    id: 'target',
                    rect: { x: 0, y: 100, width: 100, height: 30 },
                })
            );
            setActiveElement(current);

            const state = createTestState([current, target]);

            // Mock scrollIntoView to capture the inline scroll-margin at
            // call time. happy-dom's default scrollIntoView is a no-op
            // (no scrolling math), so we instrument here.
            let scrollMarginAtCallTime: string | undefined;
            target.scrollIntoView = function (
                this: HTMLElement,
                _opts?: ScrollIntoViewOptions | boolean
            ): void {
                scrollMarginAtCallTime = this.style.scrollMargin;
            };

            // Prime: target gets an existing inline scroll-margin we'll
            // need to restore.
            target.style.scrollMargin = '4px';

            const DOWN: Direction = { axis: 'y', sign: 1, name: 'down' };
            const moved = moveInDirection(DOWN, null, state);
            assert.equal(moved, true);

            // The scrollIntoView call is wrapped in a requestAnimationFrame
            // — wait one rAF tick for the production code to invoke it.
            await new Promise((resolve) => {
                requestAnimationFrame(() => resolve(undefined));
            });

            assert.equal(
                scrollMarginAtCallTime,
                '16px',
                'scroll-margin must be set to 16px BEFORE scrollIntoView is called'
            );

            // Drain microtasks so the queueMicrotask restore runs.
            await Promise.resolve();
            await Promise.resolve();

            assert.equal(
                target.style.scrollMargin,
                '4px',
                'scroll-margin must be restored to its prior value after the scroll'
            );
        }
    );

    test(
        'boundaryScrollBehavior: "scroll" suppresses focusExit + dispatches ' +
            'no spatialNavigationExit; instead invokes window.scrollBy ' +
            '(Phase C M-5)',
        () => {
            type MsgShape = { type: string };
            const button = attachElement(createElement({ tagName: 'button', id: 'only' }));
            setActiveElement(button);
            const state = createTestState([button], undefined, {
                boundaryScrollBehavior: 'scroll',
            });

            // Stage a tall document with scroll room in both directions
            // so the scroll branch is reachable (the v3.1.1 escape-route
            // fallback diverts to 'exit' when there's no scroll room).
            Object.defineProperty(document.documentElement, 'scrollHeight', {
                value: 5000,
                configurable: true,
            });
            Object.defineProperty(window, 'scrollY', {
                value: 200,
                configurable: true,
            });

            // Spy on dispatched events — none should fire.
            const dispatchedTypes: string[] = [];
            const origDispatch = document.dispatchEvent.bind(document);
            document.dispatchEvent = (e: Event) => {
                dispatchedTypes.push(e.type);
                return origDispatch(e);
            };

            // Native bridge spy — no `focusExit` should reach it.
            const sent: MsgShape[] = [];
            (globalThis as { browser?: unknown }).browser = {
                runtime: {
                    sendMessage: (msg: unknown) => {
                        sent.push(msg as MsgShape);
                    },
                    lastError: null,
                },
            };

            // Spy on window.scrollBy — must be called for `down`.
            const scrollCalls: Array<{ top?: number; behavior?: string }> = [];
            const origScrollBy = window.scrollBy;
            // The boundary-scroll branch calls `scrollBy({top, behavior})` —
            // patch with a no-op spy that captures the arg.
            (window as { scrollBy: typeof origScrollBy }).scrollBy = ((opts: ScrollToOptions | number) => {
                if (typeof opts === 'object') {
                    scrollCalls.push({
                        top: opts.top,
                        behavior: opts.behavior as string | undefined,
                    });
                }
            }) as typeof origScrollBy;

            try {
                const moved = moveInDirection(DOWN, null, state);

                assert.equal(moved, false, 'still returns false on boundary');
                assert.equal(
                    sent.some((m) => m.type === 'focusExit'),
                    false,
                    'no focusExit message in scroll mode'
                );
                assert.equal(
                    dispatchedTypes.includes('spatialNavigationExit'),
                    false,
                    'no spatialNavigationExit dispatch in scroll mode'
                );
                assert.equal(
                    state.overlaySuppressed,
                    false,
                    'overlay must NOT be suppressed in scroll mode — focus stays in-document'
                );
                assert.equal(scrollCalls.length, 1, 'window.scrollBy must be called once');
                assert.ok((scrollCalls[0].top ?? 0) > 0, 'down boundary scrolls by positive delta');
            } finally {
                document.dispatchEvent = origDispatch;
                (window as { scrollBy: typeof origScrollBy }).scrollBy = origScrollBy;
            }
        }
    );

    test(
        'boundaryScrollBehavior: "none" is silent — no scroll, no exit, no ' + 'dispatch (Phase C M-5)',
        () => {
            type MsgShape = { type: string };
            const button = attachElement(createElement({ tagName: 'button', id: 'only' }));
            setActiveElement(button);
            const state = createTestState([button], undefined, {
                boundaryScrollBehavior: 'none',
            });

            const dispatchedTypes: string[] = [];
            const origDispatch = document.dispatchEvent.bind(document);
            document.dispatchEvent = (e: Event) => {
                dispatchedTypes.push(e.type);
                return origDispatch(e);
            };

            const sent: MsgShape[] = [];
            (globalThis as { browser?: unknown }).browser = {
                runtime: {
                    sendMessage: (msg: unknown) => {
                        sent.push(msg as MsgShape);
                    },
                    lastError: null,
                },
            };

            let scrollCalled = false;
            const origScrollBy = window.scrollBy;
            (window as { scrollBy: typeof origScrollBy }).scrollBy = (() => {
                scrollCalled = true;
            }) as typeof origScrollBy;

            try {
                const moved = moveInDirection(DOWN, null, state);

                assert.equal(moved, false);
                assert.equal(scrollCalled, false, 'no scroll in none mode');
                assert.equal(
                    sent.some((m) => m.type === 'focusExit'),
                    false,
                    'no focusExit message in none mode'
                );
                assert.equal(
                    dispatchedTypes.includes('spatialNavigationExit'),
                    false,
                    'no spatialNavigationExit dispatch in none mode'
                );
            } finally {
                document.dispatchEvent = origDispatch;
                (window as { scrollBy: typeof origScrollBy }).scrollBy = origScrollBy;
            }
        }
    );

    test(
        'boundaryScrollBehavior: "scroll" falls back to EXIT-relay-only when ' +
            'page is already at scrollY=0 and direction is up — ' +
            'focusExit must still relay (escape route), but the overlay must ' +
            'NOT be suppressed (v3.1.2 fixes the "ring slides off and returns ' +
            'to settle" 350ms vanish bug)',
        () => {
            type MsgShape = { type: string };
            const button = attachElement(createElement({ tagName: 'button', id: 'only' }));
            setActiveElement(button);
            const state = createTestState([button], undefined, {
                boundaryScrollBehavior: 'scroll',
            });

            // Stage the page at the very top — no upward scroll room.
            Object.defineProperty(window, 'scrollY', {
                value: 0,
                configurable: true,
            });
            Object.defineProperty(document.documentElement, 'scrollHeight', {
                value: 2000,
                configurable: true,
            });

            // Fake overlay so we can observe whether it's hidden.
            const overlay = attachElement(createElement({ tagName: 'div' }));
            overlay.classList.add('visible');
            state.overlay = overlay;

            const dispatchedTypes: string[] = [];
            const origDispatch = document.dispatchEvent.bind(document);
            document.dispatchEvent = (e: Event) => {
                dispatchedTypes.push(e.type);
                return origDispatch(e);
            };

            const sent: MsgShape[] = [];
            (globalThis as { browser?: unknown }).browser = {
                runtime: {
                    sendMessage: (msg: unknown) => {
                        sent.push(msg as MsgShape);
                    },
                    lastError: null,
                },
            };

            let scrollCalled = false;
            const origScrollBy = window.scrollBy;
            (window as { scrollBy: typeof origScrollBy }).scrollBy = (() => {
                scrollCalled = true;
            }) as typeof origScrollBy;

            try {
                moveInDirection(UP, null, state);

                assert.equal(scrollCalled, false, 'no scroll room — must NOT call window.scrollBy');
                assert.ok(
                    sent.some((m) => m.type === 'focusExit'),
                    'focusExit MUST still relay so the host can pull focus ' +
                        'back to the address bar (the escape-route fix)'
                );
                assert.equal(
                    state.overlaySuppressed,
                    false,
                    'scroll-fall-through must NOT set overlaySuppressed — ' +
                        'doing so produces a visible 350ms "ring slides off ' +
                        'and returns to settle" artifact every press at the ' +
                        'page boundary'
                );
                assert.equal(
                    overlay.classList.contains('visible'),
                    true,
                    'overlay must remain visible across the fall-through; ' +
                        'host handler (if any) decides whether focus moves ' +
                        '(AAOS pulls to address bar on `up`, no-op on `down`)'
                );
                assert.equal(
                    dispatchedTypes.includes('spatialNavigationExit'),
                    false,
                    'spatialNavigationExit must NOT dispatch on scroll-fall-' +
                        'through — otherwise main.ts re-fires suppressOverlay'
                );
            } finally {
                document.dispatchEvent = origDispatch;
                (window as { scrollBy: typeof origScrollBy }).scrollBy = origScrollBy;
            }
        }
    );

    test(
        'boundaryScrollBehavior: "scroll" falls back to EXIT when page is ' +
            'already at scrollY=maxScroll and direction is down',
        () => {
            type MsgShape = { type: string };
            const button = attachElement(createElement({ tagName: 'button', id: 'only' }));
            setActiveElement(button);
            const state = createTestState([button], undefined, {
                boundaryScrollBehavior: 'scroll',
            });

            // Stage the page at its scroll-bottom: scrollY equals
            // scrollHeight - innerHeight. happy-dom default
            // window.innerHeight is 1080.
            Object.defineProperty(document.documentElement, 'scrollHeight', {
                value: 1500,
                configurable: true,
            });
            Object.defineProperty(window, 'scrollY', {
                value: 1500 - 1080,
                configurable: true,
            });

            const sent: MsgShape[] = [];
            (globalThis as { browser?: unknown }).browser = {
                runtime: {
                    sendMessage: (msg: unknown) => {
                        sent.push(msg as MsgShape);
                    },
                    lastError: null,
                },
            };

            let scrollCalled = false;
            const origScrollBy = window.scrollBy;
            (window as { scrollBy: typeof origScrollBy }).scrollBy = (() => {
                scrollCalled = true;
            }) as typeof origScrollBy;

            try {
                moveInDirection(DOWN, null, state);
                assert.equal(scrollCalled, false);
                assert.ok(
                    sent.some((m) => m.type === 'focusExit'),
                    'must fall through to exit when page cannot scroll further'
                );
            } finally {
                (window as { scrollBy: typeof origScrollBy }).scrollBy = origScrollBy;
            }
        }
    );

    test(
        'boundaryScrollBehavior: "scroll" with horizontal direction falls ' +
            'back to exit (no horizontal scroll auto-recovery)',
        () => {
            const button = attachElement(createElement({ tagName: 'button', id: 'only' }));
            setActiveElement(button);
            const state = createTestState([button], undefined, {
                boundaryScrollBehavior: 'scroll',
            });

            // Spy on dispatched events — `spatialNavigationExit` SHOULD fire
            // because horizontal directions don't auto-scroll.
            const dispatchedTypes: string[] = [];
            const origDispatch = document.dispatchEvent.bind(document);
            document.dispatchEvent = (e: Event) => {
                dispatchedTypes.push(e.type);
                return origDispatch(e);
            };

            (globalThis as { browser?: unknown }).browser = {
                runtime: {
                    sendMessage: () => {},
                    lastError: null,
                },
            };

            let scrollCalled = false;
            const origScrollBy = window.scrollBy;
            (window as { scrollBy: typeof origScrollBy }).scrollBy = (() => {
                scrollCalled = true;
            }) as typeof origScrollBy;

            try {
                // Use LEFT direction; we only auto-scroll on up/down.
                moveInDirection(LEFT, null, state);
                assert.equal(scrollCalled, false, 'horizontal boundary must not trigger window.scrollBy');
                // Should fall through to the default exit path even though
                // boundaryScrollBehavior is "scroll".
                assert.ok(
                    dispatchedTypes.includes('spatialNavigationExit'),
                    'horizontal boundary still dispatches spatialNavigationExit'
                );
            } finally {
                document.dispatchEvent = origDispatch;
                (window as { scrollBy: typeof origScrollBy }).scrollBy = origScrollBy;
            }
        }
    );
});

// ---------------------------------------------------------------------------
// clearOverlaySuppression: atomic flag + timer reset
// ---------------------------------------------------------------------------
describe('moveInDirection: clearOverlaySuppression', () => {
    beforeEach(() => setupDomEnv());
    afterEach(() => {
        (globalThis as { browser?: unknown }).browser = undefined;
        teardownDomEnv();
    });

    test(
        'successful navigation cancels a pending suppressRecoveryTimer ' +
            '(prevents the orphan-timer race the inline clear missed)',
        () => {
            // Two stacked focusables so DOWN can succeed.
            const top = attachElement(
                createElement({
                    tagName: 'button',
                    id: 'top',
                    rect: { x: 10, y: 10, width: 40, height: 40 },
                })
            );
            const bottom = attachElement(
                createElement({
                    tagName: 'button',
                    id: 'bottom',
                    rect: { x: 10, y: 60, width: 40, height: 40 },
                })
            );
            setActiveElement(top);

            const state = createTestState([top, bottom]);
            // Simulate a prior `suppressOverlay('spatialNavigationExit')`
            // that armed a recovery timer.
            state.overlaySuppressed = true;
            let timerFired = false;
            state.suppressRecoveryTimer = setTimeout(() => {
                timerFired = true;
            }, 5) as unknown as ReturnType<typeof setTimeout>;

            const moved = moveInDirection(DOWN, null, state);

            assert.equal(moved, true, 'DOWN should succeed');
            assert.equal(state.overlaySuppressed, false, 'flag must clear on successful nav');
            assert.equal(
                state.suppressRecoveryTimer,
                null,
                'pending recovery timer must be cancelled (helper invariant)'
            );

            // Wait past the timer expiry; verify it really was cancelled.
            return new Promise<void>((resolve) =>
                setTimeout(() => {
                    assert.equal(timerFired, false, 'cancelled timer must not fire 5ms later');
                    resolve();
                }, 25)
            );
        }
    );
});

// ---------------------------------------------------------------------------
// Focus-trap detection — table-driven across all 8 selectors
// ---------------------------------------------------------------------------

describe('focus-trap detection (config.focusTrapDetection=true)', () => {
    beforeEach(() => setupDomEnv());
    afterEach(() => teardownDomEnv());

    const trapSelectors: { selector: string; setup: () => HTMLElement }[] = [
        {
            selector: 'role=dialog',
            setup: () => {
                const wrap = attachElement(createElement({ tagName: 'div', attrs: { role: 'dialog' } }));
                return wrap;
            },
        },
        {
            selector: 'aria-modal=true',
            setup: () => attachElement(createElement({ tagName: 'div', attrs: { 'aria-modal': 'true' } })),
        },
        {
            selector: '.modal',
            setup: () => attachElement(createElement({ tagName: 'div', className: 'modal' })),
        },
        {
            selector: '.overlay',
            setup: () => attachElement(createElement({ tagName: 'div', className: 'overlay' })),
        },
        {
            selector: '[data-focus-trap]',
            setup: () =>
                attachElement(createElement({ tagName: 'div', attrs: { 'data-focus-trap': 'true' } })),
        },
        {
            selector: '.MuiDialog-root',
            setup: () => attachElement(createElement({ tagName: 'div', className: 'MuiDialog-root' })),
        },
        {
            selector: '.ReactModal__Content',
            setup: () => attachElement(createElement({ tagName: 'div', className: 'ReactModal__Content' })),
        },
        {
            selector: '.chakra-modal__content',
            setup: () => attachElement(createElement({ tagName: 'div', className: 'chakra-modal__content' })),
        },
    ];

    for (const { selector, setup } of trapSelectors) {
        test(`trap selector ${selector} sets state.currentTrap on boundary`, () => {
            const wrap = setup();
            const btn = createElement({
                tagName: 'button',
                tabindex: '0',
                rect: { x: 10, y: 10, width: 50, height: 30 },
            });
            (wrap as unknown as { appendChild: (n: unknown) => void }).appendChild(btn);
            setActiveElement(btn);
            const state = createTestState([btn], {}, { focusTrapDetection: true });
            // Move LEFT from the only button → boundary → trap should be detected.
            moveInDirection(LEFT, null, state);
            // currentTrap should reference some element (the wrap or related).
            // Just assert it is non-null after a boundary hit.
            assert.notEqual(state.currentTrap, null, `${selector} → state.currentTrap is set`);
        });
    }
});

// ---------------------------------------------------------------------------
// applyFocus — tabindex injection retry
// ---------------------------------------------------------------------------

describe('applyFocus tabindex retry', () => {
    beforeEach(() => setupDomEnv());
    afterEach(() => teardownDomEnv());

    test('elements without tabindex get tabindex="-1" stamp when first focus() does not take', () => {
        // div without tabindex — patch focus() so the first call doesn't change activeElement.
        const target = attachElement(
            createElement({
                tagName: 'div',
                rect: { x: 10, y: 60, width: 80, height: 30 },
                attrs: { role: 'button' },
            })
        );
        // Override focus to NOT change activeElement on the first call.
        let focusCalls = 0;
        const origFocus = target.focus.bind(target);
        (target as { focus: (opts?: FocusOptions) => void }).focus = (opts?: FocusOptions) => {
            focusCalls++;
            if (focusCalls === 1) return; // refuse first attempt
            origFocus(opts);
        };
        const source = attachElement(
            createElement({
                tagName: 'button',
                rect: { x: 10, y: 10, width: 80, height: 30 },
            })
        );
        setActiveElement(source);
        const state = createTestState([source, target]);
        moveInDirection(DOWN, null, state);
        // After move, target should have a tabindex attribute stamped by the retry path.
        assert.notEqual(target.getAttribute('tabindex'), null);
        assert.equal(target.getAttribute('tabindex'), '-1');
    });
});

// ---------------------------------------------------------------------------
// navbeforefocus event — preventDefault cancels movement
// ---------------------------------------------------------------------------

describe('navbeforefocus event', () => {
    beforeEach(() => setupDomEnv());
    afterEach(() => teardownDomEnv());

    test('listener calling preventDefault on the destination aborts the move', () => {
        const source = attachElement(
            createElement({
                tagName: 'button',
                rect: { x: 10, y: 10, width: 80, height: 30 },
            })
        );
        const target = attachElement(
            createElement({
                tagName: 'button',
                rect: { x: 10, y: 60, width: 80, height: 30 },
            })
        );
        setActiveElement(source);
        // dispatchNavEvent fires on the destination element (target).
        target.addEventListener('navbeforefocus', (e) => {
            (e as Event).preventDefault();
        });
        const state = createTestState([source, target]);
        const moved = moveInDirection(DOWN, null, state);
        assert.equal(moved, false, 'cancelled by navbeforefocus');
        assert.equal(window.document.activeElement, source);
    });
});
