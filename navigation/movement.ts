/**
 * Movement logic for Spatial Navigation System
 *
 * Handles directional movement, focus updates, and scroll alignment.
 * Features focus trap detection, accessibility announcements, and candidate caching.
 */

import { updateEntryGeometry, isRectVisible } from '../core/geometry';
import { findDirectionalCandidate, type NavigationCandidate } from '../core/scoring';
import { hidePreviewElements } from '../core/preview';
import { hideOverlay } from '../core/overlay';
import {
    getActiveElement,
    simulatePointerEvents,
    describeElement,
    announce,
    getAccessibleDescription,
} from '../utils/dom';
import { dispatchNavEvent } from '../utils/events';
import { directionByName, type Direction, type DirectionMap, type SpatialNavConfig } from '../core/config';
import { sendFocusExit } from '../utils/bridge';
import { clearOverlaySuppression } from '../utils/focus-helpers';
import { createLogger } from '../utils/logger';
import type {
    SpatialNavState,
    FocusableEntry,
    PrecomputedTargets as PrecomputedTargets_State,
} from '../core/state';

const log = createLogger('Movement');

/** Position-hint expiry — older hints are stale for recovery. */
const POSITION_HINT_EXPIRY_MS = 2000;

// ===== Focus Trap Detection =====

interface FocusTrapInfo {
    trap: Element;
    escapeKey: string;
    closeButton: Element | null;
    trapId: string;
}

/**
 * Detect if element is within a focus trap (modal, dialog, overlay).
 *
 * @param element - Element to check
 * @param config - Configuration object
 * @returns Trap info or null
 */
function detectFocusTrap(element: Element, config: Partial<SpatialNavConfig>): FocusTrapInfo | null {
    if (!config || !config.focusTrapDetection) {
        return null;
    }

    const trapSelectors = [
        '[role="dialog"]',
        '[aria-modal="true"]',
        '.modal:not([style*="display: none"]):not([style*="visibility: hidden"])',
        '.overlay:not([style*="display: none"])',
        '[data-focus-trap]',
        '.MuiDialog-root', // Material UI
        '.ReactModal__Content', // react-modal
        '.chakra-modal__content', // Chakra UI
    ];

    for (const selector of trapSelectors) {
        try {
            const trap = element.closest(selector);
            if (trap) {
                // Find escape mechanism
                const closeButton = trap.querySelector(
                    '[data-dismiss], [aria-label*="close" i], [aria-label*="Close" i], ' +
                        'button[class*="close" i], .close-button, [data-testid*="close" i]'
                );

                const escapeKey = (trap as HTMLElement).dataset.escapeKey || 'Escape';

                return {
                    trap,
                    escapeKey,
                    closeButton,
                    trapId: trap.id || trap.getAttribute('aria-labelledby') || 'dialog',
                };
            }
        } catch {
            // Invalid selector, continue
        }
    }

    return null;
}

// ===== Candidate Pre-computation =====

interface PrecomputedTargets {
    [key: string]: NavigationCandidate | null;
}

/**
 * Pre-compute directional candidates in background for performance.
 *
 * @param state - Global state object
 */
export function precomputeCandidates(state: SpatialNavState): void {
    const config = state.config;
    if (!config.precomputeCandidates) {
        return;
    }

    const schedulePrecompute = (callback: () => void): void => {
        if (typeof requestIdleCallback !== 'undefined') {
            requestIdleCallback(callback, { timeout: 100 });
        } else {
            setTimeout(callback, 50);
        }
    };

    schedulePrecompute(() => {
        const active = getActiveElement();
        // active may be Element, but state.focusableElements is HTMLElement[]
        const currentIndex =
            active && active instanceof HTMLElement ? state.focusableElements.indexOf(active) : -1;

        if (currentIndex === -1) {
            return;
        }

        // Only recompute if index changed or cache is dirty
        if (state.precomputedForIndex === currentIndex && !state.dirty) {
            return;
        }

        const targets: PrecomputedTargets = {};
        const dirMap = directionByName as DirectionMap;
        for (const [name, dir] of Object.entries(dirMap)) {
            targets[name] = findDirectionalCandidate(currentIndex, dir, state);
        }

        // PrecomputedTargets interface in state.ts is strict with keys; the
        // runtime targets shape always covers all four directions.
        state.precomputedTargets = targets as unknown as PrecomputedTargets_State;
        state.precomputedForIndex = currentIndex;
        state.precomputedTimestamp = Date.now();
        state.dirty = false;

        log.debug(`pre-computed candidates for index ${currentIndex}`);
    });
}

