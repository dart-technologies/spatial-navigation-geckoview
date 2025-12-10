/**
 * DOM utilities for Spatial Navigation System
 *
 * Handles element discovery, focus management, and element description.
 * Features Shadow DOM traversal, virtual scroll detection, and accessibility announcer.
 */

import { updateEntryGeometry, isRectVisible } from '../core/geometry';
import { FocusGroup, parseFocusGroupAttribute, findFocusGroupContainer } from '../core/focus_group';
import { syncIntersectionObserver, observeNewElement, unobserveElement } from './intersection';
import type { SpatialNavConfig } from '../core/config';
import type { SpatialNavState, FocusableEntry } from '../core/state';

const focusableSelector = 'a[href], a[aria-haspopup], [role="link"], button:not([disabled]), [role="button"], [aria-haspopup="true"], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

// ===== Shadow DOM Traversal =====

/**
 * Find focusable elements including those in Shadow DOM.
 * Recursively traverses shadow roots and flattens slot assignments.
 *
 * Performance optimizations:
 * - Uses Set<Element> for O(1) duplicate detection instead of Array.includes() O(n)
 * - Single pass through light DOM elements
 * - Early bailout for non-Shadow DOM mode
 *
 * @param root - Root node to search from (document, shadowRoot, or element)
 * @param config - Configuration object
 * @param visited - Set of visited shadow roots (to prevent infinite loops)
 * @param seen - Set of already-found elements (for deduplication)
 * @returns Array of focusable elements
 */
function findFocusablesDeep(
    root: Node,
    config: Partial<SpatialNavConfig>,
    visited = new Set<Node>(),
    seen = new Set<Element>()
): HTMLElement[] {
    const results: HTMLElement[] = [];

    // Prevent infinite loops with circular shadow DOM references
    if (visited.has(root)) {
        return results;
    }
    if (root.nodeType === 11) { // ShadowRoot
        visited.add(root);
    }

    // Light DOM focusables
    try {
        const lightFocusables = (root as Element | Document).querySelectorAll(focusableSelector);
        for (const el of lightFocusables) {
            if (!seen.has(el)) {
                seen.add(el);
                results.push(el as HTMLElement);
            }
        }
    } catch {
        // querySelectorAll may fail on some shadow roots
    }

    // Only traverse Shadow DOM if enabled (expensive operation)
    if (!config || !config.traverseShadowDom) {
        return results;
    }

    // Traverse into shadow roots
    try {
        const allElements = (root as Element | Document).querySelectorAll('*');
        for (const element of allElements) {
            const host = element as HTMLElement;
            if (host.shadowRoot && !visited.has(host.shadowRoot)) {
                const shadowFocusables = findFocusablesDeep(host.shadowRoot, config, visited, seen);
                results.push(...shadowFocusables);
            }
        }
    } catch (e) {
        console.warn('[SpatialNav] Shadow DOM traversal error:', e);
    }

    // Flatten slot assignments (distributed content)
    try {
        const slots = (root as Element | Document).querySelectorAll('slot');
        for (const slot of slots as NodeListOf<HTMLSlotElement>) {
            const assigned = slot.assignedElements({ flatten: true });
            for (const el of assigned) {
                // O(1) duplicate check with Set
                if (!seen.has(el) && el.matches && el.matches(focusableSelector)) {
                    seen.add(el);
                    results.push(el as HTMLElement);
                }
                // Also check shadow roots of assigned elements
                if (el.shadowRoot && config.traverseShadowDom && !visited.has(el.shadowRoot)) {
                    const nestedFocusables = findFocusablesDeep(el.shadowRoot, config, visited, seen);
                    results.push(...nestedFocusables);
                }
            }
        }
    } catch {
        // Slots may not be supported or accessible
    }

    return results;
}

// ===== Virtual Scroll / Infinite List Support =====

/**
 * Detect virtual scroll containers on the page.
 *
 * @param config - Configuration object with virtualContainerSelectors
 * @returns Array of detected virtual containers
 */
