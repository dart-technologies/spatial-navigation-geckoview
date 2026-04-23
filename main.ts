/**
 * GeckoView Spatial Navigation — content-script entry point.
 *
 * Orchestrates initialization of all spatial navigation modules. Loaded by the
 * WebExtension manifest as a content script (`run_at: document_end`).
 *
 * Init pipeline (see {@link initSpatialNavigation}):
 *   1. Load and validate user config
 *   2. Build global state
 *   3. Connect background-script port for native messaging
 *   4. Install overlay + accessibility announcer
 *   5. Discover focusables and attach observers
 *   6. Attach keyboard handlers
 *   7. Install WICG polyfill
 *   8. Wire blur/visibility/exit listeners
 *
 * @see https://drafts.csswg.org/css-nav-1/
 * @see https://firefox-source-docs.mozilla.org/mobile/android/geckoview/consumer/web-extensions.html
 */

import { getConfig, directionByName, validateUserConfig, type DirectionName } from './core/config';
import { getState, type SpatialNavState } from './core/state';
import { ensureStyles, ensureOverlay, showOverlay, hideOverlay } from './core/overlay';
import { hidePreviewElements } from './core/preview';
import {
    refreshFocusables,
    getActiveElement,
    describeElement,
    attachVirtualScrollSentinels,
    setupAccessibilityAnnouncer,
} from './utils/dom';
import { attachHandlers } from './navigation/handlers';
import { attachMutationObserver } from './utils/observer';
import { initDebugApi } from './utils/debug';
import { detectRuntimeContext, formatRuntimeLabel } from './utils/runtime';
import { moveInDirection } from './navigation/movement';
import { findDirectionalCandidate } from './core/scoring';
import { createLogger } from './utils/logger';
import { installLegacyDeprecations } from './utils/deprecation';
import { GeckoViewMessagingAdapter, NoopMessagingAdapter } from './messaging';
import type { MessagingAdapter, InboundMessage } from './messaging';
import type { FocusableAreasOptions, SpatialNavigationSearchOptions } from './globals';

const log = createLogger('Main');

const STYLE_ID = 'spatnav-focus-styles';
const OVERLAY_HOST_ID = 'spatnav-focus-host';
const VERSION = '3.0.0';

// Debounce window for the pageshow re-init handler. Below this threshold we
// treat consecutive events as the same logical navigation.
const PAGESHOW_DEBOUNCE_MS = 100;

let messagingAdapter: MessagingAdapter | null = null;

/**
 * Connect to native layer via a MessagingAdapter.
 *
 * The adapter owns connection lifecycle, reconnect backoff, and the port
 * abstraction. This function only wires response routing into the spatial
 * navigation state.
 */
function connectMessaging(state: SpatialNavState): MessagingAdapter {
    if (messagingAdapter) return messagingAdapter;

    // Pick an adapter based on which WebExtension bridge (if any) is available.
    const adapter: MessagingAdapter =
        typeof browser !== 'undefined' && browser?.runtime
            ? new GeckoViewMessagingAdapter({ nativeAppId: state.config.nativeAppId })
            : new NoopMessagingAdapter();
    messagingAdapter = adapter;

    adapter.onMessage((message) => handleNativeResponse(message, state));

    adapter.connect().catch((e) => {
        log.debug('native connection failed', (e as Error).message);
    });

    return adapter;
}

/**
 * Handle responses from native layer.
 */
function handleNativeResponse(message: InboundMessage, state: SpatialNavState): void {
    if (!message || !message.type) return;

    switch (message.type) {
        case 'configUpdate': {
            const cfg = (message as InboundMessage & { config?: unknown }).config;
            if (cfg) {
                // Re-validate any runtime config push from native to keep the
                // schema-validation guarantee end-to-end.
                const validated = validateUserConfig(cfg as Record<string, unknown>);
                Object.assign(state.config, validated);
                log.info('Config updated from native', validated);
            }
            break;
        }

        case 'navigate': {
            const dir = (message as InboundMessage & { direction?: DirectionName }).direction;
            if (dir && directionByName[dir]) {
                moveInDirection(directionByName[dir], null, state);
            }
            break;
        }

        case 'refresh':
            refreshFocusables(state);
            break;

        default:
            log.debug('Unknown message type', message.type);
    }
}

/**
 * Send a message to the native layer via the active messaging adapter.
 */
function postToNative(message: {
    type:
        | 'spatialNavInit'
        | 'focusChange'
        | 'focusExit'
        | 'tabClosed'
        | 'extensionInstalled'
        | 'extensionUpdated';
    [key: string]: unknown;
}): boolean {
    return messagingAdapter?.send(message) ?? false;
}

