/**
 * IntersectionObserver helpers for Spatial Navigation.
 *
 * Keeps geometry in sync for lazily-loaded elements that enter the viewport.
 */

import { updateEntryGeometry } from '../core/geometry';
import type { SpatialNavState, FocusableEntry } from '../core/state';

function supportsIntersectionObserver(): boolean {
    return typeof window !== 'undefined' && typeof window.IntersectionObserver !== 'undefined';
}

function createObserver(state: SpatialNavState): IntersectionObserver | null {
    if (!supportsIntersectionObserver()) {
        console.warn('[SpatialNav] IntersectionObserver unsupported in this environment');
        return null;
    }

    const config = state.config; // Assuming proper config
    const options: IntersectionObserverInit = {
        root: null,
        rootMargin: config.intersectionRootMargin || '200px',
        threshold: config.intersectionThreshold || 0
    };

    const observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
            const element = entry.target as HTMLElement;
            if (!state.focusableElements) {
                return;
            }
            const idx = state.focusableElements.indexOf(element);
            if (idx === -1) {
                observer.unobserve(element);
                return;
            }
            const focusEntry = state.focusables && state.focusables[idx];
            if (focusEntry) {
                updateEntryGeometry(focusEntry, state);
            }
        });
    }, options);

    return observer;
}

export function syncIntersectionObserver(state: SpatialNavState): void {
    const config = state.config;
    if (!config.observeIntersection || !supportsIntersectionObserver()) {
        detachIntersectionObserver(state);
        return;
    }

    if (!state.intersectionObserver) {
        state.intersectionObserver = createObserver(state);
    } else {
        // If config changed, we might need to recreate, but for now assuming just re-syncing targets
        state.intersectionObserver.disconnect();
    }

    if (!state.intersectionObserver) {
        return;
    }

    if (Array.isArray(state.focusableElements)) {
        state.focusableElements.forEach((element) => {
            try {
                if (state.intersectionObserver) {
                    state.intersectionObserver.observe(element);
                }
            } catch (err) {
                // Ignore observation failures (detached nodes, etc.)
            }
        });
    }
}

export function observeNewElement(state: SpatialNavState, element: Element): void {
    if (!state || !element || !state.intersectionObserver) {
        return;
    }
    try {
        state.intersectionObserver.observe(element);
    } catch (err) {
        // ignore
    }
}

export function unobserveElement(state: SpatialNavState, element: Element): void {
    if (!state || !element || !state.intersectionObserver) {
        return;
    }
    try {
        state.intersectionObserver.unobserve(element);
    } catch (err) {
        // ignore
    }
}

export function detachIntersectionObserver(state: SpatialNavState): void {
    if (state && state.intersectionObserver) {
        state.intersectionObserver.disconnect();
        state.intersectionObserver = null;
    }
}
