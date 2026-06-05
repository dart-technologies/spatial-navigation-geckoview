/**
 * DOM utilities for Spatial Navigation System
 *
 * Handles element discovery, focus management, and element description.
 * Features Shadow DOM traversal, virtual scroll detection, and accessibility announcer.
 */

import { updateEntryGeometry } from '../core/geometry';
import { FocusGroup, parseFocusGroupAttribute, findFocusGroupContainer } from '../core/focus_group';
import { syncIntersectionObserver, observeNewElement, unobserveElement } from './intersection';
import { createLogger } from './logger';
import type { SpatialNavConfig } from '../core/config';
import type { SpatialNavState, FocusableEntry } from '../core/state';

const log = createLogger('DOM');

/** Threshold above which a focusable refresh is logged as slow (ms). */
const SLOW_REFRESH_THRESHOLD_MS = 50;

const focusableSelector =
    'a[href], a[aria-haspopup], [role="link"], button:not([disabled]), [role="button"], [aria-haspopup="true"], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

// ===== Shadow DOM Traversal =====

/**
 * Upper bound on elements *visited* during a single focusable scan — light DOM
 * and deep shadow traversal alike. Every discovery walks the tree lazily and
 * stops here, so a hostile/pathological page (millions of nodes, deeply nested
 * shadow roots) can never force a full DOM enumeration. Shared across the
 * recursion via a budget object. Set far above any realistic page.
 */
export const MAX_SCAN_NODES = 100_000;

/**
 * Walk elements under `root` in document (pre-order) order via
 * firstElementChild/nextElementSibling, invoking `visit` for each, until the
 * shared `budget` is exhausted (then truncate with a warning). A lazy, bounded
 * alternative to `querySelectorAll`: it never materializes a full NodeList, so a
 * hostile, very large DOM cannot force a complete enumeration before any cap
 * applies. (TreeWalker would be cleaner but is unreliable under happy-dom.)
 */
export function walkElementsBounded(
    root: ParentNode,
    budget: { nodes: number },
    visit: (el: Element) => void
): void {
    const pending: Element[] = [];
    let node: Element | null = root.firstElementChild;
    while (node) {
        if (budget.nodes <= 0) {
            log.warn('DOM scan hit node budget; truncating');
            break;
        }
        budget.nodes--;
        visit(node);
        if (node.nextElementSibling) pending.push(node.nextElementSibling);
        node = node.firstElementChild ?? pending.pop() ?? null;
    }
}

