/**
 * happy-dom-backed test environment for spatial navigation tests.
 *
 * Replaces the hand-rolled mock_env shim with a real DOM. Tests get accurate
 * `getBoundingClientRect`, real event dispatch, real focus/blur, real
 * `Element` prototypes — which means the same code paths the production
 * extension hits actually run inside the test.
 *
 * Use:
 *   import { setupDomEnv, createElement, createTestState, createKeyboardEvent } from './helpers/dom_env';
 *
 *   beforeEach(() => setupDomEnv());
 *   afterEach(() => teardownDomEnv());
 */

import { Window } from 'happy-dom';
import { setLogLevel } from '../../utils/logger';
import type { FocusableEntry, SpatialNavState } from '../../core/state';
import type { SpatialNavConfig } from '../../core/config';

// Silence per-namespace [SpatialNav:*] logs by default — individual tests can
// re-enable with setLogLevel('debug') if they're asserting on output.
setLogLevel('silent');

// ---------------------------------------------------------------------------
// Global setup
// ---------------------------------------------------------------------------

interface DomEnvOptions {
    /** Initial HTML for the document body. Defaults to empty. */
    html?: string;
    /** Viewport width (default 1920). */
    innerWidth?: number;
    /** Viewport height (default 1080). */
    innerHeight?: number;
    /** Device pixel ratio (default 2). */
    devicePixelRatio?: number;
    /** User-agent string (default Android TV-ish). */
    userAgent?: string;
}

interface DomEnv {
    window: Window;
    document: Document;
}

let activeWindow: Window | null = null;

/**
 * Install a fresh happy-dom Window on globalThis. Call from `beforeEach`.
 */
