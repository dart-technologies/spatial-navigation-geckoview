/**
 * GeckoView Spatial Navigation
 *
 * Orchestrates initialization of all spatial navigation modules.
 * This file is the entry point for the rollup bundle.
 *
 * Features:
 * - WICG Spatial Navigation API compatibility (window.navigate, Element.spatialNavigationSearch)
 * - Connection-based native messaging for lower latency
 * - Background script for robust message routing
 * - TypeScript type definitions
 * - Multiple output formats (UMD, ESM, IIFE)
 * - GitHub Packages publishing ready
 *
 * @see https://drafts.csswg.org/css-nav-1/
 * @see https://firefox-source-docs.mozilla.org/mobile/android/geckoview/consumer/web-extensions.html
 */

import { getConfig, updateConfig as updateConfigImpl, directionByName, type DirectionName } from './core/config';
import { getState, type SpatialNavState } from './core/state';
import { ensureStyles, ensureOverlay, showOverlay, hideOverlay } from './core/overlay';
import { hidePreviewElements } from './core/preview';
import {
    refreshFocusables,
    getActiveElement,
    describeElement,
    attachVirtualScrollSentinels,
    setupAccessibilityAnnouncer
} from './utils/dom';
import { attachHandlers } from './navigation/handlers';
import { attachMutationObserver } from './utils/observer';
import { initDebugApi } from './utils/debug';
import { detectRuntimeContext, formatRuntimeLabel } from './utils/runtime';
import { moveInDirection } from './navigation/movement';
import { findDirectionalCandidate } from './core/scoring';
import { safeJson } from './utils/json';
import { createLogger, DEBUG } from './utils/logger';
import type { FocusableAreasOptions, SpatialNavigationSearchOptions } from './globals';

// Create logger for main module
const log = createLogger('Main');

// Extend global interfaces for WICG and GeckoView APIs
declare global {
    // GeckoView browser API
    const browser: {
        runtime?: {
            connect?: (options: { name: string }) => BrowserPort;
            sendNativeMessage?: (appId: string, message: unknown) => Promise<unknown>;
        };
    } | undefined;
    interface BrowserPort {
        postMessage: (message: unknown) => void;
        onMessage: { addListener: (callback: (message: unknown) => void) => void };
        onDisconnect: { addListener: (callback: () => void) => void };
    }
}

// Constants for DOM element IDs
const STYLE_ID = 'spatnav-focus-styles';
const OVERLAY_HOST_ID = 'spatnav-focus-host';

// Native app identifier for GeckoView messaging
const NATIVE_APP_ID = 'flutter_geckoview';
const VERSION = '3.0.0';

// Background script port for connection-based messaging
let backgroundPort: BrowserPort | null = null;

interface NativeMessage {
    type: string;
    config?: object;
    direction?: DirectionName;
    [key: string]: unknown;
}



/**
 * Connect to background script for native messaging relay.
 */
function connectToBackground(state: SpatialNavState): BrowserPort | null {
    if (backgroundPort) {
        return backgroundPort;
    }

    try {
        if (typeof browser !== 'undefined' && browser?.runtime?.connect) {
            backgroundPort = browser.runtime.connect({ name: 'spatial-nav-content' });

            backgroundPort.onMessage.addListener((message) => {
                console.log(`[SpatialNav] Message from background: ${safeJson(message)}`);
                handleNativeResponse(message as NativeMessage, state);
            });

            backgroundPort.onDisconnect.addListener(() => {
                console.log('[SpatialNav] Background port disconnected');
                backgroundPort = null;
            });

            console.log('[SpatialNav] Connected to background script');
            return backgroundPort;
        }
    } catch (e) {
        console.log('[SpatialNav] Background connection not available:', (e as Error).message);
    }
    return null;
}

/**
 * Handle responses from native layer (via background script).
 */
function handleNativeResponse(message: NativeMessage, state: SpatialNavState): void {
    if (!message || !message.type) return;

    switch (message.type) {
        case 'configUpdate':
            if (message.config) {
                updateConfigImpl(message.config);
                console.log(`[SpatialNav] Config updated from native: ${safeJson(message.config)}`);
            }
            break;

        case 'navigate':
            if (message.direction && directionByName[message.direction]) {
                moveInDirection(directionByName[message.direction], null, state);
            }
            break;

        case 'refresh':
            refreshFocusables(state);
            break;

        default:
            console.log('[SpatialNav] Unknown message type:', message.type);
    }
}

/**
 * Send message to native layer via background script.
 */