export function detectVirtualContainers(config: Partial<SpatialNavConfig>): HTMLElement[] {
    if (!config || !config.observeVirtualContainers) {
        return [];
    }

    const selectors = config.virtualContainerSelectors || [];
    const containers: HTMLElement[] = [];

    for (const selector of selectors) {
        try {
            const found = document.querySelectorAll(selector);
            for (const el of Array.from(found) as HTMLElement[]) {
                if (!containers.includes(el)) {
                    containers.push(el);
                }
            }
        } catch {
            // Invalid selector, skip
        }
    }

    return containers;
}

/**
 * Attach sentinel observers to virtual scroll containers.
 * Triggers refresh when sentinel elements become visible (indicating scroll near boundary).
 *
 * @param state - Global state object
 */
export function attachVirtualScrollSentinels(state: SpatialNavState): void {
    const config = state.config; // Assuming initialized state has config
    if (!config.observeVirtualContainers) {
        return;
    }

    // Disconnect existing observer
    if (state.virtualSentinelObserver) {
        state.virtualSentinelObserver.disconnect();
        state.virtualSentinelObserver = null;
    }

    const containers = detectVirtualContainers(config);
    state.virtualContainers = containers;

    if (containers.length === 0) {
        return;
    }

    // console.log('[SpatialNav] Detected', containers.length, 'virtual scroll containers');

    const debounceMs = config.virtualScrollDebounce || 150;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    const observer = new IntersectionObserver((entries) => {
        const shouldRefresh = entries.some(entry => entry.isIntersecting);

        if (shouldRefresh && !state.virtualScrollPending) {
            state.virtualScrollPending = true;

            if (debounceTimer) {
                clearTimeout(debounceTimer);
            }

            debounceTimer = setTimeout(() => {
                // console.log('[SpatialNav] Virtual scroll sentinel triggered refresh');
                // Import dynamically to avoid circular dependency
                refreshFocusables(state);
                state.virtualScrollPending = false;
                state.dirty = true;  // Invalidate precomputed cache
            }, debounceMs);
        }
    }, {
        rootMargin: '300px',
        threshold: 0
    });

    // Observe sentinel elements (first and last visible children)
    for (const container of containers) {
        const children = container.children;
        if (children.length > 2) {
            // Observe elements near the boundaries
            observer.observe(children[1]);
            observer.observe(children[Math.floor(children.length / 2)]);
            observer.observe(children[children.length - 2]);
        } else if (children.length > 0) {
            observer.observe(children[0]);
            if (children.length > 1) {
                observer.observe(children[children.length - 1]);
            }
        }
    }

    state.virtualSentinelObserver = observer;
}

// ===== Accessibility Announcer =====

/**
 * Setup ARIA live region for accessibility announcements.
 *
 * @param state - Global state object
 */
export function setupAccessibilityAnnouncer(state: SpatialNavState): void {
    const config = state.config;
    if (!config.enableAria) {
        return;
    }

    let announcer = document.getElementById('spatnav-announcer');
    if (!announcer) {
        announcer = document.createElement('div');
        announcer.id = 'spatnav-announcer';
        announcer.setAttribute('aria-live', 'polite');
        announcer.setAttribute('aria-atomic', 'true');
        announcer.setAttribute('role', 'status');
        announcer.className = 'sr-only';
        announcer.style.cssText =
            'position: absolute !important;' +
            'width: 1px !important;' +
            'height: 1px !important;' +
            'padding: 0 !important;' +
            'margin: -1px !important;' +
            'overflow: hidden !important;' +
            'clip: rect(0, 0, 0, 0) !important;' +
            'white-space: nowrap !important;' +
            'border: 0 !important;';
        document.body.appendChild(announcer);
        // console.log('[SpatialNav] Accessibility announcer created');
    }

    state.announcer = announcer;
}

