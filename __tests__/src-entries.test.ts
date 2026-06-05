/**
 * Smoke tests for the subpath bundle entries (src/core-entry.ts,
 * src/messaging-entry.ts) and barrel files (core/index.ts).
 *
 * These files are pure re-exports; importing them and asserting the public
 * surface is intact keeps them from registering as zero-coverage in lcov.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

describe('src/core-entry barrel', () => {
    test('re-exports core algorithms and types', async () => {
        const mod = await import('../src/core-entry');
        // Spot-check the major surface area expected by `/core` subpath consumers.
        assert.equal(typeof (mod as { getConfig?: unknown }).getConfig, 'function');
        assert.equal(typeof (mod as { getState?: unknown }).getState, 'function');
        assert.equal(
            typeof (mod as { findDirectionalCandidate?: unknown }).findDirectionalCandidate,
            'function'
        );
        assert.equal(typeof (mod as { FocusGroup?: unknown }).FocusGroup, 'function');
    });
});

describe('src/messaging-entry barrel', () => {
    test('re-exports messaging adapters and factory', async () => {
        const mod = await import('../src/messaging-entry');
        assert.equal(typeof (mod as { createMessagingAdapter?: unknown }).createMessagingAdapter, 'function');
        assert.equal(typeof (mod as { detectPlatform?: unknown }).detectPlatform, 'function');
        assert.equal(
            typeof (mod as { GeckoViewMessagingAdapter?: unknown }).GeckoViewMessagingAdapter,
            'function'
        );
        assert.equal(typeof (mod as { NoopMessagingAdapter?: unknown }).NoopMessagingAdapter, 'function');
    });
});

describe('core/index.ts barrel', () => {
    test('exposes config + state + scoring + focus_group exports', async () => {
        const mod = await import('../core/index');
        assert.equal(typeof (mod as { getConfig?: unknown }).getConfig, 'function');
        assert.equal(typeof (mod as { getState?: unknown }).getState, 'function');
        assert.equal(typeof (mod as { FocusGroup?: unknown }).FocusGroup, 'function');
        assert.equal(typeof (mod as { showOverlay?: unknown }).showOverlay, 'function');
    });
});
