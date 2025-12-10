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
import { getActiveElement, simulatePointerEvents, describeElement, announce, getAccessibleDescription } from '../utils/dom';
import { dispatchNavEvent } from '../utils/events';
import { directionByName, type Direction, type DirectionMap, type SpatialNavConfig } from '../core/config';
import { sendFocusExit } from '../utils/bridge';
import type { SpatialNavState, FocusableEntry } from '../core/state';

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
        '.MuiDialog-root',  // Material UI
        '.ReactModal__Content',  // react-modal
        '.chakra-modal__content'  // Chakra UI
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
                    trapId: trap.id || trap.getAttribute('aria-labelledby') || 'dialog'
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
        const currentIndex = active && (active instanceof HTMLElement) ? state.focusableElements.indexOf(active) : -1;

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

        // Casting because PrecomputedTargets interface in state.ts is strict with keys
        state.precomputedTargets = targets as unknown as import('../core/state').PrecomputedTargets;
        state.precomputedForIndex = currentIndex;
        state.precomputedTimestamp = Date.now();
        state.dirty = false;

        // console.log('[SpatialNav] Pre-computed candidates for index', currentIndex);
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
function getCachedOrComputeCandidate(currentIndex: number, direction: Direction, state: SpatialNavState): NavigationCandidate | null {
    const config = state.config;
    const cacheTimeout = config.precomputeCacheTimeout || 500;

    const cacheAge = Date.now() - (state.precomputedTimestamp || 0);
    const cacheValid =
        state.precomputedForIndex === currentIndex &&
        !state.dirty &&
        cacheAge < cacheTimeout &&
        state.precomputedTargets;

    if (cacheValid && state.precomputedTargets && state.precomputedTargets[direction.name] as NavigationCandidate) {
        // console.log('[SpatialNav] Using cached candidate for', direction.name);
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
export function moveInDirection(direction: Direction, event: Event | null, state: SpatialNavState): boolean {
    if (state.overlaySuppressed) {
        state.overlaySuppressed = false;
    }

    const config = state.config;
    const active = getActiveElement();
    const currentIndex = active && (active instanceof HTMLElement) ? state.focusableElements.indexOf(active) : -1;

    if (currentIndex === -1) {
        return false;
    }

    const currentEntry = state.focusables[currentIndex];
    updateEntryGeometry(currentEntry, state);

    // Use cached candidate if available and fresh
    const target = getCachedOrComputeCandidate(currentIndex, direction, state);

    if (!target) {
        // Focus trap detection
        const trapInfo = detectFocusTrap(currentEntry.element, config);

        // Dispatch navnotarget event with trap info
        dispatchNavEvent('navnotarget', currentEntry.element, {
            dir: direction.name,
            inTrap: !!trapInfo,
            trapElement: trapInfo?.trap,
            escapeElement: trapInfo?.closeButton ?? undefined,
            escapeKey: trapInfo?.escapeKey
        });

        // Accessibility announcement for boundaries
        if (config.announceBoundaries) {
            if (trapInfo) {
                announce(
                    `In ${trapInfo.trapId}. Press ${trapInfo.escapeKey} to close.`,
                    state,
                    'polite'
                );
            } else {
                announce(`Edge of content. Cannot move ${direction.name}.`, state, 'polite');
            }
        }

        // At boundary: send message to native layer for focus exit
        // console.log('[SpatialNav] At boundary - notifying native layer for focus exit:', direction.name);

        // Post message to native layer (Relayed via Background Script)
        // Use the centralized bridge utility for consistent Promise/callback handling
        sendFocusExit(direction.name, !!trapInfo)
            .then(result => {
                if (!result.success && window.flutterSpatialNavDebug) {
                    console.warn('[SpatialNav] focusExit relay error:', result.error);
                }
            })
            .catch(e => {
                if (window.flutterSpatialNavDebug) {
                    console.warn('[SpatialNav] focusExit error:', e);
                }
            });

        // Also dispatch custom event for web app listeners
        try {
            const exitEvent = new CustomEvent('spatialNavigationExit', {
                detail: {
                    direction: direction.name,
                    inTrap: !!trapInfo,
                    trapInfo: trapInfo
                },
                bubbles: true,
                cancelable: false
            });
            document.dispatchEvent(exitEvent);
        } catch (e) {
            console.warn('[SpatialNav] Failed to dispatch exit event:', e);
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
        relatedTarget: currentEntry.element
    });

    if (!canMove) {
        // Web app called preventDefault() - cancel navigation
        // console.log('[SpatialNav] Navigation cancelled by navbeforefocus handler');
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
        timestamp: Date.now()
    };

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

            target.data.element.scrollIntoView({ block: block, inline: inline });
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
    if (active && (active instanceof HTMLElement) && state.focusableElements.includes(active)) {
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

    console.warn('[SpatialNav] Focus lost, attempting recovery');

    // Attempt to recover using instrumentation data (element description match)
    const lastOverlay = state.instrumentation?.lastOverlay;
    if (lastOverlay) {
        const recovered = state.focusables.find((entry: FocusableEntry) => {
            return describeElement(entry.element) === lastOverlay;
        });
        if (recovered?.element) {
            if (applyFocus(recovered.element, state)) {
                // console.log('[SpatialNav] Recovered focus via lastOverlay:', lastOverlay);
                state.currentIndex = state.focusableElements.indexOf(recovered.element);
                return recovered.element;
            }
        }
    }

    // NEW: Position-based recovery using stored geometric hint
    // This prevents "popping to top" when virtual scroll recycles the focused element
    const positionHint = state.lastFocusPosition;
    const hintAgeMs = positionHint ? (Date.now() - positionHint.timestamp) : Infinity;
    const HINT_EXPIRY_MS = 2000; // Position hints expire after 2 seconds

    if (positionHint && hintAgeMs < HINT_EXPIRY_MS && state.focusables.length > 0) {
        // console.log('[SpatialNav] Using position hint for recovery:',
        //    positionHint.elementDesc, `(${hintAgeMs}ms old)`);

        // Find element closest to the stored position
        let bestEntry: FocusableEntry | null = null;
        let bestDistance = Infinity;

        for (const entry of state.focusables) {
            if (!entry.rect) continue;

            // Calculate Euclidean distance from stored center point
            const dx = entry.centerX - positionHint.centerX;
            const dy = entry.centerY - positionHint.centerY;
            const distance = Math.sqrt(dx * dx + dy * dy);

            if (distance < bestDistance) {
                bestDistance = distance;
                bestEntry = entry;
            }
        }

        if (bestEntry?.element) {
            // console.log('[SpatialNav] Position-based recovery:',
            //    describeElement(bestEntry.element),
            //    `at distance ${bestDistance.toFixed(0)}px`);

            if (applyFocus(bestEntry.element, state)) {
                state.currentIndex = state.focusableElements.indexOf(bestEntry.element);
                // Clear hint after successful recovery
                state.lastFocusPosition = null;
                return bestEntry.element;
            }
        }
    }

    // Strategy fallback: visible element or first
    const strategy = state.config?.refocusStrategy ?? 'closest';
    let fallbackEntry: FocusableEntry | undefined;

    if (strategy === 'first') {
        fallbackEntry = state.focusables[0];
    } else {
        // 'closest' strategy: find first visible element
        fallbackEntry = state.focusables.find((entry: FocusableEntry) => {
            return entry.rect && isRectVisible(entry.rect, 0);
        }) || state.focusables[0];
    }

    if (fallbackEntry?.element) {
        // console.log('[SpatialNav] Fallback recovery:', describeElement(fallbackEntry.element));
        if (applyFocus(fallbackEntry.element, state)) {
            state.currentIndex = state.focusableElements.indexOf(fallbackEntry.element);
            return fallbackEntry.element;
        }
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
            if (state.config.iframeSupport.focusMethod === 'contentWindow' && iframeEl.contentWindow && typeof iframeEl.contentWindow.focus === 'function') {
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
                if ((window as any).flutterSpatialNavDebug) {
                    console.log(`[SpatialNav] Element not accepting focus, setting tabindex="-1": ${describeElement(htmlEl)}`);
                }
                htmlEl.setAttribute('tabindex', '-1');
                focusWithFallback();
            }
        }

        if (document.activeElement === htmlEl) {
            state.lastFocusedElement = htmlEl;
            return element;
        } else {
            if ((window as any).flutterSpatialNavDebug) {
                console.warn(`[SpatialNav] Focus call failed to change activeElement for: ${describeElement(htmlEl)}. Current active: ${describeElement(document.activeElement)}`);
            }
        }
    } catch (e) {
        console.warn('[SpatialNav] Error during applyFocus:', e);
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