/**
 * Announce a message via ARIA live region.
 *
 * @param message - Message to announce
 * @param state - Global state object
 * @param priority - 'polite' or 'assertive'
 */
export function announce(message: string, state: SpatialNavState, priority: 'polite' | 'assertive' = 'polite'): void {
    const config = state.config;
    if (!config.enableAria || !state.announcer) {
        return;
    }

    // Set priority
    state.announcer.setAttribute('aria-live', priority);

    // Clear then set to trigger announcement (required for repeated messages)
    state.announcer.textContent = '';
    requestAnimationFrame(() => {
        if (state.announcer) {
            state.announcer.textContent = message;
        }
    });
}

/**
 * Get a verbose description of an element for accessibility.
 *
 * @param el - Element to describe
 * @param config - Configuration object
 * @returns Verbose description
 */
export function getAccessibleDescription(el: HTMLElement, config: Partial<SpatialNavConfig>): string {
    if (!el || !el.tagName) {
        return '';
    }

    const parts: string[] = [];

    // Get accessible name (aria-label > aria-labelledby > innerText > title)
    const ariaLabel = el.getAttribute('aria-label');
    const ariaLabelledBy = el.getAttribute('aria-labelledby');
    const title = el.getAttribute('title');

    if (ariaLabel) {
        parts.push(ariaLabel);
    } else if (ariaLabelledBy) {
        const labelEl = document.getElementById(ariaLabelledBy);
        if (labelEl) {
            parts.push(labelEl.textContent?.trim() || '');
        }
    } else {
        const text = el.textContent?.trim().substring(0, 50);
        if (text) {
            parts.push(text);
        }
    }

    if (title && !parts.includes(title)) {
        parts.push(title);
    }

    // Add role information
    const role = el.getAttribute('role') || el.tagName.toLowerCase();
    const roleNames: Record<string, string> = {
        'a': 'link',
        'button': 'button',
        'input': (el as HTMLInputElement).type || 'text field',
        'select': 'dropdown',
        'textarea': 'text area',
        'checkbox': 'checkbox',
        'radio': 'radio button'
    };
    const roleName = roleNames[role] || role;

    if (config && config.verboseDescriptions) {
        return `${parts.join(', ')} (${roleName})`;
    }

    return parts.join(', ') || roleName;
}

/**
 * Get the currently active element (focused).
 * Ignores body/documentElement.
 *
 * @returns Active element or null
 */
export function getActiveElement(): Element | null {
    const active = document.activeElement;
    if (!active || active === document.body || active === document.documentElement) {
        return null;
    }
    return active;
}

/**
 * Create a short string description of an element for debugging.
 * Format: tag#id.class1.class2
 *
 * @param el - Element to describe
 * @returns Description string
 */
export function describeElement(el: Element | null): string {
    if (!el || !el.tagName) {
        return '';
    }
    const id = el.id ? '#' + el.id : '';
    let classes = '';
    if (typeof el.className === 'string' && el.className.trim().length > 0) {
        classes = '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.');
    }
    const text = el.textContent ? ` ("${el.textContent.trim().substring(0, 20)}")` : '';
    return el.tagName.toLowerCase() + id + classes + text;
}

/**
 * Refresh the list of focusable elements in the state.
 * Scans DOM for elements matching focusableSelector and updates geometry.
 * Supports Shadow DOM traversal and virtual scroll detection.
 *
 * @param state - Global state object
 */
