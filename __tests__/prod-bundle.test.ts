/**
 * Regression test (MEDIUM): the production bundle must NOT ship the debug API.
 *
 * `initDebugApi` installs page-callable `window.spatialNavDebug` /
 * `flutterFocusDebug` and writes focused-element descriptions into
 * `document.title`. It is now gated behind build-time `DEBUG` in main.ts, so
 * Terser dead-code-eliminates it from the release bundle. This test reads the
 * committed prod bundle and asserts those symbols are gone — mirrors the
 * manifest-lint approach (a committed `extension/` artifact treated as part of
 * the security boundary). Run after `npm run build:all`.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const prodBundle = readFileSync(resolve(here, '../extension/spatial_navigation.js'), 'utf8');

describe('production bundle — debug API stripped (M2)', () => {
    // Global property names and title-channel literals Terser cannot rename;
    // if initDebugApi shipped, these strings would be present (they were in the
    // pre-fix bundle).
    const bannedSymbols = [
        'spatialNavDebug',
        'flutterFocusDebug',
        'spatialNavInstrumentation',
        'spatialNavPerf',
        'focusDebugMove',
        'focusInstrumentation',
        'focusPreviewToggle',
    ];

    for (const symbol of bannedSymbols) {
        test(`prod bundle does not contain "${symbol}"`, () => {
            assert.ok(
                !prodBundle.includes(symbol),
                `"${symbol}" found in extension/spatial_navigation.js — initDebugApi must be DEBUG-gated and rebuilt`
            );
        });
    }
});
