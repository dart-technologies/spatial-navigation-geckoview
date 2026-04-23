/**
 * Event handlers for Spatial Navigation.
 *
 * Manages keyboard event listeners and orchestrates navigation. Two
 * GeckoView-specific defenses live here that are easy to break in refactors:
 *
 * 1. **Stale-handler guard via DOM attribute.** Content scripts can be re-injected
 *    on every navigation. Each injection runs in an isolated world with its own
 *    `window` global, so a window-keyed flag can't see prior installs. The DOM,
 *    however, is shared. We stamp `data-spatnav-handler-id` on `documentElement`
 *    on each `attachHandlers()` and check it inside every keydown — older
 *    handlers see a mismatch and short-circuit.
 *
 * 2. **Atomic event lock per keypress.** Synthetic `KeyboardEvent`s in GeckoView
 *    can have a non-unique or constant `timeStamp` (e.g. 0). To prevent
 *    duplicate handling across overlapping handlers/isolated worlds we set a
 *    DOM attribute lock keyed by `type:key:timeStamp` before any other work,
 *    and clear it at the end of the current task (microtask if available).
 *    The lock release is critical — without it, subsequent presses get blocked.
 */

import { directionByKey, directionByName, type Direction, type DirectionMap } from '../core/config';
import { updatePreviewTargets } from '../core/preview';
import { moveInDirection, ensureValidFocus } from './movement';
import { refreshFocusables, getActiveElement, describeElement } from '../utils/dom';
import { findDirectionalCandidate, type NavigationCandidate } from '../core/scoring';
import { safeGetAttr } from '../utils/json';
import { createLogger } from '../utils/logger';
import type { SpatialNavState } from '../core/state';
import { clampToViewport, pickClickPoint } from './click_utils';
import { isMenuToggleElement, tryCloseOpenMenuToggle } from './menu_toggle';
import type { BrowserRuntime } from '../globals';

import { scheduleOverlayUpdate, storePositionHint } from '../utils/focus-helpers';
export { scheduleOverlayUpdate, storePositionHint };

const log = createLogger('Handlers');

interface PreviewTargets {
    up: NavigationCandidate | null;
    down: NavigationCandidate | null;
    left: NavigationCandidate | null;
    right: NavigationCandidate | null;
}

// --- Constants -------------------------------------------------------------

/** Discard rapid same-key repeats fired within this many milliseconds. */
const RAPID_REPEAT_THRESHOLD_MS = 50;

/** Throttle for refreshing the focusable cache during keydown bursts. */
const REFRESH_THROTTLE_MS = 150;

/** Click-animation pulse duration. */
const CLICK_ANIMATION_MS = 150;

/** DOM attributes used for cross-world coordination. */
const HANDLER_ID_ATTR = 'data-spatnav-handler-id';
const HANDLER_COUNTER_ATTR = 'data-spatnav-handler-counter';
const EVENT_LOCK_ATTR = 'data-spatnav-event-lock';

// Tags that should receive a Trusted-event native click rather than a JS .click().
// These categories often gate behavior (lightboxes, players, popovers) on
// `event.isTrusted` being true, which only native MotionEvent injection provides.
const NATIVE_CLICK_TAGS = new Set(['div', 'span', 'button', 'video', 'img']);

// Native `<input>` types that don't carry editable text — Enter/Space should still
// activate them rather than insert a newline/space.
const NON_EDITABLE_INPUT_TYPES = new Set(['button', 'submit', 'reset', 'checkbox', 'radio', 'image', 'file']);

// =============================================================================
// Keydown handler
// =============================================================================

/**
 * Handle key down events for spatial navigation.
 */
