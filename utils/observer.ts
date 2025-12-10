/**
 * Mutation Observer utilities for Spatial Navigation System
 *
 * Handles DOM mutation detection with buffered architecture and conditional refresh.
 * Features framework-aware refresh scheduling for React/Vue/Angular.
 */

import { refreshFocusables, refreshAttributes, getActiveElement } from './dom';
import { scheduleOverlayUpdate, storePositionHint } from './focus-helpers';
import { hideOverlay } from '../core/overlay';
import type { SpatialNavState } from '../core/state';

// Mutation buffer for batching changes
const mutationBuffer: MutationRecord[] = [];
let mutationTimer: ReturnType<typeof setTimeout> | null = null;

// ===== Framework Detection & Scheduling =====

interface FrameworkAdapter {
    name: string;
    detect: () => boolean | null | undefined | Element;
    scheduleRefresh: (callback: () => void) => void;
}

/**
 * Framework adapters for delayed refresh after reconciliation.
 */
const frameworkAdapters: Record<string, FrameworkAdapter> = {
    react: {
        name: 'React',
        detect: () => {
            const hasHook = typeof window !== 'undefined' && window.__REACT_DEVTOOLS_GLOBAL_HOOK__;
            const reactRoot = document.querySelector('[data-reactroot]');
            const reactId = document.querySelector('[data-reactid]');
            return !!(hasHook || reactRoot || reactId);
        },
        scheduleRefresh: (callback) => {
            // React uses scheduler internally; use postTask if available
            if (typeof scheduler !== 'undefined' && scheduler.postTask) {
                scheduler.postTask(callback, { priority: 'background' });
            } else if (typeof requestIdleCallback !== 'undefined') {
                requestIdleCallback(callback, { timeout: 200 });
            } else {
                // Fallback: wait for microtask + rAF
                Promise.resolve().then(() => requestAnimationFrame(callback));
            }
        }
    },
    vue: {
        name: 'Vue',
        detect: () => {
            const hasVue = typeof window !== 'undefined' && window.__VUE__;
            const vueData = document.querySelector('[data-v-]');
            const vueApp = document.querySelector('.__vue_app__');
            return !!(hasVue || vueData || vueApp);
        },
        scheduleRefresh: (callback) => {
            // Vue uses nextTick which schedules after microtasks
            Promise.resolve().then(() => setTimeout(callback, 50));
        }
    },
    angular: {
        name: 'Angular',
        detect: () => {
            const hasTestability = typeof window !== 'undefined' && typeof window.getAllAngularTestabilities === 'function';
            const ngVersion = document.querySelector('[ng-version]');
            const appRoot = document.querySelector('app-root');
            return !!(hasTestability || ngVersion || appRoot);
        },
        scheduleRefresh: (callback) => {
            // Use Angular's testability API if available
            if (typeof window.getAllAngularTestabilities === 'function') {
                const testabilities = window.getAllAngularTestabilities() as { whenStable: (cb: () => void) => void }[];
                if (testabilities && testabilities.length > 0) {
                    testabilities[0].whenStable(callback);
                    return;
                }
            }
            // Fallback: wait for zone.js to settle
            setTimeout(callback, 100);
        }
    },
    svelte: {
        name: 'Svelte',
        detect: () => {
            return !!(typeof window !== 'undefined' && document.querySelector('[class*="svelte-"]'));
        },
        scheduleRefresh: (callback) => {
            // Svelte is synchronous, just use microtask
            Promise.resolve().then(callback);
        }
    }
};

/**
 * Detect which framework is being used (cached).
 *
 * @param state - Global state object
 * @returns Framework adapter or null
 */
function detectFramework(state: SpatialNavState): FrameworkAdapter | null {
    // Use cached result if available
    if (state.detectedFramework) {
        return state.detectedFramework as FrameworkAdapter;
    }
    if (state.detectedFramework === false) {
        return null;
    }

    for (const [, adapter] of Object.entries(frameworkAdapters)) {
        try {
            if (adapter.detect()) {
                // console.log('[SpatialNav] Detected framework:', adapter.name);
                state.detectedFramework = adapter;
                return adapter;
            }
        } catch {
            // Detection failed, try next
        }
    }

    state.detectedFramework = false;  // Mark as "no framework detected"
    return null;
}

