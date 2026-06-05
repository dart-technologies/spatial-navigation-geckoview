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
import { createLogger, DEBUG } from '../utils/logger';

const log = createLogger('Overlay');

/**
 * Returns true when build-time DEBUG is on or runtime opt-in is set.
 *
 * The runtime check is gated on the build-time `DEBUG` constant so that
 * production bundles cannot be flipped into debug mode by a malicious
 * page setting `window.SPATIAL_NAV_DEBUG = true`. Debug mode exposes
 * runtime labels, a HUD, and focus element descriptions — not sensitive
 * in isolation, but a page under attack should not be able to enumerate
 * overlay state regardless.
 */
function isDebugActive(): boolean {
    if (DEBUG) return true;
    return false;
}

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
export function ensureStyles(_config: SpatialNavConfig): void {
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
    // Decorative — focus is communicated via the actual focused element. The
    // overlay is purely visual chrome and should NOT be announced by AT.
    host.setAttribute('role', 'presentation');
    host.setAttribute('aria-hidden', 'true');
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
        log.error('failed to get overlay reference from shadow DOM');
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
    /* c8 ignore next */ // dead under tsx (isDebugActive() returns true); production bundles fold this to a literal early return
    if (!isDebugActive()) {
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

    /* c8 ignore next */ // dead under tsx (isDebugActive() returns true); production bundles fold this to a literal early return
    if (!isDebugActive()) {
        hud.style.display = 'none';
        return;
    }

    const runtime = state.runtime ? formatRuntimeLabel(state.runtime) : 'unknown';
    const suppressed = state.overlaySuppressed ? 'suppressed' : 'active';
    hud.textContent = `SpatialNav · ${runtime} · ${suppressed}`;
    const safe = Math.max(0, state.config?.safeAreaMargin ?? 0);
    hud.style.left = safe + 8 + 'px';
    hud.style.top = safe + 8 + 'px';
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

    /* c8 ignore next */ // dead under tsx (isDebugActive() returns true); production bundles fold this to a literal early return
    if (!isDebugActive()) {
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
 * Clamp a parsed integer channel to [0, 255]. NaN becomes the fallback.
 *
 * Centralizing this guarantees every RGB component we interpolate into CSS
 * is a structurally-inert integer — template concatenation cannot escape
 * the declaration because the only characters emitted are digits.
 */
function clampByte(n: number, fallback: number): number {
    if (!Number.isFinite(n)) return fallback;
    return Math.max(0, Math.min(255, Math.round(n)));
}

/**
 * Parse a color string to RGB. Accepts:
 *   - `#rgb` / `#rrggbb` hex
 *   - `rgb(r, g, b)` / `rgba(r, g, b, a)`
 *   - `"r, g, b"` comma-separated triple (the format used for `disabledColor`)
 *
 * The return value is three validated integers, so callers interpolating
 * `${rgb.r}` into a CSS template cannot leak attacker-controlled characters.
 */
function parseColor(color: string | undefined, fallback: RGB = { r: 21, g: 101, b: 192 }): RGB {
    if (!color || typeof color !== 'string') {
        return fallback;
    }

    if (color.startsWith('#')) {
        const hex = color.slice(1);
        if (hex.length === 3) {
            return {
                r: clampByte(parseInt(hex[0] + hex[0], 16), fallback.r),
                g: clampByte(parseInt(hex[1] + hex[1], 16), fallback.g),
                b: clampByte(parseInt(hex[2] + hex[2], 16), fallback.b),
            };
        } else if (hex.length === 6) {
            return {
                r: clampByte(parseInt(hex.slice(0, 2), 16), fallback.r),
                g: clampByte(parseInt(hex.slice(2, 4), 16), fallback.g),
                b: clampByte(parseInt(hex.slice(4, 6), 16), fallback.b),
            };
        }
        return fallback;
    }

    const rgbMatch = color.match(/^\s*rgba?\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    if (rgbMatch) {
        return {
            r: clampByte(parseInt(rgbMatch[1], 10), fallback.r),
            g: clampByte(parseInt(rgbMatch[2], 10), fallback.g),
            b: clampByte(parseInt(rgbMatch[3], 10), fallback.b),
        };
    }

    // "r, g, b" comma-separated triple — the historical `disabledColor` format.
    const tripleMatch = color.match(/^\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*$/);
    if (tripleMatch) {
        return {
            r: clampByte(parseInt(tripleMatch[1], 10), fallback.r),
            g: clampByte(parseInt(tripleMatch[2], 10), fallback.g),
            b: clampByte(parseInt(tripleMatch[3], 10), fallback.b),
        };
    }

    return fallback;
}

/**
 * Generate Shadow DOM CSS for overlay and previews.
 *
 * @internal — exported for tests only. The adversarial test in
 * `__tests__/overlay-css.test.ts` exercises the CSS-injection guard on
 * `disabledColor` and friends.
 */
export function generateShadowCSS(config: SpatialNavConfig): string {
    let rgb = parseColor(config.color);

    // Auto-adjust for dark mode
    const isDarkMode = window.matchMedia?.('(prefers-color-scheme: dark)').matches;

    if (isDarkMode) {
        const luminance = (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;
        if (luminance < 0.5) {
            rgb = {
                r: Math.min(255, Math.round(rgb.r * 1.3)),
                g: Math.min(255, Math.round(rgb.g * 1.3)),
                b: Math.min(255, Math.round(rgb.b * 1.3)),
            };
        }
    }

    const colorBase = `${rgb.r}, ${rgb.g}, ${rgb.b}`;
    const overlayZIndex = config.overlayZIndex || 2147483646;
    const previewZIndex = overlayZIndex - 1;
    const arrowScale = config.arrowScale || 1.0;
    const arrowWidth = Math.round(8 * arrowScale);
    const arrowLength = Math.round(12 * arrowScale);
    // Parse `disabledColor` through the same validator as `color` so attacker-
    // controlled CSS cannot break out of the `:host` declaration. The parser
    // returns three integers; concatenating them is structurally safe.
    const disabledRGB = parseColor(config.disabledColor, { r: 128, g: 128, b: 128 });
    const disabledColor = `${disabledRGB.r}, ${disabledRGB.g}, ${disabledRGB.b}`;

    return [
        ':host {',
        `  --sn-focus-rgb: ${colorBase};`,
        `  --sn-disabled-rgb: ${disabledColor};`,
        `  --arrow-width: ${arrowWidth}px;`,
        `  --arrow-length: ${arrowLength}px;`,
        `  --sn-scrim-alpha: ${config.overlayScrimOpacity};`,
        `  --sn-glow-alpha: ${config.overlayGlowOpacity};`,
        `  --sn-glow-blur: ${config.overlayGlowBlur}px;`,
        `  --sn-inner-glow-alpha: ${config.overlayInnerGlowOpacity};`,
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
        // Position properties (left/top/width/height/border-radius) are
        // NOT transitioned: every position write happens during either
        // a navigation move (jumps to a new focusable) or scroll-
        // tracking (page smooth-scrolls, ring must follow 1:1). In
        // both cases the apparent motion is dominated by the page or
        // the focus jump, NOT by an easing curve — adding a 140ms
        // position transition produced a visible "ring slides off and
        // returns to settle" lag against the actual element motion.
        // Opacity + transform stay transitioned so fade-in / fade-out
        // and the show-scale pop-in remain smooth.
        '  transition: opacity 0.12s ease-out, transform 0.12s ease-out;',
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
        // `.snap` is applied for one frame by `showOverlay` when the
        // new position is a big jump (cross-viewport navigation). The
        // overlay snaps to the new coords without animating through
        // the empty intervening space, then the transition is
        // restored for subsequent scroll-tracking updates.
        `#${focusOverlayId}.snap {`,
        '  transition: none !important;',
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
        '}',
        // Visibility gate — when `visibilityMode === 'hardware-nav-only'`,
        // hide the entire shadow subtree (ring + previews + label + HUD)
        // by default and reveal only when the host writes
        // `data-modality="hardware-nav" data-ring="visible"` on
        // `#spatnav-focus-host`. The host is responsible for writing
        // the attributes; the wrapper (e.g. `FocusStyleManager`) does
        // this from its touch-aware state machine. Default-hidden so a
        // missing attribute keeps the overlay invisible — fail-safe.
        ...(config.visibilityMode === 'hardware-nav-only'
            ? [
                  ':host {',
                  '  opacity: 0;',
                  '  transition: opacity 220ms cubic-bezier(0.2, 0, 0, 1);',
                  '}',
                  ':host([data-modality="hardware-nav"][data-ring="visible"]) {',
                  '  opacity: 1;',
                  '}',
                  '@media (prefers-reduced-motion: reduce) {',
                  '  :host { transition: none; }',
                  '}',
              ]
            : []),
    ].join('\n');
}

/**
 * Position and show the focus overlay on an element.
 * If element is null, hides the overlay.
 */
export function showOverlay(element: HTMLElement | null, state: SpatialNavState, pulse = false): void {
    if (!state.overlay || !element) {
        // [diag] log.info survives the debug bundle. Switch the plugin
        // asset bundle to spatial_navigation.debug.js to capture these
        // via adb logcat | grep SpatialNav while debugging the
        // "ring vanishes mid-scroll" bug.
        log.info('showOverlay(null) — clearing visible class', {
            hasOverlay: !!state.overlay,
            hasElement: !!element,
            overlaySuppressed: state.overlaySuppressed,
        });
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

    // [diag] Snapshot of the inputs to the position-write inlined in
    // the message string — Gecko's console pipe stringifies the data
    // object as `[object Object]`, hiding the values when read via
    // adb logcat. The inline form survives the pipe.
    const tag = element.tagName.toLowerCase() + (element.id ? '#' + element.id : '');
    log.info(
        `showOverlay(target=${tag}) rect=[L=${rect.left.toFixed(1)} T=${rect.top.toFixed(1)} R=${rect.right.toFixed(1)} B=${rect.bottom.toFixed(1)}] W×H=${rect.width.toFixed(1)}×${rect.height.toFixed(1)} VP=${window.innerWidth}×${window.innerHeight} scrollY=${window.scrollY} prev=(${overlay.style.left || '?'},${overlay.style.top || '?'}) wasVisible=${overlay.classList.contains('visible')} wasSnap=${overlay.classList.contains('snap')}`
    );

    // Match element's border-radius
    const computed = window.getComputedStyle(element);
    const borderRadius = computed.borderRadius || '4px';
    const effectiveRadius = borderRadius && borderRadius !== '0px' ? borderRadius : '8px';

    const config = state.config;
    const outlineOffset = config.outlineOffset || 3;
    const outlineWidth = config.outlineWidth || 3;
    // The overlay used to inset by `outlineWidth + outlineOffset + 2 +
    // safeAreaMargin`, which produced visibly-short rings around content
    // touching the viewport edge — a hero image flush against the left
    // side rendered with a 20px gap on its left, looking like the
    // outline was cropped mid-stroke. The new policy: clamp ONLY to
    // keep the outline stroke itself visible (outlineWidth + outlineOffset
    // pixels can extend outside the viewport before the stroke vanishes).
    // `safeAreaMargin` is intentionally NOT applied to the ring — it
    // remains a floating-UI inset for chevrons / labels only. Edge-flush
    // content now renders edge-flush rings, matching user perception.
    const outlineExtent = outlineWidth + outlineOffset;

    log.debug(`overlay positioned on ${element.tagName.toLowerCase()}${element.id ? '#' + element.id : ''}`, {
        L: rect.left.toFixed(1),
        T: rect.top.toFixed(1),
        W: rect.width.toFixed(1),
        H: rect.height.toFixed(1),
    });

    // Clamp only enough to keep the outline visible. CSS `outline` paints
    // outside the box, so the stroke can extend up to `outlineExtent` px
    // past the viewport edge and still partially render. Clamping the
    // box position by `-outlineExtent` keeps a sliver visible at the
    // hard edge case without insetting away from edge-flush content.
    const clampedLeft = Math.max(-outlineExtent, rect.left);
    const clampedTop = Math.max(-outlineExtent, rect.top);
    const clampedRight = Math.min(window.innerWidth + outlineExtent, rect.right);
    const clampedBottom = Math.min(window.innerHeight + outlineExtent, rect.bottom);

    // If the clamped box has non-positive dimensions, the focused
    // element is fully outside the viewport (mid-scroll into an
    // off-screen navigation target, or page scrolled past the focused
    // element while focus stayed put).
    //
    // Earlier patches tried to handle this by either letting the
    // negative dimensions produce a CSS 0×0 box (invisible) or
    // explicitly removing the `visible` class. Both produced the
    // user-reported "focus ring vanishes after viewport shift" bug
    // because the ring abruptly disappeared mid-scroll.
    //
    // The correct behaviour is to keep the overlay rendered at the
    // element's REAL viewport-space coordinates (which may be off-
    // screen) so the browser clips it naturally. As the page scrolls,
    // the overlay tracks the element off-screen and back on the same
    // motion path — the user perceives a single smooth slide instead
    // of a vanish/reappear.
    const fullyOffViewport = clampedRight <= clampedLeft || clampedBottom <= clampedTop;
    const renderLeft = fullyOffViewport ? rect.left : clampedLeft;
    const renderTop = fullyOffViewport ? rect.top : clampedTop;
    const renderWidth = fullyOffViewport ? Math.max(rect.width, 1) : clampedRight - clampedLeft;
    const renderHeight = fullyOffViewport ? Math.max(rect.height, 1) : clampedBottom - clampedTop;

    if (fullyOffViewport) {
        // [diag] Path matters: fully-off-viewport elements used to be
        // hidden which produced the user-reported vanish. We now render
        // at raw rect coords and let the browser clip.
        log.info('showOverlay: fully-off-viewport — render at raw rect (browser clips)', {
            renderLeft: renderLeft.toFixed(1),
            renderTop: renderTop.toFixed(1),
            renderWidth: renderWidth.toFixed(1),
            renderHeight: renderHeight.toFixed(1),
            direction:
                rect.top > window.innerHeight
                    ? 'below'
                    : rect.bottom < 0
                      ? 'above'
                      : rect.left > window.innerWidth
                        ? 'right'
                        : 'left',
        });
    }

    // Big position jumps (cross-viewport navigation, e.g. user pressed
    // Down on the last visible focusable and we navigated to an
    // off-screen target via pass-2 scoring) should NOT animate the
    // overlay through the empty intervening space. Detect a big jump
    // by comparing the new top/left against the previous render and
    // snap (disable transition for one frame) when the delta exceeds
    // a viewport-derived threshold. Within-viewport nudges still
    // animate smoothly via the default CSS transition.
    //
    // IMPORTANT: capture `overlayWasHidden` BEFORE adding the `visible`
    // class — re-entering visibility from a hidden state is always a
    // snap because there's no meaningful previous render to animate
    // from. Also snap whenever we cross the in-viewport ↔ off-viewport
    // threshold — the apparent motion of the overlay is dominated by
    // the page scroll, not by an easing curve.
    const SNAP_THRESHOLD_PX = 200;
    const prevLeft = parseFloat(overlay.style.left || '0');
    const prevTop = parseFloat(overlay.style.top || '0');
    const overlayWasHidden = !overlay.classList.contains('visible');
    const jumped =
        overlayWasHidden ||
        fullyOffViewport ||
        Math.abs(renderLeft - prevLeft) > SNAP_THRESHOLD_PX ||
        Math.abs(renderTop - prevTop) > SNAP_THRESHOLD_PX;
    if (jumped) {
        const reason = overlayWasHidden
            ? 'wasHidden'
            : fullyOffViewport
              ? 'fullyOffViewport'
              : `delta>${SNAP_THRESHOLD_PX}px`;
        log.info(
            `showOverlay: snap applied (reason=${reason}, dL=${Math.abs(renderLeft - prevLeft).toFixed(1)}, dT=${Math.abs(renderTop - prevTop).toFixed(1)})`
        );
        overlay.classList.add('snap');
        // Re-enable the transition on the next frame after the new
        // position has been committed. Using TWO rAF ticks ensures the
        // browser has computed layout with `transition: none` before
        // we restore the easing-based transition.
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                overlay.classList.remove('snap');
            });
        });
    }

    overlay.style.display = 'block';
    overlay.classList.add('visible');

    overlay.style.left = renderLeft + 'px';
    overlay.style.top = renderTop + 'px';
    overlay.style.width = renderWidth + 'px';
    overlay.style.height = renderHeight + 'px';
    overlay.style.borderRadius = effectiveRadius;

    updateDebugHud(state);
    updateFocusLabel(state, element, {
        left: renderLeft,
        top: renderTop,
        width: renderWidth,
        height: renderHeight,
    });

    // Remove native focus outline
    try {
        element.style.setProperty('outline', 'none', 'important');
        element.style.setProperty('box-shadow', 'none', 'important');
    } catch {
        // ignore
    }

    // The `.pulse` keyframe animation hardcodes the legacy amber
    // `rgba(255, 193, 7, …)` fallback and clashes with the
    // Material-Blue-800 default — gated on `enableFocusPulse` so hosts
    // that customise their ring colour can opt back in.
    if (pulse && state.config.enableFocusPulse) {
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

                // Use the same edge-flush clamp policy as the main path
                // (see comment in `showOverlay` above for rationale).
                const outlineOffset = state.config.outlineOffset || 3;
                const outlineWidth = state.config.outlineWidth || 3;
                const outlineExtent = outlineWidth + outlineOffset;

                const left = Math.max(-outlineExtent, newRect.left);
                const top = Math.max(-outlineExtent, newRect.top);
                const right = Math.min(window.innerWidth + outlineExtent, newRect.right);
                const bottom = Math.min(window.innerHeight + outlineExtent, newRect.bottom);

                overlay.style.left = left + 'px';
                overlay.style.top = top + 'px';
                overlay.style.width = right - left + 'px';
                overlay.style.height = bottom - top + 'px';
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
    // [diag] Every code path that removes the `visible` class lands here
    // OR in `showOverlay(null)`. If you're chasing a "ring vanishes"
    // bug, the call site appears just above this line in the stack.
    log.info('hideOverlay() — removing visible class', {
        wasVisible: state.overlay?.classList.contains('visible'),
        overlaySuppressed: state.overlaySuppressed,
        stack: new Error('hideOverlay call site').stack?.split('\n').slice(1, 4).join(' | '),
    });
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
