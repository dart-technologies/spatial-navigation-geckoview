/**
 * Tests for navigation/click_utils.ts — clampToViewport + pickClickPoint.
 *
 * happy-dom returns null for elementFromPoint (no layout), so pickClickPoint's
 * isHitWithinTarget(null, …) branch always wins and the fallback path is
 * reached. Tests pin THAT behavior.
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { clampToViewport, pickClickPoint } from '../navigation/click_utils';
import { setupDomEnv, teardownDomEnv, createElement, attachElement } from './helpers/dom_env';

describe('clampToViewport', () => {
    beforeEach(() => setupDomEnv({ innerWidth: 1920, innerHeight: 1080 }));
    afterEach(() => teardownDomEnv());

    test('clamps x and y into the [0, viewport-1] range', () => {
        assert.deepEqual(clampToViewport(-50, -100), { x: 0, y: 0 });
        assert.deepEqual(clampToViewport(5000, 5000), { x: 1919, y: 1079 });
        assert.deepEqual(clampToViewport(100, 200), { x: 100, y: 200 });
    });

    test('handles zero-viewport gracefully (Math.max floor)', () => {
        Object.defineProperty(window, 'innerWidth', { value: 0, configurable: true });
        Object.defineProperty(window, 'innerHeight', { value: 0, configurable: true });
        const out = clampToViewport(100, 100);
        // maxX = max(0, -1) = 0; clamp(100, 0, 0) = 0.
        assert.equal(out.x, 0);
        assert.equal(out.y, 0);
    });
});

describe('pickClickPoint', () => {
    beforeEach(() => setupDomEnv());
    afterEach(() => teardownDomEnv());

    test('returns center fallback when elementFromPoint returns null (happy-dom path)', () => {
        const target = attachElement(
            createElement({
                tagName: 'button',
                rect: { x: 100, y: 200, width: 100, height: 50 },
            })
        );
        const result = pickClickPoint(target);
        // Center of (100,200,100,50) is (150, 225). happy-dom returns null
        // from elementFromPoint, so the fallback path runs.
        assert.equal(result.label, 'center');
        assert.equal(result.x, 150);
        assert.equal(result.y, 225);
    });

    test('elementFromPoint returning the target itself wins on center', () => {
        const target = attachElement(
            createElement({
                tagName: 'button',
                rect: { x: 100, y: 200, width: 100, height: 50 },
            })
        );
        // Override elementFromPoint to return target on center, else null.
        document.elementFromPoint = (x, y) => {
            if (x === 150 && y === 225) return target;
            return null;
        };
        const result = pickClickPoint(target);
        assert.equal(result.label, 'center');
        assert.equal(result.hit, target);
    });

    test('descendant hit (target.contains) accepted', () => {
        const target = attachElement(
            createElement({
                tagName: 'button',
                rect: { x: 100, y: 200, width: 100, height: 50 },
            })
        );
        const child = createElement({ tagName: 'span' });
        (target as unknown as { appendChild: (n: unknown) => void }).appendChild(child);
        document.elementFromPoint = () => child;
        const result = pickClickPoint(target);
        assert.equal(result.hit, child);
    });
});
