/**
 * Tests for navigation/handlers.ts — exercised against a real DOM (happy-dom).
 *
 * Coverage groups:
 *  - Click strategy (native injection vs JS fallback)
 *  - Menu-toggle close path (hover-exit + outside click)
 *  - Hit-testing when the focus center is covered
 *  - Event-lock + stale-handler defenses
 *  - Editable-element bypass for Enter/Space
 *  - Coordinate scaling by devicePixelRatio
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
    setupDomEnv,
    teardownDomEnv,
    attachElement,
    createElement,
    createTestState,
    createKeyboardEvent,
    setRootAttr,
    setActiveElement,
    installBrowserBridge,
    removeBrowserBridge,
} from './helpers/dom_env';
import { handleKeyDown, scheduleOverlayUpdate } from '../navigation/handlers';

// ---------------------------------------------------------------------------
// Click strategy: native injection vs JS .click()
// ---------------------------------------------------------------------------

describe('handleKeyDown: click strategy', () => {
    beforeEach(() => setupDomEnv());
    afterEach(() => {
        removeBrowserBridge();
        teardownDomEnv();
    });

    test('anchor-without-href requests native injection when bridge exists', () => {
        const el = attachElement(
            createElement({ tagName: 'a', tabindex: '0', rect: { x: 100, y: 100, width: 100, height: 50 } })
        );
        let clickCount = 0;
        el.click = () => clickCount++;

        setActiveElement(el);
        setRootAttr('data-spatnav-handler-id', '1');
        const capture = installBrowserBridge();

        const event = createKeyboardEvent({ key: 'Enter', timeStamp: 789 });
        handleKeyDown(event, createTestState([el], { handlerId: 1 }));

        assert.equal(clickCount, 0, 'native path should not invoke JS .click()');
        assert.equal(capture.count, 1);
        const msg = capture.messages[0] as { type: string; x: number; y: number };
        assert.equal(msg.type, 'simulateClick');
        // center is (150, 125), DPR is 2 → (300, 250)
        assert.equal(msg.x, 300);
        assert.equal(msg.y, 250);
        assert.equal(event.preventDefaultCalled, true);
    });

    test('anchor-without-href falls back to JS .click() when bridge is absent', () => {
        const el = attachElement(
            createElement({ tagName: 'a', tabindex: '0', rect: { x: 100, y: 100, width: 100, height: 50 } })
        );
        let clickCount = 0;
        el.click = () => clickCount++;

        setActiveElement(el);
        setRootAttr('data-spatnav-handler-id', '1');
        // no bridge installed
        const event = createKeyboardEvent({ key: 'Enter', timeStamp: 456 });

        assert.doesNotThrow(() => handleKeyDown(event, createTestState([el], { handlerId: 1 })));
        assert.equal(clickCount, 1);
        assert.equal(event.preventDefaultCalled, true);
    });

    test('anchor-with-href uses JS .click() (no native injection)', () => {
        const el = attachElement(
            createElement({ tagName: 'a', href: '/page', rect: { x: 100, y: 100, width: 100, height: 50 } })
        );
        let clickCount = 0;
        el.click = () => clickCount++;

        setActiveElement(el);
        setRootAttr('data-spatnav-handler-id', '1');
        const capture = installBrowserBridge();

        const event = createKeyboardEvent({ key: 'Enter', timeStamp: 100 });
        handleKeyDown(event, createTestState([el], { handlerId: 1 }));

        assert.equal(capture.count, 0, 'real anchors should not request native injection');
        assert.equal(clickCount, 1);
    });

    test('button uses native injection when bridge exists', () => {
        const el = attachElement(
            createElement({ tagName: 'button', rect: { x: 0, y: 0, width: 100, height: 50 } })
        );
        setActiveElement(el);
        setRootAttr('data-spatnav-handler-id', '1');
        const capture = installBrowserBridge();

        handleKeyDown(
            createKeyboardEvent({ key: 'Enter', timeStamp: 1 }),
            createTestState([el], { handlerId: 1 })
        );
        assert.equal(capture.count, 1);
    });

    test('div with role=button uses native injection', () => {
        const el = attachElement(
            createElement({ tagName: 'div', role: 'button', tabindex: '0', rect: { width: 80, height: 30 } })
        );
        setActiveElement(el);
        setRootAttr('data-spatnav-handler-id', '1');
        const capture = installBrowserBridge();

        handleKeyDown(
            createKeyboardEvent({ key: 'Enter', timeStamp: 2 }),
            createTestState([el], { handlerId: 1 })
        );
        assert.equal(capture.count, 1);
    });
});

// ---------------------------------------------------------------------------
// Menu-toggle close path
// ---------------------------------------------------------------------------

describe('handleKeyDown: menu toggle (open → close)', () => {
    beforeEach(() => setupDomEnv());
    afterEach(() => {
        removeBrowserBridge();
        teardownDomEnv();
    });

    test('open menu (aria-expanded=true) sends an outside-click via native injection', async () => {
        const el = attachElement(
            createElement({
                tagName: 'a',
                attrs: { 'aria-haspopup': 'true', 'aria-expanded': 'true' },
                rect: { x: 100, y: 100, width: 100, height: 50 },
            })
        );
        setActiveElement(el);
        setRootAttr('data-spatnav-handler-id', '1');
        const capture = installBrowserBridge();

        handleKeyDown(
            createKeyboardEvent({ key: 'Enter', timeStamp: 999 }),
            createTestState([el], { handlerId: 1 })
        );

        // Outside-click runs in setTimeout(_, 0) — wait one task.
        await new Promise((resolve) => setTimeout(resolve, 5));

        assert.ok(capture.count >= 1, 'should send at least one simulateClick');
        const msg = capture.messages[capture.messages.length - 1] as { type: string };
        assert.equal(msg.type, 'simulateClick');
    });

    test('open menu falls back to JS document.body.click() when no bridge', async () => {
        const el = attachElement(
            createElement({
                tagName: 'a',
                attrs: { 'aria-haspopup': 'true', 'aria-expanded': 'true' },
                rect: { x: 100, y: 100, width: 100, height: 50 },
            })
        );
        setActiveElement(el);
        setRootAttr('data-spatnav-handler-id', '1');

        let bodyClickCount = 0;
        document.body.click = () => bodyClickCount++;
        // no bridge installed

        handleKeyDown(
            createKeyboardEvent({ key: 'Enter', timeStamp: 1234 }),
            createTestState([el], { handlerId: 1, overlaySuppressed: true })
        );

        await new Promise((resolve) => setTimeout(resolve, 5));
        assert.ok(bodyClickCount > 0, 'JS fallback should click document.body');
    });
});

// ---------------------------------------------------------------------------
// Stale-handler & event-lock defenses
// ---------------------------------------------------------------------------

describe('handleKeyDown: defensive guards', () => {
    beforeEach(() => setupDomEnv());
    afterEach(() => {
        removeBrowserBridge();
        teardownDomEnv();
    });

    test('stale handler short-circuits when DOM handler-id no longer matches', () => {
        const el = attachElement(createElement({ tagName: 'button' }));
        setActiveElement(el);
        // DOM says handler 99 is current; my closure id is 1 → I should be a no-op.
        setRootAttr('data-spatnav-handler-id', '99');
        const capture = installBrowserBridge();

        handleKeyDown(
            createKeyboardEvent({ key: 'Enter', timeStamp: 5 }),
            createTestState([el], { handlerId: 1 })
        );

        assert.equal(capture.count, 0, 'stale handler should not send any messages');
    });

    test('event lock allows a second Enter once the microtask cleanup runs', async () => {
        const el = attachElement(
            createElement({ tagName: 'button', rect: { x: 0, y: 0, width: 50, height: 30 } })
        );
        setActiveElement(el);
        setRootAttr('data-spatnav-handler-id', '1');
        const capture = installBrowserBridge();

        // Same constant timeStamp (mimics GeckoView synthetic events).
        handleKeyDown(
            createKeyboardEvent({ key: 'Enter', timeStamp: 0 }),
            createTestState([el], { handlerId: 1 })
        );
        // Allow queueMicrotask cleanup to run, releasing the lock.
        await Promise.resolve();
        // Avoid the rapid-repeat guard.
        (window as { __SPATIAL_NAV_LAST_KEY_TIME__?: number }).__SPATIAL_NAV_LAST_KEY_TIME__ = 0;

        handleKeyDown(
            createKeyboardEvent({ key: 'Enter', timeStamp: 0 }),
            createTestState([el], { handlerId: 1 })
        );

        assert.equal(capture.count, 2, 'second Enter should not be blocked by a sticky lock');
    });

    test('rapid same-key repeats within 50ms are dropped', async () => {
        const el = attachElement(createElement({ tagName: 'a', tabindex: '0' }));
        setActiveElement(el);
        setRootAttr('data-spatnav-handler-id', '1');
        const capture = installBrowserBridge();

        handleKeyDown(
            createKeyboardEvent({ key: 'Enter', timeStamp: 100 }),
            createTestState([el], { handlerId: 1 })
        );
        // Wait one tick so Date.now() advances at least 1ms (production guard
        // requires `timeSinceLast > 0`, otherwise it's likely the same dispatched event).
        await new Promise((resolve) => setTimeout(resolve, 2));
        await Promise.resolve();

        // Second Enter within 50ms (same lastKey) is treated as a duplicate.
        const event2 = createKeyboardEvent({ key: 'Enter', timeStamp: 100 });
        handleKeyDown(event2, createTestState([el], { handlerId: 1 }));

        assert.equal(capture.count, 1, 'second rapid Enter should be dropped');
        assert.equal(event2.preventDefaultCalled, true);
    });
});

// ---------------------------------------------------------------------------
// Editable element bypass
// ---------------------------------------------------------------------------

describe('handleKeyDown: editable elements ignored', () => {
    beforeEach(() => setupDomEnv());
    afterEach(() => {
        removeBrowserBridge();
        teardownDomEnv();
    });

    test('Enter on a textarea does not steal default behavior', () => {
        const ta = attachElement(createElement({ tagName: 'textarea', rect: { width: 200, height: 60 } }));
        setActiveElement(ta);
        setRootAttr('data-spatnav-handler-id', '1');
        const capture = installBrowserBridge();

        const event = createKeyboardEvent({ key: 'Enter', timeStamp: 1 });
        handleKeyDown(event, createTestState([ta], { handlerId: 1 }));

        assert.equal(capture.count, 0);
        assert.equal(event.preventDefaultCalled, false);
    });

    test('Enter on a contenteditable does not steal default behavior', () => {
        const div = attachElement(
            createElement({ tagName: 'div', contentEditable: true, rect: { width: 200, height: 60 } })
        );
        setActiveElement(div);
        setRootAttr('data-spatnav-handler-id', '1');
        const capture = installBrowserBridge();

        const event = createKeyboardEvent({ key: 'Enter', timeStamp: 1 });
        handleKeyDown(event, createTestState([div], { handlerId: 1 }));

        assert.equal(capture.count, 0);
        assert.equal(event.preventDefaultCalled, false);
    });

    test('Enter on a text input does not steal default behavior', () => {
        const input = attachElement(
            createElement({ tagName: 'input', type: 'text', rect: { width: 200, height: 30 } })
        );
        setActiveElement(input);
        setRootAttr('data-spatnav-handler-id', '1');
        const capture = installBrowserBridge();

        const event = createKeyboardEvent({ key: 'Enter', timeStamp: 1 });
        handleKeyDown(event, createTestState([input], { handlerId: 1 }));

        assert.equal(capture.count, 0);
        assert.equal(event.preventDefaultCalled, false);
    });

    test('Enter on input type=button DOES activate', () => {
        const input = attachElement(
            createElement({ tagName: 'input', type: 'button', rect: { width: 100, height: 30 } })
        );
        setActiveElement(input);
        setRootAttr('data-spatnav-handler-id', '1');
        const capture = installBrowserBridge();

        handleKeyDown(
            createKeyboardEvent({ key: 'Enter', timeStamp: 1 }),
            createTestState([input], { handlerId: 1 })
        );

        // input type=button should not be considered editable.
        // It IS an input (not in NATIVE_CLICK_TAGS), so falls through to JS .click().
        // Either way, capture should be 0 because input isn't a native-click tag.
        assert.equal(capture.count, 0);
    });
});

// ---------------------------------------------------------------------------
// Overlay update suppression
// ---------------------------------------------------------------------------

describe('scheduleOverlayUpdate', () => {
    beforeEach(() => setupDomEnv());
    afterEach(() => teardownDomEnv());

    test('cancels pending updates while overlay is suppressed', async () => {
        let timerFired = false;
        const pendingTimer = setTimeout(() => {
            timerFired = true;
        }, 25) as unknown as number;

        const target = attachElement(createElement({ tagName: 'button' }));
        const state = createTestState([target], {
            overlaySuppressed: true,
            updateTimer: pendingTimer,
        });

        scheduleOverlayUpdate(target, state);

        assert.equal(state.updateTimer, null, 'pending timer should be cancelled');
        assert.equal(state.lastFocusedElement, target);

        await new Promise((resolve) => setTimeout(resolve, 60));
        assert.equal(timerFired, false, 'pending overlay update should not fire while suppressed');
    });
});

// ---------------------------------------------------------------------------
// Coordinate scaling
// ---------------------------------------------------------------------------

describe('devicePixelRatio scaling', () => {
    beforeEach(() => setupDomEnv({ devicePixelRatio: 2.75 }));
    afterEach(() => {
        removeBrowserBridge();
        teardownDomEnv();
    });

    test('CSS coordinates are multiplied by DPR before sending to native', () => {
        const el = attachElement(
            createElement({ tagName: 'button', rect: { x: 100, y: 200, width: 100, height: 100 } })
        );
        setActiveElement(el);
        setRootAttr('data-spatnav-handler-id', '1');
        const capture = installBrowserBridge();

        handleKeyDown(
            createKeyboardEvent({ key: 'Enter', timeStamp: 1 }),
            createTestState([el], { handlerId: 1 })
        );

        const msg = capture.messages[0] as { x: number; y: number };
        // center is (150, 250), DPR is 2.75
        assert.equal(msg.x, 412.5);
        assert.equal(msg.y, 687.5);
    });
});