/**
 * Find focusable elements including those in Shadow DOM.
 * Recursively traverses shadow roots; slotted light-DOM content needs no special
 * handling — it is the host's light children, which the same walk already visits.
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
    seen = new Set<Element>(),
    budget: { nodes: number } = { nodes: MAX_SCAN_NODES }
): HTMLElement[] {
    const results: HTMLElement[] = [];

    // Prevent infinite loops with circular shadow DOM references
    if (visited.has(root)) {
        return results;
    }
    if (root.nodeType === 11) {
        // ShadowRoot
        visited.add(root);
    }

    const traverseShadow = !!(config && config.traverseShadowDom);

    // Single lazy, budget-bounded pre-order walk of this root's light tree. Per
    // element: collect it if focusable and descend into its shadow root. One
    // bounded walk (rather than querySelectorAll, which materializes the full
    // match list up front) means a hostile, very large DOM can never force a
    // complete enumeration before the shared node budget applies. The walk stays
    // within this root; the recursion descends across shadow boundaries, sharing
    // the same budget.
    try {
        walkElementsBounded(root as Element | Document, budget, (element) => {
            if (!seen.has(element) && element.matches(focusableSelector)) {
                seen.add(element);
                results.push(element as HTMLElement);
            }

            if (!traverseShadow) {
                return;
            }

            // Descend into the element's shadow root, sharing the budget. We do
            // NOT separately resolve <slot> assignments: slotted content is the
            // host's LIGHT-DOM children, which this same walk already visits in
            // the host's containing tree (deduped via `seen`). Calling
            // slot.assignedElements() would materialize the full assigned array
            // up front — exactly what this bounded walk exists to avoid.
            const host = element as HTMLElement;
            if (host.shadowRoot && !visited.has(host.shadowRoot)) {
                results.push(...findFocusablesDeep(host.shadowRoot, config, visited, seen, budget));
            }
        });
    } catch (e) {
        log.warn('deep DOM traversal error', e);
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
    if (selectors.length === 0) {
        return containers;
    }

    // Validate selectors once on a detached probe (matches() throws on invalid
    // syntax without touching the document), then find matches in a single lazy,
    // budget-bounded walk testing the COMBINED selector list. This avoids
    // querySelectorAll's full match-list materialization — a page matching many
    // of the (default-on) virtual-container selectors cannot force a huge
    // allocation during sentinel setup — while staying one matches() per element
    // regardless of how many selectors are configured.
    const probe = document.createElement('div');
    const valid = selectors.filter((s) => {
        try {
            probe.matches(s);
            return true;
        } catch {
            return false;
        }
    });
    if (valid.length === 0) {
        return containers;
    }
    const combined = valid.join(', ');

    const seen = new Set<HTMLElement>();
    try {
        walkElementsBounded(document, { nodes: MAX_SCAN_NODES }, (el) => {
            if (el.matches(combined)) {
                const host = el as HTMLElement;
                if (!seen.has(host)) {
                    seen.add(host);
                    containers.push(host);
                }
            }
        });
    } catch (e) {
        log.warn('virtual container scan failed', e);
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

    log.debug(`detected ${containers.length} virtual scroll containers`);

    const debounceMs = config.virtualScrollDebounce || 150;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    const observer = new IntersectionObserver(
        (entries) => {
            const shouldRefresh = entries.some((entry) => entry.isIntersecting);

            if (shouldRefresh && !state.virtualScrollPending) {
                state.virtualScrollPending = true;

                if (debounceTimer) {
                    clearTimeout(debounceTimer);
                }

                debounceTimer = setTimeout(() => {
                    log.debug('virtual scroll sentinel triggered refresh');
                    refreshFocusables(state);
                    state.virtualScrollPending = false;
                    state.dirty = true; // Invalidate precomputed cache
                }, debounceMs);
            }
        },
        {
            rootMargin: '300px',
            threshold: 0,
        }
    );

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
        log.debug('accessibility announcer created');
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
export function announce(
    message: string,
    state: SpatialNavState,
    priority: 'polite' | 'assertive' = 'polite'
): void {
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
        a: 'link',
        button: 'button',
        input: (el as HTMLInputElement).type || 'text field',
        select: 'dropdown',
        textarea: 'text area',
        checkbox: 'checkbox',
        radio: 'radio button',
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
 * Upper bound on focusable candidates processed per refresh. Each candidate
 * incurs a `getComputedStyle` plus geometry/group work in the loop below, so an
 * uncapped list would let a hostile page that renders millions of focusable
 * elements turn every focus refresh into a denial of service. Set far above any
 * realistic page (you cannot meaningfully D-pad through tens of thousands of
 * targets anyway), so legitimate content is never truncated.
 */
export const MAX_FOCUSABLE_NODES = 50_000;

/**
 * Truncate the focusable-candidate list to `max`, warning once on overflow.
 * Returns the original array reference when under the cap (no copy on the hot
 * path). Final guard on the per-node processing loop, after the bounded scan
 * (which already caps elements visited) and any iframe additions.
 */
export function capFocusableNodes<T>(nodes: T[], max: number = MAX_FOCUSABLE_NODES): T[] {
    if (nodes.length <= max) {
        return nodes;
    }
    log.warn(`focusable candidates (${nodes.length}) exceed cap ${max}; truncating`);
    return nodes.slice(0, max);
}

/**
 * Refresh the list of focusable elements in the state.
 * Scans DOM for elements matching focusableSelector and updates geometry.
 * Supports Shadow DOM traversal and virtual scroll detection.
 *
 * @param state - Global state object
 */