export function handleKeyDown(event: KeyboardEvent, state: SpatialNavState): void {
    if (!event) return;

    // 1. Stale-handler guard — see file header.
    const myHandlerId = state.handlerId;
    const currentDomHandlerId = document.documentElement.getAttribute(HANDLER_ID_ATTR);
    if (String(myHandlerId) !== currentDomHandlerId) {
        log.debug(`stale handler blocked: my=${myHandlerId} current=${currentDomHandlerId}`);
        return;
    }

    // 2. Atomic event lock — see file header.
    const timeStamp = Number.isFinite(event.timeStamp) ? event.timeStamp : 0;
    const eventLockKey = `${event.type || 'keydown'}:${event.key || ''}:${timeStamp.toFixed(3)}`;
    const currentLock = document.documentElement.getAttribute(EVENT_LOCK_ATTR);

    if (currentLock === eventLockKey) {
        log.debug(`event lock hit: ${eventLockKey}`);
        return;
    }

    document.documentElement.setAttribute(EVENT_LOCK_ATTR, eventLockKey);

    const clearLock = () => {
        try {
            const lockValue = document.documentElement.getAttribute(EVENT_LOCK_ATTR);
            if (lockValue !== eventLockKey) return;
            document.documentElement.removeAttribute(EVENT_LOCK_ATTR);
        } catch {
            // Ignore — DOM may be detached during unload.
        }
    };

    if (typeof queueMicrotask === 'function') {
        queueMicrotask(clearLock);
    } else {
        setTimeout(clearLock, 0);
    }

    // 3. Stop other handlers (older handlers without the lock check) from running.
    event.stopImmediatePropagation();

    // 4. Track keydown stats for the debug API.
    const debugNow = Date.now();
    window.__SPATIAL_NAV_KEYDOWN_COUNT__ = (window.__SPATIAL_NAV_KEYDOWN_COUNT__ || 0) + 1;
    const callCount = window.__SPATIAL_NAV_KEYDOWN_COUNT__;
    const lastTime = window.__SPATIAL_NAV_LAST_KEY_TIME__ || 0;
    const lastKey = window.__SPATIAL_NAV_LAST_KEY__ || '';
    const timeSinceLast = debugNow - lastTime;

    log.debug(`keydown #${callCount} key="${event.key}" handler=${myHandlerId} since=${timeSinceLast}ms`);

    window.__SPATIAL_NAV_LAST_KEY_TIME__ = debugNow;
    window.__SPATIAL_NAV_LAST_KEY__ = event.key;

    // 5. Drop rapid same-key repeats — likely synthetic-event duplicates.
    if (event.key === lastKey && timeSinceLast < RAPID_REPEAT_THRESHOLD_MS && timeSinceLast > 0) {
        log.debug(`rapid repeat blocked: "${event.key}" within ${timeSinceLast}ms`);
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        return;
    }

    // 6. ENTER and SPACE — activate the focused element.
    if (event.key === 'Enter' || event.key === ' ') {
        handleActivationKey(event, state, myHandlerId);
        return;
    }

    // 7. Arrow keys — directional navigation.
    const keyMap = directionByKey as Record<string, Direction>;
    if (!keyMap[event.key]) return;

    log.debug(`directional key: ${event.key}`);

    const now = Date.now();
    const lastRefresh = state.lastRefreshTime || 0;
    if (state.dirty || now - lastRefresh > REFRESH_THROTTLE_MS) {
        refreshFocusables(state);
        state.lastRefreshTime = now;
        state.dirty = false;
    }

    if (state.focusables.length === 0) {
        refreshFocusables(state);
        state.lastRefreshTime = Date.now();

        if (state.focusables.length === 0) {
            log.debug('no focusable elements found');
            // Block default to keep focus from escaping to the address bar.
            event.preventDefault();
            event.stopPropagation();
            return;
        }
    }

    const validActive = ensureValidFocus(state);
    if (!validActive) {
        log.warn('unable to recover focus — aborting navigation');
        event.preventDefault();
        event.stopPropagation();
        return;
    }

    const currentActive = validActive as HTMLElement;
    const currentIndex = currentActive ? state.focusableElements.indexOf(currentActive) : -1;
    log.debug(`current focus: ${describeElement(currentActive)} (index=${currentIndex})`);

    const dirMap = directionByName as DirectionMap;
    const targets = updatePreviewTargets(
        currentIndex,
        findDirectionalCandidate,
        dirMap,
        state
    ) as unknown as PreviewTargets;
    log.debug('next targets', {
        up: targets.up?.data ? describeElement(targets.up.data.element) : null,
        down: targets.down?.data ? describeElement(targets.down.data.element) : null,
        left: targets.left?.data ? describeElement(targets.left.data.element) : null,
        right: targets.right?.data ? describeElement(targets.right.data.element) : null,
    });

    const direction = keyMap[event.key];
    log.debug(`moving direction: ${direction.name}`);

    const moved = moveInDirection(direction, event, state);
    const afterActive = getActiveElement();

    if (!moved) {
        log.debug('movement failed — retrying with forced refresh');
        refreshFocusables(state);
        state.lastRefreshTime = Date.now();

        const retryMoved = moveInDirection(direction, event, state);
        if (!retryMoved) {
            log.debug(`boundary reached: ${direction.name}`);
            state.lastBoundary = direction.name;
            event.preventDefault();
            event.stopPropagation();
        } else {
            log.debug('retry succeeded');
            const newActive = getActiveElement();
            if (newActive) scheduleOverlayUpdate(newActive as HTMLElement, state);
        }
    } else {
        log.debug(`new focus: ${describeElement(afterActive)}`);
        if (afterActive) scheduleOverlayUpdate(afterActive as HTMLElement, state);
    }
}

