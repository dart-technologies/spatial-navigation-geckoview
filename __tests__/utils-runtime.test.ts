/**
 * Tests for utils/runtime.ts — platform detection and runtime-context build.
 *
 * Covers every branch of detectPlatform (5 platforms), detectRuntimeContext
 * (cross-product of hasBrowser/hasChrome × canConnect/canSendMessage), and
 * formatRuntimeLabel (3 label variants).
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { detectPlatform, detectRuntimeContext, formatRuntimeLabel } from '../utils/runtime';
import {
    installBrowserBridge,
    installChromeBridge,
    installReactNativeBridge,
    installWebkitBridge,
    installAndroidWebViewBridge,
    removeAllBridges,
} from './helpers/dom_env';

describe('detectPlatform', () => {
    afterEach(() => removeAllBridges());

    test('returns "standalone" with no host globals', () => {
        removeAllBridges();
        assert.equal(detectPlatform(), 'standalone');
    });

    test('returns "geckoview" when browser.runtime.connect exists', () => {
        installBrowserBridge({ connect: () => ({}) as unknown as never });
        assert.equal(detectPlatform(), 'geckoview');
    });

    test('returns "geckoview" when only browser.runtime.sendNativeMessage exists', () => {
        installBrowserBridge({
            connect: undefined,
            sendNativeMessage: async () => undefined,
        });
        assert.equal(detectPlatform(), 'geckoview');
    });

    test('returns "react-native" when ReactNativeWebView.postMessage exists', () => {
        installReactNativeBridge();
        assert.equal(detectPlatform(), 'react-native');
    });

    test('returns "wkwebview" when webkit.messageHandlers exists', () => {
        installWebkitBridge();
        assert.equal(detectPlatform(), 'wkwebview');
    });

    test('returns "android-webview" when SpatialNavBridge exists', () => {
        installAndroidWebViewBridge();
        assert.equal(detectPlatform(), 'android-webview');
    });

    test('geckoview takes precedence over later platforms', () => {
        installBrowserBridge({ connect: () => ({}) as unknown as never });
        installReactNativeBridge();
        installAndroidWebViewBridge();
        assert.equal(detectPlatform(), 'geckoview');
    });
});

describe('detectRuntimeContext', () => {
    afterEach(() => removeAllBridges());

    test('returns "injected" mode with no browser/chrome', () => {
        removeAllBridges();
        const ctx = detectRuntimeContext();
        assert.equal(ctx.mode, 'injected');
        assert.equal(ctx.hasBrowser, false);
        assert.equal(ctx.hasChrome, false);
        assert.equal(ctx.canConnect, false);
        assert.equal(ctx.canSendMessage, false);
    });

    test('reports webextension mode with browser.runtime.{connect,sendMessage}', () => {
        installBrowserBridge({ connect: () => ({}) as unknown as never });
        const ctx = detectRuntimeContext();
        assert.equal(ctx.mode, 'webextension');
        assert.equal(ctx.hasBrowser, true);
        assert.equal(ctx.canConnect, true);
        assert.equal(ctx.canSendMessage, true);
    });

    test('reports webextension when only chrome.runtime exists (no browser)', () => {
        installChromeBridge({ connect: () => ({}) as unknown as never });
        const ctx = detectRuntimeContext();
        assert.equal(ctx.mode, 'webextension');
        assert.equal(ctx.hasBrowser, false);
        assert.equal(ctx.hasChrome, true);
        assert.equal(ctx.canConnect, true);
    });

    test('canSendMessage false when sendMessage is not a function', () => {
        installBrowserBridge({ sendMessage: undefined });
        const ctx = detectRuntimeContext();
        assert.equal(ctx.canSendMessage, false);
    });
});

describe('formatRuntimeLabel', () => {
    test('webextension + bridge-on', () => {
        const label = formatRuntimeLabel({
            mode: 'webextension',
            hasBrowser: true,
            hasChrome: false,
            canConnect: true,
            canSendMessage: true,
        });
        assert.equal(label, 'WebExtension (bridge:on)');
    });

    test('webextension + bridge-off', () => {
        const label = formatRuntimeLabel({
            mode: 'webextension',
            hasBrowser: true,
            hasChrome: false,
            canConnect: false,
            canSendMessage: false,
        });
        assert.equal(label, 'WebExtension (bridge:off)');
    });

    test('injected mode', () => {
        const label = formatRuntimeLabel({
            mode: 'injected',
            hasBrowser: false,
            hasChrome: false,
            canConnect: false,
            canSendMessage: false,
        });
        assert.equal(label, 'Injected (no bridge)');
    });
});
