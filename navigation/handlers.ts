/**
 * Event handlers for Spatial Navigation System
 *
 * Manages keyboard event listeners and orchestrates navigation.
 */

import { directionByKey, directionByName, type Direction, type DirectionMap } from '../core/config';
import { updatePreviewTargets, updatePreviewVisuals } from '../core/preview';
import { moveInDirection, ensureValidFocus } from './movement';
import { refreshFocusables, getActiveElement, describeElement } from '../utils/dom';
import { findDirectionalCandidate, type NavigationCandidate } from '../core/scoring';
import { showOverlay } from '../core/overlay';
import { safeJson, safeGetAttr } from '../utils/json';
import { createLogger, DEBUG } from '../utils/logger';
import type { SpatialNavState } from '../core/state';
import { clampToViewport, pickClickPoint } from './click_utils';
import { isMenuToggleElement, tryCloseOpenMenuToggle } from './menu_toggle';

// Re-export focus helpers for backward compatibility
import { scheduleOverlayUpdate, storePositionHint } from '../utils/focus-helpers';
export { scheduleOverlayUpdate, storePositionHint };

// Create logger for handlers
const log = createLogger('Handlers');

// Define interface for preview targets
interface PreviewTargets {
    up: NavigationCandidate | null;
    down: NavigationCandidate | null;
    left: NavigationCandidate | null;
    right: NavigationCandidate | null;
}

/**
 * Handle key down events for spatial navigation.
 *
 * @param event - The keydown event
 * @param state - Global state object
 */