// =============================================================================
// Enter / Space activation
// =============================================================================

function handleActivationKey(event: KeyboardEvent, state: SpatialNavState, handlerId: number): void {
    const activeElement = getActiveElement();
    if (!activeElement) return;

    const tagName = activeElement.tagName.toLowerCase();
    const htmlElement = activeElement as HTMLElement;
    const inputElement = activeElement as HTMLInputElement;
    const isEditable =
        htmlElement.isContentEditable ||
        tagName === 'textarea' ||
        (tagName === 'input' && !NON_EDITABLE_INPUT_TYPES.has(inputElement.type || ''));

    if (isEditable) return;

    const href = safeGetAttr(activeElement, 'href');
    const role = safeGetAttr(activeElement, 'role');
    const ariaHasPopup = safeGetAttr(activeElement, 'aria-haspopup');
    const ariaExpanded = safeGetAttr(activeElement, 'aria-expanded');

    log.debug(`${event.key === ' ' ? 'SPACE' : 'ENTER'} on ${describeElement(activeElement)}`, {
        tagName,
        role,
        hasHref: !!href,
        ariaHasPopup,
        ariaExpanded,
    });

    // Prefer the nearest menu-toggle element; many nav menus attach handlers to the toggle.
    let actionElement: Element = activeElement;
    try {
        const menuToggle = (activeElement as HTMLElement).closest?.('[aria-haspopup], [aria-expanded]');
        if (menuToggle) actionElement = menuToggle;
    } catch {
        // ignore
    }

    const actionTag = actionElement.tagName.toLowerCase();
    const actionRole = safeGetAttr(actionElement, 'role');
    const isMenuToggle = isMenuToggleElement(actionElement);

    // Native click is needed for elements that gate behavior on Trusted events:
    // anchors without href, role=button divs/spans, custom interactive elements,
    // or media (lightboxes/players). See NATIVE_CLICK_TAGS.
    const wantsNativeClick =
        (actionTag === 'a' && !actionElement.hasAttribute('href')) ||
        NATIVE_CLICK_TAGS.has(actionTag) ||
        actionRole === 'button';

    // `browser` (Firefox) and `chrome` (Chromium) may both be undeclared in
    // standalone/test environments — use globalThis lookup so a missing global
    // doesn't throw ReferenceError.
    const g = globalThis as { browser?: { runtime?: BrowserRuntime }; chrome?: { runtime?: BrowserRuntime } };
    const runtimeApi = g.browser?.runtime ?? g.chrome?.runtime;
    const canRequestNativeClick = !!runtimeApi && typeof runtimeApi.sendMessage === 'function';

    if (isMenuToggle) {
        const didClose = tryCloseOpenMenuToggle({
            actionElement,
            state,
            event,
            handlerId,
            runtimeApi,
            canRequestNativeClick,
        });
        if (didClose) return;
    }

    const useNativeClick = canRequestNativeClick && wantsNativeClick;

    log.debug(`click strategy: ${useNativeClick ? 'NATIVE' : 'JS .click()'}`, {
        actionTag,
        actionRole,
        isMenuToggle,
        runtimeMode: state.runtime?.mode,
    });

    // Pick a coordinate that hits the visible target.
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

    log.debug('hit-test', {
        action: describeElement(actionElement),
        clickTarget: describeElement(clickTarget),
        actionCenter: { x: actionCenter.x, y: actionCenter.y, hit: describeElement(initialHit) },
        picked: { x, y, label: picked.label, hit: describeElement(picked.hit) },
    });

    const commonOptions = {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: x,
        clientY: y,
        buttons: 1,
        detail: 1,
    };

    if (useNativeClick) {
        dispatchHoverPrime(clickTarget, commonOptions);
        if (typeof htmlElement.focus === 'function') htmlElement.focus();

        log.debug('requesting native MotionEvent injection');

        // Convert CSS px → physical px for Android MotionEvent.
        const dpr = window.devicePixelRatio || 1.0;
        const finalX = x * dpr;
        const finalY = y * dpr;

        log.debug('native injection request', {
            css: { x, y, point: picked.label },
            dpr,
            final: { x: finalX, y: finalY },
        });

        try {
            const message: { type: string; x: number; y: number; debug?: object } = {
                type: 'simulateClick',
                x: finalX,
                y: finalY,
            };

            const sendMessage = runtimeApi.sendMessage;
            if (typeof sendMessage !== 'function') {
                throw new Error('runtime.sendMessage unavailable');
            }
            if (g.browser?.runtime === runtimeApi) {
                // Firefox: Promise API
                const result = sendMessage(message);
                if (result && typeof result.then === 'function') {
                    result
                        .then((response: unknown) => {
                            log.debug('background relay success (promise)', response);
                        })
                        .catch((error: unknown) => {
                            log.error('background relay failed (promise)', error);
                        });
                }
            } else {
                // Chrome: callback API
                sendMessage(message, (response: unknown) => {
                    const error = runtimeApi.lastError;
                    if (error) {
                        log.error('background relay failed (lastError)', error);
                    } else {
                        log.debug('background relay success (callback)', response);
                    }
                });
            }
        } catch (e) {
            log.warn('native injection unavailable, falling back to JS .click()', e);
            try {
                if (typeof (clickTarget as HTMLElement).click === 'function') {
                    (clickTarget as HTMLElement).click();
                } else {
                    htmlElement.click();
                }
            } catch {
                htmlElement.click();
            }
            event.preventDefault();
            event.stopPropagation();
            return;
        }

        applyClickFeedback(state, htmlElement);
        event.preventDefault();
        event.stopPropagation();
        return;
    }

    // JS click simulation (no extension bridge or doesn't need trusted event).
    dispatchFullPointerSequence(clickTarget, htmlElement, commonOptions);

    try {
        if (typeof (clickTarget as HTMLElement).click === 'function') {
            (clickTarget as HTMLElement).click();
        } else {
            htmlElement.click();
        }
    } catch {
        htmlElement.click();
    }

    applyClickFeedback(state, htmlElement);
    event.preventDefault();
    event.stopPropagation();
}

