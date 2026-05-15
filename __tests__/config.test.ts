/**
 * Tests for config module
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { getConfig, updateConfig, type SpatialNavConfig } from '../core/config';

// Extend globalThis for test globals
declare global {
    var flutterSpatialNavConfig: Partial<SpatialNavConfig> | undefined;
}

test('getConfig provides defaults', () => {
    delete globalThis.flutterSpatialNavConfig;
    const config = getConfig();
    assert.equal(config.autoRefocus, true);
    assert.equal(config.refocusStrategy, 'closest');
    assert.equal(config.observeIntersection, false);
    assert.equal(config.intersectionRootMargin, '200px');
    assert.equal(config.iframeSupport.enabled, false);
    assert.equal(config.iframeSupport.selector, 'iframe');
    assert.equal(config.overlayTheme, 'default');
    assert.equal(config.safeAreaMargin, 12);
    assert.equal(config.overlayScrimOpacity, 0.06);
    assert.equal(config.overlayGlowOpacity, 0.35);
    assert.equal(config.overlayGlowBlur, 14);
    // Phase C M-4/M-5/M-7/M-8 defaults
    assert.equal(config.overlayInnerGlowOpacity, 0.16);
    assert.equal(config.visibilityMode, 'always');
    assert.equal(config.enableFocusPulse, false);
    assert.equal(config.boundaryScrollBehavior, 'scroll', 'default flipped to scroll-on-boundary in v3.1');
});

test('getConfig: overlayInnerGlowOpacity honors override + clamps', () => {
    globalThis.flutterSpatialNavConfig = { overlayInnerGlowOpacity: 0 };
    assert.equal(getConfig().overlayInnerGlowOpacity, 0);

    globalThis.flutterSpatialNavConfig = { overlayInnerGlowOpacity: 0.5 };
    assert.equal(getConfig().overlayInnerGlowOpacity, 0.5);

    // Out-of-range value is clamped to the range max, not dropped.
    globalThis.flutterSpatialNavConfig = { overlayInnerGlowOpacity: 2 };
    assert.equal(getConfig().overlayInnerGlowOpacity, 1);

    globalThis.flutterSpatialNavConfig = { overlayInnerGlowOpacity: -1 };
    assert.equal(getConfig().overlayInnerGlowOpacity, 0);

    // Non-numeric value falls back to default.
    globalThis.flutterSpatialNavConfig = {
        overlayInnerGlowOpacity: 'pink' as unknown as number,
    };
    assert.equal(getConfig().overlayInnerGlowOpacity, 0.16);
});

test('getConfig: visibilityMode "hardware-nav-only" is accepted', () => {
    globalThis.flutterSpatialNavConfig = { visibilityMode: 'hardware-nav-only' };
    assert.equal(getConfig().visibilityMode, 'hardware-nav-only');

    globalThis.flutterSpatialNavConfig = { visibilityMode: 'always' };
    assert.equal(getConfig().visibilityMode, 'always');

    // Unknown string falls back to default.
    globalThis.flutterSpatialNavConfig = {
        visibilityMode: 'something-else' as 'always',
    };
    assert.equal(getConfig().visibilityMode, 'always');
});

test('getConfig: enableFocusPulse must be exactly `true` to enable', () => {
    globalThis.flutterSpatialNavConfig = { enableFocusPulse: true };
    assert.equal(getConfig().enableFocusPulse, true);

    globalThis.flutterSpatialNavConfig = { enableFocusPulse: false };
    assert.equal(getConfig().enableFocusPulse, false);

    // Truthy non-boolean does NOT enable — strict equality with `true`.
    globalThis.flutterSpatialNavConfig = {
        enableFocusPulse: 1 as unknown as boolean,
    };
    assert.equal(getConfig().enableFocusPulse, false);
});

test('getConfig: boundaryScrollBehavior accepts scroll / exit / none', () => {
    globalThis.flutterSpatialNavConfig = { boundaryScrollBehavior: 'exit' };
    assert.equal(getConfig().boundaryScrollBehavior, 'exit');

    globalThis.flutterSpatialNavConfig = { boundaryScrollBehavior: 'scroll' };
    assert.equal(getConfig().boundaryScrollBehavior, 'scroll');

    globalThis.flutterSpatialNavConfig = { boundaryScrollBehavior: 'none' };
    assert.equal(getConfig().boundaryScrollBehavior, 'none');

    // Unknown string falls back to default (scroll).
    globalThis.flutterSpatialNavConfig = {
        boundaryScrollBehavior: 'weird' as 'scroll',
    };
    assert.equal(getConfig().boundaryScrollBehavior, 'scroll');
});

test('getConfig respects overrides', () => {
    globalThis.flutterSpatialNavConfig = {
        color: '#ffffff',
        autoRefocus: false,
        refocusStrategy: 'first',
        observeIntersection: true,
        intersectionRootMargin: '50px',
        intersectionThreshold: 0.5,
        iframeSupport: {
            enabled: true,
            selector: 'iframe.chat-frame',
            focusMethod: 'contentWindow',
        },
        overlayTheme: 'high-contrast',
        safeAreaMargin: 24,
        overlayScrimOpacity: 0,
        overlayGlowOpacity: 0.8,
        overlayGlowBlur: 20,
    };

    const config = getConfig();
    assert.equal(config.color, '#ffffff');
    assert.equal(config.autoRefocus, false);
    assert.equal(config.refocusStrategy, 'first');
    assert.equal(config.observeIntersection, true);
    assert.equal(config.intersectionRootMargin, '50px');
    assert.equal(config.intersectionThreshold, 0.5);
    assert.equal(config.iframeSupport.enabled, true);
    assert.equal(config.iframeSupport.selector, 'iframe.chat-frame');
    assert.equal(config.iframeSupport.focusMethod, 'contentWindow');
    assert.equal(config.overlayTheme, 'high-contrast');
    assert.equal(config.safeAreaMargin, 24);
    assert.equal(config.overlayScrimOpacity, 0);
    assert.equal(config.overlayGlowOpacity, 0.8);
    assert.equal(config.overlayGlowBlur, 20);
});

test('updateConfig merges with existing values', () => {
    delete globalThis.flutterSpatialNavConfig;
    updateConfig({ observeIntersection: true, autoRefocus: false });
    const config = getConfig();
    assert.equal(config.observeIntersection, true);
    assert.equal(config.autoRefocus, false);

    updateConfig({ autoRefocus: true });
    const updated = getConfig();
    assert.equal(updated.observeIntersection, true);
    assert.equal(updated.autoRefocus, true);
});