export function refreshFocusables(state: SpatialNavState): void {
    const startTime = performance.now(); // TODO 4: Performance monitoring
    const config = state.config;

    // Use Shadow DOM traversal if enabled, otherwise a lazy bounded light-DOM scan.
    let nodes: HTMLElement[];
    if (config.traverseShadowDom) {
        nodes = findFocusablesDeep(document, config);
        log.debug(`shadow DOM traversal found ${nodes.length} focusables`);
    } else {
        // Lazy, budget-bounded scan (rather than querySelectorAll, which
        // materializes the full match list) so a hostile page cannot force a
        // complete DOM enumeration before the cap below.
        const collected: HTMLElement[] = [];
        walkElementsBounded(document, { nodes: MAX_SCAN_NODES }, (el) => {
            if (el.matches(focusableSelector)) {
                collected.push(el as HTMLElement);
            }
        });
        nodes = collected;
    }

    log.debug(`candidate nodes found: ${nodes.length}`);

    // Add iframes if iframe support is enabled. Lazy bounded scan (rather than
    // querySelectorAll, which materializes the full match list) so a hostile page
    // cannot force a complete enumeration on this opt-in path either.
    if (config.iframeSupport && config.iframeSupport.enabled) {
        try {
            const selector = config.iframeSupport.selector || 'iframe';
            const existing = new Set<HTMLElement>(nodes);
            walkElementsBounded(document, { nodes: MAX_SCAN_NODES }, (el) => {
                if (el.matches(selector) && !existing.has(el as HTMLElement)) {
                    existing.add(el as HTMLElement);
                    nodes.push(el as HTMLElement);
                }
            });
        } catch (err) {
            log.warn('iframe selector failed', err);
        }
    }

    // Bound the candidate list before the per-node getComputedStyle/geometry
    // pass below — without this, a page rendering millions of focusable elements
    // would make every refresh a DoS.
    nodes = capFocusableNodes(nodes);

    const results: FocusableEntry[] = [];

    // Reset groups for fresh discovery
    // We keep the objects if possible to preserve state (lastFocused), but for now simpler to rebuild
    // TODO: Optimize to preserve group state across refreshes
    const oldGroups = state.focusGroups || Object.create(null);
    // Null-prototype map — focus-group ids are page-controlled (`data-focus-group`),
    // so a plain `{}` would let keys like `__proto__`/`constructor` resolve to
    // inherited members and throw on `group.addMember`. See core/state.ts.
    state.focusGroups = Object.create(null);

    for (let i = 0; i < nodes.length; i++) {
        const el = nodes[i];
        if (!el || typeof (el as HTMLElement).getBoundingClientRect !== 'function') {
            continue;
        }
        const style = window.getComputedStyle(el);
        if (
            !style ||
            style.visibility === 'hidden' ||
            style.display === 'none' ||
            (el as HTMLButtonElement).disabled
        ) {
            continue;
        }
        const entry: FocusableEntry = {
            element: el,
            index: i,
        } as FocusableEntry;

        updateEntryGeometry(entry, state);
        const minSize = state.config.minElementSize || 1;
        if (
            !entry.rect ||
            entry.width <= 1 ||
            entry.height <= 1 ||
            entry.width < minSize ||
            entry.height < minSize
        ) {
            continue;
        }

        const ariaHidden = el.closest('[aria-hidden="true"]');
        if (ariaHidden) {
            continue;
        }

        // Off-screen elements remain in the candidate list — many apps host
        // legitimate off-screen content (carousels, virtual lists). The
        // scorer applies an OFFSCREEN_PENALTY rather than excluding them.

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
    state.focusableElements = results.map((item) => item.element as HTMLElement);
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

        if (duration > SLOW_REFRESH_THRESHOLD_MS) {
            state.perf.slowRefreshCount++;
            log.warn(`slow refresh: ${duration.toFixed(2)}ms (${results.length} elements)`);
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
            oldEl.dispatchEvent(
                new MouseEvent('mouseout', { bubbles: true, cancelable: true, view: window })
            );
            oldEl.dispatchEvent(
                new MouseEvent('mouseleave', { bubbles: false, cancelable: false, view: window })
            );
        } catch {
            /* ignore */
        }
    }
    if (newEl) {
        try {
            newEl.dispatchEvent(
                new MouseEvent('mouseover', { bubbles: true, cancelable: true, view: window })
            );
            newEl.dispatchEvent(
                new MouseEvent('mouseenter', { bubbles: false, cancelable: false, view: window })
            );
            // Some sites might need mousemove to trigger tooltips
            newEl.dispatchEvent(
                new MouseEvent('mousemove', { bubbles: true, cancelable: true, view: window })
            );
        } catch {
            /* ignore */
        }
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
    if (
        !style ||
        style.visibility === 'hidden' ||
        style.display === 'none' ||
        (el as HTMLButtonElement).disabled
    ) {
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
    state.focusables.forEach((e, i) => (e.index = i));
    state.focusableCount = state.focusables.length;

    observeNewElement(state, el);
    log.debug('inserted entry', describeElement(el));
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
    log.debug('removing entry', describeElement(entry.element));

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
    state.focusables.forEach((e, i) => (e.index = i));
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

    log.debug(`incremental refresh complete: ${state.focusables.length} focusables`);
}
