/**
 * Tests for utils/debug.ts — window.spatialNavDebug surface area.
 *
 * Covers initDebugApi installation of the four debug methods, the
 * title-channel postbacks (which the host's WebView listens for), and the
 * title-throw-swallow path. The debug API is installed exactly once per
 * state — tests build a fresh state per test.
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { initDebugApi } from '../utils/debug';
import {
    setupDomEnv,
    teardownDomEnv,
    createElement,
    attachElement,
    createTestState,
    setActiveElement,
} from './helpers/dom_env';

describe('initDebugApi installation', () => {
    beforeEach(() => setupDomEnv());
    afterEach(() => teardownDomEnv());

    test('installs all four methods on window.spatialNavDebug', () => {
        const state = createTestState();
        initDebugApi(state);
        const dbg = (window as unknown as { spatialNavDebug: Record<string, unknown> }).spatialNavDebug;
        assert.equal(typeof dbg.move, 'function');
        assert.equal(typeof dbg.setPreviewEnabled, 'function');
        assert.equal(typeof dbg.previewTargets, 'function');
        assert.equal(typeof dbg.snapshot, 'function');
    });

    test('exposes window.spatialNavInstrumentation and window.spatialNavPerf', () => {
        const state = createTestState();
        initDebugApi(state);
        const w = window as unknown as {
            spatialNavInstrumentation: object;
            spatialNavPerf: () => object;
        };
        assert.equal(w.spatialNavInstrumentation, state.instrumentation);
        assert.equal(typeof w.spatialNavPerf, 'function');
        // spatialNavPerf() returns state.perf
        assert.equal(w.spatialNavPerf(), state.perf);
    });

    test('spatialNavPerf returns empty object when state.perf is falsy', () => {
        const state = createTestState();
        state.perf = undefined as unknown as typeof state.perf;
        initDebugApi(state);
        const w = window as unknown as { spatialNavPerf: () => object };
        assert.deepEqual(w.spatialNavPerf(), {});
    });
});

describe('move()', () => {
    beforeEach(() => setupDomEnv());
    afterEach(() => teardownDomEnv());

    test('returns false for unknown direction', () => {
        const state = createTestState();
        initDebugApi(state);
        const dbg = (window as unknown as { spatialNavDebug: { move: (d: string) => boolean } })
            .spatialNavDebug;
        assert.equal(dbg.move('diagonal-up-left'), false);
    });

    test('writes focusDebugMove title channel even when no movement happens', () => {
        const state = createTestState();
        initDebugApi(state);
        const dbg = (window as unknown as { spatialNavDebug: { move: (d: string) => boolean } })
            .spatialNavDebug;
        dbg.move('up');
        assert.match(window.document.title, /^focusDebugMove:/);
    });

    test('title write is swallowed when document.title setter throws', () => {
        const state = createTestState();
        initDebugApi(state);
        // Patch document.title to throw on assignment via a getter/setter.
        Object.defineProperty(window.document, 'title', {
            configurable: true,
            get() {
                return '';
            },
            set() {
                throw new Error('title-setter-blocked');
            },
        });
        const dbg = (window as unknown as { spatialNavDebug: { move: (d: string) => boolean } })
            .spatialNavDebug;
        // Must not throw out of move().
        assert.doesNotThrow(() => dbg.move('up'));
    });
});

describe('setPreviewEnabled()', () => {
    beforeEach(() => setupDomEnv());
    afterEach(() => teardownDomEnv());

    test('false hides preview elements and clears nextTargets', () => {
        const state = createTestState();
        state.previewEnabled = true;
        state.nextTargets = {
            up: { data: { element: null } as unknown as never } as never,
            down: null,
            left: null,
            right: null,
        };
        initDebugApi(state);
        const dbg = (
            window as unknown as {
                spatialNavDebug: { setPreviewEnabled: (b: boolean) => boolean };
            }
        ).spatialNavDebug;
        const result = dbg.setPreviewEnabled(false);
        assert.equal(result, false);
        assert.equal(state.previewEnabled, false);
        assert.equal(state.nextTargets.up, null);
        assert.equal(state.nextTargets.down, null);
    });

    test('true sets previewEnabled and runs updatePreviewVisuals when active exists', () => {
        const btn = attachElement(
            createElement({ tagName: 'button', tabindex: '0', rect: { width: 80, height: 30 } })
        );
        setActiveElement(btn);
        const state = createTestState([btn]);
        initDebugApi(state);
        const dbg = (
            window as unknown as {
                spatialNavDebug: { setPreviewEnabled: (b: boolean) => boolean };
            }
        ).spatialNavDebug;
        const result = dbg.setPreviewEnabled(true);
        assert.equal(result, true);
        assert.equal(state.previewEnabled, true);
        // Title channel emitted for the toggle.
        assert.match(window.document.title, /^focusPreviewToggle:/);
    });
});

describe('previewTargets()', () => {
    beforeEach(() => setupDomEnv());
    afterEach(() => teardownDomEnv());

    test('returns blocked sentinel for empty directions and writes title channel', () => {
        const state = createTestState();
        initDebugApi(state);
        const dbg = (
            window as unknown as {
                spatialNavDebug: { previewTargets: (label?: string) => Record<string, string> };
            }
        ).spatialNavDebug;
        const out = dbg.previewTargets('test-label');
        assert.equal(out.up, '[blocked]');
        assert.equal(out.down, '[blocked]');
        assert.equal(out.left, '[blocked]');
        assert.equal(out.right, '[blocked]');
        assert.match(window.document.title, /^focusPreview:/);
    });

    test('returns describeElement output for populated directions', () => {
        const btn = createElement({ tagName: 'button', id: 'target', text: 'go' });
        const state = createTestState();
        state.nextTargets = {
            up: { data: { element: btn } } as unknown as never,
            down: null,
            left: null,
            right: null,
        };
        initDebugApi(state);
        const dbg = (
            window as unknown as {
                spatialNavDebug: { previewTargets: () => Record<string, string> };
            }
        ).spatialNavDebug;
        const out = dbg.previewTargets();
        assert.match(out.up, /button#target/);
        assert.equal(out.down, '[blocked]');
    });
});

describe('snapshot()', () => {
    beforeEach(() => setupDomEnv());
    afterEach(() => teardownDomEnv());

    test('returns instrumentation snapshot and writes title channel', () => {
        const state = createTestState();
        state.instrumentation.lastOverlay = 'div#a';
        state.instrumentation.lastActive = 'div#a';
        state.instrumentation.mismatchCount = 0;
        state.instrumentation.lastDirection = 'up';
        initDebugApi(state);
        const dbg = (
            window as unknown as {
                spatialNavDebug: { snapshot: (label?: string) => unknown };
            }
        ).spatialNavDebug;
        const snap = dbg.snapshot('mark1');
        assert.equal(snap, state.instrumentation);
        assert.match(window.document.title, /^focusInstrumentation:/);
    });

    test('snapshot title write is swallowed when document.title throws', () => {
        const state = createTestState();
        initDebugApi(state);
        Object.defineProperty(window.document, 'title', {
            configurable: true,
            get() {
                return '';
            },
            set() {
                throw new Error('title-blocked');
            },
        });
        const dbg = (window as unknown as { spatialNavDebug: { snapshot: () => unknown } }).spatialNavDebug;
        assert.doesNotThrow(() => dbg.snapshot());
    });
});