export function refreshFocusables(state: SpatialNavState): void {
    const startTime = performance.now();  // TODO 4: Performance monitoring
    const config = state.config;

    // Use Shadow DOM traversal if enabled, otherwise standard querySelectorAll
    let nodes: HTMLElement[];
    if (config.traverseShadowDom) {
        nodes = findFocusablesDeep(document, config);
        // console.log('[SpatialNav] Shadow DOM traversal found', nodes.length, 'focusables');
    } else {
        nodes = Array.from(document.querySelectorAll(focusableSelector)) as HTMLElement[];
    }

    if ((window as any).flutterSpatialNavDebug) {
        console.log(`[SpatialNav] Candidate nodes found: ${nodes.length}`);
    }

    // Add iframes if iframe support is enabled
    if (config.iframeSupport && config.iframeSupport.enabled) {
        try {
            const iframeNodes = Array.from(document.querySelectorAll(config.iframeSupport.selector || 'iframe')) as HTMLElement[];
            iframeNodes.forEach((iframe) => {
                if (!nodes.includes(iframe)) {
                    nodes.push(iframe);
                }
            });
        } catch (err) {
            console.warn('[SpatialNav] iframe selector failed:', err);
        }
    }
    const results: FocusableEntry[] = [];

    // Reset groups for fresh discovery
    // We keep the objects if possible to preserve state (lastFocused), but for now simpler to rebuild
    // TODO: Optimize to preserve group state across refreshes
    const oldGroups = state.focusGroups || {};
    state.focusGroups = {};

    for (let i = 0; i < nodes.length; i++) {
        const el = nodes[i];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (!el || typeof (el as any).getBoundingClientRect !== 'function') {
            continue;
        }
        const style = window.getComputedStyle(el);
        if (!style || style.visibility === 'hidden' || style.display === 'none' || (el as HTMLButtonElement).disabled) {
            /*
            if ((window as any).flutterSpatialNavDebug) {
                console.log(`[SpatialNav] Skipping hidden/disabled element: ${describeElement(el as HTMLElement)} (vis=${style?.visibility}, display=${style?.display}, disabled=${(el as any).disabled})`);
            }
            */
            continue;
        }
        const entry: FocusableEntry = {
            element: el,
            index: i // Temporary index, will be fixed in results array
        } as FocusableEntry;

        updateEntryGeometry(entry, state);
        // Skip tiny elements based on configuration
        const minSize = state.config.minElementSize || 1;
        if (!entry.rect || entry.width <= 1 || entry.height <= 1 || entry.width < minSize || entry.height < minSize) {
            /*
            if ((window as any).flutterSpatialNavDebug) {
                console.log(`[SpatialNav] Skipping tiny/invalid element: ${describeElement(el as HTMLElement)} (width: ${entry.width}, height: ${entry.height})`);
            }
            */
            continue;
        }

        if ((window as any).flutterSpatialNavDebug && results.length < 50) {
            /*
            // Log first 50 items to avoid flooding the log
            console.log(`[SpatialNav] Registered focusable #${results.length}: ${describeElement(el as HTMLElement)} at [${entry.left.toFixed(1)}, ${entry.top.toFixed(1)}] size [${entry.width.toFixed(1)}x${entry.height.toFixed(1)}]`);
            */
        }

        const ariaHidden = el.closest('[aria-hidden="true"]');
        if (ariaHidden) {
            /*
            if ((window as any).flutterSpatialNavDebug) {
                console.log(`[SpatialNav] Skipping aria-hidden element: ${describeElement(el as HTMLElement)} (inside ${describeElement(ariaHidden as HTMLElement)})`);
            }
            */
            // Remove from results if we already added it (we shouldn't have)
            continue;
        }

        // Visible in viewport check
        if (!isRectVisible(entry.rect, 0)) {
            /*
            if ((window as any).flutterSpatialNavDebug) {
                console.log(`[SpatialNav] Skipping off-screen element: ${describeElement(el as HTMLElement)} at [${entry.left.toFixed(1)}, ${entry.top.toFixed(1)}]`);
            }
            */
            // Many apps have legitimate off-screen items, but keep them for now
            // or filter them if you want strict viewport navigation.
            // Our system usually allows navigation to off-screen elements if they are in candidates.
        }

        // Focus Group Logic
        const groupContainer = findFocusGroupContainer(el);
        if (groupContainer) {
            const attr = groupContainer.getAttribute('data-focus-group');
            const parsed = parseFocusGroupAttribute(attr);
            if (parsed && parsed.id) {
                let group = state.focusGroups[parsed.id];
                if (!group) {
                    // Restore old group state if available to keep lastFocused
                    const oldGroup = oldGroups[parsed.id];
                    group = new FocusGroup(parsed.id, groupContainer, parsed.options);
                    if (oldGroup) {
                        group.lastFocused = oldGroup.lastFocused;
                    }
                    state.focusGroups[parsed.id] = group;
                }
                group.addMember(entry);
            }
        }

        results.push(entry);
    }

    // Update indices in final array
    results.forEach((entry, index) => {
        entry.index = index;
    });

    state.focusables = results;
    state.focusableElements = results.map(item => item.element as HTMLElement);
    state.focusableCount = results.length;
    state.currentIndex = state.focusableElements.indexOf(document.activeElement as HTMLElement);

    syncIntersectionObserver(state);

    // Update lastFocused for active group
    if (state.currentIndex !== -1) {
        const activeEntry = state.focusables[state.currentIndex];
        if (activeEntry && activeEntry.groupId) {
            const group = state.focusGroups[activeEntry.groupId];
            if (group) {
                group.updateLastFocused(activeEntry);
            }
        }
    }

    // TODO 4: Performance monitoring (end)
    const duration = performance.now() - startTime;
    if (state.perf) {
        state.perf.refreshCount++;
        state.perf.totalRefreshTime += duration;
        state.perf.averageRefreshTime = state.perf.totalRefreshTime / state.perf.refreshCount;
        state.perf.lastRefreshTime = duration;

        if (duration > 50) {
            state.perf.slowRefreshCount++;
            console.warn(`[SpatialNav] Slow refresh: ${duration.toFixed(2)}ms (${results.length} elements)`);
        }
    }
}

