/**
 * Tests for the focusable-candidate cap in utils/dom.ts.
 *
 * refreshFocusables runs getComputedStyle + geometry/group work per candidate,
 * so an uncapped candidate list is a DoS vector on a page that renders millions
 * of focusable elements. capFocusableNodes bounds the processing loop.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { capFocusableNodes, MAX_FOCUSABLE_NODES } from '../utils/dom';

describe('capFocusableNodes', () => {
    test('returns the same array reference when under the cap (no hot-path copy)', () => {
        const nodes = [1, 2, 3];
        assert.equal(capFocusableNodes(nodes, 10), nodes);
    });

    test('returns the same array reference exactly at the cap', () => {
        const nodes = [1, 2, 3];
        assert.equal(capFocusableNodes(nodes, 3), nodes);
    });

    test('truncates to the cap when over, returning a new array', () => {
        const nodes = [1, 2, 3, 4, 5];
        const out = capFocusableNodes(nodes, 2);
        assert.deepEqual(out, [1, 2]);
        assert.notEqual(out, nodes);
    });

    test('handles an empty list', () => {
        assert.deepEqual(capFocusableNodes([], 10), []);
    });

    test('defaults to MAX_FOCUSABLE_NODES when no max is given', () => {
        const nodes = new Array(MAX_FOCUSABLE_NODES + 5).fill(0);
        assert.equal(capFocusableNodes(nodes).length, MAX_FOCUSABLE_NODES);
    });

    test('MAX_FOCUSABLE_NODES is a finite, generously-sized positive bound', () => {
        assert.ok(Number.isFinite(MAX_FOCUSABLE_NODES));
        assert.ok(MAX_FOCUSABLE_NODES > 1000);
    });
});