function postToNative(message: NativeMessage): boolean {
    if (backgroundPort) {
        try {
            backgroundPort.postMessage(message);
            return true;
        } catch (e) {
            console.warn('[SpatialNav] Failed to post to background:', (e as Error).message);
            backgroundPort = null;
        }
    }

    // Fallback to direct sendNativeMessage
    try {
        if (typeof browser !== 'undefined' && browser?.runtime?.sendNativeMessage) {
            browser.runtime.sendNativeMessage(NATIVE_APP_ID, message);
            return true;
        }
    } catch {
        // Silently fail
    }
    return false;
}

// ============================================================================
// WICG Polyfill Installation
// ============================================================================

/**
 * Install WICG-compatible APIs on global objects.
 */
function installWICGPolyfill(state: SpatialNavState): void {
    // Skip if already installed
    if ('navigate' in window) {
        return;
    }

    // window.navigate(dir)
    window.navigate = function (dir: DirectionName): void {
        const direction = directionByName[dir as DirectionName];
        if (direction) {
            moveInDirection(direction, null, state);
        }
    };

    // Element.prototype.spatialNavigationSearch(dir, options)
    if (!Element.prototype.spatialNavigationSearch) {
        Element.prototype.spatialNavigationSearch = function (this: Element, dir: DirectionName, options: SpatialNavigationSearchOptions = {}): Element | null {
            const direction = directionByName[dir as DirectionName];
            if (!direction) return null;

            // Cast 'this' to HTMLElement because focusableElements contains HTMLElements
            const el = this as HTMLElement;
            const index = state.focusableElements.indexOf(el);
            if (index === -1) return null;

            const candidate = findDirectionalCandidate(index, direction, state);
            if (!candidate && (window as any).flutterSpatialNavDebug) {
                console.log(`[SpatialNav] spatialNavigationSearch: No candidate found for ${direction.name} from element`, el);
            }
            return candidate?.data.element ?? null;
        };
    }

    // Element.prototype.focusableAreas(options)
    if (!Element.prototype.focusableAreas) {
        const selector = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

        Element.prototype.focusableAreas = function (this: Element, options: FocusableAreasOptions = { mode: 'visible' }): Element[] {
            // Explicitly cast the Array.from result to Element[]
            const all = Array.from(this.querySelectorAll(selector)) as Element[];
            if (options.mode === 'all') return all;

            return all.filter(el => {
                const style = window.getComputedStyle(el);
                if (style.visibility === 'hidden' || style.display === 'none') return false;
                const rect = el.getBoundingClientRect();
                return rect.width > 0 && rect.height > 0;
            });
        };
    }

    // Element.prototype.getSpatialNavigationContainer()
    if (!Element.prototype.getSpatialNavigationContainer) {
        Element.prototype.getSpatialNavigationContainer = function (this: Element): Element {
            let current: Element | null = this;
            while (current && current !== document.documentElement) {
                if (current.hasAttribute('data-focus-group')) return current;
                const style = window.getComputedStyle(current);
                const overflow = (style.overflow + style.overflowX + style.overflowY).toLowerCase();
                if (overflow.includes('auto') || overflow.includes('scroll')) return current;
                current = current.parentElement;
            }
            return document.documentElement;
        };
    }

    console.log('[SpatialNav] WICG polyfill installed');
}

// ============================================================================
// Initialization
// ============================================================================

// Global initialization guard to prevent double initialization
// This can happen if GeckoView injects the script multiple times
declare global {
    interface Window {
        __SPATIAL_NAV_INIT_COMPLETE__?: boolean;
    }
}

// Track initialization attempts globally
declare global {
    interface Window {
        __SPATIAL_NAV_INIT_COUNT__?: number;
        flutterSpatialNavDebug?: boolean; // Added for debug mode
    }
}

// Enable debug logging by default for development
(window as any).flutterSpatialNavDebug = true;

