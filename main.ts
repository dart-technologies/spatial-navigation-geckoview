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
import { hidePreviewElements, updatePreviewVisuals } from './core/preview';
import {
    refreshFocusables,
    getActiveElement,
    describeElement,
    attachVirtualScrollSentinels,
    setupAccessibilityAnnouncer,
    focusInitialElement,
    walkElementsBounded,
    MAX_SCAN_NODES,
    MAX_FOCUSABLE_NODES,
} from './utils/dom';
import { attachHandlers, HANDLER_ID_ATTR } from './navigation/handlers';
import { attachMutationObserver } from './utils/observer';
import { initDebugApi } from './utils/debug';
import { detectRuntimeContext, formatRuntimeLabel } from './utils/runtime';
import { moveInDirection } from './navigation/movement';
import { findDirectionalCandidate } from './core/scoring';
import { createLogger, DEBUG } from './utils/logger';
import { installLegacyDeprecations } from './utils/deprecation';
import { clearOverlaySuppression } from './utils/focus-helpers';
import { GeckoViewMessagingAdapter, NoopMessagingAdapter } from './messaging';
import type { MessagingAdapter, InboundMessage } from './messaging';
import {
    setupInputModalityWatcher as installModalityWatcher,
    buildDefaultModalityPostback,
} from './core/modality_watcher';
import type { FocusableAreasOptions, SpatialNavigationSearchOptions } from './globals';

const log = createLogger('Main');

const STYLE_ID = 'spatnav-focus-styles';
const OVERLAY_HOST_ID = 'spatnav-focus-host';
const VERSION = '3.2.0';

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
            ? new GeckoViewMessagingAdapter()
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
    type: 'spatialNavInit' | 'focusExit' | 'inputModalityChange';
    [key: string]: unknown;
}): boolean {
    return messagingAdapter?.send(message) ?? false;
}

/**
 * Install the in-page pointer/touch watcher around the active messaging
 * adapter. Delegates to `core/modality_watcher.ts` so the watcher's
 * filtering + back-compat title-channel logic is testable in isolation.
 */