/**
 * Install WICG-compatible APIs on global objects.
 *
 * Idempotent: each method is feature-detected, so existing browser-native
 * implementations (or earlier polyfill installs) are not clobbered.
 */
function installWICGPolyfill(state: SpatialNavState): void {
    if ('navigate' in window) {
        return;
    }

    window.navigate = function (dir: DirectionName): void {
        const direction = directionByName[dir];
        if (direction) {
            moveInDirection(direction, null, state);
        }
    };

    if (!Element.prototype.spatialNavigationSearch) {
        Element.prototype.spatialNavigationSearch = function (
            this: Element,
            dir: DirectionName,
            _options: SpatialNavigationSearchOptions = {}
        ): Element | null {
            const direction = directionByName[dir];
            if (!direction) return null;

            const el = this as HTMLElement;
            const index = state.focusableElements.indexOf(el);
            if (index === -1) return null;

            const candidate = findDirectionalCandidate(index, direction, state);
            if (!candidate) {
                log.debug(`spatialNavigationSearch: no candidate for ${direction.name}`);
            }
            return candidate?.data.element ?? null;
        };
    }

    if (!Element.prototype.focusableAreas) {
        const selector =
            'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

        Element.prototype.focusableAreas = function (
            this: Element,
            options: FocusableAreasOptions = { mode: 'visible' }
        ): Element[] {
            const all = Array.from(this.querySelectorAll(selector)) as Element[];
            if (options.mode === 'all') return all;

            return all.filter((el) => {
                const style = window.getComputedStyle(el);
                if (style.visibility === 'hidden' || style.display === 'none') return false;
                const rect = el.getBoundingClientRect();
                return rect.width > 0 && rect.height > 0;
            });
        };
    }

    if (!Element.prototype.getSpatialNavigationContainer) {
        Element.prototype.getSpatialNavigationContainer = function (this: Element): Element {
            // Walk ancestors looking for an explicit focus group, a CSS-marked
            // navigation container, or a scroll container. Falls back to the
            // document root.
            // eslint-disable-next-line @typescript-eslint/no-this-alias
            let walker: Element | null = this;
            while (walker && walker !== document.documentElement) {
                if (walker.hasAttribute('data-focus-group')) return walker;
                const style = window.getComputedStyle(walker);
                const overflow = (style.overflow + style.overflowX + style.overflowY).toLowerCase();
                if (overflow.includes('auto') || overflow.includes('scroll')) return walker;
                walker = walker.parentElement;
            }
            return document.documentElement;
        };
    }

    log.debug('WICG polyfill installed');
}

/**
 * Re-attach DOM-tied resources after a same-document SPA navigation.
 *
 * Why we need this: when GeckoView swaps the document during pageshow, the
 * styles, overlay host, and observer instances are torn off the DOM, but the
 * window-level event listeners survive. This rebuilds the DOM-side state in
 * place rather than letting the page run with broken visuals.
 */
function reinitializeAfterPageshow(state: SpatialNavState): void {
    const config = state.config;

    const hasStyle = !!document.getElementById(STYLE_ID);
    const hasOverlayHost = !!document.getElementById(OVERLAY_HOST_ID);
    const overlayAttached =
        !!state.overlayHost && !!document.body && document.body.contains(state.overlayHost);

    log.debug('pageshow audit', {
        readyState: document.readyState,
        hasStyle,
        hasOverlayHost,
        overlayAttached,
        focusableCount: state.focusableCount,
    });

    const needsStyles = !hasStyle;
    const needsOverlay = !hasOverlayHost || !overlayAttached;

    if (!needsStyles && !needsOverlay) {
        log.debug('pageshow: DOM intact, no re-init needed');
        return;
    }

    log.debug('pageshow: re-initializing', { needsStyles, needsOverlay });

    if (needsOverlay) {
        state.overlayHost = null;
        state.overlay = null;
    }

    if (needsStyles) {
        ensureStyles(config);
    }

    if (needsOverlay) {
        ensureOverlay(config, state);
    }

    if (state.mutationObserver) {
        state.mutationObserver.disconnect();
        state.mutationObserver = null;
    }
    attachMutationObserver(state);

    if (state.virtualSentinelObserver) {
        state.virtualSentinelObserver.disconnect();
        state.virtualSentinelObserver = null;
    }
    attachVirtualScrollSentinels(state);

    refreshFocusables(state);
    showOverlay(null, state);
}

/**
 * Run the full initialization pipeline.
 *
 * Multiple init attempts can occur if GeckoView re-injects the content
 * script: each call gets fresh state and a new handler ID. Stale handlers from
 * prior injections short-circuit themselves via the DOM-level `data-spatnav-handler-id`
 * attribute (see {@link ./navigation/handlers.ts}). That event-level guard is
 * the dedup mechanism — we deliberately do **not** also gate at the init level,
 * because past attempts to do so left stale handlers attached after navigation.
 */