// Initialize system when content script loads
// Manifest specifies "run_at": "document_end" so DOM is already ready
(function () {
    // DEBUG: Track initialization attempts
    window.__SPATIAL_NAV_INIT_COUNT__ = (window.__SPATIAL_NAV_INIT_COUNT__ || 0) + 1;
    const initAttempt = window.__SPATIAL_NAV_INIT_COUNT__;
    const initTime = Date.now();

    console.log(`[SpatialNav DEBUG] ========== INIT ATTEMPT #${initAttempt} @ ${initTime} ==========`);
    console.log(`[SpatialNav DEBUG] URL: ${location.href.substring(0, 100)}`);
    console.log(`[SpatialNav DEBUG] readyState: ${document.readyState}`);
    console.log(`[SpatialNav DEBUG] hasBody: ${!!document.body}`);
    console.log(`[SpatialNav DEBUG] isTop: ${window === window.top}`);
    console.log(`[SpatialNav DEBUG] data-spatnav-init: ${document.documentElement.getAttribute('data-spatnav-init')}`);
    console.log(`[SpatialNav DEBUG] __SPATIAL_NAV_INIT_COMPLETE__: ${window.__SPATIAL_NAV_INIT_COMPLETE__}`);
    console.log(`[SpatialNav DEBUG] __SPATIAL_NAV_HANDLERS_ATTACHED__: ${(window as unknown as { __SPATIAL_NAV_HANDLERS_ATTACHED__?: boolean }).__SPATIAL_NAV_HANDLERS_ATTACHED__}`);

    // Skip initialization in iframes - only run in top-level frame
    // This prevents duplicate event handling and focus conflicts
    // when analytics/tracking iframes also load the extension
    if (window !== window.top) {
        console.log(`[SpatialNav DEBUG] ❌ SKIPPING: iframe`);
        console.log('[SpatialNav] Skipping iframe:', window.location.href.substring(0, 80));
        return;
    }

    // Skip initialization on transient/intermediate documents
    // GeckoView creates multiple document states during navigation - only init on final document
    // Detect transient state: about:blank, incomplete DOM, or readyState not complete
    if (location.href === 'about:blank') {
        console.log(`[SpatialNav DEBUG] ❌ SKIPPING: about:blank`);
        console.log('[SpatialNav] Skipping about:blank');
        return;
    }
    if (document.readyState === 'loading' && !document.body) {
        console.log(`[SpatialNav DEBUG] ❌ SKIPPING: loading without body`);
        console.log('[SpatialNav] Skipping loading document without body');
        return;
    }

    // Check existing initialization markers
    const initMarker = document.documentElement.getAttribute('data-spatnav-init');
    const windowFlag = window.__SPATIAL_NAV_INIT_COMPLETE__;

    console.log(`[SpatialNav DEBUG] Existing markers: DOM="${initMarker}", window=${windowFlag}`);

    // REMOVED: DOM and window guards were causing stale handlers
    // Event-level deduplication (__spatnav_processed__) handles duplicate events
    // Each init gets fresh state + handlers, old handlers become no-ops via event marker

    console.log(`[SpatialNav DEBUG] ✅ PROCEEDING WITH INIT #${initAttempt} (guards disabled for debugging)`);

    // Set markers for reference (not used as guards anymore)
    document.documentElement.setAttribute('data-spatnav-init', String(initAttempt));
    window.__SPATIAL_NAV_INIT_COMPLETE__ = true;

    // 1. Load configuration
    const config = getConfig();

    // 2. Initialize global state
    const state = getState(config);
    state.version = VERSION;
    state.runtime = detectRuntimeContext();
    console.log(`[SpatialNav] Runtime mode: ${formatRuntimeLabel(state.runtime)} ${safeJson(state.runtime)}`);

    // Log initialization to verify injection
    console.log('[SpatialNav] init v' + state.version, location.href);

    // 3. Connect to background script for native messaging
    connectToBackground(state);

    // 4. Send native message to confirm initialization
    postToNative({
        type: 'spatialNavInit',
        version: state.version,
        url: location.href,
        timestamp: Date.now()
    } as NativeMessage);

    // 5. Setup visual overlay
    ensureStyles(config);
    ensureOverlay(config, state);

    // 6. Setup accessibility announcer
    setupAccessibilityAnnouncer(state);

    // 7. Discover focusable elements
    refreshFocusables(state);

    // 8. Attach virtual scroll sentinels
    attachVirtualScrollSentinels(state);

    // Update initial instrumentation
    if (state.instrumentation) {
        const active = getActiveElement();
        state.instrumentation.lastActive = describeElement(active);
        state.instrumentation.activeIndex = state.currentIndex;
    }

    // 9. Attach event handlers
    // CRITICAL: Reset handlersAttached to force new handler with new ID
    // The closure check in the handler will block old handlers from previous inits
    state.handlersAttached = false;
    attachHandlers(state);

    // 10. Attach mutation observer
    attachMutationObserver(state);

    // 11. Initialize debug API
    initDebugApi(state);

    // 12. Install WICG polyfill
    installWICGPolyfill(state);

    // 13. Expose public API (new names)
    window.spatialNavState = state;
    window.showSpatialNavOverlay = (element: HTMLElement | null) => showOverlay(element, state);

    // Legacy Flutter names (deprecated, for backwards compatibility)
    window.flutterFocusState = state;
    window.flutterShowOverlay = (element: HTMLElement | null) => showOverlay(element, state);

    // 14. Handle initial focus
    // Don't auto-focus initial element - wait for user navigation from app
    // This prevents ghost overlay from appearing before user enters web content
    showOverlay(null, state);

    // 15. Mark state as initialized
    state.initialized = true;
    console.log('[SpatialNav] Initialization complete');

    const suppressOverlay = (reason: string): void => {
        state.overlaySuppressed = true;
        if (state.updateTimer) {
            cancelAnimationFrame(state.updateTimer);
            state.updateTimer = null;
        }
        hideOverlay(state);
        hidePreviewElements(state);
        if ((window as any).flutterSpatialNavDebug) {
            console.log(`[SpatialNav] Overlay suppressed (${reason})`);
        }
    };

    // 16. Hide overlay when focus leaves the document (e.g., returning to address bar)
    // This ensures the focus indicator doesn't persist when the user exits web content

    window.addEventListener('blur', () => {
        console.log('[SpatialNav] Window blur - hiding overlay');
        suppressOverlay('window.blur');
    });

    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            console.log('[SpatialNav] Document hidden - hiding overlay');
            suppressOverlay('document.hidden');
        }
    });

    // Note: focusout listener removed - it was causing click handling issues
    // The window blur and visibilitychange handlers should suffice

    // Hide overlay when spatial navigation exits to native UI (address bar)
    // This event is dispatched when navigation reaches a boundary
    document.addEventListener('spatialNavigationExit', (e) => {
        console.log('[SpatialNav] Focus exiting web content - hiding overlay');
        suppressOverlay('spatialNavigationExit');
    });

    // 16. Re-initialize on page navigation
    // When user navigates to a new page (full document load), the old DOM is torn down
    // (styles, overlay, observers), but event handlers on window survive.
    // Re-run setup to ensure the new document works.
    let lastPageshowTime = 0;
    window.addEventListener('pageshow', function (event) {
        // Debounce rapid pageshow events (can fire multiple times during navigation)
        const now = Date.now();
        if (now - lastPageshowTime < 100) {
            console.log('[SpatialNav] pageshow debounced (too soon after last)');
            return;
        }
        lastPageshowTime = now;

        // Detailed instrumentation for debugging
        const hasStyle = !!document.getElementById(STYLE_ID);
        const hasOverlayHost = !!document.getElementById(OVERLAY_HOST_ID);
        const overlayAttached = state.overlayHost && document.body && document.body.contains(state.overlayHost);

        console.log(`[SpatialNav] pageshow ${safeJson({
            persisted: event.persisted,
            readyState: document.readyState,
            hasStyle: hasStyle,
            hasOverlay: hasOverlayHost,
            overlayAttached: overlayAttached,
            overlayHostId: state.overlayHost?.id,
            overlayConnected: !!state.overlayHost?.isConnected,
            handlersAttached: state.handlersAttached,
            focusableCount: state.focusableCount
        })}`);

        const needsStyles = !hasStyle;
        const needsOverlay = !hasOverlayHost || !overlayAttached;

        if (needsStyles || needsOverlay) {
            console.log(`[SpatialNav] Re-initializing after navigation ${safeJson({
                needsStyles,
                needsOverlay
            })}`);

            // Force clear old overlay reference to avoid reuse
            if (needsOverlay) {
                console.log('[SpatialNav] Clearing old overlay reference');
                state.overlayHost = null;
                state.overlay = null;
            }

            if (needsStyles) {
                ensureStyles(config);
                const styleNowExists = !!document.getElementById(STYLE_ID);
                console.log('[SpatialNav] ensureStyles complete, style exists:', styleNowExists);
            }

            if (needsOverlay) {
                ensureOverlay(config, state);
                const overlayNowExists = !!document.getElementById(OVERLAY_HOST_ID);
                const overlayNowAttached = state.overlayHost && document.body && document.body.contains(state.overlayHost);
                console.log(`[SpatialNav] ensureOverlay complete ${safeJson({
                    overlayExists: overlayNowExists,
                    overlayAttached: overlayNowAttached,
                    overlayHostId: state.overlayHost?.id,
                    overlayConnected: !!state.overlayHost?.isConnected
                })}`);
            }

            // Re-attach mutation observer if needed
            if (state.mutationObserver) {
                console.log('[SpatialNav] Disconnecting old mutation observer');
                state.mutationObserver.disconnect();
                state.mutationObserver = null;
            }
            attachMutationObserver(state);
            console.log('[SpatialNav] Mutation observer re-attached');

            // Re-attach virtual scroll sentinels
            if (state.virtualSentinelObserver) {
                state.virtualSentinelObserver.disconnect();
                state.virtualSentinelObserver = null;
            }
            attachVirtualScrollSentinels(state);
            console.log('[SpatialNav] Virtual scroll sentinels re-attached');

            // Refresh focusables for new page
            refreshFocusables(state);
            console.log('[SpatialNav] refreshFocusables complete, count:', state.focusableCount);

            // Hide overlay initially
            showOverlay(null, state);
            console.log('[SpatialNav] Re-initialization complete');
        } else {
            console.log('[SpatialNav] No re-initialization needed, DOM intact');
        }
    });
})();