export function handleKeyDown(event: KeyboardEvent, state: SpatialNavState): void {
    if (!event) {
        return;
    }

    // CRITICAL: Check if this handler is the current active one before claiming the event.
    // Old handlers from previous script injections must be ignored.
    // Use DOM attribute (shared across isolated worlds) instead of window property (isolated).
    const myHandlerId = state.handlerId;
    const currentDomHandlerId = document.documentElement.getAttribute('data-spatnav-handler-id');
    if (String(myHandlerId) !== currentDomHandlerId) {
        if (window.flutterSpatialNavDebug) {
            console.log(`[SpatialNav DEBUG] ⚠️ STALE HANDLER BLOCKED (handleKeyDown): myId=${myHandlerId}, currentId=${currentDomHandlerId}`);
        }
        return;
    }

    // CRITICAL: Atomic event lock using DOM attribute.
    // This MUST be the first thing we do (after the stale-handler check) to prevent race
    // conditions between multiple injected handlers/isolated worlds.
    //
    // NOTE: In GeckoView, synthetic KeyboardEvents can have a non-unique or constant `timeStamp`
    // (e.g. 0). If the lock is not released after dispatch, subsequent presses can be blocked.
    // We therefore clear the lock at the end of the current task.
    const lockAttr = 'data-spatnav-event-lock';
    const timeStamp =
        typeof (event as any).timeStamp === 'number' && Number.isFinite((event as any).timeStamp)
            ? (event as any).timeStamp as number
            : 0;
    const eventLockKey = `${event.type || 'keydown'}:${event.key || ''}:${timeStamp.toFixed(3)}`;
    const currentLock = document.documentElement.getAttribute(lockAttr);

    if (currentLock === eventLockKey) {
        // Another handler already claimed this event - exit immediately
        if (window.flutterSpatialNavDebug) {
            console.log(`[SpatialNav DEBUG] ⚠️ EVENT LOCK HIT: ${eventLockKey}`);
        }
        return;
    }

    // ATOMIC: Set lock immediately before any other processing
    // This prevents other handlers from processing the same event
    document.documentElement.setAttribute(lockAttr, eventLockKey);
    const clearLock = () => {
        try {
            const lockValue = document.documentElement.getAttribute(lockAttr);
            if (lockValue !== eventLockKey) return;
            const root: any = document.documentElement as any;
            if (typeof root.removeAttribute === 'function') {
                root.removeAttribute(lockAttr);
            } else {
                document.documentElement.setAttribute(lockAttr, '');
            }
        } catch {
            // ignore
        }
    };
    try {
        if (typeof queueMicrotask === 'function') {
            queueMicrotask(clearLock);
        } else {
            setTimeout(clearLock, 0);
        }
    } catch {
        setTimeout(clearLock, 0);
    }

    // CRITICAL: Stop ALL other handlers from receiving this event
    // This prevents old handlers (from previous injections) that don't have
    // the event lock check from processing the same event
    event.stopImmediatePropagation();

    // DEBUG: Track every keydown call with event-level detection
    const debugNow = Date.now();
    window.__SPATIAL_NAV_KEYDOWN_COUNT__ = (window.__SPATIAL_NAV_KEYDOWN_COUNT__ || 0) + 1;
    const callCount = window.__SPATIAL_NAV_KEYDOWN_COUNT__;
    const lastTime = window.__SPATIAL_NAV_LAST_KEY_TIME__ || 0;
    const lastKey = window.__SPATIAL_NAV_LAST_KEY__ || '';
    const timeSinceLast = debugNow - lastTime;
    const handlerId = myHandlerId; // Use state.handlerId (already retrieved above)

    if (window.flutterSpatialNavDebug) {
        log.debug(`========== KEYDOWN #${callCount} ==========`);
        log.debug(`Handler ID: ${handlerId}, Event lock: ${eventLockKey}`);
        log.debug(`Key: "${event.key}" | Last: "${lastKey}" | TimeSince: ${timeSinceLast}ms`);
    }

    window.__SPATIAL_NAV_LAST_KEY_TIME__ = debugNow;
    window.__SPATIAL_NAV_LAST_KEY__ = event.key;

    // DUPLICATE DETECTION: If same key within 50ms, likely duplicate event dispatch
    if (event.key === lastKey && timeSinceLast < 50 && timeSinceLast > 0) {
        if (window.flutterSpatialNavDebug) {
            log.debug(`⚠️ RAPID REPEAT! Same key "${event.key}" within ${timeSinceLast}ms`);
            log.debug(`Blocking rapid repeat and preventing default`);
        }
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        return;
    }

    // Handle ENTER and SPACE keys to trigger clicks on focused elements
    if (event.key === 'Enter' || event.key === ' ') {
        const activeElement = getActiveElement();

        // FIX: Don't intercept Enter/Space on editable elements (inputs, textareas, contenteditable)
        // This preserves native behavior for form submission, newlines, etc.
        if (activeElement) {
            const tagName = activeElement.tagName.toLowerCase();
            const htmlElement = activeElement as HTMLElement;
            const inputElement = activeElement as HTMLInputElement;
            const isEditable = htmlElement.isContentEditable ||
                tagName === 'textarea' ||
                (tagName === 'input' && !['button', 'submit', 'reset', 'checkbox', 'radio', 'image', 'file'].includes(inputElement.type || ''));

            if (isEditable) {
                return;
            }

            const href = safeGetAttr(activeElement, 'href');
            const role = safeGetAttr(activeElement, 'role');
            const classes = safeGetAttr(activeElement, 'class') || '';
            const ariaHasPopup = safeGetAttr(activeElement, 'aria-haspopup');
            const ariaExpanded = safeGetAttr(activeElement, 'aria-expanded');

            console.log(`[SpatialNav] ${event.key === ' ' ? 'SPACE' : 'ENTER'} pressed on: ${describeElement(activeElement)} ${safeJson({
                tagName,
                role,
                hasHref: !!href,
                href: href?.substring(0, 50),
                classes: classes.substring(0, 50),
                ariaHasPopup,
                ariaExpanded
            })}`);

            // Prefer clicking the nearest menu-toggle element, if present.
            // Many nav menus attach handlers to the toggle element, not its child spans.
            let actionElement: Element = activeElement;
            try {
                const menuToggle = (activeElement as HTMLElement).closest?.('[aria-haspopup], [aria-expanded]');
                if (menuToggle) {
                    actionElement = menuToggle;
                }
            } catch {
                // ignore
            }

            // STRATEGY: Native Touch Injection for "Trusted" events
            // Some frameworks (YouTube, SquareSpace) require trusted touch events
            // for certain actions (opening lightboxes, play/pause).
            // We use native injection for elements that need trusted events:
            // - <a> without href (JS-handled links)
            // - <div>, <span>, <button> (custom interactive elements)
            // - role="button" (ARIA buttons)
            // - <video>, <img> (media elements - thumbnails, players)
            const actionTag = actionElement.tagName.toLowerCase();
            const actionRole = safeGetAttr(actionElement, 'role');
            const isMenuToggle = isMenuToggleElement(actionElement);

            const wantsNativeClick =
                (
                    (actionTag === 'a' && !actionElement.hasAttribute('href')) ||
                    (actionTag === 'div' || actionTag === 'span' || actionTag === 'button') ||
                    (actionRole === 'button') ||
                    (actionTag === 'video') ||
                    (actionTag === 'img')
                );

            // Only attempt native injection if the WebExtension bridge exists.
            const runtimeApi = (globalThis as any).browser?.runtime ?? (globalThis as any).chrome?.runtime;
            const canRequestNativeClick =
                !!runtimeApi &&
                typeof runtimeApi.sendMessage === 'function';

            // Menu toggles should behave like toggles: second press closes.
            if (isMenuToggle) {
                const didClose = tryCloseOpenMenuToggle({
                    actionElement,
                    state,
                    event,
                    handlerId: myHandlerId,
                    runtimeApi,
                    canRequestNativeClick
                });
                if (didClose) {
                    return;
                }
            }

            const useNativeClick = canRequestNativeClick && wantsNativeClick;

            console.log(`[SpatialNav] Click strategy: ${useNativeClick ? 'NATIVE' : 'JS .click()'} ${safeJson({
                tagName,
                role,
                actionTag,
                actionRole,
                isMenuToggle,
                runtimeMode: state.runtime?.mode,
                canRequestNativeClick,
                hasHref: actionElement.hasAttribute('href'),
                wantsNativeClick
            })}`);

            // 1) Resolve click target + coordinates.
            // Native injection takes coordinates, so we pick a point that actually hits the target.
            const actionRect = actionElement.getBoundingClientRect();
            const actionCenter = clampToViewport(
                actionRect.left + actionRect.width / 2,
                actionRect.top + actionRect.height / 2
            );
            const initialHit = document.elementFromPoint(actionCenter.x, actionCenter.y) || actionElement;
            const clickTarget = isMenuToggle ? actionElement : initialHit;

            const picked = pickClickPoint(clickTarget);
            const x = picked.x;
            const y = picked.y;

            if (window.flutterSpatialNavDebug) {
                const hitDesc = describeElement(picked.hit);
                const targetDesc = describeElement(clickTarget);
                const actionDesc = describeElement(actionElement);
                const initialDesc = describeElement(initialHit);
                console.log(`[SpatialNav DEBUG] Hit-test ${safeJson({
                    action: actionDesc,
                    clickTarget: targetDesc,
                    actionCenter: { x: actionCenter.x, y: actionCenter.y, hit: initialDesc },
                    picked: { x, y, label: picked.label, hit: hitDesc }
                })}`);
            }

            const commonOptions = {
                bubbles: true,
                cancelable: true,
                view: window,
                clientX: x,
                clientY: y,
                buttons: 1,
                detail: 1
            };

            if (useNativeClick) {
                // Native injection provides the real press (trusted MotionEvent).
                // Only prime hover/focus state here to avoid double-triggering mousedown/click handlers.
                if (typeof (window as any).PointerEvent === 'function') {
                    const pointerHover = {
                        ...commonOptions,
                        pointerId: 1,
                        pointerType: 'touch',
                        isPrimary: true,
                        button: 0,
                        pressure: 0
                    } as any;
                    clickTarget.dispatchEvent(new (window as any).PointerEvent('pointerover', pointerHover));
                    clickTarget.dispatchEvent(new (window as any).PointerEvent('pointerenter', pointerHover));
                }
                clickTarget.dispatchEvent(new MouseEvent('mouseover', commonOptions));
                clickTarget.dispatchEvent(new MouseEvent('mouseenter', commonOptions));
                if (typeof (activeElement as HTMLElement).focus === 'function') (activeElement as HTMLElement).focus();

                console.log('[SpatialNav] Requesting NATIVE MotionEvent injection for trusted execution');

                // Send message to Native Layer (via Extension -> Dart -> Native)
                // This triggers a REAL Android MotionEvent (Touch Down/Up) at the OS level
                // IMPORTANT: Scale CSS pixels to Physical pixels for Android MotionEvent
                const dpr = window.devicePixelRatio || 1.0;
                const finalX = x * dpr;
                const finalY = y * dpr;

                console.log(`[SpatialNav] Native Injection Request (simulateClick): ${safeJson({
                    css: { x, y, point: picked.label },
                    dpr,
                    final: { x: finalX, y: finalY }
                })}`);

                // Send to BACKGROUND SCRIPT instead of direct Native
                // Content scripts often cannot sendNativeMessage directly
                try {
                    const message: any = { type: 'simulateClick', x: finalX, y: finalY };
                    if (window.flutterSpatialNavDebug) {
                        message.debug = {
                            cssX: x,
                            cssY: y,
                            point: picked.label,
                            hit: describeElement(picked.hit),
                            target: describeElement(clickTarget),
                            action: describeElement(actionElement),
                            runtime: state.runtime?.mode
                        };
                    }
                    if ((globalThis as any).browser?.runtime === runtimeApi) {
                        // Firefox-style Promise API
                        const result = runtimeApi.sendMessage(message);
                        if (result && typeof result.then === 'function') {
                            result.then((response: any) => {
                                console.log('[SpatialNav] Background relay SUCCESS (promise):', response);
                            }).catch((error: any) => {
                                console.error('[SpatialNav] Background relay FAIL (promise):', error);
                            });
                        }
                    } else {
                        // Chrome-style callback API
                        runtimeApi.sendMessage(message, (response: any) => {
                            const error = runtimeApi.lastError;
                            if (error) {
                                console.error('[SpatialNav] Background relay FAIL (lastError):', error);
                            } else {
                                console.log('[SpatialNav] Background relay SUCCESS (callback):', response);
                            }
                        });
                    }
                } catch (e) {
                    console.warn('[SpatialNav] Native injection unavailable, falling back to JS .click()', e);
                    try {
                        if (typeof (clickTarget as HTMLElement).click === 'function') {
                            (clickTarget as HTMLElement).click();
                        } else {
                            (activeElement as HTMLElement).click();
                        }
                    } catch {
                        (activeElement as HTMLElement).click();
                    }
                    event.preventDefault();
                    event.stopPropagation();
                    return;
                }

                // Visual feedback only (event result is handled by native)
                // Early return to prevent JS interference
                if (state.overlay) {
                    state.overlay.classList.remove('click-animate');
                    void state.overlay.offsetWidth;
                    state.overlay.classList.add('click-animate');
                    activeElement.classList.add('spatnav-pressed');
                    setTimeout(() => {
                        if (state.overlay) state.overlay.classList.remove('click-animate');
                        activeElement.classList.remove('spatnav-pressed');
                    }, 150);
                }

                // Prevent key default to avoid double-activation via browser key handling.
                event.preventDefault();
                event.stopPropagation();
                return;
            } else {
                // JS click simulation path (injected mode / no bridge).
                if (typeof (window as any).PointerEvent === 'function') {
                    const pointerBase = {
                        ...commonOptions,
                        pointerId: 1,
                        pointerType: 'touch',
                        isPrimary: true,
                        button: 0,
                        pressure: 0.5
                    } as any;
                    clickTarget.dispatchEvent(new (window as any).PointerEvent('pointerover', pointerBase));
                    clickTarget.dispatchEvent(new (window as any).PointerEvent('pointerenter', pointerBase));
                    clickTarget.dispatchEvent(new (window as any).PointerEvent('pointerdown', pointerBase));
                }

                clickTarget.dispatchEvent(new MouseEvent('mouseover', commonOptions));
                clickTarget.dispatchEvent(new MouseEvent('mouseenter', commonOptions));
                clickTarget.dispatchEvent(new MouseEvent('mousedown', commonOptions));
                if (typeof (activeElement as HTMLElement).focus === 'function') (activeElement as HTMLElement).focus();
                clickTarget.dispatchEvent(new MouseEvent('mouseup', commonOptions));
                if (typeof (window as any).PointerEvent === 'function') {
                    const pointerUp = {
                        ...commonOptions,
                        pointerId: 1,
                        pointerType: 'touch',
                        isPrimary: true,
                        button: 0,
                        pressure: 0
                    } as any;
                    clickTarget.dispatchEvent(new (window as any).PointerEvent('pointerup', pointerUp));
                }

                try {
                    // Final native click
                    if (typeof (clickTarget as HTMLElement).click === 'function') {
                        (clickTarget as HTMLElement).click();
                    } else {
                        (activeElement as HTMLElement).click();
                    }

                    // Fallback for real anchors if .click() doesn't trigger navigation
                    if (tagName === 'a' && href && href !== '#' && !href.startsWith('javascript:')) {
                        console.log('[SpatialNav] Secondary fallback: location.assign for real anchor');
                        setTimeout(() => {
                            if (window.location.href.split('#')[0] === href.split('#')[0]) {
                                // If still on same page after 300ms, force navigation
                                // window.location.assign(href);
                            }
                        }, 300);
                    }
                } catch (e) {
                    (activeElement as HTMLElement).click();
                }
            }

            // Visual feedback
            if (state.overlay) {
                state.overlay.classList.remove('click-animate');
                void state.overlay.offsetWidth;
                state.overlay.classList.add('click-animate');
                activeElement.classList.add('spatnav-pressed');
                setTimeout(() => {
                    if (state.overlay) state.overlay.classList.remove('click-animate');
                    activeElement.classList.remove('spatnav-pressed');
                }, 150);
            }

            // Prevent default for standard simulation to avoid double clicks
            event.preventDefault();
            event.stopPropagation();
        }
        return;
    }

    // Handle directional navigation (arrow keys)
    const keyMap = directionByKey as Record<string, Direction>;
    if (!keyMap[event.key]) {
        return;
    }

    // Debug logging
    console.log('[SpatialNav] Key received:', event.key);

    // Throttled refresh: only scan if enough time passed or state is dirty
    const now = Date.now();
    const lastRefresh = state.lastRefreshTime || 0;
    const throttleMs = 150; // Throttle to ~6fps for heavy DOMs

    if (state.dirty || (now - lastRefresh > throttleMs)) {
        refreshFocusables(state);
        state.lastRefreshTime = now;
        state.dirty = false;
    }

    if (state.focusables.length === 0) {
        // Force refresh if we think there's nothing, just in case
        refreshFocusables(state);
        state.lastRefreshTime = Date.now();

        if (state.focusables.length === 0) {
            console.log('[SpatialNav] No focusable elements found');
            // CRITICAL: Still prevent default to stop focus escaping to address bar
            event.preventDefault();
            event.stopPropagation();
            return;
        }
    }

    const validActive = ensureValidFocus(state);
    if (!validActive) {
        console.warn('[SpatialNav] Unable to recover focus, aborting navigation');
        // CRITICAL: Still prevent default to stop focus escaping to address bar
        event.preventDefault();
        event.stopPropagation();
        return;
    }

    // Log current focus state
    const currentActive = validActive as HTMLElement;
    const currentIndex = currentActive ? state.focusableElements.indexOf(currentActive) : -1;
    console.log('[SpatialNav] Current focus:', describeElement(currentActive), 'index:', currentIndex);

    // Log next targets
    const dirMap = directionByName as DirectionMap;
    // Cast to expected type - preview returns object with potential nulls
    const targets = updatePreviewTargets(currentIndex, findDirectionalCandidate, dirMap, state) as unknown as PreviewTargets;
    console.log('[SpatialNav] Next targets:', JSON.stringify({
        up: targets.up?.data ? describeElement(targets.up.data.element) : null,
        down: targets.down?.data ? describeElement(targets.down.data.element) : null,
        left: targets.left?.data ? describeElement(targets.left.data.element) : null,
        right: targets.right?.data ? describeElement(targets.right.data.element) : null
    }));

    const direction = keyMap[event.key];
    if (window.flutterSpatialNavDebug) {
        log.debug(`Moving in direction: ${direction.name}`);
    }

    // DEBUG: Log focus state before move
    const beforeActive = getActiveElement();
    const beforeIndex = beforeActive ? state.focusableElements.indexOf(beforeActive as HTMLElement) : -1;
    if (window.flutterSpatialNavDebug) {
        log.debug(`BEFORE MOVE: active=${describeElement(beforeActive)}, index=${beforeIndex}`);
    }

    const moved = moveInDirection(direction, event, state);

    // DEBUG: Log focus state after move
    const afterActive = getActiveElement();
    const afterIndex = afterActive ? state.focusableElements.indexOf(afterActive as HTMLElement) : -1;
    if (window.flutterSpatialNavDebug) {
        log.debug(`AFTER MOVE: active=${describeElement(afterActive)}, index=${afterIndex}, moved=${moved}`);
    }

    if (!moved) {
        if (window.flutterSpatialNavDebug) {
            log.debug('Movement failed - boundary reached');
        }

        // Robustness: Force refresh and try ONE more time
        // This handles cases where new content loaded but throttle skipped it
        if (window.flutterSpatialNavDebug) {
            log.debug('Retrying with forced refresh...');
        }
        refreshFocusables(state);
        state.lastRefreshTime = Date.now();

        const retryMoved = moveInDirection(direction, event, state);
        if (!retryMoved) {
            if (window.flutterSpatialNavDebug) {
                log.debug('Retry failed - confirmed boundary');
            }
            state.lastBoundary = direction.name;
            // CRITICAL: Prevent default to stop focus from escaping to address bar
            event.preventDefault();
            event.stopPropagation();
        } else {
            if (window.flutterSpatialNavDebug) {
                log.debug('Retry successful!');
            }
            const newActive = getActiveElement();
            if (newActive) {
                scheduleOverlayUpdate(newActive as HTMLElement, state);
            }
        }
    } else {
        if (window.flutterSpatialNavDebug) {
            log.debug('Movement successful');
        }
        const newActive = getActiveElement();
        console.log('[SpatialNav] New focus:', describeElement(newActive));

        // Update overlay to show new focused element
        if (newActive) {
            scheduleOverlayUpdate(newActive as HTMLElement, state);
        }
    }
}



