(function () {
    'use strict';

    /**
     * Configuration management for GeckoView Spatial Navigation System
     *
     * Handles configuration from window.spatialNavConfig or window.flutterSpatialNavConfig (legacy).
     *
     * Features:
     * - Grid mode for aligned layouts (BBC LRUD-inspired)
     * - Configurable overlap threshold (BBC LRUD)
     * - Wrap/cycle navigation at boundaries
     * - CSS custom property integration (WICG)
     * - Distance function selection (euclidean, manhattan, projected)
     */
    const globalScope = typeof window !== 'undefined' ? window : globalThis;
    /**
     * Get the current spatial navigation configuration.
     * Merges user-provided config with defaults.
     */
    function getConfig() {
        // Support both new and legacy config names
        const userConfig = globalScope.spatialNavConfig || globalScope.flutterSpatialNavConfig || {};
        return {
            // Visual styling
            color: userConfig.color || '#FFC107',
            outlineWidth: userConfig.outlineWidth || 3,
            outlineOffset: userConfig.outlineOffset || 3,
            // Overlay/preview visual options
            overlayZIndex: userConfig.overlayZIndex || 2147483646,
            arrowScale: typeof userConfig.arrowScale === 'number' ? userConfig.arrowScale : 1.0,
            disabledColor: userConfig.disabledColor || '128, 128, 128',
            overlayTheme: userConfig.overlayTheme === 'high-contrast' ? 'high-contrast' : 'default',
            safeAreaMargin: typeof userConfig.safeAreaMargin === 'number' ? Math.max(0, userConfig.safeAreaMargin) : 12,
            overlayScrimOpacity: typeof userConfig.overlayScrimOpacity === 'number'
                ? Math.min(Math.max(userConfig.overlayScrimOpacity, 0), 1)
                : 0.06,
            overlayGlowOpacity: typeof userConfig.overlayGlowOpacity === 'number'
                ? Math.min(Math.max(userConfig.overlayGlowOpacity, 0), 1)
                : 0.35,
            overlayGlowBlur: typeof userConfig.overlayGlowBlur === 'number'
                ? Math.max(0, userConfig.overlayGlowBlur)
                : 14,
            // Dynamic content observation
            observeMutations: userConfig.observeMutations !== false,
            observeScroll: userConfig.observeScroll !== false,
            mutationDebounce: userConfig.mutationDebounce || 100,
            scrollThreshold: userConfig.scrollThreshold || 8,
            // Intersection observer (lazy-load support)
            observeIntersection: userConfig.observeIntersection === true,
            intersectionRootMargin: userConfig.intersectionRootMargin || '200px',
            intersectionThreshold: typeof userConfig.intersectionThreshold === 'number'
                ? Math.min(Math.max(userConfig.intersectionThreshold, 0), 1)
                : 0,
            // Recovery / refocus
            autoRefocus: userConfig.autoRefocus !== false,
            refocusStrategy: userConfig.refocusStrategy || 'closest',
            // iframe handling
            iframeSupport: {
                enabled: userConfig.iframeSupport?.enabled === true,
                selector: userConfig.iframeSupport?.selector || 'iframe',
                focusMethod: userConfig.iframeSupport?.focusMethod || 'element'
            },
            focusGroups: {
                enabled: userConfig.focusGroups?.enabled ?? false,
                defaultRules: userConfig.focusGroups?.defaultRules ?? {},
                boundaryBehavior: userConfig.focusGroups?.boundaryBehavior ?? 'exit',
            },
            // Shadow DOM traversal
            traverseShadowDom: userConfig.traverseShadowDom === true,
            // Virtual scroll / infinite list support
            observeVirtualContainers: userConfig.observeVirtualContainers !== false,
            virtualContainerSelectors: userConfig.virtualContainerSelectors || [
                '[data-virtualized]',
                '.ReactVirtualized__Grid',
                '.ReactVirtualized__List',
                '[data-testid="virtuoso-item-list"]',
                '.infinite-scroll-component',
                '[data-infinite-scroll]',
                'ytd-rich-grid-renderer',
                '[data-testid="primaryColumn"]'
            ],
            virtualScrollDebounce: userConfig.virtualScrollDebounce || 150,
            // Accessibility / ARIA announcements
            enableAria: userConfig.enableAria === true,
            announceNavigation: userConfig.announceNavigation === true,
            announceBoundaries: userConfig.announceBoundaries === true,
            verboseDescriptions: userConfig.verboseDescriptions === true,
            // Focus trap detection
            focusTrapDetection: userConfig.focusTrapDetection === true,
            // Framework-aware refresh
            frameworkAwareRefresh: userConfig.frameworkAwareRefresh !== false,
            // Candidate pre-computation
            precomputeCandidates: userConfig.precomputeCandidates !== false,
            precomputeCacheTimeout: userConfig.precomputeCacheTimeout || 500,
            // Scoring algorithm mode
            scoringMode: userConfig.scoringMode || 'geometric',
            distanceFunction: userConfig.distanceFunction || 'euclidean',
            // Overlap threshold
            overlapThreshold: typeof userConfig.overlapThreshold === 'number' ? userConfig.overlapThreshold : 0,
            // Grid mode settings
            gridAlignmentTolerance: typeof userConfig.gridAlignmentTolerance === 'number'
                ? userConfig.gridAlignmentTolerance : 20,
            // Wrap navigation
            wrapNavigation: userConfig.wrapNavigation === true,
            // CSS custom property integration
            useCSSProperties: userConfig.useCSSProperties !== false,
            // Element filtering
            minElementSize: typeof userConfig.minElementSize === 'number' ? userConfig.minElementSize : 1,
        };
    }
    /**
     * Update configuration at runtime.
     */
    function updateConfig(newConfig) {
        const existing = globalScope.flutterSpatialNavConfig || {};
        globalScope.flutterSpatialNavConfig = {
            ...existing,
            ...newConfig,
        };
    }
    /**
     * Direction mappings for arrow keys.
     */
    const directionByKey = {
        ArrowDown: { axis: 'y', sign: 1, name: 'down' },
        ArrowUp: { axis: 'y', sign: -1, name: 'up' },
        ArrowRight: { axis: 'x', sign: 1, name: 'right' },
        ArrowLeft: { axis: 'x', sign: -1, name: 'left' }
    };
    const directionByName = {
        down: directionByKey.ArrowDown,
        up: directionByKey.ArrowUp,
        right: directionByKey.ArrowRight,
        left: directionByKey.ArrowLeft
    };
    const directionKeys = ['down', 'up', 'right', 'left'];

    /**
     * Global state management for GeckoView Spatial Navigation System
     *
     * Maintains focus state with persistence across page navigations.
     * State is stored on window.spatialNavState to survive SPA navigations.
     */
    /**
     * Initialize or retrieve the global spatial navigation state.
     * State persists across page navigations in SPAs.
     */
    function getState(config) {
        // Reuse existing state if available (SPA navigation)
        // Support both new and legacy names
        const existingState = window.spatialNavState || window.flutterFocusState;
        const state = existingState || {};
        // Persist to both names for compatibility
        window.spatialNavState = state;
        window.flutterFocusState = state;
        // Core navigation state
        state.config = config;
        state.version = '3.0.0';
        state.currentIndex = typeof state.currentIndex === 'number' ? state.currentIndex : -1;
        state.initialized = !!state.initialized;
        state.handlersAttached = !!state.handlersAttached;
        state.runtime = state.runtime || {
            mode: 'injected',
            hasBrowser: false,
            hasChrome: false,
            canConnect: false,
            canSendMessage: false,
        };
        // Focus tracking arrays
        state.focusables = Array.isArray(state.focusables) ? state.focusables : [];
        state.focusableElements = Array.isArray(state.focusableElements) ? state.focusableElements : [];
        state.focusGroups = state.focusGroups || {};
        state.lastRefreshTime = state.lastRefreshTime || 0;
        state.focusableCount = state.focusableCount || 0;
        // Preview/animation state
        state.previewEnabled = state.previewEnabled !== undefined ? !!state.previewEnabled : true;
        state.previewElements = state.previewElements || null;
        state.previewLayer = state.previewLayer || null;
        state.overlay = state.overlay || null;
        state.overlayHost = state.overlayHost || null;
        state.activeResizeObserver = state.activeResizeObserver || null;
        state.updateTimer = state.updateTimer || null;
        state.overlaySuppressed = state.overlaySuppressed ?? false;
        state.nextTargets = state.nextTargets || { up: null, down: null, left: null, right: null };
        state.noTargetTimers = state.noTargetTimers || { up: null, down: null, left: null, right: null };
        state.lastFocusedElement = state.lastFocusedElement || null;
        state.lastFocusPosition = state.lastFocusPosition || null;
        state.lastMove = state.lastMove || null;
        state.lastBoundary = state.lastBoundary || null;
        // Performance caches
        state.scrollCache = state.scrollCache || new WeakMap();
        state.scrollListenerAttached = !!state.scrollListenerAttached;
        // Observers
        state.intersectionObserver = state.intersectionObserver || null;
        state.mutationObserver = state.mutationObserver || null;
        // Debugging/instrumentation
        state.emitTitleOnMismatch = !!state.emitTitleOnMismatch;
        state.instrumentation = state.instrumentation || {
            lastOverlay: '',
            lastActive: '',
            mismatchCount: 0,
            overlayIndex: -1,
            activeIndex: -1,
            lastMismatch: null,
            lastUpdate: 0,
            lastDirection: ''
        };
        // Performance monitoring
        state.perf = state.perf || {
            refreshCount: 0,
            totalRefreshTime: 0,
            averageRefreshTime: 0,
            lastRefreshTime: 0,
            slowRefreshCount: 0
        };
        // Virtual scroll / infinite list state
        state.virtualContainers = state.virtualContainers || [];
        state.virtualSentinelObserver = state.virtualSentinelObserver || null;
        state.virtualScrollPending = false;
        // Candidate pre-computation cache
        state.precomputedTargets = state.precomputedTargets || null;
        state.precomputedForIndex = state.precomputedForIndex ?? -1;
        state.precomputedTimestamp = state.precomputedTimestamp ?? 0;
        state.dirty = state.dirty ?? false;
        // Accessibility announcer
        state.announcer = state.announcer || null;
        // Focus trap state
        state.currentTrap = state.currentTrap || null;
        // Framework detection cache
        state.detectedFramework = state.detectedFramework || null;
        // Handler ID for stale handler detection (0 means not yet assigned)
        state.handlerId = state.handlerId || 0;
        return state;
    }

    /**
     * Geometry utilities for GeckoView Spatial Navigation System
     *
     * Handles element position calculations, visibility checks, and rect operations.
     */
    /**
     * Resolve the scroll container key for an element.
     * Uses caching to avoid repeated DOM traversals.
     */
    function resolveScrollKey(element, state) {
        if (!element || element === document.body || element === document.documentElement) {
            return 'body';
        }
        const cached = state.scrollCache.get(element);
        if (cached !== undefined) {
            return cached;
        }
        let node = element;
        while (node && node !== document.body && node !== document.documentElement) {
            const style = window.getComputedStyle(node);
            const overflow = (style.overflow + style.overflowX + style.overflowY).toLowerCase();
            if (overflow.includes('auto') || overflow.includes('scroll')) {
                const key = node.id && node.id.length
                    ? '#' + node.id
                    : node.className && node.className.toString().trim().length
                        ? node.tagName.toLowerCase() + '.' + node.className.toString().trim().split(/\s+/).slice(0, 2).join('.')
                        : node.tagName.toLowerCase();
                state.scrollCache.set(element, key);
                return key;
            }
            node = node.parentElement;
        }
        state.scrollCache.set(element, 'body');
        return 'body';
    }
    /**
     * Calculate the visual bounding rect for an element, potentially expanding
     * it to encompass a larger visual child (logo, image, etc).
     */
    function calculateVisualRect(element) {
        let rect = element.getBoundingClientRect();
        // Expansion: Check if element contains a single visual child that's larger
        // (Common in logos or image buttons where the hit area is smaller than the asset)
        const visualChild = element.querySelector('img, svg, video, picture, canvas');
        if (visualChild) {
            const childRect = visualChild.getBoundingClientRect();
            // Only expand if the child is actually larger or significantly offset
            if (childRect.width > rect.width || childRect.height > rect.height ||
                childRect.left < rect.left || childRect.top < rect.top) {
                // Return a merged rect or just the child rect if it's the primary visual
                // For most "logo" cases, the child rect is exactly what we want to highlight
                rect = childRect;
            }
        }
        return rect;
    }
    /**
     * Update geometry properties for a focusable entry.
     * Calculates bounding rect, center point, and scroll container.
     */
    function updateEntryGeometry(entry, state) {
        if (!entry || !entry.element || typeof entry.element.getBoundingClientRect !== 'function') {
            return null;
        }
        // Use the base bounding rect for navigation logic (center points, distance, edges)
        // This keeps navigation intuitive regardless of visual expansion (logos, etc.)
        const rect = entry.element.getBoundingClientRect();
        entry.left = rect.left;
        entry.top = rect.top;
        entry.right = rect.right;
        entry.bottom = rect.bottom;
        entry.width = rect.width;
        entry.height = rect.height;
        entry.centerX = rect.left + rect.width / 2;
        entry.centerY = rect.top + rect.height / 2;
        entry.rect = rect;
        entry.scrollKey = resolveScrollKey(entry.element, state);
        return entry;
    }
    /**
     * Check if a rect is visible within viewport with optional margin.
     */
    function isRectVisible(rect, margin) {
        if (!rect) {
            return false;
        }
        const m = Math.max(0, margin || 0);
        const horizontalVisible = rect.right >= -m && rect.left <= window.innerWidth + m;
        const verticalVisible = rect.bottom >= -m && rect.top <= window.innerHeight + m;
        return horizontalVisible && verticalVisible;
    }

    /**
     * Runtime context detection (Injected script vs WebExtension).
     *
     * GeckoView can run this bundle either:
     * - As a WebExtension content script (browser/chrome runtime APIs available)
     * - As an injected script (no extension runtime APIs)
     */
    function detectRuntimeContext() {
        const globalAny = globalThis;
        const hasBrowser = typeof globalAny.browser !== 'undefined' && !!globalAny.browser;
        const hasChrome = typeof globalAny.chrome !== 'undefined' && !!globalAny.chrome;
        const runtime = globalAny.browser?.runtime ?? globalAny.chrome?.runtime;
        const canConnect = typeof runtime?.connect === 'function';
        const canSendMessage = typeof runtime?.sendMessage === 'function';
        // If either browser/chrome exists, treat this as WebExtension mode.
        const mode = (hasBrowser || hasChrome) ? 'webextension' : 'injected';
        return {
            mode,
            hasBrowser,
            hasChrome,
            canConnect,
            canSendMessage
        };
    }
    function formatRuntimeLabel(context) {
        if (context.mode === 'webextension') {
            const bridge = context.canSendMessage ? 'bridge:on' : 'bridge:off';
            return `WebExtension (${bridge})`;
        }
        return 'Injected (no bridge)';
    }

    /**
     * Overlay management for GeckoView Spatial Navigation System
     *
     * Creates and manages Shadow DOM overlay for visual focus indicators.
     * Includes main focus overlay and directional preview elements.
     */
    // Constants
    const styleId = 'spatnav-focus-styles';
    const overlayHostId = 'spatnav-focus-host';
    const focusOverlayId = 'spatnav-focus-overlay';
    const overlayLabelId = 'spatnav-focus-label';
    const debugHudId = 'spatnav-debug-hud';
    const themeAttr = 'data-spatnav-theme';
    const runtimeAttr = 'data-spatnav-runtime';
    /**
     * Ensure CSS styles are injected into document head.
     * Removes default focus outlines since Shadow DOM provides visual indicator.
     */
    function ensureStyles(config) {
        /* eslint-disable max-len */
        const css = `
/* GeckoView Spatial Nav: Shadow DOM overlay provides focus indicator */
*:focus,
*:focus-visible,
*:focus-within,
a:focus, a:focus-visible,
a:link:focus, a:visited:focus, a:hover:focus, a:active:focus,
button:focus, button:focus-visible,
input:focus, input:focus-visible,
select:focus, textarea:focus,
[tabindex]:focus, [tabindex]:focus-visible,
[contenteditable]:focus,
body *:focus, body *:focus-visible {
    outline: none !important;
    outline-width: 0 !important;
    outline-style: none !important;
    outline-color: transparent !important;
    box-shadow: none !important;
    -webkit-focus-ring-color: transparent !important;
    -webkit-tap-highlight-color: transparent !important;
}
/* Also suppress Firefox-specific focus rings */
*::-moz-focus-inner {
    border: 0 !important;
}

/* Spatial navigation press feedback */
.spatnav-pressed {
    transform: scale(0.97) !important;
    transition: transform 0.09s ease-out !important;
    will-change: transform;
}
@media (prefers-reduced-motion: reduce) {
    .spatnav-pressed {
        transition: none !important;
        transform: none !important;
    }
}
`;
        /* eslint-enable max-len */
        let style = document.getElementById(styleId);
        if (!style) {
            style = document.createElement('style');
            style.id = styleId;
            document.head.appendChild(style);
        }
        style.textContent = css;
    }
    /**
     * Create or retrieve the Shadow DOM overlay host.
     * Sets up focus overlay and preview layer with CSS transitions.
     */
    function ensureOverlay(config, state) {
        if (!document.body) {
            return;
        }
        // Always remove and recreate to ensure clean state
        let host = document.getElementById(overlayHostId);
        if (host) {
            host.remove();
        }
        host = document.createElement('div');
        host.id = overlayHostId;
        host.style.cssText = `position: fixed; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; z-index: ${config.overlayZIndex || 2147483646};`;
        host.setAttribute(themeAttr, config.overlayTheme || 'default');
        document.body.appendChild(host);
        const shadow = host.attachShadow({ mode: 'open' });
        const shadowStyle = document.createElement('style');
        shadowStyle.textContent = generateShadowCSS(config);
        shadow.appendChild(shadowStyle);
        // Preview layer for directional indicators
        const previewLayer = document.createElement('div');
        previewLayer.id = 'focus-preview-layer';
        shadow.appendChild(previewLayer);
        // Main focus overlay
        const overlay = document.createElement('div');
        overlay.id = focusOverlayId;
        overlay.style.display = 'none';
        overlay.style.transform = 'translate3d(0, 0, 0)';
        shadow.appendChild(overlay);
        // Focus label (debug mode only)
        const focusLabel = document.createElement('div');
        focusLabel.id = overlayLabelId;
        const labelText = document.createElement('span');
        labelText.className = 'sn-label-text';
        const labelRuntime = document.createElement('span');
        labelRuntime.className = 'sn-label-badge sn-label-runtime';
        const labelSuppressed = document.createElement('span');
        labelSuppressed.className = 'sn-label-badge sn-label-suppressed';
        focusLabel.appendChild(labelText);
        focusLabel.appendChild(labelRuntime);
        focusLabel.appendChild(labelSuppressed);
        shadow.appendChild(focusLabel);
        // Debug HUD (always visible in debug mode)
        const hud = document.createElement('div');
        hud.id = debugHudId;
        hud.style.display = 'none';
        shadow.appendChild(hud);
        // Update state references
        const overlayRef = host.shadowRoot?.getElementById(focusOverlayId);
        if (overlayRef) {
            state.overlay = overlayRef;
            updateRuntimeLabel(state);
            updateDebugHud(state);
        }
        else {
            console.error('[SpatialNav] ❌ Failed to get overlay reference from shadow DOM!');
        }
        if (host.shadowRoot) {
            const previewRef = host.shadowRoot.getElementById('focus-preview-layer');
            if (previewRef) {
                state.previewLayer = previewRef;
            }
        }
        state.overlayHost = host;
    }
    function updateRuntimeLabel(state) {
        if (!state.overlay)
            return;
        // Only show the runtime label in debug mode.
        if (!window.flutterSpatialNavDebug) {
            state.overlay.removeAttribute(runtimeAttr);
            return;
        }
        const runtime = state.runtime;
        if (!runtime) {
            state.overlay.removeAttribute(runtimeAttr);
            return;
        }
        const label = formatRuntimeLabel(runtime);
        state.overlay.setAttribute(runtimeAttr, label);
    }
    function updateDebugHud(state) {
        const shadow = state.overlayHost?.shadowRoot;
        if (!shadow)
            return;
        const hud = shadow.getElementById(debugHudId);
        if (!hud)
            return;
        const debugEnabled = !!window.flutterSpatialNavDebug;
        if (!debugEnabled) {
            hud.style.display = 'none';
            return;
        }
        const runtime = state.runtime ? formatRuntimeLabel(state.runtime) : 'unknown';
        const suppressed = state.overlaySuppressed ? 'suppressed' : 'active';
        hud.textContent = `SpatialNav · ${runtime} · ${suppressed}`;
        const safe = Math.max(0, state.config?.safeAreaMargin ?? 0);
        hud.style.left = (safe + 8) + 'px';
        hud.style.top = (safe + 8) + 'px';
        hud.style.display = 'block';
    }
    function getElementLabelText(element) {
        const ariaLabel = element.getAttribute('aria-label')?.trim();
        if (ariaLabel)
            return ariaLabel;
        const ariaLabelledBy = element.getAttribute('aria-labelledby')?.trim();
        if (ariaLabelledBy) {
            const ids = ariaLabelledBy.split(/\s+/).filter(Boolean);
            for (const id of ids) {
                const labelEl = document.getElementById(id);
                const text = labelEl?.textContent?.trim();
                if (text)
                    return text;
            }
        }
        const title = element.getAttribute('title')?.trim();
        if (title)
            return title;
        const alt = element.getAttribute('alt')?.trim();
        if (alt)
            return alt;
        const text = element.textContent?.replace(/\s+/g, ' ').trim();
        if (text)
            return text;
        const role = element.getAttribute('role')?.trim();
        if (role)
            return role;
        return element.tagName.toLowerCase();
    }
    function truncateLabel(text, maxChars) {
        if (!text)
            return '';
        const normalized = text.replace(/\s+/g, ' ').trim();
        if (normalized.length <= maxChars)
            return normalized;
        return normalized.slice(0, Math.max(0, maxChars - 1)).trimEnd() + '…';
    }
    function updateFocusLabel(state, focusedElement, overlayRect) {
        const shadow = state.overlayHost?.shadowRoot;
        if (!shadow)
            return;
        const label = shadow.getElementById(overlayLabelId);
        if (!label)
            return;
        const debugEnabled = !!window.flutterSpatialNavDebug;
        if (!debugEnabled) {
            label.classList.remove('visible');
            return;
        }
        const textEl = label.querySelector('.sn-label-text');
        const runtimeEl = label.querySelector('.sn-label-runtime');
        const suppressedEl = label.querySelector('.sn-label-suppressed');
        const raw = getElementLabelText(focusedElement);
        const text = truncateLabel(raw, 48);
        if (textEl) {
            textEl.textContent = text;
            textEl.setAttribute('title', raw);
        }
        if (runtimeEl) {
            const runtime = state.runtime ? formatRuntimeLabel(state.runtime) : 'unknown';
            runtimeEl.textContent = runtime;
            runtimeEl.style.display = runtime ? '' : 'none';
        }
        if (suppressedEl) {
            suppressedEl.textContent = state.overlaySuppressed ? 'suppressed' : '';
            suppressedEl.style.display = state.overlaySuppressed ? '' : 'none';
        }
        // Position inside the overlay, with a small inset. Clamp to viewport.
        const inset = 6;
        const safe = Math.max(0, state.config?.safeAreaMargin ?? 0);
        const maxLeft = Math.max(0, (window?.innerWidth ?? 0) - safe - 1);
        const maxTop = Math.max(0, (window?.innerHeight ?? 0) - safe - 1);
        const left = Math.min(Math.max(safe, overlayRect.left + inset), maxLeft);
        const top = Math.min(Math.max(safe, overlayRect.top + inset), maxTop);
        label.style.left = left + 'px';
        label.style.top = top + 'px';
        // Keep label reasonably sized, favoring the overlay width.
        const maxWidth = Math.min(Math.max(120, overlayRect.width - inset * 2), Math.max(120, (window?.innerWidth ?? 0) - safe * 2 - inset * 2));
        label.style.maxWidth = maxWidth + 'px';
        label.classList.add('visible');
    }
    /**
     * Parse color string to extract RGB components for opacity variants.
     */
    function parseColor(color) {
        const defaultRGB = { r: 255, g: 193, b: 7 };
        if (!color || typeof color !== 'string') {
            return defaultRGB;
        }
        // Handle hex colors
        if (color.startsWith('#')) {
            const hex = color.slice(1);
            if (hex.length === 3) {
                return {
                    r: parseInt(hex[0] + hex[0], 16),
                    g: parseInt(hex[1] + hex[1], 16),
                    b: parseInt(hex[2] + hex[2], 16)
                };
            }
            else if (hex.length === 6) {
                return {
                    r: parseInt(hex.slice(0, 2), 16),
                    g: parseInt(hex.slice(2, 4), 16),
                    b: parseInt(hex.slice(4, 6), 16)
                };
            }
        }
        // Handle rgb/rgba
        const rgbMatch = color.match(/rgba?\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
        if (rgbMatch) {
            return {
                r: parseInt(rgbMatch[1], 10),
                g: parseInt(rgbMatch[2], 10),
                b: parseInt(rgbMatch[3], 10)
            };
        }
        return defaultRGB;
    }
    /**
     * Generate Shadow DOM CSS for overlay and previews.
     */
    function generateShadowCSS(config) {
        let rgb = parseColor(config.color);
        // Auto-adjust for dark mode
        const isDarkMode = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
        if (isDarkMode) {
            const luminance = (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;
            if (luminance < 0.5) {
                rgb = {
                    r: Math.min(255, Math.round(rgb.r * 1.3)),
                    g: Math.min(255, Math.round(rgb.g * 1.3)),
                    b: Math.min(255, Math.round(rgb.b * 1.3))
                };
            }
        }
        const colorBase = `${rgb.r}, ${rgb.g}, ${rgb.b}`;
        const overlayZIndex = config.overlayZIndex || 2147483646;
        const previewZIndex = overlayZIndex - 1;
        const arrowScale = config.arrowScale || 1.0;
        const arrowWidth = Math.round(8 * arrowScale);
        const arrowLength = Math.round(12 * arrowScale);
        const disabledColor = config.disabledColor || '128, 128, 128';
        return [
            ':host {',
            `  --sn-focus-rgb: ${colorBase};`,
            `  --sn-disabled-rgb: ${disabledColor};`,
            `  --arrow-width: ${arrowWidth}px;`,
            `  --arrow-length: ${arrowLength}px;`,
            `  --sn-scrim-alpha: ${config.overlayScrimOpacity};`,
            `  --sn-glow-alpha: ${config.overlayGlowOpacity};`,
            `  --sn-glow-blur: ${config.overlayGlowBlur}px;`,
            '  --sn-inner-glow-alpha: 0.16;',
            '  --sn-label-bg: rgba(0, 0, 0, 0.62);',
            '  --sn-label-fg: rgba(255, 255, 255, 0.92);',
            '  --sn-label-muted: rgba(255, 255, 255, 0.72);',
            '}',
            `:host([${themeAttr}="high-contrast"]) {`,
            '  --sn-scrim-alpha: 0.14;',
            '  --sn-glow-alpha: 0.55;',
            '  --sn-glow-blur: 18px;',
            '  --sn-inner-glow-alpha: 0.22;',
            '  --sn-label-bg: rgba(0, 0, 0, 0.78);',
            '}',
            `#${focusOverlayId} {`,
            '  position: fixed;',
            '  pointer-events: none;',
            '  overflow: visible;',
            '  will-change: left, top, width, height, border-radius, opacity, transform;',
            '  transition: left 0.14s cubic-bezier(0.2, 0.0, 0.2, 1), top 0.14s cubic-bezier(0.2, 0.0, 0.2, 1), width 0.14s cubic-bezier(0.2, 0.0, 0.2, 1), height 0.14s cubic-bezier(0.2, 0.0, 0.2, 1), border-radius 0.14s cubic-bezier(0.2, 0.0, 0.2, 1), opacity 0.12s ease-out, transform 0.12s ease-out;',
            `  outline: ${config.outlineWidth}px solid rgb(var(--sn-focus-rgb));`,
            `  outline-offset: ${config.outlineOffset}px;`,
            `  background-color: rgba(var(--sn-focus-rgb), var(--sn-scrim-alpha));`,
            `  box-shadow: 0 0 var(--sn-glow-blur) rgba(var(--sn-focus-rgb), var(--sn-glow-alpha)), inset 0 0 0 1px rgba(var(--sn-focus-rgb), var(--sn-inner-glow-alpha));`,
            '  border-radius: 8px;',
            '  box-sizing: border-box;',
            `  z-index: ${overlayZIndex};`,
            '  opacity: 0;',
            '}',
            `#${overlayLabelId} {`,
            '  position: fixed;',
            '  pointer-events: none;',
            `  z-index: ${overlayZIndex + 2};`,
            '  padding: 4px 8px;',
            '  border-radius: 999px;',
            '  background: var(--sn-label-bg);',
            '  color: var(--sn-label-fg);',
            '  font: 12px/1.2 system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;',
            '  letter-spacing: 0.2px;',
            '  display: flex;',
            '  gap: 6px;',
            '  align-items: center;',
            '  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.28);',
            '  opacity: 0;',
            '  transform: translate3d(0, 0, 0);',
            '  transition: opacity 0.12s ease-out, transform 0.12s ease-out;',
            '}',
            `#${overlayLabelId}.visible {`,
            '  opacity: 1;',
            '}',
            `#${overlayLabelId} .sn-label-text {`,
            '  min-width: 0;',
            '  overflow: hidden;',
            '  text-overflow: ellipsis;',
            '  white-space: nowrap;',
            '}',
            `#${overlayLabelId} .sn-label-badge {`,
            '  padding: 1px 6px;',
            '  border-radius: 999px;',
            '  font: 10px/1.2 ui-monospace, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;',
            '  background: rgba(255, 255, 255, 0.14);',
            '  color: var(--sn-label-muted);',
            '  white-space: nowrap;',
            '}',
            `#${overlayLabelId} .sn-label-suppressed {`,
            '  background: rgba(255, 64, 64, 0.22);',
            '  color: rgba(255, 220, 220, 0.95);',
            '}',
            `#${debugHudId} {`,
            '  position: fixed;',
            '  pointer-events: none;',
            '  display: none;',
            `  z-index: ${overlayZIndex + 3};`,
            '  left: 8px;',
            '  top: 8px;',
            '  padding: 4px 8px;',
            '  border-radius: 999px;',
            '  background: rgba(0, 0, 0, 0.58);',
            '  color: rgba(255, 255, 255, 0.9);',
            '  font: 11px/1.2 ui-monospace, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;',
            '  letter-spacing: 0.2px;',
            '  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.22);',
            '}',
            `#${focusOverlayId}.visible {`,
            '  opacity: 1;',
            '}',
            `#${focusOverlayId}.click-animate {`,
            '  transform: scale(0.96) !important;',
            '  transition: transform 0.09s ease-out !important;',
            '}',
            '#focus-preview-layer {',
            '  position: fixed;',
            '  inset: 0;',
            '  pointer-events: none;',
            `  z-index: ${previewZIndex};`,
            '}',
            '.focus-preview {',
            '  position: fixed;',
            '  pointer-events: none;',
            `  border: 1px solid rgba(var(--sn-focus-rgb), 0.4);`,
            `  background-color: rgba(var(--sn-focus-rgb), 0.10);`,
            '  border-radius: 999px;',
            '  opacity: 0;',
            '  transform: translate3d(0, 0, 0);',
            '  transition: opacity 0.16s cubic-bezier(0.4, 0.0, 0.2, 1), transform 0.16s cubic-bezier(0.4, 0.0, 0.2, 1);',
            '}',
            '.focus-preview.show {',
            '  opacity: 0.92;',
            '}',
            '.focus-preview.disabled {',
            `  border: 2px solid rgba(var(--sn-disabled-rgb), 0.7);`,
            `  background-color: rgba(var(--sn-disabled-rgb), 0.2);`,
            '}',
            '.focus-preview.disabled.show {',
            '  opacity: 0.9;',
            '  animation: focusPreviewPulse 0.32s ease-out;',
            '}',
            '@keyframes focusPreviewPulse {',
            '  0% { opacity: 0; transform: translate3d(0, 0, 0) scale(0.85); }',
            '  55% { opacity: 0.9; }',
            '  100% { opacity: 0; transform: translate3d(0, 0, 0) scale(1.08); }',
            '}',
            '@keyframes focusPulse {',
            '  0% { box-shadow: 0 0 0 0 rgba(var(--focus-color, 255, 193, 7), 0.6); }',
            '  70% { box-shadow: 0 0 0 12px rgba(var(--focus-color, 255, 193, 7), 0); }',
            '  100% { box-shadow: 0 0 0 0 rgba(var(--focus-color, 255, 193, 7), 0); }',
            '}',
            `#${focusOverlayId}.pulse {`,
            '  animation: focusPulse 0.6s ease-out;',
            '}',
            '.focus-preview-arrow {',
            '  position: absolute;',
            '  width: 0;',
            '  height: 0;',
            '  opacity: 0;',
            '  transition: opacity 0.24s cubic-bezier(0.4, 0.0, 0.2, 1);',
            '}',
            '.focus-preview.show .focus-preview-arrow {',
            '  opacity: 1;',
            '}',
            '.focus-preview-right .focus-preview-arrow {',
            '  top: 50%;',
            '  left: 50%;',
            '  transform: translate(-50%, -50%);',
            `  border-top: var(--arrow-width) solid transparent;`,
            `  border-bottom: var(--arrow-width) solid transparent;`,
            `  border-left: var(--arrow-length) solid rgba(var(--sn-focus-rgb), 0.95);`,
            '}',
            '.focus-preview-left .focus-preview-arrow {',
            '  top: 50%;',
            '  left: 50%;',
            '  transform: translate(-50%, -50%);',
            `  border-top: var(--arrow-width) solid transparent;`,
            `  border-bottom: var(--arrow-width) solid transparent;`,
            `  border-right: var(--arrow-length) solid rgba(var(--sn-focus-rgb), 0.95);`,
            '}',
            '.focus-preview-down .focus-preview-arrow {',
            '  top: 50%;',
            '  left: 50%;',
            '  transform: translate(-50%, -50%);',
            `  border-left: var(--arrow-width) solid transparent;`,
            `  border-right: var(--arrow-width) solid transparent;`,
            `  border-top: var(--arrow-length) solid rgba(var(--sn-focus-rgb), 0.95);`,
            '}',
            '.focus-preview-up .focus-preview-arrow {',
            '  top: 50%;',
            '  left: 50%;',
            '  transform: translate(-50%, -50%);',
            `  border-left: var(--arrow-width) solid transparent;`,
            `  border-right: var(--arrow-width) solid transparent;`,
            `  border-bottom: var(--arrow-length) solid rgba(var(--sn-focus-rgb), 0.95);`,
            '}',
            '@media (prefers-reduced-motion: reduce) {',
            `  #${focusOverlayId},`,
            '  .focus-preview,',
            `  #${overlayLabelId},`,
            '  .focus-preview-arrow {',
            '    transition: none;',
            '  }',
            `  #${focusOverlayId}.pulse {`,
            '    animation: none;',
            '  }',
            '}'
        ].join('\n');
    }
    /**
     * Position and show the focus overlay on an element.
     * If element is null, hides the overlay.
     */
    function showOverlay(element, state, pulse = false) {
        if (!state.overlay || !element) {
            if (state.overlay) {
                state.overlay.classList.remove('visible');
            }
            const shadow = state.overlayHost?.shadowRoot;
            const label = shadow?.getElementById(overlayLabelId);
            if (label) {
                label.classList.remove('visible');
            }
            updateDebugHud(state);
            return;
        }
        // Get the visual bounds using our consolidated logic
        const rect = calculateVisualRect(element);
        const overlay = state.overlay;
        // Match element's border-radius
        const computed = window.getComputedStyle(element);
        const borderRadius = computed.borderRadius || '4px';
        const effectiveRadius = borderRadius !== '0px' ? borderRadius : '8px';
        const config = state.config;
        const outlineOffset = config.outlineOffset || 3;
        const outlineWidth = config.outlineWidth || 3;
        const safeAreaMargin = Math.max(0, config.safeAreaMargin ?? 0);
        const totalMargin = outlineWidth + outlineOffset + 2 + safeAreaMargin; // Extra safety buffer
        element ? (element.tagName.toLowerCase() + (element.id ? '#' + element.id : '')) : '(null)';
        // console.log(`[SpatialNav] Overlay positioned on ${elDesc}: L=${rect.left.toFixed(1)}, T=${rect.top.toFixed(1)}, W=${rect.width.toFixed(1)}, H=${rect.height.toFixed(1)}`);
        overlay.style.display = 'block';
        overlay.classList.add('visible');
        // Apply positions with viewport clamping to prevent outline from being cut at edges
        const left = Math.max(totalMargin, rect.left);
        const top = Math.max(totalMargin, rect.top);
        const right = Math.min(window.innerWidth - totalMargin, rect.right);
        const bottom = Math.min(window.innerHeight - totalMargin, rect.bottom);
        overlay.style.left = left + 'px';
        overlay.style.top = top + 'px';
        overlay.style.width = (right - left) + 'px';
        overlay.style.height = (bottom - top) + 'px';
        overlay.style.borderRadius = effectiveRadius;
        updateDebugHud(state);
        updateFocusLabel(state, element, { left, top, width: right - left});
        // Remove native focus outline
        try {
            element.style.setProperty('outline', 'none', 'important');
            element.style.setProperty('box-shadow', 'none', 'important');
        }
        catch {
            // ignore
        }
        if (pulse) {
            overlay.classList.remove('pulse');
            void overlay.offsetWidth;
            overlay.classList.add('pulse');
        }
        // ResizeObserver
        if (state.activeResizeObserver) {
            state.activeResizeObserver.disconnect();
            state.activeResizeObserver = null;
        }
        if (typeof ResizeObserver !== 'undefined') {
            const ro = new ResizeObserver(() => {
                const currentActive = state.lastFocusedElement;
                if (currentActive === element) {
                    // FIX: Use calculateVisualRect here too to maintain the logo/image expansion
                    const newRect = calculateVisualRect(element);
                    // Also apply clamping here for consistency
                    const outlineOffset = state.config.outlineOffset || 3;
                    const outlineWidth = state.config.outlineWidth || 3;
                    const safeAreaMargin = Math.max(0, state.config.safeAreaMargin ?? 0);
                    const totalMargin = outlineWidth + outlineOffset + 2 + safeAreaMargin;
                    const left = Math.max(totalMargin, newRect.left);
                    const top = Math.max(totalMargin, newRect.top);
                    const right = Math.min(window.innerWidth - totalMargin, newRect.right);
                    const bottom = Math.min(window.innerHeight - totalMargin, newRect.bottom);
                    overlay.style.left = left + 'px';
                    overlay.style.top = top + 'px';
                    overlay.style.width = (right - left) + 'px';
                    overlay.style.height = (bottom - top) + 'px';
                }
            });
            ro.observe(element);
            state.activeResizeObserver = ro;
        }
    }
    /**
     * Hide the focus overlay.
     */
    function hideOverlay(state) {
        if (state.overlay) {
            state.overlay.classList.remove('visible');
        }
        if (state.activeResizeObserver) {
            state.activeResizeObserver.disconnect();
            state.activeResizeObserver = null;
        }
        const shadow = state.overlayHost?.shadowRoot;
        const label = shadow?.getElementById(overlayLabelId);
        if (label) {
            label.classList.remove('visible');
        }
        updateDebugHud(state);
    }

    /**
     * Preview management for Spatial Navigation System
     *
     * Manages directional preview indicators showing where focus will move.
     * Includes disabled state animation for boundary conditions.
     */
    const previewDirectionKeys = ['up', 'down', 'left', 'right'];
    /**
     * Create or retrieve preview elements for all directions.
     *
     * @param state - Global state object
     * @returns Preview elements by direction
     */
    function ensurePreviewElements(state) {
        if (!state.previewLayer) {
            return null;
        }
        if (!state.previewElements) {
            const elements = {};
            previewDirectionKeys.forEach(function (direction) {
                const container = document.createElement('div');
                container.className = 'focus-preview focus-preview-' + direction;
                container.dataset.direction = direction;
                const arrow = document.createElement('div');
                arrow.className = 'focus-preview-arrow';
                container.appendChild(arrow);
                state.previewLayer.appendChild(container);
                elements[direction] = {
                    container: container,
                    arrow: arrow
                };
            });
            state.previewElements = elements;
        }
        return state.previewElements;
    }
    /**
     * Hide all preview elements.
     *
     * @param state - Global state object
     */
    function hidePreviewElements(state) {
        if (!state.previewElements) {
            return;
        }
        previewDirectionKeys.forEach(function (direction) {
            const entry = state.previewElements[direction];
            if (entry && entry.container) {
                entry.container.className = 'focus-preview focus-preview-' + direction;
                entry.container.style.left = '';
                entry.container.style.top = '';
                entry.container.style.width = '';
                entry.container.style.height = '';
                entry.container.removeAttribute('data-target');
                if (entry.arrow) {
                    entry.arrow.style.display = '';
                }
            }
        });
    }
    function clamp$1(value, min, max) {
        return Math.min(Math.max(value, min), max);
    }
    function showChevronPreview(entry, direction, currentRect, safeAreaMargin = 0) {
        if (!entry || !entry.container || !currentRect) {
            return;
        }
        const size = Math.max(14, Math.min(26, Math.round(Math.min(currentRect.width, currentRect.height) * 0.28)));
        const offset = Math.max(10, Math.round(size * 0.75));
        let left = currentRect.left;
        let top = currentRect.top;
        switch (direction) {
            case 'right':
                left = currentRect.right + offset;
                top = currentRect.top + currentRect.height / 2 - size / 2;
                break;
            case 'left':
                left = currentRect.left - offset - size;
                top = currentRect.top + currentRect.height / 2 - size / 2;
                break;
            case 'down':
                left = currentRect.left + currentRect.width / 2 - size / 2;
                top = currentRect.bottom + offset;
                break;
            case 'up':
                left = currentRect.left + currentRect.width / 2 - size / 2;
                top = currentRect.top - offset - size;
                break;
        }
        const viewportW = window?.innerWidth ?? 0;
        const viewportH = window?.innerHeight ?? 0;
        const safe = Math.max(0, safeAreaMargin || 0);
        left = clamp$1(left, safe, Math.max(safe, viewportW - safe - size));
        top = clamp$1(top, safe, Math.max(safe, viewportH - safe - size));
        entry.container.style.left = left + 'px';
        entry.container.style.top = top + 'px';
        entry.container.style.width = size + 'px';
        entry.container.style.height = size + 'px';
        entry.container.style.opacity = '';
        entry.container.className = 'focus-preview focus-preview-' + direction + ' show';
        if (entry.arrow) {
            entry.arrow.style.display = '';
        }
    }
    /**
     * Update preview targets for all directions.
     *
     * @param currentIndex - Index of current focused element
     * @param findDirectionalCandidate - Function to find candidate
     * @param directionByName - Direction objects by name
     * @param state - Global state object
     * @returns Targets by direction
     */
    function updatePreviewTargets(currentIndex, findDirectionalCandidate, directionByName, state) {
        const result = {};
        if (typeof currentIndex !== 'number' || currentIndex < 0 || !state.focusables.length) {
            previewDirectionKeys.forEach(function (direction) {
                result[direction] = null;
            });
            state.nextTargets = result;
            return result;
        }
        previewDirectionKeys.forEach(function (direction) {
            const dir = directionByName[direction];
            result[direction] = findDirectionalCandidate(currentIndex, dir, state);
        });
        state.nextTargets = result;
        return result;
    }
    /**
     * Update preview visuals based on current focus and available targets.
     *
     * @param currentElement - Currently focused element
     * @param currentRect - Current element rect
     * @param findDirectionalCandidate - Function to find candidates
     * @param directionByName - Direction objects by name
     * @param describeElement - Function to describe element for data attr
     * @param state - Global state object
     */
    function updatePreviewVisuals(currentElement, currentRect, findDirectionalCandidate, directionByName, describeElement, state) {
        const elements = ensurePreviewElements(state);
        if (!elements) {
            state.nextTargets = { up: null, down: null, left: null, right: null };
            return;
        }
        if (!state.previewEnabled || !currentElement) {
            hidePreviewElements(state);
            state.nextTargets = { up: null, down: null, left: null, right: null };
            return;
        }
        // Unused but kept for API compatibility or future use
        const _rect = currentElement.getBoundingClientRect();
        const targets = updatePreviewTargets(state.currentIndex, findDirectionalCandidate, directionByName, state);
        previewDirectionKeys.forEach(function (direction) {
            const entry = elements[direction];
            if (!entry || !entry.container) {
                return;
            }
            const candidate = targets[direction];
            if (!candidate || !candidate.data || !candidate.data.element) {
                if (entry.container.className.indexOf('disabled') === -1) {
                    entry.container.className = 'focus-preview focus-preview-' + direction;
                    entry.container.style.left = '';
                    entry.container.style.top = '';
                    entry.container.style.width = '';
                    entry.container.style.height = '';
                    entry.container.style.opacity = '';
                    entry.container.removeAttribute('data-target');
                }
                if (entry.arrow) {
                    entry.arrow.style.display = '';
                }
                return;
            }
            // Show directional chevrons around the current focus ring (TV-friendly, low clutter).
            showChevronPreview(entry, direction, _rect, state.config.safeAreaMargin ?? 0);
            entry.container.setAttribute('data-target', describeElement(candidate.data.element));
        });
    }

    /**
     * Focus Group logic for GeckoView Spatial Navigation System
     *
     * Manages navigation regions (Focus Groups) defined by data-focus-group attributes.
     *
     * Features:
     * - Flat focus groups: data-focus-group="sidebar"
     * - Nested hierarchies: data-focus-group="sidebar.menu" (child of sidebar)
     * - Boundary modes: exit, contain, wrap, stop
     * - Enter modes: default, first, last
     * - Last-focused memory for enter-mode="last"
     *
     * Hierarchy Example:
     *   <nav data-focus-group="sidebar">
     *     <div data-focus-group="sidebar.header">...</div>
     *     <ul data-focus-group="sidebar.menu;boundary=contain">
     *       <li data-focus-group="sidebar.menu.item1">...</li>
     *       <li data-focus-group="sidebar.menu.item2">...</li>
     *     </ul>
     *     <div data-focus-group="sidebar.footer">...</div>
     *   </nav>
     */
    /**
     * Path utilities for hierarchical group IDs.
     */
    const GroupPath = {
        /**
         * Get the parent path of a group ID.
         * e.g., "sidebar.menu.item1" -> "sidebar.menu"
         */
        parent(id) {
            const lastDot = id.lastIndexOf('.');
            return lastDot > 0 ? id.substring(0, lastDot) : null;
        },
        /**
         * Get the depth of a group ID.
         * e.g., "sidebar" -> 1, "sidebar.menu" -> 2, "sidebar.menu.item1" -> 3
         */
        depth(id) {
            return id.split('.').length;
        },
        /**
         * Check if `childId` is a descendant of `parentId`.
         * e.g., isDescendant("sidebar.menu.item1", "sidebar") -> true
         */
        isDescendant(childId, parentId) {
            return childId.startsWith(parentId + '.');
        },
        /**
         * Check if two IDs are siblings (same parent).
         */
        areSiblings(id1, id2) {
            const parent1 = GroupPath.parent(id1);
            const parent2 = GroupPath.parent(id2);
            return parent1 === parent2;
        },
        /**
         * Get all ancestor IDs for a group.
         * e.g., "sidebar.menu.item1" -> ["sidebar.menu", "sidebar"]
         */
        ancestors(id) {
            const result = [];
            let current = GroupPath.parent(id);
            while (current) {
                result.push(current);
                current = GroupPath.parent(current);
            }
            return result;
        },
        /**
         * Get the root ID (first segment).
         * e.g., "sidebar.menu.item1" -> "sidebar"
         */
        root(id) {
            const firstDot = id.indexOf('.');
            return firstDot > 0 ? id.substring(0, firstDot) : id;
        },
        /**
         * Get the leaf name (last segment).
         * e.g., "sidebar.menu.item1" -> "item1"
         */
        leaf(id) {
            const lastDot = id.lastIndexOf('.');
            return lastDot > 0 ? id.substring(lastDot + 1) : id;
        }
    };
    /**
     * Represents a logical group of focusable elements.
     * Supports hierarchical nesting via dot-notation IDs.
     */
    class FocusGroup {
        constructor(id, element, options = {}) {
            /** Parent group (if nested) */
            this.parent = null;
            /** Child groups */
            this.children = new Map();
            this.id = id;
            this.element = element;
            this.members = [];
            this.options = {
                boundary: options.boundary || 'exit',
                rememberLast: options.rememberLast !== false,
                enterMode: options.enterMode || 'default',
                priority: options.priority ?? 0,
                inheritOptions: options.inheritOptions !== false,
                ...options
            };
            this.lastFocused = null;
            this._depth = GroupPath.depth(id);
        }
        /**
         * Get the depth of this group in the hierarchy.
         */
        get depth() {
            return this._depth;
        }
        /**
         * Get the parent group ID (or null if root).
         */
        get parentId() {
            return GroupPath.parent(this.id);
        }
        /**
         * Check if this is a root-level group.
         */
        get isRoot() {
            return this._depth === 1;
        }
        /**
         * Get effective options, inheriting from parent if enabled.
         */
        getEffectiveOptions() {
            if (!this.options.inheritOptions || !this.parent) {
                return this.options;
            }
            const parentOptions = this.parent.getEffectiveOptions();
            return {
                ...parentOptions,
                ...this.options,
                // Don't inherit ID-specific options
                priority: this.options.priority
            };
        }
        /**
         * Set the parent group reference.
         */
        setParent(parent) {
            this.parent = parent;
            parent.children.set(this.id, this);
        }
        /**
         * Remove this group from its parent.
         */
        removeFromParent() {
            if (this.parent) {
                this.parent.children.delete(this.id);
                this.parent = null;
            }
        }
        addMember(entry) {
            if (!this.members.includes(entry)) {
                this.members.push(entry);
                entry.groupId = this.id;
            }
        }
        removeMember(entry) {
            const index = this.members.indexOf(entry);
            if (index > -1) {
                this.members.splice(index, 1);
            }
            if (entry.groupId === this.id) {
                entry.groupId = null;
            }
        }
        updateLastFocused(entry) {
            if (this.members.includes(entry)) {
                this.lastFocused = entry;
                // Also update ancestors' lastFocused if they don't have their own
                let ancestor = this.parent;
                while (ancestor) {
                    if (!ancestor.lastFocused || !document.body.contains(ancestor.lastFocused.element)) {
                        // Find the member in ancestor that contains this entry
                        const memberInAncestor = ancestor.members.find(m => m.element.contains(entry.element) || m.element === entry.element);
                        if (memberInAncestor) {
                            ancestor.lastFocused = memberInAncestor;
                        }
                    }
                    ancestor = ancestor.parent;
                }
            }
        }
        getPreferredEntry() {
            const effectiveOptions = this.getEffectiveOptions();
            if (effectiveOptions.enterMode === 'last' && this.lastFocused && document.body.contains(this.lastFocused.element)) {
                return this.lastFocused;
            }
            if (effectiveOptions.enterMode === 'first' || effectiveOptions.enterMode === 'default') {
                return this.members[0];
            }
            return this.members[0];
        }
        /**
         * Get all descendant groups (recursive).
         */
        getAllDescendants() {
            const result = [];
            for (const child of this.children.values()) {
                result.push(child);
                result.push(...child.getAllDescendants());
            }
            return result;
        }
        /**
         * Get all member elements including those in descendant groups.
         */
        getAllMembers() {
            const result = [...this.members];
            for (const child of this.children.values()) {
                result.push(...child.getAllMembers());
            }
            return result;
        }
        /**
         * Find a child group by relative path.
         * e.g., for group "sidebar", findChild("menu.item1") returns "sidebar.menu.item1"
         */
        findChild(relativePath) {
            const fullId = this.id + '.' + relativePath;
            return this.children.get(fullId) ?? null;
        }
        /**
         * Check if navigation can exit this group in a given direction.
         */
        canExit() {
            const effectiveOptions = this.getEffectiveOptions();
            return effectiveOptions.boundary === 'exit' || effectiveOptions.boundary === 'wrap';
        }
        /**
         * Check if navigation should wrap within this group.
         */
        shouldWrap() {
            const effectiveOptions = this.getEffectiveOptions();
            return effectiveOptions.boundary === 'wrap';
        }
    }
    /**
     * Parse focus group options from data-focus-group attribute.
     * Format: "id;options" or just "id"
     * Options: boundary=contain,remember=true
     */
    function parseFocusGroupAttribute(attrValue) {
        if (!attrValue)
            return null;
        const parts = attrValue.split(';');
        const id = parts[0].trim();
        const options = {};
        if (parts.length > 1) {
            parts.slice(1).forEach(part => {
                const [key, value] = part.split('=').map(s => s.trim());
                if (key && value) {
                    if (value === 'true')
                        options[key] = true;
                    else if (value === 'false')
                        options[key] = false;
                    else
                        options[key] = value;
                }
            });
        }
        // Map attribute keys to internal options
        const mappedOptions = {};
        if (options.boundary)
            mappedOptions.boundary = options.boundary;
        if (options.remember !== undefined)
            mappedOptions.rememberLast = options.remember;
        if (options.enter)
            mappedOptions.enterMode = options.enter;
        return { id, options: mappedOptions };
    }
    /**
     * Find the nearest focus group container for an element.
     */
    function findFocusGroupContainer(element) {
        let current = element;
        while (current && current !== document.body) {
            if (current.hasAttribute('data-focus-group')) {
                return current;
            }
            current = current.parentElement;
        }
        return null;
    }

    /**
     * IntersectionObserver helpers for Spatial Navigation.
     *
     * Keeps geometry in sync for lazily-loaded elements that enter the viewport.
     */
    function supportsIntersectionObserver() {
        return typeof window !== 'undefined' && typeof window.IntersectionObserver !== 'undefined';
    }
    function createObserver(state) {
        if (!supportsIntersectionObserver()) {
            console.warn('[SpatialNav] IntersectionObserver unsupported in this environment');
            return null;
        }
        const config = state.config; // Assuming proper config
        const options = {
            root: null,
            rootMargin: config.intersectionRootMargin || '200px',
            threshold: config.intersectionThreshold || 0
        };
        const observer = new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
                const element = entry.target;
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
    function syncIntersectionObserver(state) {
        const config = state.config;
        if (!config.observeIntersection || !supportsIntersectionObserver()) {
            detachIntersectionObserver(state);
            return;
        }
        if (!state.intersectionObserver) {
            state.intersectionObserver = createObserver(state);
        }
        else {
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
                }
                catch (err) {
                    // Ignore observation failures (detached nodes, etc.)
                }
            });
        }
    }
    function observeNewElement(state, element) {
        if (!state || !element || !state.intersectionObserver) {
            return;
        }
        try {
            state.intersectionObserver.observe(element);
        }
        catch (err) {
            // ignore
        }
    }
    function unobserveElement(state, element) {
        if (!state || !element || !state.intersectionObserver) {
            return;
        }
        try {
            state.intersectionObserver.unobserve(element);
        }
        catch (err) {
            // ignore
        }
    }
    function detachIntersectionObserver(state) {
        if (state && state.intersectionObserver) {
            state.intersectionObserver.disconnect();
            state.intersectionObserver = null;
        }
    }

    /**
     * DOM utilities for Spatial Navigation System
     *
     * Handles element discovery, focus management, and element description.
     * Features Shadow DOM traversal, virtual scroll detection, and accessibility announcer.
     */
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
    function findFocusablesDeep(root, config, visited = new Set(), seen = new Set()) {
        const results = [];
        // Prevent infinite loops with circular shadow DOM references
        if (visited.has(root)) {
            return results;
        }
        if (root.nodeType === 11) { // ShadowRoot
            visited.add(root);
        }
        // Light DOM focusables
        try {
            const lightFocusables = root.querySelectorAll(focusableSelector);
            for (const el of lightFocusables) {
                if (!seen.has(el)) {
                    seen.add(el);
                    results.push(el);
                }
            }
        }
        catch {
            // querySelectorAll may fail on some shadow roots
        }
        // Only traverse Shadow DOM if enabled (expensive operation)
        if (!config || !config.traverseShadowDom) {
            return results;
        }
        // Traverse into shadow roots
        try {
            const allElements = root.querySelectorAll('*');
            for (const element of allElements) {
                const host = element;
                if (host.shadowRoot && !visited.has(host.shadowRoot)) {
                    const shadowFocusables = findFocusablesDeep(host.shadowRoot, config, visited, seen);
                    results.push(...shadowFocusables);
                }
            }
        }
        catch (e) {
            console.warn('[SpatialNav] Shadow DOM traversal error:', e);
        }
        // Flatten slot assignments (distributed content)
        try {
            const slots = root.querySelectorAll('slot');
            for (const slot of slots) {
                const assigned = slot.assignedElements({ flatten: true });
                for (const el of assigned) {
                    // O(1) duplicate check with Set
                    if (!seen.has(el) && el.matches && el.matches(focusableSelector)) {
                        seen.add(el);
                        results.push(el);
                    }
                    // Also check shadow roots of assigned elements
                    if (el.shadowRoot && config.traverseShadowDom && !visited.has(el.shadowRoot)) {
                        const nestedFocusables = findFocusablesDeep(el.shadowRoot, config, visited, seen);
                        results.push(...nestedFocusables);
                    }
                }
            }
        }
        catch {
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
    function detectVirtualContainers(config) {
        if (!config || !config.observeVirtualContainers) {
            return [];
        }
        const selectors = config.virtualContainerSelectors || [];
        const containers = [];
        for (const selector of selectors) {
            try {
                const found = document.querySelectorAll(selector);
                for (const el of Array.from(found)) {
                    if (!containers.includes(el)) {
                        containers.push(el);
                    }
                }
            }
            catch {
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
    function attachVirtualScrollSentinels(state) {
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
        let debounceTimer = null;
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
                    state.dirty = true; // Invalidate precomputed cache
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
            }
            else if (children.length > 0) {
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
    function setupAccessibilityAnnouncer(state) {
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
    function announce(message, state, priority = 'polite') {
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
    function getAccessibleDescription(el, config) {
        if (!el || !el.tagName) {
            return '';
        }
        const parts = [];
        // Get accessible name (aria-label > aria-labelledby > innerText > title)
        const ariaLabel = el.getAttribute('aria-label');
        const ariaLabelledBy = el.getAttribute('aria-labelledby');
        const title = el.getAttribute('title');
        if (ariaLabel) {
            parts.push(ariaLabel);
        }
        else if (ariaLabelledBy) {
            const labelEl = document.getElementById(ariaLabelledBy);
            if (labelEl) {
                parts.push(labelEl.textContent?.trim() || '');
            }
        }
        else {
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
        const roleNames = {
            'a': 'link',
            'button': 'button',
            'input': el.type || 'text field',
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
    function getActiveElement() {
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
    function describeElement(el) {
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
    function refreshFocusables(state) {
        const startTime = performance.now(); // TODO 4: Performance monitoring
        const config = state.config;
        // Use Shadow DOM traversal if enabled, otherwise standard querySelectorAll
        let nodes;
        if (config.traverseShadowDom) {
            nodes = findFocusablesDeep(document, config);
            // console.log('[SpatialNav] Shadow DOM traversal found', nodes.length, 'focusables');
        }
        else {
            nodes = Array.from(document.querySelectorAll(focusableSelector));
        }
        if (window.flutterSpatialNavDebug) {
            console.log(`[SpatialNav] Candidate nodes found: ${nodes.length}`);
        }
        // Add iframes if iframe support is enabled
        if (config.iframeSupport && config.iframeSupport.enabled) {
            try {
                const iframeNodes = Array.from(document.querySelectorAll(config.iframeSupport.selector || 'iframe'));
                iframeNodes.forEach((iframe) => {
                    if (!nodes.includes(iframe)) {
                        nodes.push(iframe);
                    }
                });
            }
            catch (err) {
                console.warn('[SpatialNav] iframe selector failed:', err);
            }
        }
        const results = [];
        // Reset groups for fresh discovery
        // We keep the objects if possible to preserve state (lastFocused), but for now simpler to rebuild
        // TODO: Optimize to preserve group state across refreshes
        const oldGroups = state.focusGroups || {};
        state.focusGroups = {};
        for (let i = 0; i < nodes.length; i++) {
            const el = nodes[i];
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            if (!el || typeof el.getBoundingClientRect !== 'function') {
                continue;
            }
            const style = window.getComputedStyle(el);
            if (!style || style.visibility === 'hidden' || style.display === 'none' || el.disabled) {
                /*
                if ((window as any).flutterSpatialNavDebug) {
                    console.log(`[SpatialNav] Skipping hidden/disabled element: ${describeElement(el as HTMLElement)} (vis=${style?.visibility}, display=${style?.display}, disabled=${(el as any).disabled})`);
                }
                */
                continue;
            }
            const entry = {
                element: el,
                index: i // Temporary index, will be fixed in results array
            };
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
            if (window.flutterSpatialNavDebug && results.length < 50) ;
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
            if (!isRectVisible(entry.rect, 0)) ;
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
        state.focusableElements = results.map(item => item.element);
        state.focusableCount = results.length;
        state.currentIndex = state.focusableElements.indexOf(document.activeElement);
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
    function simulatePointerEvents(oldEl, newEl) {
        if (oldEl) {
            try {
                oldEl.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, cancelable: true, view: window }));
                oldEl.dispatchEvent(new MouseEvent('mouseleave', { bubbles: false, cancelable: false, view: window }));
            }
            catch { /* ignore */ }
        }
        if (newEl) {
            try {
                newEl.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true, view: window }));
                newEl.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false, cancelable: false, view: window }));
                // Some sites might need mousemove to trigger tooltips
                newEl.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, view: window }));
            }
            catch { /* ignore */ }
        }
    }
    /**
     * Insert a new focusable entry into the state.
     * LLM 2: Incremental diffing for attribute mutations.
     *
     * @param el - Element to insert
     * @param state - Global state object
     */
    function insertEntry(el, state) {
        if (!el || typeof el.getBoundingClientRect !== 'function') {
            return;
        }
        const style = window.getComputedStyle(el);
        if (!style || style.visibility === 'hidden' || style.display === 'none' || el.disabled) {
            return;
        }
        const entry = { element: el };
        updateEntryGeometry(entry, state);
        if (!entry.rect || entry.width <= 1 || entry.height <= 1) {
            return;
        }
        // Handle focus groups
        const groupContainer = findFocusGroupContainer(el);
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
        state.focusableElements.push(el);
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
    function removeEntry(idx, state) {
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
        }
        else if (state.currentIndex > idx) {
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
    function refreshAttributes(state, mutationList) {
        for (const mutation of mutationList) {
            if (mutation.type === 'attributes') {
                const el = mutation.target;
                const idx = state.focusableElements.indexOf(el);
                // FIX (MEDIUM): Check both selector AND visibility/disabled state
                const matchesSelector = el.matches && el.matches(focusableSelector);
                let isFocusableNow = false;
                if (matchesSelector) {
                    // Reuse same visibility/disabled logic from full scan
                    const style = window.getComputedStyle(el);
                    const isVisible = style && style.visibility !== 'hidden' && style.display !== 'none';
                    const isEnabled = !el.disabled;
                    const notAriaHidden = el.getAttribute('aria-hidden') !== 'true';
                    isFocusableNow = isVisible && isEnabled && notAriaHidden;
                }
                if (idx === -1 && isFocusableNow) {
                    // Element became focusable
                    insertEntry(el, state);
                }
                else if (idx !== -1 && !isFocusableNow) {
                    // Element no longer focusable (hidden, disabled, or removed from DOM)
                    removeEntry(idx, state);
                }
                else if (idx !== -1) {
                    // Element still focusable, update geometry
                    const entry = state.focusables[idx];
                    updateEntryGeometry(entry, state);
                }
            }
        }
        // console.log('[SpatialNav] Incremental refresh complete:', state.focusables.length, 'focusables');
    }

    /**
     * CSS Custom Property Integration for Spatial Navigation
     *
     * Reads WICG-defined CSS custom properties at runtime:
     * - --spatial-navigation-contain: auto | contain
     * - --spatial-navigation-action: auto | focus | scroll
     * - --spatial-navigation-function: normal | grid
     *
     * Also detects CSS Scroll Snap containers for enhanced grid navigation:
     * - scroll-snap-type: x | y | block | inline | both (mandatory | proximity)
     * - scroll-snap-align: start | end | center
     *
     * @see https://drafts.csswg.org/css-nav-1/#css-properties
     * @see https://drafts.csswg.org/css-scroll-snap-1/
     */
    /**
     * Get all CSS navigation properties for an element.
     */
    function getCSSNavProperties(element) {
        const config = getConfig();
        // Return defaults if CSS properties disabled
        if (!config.useCSSProperties) {
            return {
                contain: 'auto',
                action: 'auto',
                function: 'normal'
            };
        }
        try {
            const style = getComputedStyle(element);
            const containValue = style.getPropertyValue('--spatial-navigation-contain').trim();
            const actionValue = style.getPropertyValue('--spatial-navigation-action').trim();
            const functionValue = style.getPropertyValue('--spatial-navigation-function').trim();
            return {
                contain: containValue === 'contain' ? 'contain' : 'auto',
                action: (actionValue === 'focus' || actionValue === 'scroll') ? actionValue : 'auto',
                function: functionValue === 'grid' ? 'grid' : 'normal'
            };
        }
        catch {
            return {
                contain: 'auto',
                action: 'auto',
                function: 'normal'
            };
        }
    }
    /**
     * Get the navigation contain value for an element.
     * If 'contain', navigation should not exit this element's subtree.
     */
    function getCSSNavContain(element) {
        return getCSSNavProperties(element).contain;
    }
    /**
     * Get the navigation function for an element.
     * - 'grid': use grid-aligned navigation
     * - 'normal': use standard geometric navigation
     */
    function getCSSNavFunction(element) {
        return getCSSNavProperties(element).function;
    }
    /**
     * Find the nearest navigation container for an element.
     * A container is an element with --spatial-navigation-contain: contain.
     */
    function findNavigationContainer(element) {
        const config = getConfig();
        // Skip if CSS properties disabled
        if (!config.useCSSProperties) {
            return null;
        }
        let current = element.parentElement;
        while (current && current !== document.documentElement) {
            if (getCSSNavContain(current) === 'contain') {
                return current;
            }
            current = current.parentElement;
        }
        return null;
    }
    /**
     * Get effective scoring mode for an element.
     * Combines config setting with CSS --spatial-navigation-function.
     */
    function getEffectiveScoringMode(element) {
        const config = getConfig();
        // Config override takes precedence
        if (config.scoringMode === 'grid') {
            return 'grid';
        }
        // Check CSS property if enabled
        if (config.useCSSProperties) {
            const cssFunction = getCSSNavFunction(element);
            if (cssFunction === 'grid') {
                return 'grid';
            }
        }
        return 'geometric';
    }
    /**
     * Check if an element or its ancestors have containment.
     */
    function hasNavigationContainment(element) {
        const container = findNavigationContainer(element);
        return {
            contained: container !== null,
            container
        };
    }

    /**
     * Scoring algorithm for GeckoView Spatial Navigation System
     *
     * Implements geometric and grid-based scoring for directional candidate selection.
     * Uses multi-pass selection with progressively relaxed constraints.
     *
     * Features:
     * - Grid mode for aligned layouts (BBC LRUD-inspired)
     * - Multiple distance functions (euclidean, manhattan, projected)
     * - Configurable overlap threshold
     * - CSS custom property integration
     */
    /**
     * Calculate distance between two points using specified function.
     */
    function calculateDistance(dx, dy, method, direction) {
        switch (method) {
            case 'manhattan':
                return Math.abs(dx) + Math.abs(dy);
            case 'projected':
                // Project distance along navigation axis (WICG-style)
                if (direction) {
                    const primary = direction.axis === 'x' ? Math.abs(dx) : Math.abs(dy);
                    const secondary = direction.axis === 'x' ? Math.abs(dy) : Math.abs(dx);
                    // Weight primary axis 2x to prefer aligned elements
                    return primary + secondary * 0.5;
                }
                return Math.sqrt(dx * dx + dy * dy);
            case 'euclidean':
            default:
                return Math.sqrt(dx * dx + dy * dy);
        }
    }
    /**
     * Check if two elements are in the same grid row/column.
     * Used for grid mode navigation.
     */
    function isGridAligned(current, candidate, direction, tolerance) {
        if (direction.axis === 'x') {
            // Horizontal navigation: check if on same row (vertical alignment)
            const currentMidY = (current.top + current.bottom) / 2;
            const candidateMidY = (candidate.top + candidate.bottom) / 2;
            return Math.abs(currentMidY - candidateMidY) <= tolerance;
        }
        else {
            // Vertical navigation: check if on same column (horizontal alignment)
            const currentMidX = (current.left + current.right) / 2;
            const candidateMidX = (candidate.left + candidate.right) / 2;
            return Math.abs(currentMidX - candidateMidX) <= tolerance;
        }
    }
    /**
     * Compute directional metrics for a candidate element.
     */
    function computeDirectionalMetrics(current, candidate, direction, options) {
        const config = getConfig();
        const axis = direction.axis;
        const sign = direction.sign;
        const strictEdges = options.strictEdges !== false;
        const allowOverlap = options.allowOverlap === true;
        const overlapThreshold = options.overlapThreshold ?? config.overlapThreshold ?? 0;
        const distanceFunction = options.distanceFunction ?? config.distanceFunction ?? 'euclidean';
        const EPSILON = 1;
        const EDGE_EPS = 4 + overlapThreshold;
        describeElement(candidate.element);
        // Strict edge checking (pass 1)
        if (strictEdges) {
            if (axis === 'x') {
                if (sign > 0 && candidate.left < current.right - EDGE_EPS) {
                    // if ((window as any).flutterSpatialNavDebug) console.log(`[SpatialNav] Reject ${candDesc}: strictEdge right (cand.left ${candidate.left.toFixed(1)} < curr.right ${current.right.toFixed(1)})`);
                    return null;
                }
                if (sign < 0 && candidate.right > current.left + EDGE_EPS) {
                    // if ((window as any).flutterSpatialNavDebug) console.log(`[SpatialNav] Reject ${candDesc}: strictEdge left (cand.right ${candidate.right.toFixed(1)} > curr.left ${current.left.toFixed(1)})`);
                    return null;
                }
            }
            else {
                if (sign > 0 && candidate.top < current.bottom - EDGE_EPS) {
                    // if ((window as any).flutterSpatialNavDebug) console.log(`[SpatialNav] Reject ${candDesc}: strictEdge down (cand.top ${candidate.top.toFixed(1)} < curr.bottom ${current.bottom.toFixed(1)})`);
                    return null;
                }
                if (sign < 0 && candidate.bottom > current.top + EDGE_EPS) {
                    // if ((window as any).flutterSpatialNavDebug) console.log(`[SpatialNav] Reject ${candDesc}: strictEdge up (cand.bottom ${candidate.bottom.toFixed(1)} > curr.top ${current.top.toFixed(1)})`);
                    return null;
                }
            }
        }
        const deltaX = candidate.centerX - current.centerX;
        const deltaY = candidate.centerY - current.centerY;
        const forwardThreshold = allowOverlap ? -(12 + overlapThreshold) : EPSILON;
        // Forward movement check
        if (axis === 'x') {
            if (sign > 0 && deltaX <= forwardThreshold) {
                // if ((window as any).flutterSpatialNavDebug) console.log(`[SpatialNav] Reject ${candDesc}: notForward right (deltaX ${deltaX.toFixed(1)} <= ${forwardThreshold.toFixed(1)})`);
                return null;
            }
            if (sign < 0 && deltaX >= -forwardThreshold) {
                // if ((window as any).flutterSpatialNavDebug) console.log(`[SpatialNav] Reject ${candDesc}: notForward left (deltaX ${deltaX.toFixed(1)} >= ${(-forwardThreshold).toFixed(1)})`);
                return null;
            }
        }
        else {
            if (sign > 0 && deltaY <= forwardThreshold) {
                // if ((window as any).flutterSpatialNavDebug) console.log(`[SpatialNav] Reject ${candDesc}: notForward down (deltaY ${deltaY.toFixed(1)} <= ${forwardThreshold.toFixed(1)})`);
                return null;
            }
            if (sign < 0 && deltaY >= -forwardThreshold) {
                // if ((window as any).flutterSpatialNavDebug) console.log(`[SpatialNav] Reject ${candDesc}: notForward up (deltaY ${deltaY.toFixed(1)} >= ${(-forwardThreshold).toFixed(1)})`);
                return null;
            }
        }
        // Calculate alignment and distance
        const primary = Math.abs(axis === 'x' ? deltaX : deltaY);
        const secondary = Math.abs(axis === 'x' ? deltaY : deltaX);
        const distance = calculateDistance(deltaX, deltaY, distanceFunction, direction);
        // Cone check: reject candidates that are too far off-axis
        if (secondary > Math.max(4, primary * 3)) {
            // if ((window as any).flutterSpatialNavDebug) console.log(`[SpatialNav] Reject ${candidate.element?.id || candidate.element?.tagName}: offAxisCone (primary ${primary.toFixed(1)}, secondary ${secondary.toFixed(1)})`);
            return null;
        }
        // Alignment score: higher is better (more aligned)
        const alignment = secondary === 0 ? 10 : Math.max(0, 10 - secondary / 50);
        // Grid alignment check
        const gridAligned = isGridAligned(current, candidate, direction, config.gridAlignmentTolerance);
        return {
            primary,
            secondary,
            distance,
            alignment,
            deltaX,
            deltaY,
            gridAligned,
        };
    }
    /**
     * Choose the best candidate from all focusables for a given direction.
     * Supports both geometric and grid scoring modes.
     * Respects CSS --spatial-navigation-* properties when enabled.
     */
    function chooseBestCandidate(currentIndex, direction, options, state) {
        const config = getConfig();
        const currentEntry = state.focusables[currentIndex];
        if (!currentEntry || !currentEntry.element) {
            return null;
        }
        updateEntryGeometry(currentEntry, state);
        // Extract options with defaults
        const strictEdges = options.strictEdges !== false;
        const allowOverlap = options.allowOverlap === true;
        const requireViewport = options.requireViewport !== false;
        const viewportMargin = options.viewportMargin ?? 0;
        const alignmentWeight = options.alignmentWeight ?? 10;
        const distanceWeight = options.distanceWeight ?? 1;
        const preferScrollGroup = options.preferScrollGroup !== false;
        // Get effective scoring mode (combines config + CSS property)
        const effectiveScoringMode = config.useCSSProperties && currentEntry.element
            ? getEffectiveScoringMode(currentEntry.element)
            : (options.scoringMode ?? config.scoringMode ?? 'geometric');
        const gridBonus = effectiveScoringMode === 'grid' ? 500 : 0;
        // Check for CSS navigation containment
        const containmentInfo = config.useCSSProperties && currentEntry.element
            ? hasNavigationContainment(currentEntry.element)
            : { contained: false, container: null };
        const candidates = [];
        // Evaluate all focusables as candidates
        for (let i = 0; i < state.focusables.length; i++) {
            if (i === currentIndex) {
                continue;
            }
            const candidateEntry = state.focusables[i];
            if (!candidateEntry || !candidateEntry.element) {
                continue;
            }
            updateEntryGeometry(candidateEntry, state);
            // Skip tiny or invalid rects
            const minSize = config.minElementSize || 1;
            if (!candidateEntry.rect || candidateEntry.width < minSize || candidateEntry.height < minSize) {
                continue;
            }
            // Viewport visibility check
            if (requireViewport && !isRectVisible(candidateEntry.rect, viewportMargin)) {
                continue;
            }
            // CSS containment check: if current is contained, only allow candidates within same container
            if (containmentInfo.contained && containmentInfo.container && candidateEntry.element) {
                if (!containmentInfo.container.contains(candidateEntry.element)) {
                    continue; // Skip candidates outside the navigation container
                }
            }
            // Compute directional metrics with full options
            const metrics = computeDirectionalMetrics(currentEntry, candidateEntry, direction, {
                strictEdges,
                allowOverlap,
                overlapThreshold: options.overlapThreshold,
                distanceFunction: options.distanceFunction,
            });
            if (!metrics) {
                // Log rejection reason only in debug mode or for specific IDs
                /*
                if ((window as any).flutterSpatialNavDebug) {
                    console.log(`[SpatialNav] Candidate '${candidateEntry.element?.id || candidateEntry.element?.tagName}' rejected by metrics in direction ${direction.name}`);
                }
                */
                continue;
            }
            // Calculate score: lower is better
            let score = metrics.primary * 1000 +
                metrics.secondary * alignmentWeight +
                metrics.distance * distanceWeight;
            // Grid mode bonus for aligned elements
            if (gridBonus && metrics.gridAligned) {
                score -= gridBonus;
            }
            // Focus Group Logic
            const currentGroupId = currentEntry.groupId;
            const candidateGroupId = candidateEntry.groupId;
            if (currentGroupId) {
                const currentGroup = state.focusGroups[currentGroupId];
                const isSameGroup = currentGroupId === candidateGroupId;
                // Boundary: contain - prevent leaving group
                if (currentGroup && currentGroup.options.boundary === 'contain' && !isSameGroup) {
                    continue;
                }
                // Priority: prefer staying in group
                if (isSameGroup) {
                    score -= 2000;
                }
            }
            // Group Entry Logic
            if (candidateGroupId && candidateGroupId !== currentGroupId) {
                const candidateGroup = state.focusGroups[candidateGroupId];
                // If entering a group with 'last' mode, only allow entry via lastFocused
                if (candidateGroup && candidateGroup.options.enterMode === 'last' && candidateGroup.lastFocused) {
                    if (candidateEntry.element !== candidateGroup.lastFocused.element) {
                        continue;
                    }
                    score -= 1000;
                }
            }
            // Prefer elements in same scroll container
            if (preferScrollGroup) {
                if (candidateEntry.scrollKey && candidateEntry.scrollKey === currentEntry.scrollKey) {
                    score -= 150;
                }
                else {
                    score += 75;
                }
            }
            // Penalty for off-screen elements
            if (!isRectVisible(candidateEntry.rect, 0)) {
                score += 120;
            }
            candidates.push({
                index: i,
                data: candidateEntry,
                rect: candidateEntry.rect,
                score,
                metrics,
            });
        }
        if (!candidates.length) {
            return null;
        }
        // Sort by score (lower is better), then by distance
        candidates.sort((a, b) => {
            // Grid mode: grid-aligned elements first
            if (effectiveScoringMode === 'grid') {
                if (a.metrics.gridAligned !== b.metrics.gridAligned) {
                    return a.metrics.gridAligned ? -1 : 1;
                }
            }
            if (a.score !== b.score) {
                return a.score - b.score;
            }
            return a.metrics.distance - b.metrics.distance;
        });
        return candidates[0];
    }
    /**
     * Find directional candidate using multi-pass selection.
     * Uses progressively relaxed constraints across 3 passes.
     * If wrapNavigation is enabled and no candidate found, wraps to opposite edge.
     */
    function findDirectionalCandidate(currentIndex, direction, state) {
        if (!direction) {
            return null;
        }
        state.focusables[currentIndex];
        // Three-pass selection with progressively relaxed constraints
        const passes = [
            // Pass 1: Strict - same viewport, strict edges
            {
                strictEdges: true,
                allowOverlap: false,
                requireViewport: true,
                viewportMargin: 0,
                alignmentWeight: 10,
                distanceWeight: 1,
                preferScrollGroup: true,
            },
            // Pass 2: Relaxed - wider viewport, allow overlap
            {
                strictEdges: false,
                allowOverlap: true,
                requireViewport: true,
                viewportMargin: 160,
                alignmentWeight: 8,
                distanceWeight: 0.9,
                preferScrollGroup: true,
            },
            // Pass 3: Permissive - any element, no viewport requirement
            {
                strictEdges: false,
                allowOverlap: true,
                requireViewport: false,
                viewportMargin: 0,
                alignmentWeight: 6,
                distanceWeight: 0.7,
                preferScrollGroup: false,
            },
        ];
        for (let i = 0; i < passes.length; i++) {
            const candidate = chooseBestCandidate(currentIndex, direction, passes[i], state);
            if (candidate) {
                candidate.passIndex = i;
                return candidate;
            }
        }
        const config = getConfig();
        if (config.wrapNavigation) {
            return findWrapCandidate(currentIndex, direction, state);
        }
        return null;
    }
    /**
     * Find wrap navigation candidate - returns element at opposite edge.
     * Used when wrapNavigation is enabled and normal navigation hits a boundary.
     */
    function findWrapCandidate(currentIndex, direction, state) {
        const currentEntry = state.focusables[currentIndex];
        if (!currentEntry || !currentEntry.element) {
            return null;
        }
        // For wrap, we want the element at the opposite edge
        // - down: wrap to topmost element
        // - up: wrap to bottommost element
        // - right: wrap to leftmost element
        // - left: wrap to rightmost element
        updateEntryGeometry(currentEntry, state);
        const config = getConfig();
        // If in grid mode, try to stay in same row/column
        const useGridAlignment = config.scoringMode === 'grid';
        const tolerance = config.gridAlignmentTolerance;
        let candidates = [];
        for (let i = 0; i < state.focusables.length; i++) {
            if (i === currentIndex)
                continue;
            const entry = state.focusables[i];
            if (!entry || !entry.element)
                continue;
            updateEntryGeometry(entry, state);
            if (!entry.rect || entry.width <= 1 || entry.height <= 1)
                continue;
            // Check grid alignment for row/column wrap
            const gridAligned = useGridAlignment
                ? isGridAligned(currentEntry, entry, direction, tolerance)
                : false;
            // Get position value based on direction (opposite edge)
            let position;
            switch (direction.name) {
                case 'down':
                    position = entry.top; // Want smallest top (topmost)
                    break;
                case 'up':
                    position = -entry.bottom; // Want largest bottom (bottommost)
                    break;
                case 'right':
                    position = entry.left; // Want smallest left (leftmost)
                    break;
                case 'left':
                    position = -entry.right; // Want largest right (rightmost)
                    break;
            }
            candidates.push({
                index: i,
                data: entry,
                position,
                gridAligned,
            });
        }
        if (!candidates.length) {
            return null;
        }
        // Sort: grid-aligned first (if grid mode), then by position
        candidates.sort((a, b) => {
            if (useGridAlignment && a.gridAligned !== b.gridAligned) {
                return a.gridAligned ? -1 : 1;
            }
            return a.position - b.position;
        });
        const best = candidates[0];
        return {
            index: best.index,
            data: best.data,
            rect: best.data.rect,
            score: 0,
            metrics: {
                primary: 0,
                secondary: 0,
                distance: 0,
                alignment: 0,
                deltaX: 0,
                deltaY: 0,
                gridAligned: best.gridAligned,
            },
            passIndex: -1, // Wrap pass
        };
    }

    /**
     * Event utilities for WICG-compliant Navigation Events
     *
     * Implements dispatchNavEvent for navbeforefocus and navnotarget events.
     * Spec: https://drafts.csswg.org/css-nav-1/#events-navigationevent
     */
    /**
     * Dispatch a standard navigation event.
     *
     * @param type - Event type ('navbeforefocus' or 'navnotarget')
     * @param target - Target element to dispatch event on
     * @param details - Event details
     * @returns False if preventDefault() was called, true otherwise
     */
    function dispatchNavEvent(type, target, details) {
        if (!target || !details) {
            return true;
        }
        // Build detail payload with all provided fields
        const detail = {
            dir: details.dir,
            relatedTarget: details.relatedTarget || null
        };
        // Forward focus-trap metadata for navnotarget events
        if (details.inTrap !== undefined) {
            detail.inTrap = !!details.inTrap;
        }
        if (details.trapElement) {
            detail.trapElement = details.trapElement;
        }
        if (details.escapeElement) {
            detail.escapeElement = details.escapeElement;
        }
        if (details.escapeKey) {
            detail.escapeKey = details.escapeKey;
        }
        const event = new CustomEvent(type, {
            bubbles: true,
            cancelable: true,
            detail: detail
        });
        const result = target.dispatchEvent(event);
        // Log for debugging
        /*
        console.log(`[SpatialNav] ${type} event dispatched:`, {
            target: target.tagName + (target.id ? '#' + target.id : ''),
            dir: details.dir,
            inTrap: detail.inTrap,
            escapeKey: detail.escapeKey,
            defaultPrevented: !result
        });
        */
        return result;
    }

    /**
     * Tree-shakeable Logging System for Spatial Navigation
     *
     * Provides structured logging with:
     * - Log levels (debug, info, warn, error)
     * - Namespaced loggers for subsystems
     * - Compile-time tree-shaking when DEBUG is false
     * - Performance timing utilities
     * - Conditional logging based on config
     *
     * Usage:
     *   import { createLogger, DEBUG } from './logger';
     *   const log = createLogger('Movement');
     *   log.debug('Moving focus', { direction: 'down' });
     *
     * In production builds, set DEBUG = false to tree-shake all debug calls.
     */
    /**
     * Debug mode flag.
     * Set to false in production builds to eliminate debug logging.
     * Build tools (Rollup, Webpack, etc.) will tree-shake dead code.
     */
    const DEBUG = /* @__PURE__ */ (() => {
        // Check for explicit debug flag
        if (typeof window !== 'undefined') {
            const w = window;
            if (w.SPATIAL_NAV_DEBUG !== undefined) {
                return w.SPATIAL_NAV_DEBUG;
            }
        }
        // Default: enabled in development, disabled in production
        return typeof process !== 'undefined' &&
            process.env?.NODE_ENV !== 'production';
    })();
    const LOG_LEVEL_ORDER = {
        debug: 0,
        info: 1,
        warn: 2,
        error: 3,
        silent: 4
    };
    /**
     * Current minimum log level.
     */
    let currentLevel = DEBUG ? 'debug' : 'warn';
    /**
     * Check if a log level should be output.
     */
    function shouldLog(level) {
        return LOG_LEVEL_ORDER[level] >= LOG_LEVEL_ORDER[currentLevel];
    }
    /**
     * Format a log message with namespace prefix.
     */
    function formatMessage(namespace, message) {
        return `[SpatialNav:${namespace}] ${message}`;
    }
    /**
     * Create a namespaced logger.
     *
     * @param namespace - Logger namespace (e.g., 'Movement', 'Scoring', 'DOM')
     * @returns Logger instance
     */
    function createLogger(namespace) {
        const timers = new Map();
        return {
            debug(message, data) {
                if (!DEBUG || !shouldLog('debug'))
                    return;
                if (data !== undefined) {
                    console.log(formatMessage(namespace, message), data);
                }
                else {
                    console.log(formatMessage(namespace, message));
                }
            },
            info(message, data) {
                if (!shouldLog('info'))
                    return;
                if (data !== undefined) {
                    console.info(formatMessage(namespace, message), data);
                }
                else {
                    console.info(formatMessage(namespace, message));
                }
            },
            warn(message, data) {
                if (!shouldLog('warn'))
                    return;
                if (data !== undefined) {
                    console.warn(formatMessage(namespace, message), data);
                }
                else {
                    console.warn(formatMessage(namespace, message));
                }
            },
            error(message, data) {
                if (!shouldLog('error'))
                    return;
                if (data !== undefined) {
                    console.error(formatMessage(namespace, message), data);
                }
                else {
                    console.error(formatMessage(namespace, message));
                }
            },
            time(label) {
                if (!DEBUG)
                    return;
                timers.set(label, performance.now());
            },
            timeEnd(label) {
                if (!DEBUG)
                    return;
                const start = timers.get(label);
                if (start !== undefined) {
                    const duration = performance.now() - start;
                    timers.delete(label);
                    this.debug(`${label}: ${duration.toFixed(2)}ms`);
                }
            },
            group(label) {
                if (!DEBUG || !shouldLog('debug'))
                    return;
                console.group(formatMessage(namespace, label));
            },
            groupEnd() {
                if (!DEBUG || !shouldLog('debug'))
                    return;
                console.groupEnd();
            }
        };
    }

    /**
     * JSON utilities for Spatial Navigation System
     *
     * Provides safe JSON serialization shared across all modules.
     */
    /**
     * Safely serialize any value to JSON, handling Error objects and circular references.
     * This is used for logging and debugging across the entire spatial navigation system.
     *
     * @param value - The value to serialize
     * @returns JSON string representation
     */
    function safeJson(value) {
        if (value instanceof Error) {
            return JSON.stringify({
                name: value.name,
                message: value.message,
                stack: value.stack
            });
        }
        if (value && typeof value === 'object' && 'message' in value && typeof value.message === 'string') {
            try {
                return JSON.stringify({
                    ...value,
                    message: value.message
                });
            }
            catch {
                // Fall through to best-effort stringify below.
            }
        }
        try {
            return JSON.stringify(value);
        }
        catch {
            return String(value);
        }
    }
    /**
     * Safely get an attribute from an element, handling any exceptions.
     *
     * @param el - The element to get the attribute from
     * @param attr - The attribute name
     * @returns The attribute value or null
     */
    function safeGetAttr(el, attr) {
        try {
            return el.getAttribute(attr);
        }
        catch {
            return null;
        }
    }

    /**
     * Bridge messaging utilities for Spatial Navigation System
     *
     * Centralizes browser/chrome runtime messaging with consistent
     * Promise/callback handling and error formatting.
     */
    const log$2 = createLogger('Bridge');
    /**
     * Get the runtime API (browser.runtime or chrome.runtime).
     * Returns null if no extension bridge is available.
     */
    function getRuntimeApi() {
        const globalAny = globalThis;
        const runtime = globalAny.browser?.runtime ?? globalAny.chrome?.runtime;
        if (!runtime || typeof runtime.sendMessage !== 'function') {
            return null;
        }
        return runtime;
    }
    /**
     * Check if the extension bridge is available for sending messages.
     */
    function canSendMessage() {
        return getRuntimeApi() !== null;
    }
    /**
     * Check if this is running as a Firefox-style extension (Promise API).
     */
    function isFirefoxStyle() {
        const globalAny = globalThis;
        const runtime = getRuntimeApi();
        return runtime !== null && globalAny.browser?.runtime === runtime;
    }
    /**
     * Send a message to the background script.
     * Handles both Firefox Promise API and Chrome callback API.
     *
     * @param message - The message to send
     * @param options - Optional configuration
     * @returns Promise resolving to the bridge result
     */
    async function sendBridgeMessage(message, options = {}) {
        const runtime = getRuntimeApi();
        if (!runtime) {
            if (options.debug) {
                log$2.debug('No extension bridge available');
            }
            return { success: false, error: 'No extension bridge available' };
        }
        try {
            if (options.debug) {
                log$2.debug(`Sending message: ${safeJson(message)}`);
            }
            if (isFirefoxStyle()) {
                // Firefox-style Promise API
                const result = runtime.sendMessage(message);
                if (result && typeof result.then === 'function') {
                    try {
                        const response = await result;
                        if (options.debug) {
                            log$2.debug(`Response (promise): ${safeJson(response)}`);
                        }
                        return { success: true, response };
                    }
                    catch (error) {
                        const errorMessage = formatBridgeError(error);
                        log$2.error(`Bridge error (promise): ${errorMessage}`);
                        return { success: false, error: errorMessage };
                    }
                }
                return { success: true };
            }
            else {
                // Chrome-style callback API
                return new Promise((resolve) => {
                    runtime.sendMessage(message, (response) => {
                        const runtimeWithError = runtime;
                        const lastError = runtimeWithError.lastError;
                        if (lastError) {
                            const errorMessage = formatBridgeError(lastError);
                            log$2.error(`Bridge error (callback): ${errorMessage}`);
                            resolve({ success: false, error: errorMessage });
                        }
                        else {
                            if (options.debug) {
                                log$2.debug(`Response (callback): ${safeJson(response)}`);
                            }
                            resolve({ success: true, response });
                        }
                    });
                });
            }
        }
        catch (error) {
            const errorMessage = formatBridgeError(error);
            log$2.error(`Bridge exception: ${errorMessage}`);
            return { success: false, error: errorMessage };
        }
    }
    /**
     * Format bridge error for consistent logging.
     */
    function formatBridgeError(error) {
        if (error instanceof Error) {
            return `${error.name}: ${error.message}`;
        }
        if (typeof error === 'object' && error !== null && 'message' in error) {
            return String(error.message);
        }
        return String(error);
    }
    /**
     * Send a focus exit message to the native layer.
     * Falls back to alert() when no extension bridge is available (injected scripts).
     *
     * @param direction - Exit direction (up, down, left, right)
     * @param inTrap - Whether focus is in a trap (dialog, modal)
     * @param options - Optional configuration
     */
    async function sendFocusExit(direction, inTrap, options = { useFallback: true }) {
        // Check if bridge is available
        if (!canSendMessage()) {
            // Fallback for injected scripts (no extension context)
            if (options.useFallback) {
                try {
                    // Use globalThis.alert to ensure we use the mocked version in tests
                    globalThis.alert?.(`__FOCUS_EXIT__:${direction}`);
                }
                catch {
                    // Ignore if alert is not available
                }
            }
            return { success: false, error: 'No extension bridge available' };
        }
        return sendBridgeMessage({
            type: 'focusExit',
            direction,
            inTrap
        });
    }

    /**
     * Movement logic for Spatial Navigation System
     *
     * Handles directional movement, focus updates, and scroll alignment.
     * Features focus trap detection, accessibility announcements, and candidate caching.
     */
    /**
     * Detect if element is within a focus trap (modal, dialog, overlay).
     *
     * @param element - Element to check
     * @param config - Configuration object
     * @returns Trap info or null
     */
    function detectFocusTrap(element, config) {
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
            '.chakra-modal__content' // Chakra UI
        ];
        for (const selector of trapSelectors) {
            try {
                const trap = element.closest(selector);
                if (trap) {
                    // Find escape mechanism
                    const closeButton = trap.querySelector('[data-dismiss], [aria-label*="close" i], [aria-label*="Close" i], ' +
                        'button[class*="close" i], .close-button, [data-testid*="close" i]');
                    const escapeKey = trap.dataset.escapeKey || 'Escape';
                    return {
                        trap,
                        escapeKey,
                        closeButton,
                        trapId: trap.id || trap.getAttribute('aria-labelledby') || 'dialog'
                    };
                }
            }
            catch {
                // Invalid selector, continue
            }
        }
        return null;
    }
    /**
     * Pre-compute directional candidates in background for performance.
     *
     * @param state - Global state object
     */
    function precomputeCandidates(state) {
        const config = state.config;
        if (!config.precomputeCandidates) {
            return;
        }
        const schedulePrecompute = (callback) => {
            if (typeof requestIdleCallback !== 'undefined') {
                requestIdleCallback(callback, { timeout: 100 });
            }
            else {
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
            const targets = {};
            const dirMap = directionByName;
            for (const [name, dir] of Object.entries(dirMap)) {
                targets[name] = findDirectionalCandidate(currentIndex, dir, state);
            }
            // Casting because PrecomputedTargets interface in state.ts is strict with keys
            state.precomputedTargets = targets;
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
    function getCachedOrComputeCandidate(currentIndex, direction, state) {
        const config = state.config;
        const cacheTimeout = config.precomputeCacheTimeout || 500;
        const cacheAge = Date.now() - (state.precomputedTimestamp || 0);
        const cacheValid = state.precomputedForIndex === currentIndex &&
            !state.dirty &&
            cacheAge < cacheTimeout &&
            state.precomputedTargets;
        if (cacheValid && state.precomputedTargets && state.precomputedTargets[direction.name]) {
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
    function moveInDirection(direction, event, state) {
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
                    announce(`In ${trapInfo.trapId}. Press ${trapInfo.escapeKey} to close.`, state, 'polite');
                }
                else {
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
            }
            catch (e) {
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
            const description = getAccessibleDescription(target.data.element, config);
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
                let block = 'nearest';
                let inline = 'nearest';
                if (snapAlign && snapAlign !== 'none') {
                    if (snapAlign.includes('start'))
                        block = 'start';
                    else if (snapAlign.includes('center'))
                        block = 'center';
                    else if (snapAlign.includes('end'))
                        block = 'end';
                    // Also handle inline/x-axis if needed, but usually block is primary for vertical lists
                    if (snapAlign.includes('start'))
                        inline = 'start';
                    else if (snapAlign.includes('center'))
                        inline = 'center';
                    else if (snapAlign.includes('end'))
                        inline = 'end';
                }
                target.data.element.scrollIntoView({ block: block, inline: inline });
            }
            catch {
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
    function ensureValidFocus(state) {
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
            const recovered = state.focusables.find((entry) => {
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
            let bestEntry = null;
            let bestDistance = Infinity;
            for (const entry of state.focusables) {
                if (!entry.rect)
                    continue;
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
        let fallbackEntry;
        if (strategy === 'first') {
            fallbackEntry = state.focusables[0];
        }
        else {
            // 'closest' strategy: find first visible element
            fallbackEntry = state.focusables.find((entry) => {
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
    function applyFocus(element, state) {
        if (!element) {
            return null;
        }
        const htmlEl = element;
        const tagName = (htmlEl.tagName || '').toLowerCase();
        try {
            // Handle IFrames separately
            if (tagName === 'iframe' && state.config?.iframeSupport?.enabled) {
                const iframeEl = htmlEl;
                if (state.config.iframeSupport.focusMethod === 'contentWindow' && iframeEl.contentWindow && typeof iframeEl.contentWindow.focus === 'function') {
                    iframeEl.contentWindow.focus();
                    state.lastFocusedElement = htmlEl;
                    return element;
                }
            }
            const focusWithFallback = () => {
                if (typeof htmlEl.focus !== 'function')
                    return;
                try {
                    htmlEl.focus({ preventScroll: true });
                }
                catch {
                    // Some pages/browsers don't support focus options.
                    try {
                        htmlEl.focus();
                    }
                    catch {
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
                    if (window.flutterSpatialNavDebug) {
                        console.log(`[SpatialNav] Element not accepting focus, setting tabindex="-1": ${describeElement(htmlEl)}`);
                    }
                    htmlEl.setAttribute('tabindex', '-1');
                    focusWithFallback();
                }
            }
            if (document.activeElement === htmlEl) {
                state.lastFocusedElement = htmlEl;
                return element;
            }
            else {
                if (window.flutterSpatialNavDebug) {
                    console.warn(`[SpatialNav] Focus call failed to change activeElement for: ${describeElement(htmlEl)}. Current active: ${describeElement(document.activeElement)}`);
                }
            }
        }
        catch (e) {
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

    /**
     * Click/hit-testing helpers for Spatial Navigation.
     *
     * Kept separate from handlers.ts to reduce file size and make the
     * click path easier to test and reason about.
     */
    function clamp(value, min, max) {
        return Math.min(Math.max(value, min), max);
    }
    function clampToViewport(x, y) {
        const maxX = Math.max(0, (window?.innerWidth ?? 0) - 1);
        const maxY = Math.max(0, (window?.innerHeight ?? 0) - 1);
        return {
            x: clamp(x, 0, maxX),
            y: clamp(y, 0, maxY)
        };
    }
    function isHitWithinTarget(hit, target) {
        if (!hit)
            return false;
        if (hit === target)
            return true;
        try {
            return target.contains(hit);
        }
        catch {
            return false;
        }
    }
    function pickClickPoint(target) {
        const rect = target.getBoundingClientRect();
        const inset = 1;
        const points = [
            { label: 'center', x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
            { label: 'top-left', x: rect.left + inset, y: rect.top + inset },
            { label: 'top-right', x: rect.right - inset, y: rect.top + inset },
            { label: 'bottom-left', x: rect.left + inset, y: rect.bottom - inset },
            { label: 'bottom-right', x: rect.right - inset, y: rect.bottom - inset },
            { label: 'top-center', x: rect.left + rect.width / 2, y: rect.top + inset },
            { label: 'bottom-center', x: rect.left + rect.width / 2, y: rect.bottom - inset },
            { label: 'center-left', x: rect.left + inset, y: rect.top + rect.height / 2 },
            { label: 'center-right', x: rect.right - inset, y: rect.top + rect.height / 2 }
        ];
        for (const point of points) {
            const clamped = clampToViewport(point.x, point.y);
            const hit = document.elementFromPoint(clamped.x, clamped.y);
            if (isHitWithinTarget(hit, target)) {
                return { x: clamped.x, y: clamped.y, label: point.label, hit };
            }
        }
        const fallback = clampToViewport(points[0].x, points[0].y);
        return { x: fallback.x, y: fallback.y, label: 'center', hit: document.elementFromPoint(fallback.x, fallback.y) };
    }

    /**
     * Focus recovery and overlay update helpers for Spatial Navigation System
     *
     * These utilities are extracted from handlers.ts to reduce coupling
     * and prevent circular dependencies with observer.ts.
     */
    const log$1 = createLogger('Focus');
    /**
     * Schedule an overlay update with requestAnimationFrame.
     * Respects overlay suppression state for focus-exit scenarios.
     *
     * @param target - Target element to highlight
     * @param state - Global state object
     */
    function scheduleOverlayUpdate(target, state) {
        if (state.overlaySuppressed) {
            // Ensure no pending overlay update re-shows the overlay after an exit.
            if (state.updateTimer) {
                cancelAnimationFrame(state.updateTimer);
                state.updateTimer = null;
            }
            if (target && target.nodeType === 1) {
                state.lastFocusedElement = target;
            }
            return;
        }
        if (state.updateTimer) {
            cancelAnimationFrame(state.updateTimer);
        }
        state.updateTimer = requestAnimationFrame(function () {
            if (state.overlaySuppressed) {
                state.updateTimer = null;
                return;
            }
            showOverlay(target, state, true);
            const dirMap = directionByName;
            updatePreviewVisuals(target, null, findDirectionalCandidate, dirMap, describeElement, state);
            // Update instrumentation for tests
            if (state.instrumentation) {
                state.instrumentation.lastActive = describeElement(target) || 'EMPTY_DESC';
                state.instrumentation.lastOverlay = describeElement(target);
                state.instrumentation.activeIndex = state.focusableElements ? state.focusableElements.indexOf(target) : -1;
                state.instrumentation.lastUpdate = Date.now();
            }
            if (target && target.nodeType === 1) {
                state.lastFocusedElement = target;
            }
            state.updateTimer = null;
        });
    }
    /**
     * Store the current focus position as a hint for recovery.
     * Called before DOM mutations to preserve geometric position.
     * This prevents "popping to top" when virtual scroll recycles the focused element.
     *
     * @param state - Global state object
     */
    function storePositionHint(state) {
        const active = getActiveElement();
        if (!active || !(active instanceof HTMLElement)) {
            return;
        }
        const currentIndex = state.focusableElements.indexOf(active);
        if (currentIndex === -1) {
            return;
        }
        const entry = state.focusables[currentIndex];
        if (!entry || !entry.rect) {
            return;
        }
        state.lastFocusPosition = {
            centerX: entry.centerX,
            centerY: entry.centerY,
            top: entry.top,
            left: entry.left,
            elementDesc: describeElement(active),
            timestamp: Date.now()
        };
        if (DEBUG) {
            log$1.debug(`Stored position hint: ${state.lastFocusPosition.elementDesc} at (${entry.centerX.toFixed(0)}, ${entry.centerY.toFixed(0)})`);
        }
    }

    /**
     * Menu-toggle handling helpers for Spatial Navigation.
     *
     * Some sites use hover-driven navigation menus that open on pointer enter and do
     * not reliably close on click/tap. For D-pad/Enter interactions we treat
     * aria-haspopup/aria-expanded toggles as true toggles: second press closes.
     */
    function isMenuToggleElement(el) {
        const ariaHasPopup = safeGetAttr(el, 'aria-haspopup');
        const ariaExpanded = safeGetAttr(el, 'aria-expanded');
        return (ariaHasPopup !== null && ariaHasPopup !== 'false') || ariaExpanded !== null;
    }
    function isElementVisible(el) {
        if (!el)
            return false;
        try {
            const style = window.getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden')
                return false;
            if (typeof style.opacity === 'string' && style.opacity.length && parseFloat(style.opacity) <= 0)
                return false;
        }
        catch {
            // If we can't read styles, fall back to geometry checks.
        }
        try {
            const rect = el.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
        }
        catch {
            return false;
        }
    }
    function looksLikeSubmenu(el) {
        const tag = el.tagName.toLowerCase();
        if (tag === 'ul' || tag === 'ol')
            return true;
        const role = safeGetAttr(el, 'role');
        if (role === 'menu' || role === 'listbox')
            return true;
        const className = safeGetAttr(el, 'class') || '';
        if (/(menu|submenu|dropdown|child)/i.test(className))
            return true;
        try {
            return !!el.querySelector?.('a[href], button, [role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"]');
        }
        catch {
            return false;
        }
    }
    function findNavigationRoot(start) {
        let current = start;
        let depth = 0;
        while (current && depth < 12) {
            const tagName = current.tagName?.toLowerCase?.();
            if (tagName === 'nav' || tagName === 'header') {
                return current;
            }
            const role = safeGetAttr(current, 'role');
            if (role === 'navigation') {
                return current;
            }
            const id = safeGetAttr(current, 'id') || '';
            if (id && /nav/i.test(id) && id.length <= 48) {
                try {
                    // Heuristic: treat as navigation only if it actually contains links/menuitems.
                    if (current.querySelector?.('a, [role="menuitem"], [role="link"]')) {
                        return current;
                    }
                }
                catch {
                    return current;
                }
            }
            current = current.parentElement;
            depth += 1;
        }
        return null;
    }
    function findAssociatedSubmenu(toggle) {
        const ariaControls = safeGetAttr(toggle, 'aria-controls');
        if (ariaControls) {
            const controlled = document.getElementById(ariaControls);
            if (controlled && controlled.nodeType === 1)
                return controlled;
        }
        const nextSibling = toggle.nextElementSibling;
        if (nextSibling && nextSibling.nodeType === 1 && looksLikeSubmenu(nextSibling)) {
            return nextSibling;
        }
        // Common wrappers for drop-down menus.
        const container = toggle.closest?.('.folder-parent, li, nav, header, [role="menuitem"]');
        if (container) {
            const directChildren = Array.from(container.children);
            for (const child of directChildren) {
                if (child === toggle)
                    continue;
                if (child.nodeType === 1 && looksLikeSubmenu(child)) {
                    return child;
                }
            }
        }
        return null;
    }
    function detectMenuToggleState(toggle) {
        const ariaExpanded = safeGetAttr(toggle, 'aria-expanded');
        const submenu = findAssociatedSubmenu(toggle);
        if (ariaExpanded === 'true') {
            return { isOpen: true, ariaExpanded, submenu, reason: 'aria-expanded' };
        }
        if (ariaExpanded === 'false') {
            return { isOpen: false, ariaExpanded, submenu, reason: 'aria-expanded' };
        }
        if (submenu && isElementVisible(submenu)) {
            return { isOpen: true, ariaExpanded, submenu, reason: 'submenu-visible' };
        }
        if (submenu) {
            return { isOpen: false, ariaExpanded, submenu, reason: 'submenu-hidden' };
        }
        return { isOpen: false, ariaExpanded, submenu: null, reason: 'no-submenu' };
    }
    function isWithinAny(hit, roots) {
        if (!hit)
            return false;
        for (const root of roots) {
            if (!root)
                continue;
            if (hit === root)
                return true;
            try {
                if (root.contains(hit))
                    return true;
            }
            catch {
                // ignore
            }
        }
        return false;
    }
    function looksInteractive(el) {
        if (!el)
            return false;
        try {
            const tagName = el.tagName?.toLowerCase?.();
            if (!tagName)
                return false;
            if (tagName === 'a')
                return safeGetAttr(el, 'href') !== null;
            if (tagName === 'button' || tagName === 'input' || tagName === 'select' || tagName === 'textarea')
                return true;
            const role = safeGetAttr(el, 'role');
            if (role === 'button' || role === 'menuitem' || role === 'link')
                return true;
            const tabIndex = safeGetAttr(el, 'tabindex');
            if (tabIndex !== null && tabIndex !== '-1')
                return true;
            return false;
        }
        catch {
            return false;
        }
    }
    function pickOutsidePoint(options) {
        const inset = 8;
        const { toggleRect, submenuRect, exclusions } = options;
        const points = [];
        if (submenuRect) {
            points.push({ label: 'submenu-below', x: submenuRect.left + submenuRect.width / 2, y: submenuRect.bottom + inset });
            points.push({ label: 'submenu-right', x: submenuRect.right + inset, y: submenuRect.top + inset });
            points.push({ label: 'submenu-left', x: submenuRect.left - inset, y: submenuRect.top + inset });
            points.push({ label: 'submenu-above', x: submenuRect.left + submenuRect.width / 2, y: submenuRect.top - inset });
        }
        points.push({ label: 'toggle-below', x: toggleRect.left + toggleRect.width / 2, y: toggleRect.bottom + inset });
        points.push({ label: 'toggle-above', x: toggleRect.left + toggleRect.width / 2, y: toggleRect.top - inset });
        points.push({ label: 'viewport-center', x: (window?.innerWidth ?? 0) / 2, y: (window?.innerHeight ?? 0) / 2 });
        points.push({ label: 'viewport-top-left', x: inset, y: inset });
        points.push({ label: 'viewport-top-right', x: (window?.innerWidth ?? 0) - inset, y: inset });
        points.push({ label: 'viewport-bottom-left', x: inset, y: (window?.innerHeight ?? 0) - inset });
        points.push({ label: 'viewport-bottom-right', x: (window?.innerWidth ?? 0) - inset, y: (window?.innerHeight ?? 0) - inset });
        let fallback = null;
        for (const point of points) {
            const clamped = clampToViewport(point.x, point.y);
            const hit = document.elementFromPoint(clamped.x, clamped.y);
            if (isWithinAny(hit, exclusions))
                continue;
            const candidate = { x: clamped.x, y: clamped.y, label: point.label, hit };
            if (!looksInteractive(hit)) {
                return candidate;
            }
            if (!fallback)
                fallback = candidate;
        }
        if (fallback)
            return fallback;
        const center = clampToViewport(toggleRect.left + toggleRect.width / 2, toggleRect.top + toggleRect.height / 2);
        return { x: center.x, y: center.y, label: 'toggle-center', hit: document.elementFromPoint(center.x, center.y) };
    }
    function dispatchHoverExit(target, clientX, clientY) {
        const commonOptions = {
            bubbles: true,
            cancelable: true,
            view: window,
            clientX,
            clientY,
            buttons: 0,
            detail: 0
        };
        // Dispatch both Pointer and Mouse exit events for better compatibility.
        if (typeof window.PointerEvent === 'function') {
            const pointerExit = {
                ...commonOptions,
                pointerId: 1,
                pointerType: 'mouse',
                isPrimary: true,
                button: -1,
                pressure: 0
            };
            target.dispatchEvent(new window.PointerEvent('pointerout', pointerExit));
            target.dispatchEvent(new window.PointerEvent('pointerleave', pointerExit));
        }
        target.dispatchEvent(new MouseEvent('mouseout', commonOptions));
        target.dispatchEvent(new MouseEvent('mouseleave', commonOptions));
    }
    function tryCloseOpenMenuToggle(options) {
        const { actionElement, state, event, handlerId, runtimeApi, canRequestNativeClick } = options;
        const menuState = detectMenuToggleState(actionElement);
        if (!menuState.isOpen)
            return false;
        const closeHandlerId = handlerId;
        const menuContainer = actionElement.closest?.('.folder-parent') ||
            actionElement.parentElement ||
            actionElement;
        const navRoot = findNavigationRoot(actionElement);
        const exclusions = [menuContainer, menuState.submenu, actionElement, navRoot].filter(Boolean);
        const submenuRect = menuState.submenu ? menuState.submenu.getBoundingClientRect() : null;
        const toggleRect = actionElement.getBoundingClientRect();
        const outside = pickOutsidePoint({ toggleRect, submenuRect, exclusions });
        if (window.flutterSpatialNavDebug) {
            console.log(`[SpatialNav DEBUG] Menu toggle appears OPEN (${menuState.reason}) - closing via hover-exit + outside click ${safeJson({
            toggle: describeElement(actionElement),
            ariaExpanded: menuState.ariaExpanded,
            submenu: menuState.submenu ? describeElement(menuState.submenu) : null,
            navRoot: navRoot ? describeElement(navRoot) : null,
            outside: {
                label: outside.label,
                x: outside.x,
                y: outside.y,
                hit: describeElement(outside.hit)
            }
        })}`);
        }
        // 1) Try to close hover-driven menus (JS handlers attached to mouseleave).
        dispatchHoverExit(actionElement, outside.x, outside.y);
        if (menuState.submenu) {
            dispatchHoverExit(menuState.submenu, outside.x, outside.y);
        }
        // 2) If hover-exit already closed the menu, do NOT click outside.
        // Clicking outside will often steal focus from the toggle (unfocus), and on some
        // sites may accidentally trigger navigation if the point lands on chrome/nav.
        const afterHover = detectMenuToggleState(actionElement);
        if (!afterHover.isOpen) {
            if (window.flutterSpatialNavDebug) {
                console.log(`[SpatialNav DEBUG] Menu closed via hover-exit (${menuState.reason}) - skipping outside click`);
            }
            state.dirty = true;
            try {
                if (typeof actionElement.focus === 'function') {
                    actionElement.focus();
                }
                scheduleOverlayUpdate(actionElement, state);
            }
            catch {
                // ignore
            }
            event.preventDefault();
            event.stopPropagation();
            return true;
        }
        // 3) Still open: click outside as a fallback. Run in a later task to avoid
        // re-entrancy issues and to allow any menu close transitions to settle.
        setTimeout(() => {
            const currentDomHandlerId = document.documentElement.getAttribute('data-spatnav-handler-id');
            if (String(closeHandlerId) !== currentDomHandlerId)
                return;
            const stillOpen = detectMenuToggleState(actionElement);
            if (!stillOpen.isOpen)
                return;
            const toggleRectNow = actionElement.getBoundingClientRect();
            const submenuRectNow = stillOpen.submenu ? stillOpen.submenu.getBoundingClientRect() : submenuRect;
            const outsideNow = pickOutsidePoint({ toggleRect: toggleRectNow, submenuRect: submenuRectNow, exclusions });
            if (window.flutterSpatialNavDebug) {
                console.log(`[SpatialNav DEBUG] Menu still open - applying outside-click fallback ${safeJson({
                toggle: describeElement(actionElement),
                outside: {
                    label: outsideNow.label,
                    x: outsideNow.x,
                    y: outsideNow.y,
                    hit: describeElement(outsideNow.hit),
                }
            })}`);
            }
            // Prefer native outside click when available for trusted closing.
            if (canRequestNativeClick && runtimeApi && typeof runtimeApi.sendMessage === 'function') {
                const dpr = window.devicePixelRatio || 1;
                const physicalX = outsideNow.x * dpr;
                const physicalY = outsideNow.y * dpr;
                try {
                    console.log(`[SpatialNav] Closing menu toggle via NATIVE outside click ${safeJson({
                    css: { x: outsideNow.x, y: outsideNow.y, point: outsideNow.label },
                    dpr,
                    final: { x: physicalX, y: physicalY }
                })}`);
                    runtimeApi.sendMessage({
                        type: 'simulateClick',
                        x: physicalX,
                        y: physicalY,
                        debug: {
                            cssX: outsideNow.x,
                            cssY: outsideNow.y,
                            point: outsideNow.label,
                            hit: describeElement(outsideNow.hit),
                            context: 'menuToggleClose',
                        }
                    });
                }
                catch (e) {
                    console.warn('[SpatialNav] Native outside-click failed, using JS fallback', e);
                }
            }
            else {
                const hit = outsideNow.hit;
                try {
                    if (hit && typeof hit.dispatchEvent === 'function') {
                        hit.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window, clientX: outsideNow.x, clientY: outsideNow.y, buttons: 1, detail: 1 }));
                        hit.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window, clientX: outsideNow.x, clientY: outsideNow.y, buttons: 1, detail: 1 }));
                    }
                    if (hit && typeof hit.click === 'function') {
                        hit.click();
                    }
                    else if (typeof document.body?.click === 'function') {
                        document.body.click();
                    }
                }
                catch {
                    // ignore
                }
            }
            // Restore focus to the toggle after the outside-click closes the menu.
            // Native injection will typically move focus to the clicked element.
            setTimeout(() => {
                const currentId2 = document.documentElement.getAttribute('data-spatnav-handler-id');
                if (String(closeHandlerId) !== currentId2)
                    return;
                try {
                    if (typeof actionElement.focus === 'function') {
                        actionElement.focus();
                    }
                    scheduleOverlayUpdate(actionElement, state);
                }
                catch {
                    // ignore
                }
            }, 120);
        }, 0);
        state.dirty = true;
        event.preventDefault();
        event.stopPropagation();
        return true;
    }

    /**
     * Event handlers for Spatial Navigation System
     *
     * Manages keyboard event listeners and orchestrates navigation.
     */
    // Create logger for handlers
    const log = createLogger('Handlers');
    /**
     * Handle key down events for spatial navigation.
     *
     * @param event - The keydown event
     * @param state - Global state object
     */
    function handleKeyDown(event, state) {
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
        const timeStamp = typeof event.timeStamp === 'number' && Number.isFinite(event.timeStamp)
            ? event.timeStamp
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
                if (lockValue !== eventLockKey)
                    return;
                const root = document.documentElement;
                if (typeof root.removeAttribute === 'function') {
                    root.removeAttribute(lockAttr);
                }
                else {
                    document.documentElement.setAttribute(lockAttr, '');
                }
            }
            catch {
                // ignore
            }
        };
        try {
            if (typeof queueMicrotask === 'function') {
                queueMicrotask(clearLock);
            }
            else {
                setTimeout(clearLock, 0);
            }
        }
        catch {
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
                const htmlElement = activeElement;
                const inputElement = activeElement;
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
                let actionElement = activeElement;
                try {
                    const menuToggle = activeElement.closest?.('[aria-haspopup], [aria-expanded]');
                    if (menuToggle) {
                        actionElement = menuToggle;
                    }
                }
                catch {
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
                const wantsNativeClick = ((actionTag === 'a' && !actionElement.hasAttribute('href')) ||
                    (actionTag === 'div' || actionTag === 'span' || actionTag === 'button') ||
                    (actionRole === 'button') ||
                    (actionTag === 'video') ||
                    (actionTag === 'img'));
                // Only attempt native injection if the WebExtension bridge exists.
                const runtimeApi = globalThis.browser?.runtime ?? globalThis.chrome?.runtime;
                const canRequestNativeClick = !!runtimeApi &&
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
                const actionCenter = clampToViewport(actionRect.left + actionRect.width / 2, actionRect.top + actionRect.height / 2);
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
                    if (typeof window.PointerEvent === 'function') {
                        const pointerHover = {
                            ...commonOptions,
                            pointerId: 1,
                            pointerType: 'touch',
                            isPrimary: true,
                            button: 0,
                            pressure: 0
                        };
                        clickTarget.dispatchEvent(new window.PointerEvent('pointerover', pointerHover));
                        clickTarget.dispatchEvent(new window.PointerEvent('pointerenter', pointerHover));
                    }
                    clickTarget.dispatchEvent(new MouseEvent('mouseover', commonOptions));
                    clickTarget.dispatchEvent(new MouseEvent('mouseenter', commonOptions));
                    if (typeof activeElement.focus === 'function')
                        activeElement.focus();
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
                        const message = { type: 'simulateClick', x: finalX, y: finalY };
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
                        if (globalThis.browser?.runtime === runtimeApi) {
                            // Firefox-style Promise API
                            const result = runtimeApi.sendMessage(message);
                            if (result && typeof result.then === 'function') {
                                result.then((response) => {
                                    console.log('[SpatialNav] Background relay SUCCESS (promise):', response);
                                }).catch((error) => {
                                    console.error('[SpatialNav] Background relay FAIL (promise):', error);
                                });
                            }
                        }
                        else {
                            // Chrome-style callback API
                            runtimeApi.sendMessage(message, (response) => {
                                const error = runtimeApi.lastError;
                                if (error) {
                                    console.error('[SpatialNav] Background relay FAIL (lastError):', error);
                                }
                                else {
                                    console.log('[SpatialNav] Background relay SUCCESS (callback):', response);
                                }
                            });
                        }
                    }
                    catch (e) {
                        console.warn('[SpatialNav] Native injection unavailable, falling back to JS .click()', e);
                        try {
                            if (typeof clickTarget.click === 'function') {
                                clickTarget.click();
                            }
                            else {
                                activeElement.click();
                            }
                        }
                        catch {
                            activeElement.click();
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
                            if (state.overlay)
                                state.overlay.classList.remove('click-animate');
                            activeElement.classList.remove('spatnav-pressed');
                        }, 150);
                    }
                    // Prevent key default to avoid double-activation via browser key handling.
                    event.preventDefault();
                    event.stopPropagation();
                    return;
                }
                else {
                    // JS click simulation path (injected mode / no bridge).
                    if (typeof window.PointerEvent === 'function') {
                        const pointerBase = {
                            ...commonOptions,
                            pointerId: 1,
                            pointerType: 'touch',
                            isPrimary: true,
                            button: 0,
                            pressure: 0.5
                        };
                        clickTarget.dispatchEvent(new window.PointerEvent('pointerover', pointerBase));
                        clickTarget.dispatchEvent(new window.PointerEvent('pointerenter', pointerBase));
                        clickTarget.dispatchEvent(new window.PointerEvent('pointerdown', pointerBase));
                    }
                    clickTarget.dispatchEvent(new MouseEvent('mouseover', commonOptions));
                    clickTarget.dispatchEvent(new MouseEvent('mouseenter', commonOptions));
                    clickTarget.dispatchEvent(new MouseEvent('mousedown', commonOptions));
                    if (typeof activeElement.focus === 'function')
                        activeElement.focus();
                    clickTarget.dispatchEvent(new MouseEvent('mouseup', commonOptions));
                    if (typeof window.PointerEvent === 'function') {
                        const pointerUp = {
                            ...commonOptions,
                            pointerId: 1,
                            pointerType: 'touch',
                            isPrimary: true,
                            button: 0,
                            pressure: 0
                        };
                        clickTarget.dispatchEvent(new window.PointerEvent('pointerup', pointerUp));
                    }
                    try {
                        // Final native click
                        if (typeof clickTarget.click === 'function') {
                            clickTarget.click();
                        }
                        else {
                            activeElement.click();
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
                    }
                    catch (e) {
                        activeElement.click();
                    }
                }
                // Visual feedback
                if (state.overlay) {
                    state.overlay.classList.remove('click-animate');
                    void state.overlay.offsetWidth;
                    state.overlay.classList.add('click-animate');
                    activeElement.classList.add('spatnav-pressed');
                    setTimeout(() => {
                        if (state.overlay)
                            state.overlay.classList.remove('click-animate');
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
        const keyMap = directionByKey;
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
        const currentActive = validActive;
        const currentIndex = currentActive ? state.focusableElements.indexOf(currentActive) : -1;
        console.log('[SpatialNav] Current focus:', describeElement(currentActive), 'index:', currentIndex);
        // Log next targets
        const dirMap = directionByName;
        // Cast to expected type - preview returns object with potential nulls
        const targets = updatePreviewTargets(currentIndex, findDirectionalCandidate, dirMap, state);
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
        const beforeIndex = beforeActive ? state.focusableElements.indexOf(beforeActive) : -1;
        if (window.flutterSpatialNavDebug) {
            log.debug(`BEFORE MOVE: active=${describeElement(beforeActive)}, index=${beforeIndex}`);
        }
        const moved = moveInDirection(direction, event, state);
        // DEBUG: Log focus state after move
        const afterActive = getActiveElement();
        const afterIndex = afterActive ? state.focusableElements.indexOf(afterActive) : -1;
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
            }
            else {
                if (window.flutterSpatialNavDebug) {
                    log.debug('Retry successful!');
                }
                const newActive = getActiveElement();
                if (newActive) {
                    scheduleOverlayUpdate(newActive, state);
                }
            }
        }
        else {
            if (window.flutterSpatialNavDebug) {
                log.debug('Movement successful');
            }
            const newActive = getActiveElement();
            console.log('[SpatialNav] New focus:', describeElement(newActive));
            // Update overlay to show new focused element
            if (newActive) {
                scheduleOverlayUpdate(newActive, state);
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
    function attachScrollListener(state) {
        const config = state.config;
        // FIX (MEDIUM): Gate listener behind config option
        if (config.observeScroll === false) {
            // console.log('[SpatialNav] Scroll listener disabled by config');
            return;
        }
        // FIX (HIGH): Use WeakMap to track scroll positions for each element
        const scrollPositions = new WeakMap();
        let scrollTimer = null;
        window.addEventListener('scroll', (event) => {
            if (scrollTimer)
                return; // Throttle to one update per frame
            scrollTimer = requestAnimationFrame(() => {
                const rawTarget = event && event.target ? event.target : window;
                if (!rawTarget) {
                    scrollTimer = null;
                    return;
                }
                const target = rawTarget === document ? window : rawTarget;
                const threshold = config.scrollThreshold || 8;
                // FIX (HIGH): Get scroll position from the actual scrolling element
                let currentScrollY;
                let currentScrollX;
                if (target === window) {
                    currentScrollY = window.scrollY;
                    currentScrollX = window.scrollX;
                }
                else if (target.scrollTop !== undefined) {
                    currentScrollY = target.scrollTop;
                    currentScrollX = target.scrollLeft;
                }
                else {
                    scrollTimer = null;
                    return;
                }
                // Get cached position
                const cached = scrollPositions.get(target) || { scrollY: currentScrollY, scrollX: currentScrollX };
                const deltaY = Math.abs(currentScrollY - cached.scrollY);
                const deltaX = Math.abs(currentScrollX - cached.scrollX);
                // Only update if scroll is significant (prevents jitter on smooth scroll)
                if (deltaY > threshold || deltaX > threshold) {
                    const active = getActiveElement();
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
                    scrollPositions.set(target, { scrollY: currentScrollY, scrollX: currentScrollX });
                }
                scrollTimer = null;
            });
        }, {
            capture: true, // LLM 4: Capture phase detects overflow:auto scrolling
            passive: true // Don't block scrolling
        });
        // Store scroll listener state for SPA navigation tracking
        state.scrollListenerAttached = true;
    }
    /**
     * Attach global event listeners.
     *
     * @param state - Global state object
     */
    function attachHandlers(state) {
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
        document.documentElement.getAttribute('data-spatnav-handler-id');
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
            if (target === window || target === document)
                return;
            refreshFocusables(state);
            scheduleOverlayUpdate(target, state);
        }, true);
        window.addEventListener('blur', function () {
            // Optional: hide overlay on blur?
            // For now we keep it to show last focused position
        }, true);
        // TODO 1: Attach scroll listener with capture
        attachScrollListener(state);
        state.handlersAttached = true;
    }

    /**
     * Mutation Observer utilities for Spatial Navigation System
     *
     * Handles DOM mutation detection with buffered architecture and conditional refresh.
     * Features framework-aware refresh scheduling for React/Vue/Angular.
     */
    // Mutation buffer for batching changes
    const mutationBuffer = [];
    let mutationTimer = null;
    /**
     * Framework adapters for delayed refresh after reconciliation.
     */
    const frameworkAdapters = {
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
                }
                else if (typeof requestIdleCallback !== 'undefined') {
                    requestIdleCallback(callback, { timeout: 200 });
                }
                else {
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
                    const testabilities = window.getAllAngularTestabilities();
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
    function detectFramework(state) {
        // Use cached result if available
        if (state.detectedFramework) {
            return state.detectedFramework;
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
            }
            catch {
                // Detection failed, try next
            }
        }
        state.detectedFramework = false; // Mark as "no framework detected"
        return null;
    }
    /**
     * Schedule a refresh with framework-aware timing.
     *
     * @param callback - Refresh callback
     * @param state - Global state object
     */
    function scheduleFrameworkAwareRefresh(callback, state) {
        const config = state.config;
        if (!config.frameworkAwareRefresh) {
            // Framework-aware refresh disabled, run immediately
            callback();
            return;
        }
        const framework = detectFramework(state);
        if (framework) {
            framework.scheduleRefresh(callback);
        }
        else {
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
    function flushMutations(state) {
        if (mutationBuffer.length === 0)
            return;
        const config = state.config;
        const debounce = config.mutationDebounce || 100;
        if (mutationTimer)
            clearTimeout(mutationTimer);
        mutationTimer = setTimeout(() => {
            // CRITICAL: Store position hint BEFORE any refresh to enable geometric recovery
            // This prevents "popping to top" when virtual scroll recycles the focused element
            storePositionHint(state);
            // Check if we need full refresh (DOM structure changed)
            const needsFullRefresh = mutationBuffer.some(m => m.type === 'childList');
            // Invalidate precomputed cache
            state.dirty = true;
            state.precomputedTargets = null;
            const doRefresh = () => {
                if (needsFullRefresh) {
                    // console.log('[SpatialNav] DOM childList mutation, full refresh');
                    refreshFocusables(state);
                }
                else {
                    // console.log('[SpatialNav] Attribute mutation, incremental update');
                    refreshAttributes(state, mutationBuffer);
                }
                // Update overlay if current element is still valid
                // Explicitly cast result to HTMLElement since scheduleOverlayUpdate expects it
                const active = getActiveElement();
                if (active && state.focusableElements && state.focusableElements.includes(active)) {
                    scheduleOverlayUpdate(active, state);
                }
                else if (state.overlay) {
                    // Current element became unfocusable or was removed
                    console.warn('[SpatialNav] Current focus invalidated by mutation');
                    hideOverlay(state);
                }
            };
            // Use framework-aware scheduling
            scheduleFrameworkAwareRefresh(doRefresh, state);
            mutationBuffer.length = 0; // Clear buffer
            mutationTimer = null;
        }, debounce);
    }
    /**
     * Attach MutationObserver with buffered architecture.
     *
     * @param state - Global state object
     */
    function attachMutationObserver(state) {
        if (state.mutationObserver)
            return;
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
            attributeFilter: ['style', 'class', 'disabled', 'hidden', 'aria-hidden', 'tabindex', 'contenteditable'] // FIX (LOW)
        });
        state.mutationObserver = observer;
        // console.log('[SpatialNav] MutationObserver attached with buffer strategy');
    }

    /**
     * Debug utilities for Spatial Navigation System
     *
     * Exposes window.spatialNavDebug API for instrumentation and testing.
     */
    /**
     * Initialize debug API on window object.
     *
     * @param state - Global state object
     */
    function initDebugApi(state) {
        window.flutterFocusDebug = window.flutterFocusDebug || {};
        // Expose instrumentation for tests
        window.flutterFocusInstrumentation = state.instrumentation;
        // Programmatic movement
        window.flutterFocusDebug.move = function (directionName) {
            // Safe cast as we check for validity
            const direction = directionByName[directionName];
            if (!direction) {
                return false;
            }
            refreshFocusables(state);
            const moved = moveInDirection(direction, null, state);
            try {
                document.title = 'focusDebugMove:' + JSON.stringify({
                    direction: directionName,
                    moved: !!moved,
                    active: describeElement(getActiveElement()),
                    timestamp: Date.now()
                });
            }
            catch (err) {
                // ignore serialization issues
            }
            return moved;
        };
        // Toggle preview visuals
        window.flutterFocusDebug.setPreviewEnabled = function (enabled) {
            state.previewEnabled = enabled !== false;
            if (!state.previewEnabled) {
                hidePreviewElements(state);
                state.nextTargets = { up: null, down: null, left: null, right: null };
            }
            else {
                const active = getActiveElement();
                if (active) {
                    const dirMap = directionByName;
                    updatePreviewVisuals(active, null, findDirectionalCandidate, dirMap, describeElement, state);
                }
            }
            try {
                document.title = 'focusPreviewToggle:' + JSON.stringify({
                    enabled: state.previewEnabled,
                    timestamp: Date.now()
                });
            }
            catch (err) {
                // ignore serialization issues
            }
            return state.previewEnabled;
        };
        // Inspect current targets
        window.flutterFocusDebug.previewTargets = function (label) {
            const summary = {};
            directionKeys.forEach(function (direction) {
                const entry = state.nextTargets && state.nextTargets[direction];
                summary[direction] =
                    entry && entry.data && entry.data.element ? describeElement(entry.data.element) : '[blocked]';
            });
            try {
                document.title = 'focusPreview:' + JSON.stringify({
                    label: label || '',
                    targets: summary,
                    timestamp: Date.now()
                });
            }
            catch (err) {
                // ignore serialization issues
            }
            return summary;
        };
        // Snapshot instrumentation metrics
        window.flutterFocusDebug.snapshot = function (label) {
            const inst = state.instrumentation;
            try {
                document.title = 'focusInstrumentation:' + JSON.stringify({
                    label: label || '',
                    lastOverlay: inst.lastOverlay || '',
                    lastActive: inst.lastActive || '',
                    mismatchCount: inst.mismatchCount || 0,
                    overlayIndex: typeof inst.overlayIndex === 'number' ? inst.overlayIndex : -1,
                    activeIndex: typeof inst.activeIndex === 'number' ? inst.activeIndex : -1,
                    focusableCount: state.focusableCount || 0,
                    lastDirection: inst.lastDirection || '',
                    timestamp: Date.now()
                });
            }
            catch (err) {
                // ignore
            }
            return inst;
        };
        // Expose performance monitoring (TODO 4)
        window.flutterSpatNavPerf = function () {
            return state.perf || {};
        };
    }

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
    // Constants for DOM element IDs
    const STYLE_ID = 'spatnav-focus-styles';
    const OVERLAY_HOST_ID = 'spatnav-focus-host';
    // Native app identifier for GeckoView messaging
    const NATIVE_APP_ID = 'flutter_geckoview';
    const VERSION = '3.0.0';
    // Background script port for connection-based messaging
    let backgroundPort = null;
    /**
     * Connect to background script for native messaging relay.
     */
    function connectToBackground(state) {
        if (backgroundPort) {
            return backgroundPort;
        }
        try {
            if (typeof browser !== 'undefined' && browser?.runtime?.connect) {
                backgroundPort = browser.runtime.connect({ name: 'spatial-nav-content' });
                backgroundPort.onMessage.addListener((message) => {
                    console.log(`[SpatialNav] Message from background: ${safeJson(message)}`);
                    handleNativeResponse(message, state);
                });
                backgroundPort.onDisconnect.addListener(() => {
                    console.log('[SpatialNav] Background port disconnected');
                    backgroundPort = null;
                });
                console.log('[SpatialNav] Connected to background script');
                return backgroundPort;
            }
        }
        catch (e) {
            console.log('[SpatialNav] Background connection not available:', e.message);
        }
        return null;
    }
    /**
     * Handle responses from native layer (via background script).
     */
    function handleNativeResponse(message, state) {
        if (!message || !message.type)
            return;
        switch (message.type) {
            case 'configUpdate':
                if (message.config) {
                    updateConfig(message.config);
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
    function postToNative(message) {
        if (backgroundPort) {
            try {
                backgroundPort.postMessage(message);
                return true;
            }
            catch (e) {
                console.warn('[SpatialNav] Failed to post to background:', e.message);
                backgroundPort = null;
            }
        }
        // Fallback to direct sendNativeMessage
        try {
            if (typeof browser !== 'undefined' && browser?.runtime?.sendNativeMessage) {
                browser.runtime.sendNativeMessage(NATIVE_APP_ID, message);
                return true;
            }
        }
        catch {
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
    function installWICGPolyfill(state) {
        // Skip if already installed
        if ('navigate' in window) {
            return;
        }
        // window.navigate(dir)
        window.navigate = function (dir) {
            const direction = directionByName[dir];
            if (direction) {
                moveInDirection(direction, null, state);
            }
        };
        // Element.prototype.spatialNavigationSearch(dir, options)
        if (!Element.prototype.spatialNavigationSearch) {
            Element.prototype.spatialNavigationSearch = function (dir, options = {}) {
                const direction = directionByName[dir];
                if (!direction)
                    return null;
                // Cast 'this' to HTMLElement because focusableElements contains HTMLElements
                const el = this;
                const index = state.focusableElements.indexOf(el);
                if (index === -1)
                    return null;
                const candidate = findDirectionalCandidate(index, direction, state);
                if (!candidate && window.flutterSpatialNavDebug) {
                    console.log(`[SpatialNav] spatialNavigationSearch: No candidate found for ${direction.name} from element`, el);
                }
                return candidate?.data.element ?? null;
            };
        }
        // Element.prototype.focusableAreas(options)
        if (!Element.prototype.focusableAreas) {
            const selector = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';
            Element.prototype.focusableAreas = function (options = { mode: 'visible' }) {
                // Explicitly cast the Array.from result to Element[]
                const all = Array.from(this.querySelectorAll(selector));
                if (options.mode === 'all')
                    return all;
                return all.filter(el => {
                    const style = window.getComputedStyle(el);
                    if (style.visibility === 'hidden' || style.display === 'none')
                        return false;
                    const rect = el.getBoundingClientRect();
                    return rect.width > 0 && rect.height > 0;
                });
            };
        }
        // Element.prototype.getSpatialNavigationContainer()
        if (!Element.prototype.getSpatialNavigationContainer) {
            Element.prototype.getSpatialNavigationContainer = function () {
                let current = this;
                while (current && current !== document.documentElement) {
                    if (current.hasAttribute('data-focus-group'))
                        return current;
                    const style = window.getComputedStyle(current);
                    const overflow = (style.overflow + style.overflowX + style.overflowY).toLowerCase();
                    if (overflow.includes('auto') || overflow.includes('scroll'))
                        return current;
                    current = current.parentElement;
                }
                return document.documentElement;
            };
        }
        console.log('[SpatialNav] WICG polyfill installed');
    }
    // Enable debug logging by default for development
    window.flutterSpatialNavDebug = true;
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
        console.log(`[SpatialNav DEBUG] __SPATIAL_NAV_HANDLERS_ATTACHED__: ${window.__SPATIAL_NAV_HANDLERS_ATTACHED__}`);
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
        });
        // 5. Setup visual overlay
        ensureStyles();
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
        window.showSpatialNavOverlay = (element) => showOverlay(element, state);
        // Legacy Flutter names (deprecated, for backwards compatibility)
        window.flutterFocusState = state;
        window.flutterShowOverlay = (element) => showOverlay(element, state);
        // 14. Handle initial focus
        // Don't auto-focus initial element - wait for user navigation from app
        // This prevents ghost overlay from appearing before user enters web content
        showOverlay(null, state);
        // 15. Mark state as initialized
        state.initialized = true;
        console.log('[SpatialNav] Initialization complete');
        const suppressOverlay = (reason) => {
            state.overlaySuppressed = true;
            if (state.updateTimer) {
                cancelAnimationFrame(state.updateTimer);
                state.updateTimer = null;
            }
            hideOverlay(state);
            hidePreviewElements(state);
            if (window.flutterSpatialNavDebug) {
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
                    ensureStyles();
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
            }
            else {
                console.log('[SpatialNav] No re-initialization needed, DOM intact');
            }
        });
    })();

})();
//# sourceMappingURL=spatial-navigation.debug.js.map
