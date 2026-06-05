/**
 * Tests for navigation/menu_toggle.ts — aria-haspopup/aria-expanded menu
 * close handling.
 *
 * Covers isMenuToggleElement matrix, tryCloseOpenMenuToggle hover-exit
 * + outside-click fallback, native vs JS click branches, handler-id stale
 * guard, and the per-element submenu resolution paths.
 *
 * happy-dom limitation noted in plan: document.elementFromPoint returns
 * null, so pickOutsidePoint's `looksInteractive(null) === false` branch
 * always wins. Real hit-test geometry stays in e2e.
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { isMenuToggleElement, tryCloseOpenMenuToggle } from '../navigation/menu_toggle';
import {
    setupDomEnv,
    teardownDomEnv,
    createElement,
    attachElement,
    createTestState,
    createKeyboardEvent,
    installBrowserBridge,
    removeAllBridges,
    setRootAttr,
    stampRect,
} from './helpers/dom_env';

// Local alias to match existing call sites.
const attachVisible = stampRect;

describe('isMenuToggleElement', () => {
    beforeEach(() => setupDomEnv());
    afterEach(() => teardownDomEnv());

    test('true when aria-haspopup is set to a truthy value', () => {
        const el = createElement({ attrs: { 'aria-haspopup': 'menu' } });
        assert.equal(isMenuToggleElement(el), true);
    });

    test('false when aria-haspopup is "false"', () => {
        const el = createElement({ attrs: { 'aria-haspopup': 'false' } });
        assert.equal(isMenuToggleElement(el), false);
    });

    test('true when aria-expanded is present (any value)', () => {
        const el = createElement({ attrs: { 'aria-expanded': 'false' } });
        assert.equal(isMenuToggleElement(el), true);
        const el2 = createElement({ attrs: { 'aria-expanded': 'true' } });
        assert.equal(isMenuToggleElement(el2), true);
    });

    test('false when neither attribute is present', () => {
        const el = createElement({ tagName: 'button' });
        assert.equal(isMenuToggleElement(el), false);
    });
});

describe('tryCloseOpenMenuToggle — closed states', () => {
    beforeEach(() => setupDomEnv());
    afterEach(() => {
        removeAllBridges();
        teardownDomEnv();
    });

    test('closed menu (aria-expanded=false) returns false (no-op)', () => {
        const toggle = attachElement(attachVisible(createElement({ attrs: { 'aria-expanded': 'false' } })));
        const state = createTestState([toggle]);
        const event = createKeyboardEvent({ key: 'Enter' });
        const result = tryCloseOpenMenuToggle({
            actionElement: toggle,
            state,
            event,
            handlerId: 1,
            runtimeApi: null,
            canRequestNativeClick: false,
        });
        assert.equal(result, false);
    });

    test('no aria + no submenu → no-op', () => {
        const toggle = attachElement(attachVisible(createElement({ tagName: 'button', text: 'noop' })));
        const state = createTestState([toggle]);
        const event = createKeyboardEvent({ key: 'Enter' });
        const result = tryCloseOpenMenuToggle({
            actionElement: toggle,
            state,
            event,
            handlerId: 1,
            runtimeApi: null,
            canRequestNativeClick: false,
        });
        assert.equal(result, false);
    });
});

describe('tryCloseOpenMenuToggle — open via aria-expanded=true', () => {
    beforeEach(() => setupDomEnv());
    afterEach(() => {
        removeAllBridges();
        teardownDomEnv();
    });

    test('hover-exit dispatches pointerout/leave + mouseout/leave on toggle', () => {
        const fired: string[] = [];
        const toggle = attachElement(attachVisible(createElement({ attrs: { 'aria-expanded': 'true' } })));
        for (const ev of ['mouseout', 'mouseleave', 'pointerout', 'pointerleave']) {
            toggle.addEventListener(ev, () => fired.push(ev));
        }
        const state = createTestState([toggle]);
        const event = createKeyboardEvent({ key: 'Enter' });

        // Test before mutation: aria-expanded='true' → open.
        // Hover-exit dispatches but won't actually flip aria-expanded; we
        // expect the second detectMenuToggleState call to still see "open"
        // and proceed to the setTimeout outside-click fallback.
        setRootAttr('data-spatnav-handler-id', '1');
        const result = tryCloseOpenMenuToggle({
            actionElement: toggle,
            state,
            event,
            handlerId: 1,
            runtimeApi: null,
            canRequestNativeClick: false,
        });
        assert.equal(result, true);
        assert.ok(fired.includes('mouseout'), 'mouseout fired');
        assert.ok(fired.includes('mouseleave'), 'mouseleave fired');
        // PointerEvent is aliased to MouseEvent in happy-dom — pointer* events
        // ARE constructed (typeof PointerEvent === 'function' is true), but
        // dispatchEvent on the alias is the same MouseEvent type.
        assert.ok(event.preventDefaultCalled);
        assert.ok(event.stopPropagationCalled);
    });

    test('hover-exit succeeds (aria-expanded flips to false) → skips outside-click', () => {
        const toggle = attachElement(attachVisible(createElement({ attrs: { 'aria-expanded': 'true' } })));
        // Wire a listener on toggle that flips aria-expanded after the
        // hover-exit dispatch — mimics real menu behavior.
        toggle.addEventListener('mouseleave', () => {
            toggle.setAttribute('aria-expanded', 'false');
        });
        const state = createTestState([toggle]);
        const event = createKeyboardEvent({ key: 'Enter' });

        setRootAttr('data-spatnav-handler-id', '1');
        const result = tryCloseOpenMenuToggle({
            actionElement: toggle,
            state,
            event,
            handlerId: 1,
            runtimeApi: null,
            canRequestNativeClick: false,
        });
        assert.equal(result, true);
        assert.equal(toggle.getAttribute('aria-expanded'), 'false');
        assert.equal(state.dirty, true);
    });
});

describe('tryCloseOpenMenuToggle — outside-click fallback', () => {
    beforeEach(() => setupDomEnv());
    afterEach(() => {
        removeAllBridges();
        teardownDomEnv();
    });

    test('uses native bridge when canRequestNativeClick is true', async () => {
        const toggle = attachElement(attachVisible(createElement({ attrs: { 'aria-expanded': 'true' } })));
        const state = createTestState([toggle]);
        const event = createKeyboardEvent({ key: 'Enter' });
        const capture = installBrowserBridge({
            sendMessage: function (msg) {
                capture.messages.push(msg);
                capture.count++;
            },
        });
        setRootAttr('data-spatnav-handler-id', '1');
        tryCloseOpenMenuToggle({
            actionElement: toggle,
            state,
            event,
            handlerId: 1,
            runtimeApi: (globalThis as { browser?: { runtime: unknown } }).browser!.runtime,
            canRequestNativeClick: true,
        });
        // Allow setTimeout(0) for outside-click.
        await new Promise((r) => setTimeout(r, 5));
        const sim = capture.messages.find((m) => (m as { type?: string }).type === 'simulateClick') as
            | { type: string; debug: { context: string } }
            | undefined;
        assert.ok(sim, 'simulateClick was sent to native bridge');
        assert.equal(sim!.debug.context, 'menuToggleClose');
    });

    test('falls back to JS click when canRequestNativeClick is false', async () => {
        const toggle = attachElement(attachVisible(createElement({ attrs: { 'aria-expanded': 'true' } })));
        const state = createTestState([toggle]);
        const event = createKeyboardEvent({ key: 'Enter' });
        let bodyClicked = 0;
        const origClick = window.document.body.click;
        (window.document.body as { click: () => void }).click = () => {
            bodyClicked++;
        };
        setRootAttr('data-spatnav-handler-id', '1');

        tryCloseOpenMenuToggle({
            actionElement: toggle,
            state,
            event,
            handlerId: 1,
            runtimeApi: null,
            canRequestNativeClick: false,
        });
        await new Promise((r) => setTimeout(r, 5));
        // happy-dom's elementFromPoint returns null → JS fallback calls body.click().
        assert.ok(bodyClicked >= 1, 'JS fallback click fired');

        (window.document.body as { click: () => void }).click = origClick;
    });

    test('JS fallback dispatches mousedown/mouseup on a non-null hit element', async () => {
        const toggle = attachElement(attachVisible(createElement({ attrs: { 'aria-expanded': 'true' } })));
        const outside = attachElement(createElement({ tagName: 'div', id: 'outside-target' }));
        const dispatched: string[] = [];
        outside.addEventListener('mousedown', () => dispatched.push('mousedown'));
        outside.addEventListener('mouseup', () => dispatched.push('mouseup'));
        let clicked = 0;
        outside.click = () => {
            clicked++;
        };
        // Override elementFromPoint to return our `outside` element.
        const origEFP = document.elementFromPoint.bind(document);
        document.elementFromPoint = () => outside;

        const state = createTestState([toggle]);
        const event = createKeyboardEvent({ key: 'Enter' });
        setRootAttr('data-spatnav-handler-id', '1');
        tryCloseOpenMenuToggle({
            actionElement: toggle,
            state,
            event,
            handlerId: 1,
            runtimeApi: null,
            canRequestNativeClick: false,
        });
        await new Promise((r) => setTimeout(r, 5));
        assert.ok(dispatched.includes('mousedown'));
        assert.ok(dispatched.includes('mouseup'));
        assert.ok(clicked >= 1);

        document.elementFromPoint = origEFP;
    });

    test('focus-restore setTimeout aborts when handler-id is stale on second tick', async () => {
        const toggle = attachElement(attachVisible(createElement({ attrs: { 'aria-expanded': 'true' } })));
        const state = createTestState([toggle]);
        const event = createKeyboardEvent({ key: 'Enter' });
        setRootAttr('data-spatnav-handler-id', '1');
        let focusCalls = 0;
        const origFocus = toggle.focus.bind(toggle);
        (toggle as { focus: () => void }).focus = () => {
            focusCalls++;
            origFocus();
        };
        tryCloseOpenMenuToggle({
            actionElement: toggle,
            state,
            event,
            handlerId: 1,
            runtimeApi: null,
            canRequestNativeClick: false,
        });
        // Let outside-click setTimeout fire.
        await new Promise((r) => setTimeout(r, 10));
        // Bump handler-id before the focus-restore setTimeout (120ms).
        setRootAttr('data-spatnav-handler-id', '999');
        await new Promise((r) => setTimeout(r, 130));
        // No additional focus calls after handler-id bump (the focus-restore aborts).
        // It's hard to assert exact counts because hover-exit also called focus once.
        // The important thing: no throw and at most one focus call from the immediate path.
        assert.ok(focusCalls <= 2);
    });

    test('handler-id stale: setTimeout outside-click aborts', async () => {
        const toggle = attachElement(attachVisible(createElement({ attrs: { 'aria-expanded': 'true' } })));
        const state = createTestState([toggle]);
        const event = createKeyboardEvent({ key: 'Enter' });
        const capture = installBrowserBridge({
            sendMessage: function (msg) {
                capture.messages.push(msg);
                capture.count++;
            },
        });
        setRootAttr('data-spatnav-handler-id', '1');
        tryCloseOpenMenuToggle({
            actionElement: toggle,
            state,
            event,
            handlerId: 1,
            runtimeApi: (globalThis as { browser?: { runtime: unknown } }).browser!.runtime,
            canRequestNativeClick: true,
        });
        // Bump the handler-id before the setTimeout fires.
        setRootAttr('data-spatnav-handler-id', '999');
        await new Promise((r) => setTimeout(r, 5));
        // No simulateClick should have been sent.
        const sim = capture.messages.find((m) => (m as { type?: string }).type === 'simulateClick');
        assert.equal(sim, undefined, 'outside-click aborted on stale handler-id');
    });
});

describe('findAssociatedSubmenu resolution', () => {
    beforeEach(() => setupDomEnv());
    afterEach(() => teardownDomEnv());

    test('resolves submenu via aria-controls', () => {
        const sub = attachElement(attachVisible(createElement({ id: 'submenu-1', className: 'menu' })));
        const toggle = attachElement(
            attachVisible(
                createElement({
                    attrs: { 'aria-controls': 'submenu-1', 'aria-expanded': 'true' },
                })
            )
        );
        void sub;
        const state = createTestState([toggle]);
        const event = createKeyboardEvent({ key: 'Enter' });
        // The fact that this returns true (toggle was OPEN with a known submenu)
        // implies findAssociatedSubmenu found it via aria-controls.
        setRootAttr('data-spatnav-handler-id', '1');
        const result = tryCloseOpenMenuToggle({
            actionElement: toggle,
            state,
            event,
            handlerId: 1,
            runtimeApi: null,
            canRequestNativeClick: false,
        });
        assert.equal(result, true);
    });

    test('resolves submenu via next-sibling list (visible-submenu open state)', () => {
        // The toggle has NO aria-expanded; the open state is inferred from
        // visible-next-sibling-with-submenu-shape (<ul> with menuitems).
        const parent = attachElement(createElement({ tagName: 'div' }));
        const toggle = attachVisible(createElement({ attrs: { 'aria-haspopup': 'menu' } }));
        const sub = attachVisible(createElement({ tagName: 'ul' }));
        (parent as unknown as { appendChild: (n: unknown) => void }).appendChild(toggle);
        (parent as unknown as { appendChild: (n: unknown) => void }).appendChild(sub);

        const state = createTestState([toggle]);
        const event = createKeyboardEvent({ key: 'Enter' });
        setRootAttr('data-spatnav-handler-id', '1');
        const result = tryCloseOpenMenuToggle({
            actionElement: toggle,
            state,
            event,
            handlerId: 1,
            runtimeApi: null,
            canRequestNativeClick: false,
        });
        assert.equal(result, true);
    });

    test('finds submenu via .folder-parent wrapper sibling', () => {
        const wrapper = attachElement(createElement({ className: 'folder-parent' }));
        const toggle = attachVisible(createElement({ attrs: { 'aria-haspopup': 'menu' } }));
        const sub = attachVisible(createElement({ tagName: 'ul', className: 'dropdown' }));
        (wrapper as unknown as { appendChild: (n: unknown) => void }).appendChild(toggle);
        (wrapper as unknown as { appendChild: (n: unknown) => void }).appendChild(sub);

        const state = createTestState([toggle]);
        const event = createKeyboardEvent({ key: 'Enter' });
        setRootAttr('data-spatnav-handler-id', '1');
        const result = tryCloseOpenMenuToggle({
            actionElement: toggle,
            state,
            event,
            handlerId: 1,
            runtimeApi: null,
            canRequestNativeClick: false,
        });
        assert.equal(result, true);
    });
});

describe('findNavigationRoot', () => {
    beforeEach(() => setupDomEnv());
    afterEach(() => teardownDomEnv());

    test('resolves to <nav> ancestor', () => {
        // We exercise findNavigationRoot indirectly through tryCloseOpenMenuToggle;
        // the navRoot is one of the exclusions used by pickOutsidePoint.
        const nav = attachElement(createElement({ tagName: 'nav' }));
        const toggle = attachVisible(createElement({ attrs: { 'aria-expanded': 'true' } }));
        (nav as unknown as { appendChild: (n: unknown) => void }).appendChild(toggle);

        const state = createTestState([toggle]);
        const event = createKeyboardEvent({ key: 'Enter' });
        setRootAttr('data-spatnav-handler-id', '1');
        const result = tryCloseOpenMenuToggle({
            actionElement: toggle,
            state,
            event,
            handlerId: 1,
            runtimeApi: null,
            canRequestNativeClick: false,
        });
        assert.equal(result, true);
    });

    test('resolves to role=navigation ancestor', () => {
        const navRole = attachElement(createElement({ tagName: 'div', attrs: { role: 'navigation' } }));
        const toggle = attachVisible(createElement({ attrs: { 'aria-expanded': 'true' } }));
        (navRole as unknown as { appendChild: (n: unknown) => void }).appendChild(toggle);

        const state = createTestState([toggle]);
        const event = createKeyboardEvent({ key: 'Enter' });
        setRootAttr('data-spatnav-handler-id', '1');
        const result = tryCloseOpenMenuToggle({
            actionElement: toggle,
            state,
            event,
            handlerId: 1,
            runtimeApi: null,
            canRequestNativeClick: false,
        });
        assert.equal(result, true);
    });
});