/**
 * Get cached candidate or compute fresh.
 *
 * @param currentIndex - Current focus index
 * @param direction - Direction object
 * @param state - Global state object
 * @returns Candidate or null
 */
function getCachedOrComputeCandidate(
    currentIndex: number,
    direction: Direction,
    state: SpatialNavState
): NavigationCandidate | null {
    const config = state.config;
    const cacheTimeout = config.precomputeCacheTimeout || 500;

    const cacheAge = Date.now() - (state.precomputedTimestamp || 0);
    const cacheValid =
        state.precomputedForIndex === currentIndex &&
        !state.dirty &&
        cacheAge < cacheTimeout &&
        state.precomputedTargets;

    if (
        cacheValid &&
        state.precomputedTargets &&
        (state.precomputedTargets[direction.name] as NavigationCandidate)
    ) {
        log.debug(`using cached candidate for ${direction.name}`);
        return state.precomputedTargets[direction.name];
    }

    return findDirectionalCandidate(currentIndex, direction, state);
}

/**
 * Move focus in the specified direction.
 * Includes focus trap detection, accessibility announcements, and candidate caching.
 *
 * @param direction - Direction object {axis, sign, name}
 * @param event - Original keyboard event (optional)
 * @param state - Global state object
 * @returns True if focus moved, false otherwise
 */
/**
 * Options for `moveInDirection`.
 */
export interface MoveInDirectionOptions {
    /**
     * When true (default), boundary detection runs the full "no target"
     * pipeline: `sendFocusExit` is relayed to the native host,
     * `spatialNavigationExit` CustomEvent is dispatched on document, the
     * overlay is suppressed.
     *
     * When false, the function returns false on boundary WITHOUT
     * triggering side effects. Used by `handleKeyDown` for the first of
     * its two-attempt navigate-and-retry sequence — the retry decides
     * whether the boundary is genuine, and only THEN do we notify.
     *
     * Before this option existed, both attempts triggered `sendFocusExit`,
     * which propagated to the native host as two `onFocusExit` events,
     * which propagated to analytics as two `trackFocusExit` events.
     * Users saw "noisy clusters" of 2× analytics per boundary keypress
     * (4× across two presses, 8× across four, etc.). Gating the
     * notification on `notifyOnBoundary: true` for the final attempt
     * only collapses each user keypress to at most one analytics event.
     */
    notifyOnBoundary?: boolean;
}

