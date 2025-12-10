/**
 * Performance Benchmarks for Spatial Navigation
 *
 * Tests performance with large DOM trees (1000+ elements).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import type { SpatialNavState, FocusableEntry } from '../core/state';
import { setupMockEnv as setupBaseMockEnv } from './helpers/mock_env';

// === Mock Setup (duplicated from movement.test.ts for isolation) ===

class MockHTMLElementImpl {
    nodeType = 1;
    tagName = 'BUTTON';
    id = '';
    className = '';
    disabled = false;
    style = { visibility: 'visible', display: 'block' };
    parentElement: MockHTMLElementImpl | null = null;

    constructor(id: string) {
        this.id = id;
    }

    focus() {
        (document as any).activeElement = this;
    }

    getBoundingClientRect() {
        // Mock layout in a grid: 10 columns
        const idx = parseInt(this.id.replace('item-', ''), 10);
        const col = idx % 10;
        const row = Math.floor(idx / 10);
        const w = 100;
        const h = 50;
        const gap = 10;

        return {
            left: col * (w + gap),
            top: row * (h + gap),
            right: col * (w + gap) + w,
            bottom: row * (h + gap) + h,
            width: w,
            height: h,
            x: col * (w + gap),
            y: row * (h + gap),
            toJSON: () => ({})
        } as DOMRect;
    }

    hasAttribute(): boolean { return false; }
    getAttribute(): string | null { return null; }
    dispatchEvent(): boolean { return true; }

    // DOM traversal methods required by refreshFocusables
    closest(_selector: string): MockHTMLElementImpl | null {
        return null;
    }

    matches(_selector: string): boolean {
        return false;
    }

    querySelector(_selector: string): MockHTMLElementImpl | null {
        return null;
    }
}

function setupBenchmarkEnv() {
    setupBaseMockEnv({
        navigatorUserAgent: 'node',
        HTMLElement: MockHTMLElementImpl as unknown as typeof HTMLElement,
    });
}

// === Tests ===

test('Benchmark: refreshFocusables with 1000 elements', async (t) => {
    setupBenchmarkEnv();

    // Create 1000 elements
    const elements: MockHTMLElementImpl[] = [];
    for (let i = 0; i < 1000; i++) {
        elements.push(new MockHTMLElementImpl(`item-${i}`));
    }

    // Mock querySelectorAll to return these elements
    (globalThis as any).document.querySelectorAll = () => elements;

    // Load module
    const { refreshFocusables } = await import('../utils/dom');

    // Init state
    const state = {
        config: {
            observeMutations: false,
            iframeSupport: { enabled: false }
        },
        focusables: [],
        focusableElements: [],
        focusGroups: {},
        scrollCache: new Map()
    } as unknown as SpatialNavState;

    // Measure time
    const start = performance.now();
    refreshFocusables(state);
    const end = performance.now();
    const duration = end - start;

    console.log(`[Benchmark] refreshFocusables (1000 items): ${duration.toFixed(2)}ms`);

    assert.equal(state.focusables.length, 1000);
    // Threshold: should be fast (e.g., < 50ms on dev machine, loosen for CI)
    assert.ok(duration < 200, 'refreshFocusables took too long');
});

test('Benchmark: spatial navigation search with 1000 elements', async (t) => {
    setupBenchmarkEnv();

    // Create 1000 elements
    const elements: MockHTMLElementImpl[] = [];
    for (let i = 0; i < 1000; i++) {
        elements.push(new MockHTMLElementImpl(`item-${i}`));
    }

    // Mock active element at index 505 (middle)
    const active = elements[505];
    active.focus();

    const { refreshFocusables } = await import('../utils/dom');
    const { moveInDirection } = await import('../navigation/movement');
    const { directionByName } = await import('../core/config');

    const state = {
        config: {
            observeMutations: false,
            iframeSupport: { enabled: false }
        },
        focusables: [],
        focusableElements: [],
        focusGroups: {},
        scrollCache: new Map(),
        lastFocusedElement: null
    } as unknown as SpatialNavState;

    // Pre-populate state
    (globalThis as any).document.querySelectorAll = () => elements;
    refreshFocusables(state);

    // Measure move time (finding 'down' candidate)
    const start = performance.now();
    const result = moveInDirection(directionByName['down'], null, state);
    const end = performance.now();
    const duration = end - start;

    console.log(`[Benchmark] moveInDirection (1000 items): ${duration.toFixed(2)}ms`);

    assert.equal(result, true);
    // The target should be item 515 (505 + 10 columns)
    const focusedId = (document.activeElement as any).id;
    assert.equal(focusedId, 'item-515');

    assert.ok(duration < 50, 'Navigation logic took too long');
});