interface MouseEventOptions {
    bubbles: boolean;
    cancelable: boolean;
    view: Window;
    clientX: number;
    clientY: number;
    buttons: number;
    detail: number;
}

interface PointerEventOptions extends MouseEventOptions {
    pointerId: number;
    pointerType: string;
    isPrimary: boolean;
    button: number;
    pressure: number;
}

function dispatchHoverPrime(target: Element, opts: MouseEventOptions): void {
    if (typeof PointerEvent === 'function') {
        const pointerHover: PointerEventOptions = {
            ...opts,
            pointerId: 1,
            pointerType: 'touch',
            isPrimary: true,
            button: 0,
            pressure: 0,
        };
        target.dispatchEvent(new PointerEvent('pointerover', pointerHover));
        target.dispatchEvent(new PointerEvent('pointerenter', pointerHover));
    }
    target.dispatchEvent(new MouseEvent('mouseover', opts));
    target.dispatchEvent(new MouseEvent('mouseenter', opts));
}

function dispatchFullPointerSequence(
    target: Element,
    activeElement: HTMLElement,
    opts: MouseEventOptions
): void {
    if (typeof PointerEvent === 'function') {
        const pointerBase: PointerEventOptions = {
            ...opts,
            pointerId: 1,
            pointerType: 'touch',
            isPrimary: true,
            button: 0,
            pressure: 0.5,
        };
        target.dispatchEvent(new PointerEvent('pointerover', pointerBase));
        target.dispatchEvent(new PointerEvent('pointerenter', pointerBase));
        target.dispatchEvent(new PointerEvent('pointerdown', pointerBase));
    }

    target.dispatchEvent(new MouseEvent('mouseover', opts));
    target.dispatchEvent(new MouseEvent('mouseenter', opts));
    target.dispatchEvent(new MouseEvent('mousedown', opts));
    if (typeof activeElement.focus === 'function') activeElement.focus();
    target.dispatchEvent(new MouseEvent('mouseup', opts));

    if (typeof PointerEvent === 'function') {
        const pointerUp: PointerEventOptions = {
            ...opts,
            pointerId: 1,
            pointerType: 'touch',
            isPrimary: true,
            button: 0,
            pressure: 0,
        };
        target.dispatchEvent(new PointerEvent('pointerup', pointerUp));
    }
}

function applyClickFeedback(state: SpatialNavState, activeElement: HTMLElement): void {
    if (!state.overlay) return;
    state.overlay.classList.remove('click-animate');
    void state.overlay.offsetWidth; // force reflow so the animation restarts
    state.overlay.classList.add('click-animate');
    activeElement.classList.add('spatnav-pressed');
    setTimeout(() => {
        if (state.overlay) state.overlay.classList.remove('click-animate');
        activeElement.classList.remove('spatnav-pressed');
    }, CLICK_ANIMATION_MS);
}