function setupInputModalityWatcher(state: SpatialNavState): void {
    installModalityWatcher(
        state,
        buildDefaultModalityPostback((msg) => {
            postToNative(msg);
        })
    );
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
            // Bounded lazy scan (page-callable API): cap elements visited and
            // matches collected so a pathological subtree can't force a full
            // materialization here either.
            const all: Element[] = [];
            walkElementsBounded(this, { nodes: MAX_SCAN_NODES }, (el) => {
                if (all.length < MAX_FOCUSABLE_NODES && el.matches(selector)) all.push(el);
            });
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

    // Re-stamp the handler-id on the new documentElement. The window-level
    // keydown listener captured the original handlerId in closure and short-
    // circuits when the DOM attribute disagrees — without this restamp the
    // listener would silently drop every keystroke after a document swap.
    document.documentElement.setAttribute(HANDLER_ID_ATTR, String(state.handlerId));

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

    // BFCache restore swaps the document — `document.addEventListener`
    // listeners attached to the old document are gone. Clear the install
    // marker so `setupInputModalityWatcher` re-attaches against the fresh
    // document.
    window.__spatnavModalityWatcherAttached = false;
    setupInputModalityWatcher(state);
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
export function initSpatialNavigation(): void {
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

    // 11. Initialize debug API — gated on build-time DEBUG so the production
    // bundle does not expose `window.spatialNavDebug` (page-callable navigation
    // control) or write focused-element descriptions into `document.title`.
    // Terser dead-code-eliminates the whole call in release builds. Mirrors the
    // `isDebugActive()` gate in core/overlay.ts.
    if (DEBUG) {
        initDebugApi(state);
    }

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
        // [diag] Every set of `overlaySuppressed=true` happens here OR
        // in movement.ts's default-exit branch. If the user-reported
        // "ring vanishes after viewport shift" log trail crosses this
        // function, the boundary-exit fall-through fired (no scroll
        // room, or boundaryScrollBehavior !== 'scroll').
        // Promoted to log.warn (from log.info) so the prod bundle keeps
        // this diagnostic — it`s the smoking-gun signal for "ring vanished
        // / HUD reads suppressed" investigations, but the prod bundle
        // strips console.log/info/debug.
        log.warn(
            `suppressOverlay(reason=${reason}) scrollY=${window.scrollY} active=${document.activeElement?.tagName?.toLowerCase() ?? '(null)'}`
        );
        state.overlaySuppressed = true;
        if (state.updateTimer) {
            cancelAnimationFrame(state.updateTimer);
            state.updateTimer = null;
        }
        hideOverlay(state);
        hidePreviewElements(state);
        log.debug(`overlay suppressed (${reason})`);

        // Cancel any pending recovery — the new suppression supersedes.
        if (state.suppressRecoveryTimer != null) {
            clearTimeout(state.suppressRecoveryTimer);
            state.suppressRecoveryTimer = null;
        }

        // Auto-recover for `spatialNavigationExit` only. The other two
        // sources (`window.blur`, `document.hidden`) reflect a genuine
        // exit from the document and should remain suppressed until the
        // host explicitly re-shows or the page becomes visible again.
        //
        // `spatialNavigationExit` fires on internal boundary attempts
        // (no target in DOM in this direction). The user's focus is
        // still on the element they were trying to navigate from — and
        // crucially, the wrapper may have scrolled the page in response
        // to expose more content. After the scroll settles, if focus
        // is still on a real focusable element, the overlay should
        // re-appear: the user is still in the document, not in native
        // UI.
        if (reason !== 'spatialNavigationExit') return;

        state.suppressRecoveryTimer = setTimeout(() => {
            state.suppressRecoveryTimer = null;
            // Someone else already cleared suppression (e.g., a
            // subsequent moveInDirection succeeded). Nothing to do.
            if (!state.overlaySuppressed) return;

            const active = document.activeElement;
            // Body / documentElement / null means focus is no longer on
            // a real focusable — focus genuinely left to native UI
            // (e.g., browser chrome). Keep suppressed.
            if (!active || active === document.body || active === document.documentElement) {
                return;
            }
            if (!(active instanceof HTMLElement)) return;

            state.overlaySuppressed = false;
            // [diag] Auto-recover from spatialNavigationExit: 350ms
            // after the suppression, re-show the ring on the active
            // element if it's still a real focusable.
            log.info('suppressOverlay auto-recover firing', {
                activeTag: (active as HTMLElement).tagName.toLowerCase(),
            });
            showOverlay(active, state);
            log.debug('overlay auto-recovered after spatialNavigationExit settle');
        }, 350);
    };

    // 16. Install the input-modality watcher (`pointerdown` + `touchstart`).
    //     Reports touch transitions to the native host so consumer wrappers
    //     can hide their focus ring. The wrapper's previous
    //     `runJavaScript`-based install is now redundant.
    setupInputModalityWatcher(state);

    // 17. Hide overlay when focus leaves the document (e.g., returning to address bar)
    window.addEventListener('blur', () => suppressOverlay('window.blur'));

    document.addEventListener('visibilitychange', () => {
        if (document.hidden) suppressOverlay('document.hidden');
    });

    // Hide overlay when spatial navigation exits to native UI. Auto-recovers
    // 350ms later if focus is still on a real focusable element — the
    // boundary case where the user pressed a directional key, no target
    // was found, the wrapper scrolled the page, and focus stayed on the
    // previously-focused element.
    document.addEventListener('spatialNavigationExit', () => suppressOverlay('spatialNavigationExit'));

    // Cross-world bridge for the wrapper's `engage-on-transition` hook.
    //
    // The WebExtension content script runs in an isolated JS world —
    // the host's `runJavaScript` (page main world) can't read
    // `window.spatialNavState` or call `window.showSpatialNavOverlay`.
    // They share the same `document`, though, so a CustomEvent fired
    // from the host on `document` IS received here.
    //
    // The host fires this on a touch → hardwareNav transition when the
    // first-press-swallow flag is armed. Without it, the first press
    // from a state where the WebView has no DOM-focused element (cold
    // boot / fresh page / address-bar → WebView focus traversal) flips
    // modality + sets data-ring=visible but the actual
    // #spatnav-focus-overlay element stays display:none. The user
    // would see no ring on the first press and would need to press
    // again to trigger a key dispatch + recovery.
    //
    // Semantics:
    //   - If a real focusable is already DOM-focused: show the ring on
    //     it (preserves "tap a link, press Down, see ring on tapped
    //     element" UX).
    //   - Otherwise: focus the FIRST focusable. The window-level
    //     `focus` capture-listener in `attachHandlers` picks up the
    //     event and triggers `scheduleOverlayUpdate` → `showOverlay`,
    //     putting the ring on the first element.
    // `spatnav-clear-suppress` — lightweight bridge fired by the host on
    // EVERY `notifyHardwareNavActivity` (touch → hardwareNav AND
    // hardwareNav → hardwareNav). Just clears stale `overlaySuppressed`
    // without trampling focus. Needed because `engage-overlay` only fires
    // on the touch → hardwareNav transition (to avoid refocusing the
    // first focusable when the user is mid-navigation), but a prior
    // `window.blur` (host address bar got focus) sets `suppressed = true`
    // and never auto-recovers. If the user comes back to the WebView via
    // D-pad while modality was already hardwareNav, engage doesn`t fire,
    // suppress stays true, the HUD shows "suppressed", and the next
    // `scheduleOverlayUpdate` is silently early-returned.
    document.addEventListener('spatnav-clear-suppress', () => {
        if (state.overlaySuppressed) {
            // log.warn (preserved in prod) — the load-bearing transition
            // when the user returns to the WebView after a `window.blur`
            // (Flutter focus left the WebView temporarily).
            log.warn('spatnav-clear-suppress: clearing stale overlaySuppressed');
            clearOverlaySuppression(state);
        }
        // Re-paint the overlay AND directional chevrons on the current
        // focused focusable, if any. Without this, the `wasTouch=false`
        // path of `notifyHardwareNavActivity` (e.g., user returns to
        // WebView while modality was already hardwareNav) writes
        // `data-ring=visible` on the host but the inner
        // `#spatnav-focus-overlay` stays at `opacity: 0` (no `.visible`
        // class) — host visible, ring invisible. Also: chevron previews
        // are rendered via `updatePreviewVisuals` from the focus
        // capture-listener`s scheduleOverlayUpdate path, which is gated
        // on `state.overlaySuppressed` and silently early-returns when
        // suppress was true at the time of the focus event. After we
        // clear suppress here, we must explicitly call
        // `updatePreviewVisuals` ourselves — otherwise the ring renders
        // but the up/down/left/right chevrons stay invisible (matches
        // the user-reported "DART logo focus ring doesn`t have any
        // arrows" after UP-then-DOWN sequence).
        try {
            const active = document.activeElement as HTMLElement | null;
            if (
                active &&
                active !== document.body &&
                active !== document.documentElement &&
                active instanceof HTMLElement
            ) {
                const list = state.focusableElements;
                if (Array.isArray(list) && list.indexOf(active) !== -1) {
                    showOverlay(active, state);
                    updatePreviewVisuals(
                        active,
                        null,
                        findDirectionalCandidate,
                        directionByName,
                        describeElement,
                        state
                    );
                }
            }
        } catch (e) {
            log.warn('spatnav-clear-suppress re-paint error', e);
        }
    });

    document.addEventListener('spatnav-engage-overlay', () => {
        try {
            if (state.overlaySuppressed) {
                // log.warn (preserved in prod) — load-bearing recovery from
                // a stale window.blur/document.hidden suppression.
                log.warn('engage-overlay: clearing stale overlaySuppressed');
                clearOverlaySuppression(state);
            }
            const active = document.activeElement as HTMLElement | null;
            const focusables = state.focusableElements;
            if (!Array.isArray(focusables) || focusables.length === 0) {
                refreshFocusables(state);
            }
            const list = state.focusableElements;
            if (!Array.isArray(list) || list.length === 0) {
                log.debug('engage-overlay: no focusables to engage');
                return;
            }
            const activeIsFocusable =
                !!active &&
                active !== document.body &&
                active !== document.documentElement &&
                list.indexOf(active) !== -1;
            if (activeIsFocusable) {
                log.info(`engage-overlay: show on active ${describeElement(active)}`);
                showOverlay(active, state);
                // Mirror `spatnav-clear-suppress`: render the chevrons
                // for the current focusable. The `focusInitialElement`
                // path below relies on the focus event firing
                // `scheduleOverlayUpdate`, which calls
                // `updatePreviewVisuals` itself — but the direct
                // `showOverlay(active)` path above (activeIsFocusable)
                // does NOT, so the chevrons would be missing for
                // exactly the same reason as the clear-suppress race.
                updatePreviewVisuals(
                    active,
                    null,
                    findDirectionalCandidate,
                    directionByName,
                    describeElement,
                    state
                );
            } else {
                log.info('engage-overlay: focus first focusable');
                focusInitialElement(true, state);
            }
        } catch (e) {
            log.warn('engage-overlay handler error', e);
        }
    });

    // 18. Re-initialize on page navigation
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

// Gate auto-init so tests can import this module without side effects. Uses the
// build-time NODE_ENV (Rollup folds it to "production"/"development" in shipped
// bundles, so auto-init always runs in the content script) rather than a
// page-reachable global. The test runner sets NODE_ENV=test (see package.json).
if (process.env.NODE_ENV !== 'test') {
    initSpatialNavigation();
}