/**
 * Attach scroll listener with capture for sub-scrollers.
 * Uses requestAnimationFrame with 8px threshold to prevent jitter.
 *
 * LLM 2 + LLM 4: rAF + threshold + capture:true
 * FIX (HIGH): Track element scroll positions, not just window.scrollY
 *
 * @param state - Global state object
 */
function attachScrollListener(state: SpatialNavState): void {
    const config = state.config;

    // FIX (MEDIUM): Gate listener behind config option
    if (config.observeScroll === false) {
        // console.log('[SpatialNav] Scroll listener disabled by config');
        return;
    }

    // FIX (HIGH): Use WeakMap to track scroll positions for each element
    const scrollPositions = new WeakMap<Window | Element, { scrollY: number; scrollX: number }>();
    let scrollTimer: number | null = null;

    window.addEventListener('scroll', (event) => {
        if (scrollTimer) return;  // Throttle to one update per frame

        scrollTimer = requestAnimationFrame(() => {
            const rawTarget = event && event.target ? event.target : window;
            if (!rawTarget) {
                scrollTimer = null;
                return;
            }
            const target = rawTarget === document ? window : rawTarget;
            const threshold = config.scrollThreshold || 8;

            // FIX (HIGH): Get scroll position from the actual scrolling element
            let currentScrollY: number;
            let currentScrollX: number;
            if (target === window) {
                currentScrollY = window.scrollY;
                currentScrollX = window.scrollX;
            } else if ((target as Element).scrollTop !== undefined) {
                currentScrollY = (target as Element).scrollTop;
                currentScrollX = (target as Element).scrollLeft;
            } else {
                scrollTimer = null;
                return;
            }

            // Get cached position
            const cached = scrollPositions.get(target as Window | Element) || { scrollY: currentScrollY, scrollX: currentScrollX };
            const deltaY = Math.abs(currentScrollY - cached.scrollY);
            const deltaX = Math.abs(currentScrollX - cached.scrollX);

            // Only update if scroll is significant (prevents jitter on smooth scroll)
            if (deltaY > threshold || deltaX > threshold) {
                const active = getActiveElement() as HTMLElement | null;
                if (active && state.currentIndex !== -1) {
                    const currentEntry = state.focusables[state.currentIndex];
                    if (currentEntry) {
                        // Update geometry for current element (viewport position changed)
                        const rect = active.getBoundingClientRect();
                        currentEntry.left = rect.left;
                        currentEntry.top = rect.top;
                        currentEntry.right = rect.right;
                        currentEntry.bottom = rect.bottom;
                        currentEntry.centerX = rect.left + rect.width / 2;
                        currentEntry.centerY = rect.top + rect.height / 2;
                        currentEntry.rect = rect;

                        scheduleOverlayUpdate(active, state);
                    }
                }

                // Update cached position
                scrollPositions.set(target as Window | Element, { scrollY: currentScrollY, scrollX: currentScrollX });
            }

            scrollTimer = null;
        });
    }, {
        capture: true,   // LLM 4: Capture phase detects overflow:auto scrolling
        passive: true    // Don't block scrolling
    });

    // Store scroll listener state for SPA navigation tracking
    state.scrollListenerAttached = true;
}

