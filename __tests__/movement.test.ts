/**
 * Tests for movement module
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import type { SpatialNavState, FocusableEntry } from '../core/state';
import { setupMockEnv as setupBaseMockEnv } from './helpers/mock_env';

// Module reference for dynamic import
let movementModule: typeof import('../navigation/movement') | null = null;

// Mock types
interface MockElement {
    nodeType: number;
    tagName: string;
    id: string;
    className: string;
    disabled: boolean;
    focus: () => void;
    getBoundingClientRect: () => DOMRect;
    contentWindow?: {
        focus: () => void;
    };
}

interface MockDocument {
    activeElement: MockElement | { nodeType: number } | null;
    body: { nodeType: number };
    documentElement: { nodeType: number };
    querySelectorAll: (selector: string) => unknown[];
    dispatchEvent: (event?: unknown) => void;
}

interface MockWindow {
    innerWidth: number;
    innerHeight: number;
    scrollY: number;
    scrollX: number;
    addEventListener: () => void;
    removeEventListener: () => void;
    getComputedStyle: () => {
        visibility: string;
        display: string;
        overflow: string;
        overflowX: string;
        overflowY: string;
    };
    requestAnimationFrame: (cb: () => void) => ReturnType<typeof setTimeout>;
    cancelAnimationFrame: (id: ReturnType<typeof setTimeout>) => void;
}

// Minimal mock for HTMLElement
class MockHTMLElementImpl {
    nodeType = 1;
    tagName = 'DIV';
    constructor() { }
}

function setupMockEnv(): { mockDocument: MockDocument } {
    return setupBaseMockEnv({
        navigatorUserAgent: 'node',
        HTMLElement: MockHTMLElementImpl as unknown as typeof HTMLElement,
    }) as unknown as { mockDocument: MockDocument };
}

async function loadMovementModule(): Promise<typeof import('../navigation/movement')> {
    if (!movementModule) {
        movementModule = await import('../navigation/movement');
    }
    return movementModule;
}

interface CreateElementOptions {
    tag?: string;
    id?: string;
    className?: string;
}

function createElement({ tag = 'button', id = '', className = '' }: CreateElementOptions = {}): MockElement {
    const el = new MockHTMLElementImpl() as unknown as MockElement;
    Object.assign(el, {
        nodeType: 1,
        tagName: tag.toUpperCase(),
        id,
        className,
        disabled: false,
        dispatchEvent: () => true,
        focus: () => {
            (document as unknown as MockDocument).activeElement = el;
        },
        getBoundingClientRect: () => ({
            left: 0,
            top: 0,
            right: 40,
            bottom: 20,
            width: 40,
            height: 20,
            x: 0,
            y: 0,
            toJSON: () => ({})
        }),
        contentWindow: {
            focus: () => {
                (document as unknown as MockDocument).activeElement = el;
            },
        },
    });
    return el;
}

interface TestState {
    config: {
        autoRefocus: boolean;
        refocusStrategy: string;
        iframeSupport: { enabled: boolean };
    };
    lastFocusedElement?: MockElement | HTMLElement | null;
    instrumentation: {
        lastOverlay?: string;
    };
    [key: string]: unknown;
}

function baseState(elements: MockElement[]): TestState {
    return {
        config: {
            autoRefocus: true,
            refocusStrategy: 'closest',
            iframeSupport: { enabled: false },
        },
        focusables: elements.map((element) => ({
            element: element as unknown as HTMLElement,
            rect: { left: 0, top: 0, right: 40, bottom: 20 } as DOMRect,
        } as FocusableEntry)),
        focusableElements: elements as unknown as HTMLElement[],
        instrumentation: {},
        scrollCache: new Map(),
    };
}

test('ensureValidFocus retains current active element', async () => {
    setupMockEnv();
    const button = createElement({ id: 'first' });
    button.focus();
    const state = baseState([button]) as unknown as SpatialNavState;
    (state as unknown as TestState).lastFocusedElement = button;

    const { ensureValidFocus } = await loadMovementModule();
    const result = ensureValidFocus(state);
    assert.equal(result, button);
});

test('moveInDirection suppresses overlay and previews on boundary exit', async () => {
    setupMockEnv();

    let overlayHidden = false;
    let resizeObserverDisconnected = false;

    const overlay = {
        classList: {
            remove: (cls: string) => {
                if (cls === 'visible') overlayHidden = true;
            },
            add: () => { },
        },
    } as unknown as HTMLElement;

    const previewContainer = (direction: string) => ({
        className: `focus-preview focus-preview-${direction} show disabled`,
        style: {
            left: '1px',
            top: '2px',
            width: '3px',
            height: '4px',
            opacity: '0.5',
        },
        removeAttribute: () => { },
    }) as unknown as HTMLElement;

    const previewArrow = { style: { display: 'none' } } as unknown as HTMLElement;

    const button = createElement({ id: 'only' }) as unknown as HTMLElement;
    (button as unknown as MockElement).focus();

    const state = baseState([button as unknown as MockElement]) as unknown as SpatialNavState;
    (state as unknown as { overlaySuppressed: boolean }).overlaySuppressed = false;
    state.overlay = overlay;
    state.previewElements = {
        up: { container: previewContainer('up'), arrow: previewArrow },
        down: { container: previewContainer('down'), arrow: previewArrow },
        left: { container: previewContainer('left'), arrow: previewArrow },
        right: { container: previewContainer('right'), arrow: previewArrow },
    };
    (state as unknown as { activeResizeObserver: unknown }).activeResizeObserver = {
        disconnect: () => { resizeObserverDisconnected = true; },
    };

    let timerFired = false;
    (state as unknown as { updateTimer: ReturnType<typeof setTimeout> | null }).updateTimer = setTimeout(() => {
        timerFired = true;
    }, 25);

    const { moveInDirection } = await loadMovementModule();

    // No candidate exists with a single focusable, so this is a boundary.
    const moved = moveInDirection({ axis: 'y', sign: -1, name: 'up' } as any, null, state);

    assert.equal(moved, false);
    assert.equal((state as any).overlaySuppressed, true);
    assert.equal((state as any).updateTimer, null);
    assert.equal(overlayHidden, true);
    assert.equal(resizeObserverDisconnected, true);

    // Previews should be reset to base class (no show/disabled).
    assert.equal((state.previewElements!.up.container as any).className, 'focus-preview focus-preview-up');
    assert.equal((state.previewElements!.down.container as any).className, 'focus-preview focus-preview-down');
    assert.equal((state.previewElements!.left.container as any).className, 'focus-preview focus-preview-left');
    assert.equal((state.previewElements!.right.container as any).className, 'focus-preview focus-preview-right');

    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.equal(timerFired, false, 'pending overlay update should be cancelled on exit');
});

test('moveInDirection posts focusExit message and dispatches spatialNavigationExit event', async () => {
    const { mockDocument } = setupMockEnv();
    const button = createElement({ id: 'only' }) as unknown as HTMLElement;
    (button as unknown as MockElement).focus();

    const state = baseState([button as unknown as MockElement]) as unknown as SpatialNavState;

    let lastDispatchedEvent: any = null;
    mockDocument.dispatchEvent = (event: any) => {
        lastDispatchedEvent = event;
    };

    let lastMessage: any = null;
    (globalThis as any).browser = {
        runtime: {
            sendMessage: (msg: unknown, cb?: (resp: unknown) => void) => {
                lastMessage = msg;
                cb?.({ ok: true });
            },
            lastError: null,
        }
    };

    const { moveInDirection } = await loadMovementModule();

    // No candidate exists with a single focusable, so this is a boundary.
    const moved = moveInDirection({ axis: 'y', sign: -1, name: 'up' } as any, null, state);

    assert.equal(moved, false);
    assert.equal(lastMessage?.type, 'focusExit');
    assert.equal(lastMessage?.direction, 'up');
    assert.equal(lastMessage?.inTrap, false);

    assert.equal(lastDispatchedEvent?.type, 'spatialNavigationExit');
    assert.equal(lastDispatchedEvent?.detail?.direction, 'up');
    assert.equal(lastDispatchedEvent?.detail?.inTrap, false);
});

test('moveInDirection falls back to alert in injected-script mode (no extension bridge)', async () => {
    setupMockEnv();

    const button = createElement({ id: 'only' }) as unknown as HTMLElement;
    (button as unknown as MockElement).focus();

    const state = baseState([button as unknown as MockElement]) as unknown as SpatialNavState;

    (globalThis as any).browser = undefined;

    let lastAlert: unknown = null;
    (globalThis as any).alert = (message?: unknown) => {
        lastAlert = message;
    };

    const { moveInDirection } = await loadMovementModule();

    // No candidate exists with a single focusable, so this is a boundary.
    const moved = moveInDirection({ axis: 'y', sign: -1, name: 'up' } as any, null, state);

    assert.equal(moved, false);
    assert.equal(lastAlert, '__FOCUS_EXIT__:up');
});

test('ensureValidFocus recovers last focused entry when active invalid', async () => {
    setupMockEnv();
    const ghost = createElement({ id: 'ghost' });
    const target = createElement({ id: 'target' });
    ghost.focus();

    const state = baseState([target]) as unknown as SpatialNavState;
    (state as unknown as TestState).instrumentation.lastOverlay = 'button#target';
    (state as unknown as TestState).lastFocusedElement = target;

    const { ensureValidFocus } = await loadMovementModule();
    const recovered = ensureValidFocus(state);
    assert.equal(recovered, target);
    assert.equal((document as unknown as MockDocument).activeElement, target);
    assert.equal(state.currentIndex, 0);
});

test('ensureValidFocus re-applies focus when activeElement is body (e.g. after scroll)', async () => {
    const { mockDocument } = setupMockEnv();

    const target = createElement({ id: 'target' });
    mockDocument.activeElement = mockDocument.body;

    const state = baseState([target]) as unknown as SpatialNavState;
    (state as unknown as TestState).lastFocusedElement = target;

    // Simulate focus() only working without options (focusWithFallback path).
    let focusCallCount = 0;
    (target as unknown as { focus: (opts?: unknown) => void }).focus = (opts?: unknown) => {
        focusCallCount += 1;
        if (opts && typeof opts === 'object') {
            throw new Error('focus options not supported');
        }
        (document as unknown as MockDocument).activeElement = target;
    };

    const { ensureValidFocus } = await loadMovementModule();
    const recovered = ensureValidFocus(state);
    assert.equal(recovered, target);
    assert.equal((document as unknown as MockDocument).activeElement, target);
    assert.equal(state.currentIndex, 0);
    assert.ok(focusCallCount >= 2, 'should retry focus without options when focus({preventScroll}) fails');
});

test('ensureValidFocus falls back to first visible element', async () => {
    const { mockDocument } = setupMockEnv();
    const alpha = createElement({ id: 'alpha' });
    const beta = createElement({ id: 'beta' });
    mockDocument.activeElement = mockDocument.body; // Simulate no valid focus

    const state = baseState([alpha, beta]) as unknown as SpatialNavState;
    (state as unknown as TestState).instrumentation.lastOverlay = '';
    (state as unknown as TestState).lastFocusedElement = null;

    const { ensureValidFocus } = await loadMovementModule();
    const recovered = ensureValidFocus(state);
    assert.equal(recovered, alpha);
    assert.equal(state.currentIndex, 0);
});

// ===== Position-based Recovery Tests (Fix for "popping to top") =====

test('ensureValidFocus uses position hint to recover to closest element', async () => {
    const { mockDocument } = setupMockEnv();

    // Create elements at different positions
    const top = createElement({ id: 'top' });
    const middle = createElement({ id: 'middle' });
    const bottom = createElement({ id: 'bottom' });

    // Override getBoundingClientRect to set positions
    top.getBoundingClientRect = () => ({
        left: 100, top: 50, right: 200, bottom: 100,
        width: 100, height: 50, x: 100, y: 50, toJSON: () => ({})
    });
    middle.getBoundingClientRect = () => ({
        left: 100, top: 200, right: 200, bottom: 250,
        width: 100, height: 50, x: 100, y: 200, toJSON: () => ({})
    });
    bottom.getBoundingClientRect = () => ({
        left: 100, top: 350, right: 200, bottom: 400,
        width: 100, height: 50, x: 100, y: 350, toJSON: () => ({})
    });

    // Simulate focus lost (activeElement = body)
    mockDocument.activeElement = mockDocument.body;

    const state = baseState([top, middle, bottom]) as unknown as SpatialNavState;

    // Manually set geometry (simulating what refreshFocusables does)
    state.focusables[0].centerX = 150;
    state.focusables[0].centerY = 75;
    state.focusables[0].rect = top.getBoundingClientRect();
    state.focusables[1].centerX = 150;
    state.focusables[1].centerY = 225;
    state.focusables[1].rect = middle.getBoundingClientRect();
    state.focusables[2].centerX = 150;
    state.focusables[2].centerY = 375;
    state.focusables[2].rect = bottom.getBoundingClientRect();

    // Set position hint pointing near the middle element
    (state as unknown as TestState & { lastFocusPosition: unknown }).lastFocusPosition = {
        centerX: 155,  // Slightly off-center
        centerY: 220,  // Close to middle element
        top: 195,
        left: 105,
        elementDesc: 'button#recycled',  // Original element is gone
        timestamp: Date.now()
    };
    (state as unknown as TestState).lastFocusedElement = null;
    (state as unknown as TestState).instrumentation.lastOverlay = '';

    const { ensureValidFocus } = await loadMovementModule();
    const recovered = ensureValidFocus(state);

    // Should recover to middle element (closest to position hint)
    assert.equal(recovered, middle, 'Should recover to closest element by position');
    assert.equal(state.currentIndex, 1, 'currentIndex should be updated to middle element');
});

test('ensureValidFocus ignores expired position hints', async () => {
    const { mockDocument } = setupMockEnv();

    const alpha = createElement({ id: 'alpha' });
    const beta = createElement({ id: 'beta' });

    alpha.getBoundingClientRect = () => ({
        left: 100, top: 50, right: 200, bottom: 100,
        width: 100, height: 50, x: 100, y: 50, toJSON: () => ({})
    });
    beta.getBoundingClientRect = () => ({
        left: 100, top: 200, right: 200, bottom: 250,
        width: 100, height: 50, x: 100, y: 200, toJSON: () => ({})
    });

    mockDocument.activeElement = mockDocument.body;

    const state = baseState([alpha, beta]) as unknown as SpatialNavState;
    state.focusables[0].centerX = 150;
    state.focusables[0].centerY = 75;
    state.focusables[0].rect = alpha.getBoundingClientRect();
    state.focusables[1].centerX = 150;
    state.focusables[1].centerY = 225;
    state.focusables[1].rect = beta.getBoundingClientRect();

    // Set EXPIRED position hint (older than 2 seconds)
    (state as unknown as TestState & { lastFocusPosition: unknown }).lastFocusPosition = {
        centerX: 150,
        centerY: 225,  // Would point to beta
        top: 200,
        left: 100,
        elementDesc: 'button#old',
        timestamp: Date.now() - 3000  // 3 seconds ago = expired
    };
    (state as unknown as TestState).lastFocusedElement = null;
    (state as unknown as TestState).instrumentation.lastOverlay = '';

    const { ensureValidFocus } = await loadMovementModule();
    const recovered = ensureValidFocus(state);

    // Should fall back to first visible element (alpha), not use expired hint
    assert.equal(recovered, alpha, 'Should ignore expired position hint');
    assert.equal(state.currentIndex, 0);
});

test('ensureValidFocus clears position hint after successful recovery', async () => {
    const { mockDocument } = setupMockEnv();

    const target = createElement({ id: 'target' });
    target.getBoundingClientRect = () => ({
        left: 100, top: 100, right: 200, bottom: 150,
        width: 100, height: 50, x: 100, y: 100, toJSON: () => ({})
    });

    mockDocument.activeElement = mockDocument.body;

    const state = baseState([target]) as unknown as SpatialNavState;
    state.focusables[0].centerX = 150;
    state.focusables[0].centerY = 125;
    state.focusables[0].rect = target.getBoundingClientRect();

    // Set valid position hint
    (state as unknown as TestState & { lastFocusPosition: unknown }).lastFocusPosition = {
        centerX: 150,
        centerY: 125,
        top: 100,
        left: 100,
        elementDesc: 'button#target',
        timestamp: Date.now()
    };
    (state as unknown as TestState).lastFocusedElement = null;
    (state as unknown as TestState).instrumentation.lastOverlay = '';

    const { ensureValidFocus } = await loadMovementModule();
    ensureValidFocus(state);

    // Position hint should be cleared after recovery
    assert.equal(
        (state as unknown as TestState & { lastFocusPosition: unknown }).lastFocusPosition,
        null,
        'Position hint should be cleared after recovery'
    );
});

test('position hint takes precedence when lastOverlay fails', async () => {
    const { mockDocument } = setupMockEnv();

    const nearHint = createElement({ id: 'near-hint' });
    const farAway = createElement({ id: 'far-away' });

    nearHint.getBoundingClientRect = () => ({
        left: 100, top: 300, right: 200, bottom: 350,
        width: 100, height: 50, x: 100, y: 300, toJSON: () => ({})
    });
    farAway.getBoundingClientRect = () => ({
        left: 100, top: 0, right: 200, bottom: 50,
        width: 100, height: 50, x: 100, y: 0, toJSON: () => ({})
    });

    mockDocument.activeElement = mockDocument.body;

    const state = baseState([farAway, nearHint]) as unknown as SpatialNavState;
    state.focusables[0].centerX = 150;
    state.focusables[0].centerY = 25;
    state.focusables[0].rect = farAway.getBoundingClientRect();
    state.focusables[1].centerX = 150;
    state.focusables[1].centerY = 325;
    state.focusables[1].rect = nearHint.getBoundingClientRect();

    // lastOverlay points to non-existent element
    (state as unknown as TestState).instrumentation.lastOverlay = 'button#deleted-element';
    (state as unknown as TestState).lastFocusedElement = null;

    // Position hint points near nearHint element
    (state as unknown as TestState & { lastFocusPosition: unknown }).lastFocusPosition = {
        centerX: 145,
        centerY: 320,  // Close to nearHint
        top: 295,
        left: 95,
        elementDesc: 'button#recycled',
        timestamp: Date.now()
    };

    const { ensureValidFocus } = await loadMovementModule();
    const recovered = ensureValidFocus(state);

    // lastOverlay failed, so should use position hint → nearHint
    assert.equal(recovered, nearHint, 'Should use position hint when lastOverlay fails');
});