export function moveInDirection(
    direction: Direction,
    event: Event | null,
    state: SpatialNavState,
    options: MoveInDirectionOptions = {}
): boolean {
    const config = state.config;
    const active = getActiveElement();
    const currentIndex =
        active && active instanceof HTMLElement ? state.focusableElements.indexOf(active) : -1;

    if (currentIndex === -1) {
        // Bail BEFORE clearing `overlaySuppressed` — we never actually
        // attempted navigation. The previous order cleared the
        // suppression flag eagerly at the top of the function, then
        // returned `false` here without showing the overlay or wiring
        // any recovery. That stranded the page in the "not suppressed,
        // not shown" state until a NEW suppression source ran. Now the
        // suppression flag only changes when a real navigation attempt
        // begins.
        return false;
    }

    // Past the bail-out: we have a valid active focusable and are
    // committing to a navigation attempt. Clear any in-flight
    // suppression — AND cancel any pending recovery timer — so the
    // overlay is free to follow the new target. The atomic helper
    // matches the cleanup the listener sites in main.ts do, eliminating
    // the prior asymmetry where a successful nav left an orphan timer
    // that would fire 350ms later on stale state.
    if (state.overlaySuppressed) {
        clearOverlaySuppression(state);
    }

    const currentEntry = state.focusables[currentIndex];
    updateEntryGeometry(currentEntry, state);

    // Use cached candidate if available and fresh
    const target = getCachedOrComputeCandidate(currentIndex, direction, state);

    if (!target) {
        // `notifyOnBoundary` defaults to `true` for backwards compatibility
        // with direct callers (debug menu, scripts). The internal
        // `handleKeyDown` retry sets it `false` on the first attempt to
        // avoid double-firing analytics — see `MoveInDirectionOptions`
        // doc-comment above.
        const notifyOnBoundary = options.notifyOnBoundary !== false;

        // Focus trap detection
        const trapInfo = detectFocusTrap(currentEntry.element, config);

        // Dispatch navnotarget event with trap info
        dispatchNavEvent('navnotarget', currentEntry.element, {
            dir: direction.name,
            inTrap: !!trapInfo,
            trapElement: trapInfo?.trap,
            escapeElement: trapInfo?.closeButton ?? undefined,
            escapeKey: trapInfo?.escapeKey,
        });

        if (notifyOnBoundary) {
            // `boundaryScrollBehavior` controls what happens here:
            //   - 'scroll': scroll the page by half a viewport in
            //     vertical directions; suppress the host notification.
            //     Falls through to 'exit' when the page is already at
            //     the scroll extent in that direction — without that
            //     fallthrough, the user can't escape the WebView once
            //     they reach top/bottom of the page (no `focusExit` is
            //     ever sent to the host).
            //   - 'none': silent — no exit event, no scroll.
            //   - 'exit' (default): dispatch `spatialNavigationExit` and
            //     post `focusExit` to the native host.
            const boundaryBehavior = config.boundaryScrollBehavior;

            // Whether the exit-branch below was reached via fall-through
            // from `boundaryScrollBehavior === 'scroll'` (no scroll room
            // in the direction). In that case the host's `focusExit`
            // handler should still get the chance to act (e.g. AAOS
            // pulls focus to the address bar on `up`), but the extension
            // MUST NOT pre-emptively suppress the overlay — for `down`
            // at the page bottom the host typically does nothing and
            // the suppress-then-auto-recover dance produces a visible
            // 350ms "ring slides off and returns" artifact with no
            // actual focus change.
            let fellThroughFromScroll = false;

            if (boundaryBehavior === 'scroll' && (direction.name === 'up' || direction.name === 'down')) {
                const scrollY = window.scrollY;
                const maxScrollY = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
                const hasScrollRoom = direction.name === 'up' ? scrollY > 0 : scrollY < maxScrollY - 1; // 1px tolerance for subpixel rounding

                if (hasScrollRoom) {
                    try {
                        const reducedMotion =
                            window.matchMedia &&
                            window.matchMedia('(prefers-reduced-motion: reduce)').matches;
                        const step = Math.max(120, Math.round(window.innerHeight * 0.5));
                        const delta = direction.name === 'down' ? step : -step;
                        window.scrollBy({
                            top: delta,
                            behavior: reducedMotion ? 'auto' : 'smooth',
                        });
                        log.debug(`boundary scroll: ${direction.name} by ${delta}px`);
                    } catch (e) {
                        log.debug('boundary scroll failed', e);
                    }
                    if (state.nextTargets) {
                        state.nextTargets[direction.name] = null;
                    }
                    state.currentTrap = trapInfo;
                    return false;
                }
                // No scroll room — fall through to the 'exit' branch so
                // the user can escape (e.g., return to the native
                // address bar above the WebView). Mark the fall-through
                // so we skip the local overlay suppress below.
                fellThroughFromScroll = true;
                log.debug(`boundary ${direction.name}: no scroll room, falling through to exit`);
            }

            if (boundaryBehavior === 'none') {
                // Silent boundary — no exit dispatch, no scroll.
                if (state.nextTargets) {
                    state.nextTargets[direction.name] = null;
                }
                state.currentTrap = trapInfo;
                return false;
            }

            // Default 'exit' behaviour. Also reached when
            // `boundaryScrollBehavior === 'scroll'` had no scroll room
            // (see fall-through above).
            // Accessibility announcement for boundaries
            if (config.announceBoundaries) {
                if (trapInfo) {
                    announce(`In ${trapInfo.trapId}. Press ${trapInfo.escapeKey} to close.`, state, 'polite');
                } else {
                    announce(`Edge of content. Cannot move ${direction.name}.`, state, 'polite');
                }
            }

            log.debug(`boundary reached, notifying native: ${direction.name}`);
            sendFocusExit(direction.name, !!trapInfo)
                .then((result) => {
                    if (!result.success) {
                        log.debug('focusExit relay error', result.error);
                    }
                })
                .catch((e) => {
                    log.debug('focusExit error', e);
                });

            if (!fellThroughFromScroll) {
                // Real exit (boundaryScrollBehavior:'exit' OR a
                // legitimately-unscrollable direction in 'scroll' mode
                // — i.e. horizontal). Dispatch the custom event so any
                // wrapper-side suppress-on-exit listener fires.
                try {
                    const exitEvent = new CustomEvent('spatialNavigationExit', {
                        detail: {
                            direction: direction.name,
                            inTrap: !!trapInfo,
                            trapInfo: trapInfo,
                        },
                        bubbles: true,
                        cancelable: false,
                    });
                    document.dispatchEvent(exitEvent);
                } catch (e) {
                    log.warn('failed to dispatch exit event', e);
                }

                // Hide overlay & previews while focus exits to native UI.
                // Without suppression, mutation/scroll observers can re-show the overlay.
                state.overlaySuppressed = true;
                if (state.updateTimer) {
                    cancelAnimationFrame(state.updateTimer);
                    state.updateTimer = null;
                }
                hideOverlay(state);
                hidePreviewElements(state);
            } else {
                log.debug(
                    'scroll-fall-through exit — skipping local overlay suppress; ' +
                        'host handler decides whether focus actually leaves'
                );
            }
        }

        if (state.nextTargets) {
            state.nextTargets[direction.name] = null;
        }

        // Update current trap state
        state.currentTrap = trapInfo;

        return false;
    }

    // Dispatch navbeforefocus event (cancelable)
    const canMove = dispatchNavEvent('navbeforefocus', target.data.element, {
        dir: direction.name,
        relatedTarget: currentEntry.element,
    });

    if (!canMove) {
        // Web app called preventDefault() on navbeforefocus — cancel navigation.
        log.debug('navigation cancelled by navbeforefocus handler');
        if (event) {
            event.preventDefault();
            event.stopPropagation();
        }
        return false;
    }

    if (event) {
        event.preventDefault();
        event.stopPropagation();
    }

    state.lastMove = {
        fromIndex: currentIndex,
        toIndex: target.index,
        direction: direction.name,
        passIndex: typeof target.passIndex === 'number' ? target.passIndex : 0,
        timestamp: Date.now(),
    };

    // log.info (stripped from prod bundle) so debug builds show which
    // element wins the directional scoring without flooding prod
    // logcat at navigation rate. Switch to the .debug.js bundle to
    // capture these via adb when diagnosing "DOWN went somewhere
    // unexpected" reports.
    log.info(
        `moveInDirection(${direction.name}) from=${describeElement(currentEntry.element)} to=${describeElement(target.data.element)} passIndex=${target.passIndex ?? 0}`
    );

    simulatePointerEvents(currentEntry.element, target.data.element);

    const focusApplied = applyFocus(target.data.element, state);

    if (!focusApplied) {
        return false;
    }

    // FIX: Update state.currentIndex immediately so scroll listeners and other logic
    // see the correct active element.
    state.currentIndex = target.index;

    // Clear trap state when successfully moving
    state.currentTrap = null;

    // Accessibility announcement for successful navigation
    if (config.announceNavigation) {
        const description = getAccessibleDescription(target.data.element as HTMLElement, config);
        announce(description, state, 'polite');
    }

    // Update instrumentation immediately for tests
    if (state.instrumentation) {
        state.instrumentation.lastActive = describeElement(target.data.element);
        state.instrumentation.lastOverlay = describeElement(target.data.element);
        state.instrumentation.activeIndex = target.data.index;
        state.instrumentation.lastUpdate = Date.now();
        state.instrumentation.lastDirection = direction.name;
    }

    // Schedule pre-computation for next navigation
    precomputeCandidates(state);

    requestAnimationFrame(function () {
        try {
            const style = window.getComputedStyle(target.data.element);
            const snapAlign = style.scrollSnapAlign;
            let block: ScrollLogicalPosition = 'nearest';
            let inline: ScrollLogicalPosition = 'nearest';

            if (snapAlign && snapAlign !== 'none') {
                if (snapAlign.includes('start')) block = 'start';
                else if (snapAlign.includes('center')) block = 'center';
                else if (snapAlign.includes('end')) block = 'end';

                // Also handle inline/x-axis if needed, but usually block is primary for vertical lists
                if (snapAlign.includes('start')) inline = 'start';
                else if (snapAlign.includes('center')) inline = 'center';
                else if (snapAlign.includes('end')) inline = 'end';
            }

            // Add visual breathing room so the focus ring's outer halo
            // (glow box-shadow + outline-offset) isn't clipped by the
            // viewport edge when `block: 'nearest'` would snap the
            // element flush against the edge.
            //
            // Previously this was a follow-up `scrollBy` in a nested
            // `requestAnimationFrame`, which produced a visible
            // "double-stage" focus settle (element snaps to the edge,
            // then jumps 16 px inward one frame later). The fix:
            // temporarily set `scroll-margin` on the target element
            // BEFORE calling `scrollIntoView`. Native scroll math
            // honours `scroll-margin` and bakes the buffer into the
            // SINGLE atomic scroll — no second frame, no visible
            // double-stage.
            //
            // We restore the prior inline `scroll-margin` after a
            // microtask so page styles aren't permanently mutated.
            const el = target.data.element;
            const SCROLL_BUFFER = '16px';
            const prevScrollMargin = el.style.scrollMargin;
            try {
                el.style.scrollMargin = SCROLL_BUFFER;
                el.scrollIntoView({ block: block, inline: inline });
            } finally {
                // Restore on the next microtask so the scroll math runs
                // with the buffer applied, then the inline style is
                // cleared. We do NOT restore synchronously because some
                // browsers schedule the scroll computation off the main
                // thread and might re-read style mid-scroll.
                queueMicrotask(() => {
                    try {
                        el.style.scrollMargin = prevScrollMargin;
                    } catch {
                        // ignore
                    }
                });
            }
        } catch {
            // ignore scroll failures
        }
    });

    return true;
}

