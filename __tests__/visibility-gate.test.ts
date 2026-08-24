/**
 * Tests for the modality visibility gate (v3.3.0).
 *
 * Root cause pinned here: on hybrid/touch hosts the ONLY thing hiding the
 * ring+chevron overlay during touch input was a `:host { opacity: 0 }`
 * stylesheet the WRAPPER injected via a `javascript:` URL — which page CSP
 * (YouTube Trusted-Types) blocks outright. With that injection blocked the
 * overlay had NO gate at all: the capture-phase `focus` listener painted
 * ring + chevrons on every tap-to-focus.
 *
 * The fix moves the gate INSIDE the extension, keyed on its own modality
 * state, with fail-safe polarity:
 *   1. `visibilityMode` defaults to `'hardware-nav-only'` (opt out with
 *      an explicit `'always'` — leanback/dpad hosts).
 *   2. `scheduleOverlayUpdate` refuses to show ring/previews while the
 *      last reported modality is not `'hardware-nav'`.
 *   3. The pointer watcher hides ring/previews on EVERY trusted pointer,
 *      even when modality is already `'touch'` (the old early-return
 *      skipped the hide in touch-only sessions).
 *   4. The overlay host carries extension-stamped `data-modality` /
 *      `data-ring` attributes so the shadow `:host(...)` CSS gate works
 *      with no wrapper round-trip (CSP-immune).
 *
 * Deliberate contract, pinned below: SYNTHETIC keydowns still flip
 * modality to `'hardware-nav'`. The AAOS receiver's LAN-remote D-pad
 * injects `isTrusted:false` keydowns (`_injectRemoteKeyJs`), and remote
 * navigation must keep its visible ring. A page dispatching fake keydowns
 * can therefore show the ring — strictly less exposure than the pre-fix
 * behavior where every tap showed it, and any trusted pointer event
 * immediately reverts to touch/hidden.
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
    setupDomEnv,
    teardownDomEnv,
    createTestState,
    createElement,
    createKeyboardEvent,
} from './helpers/dom_env';
import { getConfig } from '../core/config';
import { ensureOverlay, showOverlay, hideOverlay, setHostModality } from '../core/overlay';
import { scheduleOverlayUpdate } from '../utils/focus-helpers';
import { setupInputModalityWatcher } from '../core/modality_watcher';
import { handleKeyDown } from '../navigation/handlers';
import type { SpatialNavState } from '../core/state';

/**
 * happy-dom does not implement `isTrusted`; set it explicitly so the
 * production `isTrusted === false` filters are actually exercised (see
 * modality-watcher.test.ts for the original rationale).
 */
function setIsTrusted<T extends Event>(event: T, value: boolean): T {
    Object.defineProperty(event, 'isTrusted', { value, configurable: true });
    return event;
}

function overlayHost(): HTMLElement {
    const host = document.getElementById('spatnav-focus-host');
    assert.ok(host, 'overlay host must exist');
    return host as HTMLElement;
}

/** Build a state with a real shadow overlay attached to the test DOM. */
function stateWithOverlay(
    modality: 'touch' | 'hardware-nav',
    visibilityMode: 'hardware-nav-only' | 'always' = 'hardware-nav-only'
): SpatialNavState {
    const state = createTestState([], {}, { visibilityMode });
    state.lastReportedModality = modality;
    ensureOverlay(state.config, state);
    const host = overlayHost();
    const overlayEl = host.shadowRoot?.getElementById('spatnav-focus-overlay');
    assert.ok(overlayEl, 'shadow overlay must exist');
    state.overlay = overlayEl as HTMLElement;
    state.overlayHost = host;
    return state;
}

describe('visibilityMode default (config)', () => {
    beforeEach(() => setupDomEnv());
    afterEach(() => {
        delete globalThis.flutterSpatialNavConfig;
        teardownDomEnv();
    });

    test('defaults to hardware-nav-only (fail-safe polarity)', () => {
        delete globalThis.flutterSpatialNavConfig;
        assert.equal(getConfig().visibilityMode, 'hardware-nav-only');
    });

    test('explicit "always" still opts out (leanback/dpad hosts)', () => {
        globalThis.flutterSpatialNavConfig = { visibilityMode: 'always' };
        assert.equal(getConfig().visibilityMode, 'always');
    });
});

describe('scheduleOverlayUpdate modality gate', () => {
    beforeEach(() => setupDomEnv());
    afterEach(() => teardownDomEnv());

    test('touch modality + hardware-nav-only: overlay stays hidden, no update scheduled', () => {
        const state = stateWithOverlay('touch');
        state.overlay!.classList.add('visible');
        const target = createElement({ tagName: 'button', rect: { x: 0, y: 0, width: 100, height: 40 } });

        scheduleOverlayUpdate(target, state);

        assert.equal(state.updateTimer, null, 'no rAF update may be scheduled while gated');
        assert.equal(
            state.overlay!.classList.contains('visible'),
            false,
            'gate must hide a stale visible ring synchronously'
        );
        assert.equal(state.lastFocusedElement, target, 'focus tracking must survive the gate');
    });

    test('hardware-nav modality: update is scheduled normally', () => {
        const state = stateWithOverlay('hardware-nav');
        const target = createElement({ tagName: 'button', rect: { x: 0, y: 0, width: 100, height: 40 } });

        scheduleOverlayUpdate(target, state);

        assert.notEqual(state.updateTimer, null, 'show path must schedule the rAF update');
    });

    test('visibilityMode "always" bypasses the gate (dpad hosts keep current behavior)', () => {
        const state = stateWithOverlay('touch', 'always');
        const target = createElement({ tagName: 'button', rect: { x: 0, y: 0, width: 100, height: 40 } });

        scheduleOverlayUpdate(target, state);

        assert.notEqual(state.updateTimer, null, '"always" must not gate on modality');
    });
});

