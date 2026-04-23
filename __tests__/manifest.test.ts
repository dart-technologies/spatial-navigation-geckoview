/**
 * Tests for extension/manifest.json — permission surface and resource exposure.
 *
 * The manifest is part of the security boundary: anything in
 * `web_accessible_resources` is fetchable by any page on the host, and
 * any permission here is handed to the content script on every URL.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const manifestPath = resolve(here, '../extension/manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    permissions?: string[];
    web_accessible_resources?: string[];
    content_scripts?: Array<{ matches?: string[] }>;
};

describe('extension/manifest.json', () => {
    test('does not expose debug bundles to web pages', () => {
        const wars = manifest.web_accessible_resources ?? [];
        for (const entry of wars) {
            assert.ok(
                !/debug/i.test(entry),
                `web_accessible_resources must not expose debug bundles (found "${entry}")`
            );
        }
    });

    test('does not wildcard-expose JS to web pages', () => {
        const wars = manifest.web_accessible_resources ?? [];
        for (const entry of wars) {
            assert.ok(
                !/\*.*\.js$/i.test(entry),
                `web_accessible_resources must not wildcard-expose .js (found "${entry}")`
            );
        }
    });
});