function initSpatialNavigation(): void {
    // Bump the global init counter so the debug API can surface multi-injection issues.
    window.__SPATIAL_NAV_INIT_COUNT__ = (window.__SPATIAL_NAV_INIT_COUNT__ || 0) + 1;
    const initAttempt = window.__SPATIAL_NAV_INIT_COUNT__;

    log.debug(`init attempt #${initAttempt}`, {
        url: location.href.substring(0, 100),
        readyState: document.readyState,
        hasBody: !!document.body,
        isTop: window === window.top,
    });

    // Skip iframes — only the top-level frame should host navigation, otherwise
    // analytics/tracking iframes also load the extension and double-handle keys.
    if (window !== window.top) {
        log.debug('Skipping iframe', window.location.href.substring(0, 80));
        return;
    }

    // GeckoView fires multiple document states during navigation. Wait for a
    // real document with a body before initializing.
    if (location.href === 'about:blank') {
        log.debug('Skipping about:blank');
        return;
    }
    if (document.readyState === 'loading' && !document.body) {
        log.debug('Skipping loading document without body');
        return;
    }

    document.documentElement.setAttribute('data-spatnav-init', String(initAttempt));
    window.__SPATIAL_NAV_INIT_COMPLETE__ = true;

    // 1. Load + validate configuration
    const config = getConfig();

    // 2. Initialize global state
    const state = getState(config);
    state.version = VERSION;
    state.runtime = detectRuntimeContext();
    log.info(`runtime mode: ${formatRuntimeLabel(state.runtime)}`, state.runtime);
    log.info(`init v${state.version}`, location.href);

    // 3. Connect to background script for native messaging
    connectMessaging(state);

    // 4. Send native message to confirm initialization
    postToNative({
        type: 'spatialNavInit',
        version: state.version,
        url: location.href,
        timestamp: Date.now(),
    });

    // 5. Setup visual overlay
    ensureStyles(config);
    ensureOverlay(config, state);

    // 6. Setup accessibility announcer
    setupAccessibilityAnnouncer(state);

    // 7. Discover focusable elements
    refreshFocusables(state);

    // 8. Attach virtual scroll sentinels
    attachVirtualScrollSentinels(state);

    if (state.instrumentation) {
        const active = getActiveElement();
        state.instrumentation.lastActive = describeElement(active);
        state.instrumentation.activeIndex = state.currentIndex;
    }

    // 9. Attach event handlers.
    // Reset handlersAttached so a fresh handler ID supersedes any stale handler
    // from a prior injection (see comment on initSpatialNavigation).
    state.handlersAttached = false;
    attachHandlers(state);

    // 10. Attach mutation observer
    attachMutationObserver(state);

    // 11. Initialize debug API
    initDebugApi(state);

    // 12. Install WICG polyfill
    installWICGPolyfill(state);

    // 13. Expose public API
    window.spatialNavState = state;
    window.showSpatialNavOverlay = (element: HTMLElement | null) => showOverlay(element, state);

    // 14. Install legacy aliases with deprecation warnings (removed in v4)
    installLegacyDeprecations(state, (element) => showOverlay(element, state));

    // 15. Don't auto-focus initial element — wait for user navigation from the
    //     host app. Auto-focusing causes a ghost overlay before the user
    //     enters web content.
    showOverlay(null, state);

    state.initialized = true;
    log.info('initialization complete');

    const suppressOverlay = (reason: string): void => {
        state.overlaySuppressed = true;
        if (state.updateTimer) {
            cancelAnimationFrame(state.updateTimer);
            state.updateTimer = null;
        }
        hideOverlay(state);
        hidePreviewElements(state);
        log.debug(`overlay suppressed (${reason})`);
    };

    // 16. Hide overlay when focus leaves the document (e.g., returning to address bar)
    window.addEventListener('blur', () => suppressOverlay('window.blur'));

    document.addEventListener('visibilitychange', () => {
        if (document.hidden) suppressOverlay('document.hidden');
    });

    // Hide overlay when spatial navigation exits to native UI
    document.addEventListener('spatialNavigationExit', () => suppressOverlay('spatialNavigationExit'));

    // 17. Re-initialize on page navigation
    let lastPageshowTime = 0;
    window.addEventListener('pageshow', () => {
        const now = Date.now();
        if (now - lastPageshowTime < PAGESHOW_DEBOUNCE_MS) {
            log.debug('pageshow debounced');
            return;
        }
        lastPageshowTime = now;
        reinitializeAfterPageshow(state);
    });
}

initSpatialNavigation();