describe('pointer watcher always hides on trusted pointer', () => {
    beforeEach(() => setupDomEnv());
    afterEach(() => teardownDomEnv());

    test('trusted pointerdown hides ring even when modality is already touch', () => {
        const state = stateWithOverlay('touch');
        state.overlay!.classList.add('visible');
        const calls: string[] = [];
        setupInputModalityWatcher(state, (m) => calls.push(m));

        document.dispatchEvent(setIsTrusted(new Event('pointerdown', { bubbles: true }), true));

        assert.equal(
            state.overlay!.classList.contains('visible'),
            false,
            'hide must run on every trusted pointer, not only on modality transitions'
        );
        assert.deepEqual(calls, [], 'no postback when modality did not change');
        assert.equal(state.lastReportedModality, 'touch');
    });

    test('hardware-nav -> touch transition still posts back once and stamps the host', () => {
        const state = stateWithOverlay('hardware-nav');
        const calls: string[] = [];
        setupInputModalityWatcher(state, (m) => calls.push(m));

        document.dispatchEvent(setIsTrusted(new Event('pointerdown', { bubbles: true }), true));

        assert.deepEqual(calls, ['touch']);
        assert.equal(state.lastReportedModality, 'touch');
        assert.equal(overlayHost().getAttribute('data-modality'), 'touch');
    });

    test('synthetic pointer events stay filtered', () => {
        const state = stateWithOverlay('hardware-nav');
        state.overlay!.classList.add('visible');
        const calls: string[] = [];
        setupInputModalityWatcher(state, (m) => calls.push(m));

        document.dispatchEvent(setIsTrusted(new Event('pointerdown', { bubbles: true }), false));

        assert.deepEqual(calls, [], 'synthetic pointer must not post back');
        assert.equal(state.lastReportedModality, 'hardware-nav');
        assert.equal(
            state.overlay!.classList.contains('visible'),
            true,
            'synthetic pointer must not hide the ring (click-activation sequence)'
        );
    });
});

describe('host attribute stamping (CSS gate without the wrapper)', () => {
    beforeEach(() => setupDomEnv());
    afterEach(() => teardownDomEnv());

    test('ensureOverlay stamps current modality and data-ring=hidden', () => {
        const state = stateWithOverlay('touch');
        const host = overlayHost();
        assert.equal(host.getAttribute('data-modality'), 'touch');
        assert.equal(host.getAttribute('data-ring'), 'hidden');
    });

    test('ensureOverlay preserves hardware-nav modality across host re-creation', () => {
        const state = stateWithOverlay('hardware-nav');
        assert.equal(overlayHost().getAttribute('data-modality'), 'hardware-nav');
        // SPA-style re-init recreates the host; the stamp must survive.
        ensureOverlay(state.config, state);
        assert.equal(overlayHost().getAttribute('data-modality'), 'hardware-nav');
    });

    test('showOverlay/hideOverlay drive data-ring', () => {
        const state = stateWithOverlay('hardware-nav');
        const target = createElement({ tagName: 'button', rect: { x: 0, y: 0, width: 120, height: 40 } });

        showOverlay(target, state);
        assert.equal(overlayHost().getAttribute('data-ring'), 'visible');

        hideOverlay(state);
        assert.equal(overlayHost().getAttribute('data-ring'), 'hidden');
    });

    test('setHostModality is a safe no-op without a host', () => {
        document.getElementById('spatnav-focus-host')?.remove();
        assert.doesNotThrow(() => setHostModality('hardware-nav'));
    });
});

describe('keydown modality contract', () => {
    beforeEach(() => setupDomEnv());
    afterEach(() => teardownDomEnv());

    test('synthetic ArrowDown still flips modality to hardware-nav (LAN-remote injection contract)', () => {
        const btn = createElement({ tagName: 'button', rect: { x: 0, y: 60, width: 100, height: 30 } });
        const state = stateWithOverlay('touch');
        state.handlerId = 1;
        document.documentElement.setAttribute('data-spatnav-handler-id', '1');
        state.focusables = [];
        state.focusableElements = [btn];

        const event = createKeyboardEvent({ key: 'ArrowDown', timeStamp: 42 });
        setIsTrusted(event, false);
        handleKeyDown(event as unknown as KeyboardEvent, state);

        assert.equal(
            state.lastReportedModality,
            'hardware-nav',
            'remote-injected (synthetic) D-pad keys must keep engaging the ring'
        );
        assert.equal(overlayHost().getAttribute('data-modality'), 'hardware-nav');
    });
});