// Window-level guard to prevent duplicate handlers across script injections
declare global {
    interface Window {
        __SPATIAL_NAV_HANDLERS_ATTACHED__?: boolean;
        __SPATIAL_NAV_HANDLER_ID__?: number;
        __SPATIAL_NAV_KEYDOWN_COUNT__?: number;
        __SPATIAL_NAV_LAST_KEY_TIME__?: number;
        __SPATIAL_NAV_LAST_KEY__?: string;
    }
}

/**
 * Attach global event listeners.
 *
 * @param state - Global state object
 */
export function attachHandlers(state: SpatialNavState): void {
    // Generate unique handler ID using timestamp + DOM counter + random
    // CRITICAL: Use DOM attribute for counter since module variables are isolated per world
    const counterAttr = document.documentElement.getAttribute('data-spatnav-handler-counter');
    const existingCounter = parseInt(counterAttr || '0', 10);
    const newCounter = existingCounter + 1;
    document.documentElement.setAttribute('data-spatnav-handler-counter', String(newCounter));

    // console.log(`[SpatialNav DEBUG] Counter: existing="${counterAttr}" (${existingCounter}) → new=${newCounter}`);

    // This ensures uniqueness even when multiple inits happen in same millisecond
    const handlerId = (Date.now() % 100000) * 1000 + newCounter * 100 + Math.floor(Math.random() * 100);

    // console.log(`[SpatialNav DEBUG] attachHandlers called, handlerId: ${handlerId}`);

    // CRITICAL: Use DOM attribute for handler ID instead of window property!
    // WebExtension content scripts run in isolated worlds with separate window objects,
    // but they SHARE the DOM. So document.documentElement is the same across all injections.
    const domHandlerId = document.documentElement.getAttribute('data-spatnav-handler-id');
    // console.log(`[SpatialNav DEBUG] DOM handler ID: ${domHandlerId}`);
    // console.log(`[SpatialNav DEBUG] state.handlersAttached: ${state.handlersAttached}`);

    // STATE-level guard only - window guard was causing stale handlers on navigation
    // Event-level deduplication (__spatnav_processed__) handles multiple handlers
    if (state.handlersAttached) {
        // console.log(`[SpatialNav DEBUG] ⚠️ State already has handlers, skipping`);
        return;
    }

    // console.log(`[SpatialNav DEBUG] ✅ ATTACHING NEW HANDLERS (ID: ${handlerId})`);
    // console.log('[SpatialNav] Attaching handlers to window');

    // Store handler ID in DOM (shared across isolated worlds) instead of window (isolated)
    document.documentElement.setAttribute('data-spatnav-handler-id', String(handlerId));
    state.handlerId = handlerId;
    window.__SPATIAL_NAV_HANDLER_ID__ = handlerId; // Keep for backwards compat
    window.__SPATIAL_NAV_KEYDOWN_COUNT__ = 0;

    // CRITICAL: Capture handlerId in closure - state is shared across all handlers
    // so we can't rely on state.handlerId (it gets overwritten by newer handlers)
    const capturedHandlerId = handlerId;
    window.addEventListener('keydown', function (e) {
        // Check if this handler is stale using DOM attribute (shared across isolated worlds)
        const currentDomHandlerId = document.documentElement.getAttribute('data-spatnav-handler-id');
        if (String(capturedHandlerId) !== currentDomHandlerId) {
            // console.log(`[SpatialNav DEBUG] ⚠️ STALE HANDLER BLOCKED (DOM check): myId=${capturedHandlerId}, currentId=${currentDomHandlerId}`);
            return;
        }
        handleKeyDown(e, state);
    }, true);

    window.addEventListener('focus', function (e) {
        const target = e.target;
        if (target === window || target === document) return;
        refreshFocusables(state);
        scheduleOverlayUpdate(target as HTMLElement, state);
    }, true);

    window.addEventListener('blur', function () {
        // Optional: hide overlay on blur?
        // For now we keep it to show last focused position
    }, true);

    // TODO 1: Attach scroll listener with capture
    attachScrollListener(state);

    state.handlersAttached = true;
}