// =============================================================================
// Scroll listener
// =============================================================================

/**
 * Attach a scroll listener (capture phase) that updates the overlay when the
 * focused element's viewport position changes. Uses rAF + per-element scroll
 * cache to coalesce updates and skip jitter from smooth-scrolling.
 */
function attachScrollListener(state: SpatialNavState): void {
    const config = state.config;

    if (config.observeScroll === false) {
        log.debug('scroll listener disabled by config');
        return;
    }

    const scrollPositions = new WeakMap<Window | Element, { scrollY: number; scrollX: number }>();
    let scrollTimer: number | null = null;

    window.addEventListener(
        'scroll',
        (event) => {
            if (scrollTimer) return;

            scrollTimer = requestAnimationFrame(() => {
                const rawTarget = event && event.target ? event.target : window;
                if (!rawTarget) {
                    scrollTimer = null;
                    return;
                }
                const target = rawTarget === document ? window : rawTarget;
                const threshold = config.scrollThreshold || 8;

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

                const cached = scrollPositions.get(target as Window | Element) || {
                    scrollY: currentScrollY,
                    scrollX: currentScrollX,
                };
                const deltaY = Math.abs(currentScrollY - cached.scrollY);
                const deltaX = Math.abs(currentScrollX - cached.scrollX);

                // Only update if scroll moved past threshold (prevents smooth-scroll jitter).
                if (deltaY > threshold || deltaX > threshold) {
                    const active = getActiveElement() as HTMLElement | null;
                    if (active && state.currentIndex !== -1) {
                        const currentEntry = state.focusables[state.currentIndex];
                        if (currentEntry) {
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

                    scrollPositions.set(target as Window | Element, {
                        scrollY: currentScrollY,
                        scrollX: currentScrollX,
                    });
                }

                scrollTimer = null;
            });
        },
        {
            capture: true, // Catch overflow:auto sub-scrollers in capture phase
            passive: true, // Don't block scrolling
        }
    );

    state.scrollListenerAttached = true;
}

// =============================================================================
// Public attachment
// =============================================================================

/**
 * Attach global event listeners.
 *
 * Generates a fresh `handlerId` and stamps it on the DOM so that older handlers
 * (from prior content-script injections) self-disable on the next keypress.
 *
 * Why state-only guard, not window-level: window properties live in isolated
 * worlds, so a window flag from a previous injection wouldn't be visible here
 * — we'd attach a duplicate handler. The DOM attribute is shared; the
 * stale-handler guard inside `handleKeyDown` deduplicates at event time.
 */
export function attachHandlers(state: SpatialNavState): void {
    // Bump the handler counter on the DOM (shared across isolated worlds).
    const counterAttr = document.documentElement.getAttribute(HANDLER_COUNTER_ATTR);
    const existingCounter = parseInt(counterAttr || '0', 10);
    const newCounter = existingCounter + 1;
    document.documentElement.setAttribute(HANDLER_COUNTER_ATTR, String(newCounter));

    // Compose a unique handler ID from time + counter + random — same-millisecond
    // inits still get distinct IDs.
    const handlerId = (Date.now() % 100000) * 1000 + newCounter * 100 + Math.floor(Math.random() * 100);

    if (state.handlersAttached) {
        log.debug('state already has handlers, skipping');
        return;
    }

    document.documentElement.setAttribute(HANDLER_ID_ATTR, String(handlerId));
    state.handlerId = handlerId;
    window.__SPATIAL_NAV_HANDLER_ID__ = handlerId;
    window.__SPATIAL_NAV_KEYDOWN_COUNT__ = 0;

    // Capture handlerId in closure — `state.handlerId` gets overwritten by newer handlers.
    const capturedHandlerId = handlerId;
    window.addEventListener(
        'keydown',
        function (e) {
            const currentDomHandlerId = document.documentElement.getAttribute(HANDLER_ID_ATTR);
            if (String(capturedHandlerId) !== currentDomHandlerId) {
                return;
            }
            handleKeyDown(e, state);
        },
        true
    );

    window.addEventListener(
        'focus',
        function (e) {
            const target = e.target;
            if (target === window || target === document) return;
            refreshFocusables(state);
            scheduleOverlayUpdate(target as HTMLElement, state);
        },
        true
    );

    attachScrollListener(state);

    state.handlersAttached = true;
}