/**
 * Ensure there is a valid focused element before processing navigation.
 * Attempts to recover focus if the current element was removed from the DOM.
 * Uses position-based recovery to prevent "popping to top" during virtual scroll.
 *
 * @param state - Global state object
 * @returns Valid focused element or null if none available
 */
export function ensureValidFocus(state: SpatialNavState): Element | null {
    if (state.config && state.config.autoRefocus === false) {
        return getActiveElement();
    }

    const active = getActiveElement();
    if (active && active instanceof HTMLElement && state.focusableElements.includes(active)) {
        return active;
    }

    const lastElement = state.lastFocusedElement;
    if (lastElement && state.focusableElements.includes(lastElement)) {
        // If focus was lost (e.g. due to scrolling/touch), re-apply focus to the last known
        // element so the next D-pad press continues navigation instead of "boundary" no-op.
        if (applyFocus(lastElement, state)) {
            state.currentIndex = state.focusableElements.indexOf(lastElement);
            return lastElement;
        }
    }

    log.debug('focus lost, attempting recovery');

    // 1. Recover via stored element description from the last overlay update.
    const lastOverlay = state.instrumentation?.lastOverlay;
    if (lastOverlay) {
        const recovered = state.focusables.find((entry: FocusableEntry) => {
            return describeElement(entry.element) === lastOverlay;
        });
        if (recovered?.element && applyFocus(recovered.element, state)) {
            log.debug(`recovered via lastOverlay: ${lastOverlay}`);
            state.currentIndex = state.focusableElements.indexOf(recovered.element);
            return recovered.element;
        }
    }

    // 2. Position-based recovery using a stored geometric hint.
    // Prevents "popping to top" when virtual scroll recycles the focused element.
    const positionHint = state.lastFocusPosition;
    const hintAgeMs = positionHint ? Date.now() - positionHint.timestamp : Infinity;

    if (positionHint && hintAgeMs < POSITION_HINT_EXPIRY_MS && state.focusables.length > 0) {
        log.debug(`using position hint (${hintAgeMs}ms old)`);

        let bestEntry: FocusableEntry | null = null;
        let bestDistance = Infinity;

        for (const entry of state.focusables) {
            if (!entry.rect) continue;
            const dx = entry.centerX - positionHint.centerX;
            const dy = entry.centerY - positionHint.centerY;
            const distance = Math.sqrt(dx * dx + dy * dy);

            if (distance < bestDistance) {
                bestDistance = distance;
                bestEntry = entry;
            }
        }

        if (bestEntry?.element && applyFocus(bestEntry.element, state)) {
            log.debug(
                `position-based recovery: ${describeElement(bestEntry.element)} at ${bestDistance.toFixed(0)}px`
            );
            state.currentIndex = state.focusableElements.indexOf(bestEntry.element);
            state.lastFocusPosition = null;
            return bestEntry.element;
        }
    }

    // 3. Strategy fallback: visible element or first.
    const strategy = state.config?.refocusStrategy ?? 'closest';
    const fallbackEntry: FocusableEntry | undefined =
        strategy === 'first'
            ? state.focusables[0]
            : state.focusables.find((entry: FocusableEntry) => entry.rect && isRectVisible(entry.rect, 0)) ||
              state.focusables[0];

    if (fallbackEntry?.element && applyFocus(fallbackEntry.element, state)) {
        log.debug(`fallback recovery: ${describeElement(fallbackEntry.element)}`);
        state.currentIndex = state.focusableElements.indexOf(fallbackEntry.element);
        return fallbackEntry.element;
    }

    return null;
}

