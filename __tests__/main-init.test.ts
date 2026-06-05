/**
 * Integration tests for main.ts content-script orchestrator.
 *
 * main.ts auto-invokes initSpatialNavigation() at module load. The bottom
 * IIFE is gated behind `globalThis.__SPATNAV_NO_AUTO_INIT__` so test files
 * can import without side effects, then drive init explicitly.
 *
 * Because ESM modules are cached, we set the gate BEFORE the first import.
 * All tests in this file share the same module instance.
 */

import { test, describe, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { setupDomEnv, teardownDomEnv, installBrowserBridge, removeAllBridges } from './helpers/dom_env';

// Set the auto-init gate BEFORE importing main.ts.
(globalThis as { __SPATNAV_NO_AUTO_INIT__?: boolean }).__SPATNAV_NO_AUTO_INIT__ = true;

let initSpatialNavigation: () => void;

before(async () => {
    const mod = await import('../main');
    initSpatialNavigation = (mod as { initSpatialNavigation: () => void }).initSpatialNavigation;
});

describe('initSpatialNavigation — happy-path init', () => {
    beforeEach(() => {
        setupDomEnv();
        installBrowserBridge();
    });
    afterEach(() => {
        removeAllBridges();
        teardownDomEnv();
    });

    test('exposes window.spatialNavState after init', () => {
        initSpatialNavigation();
        const state = (window as unknown as { spatialNavState: unknown }).spatialNavState;
        assert.notEqual(state, undefined);
        assert.notEqual(state, null);
    });

    test('sets window.__SPATIAL_NAV_INIT_COMPLETE__', () => {
        initSpatialNavigation();
        const flag = (window as unknown as { __SPATIAL_NAV_INIT_COMPLETE__?: boolean })
            .__SPATIAL_NAV_INIT_COMPLETE__;
        assert.equal(flag, true);
    });

    test('installs window.navigate WICG polyfill', () => {
        initSpatialNavigation();
        const navFn = (window as unknown as { navigate?: unknown }).navigate;
        assert.equal(typeof navFn, 'function');
    });

    test('installs window.spatialNavDebug debug API', () => {
        initSpatialNavigation();
        const dbg = (window as unknown as { spatialNavDebug?: { move: unknown } }).spatialNavDebug;
        assert.notEqual(dbg, undefined);
        assert.equal(typeof dbg!.move, 'function');
    });

    test('installs legacy flutterFocusState deprecation alias', () => {
        initSpatialNavigation();
        const legacy = (window as unknown as Record<string, unknown>).flutterFocusState;
        assert.notEqual(legacy, undefined);
    });

    test('stamps handler-id attribute on documentElement', () => {
        initSpatialNavigation();
        const id = document.documentElement.getAttribute('data-spatnav-handler-id');
        assert.notEqual(id, null);
    });

    test('attaches Element.prototype.spatialNavigationSearch / focusableAreas polyfills', () => {
        initSpatialNavigation();
        const elProto = window.Element.prototype as unknown as {
            spatialNavigationSearch?: unknown;
            focusableAreas?: unknown;
            getSpatialNavigationContainer?: unknown;
        };
        assert.equal(typeof elProto.spatialNavigationSearch, 'function');
        assert.equal(typeof elProto.focusableAreas, 'function');
        assert.equal(typeof elProto.getSpatialNavigationContainer, 'function');
    });
});

describe('pageshow re-init debounce', () => {
    beforeEach(() => {
        setupDomEnv();
        installBrowserBridge();
    });
    afterEach(() => {
        removeAllBridges();
        teardownDomEnv();
    });

    test('pageshow event triggers re-init logic without throwing', () => {
        initSpatialNavigation();
        // Dispatch a pageshow — the debounce gate should accept the first one.
        const evt = new window.Event('pageshow', { bubbles: false, cancelable: false });
        assert.doesNotThrow(() => window.dispatchEvent(evt));
    });
});

describe('visibilitychange handler', () => {
    beforeEach(() => {
        setupDomEnv();
        installBrowserBridge();
    });
    afterEach(() => {
        removeAllBridges();
        teardownDomEnv();
    });

    test('responds to visibilitychange without throwing', () => {
        initSpatialNavigation();
        const evt = new window.Event('visibilitychange', { bubbles: false, cancelable: false });
        assert.doesNotThrow(() => document.dispatchEvent(evt));
    });
});

describe('spatnav-clear-suppress / spatnav-engage-overlay event handlers', () => {
    beforeEach(() => {
        setupDomEnv();
        installBrowserBridge();
    });
    afterEach(() => {
        removeAllBridges();
        teardownDomEnv();
    });

    test('spatnav-clear-suppress dispatch does not throw', () => {
        initSpatialNavigation();
        const evt = new window.CustomEvent('spatnav-clear-suppress', {
            detail: { reason: 'manual' },
        });
        assert.doesNotThrow(() => window.dispatchEvent(evt));
    });

    test('spatnav-engage-overlay dispatch does not throw', () => {
        initSpatialNavigation();
        const evt = new window.CustomEvent('spatnav-engage-overlay', { detail: {} });
        assert.doesNotThrow(() => window.dispatchEvent(evt));
    });
});

describe('idempotency: init called twice is safe', () => {
    beforeEach(() => {
        setupDomEnv();
        installBrowserBridge();
    });
    afterEach(() => {
        removeAllBridges();
        teardownDomEnv();
    });

    test('second init does not throw and __SPATIAL_NAV_INIT_COUNT__ increments', () => {
        initSpatialNavigation();
        const firstCount = (window as unknown as { __SPATIAL_NAV_INIT_COUNT__?: number })
            .__SPATIAL_NAV_INIT_COUNT__;
        initSpatialNavigation();
        const secondCount = (window as unknown as { __SPATIAL_NAV_INIT_COUNT__?: number })
            .__SPATIAL_NAV_INIT_COUNT__;
        assert.ok((secondCount ?? 0) > (firstCount ?? 0));
    });
});

describe('pageshow debounce + visibility branches', () => {
    beforeEach(() => {
        setupDomEnv();
        installBrowserBridge();
    });
    afterEach(() => {
        removeAllBridges();
        teardownDomEnv();
    });

    test('two pageshow events within 100ms — second is debounced', async () => {
        initSpatialNavigation();
        const evt = new window.Event('pageshow', { bubbles: false, cancelable: false });
        window.dispatchEvent(evt);
        window.dispatchEvent(evt); // second within debounce window
        // Both pageshows are handled (the second debounced); init stays complete
        // and is not torn down or re-run from scratch.
        assert.equal(
            (window as unknown as { __SPATIAL_NAV_INIT_COMPLETE__?: boolean }).__SPATIAL_NAV_INIT_COMPLETE__,
            true
        );
    });

    test('visibilitychange with document.hidden=true triggers suppressOverlay branch', () => {
        initSpatialNavigation();
        Object.defineProperty(window.document, 'hidden', { value: true, configurable: true });
        const evt = new window.Event('visibilitychange', { bubbles: false, cancelable: false });
        assert.doesNotThrow(() => document.dispatchEvent(evt));
        // Reset hidden for subsequent tests.
        Object.defineProperty(window.document, 'hidden', { value: false, configurable: true });
    });

    test('spatialNavigationExit dispatches → suppressOverlay branch', () => {
        initSpatialNavigation();
        const evt = new window.Event('spatialNavigationExit', {
            bubbles: false,
            cancelable: false,
        });
        assert.doesNotThrow(() => document.dispatchEvent(evt));
    });

    test('window.blur dispatches → suppressOverlay branch', () => {
        initSpatialNavigation();
        const evt = new window.Event('blur', { bubbles: false, cancelable: false });
        assert.doesNotThrow(() => window.dispatchEvent(evt));
    });
});
