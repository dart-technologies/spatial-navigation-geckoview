/**
 * Tests for the user-config validator and the built-in presets.
 *
 * The validator is the system boundary between untrusted host config and
 * the rest of the engine — every type and enum check matters.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { validateUserConfig, applyPreset, CONFIG_PRESETS, getConfig, directionByName } from '../core/config';

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

    test('caps oversize virtualContainerSelectors array (DoS hardening)', () => {
        const flood = Array.from({ length: 500 }, (_, i) => `.sel-${i}`);
        const result = validateUserConfig({ virtualContainerSelectors: flood });
        assert.ok(result.virtualContainerSelectors !== undefined, 'flood is truncated, not dropped');
        assert.ok(
            (result.virtualContainerSelectors ?? []).length <= 32,
            `expected <= 32 items, got ${(result.virtualContainerSelectors ?? []).length}`
        );
    });

    test('drops oversize selector strings but keeps reasonable ones', () => {
        const huge = 'a'.repeat(500);
        const result = validateUserConfig({
            virtualContainerSelectors: ['.ok', huge, '[data-virtual]'],
        });
        assert.deepEqual(result.virtualContainerSelectors, ['.ok', '[data-virtual]']);
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

    test('does not throw on Object.prototype-chain keys (DoS hardening)', () => {
        // Without null-prototype on ENUM_KEYS, `'toString' in ENUM_KEYS`
        // resolves to Object.prototype.toString and ENUM_KEYS[key].has(value)
        // throws TypeError, propagating out of getConfig() and aborting init.
        // A page setting `JSON.parse('{"toString":"x"}')` could brick the
        // extension on its origin.
        for (const key of ['toString', 'hasOwnProperty', 'valueOf', 'constructor', 'isPrototypeOf']) {
            assert.doesNotThrow(() => {
                validateUserConfig({ [key]: 'x' });
            }, `key "${key}" must not throw via prototype chain`);
        }
    });

    test('clamps numeric values during validation (configUpdate path)', () => {
        // The configUpdate handler in main.ts validates inbound native config
        // and Object.assigns it onto state.config — without going through
        // getConfig's clamps. Validation-time clamps make this path safe.
        const result = validateUserConfig({
            overlayZIndex: -1,
            arrowScale: 1e6,
            safeAreaMargin: 99999,
            overlayGlowBlur: 10000,
            outlineWidth: 9999,
        });
        assert.equal(result.overlayZIndex, 1, 'overlayZIndex clamped up to min');
        assert.equal(result.arrowScale, 4, 'arrowScale clamped down to max');
        assert.equal(result.safeAreaMargin, 200, 'safeAreaMargin clamped down to max');
        assert.equal(result.overlayGlowBlur, 64, 'overlayGlowBlur clamped down to max');
        assert.equal(result.outlineWidth, 20, 'outlineWidth clamped down to max');
    });

    test('passes through in-range numeric values unchanged', () => {
        const result = validateUserConfig({
            overlayZIndex: 50,
            arrowScale: 1.25,
            safeAreaMargin: 24,
        });
        assert.equal(result.overlayZIndex, 50);
        assert.equal(result.arrowScale, 1.25);
        assert.equal(result.safeAreaMargin, 24);
    });

    test('clamps observer / timer / scoring numerics (3.1.0 hardening)', () => {
        // Before 3.1.0 these keys were typed-only — a page could ship
        // `mutationDebounce: Number.MAX_SAFE_INTEGER` and stall every
        // refresh, or `scrollThreshold: -Infinity` and break dirty-tracking.
        const result = validateUserConfig({
            mutationDebounce: 9_999_999,
            scrollThreshold: -1000,
            virtualScrollDebounce: 9_999_999,
            precomputeCacheTimeout: 9_999_999,
            overlapThreshold: 1e9,
            gridAlignmentTolerance: -50,
            minElementSize: 1e9,
        });
        assert.equal(result.mutationDebounce, 5_000, 'mutationDebounce clamped to 5s');
        assert.equal(result.scrollThreshold, 0, 'scrollThreshold clamped to 0');
        assert.equal(result.virtualScrollDebounce, 5_000);
        assert.equal(result.precomputeCacheTimeout, 60_000);
        assert.equal(result.overlapThreshold, 4_096);
        assert.equal(result.gridAlignmentTolerance, 0);
        assert.equal(result.minElementSize, 4_096);
    });

    test('iframeSupport nested validator drops unknown fields + bad focusMethod (3.1.0)', () => {
        const result = validateUserConfig({
            iframeSupport: {
                enabled: true,
                selector: 'iframe.embed',
                focusMethod: 'attacker-controlled-value',
                someExtraField: 'should be dropped',
            },
        });
        assert.deepEqual(result.iframeSupport, {
            enabled: true,
            selector: 'iframe.embed',
            // focusMethod dropped — not in {element, contentWindow}
            // someExtraField dropped — not in schema
        });
    });

    test('focusGroups nested validator drops unknown fields + bad boundaryBehavior (3.1.0)', () => {
        const result = validateUserConfig({
            focusGroups: {
                enabled: true,
                boundaryBehavior: 'evil',
                defaultRules: { foo: 'bar' },
                somethingElse: 42,
            },
        });
        assert.deepEqual(result.focusGroups, {
            enabled: true,
            defaultRules: { foo: 'bar' },
            // boundaryBehavior dropped — not in {wrap, stop, exit}
            // somethingElse dropped — not in schema
        });
    });

    test('focusGroups rejects non-object defaultRules (Array shape blocked)', () => {
        const result = validateUserConfig({
            focusGroups: {
                enabled: true,
                defaultRules: ['not', 'a', 'plain', 'object'],
            },
        });
        // defaultRules dropped because Array.isArray rejected it
        assert.deepEqual(result.focusGroups, { enabled: true });
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

describe('getConfig numeric clamping (hardening)', () => {
    test('overlayZIndex negative falls to min (overlay stays on top)', () => {
        clearGlobalConfig();
        globalScope.spatialNavConfig = { overlayZIndex: -1 };
        const cfg = getConfig();
        assert.equal(cfg.overlayZIndex, 1, 'negative clamped up to min, preserving focus visibility');
    });

    test('overlayZIndex above int32 clamped to max', () => {
        clearGlobalConfig();
        globalScope.spatialNavConfig = { overlayZIndex: Number.MAX_SAFE_INTEGER };
        const cfg = getConfig();
        assert.equal(cfg.overlayZIndex, 2147483646);
    });

    test('arrowScale extreme values clamped', () => {
        clearGlobalConfig();
        globalScope.spatialNavConfig = { arrowScale: 1e6 };
        assert.equal(getConfig().arrowScale, 4);

        clearGlobalConfig();
        globalScope.spatialNavConfig = { arrowScale: 0.0001 };
        assert.equal(getConfig().arrowScale, 0.1);

        clearGlobalConfig();
        globalScope.spatialNavConfig = { arrowScale: -5 };
        assert.equal(getConfig().arrowScale, 0.1);
    });

    test('safeAreaMargin huge value clamped (overlay stays on screen)', () => {
        clearGlobalConfig();
        globalScope.spatialNavConfig = { safeAreaMargin: 99999 };
        assert.equal(getConfig().safeAreaMargin, 200);
    });

    test('overlayGlowBlur huge value clamped (prevents paint DoS)', () => {
        clearGlobalConfig();
        globalScope.spatialNavConfig = { overlayGlowBlur: 10000 };
        assert.equal(getConfig().overlayGlowBlur, 64);
    });

    test('outlineWidth extreme values clamped', () => {
        clearGlobalConfig();
        globalScope.spatialNavConfig = { outlineWidth: 500 };
        assert.equal(getConfig().outlineWidth, 20);
    });

    test('NaN and Infinity fall to default', () => {
        clearGlobalConfig();
        // NaN/Infinity are filtered out by validateUserConfig's Number.isFinite check
        // (they never reach the clamp); belt-and-suspenders verify clamp handles them too.
        globalScope.spatialNavConfig = { overlayZIndex: NaN };
        assert.equal(getConfig().overlayZIndex, 2147483646);
    });
});

describe('directionByName prototype safety', () => {
    test('prototype-chain lookup returns undefined, not a function', () => {
        // Without a null prototype, `directionByName['__proto__']` would walk
        // up to Object.prototype and attackers could smuggle a non-Direction
        // value past `if (map[dir])` checks. Null prototype makes proto
        // lookups cleanly undefined.
        const map = directionByName as unknown as Record<string, unknown>;
        assert.equal(map['__proto__'], undefined, '__proto__ must not resolve');
        assert.equal(map['constructor'], undefined, 'constructor must not resolve');
        assert.equal(map['hasOwnProperty'], undefined, 'hasOwnProperty must not resolve');
        assert.equal(map['toString'], undefined, 'toString must not resolve');
    });

    test('legitimate direction keys still resolve', () => {
        assert.equal(directionByName['down'].name, 'down');
        assert.equal(directionByName['up'].name, 'up');
        assert.equal(directionByName['left'].name, 'left');
        assert.equal(directionByName['right'].name, 'right');
    });

    test('frozen map rejects mutation attempts', () => {
        // Strict mode throws on assignment to frozen; loose mode silently
        // fails. Either way the map remains unchanged.
        try {
            (directionByName as unknown as Record<string, unknown>)['evil'] = 'payload';
        } catch {
            // Expected in strict mode.
        }
        assert.equal((directionByName as unknown as Record<string, unknown>)['evil'], undefined);
    });
});
