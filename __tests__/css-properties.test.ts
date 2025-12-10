/**
 * Tests for CSS custom property integration
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';

import type { SpatialNavConfig } from '../core/config';
import type { NavContain, NavAction, NavFunction } from '../utils/css-properties';

// Mock types
interface MockElement {
    tagName: string;
    parentElement: null;
    contains: () => boolean;
}

interface MockDocument {
    documentElement: { tagName: string };
    createElement: (tag: string) => MockElement;
}

// Extend globalThis for test globals
declare global {
    // eslint-disable-next-line no-var
    var spatialNavConfig: Partial<SpatialNavConfig> | undefined;
    // eslint-disable-next-line no-var
    var flutterSpatialNavConfig: Partial<SpatialNavConfig> | undefined;
}

// Mock window and document before importing
globalThis.spatialNavConfig = {};
globalThis.flutterSpatialNavConfig = undefined;

// Mock CSS properties storage
const mockStyles = new Map<string, string>();

// Mock getComputedStyle
(globalThis as any).getComputedStyle = () => ({
    getPropertyValue: (prop: string) => mockStyles.get(prop) || ''
});

// Mock document
(globalThis as any).document = {
    documentElement: { tagName: 'HTML' },
    createElement: (tag: string): MockElement => ({
        tagName: tag.toUpperCase(),
        parentElement: null,
        contains: () => false
    })
};

import {
    getCSSNavContain,
    getCSSNavAction,
    getCSSNavFunction,
    getCSSNavProperties,
    getEffectiveScoringMode
} from '../utils/css-properties';

describe('CSS Custom Properties', () => {
    beforeEach(() => {
        mockStyles.clear();
        globalThis.spatialNavConfig = {};
    });

    it('getCSSNavContain returns auto by default', () => {
        const element = globalThis.document.createElement('div') as unknown as Element;
        const result = getCSSNavContain(element);
        assert.strictEqual(result, 'auto');
    });

    it('getCSSNavContain detects contain value', () => {
        mockStyles.set('--spatial-navigation-contain', 'contain');
        const element = globalThis.document.createElement('div') as unknown as Element;
        const result = getCSSNavContain(element);
        assert.strictEqual(result, 'contain');
    });

    it('getCSSNavAction returns auto by default', () => {
        const element = globalThis.document.createElement('div') as unknown as Element;
        const result = getCSSNavAction(element);
        assert.strictEqual(result, 'auto');
    });

    it('getCSSNavAction detects focus value', () => {
        mockStyles.set('--spatial-navigation-action', 'focus');
        const element = globalThis.document.createElement('div') as unknown as Element;
        const result = getCSSNavAction(element);
        assert.strictEqual(result, 'focus');
    });

    it('getCSSNavAction detects scroll value', () => {
        mockStyles.set('--spatial-navigation-action', 'scroll');
        const element = globalThis.document.createElement('div') as unknown as Element;
        const result = getCSSNavAction(element);
        assert.strictEqual(result, 'scroll');
    });

    it('getCSSNavFunction returns normal by default', () => {
        const element = globalThis.document.createElement('div') as unknown as Element;
        const result = getCSSNavFunction(element);
        assert.strictEqual(result, 'normal');
    });

    it('getCSSNavFunction detects grid value', () => {
        mockStyles.set('--spatial-navigation-function', 'grid');
        const element = globalThis.document.createElement('div') as unknown as Element;
        const result = getCSSNavFunction(element);
        assert.strictEqual(result, 'grid');
    });

    it('getCSSNavProperties returns all properties', () => {
        mockStyles.set('--spatial-navigation-contain', 'contain');
        mockStyles.set('--spatial-navigation-action', 'focus');
        mockStyles.set('--spatial-navigation-function', 'grid');

        const element = globalThis.document.createElement('div') as unknown as Element;
        const props = getCSSNavProperties(element);

        assert.strictEqual(props.contain, 'contain');
        assert.strictEqual(props.action, 'focus');
        assert.strictEqual(props.function, 'grid');
    });

    it('getEffectiveScoringMode respects CSS property', () => {
        mockStyles.set('--spatial-navigation-function', 'grid');

        const element = globalThis.document.createElement('div') as unknown as Element;
        const mode = getEffectiveScoringMode(element);
        assert.strictEqual(mode, 'grid');
    });

    it('getEffectiveScoringMode respects config override', () => {
        globalThis.spatialNavConfig = { scoringMode: 'grid' };
        mockStyles.clear(); // No CSS override

        const element = globalThis.document.createElement('div') as unknown as Element;
        const mode = getEffectiveScoringMode(element);
        assert.strictEqual(mode, 'grid');
    });

    it('returns defaults when useCSSProperties is false', () => {
        globalThis.spatialNavConfig = { useCSSProperties: false };
        mockStyles.set('--spatial-navigation-contain', 'contain');

        const element = globalThis.document.createElement('div') as unknown as Element;
        const props = getCSSNavProperties(element);

        assert.strictEqual(props.contain, 'auto');
    });
});
