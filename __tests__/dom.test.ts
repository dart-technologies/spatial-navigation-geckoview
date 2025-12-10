/**
 * Tests for DOM utilities
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import type { SpatialNavState, FocusableEntry } from '../core/state';
import { createMockElement, setupMockEnv as setupBaseMockEnv } from './helpers/mock_env';

// Module reference for dynamic import
let domModule: typeof import('../utils/dom') | null = null;

// Mock types
interface MockElement {
    nodeType: number;
    tagName: string;
    id: string;
    className: string;
    disabled: boolean;
    parentElement: null;
    hasAttribute: () => boolean;
    getAttribute: () => null;
    focus: () => void;
    getBoundingClientRect: () => DOMRect;
}

interface MockDocument {
    body: {
        appendChild: () => void;
    };
    querySelectorAll: () => never[];
}

interface MockWindow {
    getComputedStyle: () => {
        visibility: string;
        display: string;
        overflow: string;
        overflowX: string;
        overflowY: string;
    };
}

function setupMockEnv(): void {
    setupBaseMockEnv({
        navigatorUserAgent: 'node',
        document: {
            body: { appendChild: () => { } }
        } as any,
    });
}

async function loadDomModule(): Promise<typeof import('../utils/dom')> {
    if (!domModule) {
        domModule = await import('../utils/dom');
    }
    return domModule;
}

function createElement(id: string): MockElement {
    return createMockElement({ tagName: 'button', id }) as unknown as MockElement;
}

interface TestState extends Partial<SpatialNavState> {
    observed: MockElement[];
    unobserved: MockElement[];
}

function createState(): TestState {
    const observed: MockElement[] = [];
    const unobserved: MockElement[] = [];
    return {
        focusables: [],
        focusableElements: [],
        focusGroups: {},
        scrollCache: new Map(),
        intersectionObserver: {
            observe: (el: unknown) => observed.push(el as MockElement),
            unobserve: (el: unknown) => unobserved.push(el as MockElement),
            disconnect: () => { },
        } as unknown as IntersectionObserver,
        observed,
        unobserved,
    };
}

test('insertEntry pushes element and updates indices', async () => {
    setupMockEnv();
    const { insertEntry } = await loadDomModule();
    const element = createElement('primary');
    const state = createState() as unknown as SpatialNavState;

    insertEntry(element as unknown as Element, state);

    assert.equal(state.focusables.length, 1);
    assert.equal(state.focusables[0].index, 0);
    assert.equal(state.focusableElements[0], element);
    assert.deepEqual((state as TestState).observed, [element]);
});

test('removeEntry reindexes remaining entries and unobserves element', async () => {
    setupMockEnv();
    const { insertEntry, removeEntry } = await loadDomModule();
    const state = createState() as unknown as SpatialNavState;
    const first = createElement('first');
    const second = createElement('second');

    insertEntry(first as unknown as Element, state);
    insertEntry(second as unknown as Element, state);
    state.currentIndex = 1;

    removeEntry(0, state);

    assert.equal(state.focusables.length, 1);
    assert.equal(state.focusables[0].element, second);
    assert.equal(state.focusables[0].index, 0);
    assert.equal(state.currentIndex, 0);
    assert.deepEqual((state as TestState).unobserved, [first]);
});
