/**
 * Tests for the prefers-reduced-motion boundary-scroll path in
 * navigation/movement.ts:307-339.
 *
 * When boundaryScrollBehavior:'scroll' is active and the user hits a
 * vertical boundary, the extension calls window.scrollBy() with
 * behavior:'smooth' OR 'auto' depending on the user's reduced-motion
 * preference. The "no scroll room" branch falls through to the
 * default 'exit' path which dispatches `spatialNavigationExit`.
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { moveInDirection } from '../navigation/movement';
import { directionByName } from '../core/config';
import {
    setupDomEnv,
    teardownDomEnv,
    createElement,
    attachElement,
    createTestState,
    setActiveElement,
    installBrowserBridge,
    removeAllBridges,
    stampRect,
    type SendCapture,
} from './helpers/dom_env';

// Local alias to match existing call sites.
const attachVisible = stampRect;

interface MMResult {
    matches: boolean;
    media: string;
    addListener: () => void;
    removeListener: () => void;
    addEventListener: () => void;
    removeEventListener: () => void;
    dispatchEvent: () => boolean;
    onchange: null;
}

function patchMatchMedia(reducedMotion: boolean) {
    (window as unknown as { matchMedia: (q: string) => MMResult }).matchMedia = (q: string): MMResult => ({
        matches: q.includes('reduce') ? reducedMotion : false,
        media: q,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
        onchange: null,
    });
}

interface ScrollCalls {
    calls: ScrollToOptions[];
    fired: number;
}

function captureScrollBy(): ScrollCalls {
    const captured: ScrollCalls = { calls: [], fired: 0 };
    (window as { scrollBy: (opts: ScrollToOptions) => void }).scrollBy = (opts) => {
        captured.calls.push(opts);
        captured.fired++;
    };
    return captured;
}

describe('boundary scroll behavior — reduced motion', () => {
    let capture: SendCapture | null = null;

    beforeEach(() => {
        setupDomEnv();
        capture = installBrowserBridge();
    });
    afterEach(() => {
        removeAllBridges();
        teardownDomEnv();
    });

    test('reduced motion → scrollBy with behavior:"auto"', () => {
        const btn = attachElement(attachVisible(createElement({ tagName: 'button', tabindex: '0' })));
        setActiveElement(btn);
        const state = createTestState([btn], {}, { boundaryScrollBehavior: 'scroll' });
        patchMatchMedia(true);
        // Simulate scrollable page: scrollY=0 (down direction has room).
        Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });
        Object.defineProperty(window.document.documentElement, 'scrollHeight', {
            value: 5000,
            configurable: true,
        });
        const captured = captureScrollBy();

        moveInDirection(directionByName.down, null, state);
        assert.equal(captured.fired, 1, 'scrollBy fired once');
        assert.equal(captured.calls[0].behavior, 'auto', 'reduced-motion → auto');
        assert.ok(typeof captured.calls[0].top === 'number' && captured.calls[0].top > 0);
    });

    test('normal motion → scrollBy with behavior:"smooth"', () => {
        const btn = attachElement(attachVisible(createElement({ tagName: 'button', tabindex: '0' })));
        setActiveElement(btn);
        const state = createTestState([btn], {}, { boundaryScrollBehavior: 'scroll' });
        patchMatchMedia(false);
        Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });
        Object.defineProperty(window.document.documentElement, 'scrollHeight', {
            value: 5000,
            configurable: true,
        });
        const captured = captureScrollBy();

        moveInDirection(directionByName.down, null, state);
        assert.equal(captured.fired, 1);
        assert.equal(captured.calls[0].behavior, 'smooth');
    });

    test('up direction at scrollY=0 → no scroll room → falls through to focusExit bridge call', async () => {
        const btn = attachElement(attachVisible(createElement({ tagName: 'button', tabindex: '0' })));
        setActiveElement(btn);
        const state = createTestState([btn], {}, { boundaryScrollBehavior: 'scroll' });
        patchMatchMedia(false);
        Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });
        Object.defineProperty(window.document.documentElement, 'scrollHeight', {
            value: 5000,
            configurable: true,
        });
        const captured = captureScrollBy();

        moveInDirection(directionByName.up, null, state);
        // Allow the async sendFocusExit promise to flush.
        await new Promise((r) => setTimeout(r, 0));
        assert.equal(captured.fired, 0, 'no scroll attempted (no room up)');
        const fx = capture!.messages.find((m) => (m as { type?: string }).type === 'focusExit') as
            | { type: string; direction: string }
            | undefined;
        assert.ok(fx, 'focusExit sent via bridge on fall-through');
        assert.equal(fx!.direction, 'up');
    });

    test('down direction at scroll bottom → no scroll room → focusExit fired', async () => {
        const btn = attachElement(attachVisible(createElement({ tagName: 'button', tabindex: '0' })));
        setActiveElement(btn);
        const state = createTestState([btn], {}, { boundaryScrollBehavior: 'scroll' });
        patchMatchMedia(false);
        // Simulate at-bottom page.
        Object.defineProperty(window, 'scrollY', { value: 4000, configurable: true });
        Object.defineProperty(window, 'innerHeight', { value: 1000, configurable: true });
        Object.defineProperty(window.document.documentElement, 'scrollHeight', {
            value: 5000,
            configurable: true,
        });
        const captured = captureScrollBy();

        moveInDirection(directionByName.down, null, state);
        await new Promise((r) => setTimeout(r, 0));
        assert.equal(captured.fired, 0);
        const fx = capture!.messages.find((m) => (m as { type?: string }).type === 'focusExit');
        assert.ok(fx, 'focusExit sent via bridge');
    });

    test('boundaryScrollBehavior:"none" → silent no-op, no exit, no scroll', () => {
        const btn = attachElement(attachVisible(createElement({ tagName: 'button', tabindex: '0' })));
        setActiveElement(btn);
        const state = createTestState([btn], {}, { boundaryScrollBehavior: 'none' });
        patchMatchMedia(false);
        const captured = captureScrollBy();
        let exitFired = 0;
        window.addEventListener('spatialNavigationExit', () => {
            exitFired++;
        });

        moveInDirection(directionByName.down, null, state);
        assert.equal(captured.fired, 0);
        assert.equal(exitFired, 0);
    });
});
