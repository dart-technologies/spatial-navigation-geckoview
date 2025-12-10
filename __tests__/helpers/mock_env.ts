/**
 * Shared test mocks and helpers for Spatial Navigation tests
 *
 * This module provides reusable mock implementations for DOM, Window,
 * and browser APIs used across multiple test files.
 */

// ============================================================================
// Mock Types
// ============================================================================

export interface MockElement {
    nodeType: number;
    tagName: string;
    id: string;
    className: string;
    disabled: boolean;
    hasAttribute: (name: string) => boolean;
    getAttribute: (name: string) => string | null;
    contains?: (other: unknown) => boolean;
    focus: () => void;
    click: () => void;
    classList: {
        add: (cls: string) => void;
        remove: (cls: string) => void;
    };
    getBoundingClientRect: () => DOMRect;
    dispatchEvent: (e: Event) => boolean;
    isContentEditable?: boolean;
    type?: string;
    nextElementSibling?: MockElement | null;
    parentElement?: MockElement | null;
    closest?: (selector: string) => MockElement | null;
}

export interface MockDocument {
    activeElement: MockElement | { nodeType: number } | null;
    body: { nodeType: number; click?: () => void; appendChild?: (node: unknown) => void };
    documentElement: {
        nodeType: number;
        getAttribute: (name: string) => string | null;
        setAttribute: (name: string, value: string) => void;
        removeAttribute?: (name: string) => void;
    };
    querySelectorAll: (selector: string) => unknown[];
    querySelector: (selector: string) => MockElement | null;
    getElementById: (id: string) => MockElement | null;
    elementFromPoint: (x: number, y: number) => MockElement | null;
    dispatchEvent?: (event: unknown) => void;
}

export interface MockWindow {
    innerWidth: number;
    innerHeight: number;
    devicePixelRatio: number;
    scrollY?: number;
    scrollX?: number;
    addEventListener?: () => void;
    removeEventListener?: () => void;
    getComputedStyle?: () => {
        visibility: string;
        display: string;
        overflow: string;
        overflowX: string;
        overflowY: string;
    };
    requestAnimationFrame?: (cb: () => void) => ReturnType<typeof setTimeout>;
    cancelAnimationFrame?: (id: ReturnType<typeof setTimeout>) => void;
    flutterSpatialNavDebug?: boolean;
    __SPATIAL_NAV_KEYDOWN_COUNT__?: number;
    __SPATIAL_NAV_LAST_KEY_TIME__?: number;
    __SPATIAL_NAV_LAST_KEY__?: string;
}

// ============================================================================
// Mock Element Factory
// ============================================================================

export interface CreateMockElementOptions {
    tagName: string;
    id?: string;
    className?: string;
    hasHref?: boolean;
    hrefValue?: string | null;
    role?: string | null;
    ariaHasPopup?: string | null;
    ariaExpanded?: string | null;
    isEditable?: boolean;
    type?: string;
    rect?: Partial<DOMRect>;
}

/**
 * Create a mock element with configurable properties.
 * Reduces boilerplate in tests by providing sensible defaults.
 */
export function createMockElement(options: CreateMockElementOptions): MockElement {
    const attributes: Record<string, string | null> = {};
    if (options.hasHref) {
        attributes['href'] = options.hrefValue ?? '/some-path';
    }
    if (options.role) {
        attributes['role'] = options.role;
    }
    if (options.ariaHasPopup !== undefined) {
        attributes['aria-haspopup'] = options.ariaHasPopup;
    }
    if (options.ariaExpanded !== undefined) {
        attributes['aria-expanded'] = options.ariaExpanded;
    }

    const defaultRect: DOMRect = {
        top: 100,
        left: 100,
        bottom: 150,
        right: 200,
        width: 100,
        height: 50,
        x: 100,
        y: 100,
        toJSON: () => ({})
    };

    const el: MockElement = {
        nodeType: 1,
        tagName: options.tagName.toUpperCase(),
        id: options.id || '',
        className: options.className || '',
        disabled: false,
        hasAttribute: (name: string) => name in attributes && attributes[name] !== null,
        getAttribute: (name: string) => attributes[name] ?? null,
        focus: () => { },
        click: () => { },
        classList: {
            add: () => { },
            remove: () => { }
        },
        getBoundingClientRect: () => ({ ...defaultRect, ...options.rect }) as DOMRect,
        dispatchEvent: () => true,
        isContentEditable: options.isEditable ?? false,
        type: options.type
    };

    el.contains = (other: unknown) => other === el;
    return el;
}