function applyFocus(element: Element, state: SpatialNavState): Element | null {
    if (!element) {
        return null;
    }

    const htmlEl = element as HTMLElement;
    const tagName = (htmlEl.tagName || '').toLowerCase();

    try {
        // Handle IFrames separately
        if (tagName === 'iframe' && state.config?.iframeSupport?.enabled) {
            const iframeEl = htmlEl as HTMLIFrameElement;
            if (
                state.config.iframeSupport.focusMethod === 'contentWindow' &&
                iframeEl.contentWindow &&
                typeof iframeEl.contentWindow.focus === 'function'
            ) {
                iframeEl.contentWindow.focus();
                state.lastFocusedElement = htmlEl;
                return element;
            }
        }

        const focusWithFallback = (): void => {
            if (typeof htmlEl.focus !== 'function') return;
            try {
                htmlEl.focus({ preventScroll: true });
            } catch {
                // Some pages/browsers don't support focus options.
                try {
                    htmlEl.focus();
                } catch {
                    // ignore
                }
            }
        };

        // Standard focus call
        focusWithFallback();

        // Verify focus was accepted
        if (document.activeElement !== htmlEl) {
            // Attempt to make it focusable if it's not
            if (!htmlEl.hasAttribute('tabindex')) {
                log.debug(`element not accepting focus, setting tabindex="-1": ${describeElement(htmlEl)}`);
                htmlEl.setAttribute('tabindex', '-1');
                focusWithFallback();
            }
        }

        if (document.activeElement === htmlEl) {
            state.lastFocusedElement = htmlEl;
            return element;
        }
        log.debug(
            `focus call failed to change activeElement for ${describeElement(htmlEl)}; current=${describeElement(document.activeElement)}`
        );
    } catch (e) {
        log.warn('error during applyFocus', e);
    }

    // Fallback: update state anyway if we're sure this is what we want?
    // Usually it's better to NOT update state if focus didn't move,
    // but some apps manage focus manually on click/keydown.
    // For now, only update if it's actually active.
    if (document.activeElement === htmlEl) {
        state.lastFocusedElement = htmlEl;
        return element;
    }

    return null;
}
