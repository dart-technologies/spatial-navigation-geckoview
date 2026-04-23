/**
 * Tests for the user-config validator and the built-in presets.
 *
 * The validator is the system boundary between untrusted host config and
 * the rest of the engine — every type and enum check matters.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { validateUserConfig, applyPreset, CONFIG_PRESETS, getConfig } from '../core/config';

const globalScope = globalThis as { spatialNavConfig?: unknown; flutterSpatialNavConfig?: unknown };

function clearGlobalConfig(): void {
    delete globalScope.spatialNavConfig;
    delete globalScope.flutterSpatialNavConfig;
}

describe('validateUserConfig', () => {
    test('returns empty object for non-object input', () => {
        assert.deepEqual(validateUserConfig(null), {});
        assert.deepEqual(validateUserConfig(undefined), {});
        assert.deepEqual(validateUserConfig('a string'), {});
        assert.deepEqual(validateUserConfig(42), {});
        assert.deepEqual(validateUserConfig([]), {});
    });

    test('passes through valid string keys', () => {
        const result = validateUserConfig({ color: '#ff0000', intersectionRootMargin: '100px' });
        assert.equal(result.color, '#ff0000');
        assert.equal(result.intersectionRootMargin, '100px');
    });

    test('drops string keys with non-string values', () => {
        const result = validateUserConfig({ color: 12345, intersectionRootMargin: true });
        assert.equal(result.color, undefined);
        assert.equal(result.intersectionRootMargin, undefined);
    });

    test('passes through valid number keys', () => {
        const result = validateUserConfig({
            outlineWidth: 4,
            scrollThreshold: 16,
            arrowScale: 1.5,
        });
        assert.equal(result.outlineWidth, 4);
        assert.equal(result.scrollThreshold, 16);
        assert.equal(result.arrowScale, 1.5);
    });

    test('drops number keys with non-finite values', () => {
        const result = validateUserConfig({
            outlineWidth: '3',
            scrollThreshold: NaN,
            arrowScale: Infinity,
        });
        assert.equal(result.outlineWidth, undefined);
        assert.equal(result.scrollThreshold, undefined);
        assert.equal(result.arrowScale, undefined);
    });

    test('passes through valid boolean keys', () => {
        const result = validateUserConfig({ wrapNavigation: true, observeMutations: false });
        assert.equal(result.wrapNavigation, true);
        assert.equal(result.observeMutations, false);
    });

    test('drops boolean keys with non-boolean values', () => {
        const result = validateUserConfig({ wrapNavigation: 'true', observeMutations: 1 });
        assert.equal(result.wrapNavigation, undefined);
        assert.equal(result.observeMutations, undefined);
    });

    test('accepts valid enum values', () => {
        const result = validateUserConfig({
            scoringMode: 'grid',
            distanceFunction: 'manhattan',
            overlayTheme: 'high-contrast',
            refocusStrategy: 'first',
        });
        assert.equal(result.scoringMode, 'grid');
        assert.equal(result.distanceFunction, 'manhattan');
        assert.equal(result.overlayTheme, 'high-contrast');
        assert.equal(result.refocusStrategy, 'first');
    });

    test('rejects invalid enum values', () => {
        const result = validateUserConfig({
            scoringMode: 'fancy',
            distanceFunction: 'cosine',
            overlayTheme: 'rainbow',
            refocusStrategy: 'last',
        });
        assert.equal(result.scoringMode, undefined);
        assert.equal(result.distanceFunction, undefined);
        assert.equal(result.overlayTheme, undefined);
        assert.equal(result.refocusStrategy, undefined);
    });

    test('accepts string array for virtualContainerSelectors', () => {
        const result = validateUserConfig({
            virtualContainerSelectors: ['.foo', '[data-virtual]'],
        });
        assert.deepEqual(result.virtualContainerSelectors, ['.foo', '[data-virtual]']);
    });

    test('rejects array with non-string elements', () => {
        const result = validateUserConfig({
            virtualContainerSelectors: ['.foo', 42, '[data-virtual]'],
        });
        assert.equal(result.virtualContainerSelectors, undefined);
    });

    test('accepts nested objects for iframeSupport / focusGroups', () => {
        const result = validateUserConfig({
            iframeSupport: { enabled: true, selector: 'iframe.embed' },
            focusGroups: { enabled: true, boundaryBehavior: 'wrap' },
        });
        assert.deepEqual(result.iframeSupport, { enabled: true, selector: 'iframe.embed' });
        assert.deepEqual(result.focusGroups, { enabled: true, boundaryBehavior: 'wrap' });
    });

    test('drops unknown keys', () => {
        const result = validateUserConfig({
            color: '#000',
            totallyMadeUpKey: 'whatever',
        });
        assert.equal(result.color, '#000');
        assert.equal((result as Record<string, unknown>).totallyMadeUpKey, undefined);
    });

    test('rejects attacker-supplied nativeAppId (trust-boundary fix)', () => {
        // Web pages must not be able to redirect native messaging to an
        // attacker-registered app. nativeAppId is not part of the public
        // config surface — the validator drops it as an unknown key.
        const result = validateUserConfig({
            nativeAppId: 'attacker_registered_app',
            color: '#000',
        });
        assert.equal((result as Record<string, unknown>).nativeAppId, undefined);
        assert.equal(result.color, '#000');
    });
});

describe('applyPreset', () => {
    test('TV preset enables grid + larger overlay', () => {
        clearGlobalConfig();
        applyPreset('tv');
        const cfg = getConfig();
        assert.equal(cfg.scoringMode, 'grid');
        assert.equal(cfg.outlineWidth, 4);
        assert.equal(cfg.gridAlignmentTolerance, 40);
    });

    test('phone preset uses geometric + tighter alignment', () => {
        clearGlobalConfig();
        applyPreset('phone');
        const cfg = getConfig();
        assert.equal(cfg.scoringMode, 'geometric');
        assert.equal(cfg.gridAlignmentTolerance, 12);
    });

    test('kiosk preset enables wrap + ARIA', () => {
        clearGlobalConfig();
        applyPreset('kiosk');
        const cfg = getConfig();
        assert.equal(cfg.wrapNavigation, true);
        assert.equal(cfg.enableAria, true);
        assert.equal(cfg.announceNavigation, true);
    });

    test('user-set values win over preset defaults', () => {
        clearGlobalConfig();
        globalScope.spatialNavConfig = { color: '#abcdef' };
        applyPreset('tv');
        const cfg = getConfig();
        assert.equal(cfg.color, '#abcdef', 'user color preserved over preset');
        assert.equal(cfg.scoringMode, 'grid', 'preset still applied for unset keys');
    });

    test('overrides param wins over preset and user', () => {
        clearGlobalConfig();
        globalScope.spatialNavConfig = { color: '#userset' };
        applyPreset('tv', { color: '#override' });
        const cfg = getConfig();
        assert.equal(cfg.color, '#override');
    });

    test('unknown preset is a no-op (warns)', () => {
        clearGlobalConfig();
        applyPreset('does-not-exist' as never);
        const cfg = getConfig();
        assert.equal(cfg.scoringMode, 'geometric', 'config unchanged after invalid preset');
    });

    test('CONFIG_PRESETS exposes all four presets', () => {
        assert.equal(typeof CONFIG_PRESETS.tv, 'object');
        assert.equal(typeof CONFIG_PRESETS.phone, 'object');
        assert.equal(typeof CONFIG_PRESETS.tablet, 'object');
        assert.equal(typeof CONFIG_PRESETS.kiosk, 'object');
    });
});

describe('getConfig with default color', () => {
    test('default color clears WCAG 2.1 non-text contrast minimum vs white', () => {
        clearGlobalConfig();
        const cfg = getConfig();
        assert.equal(cfg.color, '#1565C0', 'default is contrast-safe blue, not amber');
    });
});
