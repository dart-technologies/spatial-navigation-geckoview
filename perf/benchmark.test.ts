/**
 * Performance benchmarks — separated from unit tests so they can be excluded
 * from `npm test` and run on demand via `npm run test:benchmark`.
 *
 * Targets: 1000-element pages should refresh in <200ms and resolve a
 * directional move in <50ms (loose CI thresholds).
 */

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
    setupDomEnv,
    teardownDomEnv,
    attachElement,
    createElement,
    createTestState,
    setActiveElement,
} from '../__tests__/helpers/dom_env';
import { refreshFocusables } from '../utils/dom';
import { moveInDirection } from '../navigation/movement';
import { directionByName } from '../core/config';

const COLUMNS = 10;
const ITEM_W = 100;
const ITEM_H = 50;
const GAP = 10;

function buildGrid(count: number): HTMLElement[] {
    const elements: HTMLElement[] = [];
    for (let i = 0; i < count; i++) {
        const col = i % COLUMNS;
        const row = Math.floor(i / COLUMNS);
        elements.push(
            attachElement(
                createElement({
                    tagName: 'button',
                    id: `item-${i}`,
                    rect: {
                        x: col * (ITEM_W + GAP),
                        y: row * (ITEM_H + GAP),
                        width: ITEM_W,
                        height: ITEM_H,
                    },
                })
            )
        );
    }
    return elements;
}

beforeEach(() => setupDomEnv());
afterEach(() => teardownDomEnv());

test('refreshFocusables: 1000 elements in <200ms', () => {
    const elements = buildGrid(1000);
    const state = createTestState();
    void elements;

    const start = performance.now();
    refreshFocusables(state);
    const duration = performance.now() - start;

    console.log(`[bench] refreshFocusables (1000): ${duration.toFixed(2)}ms`);
    assert.equal(state.focusables.length, 1000);
    assert.ok(duration < 200, `refreshFocusables took ${duration.toFixed(2)}ms (>200ms threshold)`);
});

test('moveInDirection: down across 1000-element grid in <50ms', () => {
    const elements = buildGrid(1000);
    const middle = elements[505]!;
    setActiveElement(middle);

    const state = createTestState();
    refreshFocusables(state);

    const start = performance.now();
    const moved = moveInDirection(directionByName.down, null, state);
    const duration = performance.now() - start;

    console.log(`[bench] moveInDirection down (1000): ${duration.toFixed(2)}ms`);
    assert.equal(moved, true);
    assert.equal((document.activeElement as HTMLElement).id, 'item-515');
    assert.ok(duration < 50, `moveInDirection took ${duration.toFixed(2)}ms (>50ms threshold)`);
});