// ============================================================================
// Mock Environment Setup
// ============================================================================

export interface MockEnvResult {
    mockDocument: MockDocument;
    mockWindow: MockWindow;
    documentElementAttrs: Map<string, string>;
}

/**
 * Set up a complete mock environment for testing.
 * Configures globalThis.document, globalThis.window, and browser globals.
 */
export interface SetupMockEnvOptions {
    innerWidth?: number;
    innerHeight?: number;
    devicePixelRatio?: number;
    flutterSpatialNavDebug?: boolean;
    navigatorUserAgent?: string;
    alert?: (message?: unknown) => void;
    HTMLElement?: unknown;
    document?: Partial<MockDocument> & { body?: Partial<MockDocument['body']> };
    window?: Partial<MockWindow>;
}

export function setupMockEnv(options: SetupMockEnvOptions = {}): MockEnvResult {
    const documentElementAttrs = new Map<string, string>();
    const mockDocumentElement = {
        nodeType: 1,
        getAttribute: (name: string) => documentElementAttrs.get(name) ?? null,
        setAttribute: (name: string, value: string) => {
            documentElementAttrs.set(name, value);
        },
        removeAttribute: (name: string) => {
            documentElementAttrs.delete(name);
        }
    };

    const mockDocument: MockDocument = {
        activeElement: null,
        body: { nodeType: 1, click: () => { }, ...(options.document?.body ?? {}) },
        documentElement: mockDocumentElement,
        querySelectorAll: (_selector: string) => [],
        querySelector: () => null,
        getElementById: () => null,
        elementFromPoint: () => null,
        dispatchEvent: () => { }
    };

    const mockWindow: MockWindow = {
        innerWidth: options.innerWidth ?? 1920,
        innerHeight: options.innerHeight ?? 1080,
        devicePixelRatio: options.devicePixelRatio ?? 2.0,
        scrollY: 0,
        scrollX: 0,
        addEventListener: () => { },
        removeEventListener: () => { },
        getComputedStyle: () => ({
            visibility: 'visible',
            display: 'block',
            overflow: '',
            overflowX: '',
            overflowY: ''
        }),
        requestAnimationFrame: (cb: () => void) => setTimeout(cb, 0),
        cancelAnimationFrame: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
        flutterSpatialNavDebug: options.flutterSpatialNavDebug ?? false
    };

    const { body: bodyOverrides, ...documentOverrides } = options.document ?? {};
    Object.assign(mockDocument, documentOverrides);
    if (bodyOverrides) {
        Object.assign(mockDocument.body, bodyOverrides);
    }
    Object.assign(mockWindow, options.window ?? {});

    // Install globals
    (globalThis as unknown as { document: MockDocument }).document = mockDocument;
    (globalThis as unknown as { window: MockWindow }).window = mockWindow;
    (globalThis as unknown as { browser: undefined }).browser = undefined;
    (globalThis as unknown as { getComputedStyle: unknown }).getComputedStyle = mockWindow.getComputedStyle;
    (globalThis as unknown as { alert: unknown }).alert = options.alert ?? (() => { });

    if (options.navigatorUserAgent) {
        try {
            delete (globalThis as Record<string, unknown>).navigator;
        } catch {
            // ignore if navigator is non-configurable
        }
        Object.defineProperty(globalThis, 'navigator', {
            value: { userAgent: options.navigatorUserAgent },
            writable: true,
            configurable: true,
        });
    }

    if (options.HTMLElement) {
        (globalThis as unknown as { HTMLElement: unknown }).HTMLElement = options.HTMLElement;
    }

    // Mock event constructors
    (globalThis as unknown as { MouseEvent: unknown }).MouseEvent = class MockMouseEvent {
        type: string;
        constructor(type: string) { this.type = type; }
    };
    (globalThis as unknown as { KeyboardEvent: unknown }).KeyboardEvent = class MockKeyboardEvent {
        type: string;
        key: string;
        constructor(type: string, opts?: { key?: string }) {
            this.type = type;
            this.key = opts?.key || '';
        }
    };
    (globalThis as unknown as { PointerEvent: unknown }).PointerEvent = class MockPointerEvent {
        type: string;
        constructor(type: string) { this.type = type; }
    };
    (globalThis as unknown as { CustomEvent: unknown }).CustomEvent = class MockCustomEvent {
        type: string;
        detail?: unknown;
        constructor(type: string, opts?: { detail?: unknown }) {
            this.type = type;
            this.detail = opts?.detail;
        }
    };

    (globalThis as unknown as { requestAnimationFrame: (cb: FrameRequestCallback) => number }).requestAnimationFrame =
        (_cb: FrameRequestCallback) => setTimeout(() => _cb(performance.now()), 0) as unknown as number;
    (globalThis as unknown as { cancelAnimationFrame: (id: number) => void }).cancelAnimationFrame =
        (id: number) => clearTimeout(id as unknown as ReturnType<typeof setTimeout>);
    (globalThis as unknown as { queueMicrotask: typeof queueMicrotask }).queueMicrotask =
        (cb: () => void) => Promise.resolve().then(cb);

    return { mockDocument, mockWindow, documentElementAttrs };
}

