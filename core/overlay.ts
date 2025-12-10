/**
 * Overlay management for GeckoView Spatial Navigation System
 *
 * Creates and manages Shadow DOM overlay for visual focus indicators.
 * Includes main focus overlay and directional preview elements.
 */

import type { SpatialNavConfig } from './config';
import type { SpatialNavState } from './state';
import { calculateVisualRect } from './geometry';
import { formatRuntimeLabel } from '../utils/runtime';

// Constants
const styleId = 'spatnav-focus-styles';
const overlayHostId = 'spatnav-focus-host';
const focusOverlayId = 'spatnav-focus-overlay';
const overlayLabelId = 'spatnav-focus-label';
const debugHudId = 'spatnav-debug-hud';
const themeAttr = 'data-spatnav-theme';
const runtimeAttr = 'data-spatnav-runtime';

interface RGB {
    r: number;
    g: number;
    b: number;
}

/**
 * Ensure CSS styles are injected into document head.
 * Removes default focus outlines since Shadow DOM provides visual indicator.
 */
export function ensureStyles(config: SpatialNavConfig): void {
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
export function ensureOverlay(config: SpatialNavConfig, state: SpatialNavState): void {
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
        state.overlay = overlayRef as HTMLElement;
        updateRuntimeLabel(state);
        updateDebugHud(state);
    } else {
        console.error('[SpatialNav] ❌ Failed to get overlay reference from shadow DOM!');
    }
    if (host.shadowRoot) {
        const previewRef = host.shadowRoot.getElementById('focus-preview-layer');
        if (previewRef) {
            state.previewLayer = previewRef as HTMLElement;
        }
    }
    state.overlayHost = host;
}

function updateRuntimeLabel(state: SpatialNavState): void {
    if (!state.overlay) return;

    // Only show the runtime label in debug mode.
    if (!(window as { flutterSpatialNavDebug?: boolean }).flutterSpatialNavDebug) {
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

function updateDebugHud(state: SpatialNavState): void {
    const shadow = state.overlayHost?.shadowRoot;
    if (!shadow) return;

    const hud = shadow.getElementById(debugHudId) as HTMLElement | null;
    if (!hud) return;

    const debugEnabled = !!(window as { flutterSpatialNavDebug?: boolean }).flutterSpatialNavDebug;
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

function getElementLabelText(element: HTMLElement): string {
    const ariaLabel = element.getAttribute('aria-label')?.trim();
    if (ariaLabel) return ariaLabel;

    const ariaLabelledBy = element.getAttribute('aria-labelledby')?.trim();
    if (ariaLabelledBy) {
        const ids = ariaLabelledBy.split(/\s+/).filter(Boolean);
        for (const id of ids) {
            const labelEl = document.getElementById(id);
            const text = labelEl?.textContent?.trim();
            if (text) return text;
        }
    }

    const title = element.getAttribute('title')?.trim();
    if (title) return title;

    const alt = element.getAttribute('alt')?.trim();
    if (alt) return alt;

    const text = element.textContent?.replace(/\s+/g, ' ').trim();
    if (text) return text;

    const role = element.getAttribute('role')?.trim();
    if (role) return role;

    return element.tagName.toLowerCase();
}

function truncateLabel(text: string, maxChars: number): string {
    if (!text) return '';
    const normalized = text.replace(/\s+/g, ' ').trim();
    if (normalized.length <= maxChars) return normalized;
    return normalized.slice(0, Math.max(0, maxChars - 1)).trimEnd() + '…';
}

function updateFocusLabel(
    state: SpatialNavState,
    focusedElement: HTMLElement,
    overlayRect: { left: number; top: number; width: number; height: number }
): void {
    const shadow = state.overlayHost?.shadowRoot;
    if (!shadow) return;

    const label = shadow.getElementById(overlayLabelId) as HTMLElement | null;
    if (!label) return;

    const debugEnabled = !!(window as { flutterSpatialNavDebug?: boolean }).flutterSpatialNavDebug;
    if (!debugEnabled) {
        label.classList.remove('visible');
        return;
    }

    const textEl = label.querySelector('.sn-label-text') as HTMLElement | null;
    const runtimeEl = label.querySelector('.sn-label-runtime') as HTMLElement | null;
    const suppressedEl = label.querySelector('.sn-label-suppressed') as HTMLElement | null;

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
    const maxWidth = Math.min(
        Math.max(120, overlayRect.width - inset * 2),
        Math.max(120, (window?.innerWidth ?? 0) - safe * 2 - inset * 2)
    );
    label.style.maxWidth = maxWidth + 'px';

    label.classList.add('visible');
}

/**
 * Parse color string to extract RGB components for opacity variants.
 */
function parseColor(color: string | undefined): RGB {
    const defaultRGB: RGB = { r: 255, g: 193, b: 7 };

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
        } else if (hex.length === 6) {
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
function generateShadowCSS(config: SpatialNavConfig): string {
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
export function showOverlay(element: HTMLElement | null, state: SpatialNavState, pulse = false): void {
    if (!state.overlay || !element) {
        if (state.overlay) {
            state.overlay.classList.remove('visible');
        }
        const shadow = state.overlayHost?.shadowRoot;
        const label = shadow?.getElementById(overlayLabelId) as HTMLElement | null;
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
    const effectiveRadius = borderRadius && borderRadius !== '0px' ? borderRadius : '8px';

    const config = state.config;
    const outlineOffset = config.outlineOffset || 3;
    const outlineWidth = config.outlineWidth || 3;
    const safeAreaMargin = Math.max(0, config.safeAreaMargin ?? 0);
    const totalMargin = outlineWidth + outlineOffset + 2 + safeAreaMargin; // Extra safety buffer

    const elDesc = element ? (element.tagName.toLowerCase() + (element.id ? '#' + element.id : '')) : '(null)';
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
    updateFocusLabel(state, element, { left, top, width: right - left, height: bottom - top });

    // Remove native focus outline
    try {
        element.style.setProperty('outline', 'none', 'important');
        element.style.setProperty('box-shadow', 'none', 'important');
    } catch {
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
export function hideOverlay(state: SpatialNavState): void {
    if (state.overlay) {
        state.overlay.classList.remove('visible');
    }
    if (state.activeResizeObserver) {
        state.activeResizeObserver.disconnect();
        state.activeResizeObserver = null;
    }
    const shadow = state.overlayHost?.shadowRoot;
    const label = shadow?.getElementById(overlayLabelId) as HTMLElement | null;
    if (label) {
        label.classList.remove('visible');
    }
    updateDebugHud(state);
}
