/**
 * Tests for findWrapCandidate via moveInDirection (when wrapNavigation
 * config is enabled). This is the only path that exercises core/scoring.ts
 * lines 418-502 (findWrapCandidate implementation) and 407-409 (wrap
 * dispatch from findDirectionalCandidate).
 *
 * Driving via moveInDirection avoids the recursion-into-calculateVisualRect
 * crash that bare findWrapCandidate triggered under happy-dom.
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { moveInDirection } from '../navigation/movement';
import {
    setupDomEnv,
    teardownDomEnv,
    createTestState,
    setActiveElement,
    createVisibleButton,
} from './helpers/dom_env';
import type { Direction, SpatialNavConfig } from '../core/config';

const RIGHT: Direction = { axis: 'x', sign: 1, name: 'right' };
const LEFT: Direction = { axis: 'x', sign: -1, name: 'left' };
const DOWN: Direction = { axis: 'y', sign: 1, name: 'down' };
const UP: Direction = { axis: 'y', sign: -1, name: 'up' };

function btn(x: number, y: number, w = 80, h = 30): HTMLElement {
    return createVisibleButton({ x, y, width: w, height: h });
}

// findDirectionalCandidate reads wrapNavigation via getConfig() which pulls
// from globalThis.spatialNavConfig — set there, not on the state config.
declare global {
    var spatialNavConfig: Partial<SpatialNavConfig> | undefined;
}

describe('wrapNavigation (findWrapCandidate via moveInDirection)', () => {
    beforeEach(() => {
        setupDomEnv();
        globalThis.spatialNavConfig = { wrapNavigation: true };
    });
    afterEach(() => {
        globalThis.spatialNavConfig = undefined;
        teardownDomEnv();
    });

    test('RIGHT at rightmost element wraps to leftmost', () => {
        const left = btn(50, 100);
        const right = btn(800, 100);
        setActiveElement(right);
        const state = createTestState([left, right], {}, { wrapNavigation: true });
        const moved = moveInDirection(RIGHT, null, state);
        assert.equal(moved, true);
        assert.equal(window.document.activeElement, left);
    });

    test('LEFT at leftmost wraps to rightmost', () => {
        const left = btn(50, 100);
        const right = btn(800, 100);
        setActiveElement(left);
        const state = createTestState([left, right], {}, { wrapNavigation: true });
        const moved = moveInDirection(LEFT, null, state);
        assert.equal(moved, true);
        assert.equal(window.document.activeElement, right);
    });

    test('DOWN at bottommost wraps to topmost', () => {
        const top = btn(100, 50);
        const bottom = btn(100, 500);
        setActiveElement(bottom);
        const state = createTestState([top, bottom], {}, { wrapNavigation: true });
        const moved = moveInDirection(DOWN, null, state);
        assert.equal(moved, true);
        assert.equal(window.document.activeElement, top);
    });

    test('UP at topmost wraps to bottommost', () => {
        const top = btn(100, 50);
        const bottom = btn(100, 500);
        setActiveElement(top);
        const state = createTestState([top, bottom], {}, { wrapNavigation: true });
        const moved = moveInDirection(UP, null, state);
        assert.equal(moved, true);
        assert.equal(window.document.activeElement, bottom);
    });

    test('grid-mode wrap: aligned candidate beats unaligned closer one', () => {
        globalThis.spatialNavConfig = {
            wrapNavigation: true,
            scoringMode: 'grid',
            gridAlignmentTolerance: 5,
        };
        const aligned = btn(50, 100);
        const unaligned = btn(50, 200);
        const source = btn(800, 100);
        setActiveElement(source);
        const state = createTestState(
            [aligned, unaligned, source],
            {},
            { wrapNavigation: true, scoringMode: 'grid', gridAlignmentTolerance: 5 }
        );
        const moved = moveInDirection(RIGHT, null, state);
        assert.equal(moved, true);
        assert.equal(window.document.activeElement, aligned);
    });
});