// ============================================================================
// State Factory
// ============================================================================

import type { FocusableEntry } from '../../core/state';

/**
 * Test state interface - provides just the fields needed for testing.
 * This is intentionally minimal to avoid type conflicts with the full SpatialNavState.
 */
export interface TestState {
    config: {
        autoRefocus: boolean;
        refocusStrategy: string;
        iframeSupport: { enabled: boolean };
        [key: string]: unknown;  // Allow additional config fields
    };
    focusables: FocusableEntry[];
    focusableElements: HTMLElement[];
    lastFocusedElement?: MockElement | HTMLElement | null;
    instrumentation: {
        lastOverlay?: string;
        lastActive?: string;
        activeIndex?: number;
        lastUpdate?: number;
    };
    scrollCache?: Map<unknown, unknown>;
    [key: string]: unknown;  // Allow additional state fields
}

/**
 * Create a base state object for testing with reasonable defaults.
 */
export function createTestState(elements: MockElement[]): TestState {
    const focusables = elements.map((element) => ({
        element: element as unknown as Element,
        rect: { left: 0, top: 0, right: 40, bottom: 20 } as DOMRect,
        centerX: 20,
        centerY: 10,
        top: 0,
        left: 0
    } as FocusableEntry));

    return {
        config: {
            autoRefocus: true,
            refocusStrategy: 'closest',
            iframeSupport: { enabled: false }
        },
        focusables,
        focusableElements: elements as unknown as HTMLElement[],
        instrumentation: {},
        scrollCache: new Map()
    };
}

// ============================================================================
// Click Target Detection (exported for tests)
// ============================================================================

/**
 * Check if an element needs native click injection.
 * This is the canonical implementation that tests should reference.
 *
 * Native injection is needed for:
 * - <a> without href (JS-handled links)
 * - <div>, <span>, <button> (custom interactive elements)
 * - role="button" (ARIA buttons)
 * - <video>, <img> (media elements)
 */
export function isNativeClickTarget(element: MockElement | Element): boolean {
    const tagName = element.tagName.toLowerCase();
    const hasHref = 'hasAttribute' in element && element.hasAttribute('href');
    const role = 'getAttribute' in element ? element.getAttribute('role') : null;

    return (
        (tagName === 'a' && !hasHref) ||
        tagName === 'div' ||
        tagName === 'span' ||
        tagName === 'button' ||
        role === 'button' ||
        tagName === 'video' ||
        tagName === 'img'
    );
}

// ============================================================================
// Mock Keyboard Event Factory
// ============================================================================

export interface MockKeyboardEventOptions {
    key: string;
    timeStamp?: number;
    preventDefault?: () => void;
    stopPropagation?: () => void;
    stopImmediatePropagation?: () => void;
}

/**
 * Create a mock keyboard event for testing.
 */
export function createMockKeyboardEvent(options: MockKeyboardEventOptions): KeyboardEvent & {
    preventDefaultCalled: boolean;
    stopPropagationCalled: boolean;
    stopImmediatePropagationCalled: boolean;
} {
    const event = {
        key: options.key,
        timeStamp: options.timeStamp ?? Date.now(),
        type: 'keydown',
        preventDefaultCalled: false,
        stopPropagationCalled: false,
        stopImmediatePropagationCalled: false,
        preventDefault() {
            this.preventDefaultCalled = true;
            options.preventDefault?.();
        },
        stopPropagation() {
            this.stopPropagationCalled = true;
            options.stopPropagation?.();
        },
        stopImmediatePropagation() {
            this.stopImmediatePropagationCalled = true;
            options.stopImmediatePropagation?.();
        }
    };

    return event as unknown as typeof event & KeyboardEvent;
}