/**
 * Schedule a refresh with framework-aware timing.
 *
 * @param callback - Refresh callback
 * @param state - Global state object
 */
function scheduleFrameworkAwareRefresh(callback: () => void, state: SpatialNavState): void {
    const config = state.config;

    if (!config.frameworkAwareRefresh) {
        // Framework-aware refresh disabled, run immediately
        callback();
        return;
    }

    const framework = detectFramework(state);
    if (framework) {
        framework.scheduleRefresh(callback);
    } else {
        // No framework detected, run immediately
        callback();
    }
}

/**
 * Process buffered mutations with conditional refresh strategy.
 * Uses framework-aware scheduling for optimal performance.
 *
 * @param state - Global state object
 */
function flushMutations(state: SpatialNavState): void {
    if (mutationBuffer.length === 0) return;

    const config = state.config;
    const debounce = config.mutationDebounce || 100;

    if (mutationTimer) clearTimeout(mutationTimer);

    mutationTimer = setTimeout(() => {
        // CRITICAL: Store position hint BEFORE any refresh to enable geometric recovery
        // This prevents "popping to top" when virtual scroll recycles the focused element
        storePositionHint(state);

        // Check if we need full refresh (DOM structure changed)
        const needsFullRefresh = mutationBuffer.some(m => m.type === 'childList');

        // Invalidate precomputed cache
        state.dirty = true;
        state.precomputedTargets = null;

        const doRefresh = (): void => {
            if (needsFullRefresh) {
                // console.log('[SpatialNav] DOM childList mutation, full refresh');
                refreshFocusables(state);
            } else {
                // console.log('[SpatialNav] Attribute mutation, incremental update');
                refreshAttributes(state, mutationBuffer);
            }

            // Update overlay if current element is still valid
            // Explicitly cast result to HTMLElement since scheduleOverlayUpdate expects it
            const active = getActiveElement() as HTMLElement | null;
            if (active && state.focusableElements && state.focusableElements.includes(active)) {
                scheduleOverlayUpdate(active, state);
            } else if (state.overlay) {
                // Current element became unfocusable or was removed
                console.warn('[SpatialNav] Current focus invalidated by mutation');
                hideOverlay(state);
            }
        };

        // Use framework-aware scheduling
        scheduleFrameworkAwareRefresh(doRefresh, state);

        mutationBuffer.length = 0;  // Clear buffer
        mutationTimer = null;
    }, debounce);
}

/**
 * Attach MutationObserver with buffered architecture.
 *
 * @param state - Global state object
 */
export function attachMutationObserver(state: SpatialNavState): void {
    if (state.mutationObserver) return;

    const config = state.config;
    if (config.observeMutations === false) {
        // console.log('[SpatialNav] MutationObserver disabled by config');
        return;
    }

    const observer = new MutationObserver((mutations) => {
        // Filter for relevant mutations only
        const relevantMutations = mutations.filter(mutation => {
            if (mutation.type === 'childList') {
                return mutation.addedNodes.length > 0 || mutation.removedNodes.length > 0;
            }

            if (mutation.type === 'attributes') {
                // FIX (LOW): Include contenteditable for dynamic editors (Twitter compose, Medium)
                const relevantAttrs = ['style', 'class', 'disabled', 'hidden', 'aria-hidden', 'tabindex', 'contenteditable'];
                return relevantAttrs.includes(mutation.attributeName || '');
            }

            return false;
        });

        if (relevantMutations.length > 0) {
            mutationBuffer.push(...relevantMutations);
            flushMutations(state);
        }
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['style', 'class', 'disabled', 'hidden', 'aria-hidden', 'tabindex', 'contenteditable']  // FIX (LOW)
    });

    state.mutationObserver = observer;
    // console.log('[SpatialNav] MutationObserver attached with buffer strategy');
}

/**
 * Detach mutation observer (for cleanup).
 *
 * @param state - Global state object
 */
export function detachMutationObserver(state: SpatialNavState): void {
    if (state.mutationObserver) {
        state.mutationObserver.disconnect();
        state.mutationObserver = null;
        mutationBuffer.length = 0;
        if (mutationTimer) {
            clearTimeout(mutationTimer);
            mutationTimer = null;
        }
        // console.log('[SpatialNav] MutationObserver detached');
    }
}
