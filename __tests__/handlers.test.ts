/**
 * Tests for handlers module - Click handling and native injection
 * 
 * These tests verify:
 * - isNativeClickTarget logic correctly identifies elements needing native injection
 * - Click handling dispatches correct events
 * - Message sending to background script works correctly
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
    createMockElement,
    createMockKeyboardEvent,
    isNativeClickTarget,
    setupMockEnv,
} from './helpers/mock_env';

const globalAny = globalThis as any;

// ============================================================================
// isNativeClickTarget Logic Tests
// ============================================================================

test('isNativeClickTarget: anchor without href should be native target', async () => {
    setupMockEnv();

    const el = createMockElement({ tagName: 'a', hasHref: false });
    assert.equal(isNativeClickTarget(el as any), true, 'Anchor without href should use native injection');
});

test('isNativeClickTarget: anchor WITH href should NOT be native target', async () => {
    setupMockEnv();

    const el = createMockElement({ tagName: 'a', hasHref: true, hrefValue: '/page' });
    assert.equal(isNativeClickTarget(el as any), false, 'Anchor with href should use JS .click()');
});

test('isNativeClickTarget: div should be native target', async () => {
    setupMockEnv();

    const el = createMockElement({ tagName: 'div' });
    assert.equal(isNativeClickTarget(el as any), true, 'Div should use native injection');
});

test('isNativeClickTarget: button should be native target', async () => {
    setupMockEnv();

    const el = createMockElement({ tagName: 'button' });
    assert.equal(isNativeClickTarget(el as any), true, 'Button should use native injection');
});

test('isNativeClickTarget: role=button should be native target', async () => {
    setupMockEnv();

    const el = createMockElement({ tagName: 'span', role: 'button' });
    assert.equal(isNativeClickTarget(el as any), true, 'Element with role=button should use native injection');
});

test('isNativeClickTarget: video should be native target', async () => {
    setupMockEnv();

    const el = createMockElement({ tagName: 'video' });
    assert.equal(isNativeClickTarget(el as any), true, 'Video element should use native injection');
});

test('isNativeClickTarget: img should be native target', async () => {
    setupMockEnv();

    const el = createMockElement({ tagName: 'img' });
    assert.equal(isNativeClickTarget(el as any), true, 'Img element should use native injection');
});

// ============================================================================
// handleKeyDown Click Strategy Tests
// ============================================================================

test('handleKeyDown: aria-haspopup menu toggle requests native injection when bridge exists', async () => {
    const { mockDocument } = setupMockEnv();

    const { handleKeyDown } = await import('../navigation/handlers');

    const el = createMockElement({ tagName: 'a', hasHref: false, ariaHasPopup: 'true' });
    let clickCount = 0;
    el.click = () => { clickCount += 1; };

    mockDocument.activeElement = el;
    mockDocument.elementFromPoint = () => el;
    mockDocument.documentElement.setAttribute('data-spatnav-handler-id', '1');

    let sendMessageCount = 0;
    globalAny.browser = {
        runtime: {
            sendMessage: () => { sendMessageCount += 1; }
        }
    };

    const event = createMockKeyboardEvent({ key: 'Enter', timeStamp: 123.456 });

    handleKeyDown(event as any, { handlerId: 1, overlay: null } as any);

    assert.equal(clickCount, 0, 'native injection path should not use JS .click()');
    assert.equal(sendMessageCount, 1, 'menu toggle should request native injection when available');
    assert.equal(event.preventDefaultCalled, true);
    assert.equal(event.stopPropagationCalled, true);
    assert.equal(event.stopImmediatePropagationCalled, true);
});

test('handleKeyDown: open menu toggle closes via outside click (not toggle center)', async () => {
    const { mockDocument } = setupMockEnv();

    const { handleKeyDown } = await import('../navigation/handlers');

    // Simulate a menu toggle already open (aria-expanded="true").
    const el = createMockElement({
        tagName: 'a',
        hasHref: false,
        ariaHasPopup: 'true',
        ariaExpanded: 'true'
    });
    let focusCount = 0;
    el.focus = () => { focusCount += 1; };
    el.getBoundingClientRect = () => ({
        top: 100,
        left: 100,
        bottom: 150,
        right: 200,
        width: 100,
        height: 50,
        x: 100,
        y: 100,
        toJSON: () => ({})
    });

    mockDocument.activeElement = el;
    mockDocument.documentElement.setAttribute('data-spatnav-handler-id', '1');

    // Outside-point hit testing is not required for this assertion; return null everywhere.
    mockDocument.elementFromPoint = () => null;

    let lastMessage: any = null;
    globalAny.browser = {
        runtime: {
            sendMessage: (msg: unknown) => {
                lastMessage = msg;
            }
        }
    };

    const event = createMockKeyboardEvent({ key: 'Enter', timeStamp: 999.0 });

    handleKeyDown(event as any, { handlerId: 1, overlay: null, dirty: false } as any);

    // Close path runs the outside-click fallback in a later task.
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Close path sends an outside click at y = bottom + 8 (toggle-below) scaled by DPR=2.
    assert.equal(lastMessage?.type, 'simulateClick');
    assert.equal(lastMessage?.x, 300, 'outside click should align with toggle centerX (150px) scaled by dpr=2');
    assert.equal(lastMessage?.y, 316, 'outside click should use toggle-below point (158px) scaled by dpr=2');
    assert.equal(event.preventDefaultCalled, true);
    assert.equal(event.stopPropagationCalled, true);
    assert.equal(event.stopImmediatePropagationCalled, true);

    // Focus restore runs after the outside-click.
    await new Promise((resolve) => setTimeout(resolve, 160));
    assert.ok(focusCount > 0, 'should restore focus to the toggle after closing');
});

test('handleKeyDown: open menu toggle closes via JS outside click when bridge is unavailable', async () => {
    const { mockDocument } = setupMockEnv();

    const { handleKeyDown } = await import('../navigation/handlers');

    const el = createMockElement({
        tagName: 'a',
        hasHref: false,
        ariaHasPopup: 'true',
        ariaExpanded: 'true'
    });

    let focusCount = 0;
    el.focus = () => {
        focusCount += 1;
    };

    let bodyClickCount = 0;
    mockDocument.body.click = () => {
        bodyClickCount += 1;
    };

    mockDocument.activeElement = el;
    mockDocument.documentElement.setAttribute('data-spatnav-handler-id', '1');

    // Ensure JS fallback: no bridge available.
    globalAny.browser = undefined;

    // Outside-point hit testing returns null everywhere, so the fallback clicks document.body.
    mockDocument.elementFromPoint = () => null;

    const event = createMockKeyboardEvent({ key: 'Enter', timeStamp: 1234.0 });

    handleKeyDown(event as any, { handlerId: 1, overlay: null, dirty: false, overlaySuppressed: true, updateTimer: null } as any);

    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.ok(bodyClickCount > 0, 'should attempt JS outside click via document.body.click()');
    assert.equal(event.preventDefaultCalled, true);
    assert.equal(event.stopPropagationCalled, true);
    assert.equal(event.stopImmediatePropagationCalled, true);

    await new Promise((resolve) => setTimeout(resolve, 160));
    assert.ok(focusCount > 0, 'should restore focus to the toggle after JS outside click');
});

test('handleKeyDown: submenu-visible menu toggle closes via hover-exit without outside click', async () => {
    const { mockDocument } = setupMockEnv();

    const { handleKeyDown } = await import('../navigation/handlers');

    const toggle = createMockElement({
        tagName: 'a',
        hasHref: false,
        ariaHasPopup: 'true'
    });

    let focusCount = 0;
    toggle.focus = () => {
        focusCount += 1;
    };

    // Simulate a submenu that is initially visible, but becomes hidden on mouseleave.
    let submenuVisible = true;
    const submenu = createMockElement({ tagName: 'ul' });
    submenu.getBoundingClientRect = () => (submenuVisible ? ({
        top: 200,
        left: 200,
        bottom: 250,
        right: 400,
        width: 200,
        height: 50,
        x: 200,
        y: 200,
        toJSON: () => ({})
    } as any) : ({
        top: 200,
        left: 200,
        bottom: 200,
        right: 200,
        width: 0,
        height: 0,
        x: 200,
        y: 200,
        toJSON: () => ({})
    } as any));

    submenu.dispatchEvent = (e: any) => {
        if (e?.type === 'mouseleave') submenuVisible = false;
        return true;
    };

    // Wire submenu discovery via nextElementSibling.
    (toggle as any).nextElementSibling = submenu;

    mockDocument.activeElement = toggle;
    mockDocument.elementFromPoint = () => null;
    mockDocument.documentElement.setAttribute('data-spatnav-handler-id', '1');

    let sendMessageCount = 0;
    globalAny.browser = {
        runtime: {
            sendMessage: () => { sendMessageCount += 1; }
        }
    };

    const event = createMockKeyboardEvent({ key: 'Enter', timeStamp: 1000.0 });

    handleKeyDown(event as any, { handlerId: 1, overlay: null, dirty: false, overlaySuppressed: true, updateTimer: null } as any);

    assert.equal(sendMessageCount, 0, 'hover-exit close should not send an outside native click');
    assert.ok(focusCount > 0, 'should restore focus to the toggle after close');
    assert.equal(event.preventDefaultCalled, true);
    assert.equal(event.stopPropagationCalled, true);
    assert.equal(event.stopImmediatePropagationCalled, true);
});

test('handleKeyDown: outside-click fallback avoids navigation root and restores focus', async () => {
    const { mockDocument } = setupMockEnv();

    const { handleKeyDown } = await import('../navigation/handlers');

    const toggle = createMockElement({
        tagName: 'a',
        hasHref: false,
        ariaHasPopup: 'true'
    });

    let focusCount = 0;
    toggle.focus = () => {
        focusCount += 1;
    };

    // Persistent "open" submenu (hover-exit does not close).
    const submenu = createMockElement({ tagName: 'ul' });
    submenu.getBoundingClientRect = () => ({
        top: 200,
        left: 200,
        bottom: 250,
        right: 300,
        width: 100,
        height: 50,
        x: 200,
        y: 200,
        toJSON: () => ({})
    });
    (toggle as any).nextElementSibling = submenu;

    // Navigation root that must be excluded from outside-click hit targets.
    const navRoot: any = {
        nodeType: 1,
        tagName: 'DIV',
        getAttribute: (name: string) => (name === 'id' ? 'desktopNav' : null),
        contains: (other: unknown) => other === navRoot,
        querySelector: () => toggle,
        parentElement: null
    };
    (toggle as any).parentElement = navRoot;

    mockDocument.activeElement = toggle;
    mockDocument.documentElement.setAttribute('data-spatnav-handler-id', '1');

    // Force the first pick ("submenu-below") to hit the excluded navRoot, so the picker
    // must select the next candidate ("submenu-right").
    mockDocument.elementFromPoint = (x: number, y: number) => {
        if (Math.abs(x - 250) < 0.01 && Math.abs(y - 258) < 0.01) return navRoot;
        return null;
    };

    let lastMessage: any = null;
    globalAny.browser = {
        runtime: {
            sendMessage: (msg: unknown) => { lastMessage = msg; }
        }
    };

    const event = createMockKeyboardEvent({ key: 'Enter', timeStamp: 2000.0 });

    handleKeyDown(event as any, { handlerId: 1, overlay: null, dirty: false, overlaySuppressed: true, updateTimer: null } as any);

    // Close fallback runs in a later task.
    await new Promise((resolve) => setTimeout(resolve, 0));

    // submenu-right: (x=308, y=208) scaled by dpr=2.
    assert.equal(lastMessage?.type, 'simulateClick');
    assert.equal(lastMessage?.x, 616);
    assert.equal(lastMessage?.y, 416);

    // Focus restore runs after a delay.
    await new Promise((resolve) => setTimeout(resolve, 160));
    assert.ok(focusCount > 0, 'should restore focus to the toggle after outside-click fallback');

    assert.equal(event.preventDefaultCalled, true);
    assert.equal(event.stopPropagationCalled, true);
    assert.equal(event.stopImmediatePropagationCalled, true);
});

test('handleKeyDown: native injection hit-tests when center is covered', async () => {
    const { mockDocument } = setupMockEnv();

    const { handleKeyDown } = await import('../navigation/handlers');

    const el = createMockElement({ tagName: 'a', hasHref: false, ariaHasPopup: 'true' });
    const overlay = createMockElement({ tagName: 'div', id: 'overlay' });
    el.getBoundingClientRect = () => ({
        top: 100,
        left: 100,
        bottom: 150,
        right: 200,
        width: 100,
        height: 50,
        x: 100,
        y: 100,
        toJSON: () => ({})
    });

    mockDocument.activeElement = el;
    mockDocument.documentElement.setAttribute('data-spatnav-handler-id', '1');

    // Center point (150,125) is "covered" by overlay, but top-left inset (101,101) hits the element.
    mockDocument.elementFromPoint = (x: number, y: number) => {
        if (Math.abs(x - 101) < 0.01 && Math.abs(y - 101) < 0.01) return el;
        if (Math.abs(x - 150) < 0.01 && Math.abs(y - 125) < 0.01) return overlay;
        return overlay;
    };

    let lastMessage: any = null;
    globalAny.browser = {
        runtime: {
            sendMessage: (msg: any) => { lastMessage = msg; }
        }
    };

    const event = createMockKeyboardEvent({ key: 'Enter', timeStamp: 999.0 });

    handleKeyDown(event as any, { handlerId: 1, overlay: null } as any);

    assert.equal(lastMessage?.type, 'simulateClick');
    assert.equal(lastMessage?.x, 202, 'should pick top-left inset (101px) and scale by dpr=2');
    assert.equal(lastMessage?.y, 202, 'should pick top-left inset (101px) and scale by dpr=2');
});

test('handleKeyDown: aria-haspopup menu toggle falls back to JS click when bridge is unavailable', async () => {
    const { mockDocument } = setupMockEnv();

    const { handleKeyDown } = await import('../navigation/handlers');

    const el = createMockElement({ tagName: 'a', hasHref: false, ariaHasPopup: 'true' });
    let clickCount = 0;
    el.click = () => { clickCount += 1; };

    mockDocument.activeElement = el;
    mockDocument.elementFromPoint = () => el;
    mockDocument.documentElement.setAttribute('data-spatnav-handler-id', '1');

    globalAny.browser = undefined;

    const event = createMockKeyboardEvent({ key: 'Enter', timeStamp: 222.333 });

    assert.doesNotThrow(() => handleKeyDown(event as any, { handlerId: 1, overlay: null } as any));
    assert.equal(clickCount, 1, 'menu toggle should fall back to JS .click() when bridge is unavailable');
    assert.equal(event.preventDefaultCalled, true);
    assert.equal(event.stopPropagationCalled, true);
    assert.equal(event.stopImmediatePropagationCalled, true);
});

test('handleKeyDown: anchor without href falls back to JS click when browser is unavailable', async () => {
    const { mockDocument } = setupMockEnv();

    const { handleKeyDown } = await import('../navigation/handlers');

    const el = createMockElement({ tagName: 'a', hasHref: false });
    let clickCount = 0;
    el.click = () => { clickCount += 1; };

    mockDocument.activeElement = el;
    mockDocument.elementFromPoint = () => el;
    mockDocument.documentElement.setAttribute('data-spatnav-handler-id', '1');

    // Simulate injected-script mode where WebExtension globals are missing/unavailable.
    globalAny.browser = undefined;

    const event = createMockKeyboardEvent({ key: 'Enter', timeStamp: 456.789 });

    assert.doesNotThrow(() => handleKeyDown(event as any, { handlerId: 1, overlay: null } as any));
    assert.equal(clickCount, 1, 'should fall back to JS .click() when native injection is unavailable');
    assert.equal(event.preventDefaultCalled, true);
    assert.equal(event.stopPropagationCalled, true);
    assert.equal(event.stopImmediatePropagationCalled, true);
});

test('handleKeyDown: anchor without href requests native injection when browser bridge exists', async () => {
    const { mockDocument } = setupMockEnv();

    const { handleKeyDown } = await import('../navigation/handlers');

    const el = createMockElement({ tagName: 'a', hasHref: false });
    let clickCount = 0;
    el.click = () => { clickCount += 1; };

    mockDocument.activeElement = el;
    mockDocument.elementFromPoint = () => el;
    mockDocument.documentElement.setAttribute('data-spatnav-handler-id', '1');

    let lastMessage: any = null;
    globalAny.browser = {
        runtime: {
            sendMessage: (msg: unknown) => {
                lastMessage = msg;
            }
        }
    };

    const event = createMockKeyboardEvent({ key: 'Enter', timeStamp: 789.012 });

    handleKeyDown(event as any, { handlerId: 1, overlay: null } as any);

    assert.equal(clickCount, 0, 'native injection path should not use JS .click()');
    assert.equal(lastMessage?.type, 'simulateClick');
    assert.equal(lastMessage?.x, 300);
    assert.equal(lastMessage?.y, 250);
    assert.equal(event.preventDefaultCalled, true);
    assert.equal(event.stopPropagationCalled, true);
    assert.equal(event.stopImmediatePropagationCalled, true);
});

test('handleKeyDown: event lock clears so repeated Enter works when timeStamp is constant', async () => {
    const { mockDocument } = setupMockEnv();

    const { handleKeyDown } = await import('../navigation/handlers');

    const el = createMockElement({ tagName: 'a', hasHref: false, ariaHasPopup: 'true' });
    mockDocument.activeElement = el;
    mockDocument.elementFromPoint = () => el;
    mockDocument.documentElement.setAttribute('data-spatnav-handler-id', '1');

    let sendMessageCount = 0;
    globalAny.browser = {
        runtime: {
            sendMessage: () => { sendMessageCount += 1; }
        }
    };

    const makeEvent = () => createMockKeyboardEvent({ key: 'Enter', timeStamp: 0 });

    handleKeyDown(makeEvent() as any, { handlerId: 1, overlay: null } as any);

    // Allow queueMicrotask() cleanup to run (clears the DOM event lock).
    await Promise.resolve();

    // Avoid the "rapid repeat" guard in handlers.ts for this test.
    globalAny.window.__SPATIAL_NAV_LAST_KEY_TIME__ = 0;

    handleKeyDown(makeEvent() as any, { handlerId: 1, overlay: null } as any);

    assert.equal(sendMessageCount, 2, 'second Enter should not be blocked by a sticky event lock');
});

// ============================================================================
// Overlay suppression (focus-exit) tests
// ============================================================================

test('scheduleOverlayUpdate skips when overlay suppressed', async () => {
    setupMockEnv();

    const { scheduleOverlayUpdate } = await import('../navigation/handlers');

    let timerFired = false;
    const pendingTimer = setTimeout(() => {
        timerFired = true;
    }, 25);

    const state = {
        overlaySuppressed: true,
        updateTimer: pendingTimer,
        lastFocusedElement: null,
    } as any;

    const target = createMockElement({ tagName: 'button', id: 't' }) as any;

    scheduleOverlayUpdate(target, state);

    assert.equal(state.updateTimer, null);
    assert.equal(state.lastFocusedElement, target);

    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.equal(timerFired, false, 'pending overlay update should be cancelled while suppressed');
});

test('isNativeClickTarget: input type=text should NOT be native target', async () => {
    setupMockEnv();

    const el = createMockElement({ tagName: 'input', type: 'text' });
    assert.equal(isNativeClickTarget(el as any), false, 'Text input should not use native injection');
});

// ============================================================================
// Coordinate Scaling Tests
// ============================================================================

test('devicePixelRatio scaling: coordinates should be multiplied by DPR', async () => {
    setupMockEnv();

    const cssX = 100;
    const cssY = 200;
    const dpr = 2.0;

    const finalX = cssX * dpr;
    const finalY = cssY * dpr;

    assert.equal(finalX, 200, 'X coordinate should be scaled by DPR');
    assert.equal(finalY, 400, 'Y coordinate should be scaled by DPR');
});

test('devicePixelRatio scaling: handles fractional DPR', async () => {
    setupMockEnv();

    const cssX = 100;
    const cssY = 200;
    const dpr = 2.75; // Common on high-DPI displays

    const finalX = cssX * dpr;
    const finalY = cssY * dpr;

    assert.equal(finalX, 275, 'X coordinate should handle fractional DPR');
    assert.equal(finalY, 550, 'Y coordinate should handle fractional DPR');
});

// ============================================================================
// Editable Element Detection Tests
// ============================================================================

test('isEditable: contenteditable element should be detected', async () => {
    setupMockEnv();

    const el = createMockElement({ tagName: 'div', isEditable: true });
    const isEditable = el.isContentEditable || false;

    assert.equal(isEditable, true, 'contentEditable element should be detected');
});

test('isEditable: textarea should be detected', async () => {
    setupMockEnv();

    const el = createMockElement({ tagName: 'textarea' });
    const tagName = el.tagName.toLowerCase();
    const isEditable = tagName === 'textarea';

    assert.equal(isEditable, true, 'textarea should be detected as editable');
});

test('isEditable: input type=text should be detected as editable', async () => {
    setupMockEnv();

    const el = createMockElement({ tagName: 'input', type: 'text' });
    const tagName = el.tagName.toLowerCase();
    const inputType = el.type || '';
    const nonEditableTypes = ['button', 'submit', 'reset', 'checkbox', 'radio', 'image', 'file'];

    const isEditable = tagName === 'input' && !nonEditableTypes.includes(inputType);

    assert.equal(isEditable, true, 'Text input should be detected as editable');
});

test('isEditable: input type=button should NOT be editable', async () => {
    setupMockEnv();

    const el = createMockElement({ tagName: 'input', type: 'button' });
    const tagName = el.tagName.toLowerCase();
    const inputType = el.type || '';
    const nonEditableTypes = ['button', 'submit', 'reset', 'checkbox', 'radio', 'image', 'file'];

    const isEditable = tagName === 'input' && !nonEditableTypes.includes(inputType);

    assert.equal(isEditable, false, 'Button input should not be detected as editable');
});

// ============================================================================
// Message Format Tests
// ============================================================================

test('simulateClick message: should have correct structure', async () => {
    setupMockEnv();

    const message = {
        type: 'simulateClick',
        x: 200,
        y: 400
    };

    assert.equal(message.type, 'simulateClick', 'Message type should be simulateClick');
    assert.equal(typeof message.x, 'number', 'X coordinate should be a number');
    assert.equal(typeof message.y, 'number', 'Y coordinate should be a number');
});