export function setupDomEnv(options: DomEnvOptions = {}): DomEnv {
    const window = new Window({
        innerWidth: options.innerWidth ?? 1920,
        innerHeight: options.innerHeight ?? 1080,
        url: 'https://test.local/',
        settings: {
            navigator: {
                userAgent: options.userAgent ?? 'Mozilla/5.0 (Linux; Android 13; AFTBN) AppleWebKit/537.36',
            },
        },
    });

    if (options.html) {
        window.document.body.innerHTML = options.html;
    }

    // Expose the standard browser globals the production code uses directly.
    const g = globalThis as unknown as {
        window: Window;
        document: Document;
        HTMLElement: typeof HTMLElement;
        Element: typeof Element;
        Node: typeof Node;
        MouseEvent: typeof MouseEvent;
        KeyboardEvent: typeof KeyboardEvent;
        PointerEvent: typeof PointerEvent;
        CustomEvent: typeof CustomEvent;
        Event: typeof Event;
        DOMRect: typeof DOMRect;
        IntersectionObserver?: typeof IntersectionObserver;
        MutationObserver?: typeof MutationObserver;
        ResizeObserver?: typeof ResizeObserver;
        getComputedStyle: typeof getComputedStyle;
        requestAnimationFrame: typeof requestAnimationFrame;
        cancelAnimationFrame: typeof cancelAnimationFrame;
        queueMicrotask: typeof queueMicrotask;
        devicePixelRatio: number;
        scheduler?: unknown;
        browser?: unknown;
        chrome?: unknown;
    };

    g.window = window;
    g.document = window.document as unknown as Document;
    (g as { location?: unknown }).location = (window as unknown as { location: unknown }).location;
    (g as { performance?: unknown }).performance =
        (window as unknown as { performance?: unknown }).performance ?? performance;
    g.HTMLElement = window.HTMLElement as unknown as typeof HTMLElement;
    g.Element = window.Element as unknown as typeof Element;
    g.Node = window.Node as unknown as typeof Node;
    g.MouseEvent = window.MouseEvent as unknown as typeof MouseEvent;
    g.KeyboardEvent = window.KeyboardEvent as unknown as typeof KeyboardEvent;
    // happy-dom doesn't export PointerEvent; alias to MouseEvent which production code feature-detects.
    g.PointerEvent =
        (window as unknown as { PointerEvent?: typeof PointerEvent }).PointerEvent ??
        (window.MouseEvent as unknown as typeof PointerEvent);
    g.CustomEvent = window.CustomEvent as unknown as typeof CustomEvent;
    g.Event = window.Event as unknown as typeof Event;
    // happy-dom DOMRect lives on the window
    g.DOMRect = (window as unknown as { DOMRect: typeof DOMRect }).DOMRect;
    g.getComputedStyle = window.getComputedStyle.bind(window) as unknown as typeof getComputedStyle;
    g.requestAnimationFrame = ((cb: FrameRequestCallback) =>
        setTimeout(() => cb(performance.now()), 0)) as unknown as typeof requestAnimationFrame;
    g.cancelAnimationFrame = ((id: number) => clearTimeout(id)) as unknown as typeof cancelAnimationFrame;
    g.queueMicrotask = (cb: () => void) => Promise.resolve().then(cb);
    g.devicePixelRatio = options.devicePixelRatio ?? 2;
    // Production code reads `window.devicePixelRatio` (not `globalThis.…`),
    // so override it on the happy-dom window instance too.
    Object.defineProperty(window, 'devicePixelRatio', {
        value: options.devicePixelRatio ?? 2,
        configurable: true,
        writable: true,
    });

    // happy-dom provides MutationObserver/IntersectionObserver — surface them as globals.
    g.MutationObserver = (
        window as unknown as { MutationObserver: typeof MutationObserver }
    ).MutationObserver;
    const IO = (window as unknown as { IntersectionObserver?: typeof IntersectionObserver })
        .IntersectionObserver;
    if (IO) g.IntersectionObserver = IO;
    const RO = (window as unknown as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
    if (RO) g.ResizeObserver = RO;

    // Reset extension globals between runs.
    g.browser = undefined;
    g.chrome = undefined;

    activeWindow = window;
    return { window, document: window.document as unknown as Document };
}

/**
 * Tear down the active happy-dom window. Call from `afterEach`.
 */
export function teardownDomEnv(): void {
    if (activeWindow) {
        try {
            activeWindow.happyDOM.close();
        } catch {
            // ignore close errors on already-closed windows
        }
        activeWindow = null;
    }
}

// ---------------------------------------------------------------------------
// Element factory
// ---------------------------------------------------------------------------

interface CreateElementOptions {
    tagName?: string;
    id?: string;
    className?: string;
    href?: string;
    role?: string;
    tabindex?: string;
    text?: string;
    type?: string;
    /** Any other attributes to set. */
    attrs?: Record<string, string>;
    /** Inline style object. */
    style?: Partial<CSSStyleDeclaration>;
    /** Geometry hint — the element will report this rect from getBoundingClientRect. */
    rect?: { x?: number; y?: number; width?: number; height?: number };
    /** Whether the element is content-editable. */
    contentEditable?: boolean;
}

/**
 * Create a real HTMLElement attached to the active document.
 *
 * If `rect` is provided, `getBoundingClientRect` is overridden on the
 * element instance to return that rect — happy-dom doesn't lay out
 * elements, so explicit geometry is the only way to drive scoring.
 */
export function createElement(options: CreateElementOptions = {}): HTMLElement {
    if (!activeWindow) throw new Error('setupDomEnv() must be called first');

    const doc = activeWindow.document;
    const tag = options.tagName ?? 'div';
    const el = doc.createElement(tag) as unknown as HTMLElement;

    if (options.id) el.id = options.id;
    if (options.className) el.className = options.className;
    if (options.href !== undefined) el.setAttribute('href', options.href);
    if (options.role !== undefined) el.setAttribute('role', options.role);
    if (options.tabindex !== undefined) el.setAttribute('tabindex', options.tabindex);
    if (options.type !== undefined) el.setAttribute('type', options.type);
    if (options.text !== undefined) el.textContent = options.text;
    if (options.contentEditable) el.setAttribute('contenteditable', 'true');

    if (options.attrs) {
        for (const [name, value] of Object.entries(options.attrs)) {
            el.setAttribute(name, value);
        }
    }

    if (options.style) {
        for (const [prop, value] of Object.entries(options.style)) {
            (el.style as unknown as Record<string, unknown>)[prop] = value;
        }
    }

    if (options.rect) {
        const r = {
            x: options.rect.x ?? 0,
            y: options.rect.y ?? 0,
            width: options.rect.width ?? 100,
            height: options.rect.height ?? 50,
        };
        const rect: DOMRect = {
            x: r.x,
            y: r.y,
            top: r.y,
            left: r.x,
            right: r.x + r.width,
            bottom: r.y + r.height,
            width: r.width,
            height: r.height,
            toJSON: () => ({ ...r }),
        };
        el.getBoundingClientRect = () => rect;
    }

    return el;
}

/**
 * Append an element to the document body and return it (chainable in test setup).
 */
export function attachElement<T extends HTMLElement>(el: T): T {
    if (!activeWindow) throw new Error('setupDomEnv() must be called first');
    // happy-dom's Node is structurally incompatible with the browser's Node type
    // at the type level, so cast through unknown to appendChild.
    (activeWindow.document.body as unknown as { appendChild: (node: unknown) => void }).appendChild(el);
    return el;
}

/**
 * Build a DOMRect literal from (x, y, w, h). Replaces the
 * `{x, y, top, left, right, bottom, width, height, toJSON: () => ({})}` boilerplate
 * scattered across test files.
 */
export function domRect(x: number, y: number, width: number, height: number): DOMRect {
    return {
        x,
        y,
        top: y,
        left: x,
        right: x + width,
        bottom: y + height,
        width,
        height,
        toJSON: () => ({}),
    };
}

/**
 * Stamp a fixed bounding-rect on `el` and return the element. happy-dom does
 * not lay out, so any test that relies on `getBoundingClientRect()` returning
 * non-zero dimensions must call this (or pass `rect` to `createElement`).
 *
 * Default rect is (0, 0, 80, 30) — a typical button-sized hit target.
 */
export function stampRect(el: HTMLElement, w = 80, h = 30, x = 0, y = 0): HTMLElement {
    const rect = domRect(x, y, w, h);
    el.getBoundingClientRect = () => rect;
    return el;
}

/**
 * Create a focusable button, attach it to body, and stamp it with a visible rect.
 * The common shape `attachElement(createElement({tagName:'button', tabindex:'0', rect:{...}}))`
 * collapsed into one call.
 */
export function createVisibleButton(
    opts: {
        x?: number;
        y?: number;
        width?: number;
        height?: number;
        id?: string;
        text?: string;
        attrs?: Record<string, string>;
    } = {}
): HTMLElement {
    const el = createElement({
        tagName: 'button',
        tabindex: '0',
        id: opts.id,
        text: opts.text,
        attrs: opts.attrs,
        rect: {
            x: opts.x ?? 0,
            y: opts.y ?? 0,
            width: opts.width ?? 80,
            height: opts.height ?? 30,
        },
    });
    return attachElement(el);
}

// ---------------------------------------------------------------------------
// State factory
// ---------------------------------------------------------------------------

/**
 * Create a minimal SpatialNavState suitable for unit tests.
 *
 * The returned object satisfies the structural contract scoring/movement
 * actually reads from. Fields the SUT writes to are pre-initialized so we
 * never see undefined-property errors.
 */
export function createTestState(
    elements: HTMLElement[] = [],
    overrides: Partial<SpatialNavState> = {},
    configOverrides: Partial<SpatialNavConfig> = {}
): SpatialNavState {
    const focusables: FocusableEntry[] = elements.map((el, i) => {
        const r = el.getBoundingClientRect();
        return {
            element: el,
            index: i,
            left: r.left,
            top: r.top,
            right: r.right,
            bottom: r.bottom,
            width: r.width,
            height: r.height,
            centerX: r.left + r.width / 2,
            centerY: r.top + r.height / 2,
            rect: r,
            scrollKey: 'body',
            groupId: null,
        } satisfies FocusableEntry;
    });

    const baseConfig: SpatialNavConfig = {
        color: '#1565C0',
        outlineWidth: 3,
        outlineOffset: 3,
        overlayZIndex: 2147483646,
        arrowScale: 1,
        disabledColor: '128, 128, 128',
        overlayTheme: 'default',
        safeAreaMargin: 12,
        overlayScrimOpacity: 0.06,
        overlayGlowOpacity: 0.35,
        overlayGlowBlur: 14,
        overlayInnerGlowOpacity: 0.16,
        visibilityMode: 'always',
        enableFocusPulse: false,
        boundaryScrollBehavior: 'scroll',
        observeMutations: true,
        observeScroll: true,
        mutationDebounce: 100,
        scrollThreshold: 8,
        observeIntersection: false,
        intersectionRootMargin: '200px',
        intersectionThreshold: 0,
        autoRefocus: true,
        refocusStrategy: 'closest',
        iframeSupport: { enabled: false, selector: 'iframe', focusMethod: 'element' },
        focusGroups: { enabled: false, defaultRules: {}, boundaryBehavior: 'exit' },
        traverseShadowDom: false,
        observeVirtualContainers: true,
        virtualContainerSelectors: [],
        virtualScrollDebounce: 150,
        enableAria: false,
        announceNavigation: false,
        announceBoundaries: false,
        verboseDescriptions: false,
        focusTrapDetection: false,
        frameworkAwareRefresh: false,
        precomputeCandidates: false,
        precomputeCacheTimeout: 500,
        scoringMode: 'geometric',
        distanceFunction: 'euclidean',
        overlapThreshold: 0,
        gridAlignmentTolerance: 20,
        wrapNavigation: false,
        useCSSProperties: false,
        minElementSize: 1,
        ...configOverrides,
    };

    const state = {
        config: baseConfig,
        version: '3.0.0-test',
        currentIndex: -1,
        initialized: false,
        handlersAttached: false,
        runtime: {
            mode: 'injected',
            hasBrowser: false,
            hasChrome: false,
            canConnect: false,
            canSendMessage: false,
        },
        focusables,
        focusableElements: elements,
        focusGroups: {},
        lastRefreshTime: 0,
        focusableCount: focusables.length,
        previewEnabled: false,
        previewElements: null,
        previewLayer: null,
        overlay: null,
        overlayHost: null,
        activeResizeObserver: null,
        updateTimer: null,
        overlaySuppressed: false,
        suppressRecoveryTimer: null,
        nextTargets: { up: null, down: null, left: null, right: null },
        noTargetTimers: {},
        lastFocusedElement: null,
        lastFocusPosition: null,
        lastMove: null,
        lastBoundary: null,
        scrollCache: new WeakMap(),
        scrollListenerAttached: false,
        intersectionObserver: null,
        mutationObserver: null,
        emitTitleOnMismatch: false,
        instrumentation: {
            lastOverlay: '',
            lastActive: '',
            mismatchCount: 0,
            overlayIndex: -1,
            activeIndex: -1,
            lastMismatch: null,
            lastUpdate: 0,
            lastDirection: '',
        },
        perf: {
            refreshCount: 0,
            totalRefreshTime: 0,
            averageRefreshTime: 0,
            lastRefreshTime: 0,
            slowRefreshCount: 0,
        },
        virtualContainers: [],
        virtualSentinelObserver: null,
        virtualScrollPending: false,
        precomputedTargets: null,
        precomputedForIndex: -1,
        precomputedTimestamp: 0,
        dirty: false,
        announcer: null,
        currentTrap: null,
        detectedFramework: false,
        handlerId: 1,
        lastReportedModality: 'touch',
        ...overrides,
    } as unknown as SpatialNavState;

    return state;
}

// ---------------------------------------------------------------------------
// Keyboard event factory
// ---------------------------------------------------------------------------

interface KeyboardEventOptions {
    key: string;
    timeStamp?: number;
    bubbles?: boolean;
}

interface SpyKeyboardEvent extends KeyboardEvent {
    preventDefaultCalled: boolean;
    stopPropagationCalled: boolean;
    stopImmediatePropagationCalled: boolean;
}

/**
 * Create a real KeyboardEvent with tracked spy fields for `preventDefault` etc.
 *
 * happy-dom's KeyboardEvent supports the standard constructor; we wrap it to
 * record which methods the SUT called so tests can assert on side effects.
 */
export function createKeyboardEvent(options: KeyboardEventOptions): SpyKeyboardEvent {
    if (!activeWindow) throw new Error('setupDomEnv() must be called first');

    const Ctor = activeWindow.KeyboardEvent as unknown as new (
        type: string,
        init?: KeyboardEventInit
    ) => KeyboardEvent;
    const event = new Ctor('keydown', {
        key: options.key,
        bubbles: options.bubbles ?? true,
        cancelable: true,
    });

    // happy-dom's timeStamp isn't writable on the event prototype — patch the instance.
    if (options.timeStamp !== undefined) {
        Object.defineProperty(event, 'timeStamp', {
            value: options.timeStamp,
            configurable: true,
        });
    }

    const spy = event as SpyKeyboardEvent;
    spy.preventDefaultCalled = false;
    spy.stopPropagationCalled = false;
    spy.stopImmediatePropagationCalled = false;

    const origPrevent = event.preventDefault.bind(event);
    const origStop = event.stopPropagation.bind(event);
    const origStopImmediate = event.stopImmediatePropagation.bind(event);

    spy.preventDefault = function () {
        spy.preventDefaultCalled = true;
        origPrevent();
    };
    spy.stopPropagation = function () {
        spy.stopPropagationCalled = true;
        origStop();
    };
    spy.stopImmediatePropagation = function () {
        spy.stopImmediatePropagationCalled = true;
        origStopImmediate();
    };

    return spy;
}

// ---------------------------------------------------------------------------
// Misc helpers
// ---------------------------------------------------------------------------

/** Read a DOM attribute on documentElement (used to test handler-id stamping). */
export function getRootAttr(name: string): string | null {
    if (!activeWindow) return null;
    return activeWindow.document.documentElement.getAttribute(name);
}

/** Set a DOM attribute on documentElement (used to seed handler-id state). */
export function setRootAttr(name: string, value: string): void {
    if (!activeWindow) throw new Error('setupDomEnv() must be called first');
    activeWindow.document.documentElement.setAttribute(name, value);
}

/** Set the active element by calling .focus() on it. */
export function setActiveElement(el: HTMLElement | null): void {
    if (!activeWindow) throw new Error('setupDomEnv() must be called first');
    if (el) {
        el.focus();
    } else {
        (activeWindow.document.activeElement as unknown as HTMLElement | null)?.blur?.();
    }
}

// ---------------------------------------------------------------------------
// Browser-bridge mock (shared between handlers/messaging/validation tests)
// ---------------------------------------------------------------------------

export interface SendCapture {
    count: number;
    messages: unknown[];
}

interface MockBrowserRuntime {
    connect?: (opts: { name: string }) => unknown;
    sendMessage?: (msg: unknown, callback?: (response: unknown) => void) => unknown;
    sendNativeMessage?: (appId: string, msg: unknown) => Promise<unknown>;
    lastError?: unknown;
    onMessage?: { addListener: (cb: unknown) => void };
}

/**
 * Install a fake `browser.runtime` on globalThis and return a capture object
 * that records every message passed to `sendMessage`. Callers can extend the
 * runtime by mutating the returned object or passing `overrides`.
 */
export function installBrowserBridge(overrides: Partial<MockBrowserRuntime> = {}): SendCapture {
    const capture: SendCapture = { count: 0, messages: [] };
    const runtime: MockBrowserRuntime = {
        sendMessage: (msg, callback) => {
            capture.count++;
            capture.messages.push(msg);
            callback?.(undefined);
        },
        ...overrides,
    };
    (globalThis as { browser?: { runtime: MockBrowserRuntime } }).browser = { runtime };
    return capture;
}

/** Remove the browser bridge installed by `installBrowserBridge`. */
export function removeBrowserBridge(): void {
    (globalThis as { browser?: unknown }).browser = undefined;
}

/**
 * Install a fake `chrome.runtime` on globalThis (callback-style messaging API)
 * with no `browser` global. Used by tests asserting the Chrome-callback path
 * in `utils/bridge.ts` and the `isFirefoxStyle === false` branch.
 */
export function installChromeBridge(overrides: Partial<MockBrowserRuntime> = {}): SendCapture {
    const capture: SendCapture = { count: 0, messages: [] };
    const runtime: MockBrowserRuntime = {
        sendMessage: (msg, callback) => {
            capture.count++;
            capture.messages.push(msg);
            callback?.(undefined);
        },
        ...overrides,
    };
    const g = globalThis as { browser?: unknown; chrome?: { runtime: MockBrowserRuntime } };
    g.browser = undefined;
    g.chrome = { runtime };
    return capture;
}

/** Remove the chrome bridge installed by `installChromeBridge`. */
export function removeChromeBridge(): void {
    (globalThis as { chrome?: unknown }).chrome = undefined;
}

/** Install a fake `ReactNativeWebView.postMessage` global for platform detection. */
export function installReactNativeBridge(): void {
    (globalThis as { ReactNativeWebView?: { postMessage: (m: unknown) => void } }).ReactNativeWebView = {
        postMessage: () => {},
    };
}

/** Remove the React Native bridge. */
export function removeReactNativeBridge(): void {
    (globalThis as { ReactNativeWebView?: unknown }).ReactNativeWebView = undefined;
}

/** Install a fake `webkit.messageHandlers` global for platform detection. */
export function installWebkitBridge(): void {
    (globalThis as { webkit?: { messageHandlers: Record<string, unknown> } }).webkit = {
        messageHandlers: {},
    };
}

/** Remove the webkit bridge. */
export function removeWebkitBridge(): void {
    (globalThis as { webkit?: unknown }).webkit = undefined;
}

/** Install a fake `SpatialNavBridge` global for Android-WebView platform detection. */
export function installAndroidWebViewBridge(): void {
    (globalThis as { SpatialNavBridge?: unknown }).SpatialNavBridge = {};
}

/** Remove the Android WebView bridge. */
export function removeAndroidWebViewBridge(): void {
    (globalThis as { SpatialNavBridge?: unknown }).SpatialNavBridge = undefined;
}

/** Clear every platform bridge — call from `afterEach` to keep tests isolated. */
export function removeAllBridges(): void {
    removeBrowserBridge();
    removeChromeBridge();
    removeReactNativeBridge();
    removeWebkitBridge();
    removeAndroidWebViewBridge();
}

// ---------------------------------------------------------------------------
// Shadow DOM + observer trigger helpers
// ---------------------------------------------------------------------------

/**
 * Create a host element with an open shadow root and optional inner HTML.
 * The host is attached to document.body and returned alongside its shadow root.
 */
export function createShadowHost(html = ''): {
    host: HTMLElement;
    shadow: ShadowRoot;
} {
    if (!activeWindow) throw new Error('setupDomEnv() must be called first');
    const host = createElement({ tagName: 'div' });
    attachElement(host);
    const shadow = host.attachShadow({ mode: 'open' });
    if (html) {
        (shadow as unknown as { innerHTML: string }).innerHTML = html;
    }
    return { host, shadow };
}

/**
 * Replace globalThis.IntersectionObserver with a recording fake whose callback
 * can be invoked via the returned `trigger(entries, observer?)` function.
 *
 * The fake records every `observe(el)` and `unobserve(el)` call in `observed`
 * / `unobserved` arrays and exposes the most recently created observer via
 * `lastObserver`. Restore the original IntersectionObserver via `restore()`.
 */
export interface IntersectionRecorder {
    instances: FakeIntersectionObserver[];
    lastObserver: FakeIntersectionObserver | null;
    /**
     * Invoke the callback of the most recent observer with synthetic entries.
     * Each entry is materialized into a minimal IntersectionObserverEntry.
     */
    trigger(entries: { target: Element; isIntersecting: boolean }[]): void;
    restore(): void;
}

interface FakeIntersectionObserver {
    observed: Element[];
    unobserved: Element[];
    disconnected: boolean;
    callback: IntersectionObserverCallback;
    options: IntersectionObserverInit | undefined;
}

export function installFakeIntersectionObserver(): IntersectionRecorder {
    const g = globalThis as { IntersectionObserver?: typeof IntersectionObserver };
    const orig = g.IntersectionObserver;
    const recorder: IntersectionRecorder = {
        instances: [],
        lastObserver: null,
        trigger(entries) {
            const obs = recorder.lastObserver;
            if (!obs) return;
            const ioEntries = entries.map(
                (e) =>
                    ({
                        target: e.target,
                        isIntersecting: e.isIntersecting,
                        intersectionRatio: e.isIntersecting ? 1 : 0,
                        boundingClientRect: e.target.getBoundingClientRect(),
                        intersectionRect: e.target.getBoundingClientRect(),
                        rootBounds: null,
                        time: performance.now(),
                    }) as IntersectionObserverEntry
            );
            obs.callback(ioEntries, obs as unknown as IntersectionObserver);
        },
        restore() {
            if (orig) g.IntersectionObserver = orig;
            else delete g.IntersectionObserver;
        },
    };

    g.IntersectionObserver = function FakeIO(
        this: FakeIntersectionObserver,
        cb: IntersectionObserverCallback,
        options?: IntersectionObserverInit
    ) {
        this.observed = [];
        this.unobserved = [];
        this.disconnected = false;
        this.callback = cb;
        this.options = options;
        recorder.instances.push(this);
        recorder.lastObserver = this;
    } as unknown as typeof IntersectionObserver;

    (g.IntersectionObserver as unknown as { prototype: object }).prototype = {
        observe(this: FakeIntersectionObserver, target: Element) {
            this.observed.push(target);
        },
        unobserve(this: FakeIntersectionObserver, target: Element) {
            this.unobserved.push(target);
        },
        disconnect(this: FakeIntersectionObserver) {
            this.disconnected = true;
        },
        takeRecords() {
            return [];
        },
    };

    return recorder;
}

// ---------------------------------------------------------------------------
// Microtask + console helpers
// ---------------------------------------------------------------------------

/** Yield to the microtask queue once. Use after fake-async work that schedules via Promise.resolve(). */
export function flushMicrotasks(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

export interface ConsoleCapture {
    log: unknown[][];
    info: unknown[][];
    warn: unknown[][];
    error: unknown[][];
    debug: unknown[][];
    group: unknown[][];
    groupEnd: number;
    restore(): void;
}

/**
 * Replace console.{log,info,warn,error,debug,group,groupEnd} with array-pushing
 * spies. Returns the capture buffers plus a `restore()` to undo the patch.
 *
 * Each call records the variadic arguments array, so assertions can match
 * either the first argument (`capture.warn[0][0]`) or the full call shape.
 */
export function captureConsole(): ConsoleCapture {
    const orig = {
        log: console.log,
        info: console.info,
        warn: console.warn,
        error: console.error,
        debug: console.debug,
        group: console.group,
        groupEnd: console.groupEnd,
    };
    const capture: ConsoleCapture = {
        log: [],
        info: [],
        warn: [],
        error: [],
        debug: [],
        group: [],
        groupEnd: 0,
        restore() {
            console.log = orig.log;
            console.info = orig.info;
            console.warn = orig.warn;
            console.error = orig.error;
            console.debug = orig.debug;
            console.group = orig.group;
            console.groupEnd = orig.groupEnd;
        },
    };
    console.log = (...args: unknown[]) => capture.log.push(args);
    console.info = (...args: unknown[]) => capture.info.push(args);
    console.warn = (...args: unknown[]) => capture.warn.push(args);
    console.error = (...args: unknown[]) => capture.error.push(args);
    console.debug = (...args: unknown[]) => capture.debug.push(args);
    console.group = (...args: unknown[]) => capture.group.push(args);
    console.groupEnd = () => {
        capture.groupEnd++;
    };
    return capture;
}