/**
 * Simulate pointer events (hover) for an element transition.
 * Dispatches mouseout/mouseleave on oldEl and mouseover/mouseenter on newEl.
 *
 * @param oldEl - Element losing focus
 * @param newEl - Element gaining focus
 */
export function simulatePointerEvents(oldEl: Element | null, newEl: Element | null): void {
    if (oldEl) {
        try {
            oldEl.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, cancelable: true, view: window }));
            oldEl.dispatchEvent(new MouseEvent('mouseleave', { bubbles: false, cancelable: false, view: window }));
        } catch { /* ignore */ }
    }
    if (newEl) {
        try {
            newEl.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true, view: window }));
            newEl.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false, cancelable: false, view: window }));
            // Some sites might need mousemove to trigger tooltips
            newEl.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, view: window }));
        } catch { /* ignore */ }
    }
}

/**
 * Focus the initial element on the page.
 *
 * @param force - Force focus even if something is already focused
 * @param state - Global state object
 * @returns True if element was focused
 */
export function focusInitialElement(force: boolean, state: SpatialNavState): boolean {
    if (!state.focusables || state.focusables.length === 0) {
        return false;
    }
    const active = getActiveElement();
    if (!force && active) {
        return false;
    }
    const firstEntry = state.focusables[0];
    if (!firstEntry || !firstEntry.element) {
        return false;
    }
    try {
        (firstEntry.element as HTMLElement).focus({ preventScroll: true });
        return true;
    } catch {
        try {
            (firstEntry.element as HTMLElement).focus();
            return true;
        } catch {
            return false;
        }
    }
}

/**
 * Insert a new focusable entry into the state.
 * LLM 2: Incremental diffing for attribute mutations.
 *
 * @param el - Element to insert
 * @param state - Global state object
 */
