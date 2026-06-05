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
    var spatialNavConfig: Partial<SpatialNavConfig> | undefined;

    var flutterSpatialNavConfig: Partial<SpatialNavConfig> | undefined;
}

// Mock window and document before importing
globalThis.spatialNavConfig = {};
globalThis.flutterSpatialNavConfig = undefined;

// Mock CSS properties storage
const mockStyles = new Map<string, string>();

// Mock getComputedStyle
(globalThis as any).getComputedStyle = () => ({
    getPropertyValue: (prop: string) => mockStyles.get(prop) || '',
});

// Mock document
(globalThis as any).document = {
    documentElement: { tagName: 'HTML' },
    createElement: (tag: string): MockElement => ({
        tagName: tag.toUpperCase(),
        parentElement: null,
        contains: () => false,
    }),
};

import {
    getCSSNavContain,
    getCSSNavAction,
    getCSSNavFunction,
    getCSSNavProperties,
    getEffectiveScoringMode,
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

// ---------------------------------------------------------------------------
// CSS Scroll Snap (parseScrollSnapType / getScrollSnapInfo / findScrollSnapContainer /
// getSnapPoints / shouldUseGridForScrollSnap / getScrollOptionsForSnapElement)
// ---------------------------------------------------------------------------

import {
    getScrollSnapInfo,
    getScrollSnapAlign,
    findScrollSnapContainer,
    getSnapPoints,
    shouldUseGridForScrollSnap,
    getScrollOptionsForSnapElement,
    findNavigationContainer,
    hasNavigationContainment,
} from '../utils/css-properties';

// Per-element style store keyed by reference. Allows different elements to
// report different computed styles within the same test, which the chain-walking
// helpers (findScrollSnapContainer) require.
const elementStyles = new WeakMap<object, Record<string, string>>();
const origGetComputedStyle = (globalThis as { getComputedStyle?: (el: unknown) => unknown }).getComputedStyle;

function setStyles(el: object, styles: Record<string, string>): void {
    elementStyles.set(el, styles);
}

function snapStyleProxy() {
    return (el: object) => {
        const map = elementStyles.get(el) ?? {};
        return {
            scrollSnapType: map['scroll-snap-type'] || '',
            scrollSnapAlign: map['scroll-snap-align'] || '',
            getPropertyValue: (prop: string) => map[prop] || mockStyles.get(prop) || '',
        };
    };
}

interface MockSnapElement {
    tagName: string;
    id: string;
    parentElement: MockSnapElement | null;
    children: MockSnapElement[];
    querySelectorAll: (sel: string) => MockSnapElement[];
}

function makeSnapElement(tag: string, id = ''): MockSnapElement {
    return {
        tagName: tag.toUpperCase(),
        id,
        parentElement: null,
        children: [],
        querySelectorAll(sel: string): MockSnapElement[] {
            void sel;
            // Flat traversal — return all children recursively, matching '*'.
            const out: MockSnapElement[] = [];
            const walk = (n: MockSnapElement) => {
                for (const c of n.children) {
                    out.push(c);
                    walk(c);
                }
            };
            walk(this);
            return out;
        },
    };
}

describe('CSS Scroll Snap', () => {
    beforeEach(() => {
        mockStyles.clear();
        globalThis.spatialNavConfig = {};
        (globalThis as { getComputedStyle: unknown }).getComputedStyle = snapStyleProxy();
    });

    it('parseScrollSnapType: y mandatory → vertical + mandatory', () => {
        const el = makeSnapElement('div');
        setStyles(el, { 'scroll-snap-type': 'y mandatory' });
        const info = getScrollSnapInfo(el as unknown as Element);
        assert.strictEqual(info.isSnapContainer, true);
        assert.strictEqual(info.axis, 'y');
        assert.strictEqual(info.isVertical, true);
        assert.strictEqual(info.isHorizontal, false);
        assert.strictEqual(info.isMandatory, true);
    });

    it('parseScrollSnapType: x proximity → horizontal + proximity', () => {
        const el = makeSnapElement('div');
        setStyles(el, { 'scroll-snap-type': 'x proximity' });
        const info = getScrollSnapInfo(el as unknown as Element);
        assert.strictEqual(info.axis, 'x');
        assert.strictEqual(info.isHorizontal, true);
        assert.strictEqual(info.isMandatory, false);
    });

    it('parseScrollSnapType: block / inline / both — axes flip correctly', () => {
        const block = makeSnapElement('div');
        setStyles(block, { 'scroll-snap-type': 'block mandatory' });
        const blockInfo = getScrollSnapInfo(block as unknown as Element);
        assert.strictEqual(blockInfo.isVertical, true);
        assert.strictEqual(blockInfo.isHorizontal, false);

        const inline = makeSnapElement('div');
        setStyles(inline, { 'scroll-snap-type': 'inline proximity' });
        const inlineInfo = getScrollSnapInfo(inline as unknown as Element);
        assert.strictEqual(inlineInfo.isHorizontal, true);
        assert.strictEqual(inlineInfo.isVertical, false);

        const both = makeSnapElement('div');
        setStyles(both, { 'scroll-snap-type': 'both mandatory' });
        const bothInfo = getScrollSnapInfo(both as unknown as Element);
        assert.strictEqual(bothInfo.isVertical, true);
        assert.strictEqual(bothInfo.isHorizontal, true);
    });

    it('parseScrollSnapType: "none" or empty → not a snap container', () => {
        const el = makeSnapElement('div');
        setStyles(el, { 'scroll-snap-type': 'none' });
        const info = getScrollSnapInfo(el as unknown as Element);
        assert.strictEqual(info.isSnapContainer, false);

        const elEmpty = makeSnapElement('div');
        setStyles(elEmpty, { 'scroll-snap-type': '' });
        const infoEmpty = getScrollSnapInfo(elEmpty as unknown as Element);
        assert.strictEqual(infoEmpty.isSnapContainer, false);
    });

    it('getScrollSnapInfo handles getComputedStyle throw', () => {
        const el = makeSnapElement('div');
        (globalThis as { getComputedStyle: unknown }).getComputedStyle = () => {
            throw new Error('detached');
        };
        const info = getScrollSnapInfo(el as unknown as Element);
        assert.strictEqual(info.isSnapContainer, false);
        assert.strictEqual(info.axis, 'none');
    });

    it('parseScrollSnapAlign: single value applies to both axes', () => {
        const el = makeSnapElement('div');
        setStyles(el, { 'scroll-snap-align': 'center' });
        const align = getScrollSnapAlign(el as unknown as Element);
        assert.strictEqual(align.hasSnapAlign, true);
        assert.strictEqual(align.blockAlign, 'center');
        assert.strictEqual(align.inlineAlign, 'center');
    });

    it('parseScrollSnapAlign: two values split block / inline', () => {
        const el = makeSnapElement('div');
        setStyles(el, { 'scroll-snap-align': 'start end' });
        const align = getScrollSnapAlign(el as unknown as Element);
        assert.strictEqual(align.blockAlign, 'start');
        assert.strictEqual(align.inlineAlign, 'end');
    });

    it('parseScrollSnapAlign: "none" → not aligned', () => {
        const el = makeSnapElement('div');
        setStyles(el, { 'scroll-snap-align': 'none' });
        const align = getScrollSnapAlign(el as unknown as Element);
        assert.strictEqual(align.hasSnapAlign, false);
    });

    it('getScrollSnapAlign handles getComputedStyle throw', () => {
        const el = makeSnapElement('div');
        (globalThis as { getComputedStyle: unknown }).getComputedStyle = () => {
            throw new Error('detached');
        };
        const info = getScrollSnapAlign(el as unknown as Element);
        assert.strictEqual(info.hasSnapAlign, false);
    });

    it('findScrollSnapContainer walks up the parent chain', () => {
        const grand = makeSnapElement('div', 'grand');
        const parent = makeSnapElement('div', 'parent');
        const child = makeSnapElement('div', 'child');
        parent.parentElement = grand;
        child.parentElement = parent;
        setStyles(grand, { 'scroll-snap-type': 'y mandatory' });

        const result = findScrollSnapContainer(child as unknown as Element);
        assert.strictEqual(result, grand as unknown as Element);
    });

    it('findScrollSnapContainer returns null when no ancestor is a snap container', () => {
        const parent = makeSnapElement('div', 'parent');
        const child = makeSnapElement('div', 'child');
        child.parentElement = parent;
        const result = findScrollSnapContainer(child as unknown as Element);
        assert.strictEqual(result, null);
    });

    it('getSnapPoints filters descendants by scroll-snap-align', () => {
        const container = makeSnapElement('ul', 'ul');
        const aligned = makeSnapElement('li', 'a');
        const plain = makeSnapElement('li', 'b');
        container.children.push(aligned, plain);
        setStyles(aligned, { 'scroll-snap-align': 'start' });

        const points = getSnapPoints(container as unknown as Element);
        assert.strictEqual(points.length, 1);
        assert.strictEqual((points[0] as unknown as MockSnapElement).id, 'a');
    });

    it('shouldUseGridForScrollSnap: config.scoringMode=grid short-circuits to true', () => {
        globalThis.spatialNavConfig = { scoringMode: 'grid' };
        const el = makeSnapElement('div');
        assert.strictEqual(shouldUseGridForScrollSnap(el as unknown as Element), true);
    });

    it('shouldUseGridForScrollSnap: mandatory container yields true', () => {
        const container = makeSnapElement('div', 'c');
        const child = makeSnapElement('div', 'ch');
        child.parentElement = container;
        setStyles(container, { 'scroll-snap-type': 'x mandatory' });
        assert.strictEqual(shouldUseGridForScrollSnap(child as unknown as Element), true);
    });

    it('shouldUseGridForScrollSnap: proximity container yields false', () => {
        const container = makeSnapElement('div', 'c');
        const child = makeSnapElement('div', 'ch');
        child.parentElement = container;
        setStyles(container, { 'scroll-snap-type': 'x proximity' });
        assert.strictEqual(shouldUseGridForScrollSnap(child as unknown as Element), false);
    });

    it('shouldUseGridForScrollSnap: no container → false', () => {
        const child = makeSnapElement('div');
        assert.strictEqual(shouldUseGridForScrollSnap(child as unknown as Element), false);
    });

    it('getScrollOptionsForSnapElement maps each align to scrollIntoView option', () => {
        for (const [align, expectedBlock] of [
            ['start', 'start'],
            ['end', 'end'],
            ['center', 'center'],
            ['none', 'nearest'],
        ] as const) {
            const el = makeSnapElement('div');
            setStyles(el, { 'scroll-snap-align': align });
            const opts = getScrollOptionsForSnapElement(el as unknown as Element);
            assert.strictEqual(opts.block, expectedBlock);
            assert.strictEqual(opts.inline, expectedBlock); // single value → both axes
            assert.strictEqual(opts.behavior, 'smooth');
        }
    });

    it('getScrollOptionsForSnapElement honours two-value alignment', () => {
        const el = makeSnapElement('div');
        setStyles(el, { 'scroll-snap-align': 'start end' });
        const opts = getScrollOptionsForSnapElement(el as unknown as Element);
        assert.strictEqual(opts.block, 'start');
        assert.strictEqual(opts.inline, 'end');
    });
});

// ---------------------------------------------------------------------------
// findNavigationContainer + hasNavigationContainment (boundary helpers)
// ---------------------------------------------------------------------------

describe('Navigation containment helpers', () => {
    beforeEach(() => {
        mockStyles.clear();
        globalThis.spatialNavConfig = { useCSSProperties: true };
        (globalThis as { getComputedStyle: unknown }).getComputedStyle = snapStyleProxy();
    });

    it('findNavigationContainer walks ancestors for --spatial-navigation-contain: contain', () => {
        const container = makeSnapElement('div', 'c');
        const child = makeSnapElement('div', 'ch');
        child.parentElement = container;
        setStyles(container, { '--spatial-navigation-contain': 'contain' });
        const found = findNavigationContainer(child as unknown as Element);
        assert.strictEqual(found, container as unknown as Element);
    });

    it('findNavigationContainer returns null when config.useCSSProperties is false', () => {
        globalThis.spatialNavConfig = { useCSSProperties: false };
        const child = makeSnapElement('div', 'ch');
        const result = findNavigationContainer(child as unknown as Element);
        assert.strictEqual(result, null);
    });

    it('hasNavigationContainment surfaces the found container', () => {
        const container = makeSnapElement('div', 'c');
        const child = makeSnapElement('div', 'ch');
        child.parentElement = container;
        setStyles(container, { '--spatial-navigation-contain': 'contain' });
        const result = hasNavigationContainment(child as unknown as Element);
        assert.strictEqual(result.contained, true);
        assert.strictEqual(result.container, container as unknown as Element);
    });

    it('hasNavigationContainment is contained=false when no ancestor matches', () => {
        const child = makeSnapElement('div', 'ch');
        const result = hasNavigationContainment(child as unknown as Element);
        assert.strictEqual(result.contained, false);
        assert.strictEqual(result.container, null);
    });
});

// Restore the original getComputedStyle for any test that runs after this file.
(globalThis as { getComputedStyle?: unknown }).getComputedStyle = origGetComputedStyle;
