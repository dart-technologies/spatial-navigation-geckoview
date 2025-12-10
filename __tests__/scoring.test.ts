/**
 * Tests for scoring algorithm enhancements
 * - Grid mode
 * - Distance functions
 * - Overlap threshold
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';

import type { SpatialNavConfig, Direction } from '../core/config';
import type { FocusableEntry } from '../core/state';

// Extend globalThis for test globals
declare global {
    // eslint-disable-next-line no-var
    var spatialNavConfig: Partial<SpatialNavConfig> | undefined;
    // eslint-disable-next-line no-var
    var flutterSpatialNavConfig: Partial<SpatialNavConfig> | undefined;
    // eslint-disable-next-line no-var
    var innerWidth: number;
    // eslint-disable-next-line no-var
    var innerHeight: number;
}

// Mock window before importing scoring
// In Node.js, globalThis is used since window doesn't exist
globalThis.spatialNavConfig = {};
globalThis.flutterSpatialNavConfig = undefined;
globalThis.innerWidth = 1920;
globalThis.innerHeight = 1080;

// Import after mocking
import { calculateDistance, isGridAligned, computeDirectionalMetrics } from '../core/scoring';
import { getConfig, updateConfig } from '../core/config';

// Types for test data
interface RectLike {
    top: number;
    bottom: number;
    left: number;
    right: number;
}

interface DirectionLike {
    axis: 'x' | 'y';
    sign: 1 | -1;
    name: string;
}

function makeEntry(rect: RectLike): FocusableEntry {
    return {
        element: {} as unknown as HTMLElement,
        rect: null,
        width: rect.right - rect.left,
        height: rect.bottom - rect.top,
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        centerX: (rect.left + rect.right) / 2,
        centerY: (rect.top + rect.bottom) / 2,
        scrollKey: null,
        groupId: null,
        index: 0,
    };
}

describe('calculateDistance', () => {
    it('calculates euclidean distance correctly', () => {
        const distance = calculateDistance(3, 4, 'euclidean', null);
        assert.strictEqual(distance, 5); // 3-4-5 triangle
    });

    it('calculates manhattan distance correctly', () => {
        const distance = calculateDistance(3, 4, 'manhattan', null);
        assert.strictEqual(distance, 7); // |3| + |4|
    });

    it('calculates projected distance correctly', () => {
        const direction: DirectionLike = { axis: 'x', sign: 1, name: 'right' };
        const distance = calculateDistance(10, 4, 'projected', direction as Direction);
        // primary (10) + secondary (4) * 0.5 = 12
        assert.strictEqual(distance, 12);
    });

    it('uses euclidean as default', () => {
        const distance = calculateDistance(3, 4, undefined, null);
        assert.strictEqual(distance, 5);
    });
});

describe('isGridAligned', () => {
    it('detects horizontal grid alignment', () => {
        const current = makeEntry({ top: 100, bottom: 150, left: 0, right: 100 });
        const candidate = makeEntry({ top: 105, bottom: 155, left: 200, right: 300 });
        const direction: DirectionLike = { axis: 'x', sign: 1, name: 'right' };

        const result = isGridAligned(current, candidate, direction as Direction, 20);
        assert.strictEqual(result, true); // Mid-Y difference is 5px, within 20px tolerance
    });

    it('rejects mis-aligned horizontal elements', () => {
        const current = makeEntry({ top: 100, bottom: 150, left: 0, right: 100 });
        const candidate = makeEntry({ top: 200, bottom: 250, left: 200, right: 300 });
        const direction: DirectionLike = { axis: 'x', sign: 1, name: 'right' };

        const result = isGridAligned(current, candidate, direction as Direction, 20);
        assert.strictEqual(result, false); // Mid-Y difference is 50px, outside 20px
    });

    it('detects vertical grid alignment', () => {
        const current = makeEntry({ top: 0, bottom: 100, left: 100, right: 200 });
        const candidate = makeEntry({ top: 200, bottom: 300, left: 95, right: 195 });
        const direction: DirectionLike = { axis: 'y', sign: 1, name: 'down' };

        const result = isGridAligned(current, candidate, direction as Direction, 20);
        assert.strictEqual(result, true); // Mid-X difference is 5px
    });
});

describe('getConfig options', () => {
    beforeEach(() => {
        // Reset all config values to defaults
        globalThis.spatialNavConfig = undefined;
        globalThis.flutterSpatialNavConfig = undefined;
    });

    it('provides expected defaults', () => {
        const config = getConfig();
        assert.strictEqual(config.scoringMode, 'geometric');
        assert.strictEqual(config.distanceFunction, 'euclidean');
        assert.strictEqual(config.overlapThreshold, 0);
        assert.strictEqual(config.gridAlignmentTolerance, 20);
        assert.strictEqual(config.wrapNavigation, false);
        assert.strictEqual(config.useCSSProperties, true);
    });

    it('respects grid mode override', () => {
        globalThis.spatialNavConfig = { scoringMode: 'grid' };
        const config = getConfig();
        assert.strictEqual(config.scoringMode, 'grid');
    });

    it('respects overlap threshold override', () => {
        globalThis.spatialNavConfig = { overlapThreshold: 10 };
        const config = getConfig();
        assert.strictEqual(config.overlapThreshold, 10);
    });

    it('respects distance function override', () => {
        globalThis.spatialNavConfig = { distanceFunction: 'manhattan' };
        const config = getConfig();
        assert.strictEqual(config.distanceFunction, 'manhattan');
    });

    it('supports legacy flutterSpatialNavConfig', () => {
        globalThis.flutterSpatialNavConfig = { color: '#00FF00' };
        const config = getConfig();
        assert.strictEqual(config.color, '#00FF00');
    });

    it('respects wrapNavigation override', () => {
        globalThis.spatialNavConfig = { wrapNavigation: true };
        const config = getConfig();
        assert.strictEqual(config.wrapNavigation, true);
    });
});

describe('findWrapCandidate', () => {
    // Note: Testing findWrapCandidate requires a full DOM mock
    // These tests verify the function is exported correctly
    it('is exported from scoring module', async () => {
        const scoring = await import('../core/scoring');
        assert.strictEqual(typeof scoring.findWrapCandidate, 'function');
    });
});