export function insertEntry(el: Element, state: SpatialNavState): void {
    if (!el || typeof (el as HTMLElement).getBoundingClientRect !== 'function') {
        return;
    }

    const style = window.getComputedStyle(el);
    if (!style || style.visibility === 'hidden' || style.display === 'none' || (el as HTMLButtonElement).disabled) {
        return;
    }

    const entry: FocusableEntry = { element: el } as FocusableEntry;
    updateEntryGeometry(entry, state);

    if (!entry.rect || entry.width <= 1 || entry.height <= 1) {
        return;
    }

    // Handle focus groups
    const groupContainer = findFocusGroupContainer(el as HTMLElement);
    if (groupContainer) {
        const attr = groupContainer.getAttribute('data-focus-group');
        const parsed = parseFocusGroupAttribute(attr);
        if (parsed && parsed.id) {
            const group = state.focusGroups[parsed.id];
            if (group) {
                group.addMember(entry);
            }
        }
    }

    state.focusables.push(entry);
    state.focusableElements.push(el as HTMLElement);

    // Re-index all entries
    state.focusables.forEach((e, i) => e.index = i);
    state.focusableCount = state.focusables.length;

    observeNewElement(state, el);

    // console.log('[SpatialNav] Inserted entry:', describeElement(el));
}

/**
 * Remove a focusable entry from the state by index.
 * LLM 2: Incremental diffing for attribute mutations.
 *
 * @param idx - Index to remove
 * @param state - Global state object
 */
export function removeEntry(idx: number, state: SpatialNavState): void {
    if (idx < 0 || idx >= state.focusables.length) {
        return;
    }

    const entry = state.focusables[idx];
    // console.log('[SpatialNav] Removing entry:', describeElement(entry.element));

    // Remove from focus group
    if (entry.groupId) {
        const group = state.focusGroups[entry.groupId];
        if (group) {
            group.removeMember(entry);
        }
    }

    state.focusables.splice(idx, 1);
    state.focusableElements.splice(idx, 1);
    unobserveElement(state, entry.element);
    if (state.lastFocusedElement === entry.element) {
        state.lastFocusedElement = null;
    }

    // Re-index
    state.focusables.forEach((e, i) => e.index = i);
    state.focusableCount = state.focusables.length;

    // Update currentIndex if needed
    if (state.currentIndex === idx) {
        state.currentIndex = -1;
    } else if (state.currentIndex > idx) {
        state.currentIndex--;
    }
}

/**
 * Refresh focusables based on attribute mutations (incremental update).
 * LLM 2: Only updates elements that changed, avoiding full DOM scan.
 * FIX (MEDIUM): Check visibility and disabled state, not just selector match
 *
 * @param state - Global state object
 * @param mutationList - List of mutations from MutationObserver
 */
export function refreshAttributes(state: SpatialNavState, mutationList: MutationRecord[]): void {
    for (const mutation of mutationList) {
        if (mutation.type === 'attributes') {
            const el = mutation.target as Element;
            const idx = state.focusableElements.indexOf(el as HTMLElement);

            // FIX (MEDIUM): Check both selector AND visibility/disabled state
            const matchesSelector = el.matches && el.matches(focusableSelector);
            let isFocusableNow = false;

            if (matchesSelector) {
                // Reuse same visibility/disabled logic from full scan
                const style = window.getComputedStyle(el);
                const isVisible = style && style.visibility !== 'hidden' && style.display !== 'none';
                const isEnabled = !(el as HTMLButtonElement).disabled;
                const notAriaHidden = el.getAttribute('aria-hidden') !== 'true';

                isFocusableNow = isVisible && isEnabled && notAriaHidden;
            }

            if (idx === -1 && isFocusableNow) {
                // Element became focusable
                insertEntry(el, state);
            } else if (idx !== -1 && !isFocusableNow) {
                // Element no longer focusable (hidden, disabled, or removed from DOM)
                removeEntry(idx, state);
            } else if (idx !== -1) {
                // Element still focusable, update geometry
                const entry = state.focusables[idx];
                updateEntryGeometry(entry, state);
            }
        }
    }

    // console.log('[SpatialNav] Incremental refresh complete:', state.focusables.length, 'focusables');
}
