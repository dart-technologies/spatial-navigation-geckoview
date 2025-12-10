/**
 * Tests for config module
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { getConfig, updateConfig, type SpatialNavConfig } from '../core/config';

// Extend globalThis for test globals
declare global {
    // eslint-disable-next-line no-var
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
            focusMethod: 'contentWindow'
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
