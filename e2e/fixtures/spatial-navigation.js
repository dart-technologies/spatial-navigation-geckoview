!(function () {
    'use strict';
    const e = (() => {
        if ('undefined' != typeof process) {
            const e = process.env;
            if ('production' === e?.NODE_ENV) return !1;
        }
        return !0;
    })();
    function t() {
        if ('undefined' == typeof window) return !1;
        const e = window;
        return !0 === e.SPATIAL_NAV_DEBUG || !0 === e.flutterSpatialNavDebug;
    }
    const n = { debug: 0, info: 1, warn: 2, error: 3, silent: 4 };
    let o = e ? 'debug' : 'warn';
    function r(e) {
        return n[e] >= n[o];
    }
    function i(e, t) {
        return `[SpatialNav:${e}] ${t}`;
    }
    function a(n) {
        const o = new Map();
        return {
            debug(n, o) {
                (e || t()) && r('debug');
            },
            info(e, t) {
                r('info');
            },
            warn(e, t) {
                r('warn') && (void 0 !== t ? console.warn(i(n, e), t) : console.warn(i(n, e)));
            },
            error(e, t) {
                r('error') && (void 0 !== t ? console.error(i(n, e), t) : console.error(i(n, e)));
            },
            time(n) {
                (e || t()) && o.set(n, performance.now());
            },
            timeEnd(n) {
                if (!e && !t()) return;
                const r = o.get(n);
                if (void 0 !== r) {
                    const e = performance.now() - r;
                    (o.delete(n), this.debug(`${n}: ${e.toFixed(2)}ms`));
                }
            },
            group(o) {
                (e || t()) && r('debug') && console.group(i(n, o));
            },
            groupEnd() {
                (e || t()) && r('debug') && console.groupEnd();
            },
        };
    }
    const s = a('Config'),
        l = 'undefined' != typeof window ? window : globalThis;
    function c() {
        const e = g(l.spatialNavConfig || l.flutterSpatialNavConfig || {});
        return {
            color: e.color || '#1565C0',
            outlineWidth: e.outlineWidth || 3,
            outlineOffset: e.outlineOffset || 3,
            overlayZIndex: e.overlayZIndex || 2147483646,
            arrowScale: 'number' == typeof e.arrowScale ? e.arrowScale : 1,
            disabledColor: e.disabledColor || '128, 128, 128',
            overlayTheme: 'high-contrast' === e.overlayTheme ? 'high-contrast' : 'default',
            safeAreaMargin: 'number' == typeof e.safeAreaMargin ? Math.max(0, e.safeAreaMargin) : 12,
            overlayScrimOpacity:
                'number' == typeof e.overlayScrimOpacity
                    ? Math.min(Math.max(e.overlayScrimOpacity, 0), 1)
                    : 0.06,
            overlayGlowOpacity:
                'number' == typeof e.overlayGlowOpacity
                    ? Math.min(Math.max(e.overlayGlowOpacity, 0), 1)
                    : 0.35,
            overlayGlowBlur: 'number' == typeof e.overlayGlowBlur ? Math.max(0, e.overlayGlowBlur) : 14,
            observeMutations: !1 !== e.observeMutations,
            observeScroll: !1 !== e.observeScroll,
            mutationDebounce: e.mutationDebounce || 100,
            scrollThreshold: e.scrollThreshold || 8,
            observeIntersection: !0 === e.observeIntersection,
            intersectionRootMargin: e.intersectionRootMargin || '200px',
            intersectionThreshold:
                'number' == typeof e.intersectionThreshold
                    ? Math.min(Math.max(e.intersectionThreshold, 0), 1)
                    : 0,
            autoRefocus: !1 !== e.autoRefocus,
            refocusStrategy: e.refocusStrategy || 'closest',
            iframeSupport: {
                enabled: !0 === e.iframeSupport?.enabled,
                selector: e.iframeSupport?.selector || 'iframe',
                focusMethod: e.iframeSupport?.focusMethod || 'element',
            },
            focusGroups: {
                enabled: e.focusGroups?.enabled ?? !1,
                defaultRules: e.focusGroups?.defaultRules ?? {},
                boundaryBehavior: e.focusGroups?.boundaryBehavior ?? 'exit',
            },
            traverseShadowDom: !0 === e.traverseShadowDom,
            observeVirtualContainers: !1 !== e.observeVirtualContainers,
            virtualContainerSelectors: e.virtualContainerSelectors || [
                '[data-virtualized]',
                '.ReactVirtualized__Grid',
                '.ReactVirtualized__List',
                '[data-testid="virtuoso-item-list"]',
                '.infinite-scroll-component',
                '[data-infinite-scroll]',
                'ytd-rich-grid-renderer',
                '[data-testid="primaryColumn"]',
            ],
            virtualScrollDebounce: e.virtualScrollDebounce || 150,
            enableAria: !0 === e.enableAria,
            announceNavigation: !0 === e.announceNavigation,
            announceBoundaries: !0 === e.announceBoundaries,
            verboseDescriptions: !0 === e.verboseDescriptions,
            focusTrapDetection: !0 === e.focusTrapDetection,
            frameworkAwareRefresh: !1 !== e.frameworkAwareRefresh,
            precomputeCandidates: !1 !== e.precomputeCandidates,
            precomputeCacheTimeout: e.precomputeCacheTimeout || 500,
            scoringMode: e.scoringMode || 'geometric',
            distanceFunction: e.distanceFunction || 'euclidean',
            overlapThreshold: 'number' == typeof e.overlapThreshold ? e.overlapThreshold : 0,
            gridAlignmentTolerance:
                'number' == typeof e.gridAlignmentTolerance ? e.gridAlignmentTolerance : 20,
            wrapNavigation: !0 === e.wrapNavigation,
            useCSSProperties: !1 !== e.useCSSProperties,
            minElementSize: 'number' == typeof e.minElementSize ? e.minElementSize : 1,
        };
    }
    const u = new Set(['color', 'disabledColor', 'intersectionRootMargin']),
        d = new Set([
            'outlineWidth',
            'outlineOffset',
            'overlayZIndex',
            'arrowScale',
            'safeAreaMargin',
            'overlayScrimOpacity',
            'overlayGlowOpacity',
            'overlayGlowBlur',
            'mutationDebounce',
            'scrollThreshold',
            'intersectionThreshold',
            'virtualScrollDebounce',
            'precomputeCacheTimeout',
            'overlapThreshold',
            'gridAlignmentTolerance',
            'minElementSize',
        ]),
        f = new Set([
            'observeMutations',
            'observeScroll',
            'observeIntersection',
            'autoRefocus',
            'traverseShadowDom',
            'observeVirtualContainers',
            'enableAria',
            'announceNavigation',
            'announceBoundaries',
            'verboseDescriptions',
            'focusTrapDetection',
            'frameworkAwareRefresh',
            'precomputeCandidates',
            'wrapNavigation',
            'useCSSProperties',
        ]),
        p = {
            overlayTheme: new Set(['default', 'high-contrast']),
            refocusStrategy: new Set(['closest', 'first']),
            scoringMode: new Set(['geometric', 'grid']),
            distanceFunction: new Set(['euclidean', 'manhattan', 'projected']),
        },
        m = new Set(['virtualContainerSelectors']),
        b = new Set(['iframeSupport', 'focusGroups']);
    function g(e) {
        const t = {};
        if (!e || 'object' != typeof e || Array.isArray(e)) return t;
        const n = e;
        for (const e of Object.keys(n)) {
            const o = n[e];
            if (u.has(e))
                'string' == typeof o
                    ? (t[e] = o)
                    : s.warn(`config.${e}: expected string, got ${typeof o} — ignored`);
            else if (d.has(e))
                'number' == typeof o && Number.isFinite(o)
                    ? (t[e] = o)
                    : s.warn(`config.${e}: expected finite number, got ${typeof o} — ignored`);
            else if (f.has(e))
                'boolean' == typeof o
                    ? (t[e] = o)
                    : s.warn(`config.${e}: expected boolean, got ${typeof o} — ignored`);
            else if (e in p)
                if ('string' == typeof o && p[e].has(o)) t[e] = o;
                else {
                    const t = Array.from(p[e]).join(', ');
                    s.warn(`config.${e}: must be one of [${t}] — got ${JSON.stringify(o)}, ignored`);
                }
            else
                m.has(e)
                    ? Array.isArray(o) && o.every((e) => 'string' == typeof e)
                        ? (t[e] = o)
                        : s.warn(`config.${e}: expected string[], got ${typeof o} — ignored`)
                    : b.has(e)
                      ? o && 'object' == typeof o && !Array.isArray(o)
                          ? (t[e] = o)
                          : s.warn(`config.${e}: expected object, got ${typeof o} — ignored`)
                      : s.warn(`config.${e}: unknown key — ignored`);
        }
        return t;
    }
    const h = {
            ArrowDown: { axis: 'y', sign: 1, name: 'down' },
            ArrowUp: { axis: 'y', sign: -1, name: 'up' },
            ArrowRight: { axis: 'x', sign: 1, name: 'right' },
            ArrowLeft: { axis: 'x', sign: -1, name: 'left' },
        },
        v = { down: h.ArrowDown, up: h.ArrowUp, right: h.ArrowRight, left: h.ArrowLeft },
        w = ['down', 'up', 'right', 'left'],
        y =
            'undefined' != typeof DOMRect
                ? new DOMRect(0, 0, 0, 0)
                : {
                      x: 0,
                      y: 0,
                      width: 0,
                      height: 0,
                      top: 0,
                      right: 0,
                      bottom: 0,
                      left: 0,
                      toJSON: () => ({}),
                  };
    function x(e) {
        if (!e || 'function' != typeof e.getBoundingClientRect) return y;
        try {
            return e.getBoundingClientRect();
        } catch {
            return y;
        }
    }
    function E(e) {
        let t = x(e);
        const n = e.querySelector('img, svg, video, picture, canvas');
        if (n) {
            const e = x(n);
            (e.width > t.width || e.height > t.height || e.left < t.left || e.top < t.top) && (t = e);
        }
        return t;
    }
    function S(e, t) {
        if (!e || !e.element || 'function' != typeof e.element.getBoundingClientRect) return null;
        const n = x(e.element);
        return (
            (e.left = n.left),
            (e.top = n.top),
            (e.right = n.right),
            (e.bottom = n.bottom),
            (e.width = n.width),
            (e.height = n.height),
            (e.centerX = n.left + n.width / 2),
            (e.centerY = n.top + n.height / 2),
            (e.rect = n),
            (e.scrollKey = (function (e, t) {
                if (!e || e === document.body || e === document.documentElement) return 'body';
                const n = t.scrollCache.get(e);
                if (void 0 !== n) return n;
                let o = e;
                for (; o && o !== document.body && o !== document.documentElement; ) {
                    const n = window.getComputedStyle(o),
                        r = (n.overflow + n.overflowX + n.overflowY).toLowerCase();
                    if (r.includes('auto') || r.includes('scroll')) {
                        const n =
                            o.id && o.id.length
                                ? '#' + o.id
                                : o.className && o.className.toString().trim().length
                                  ? o.tagName.toLowerCase() +
                                    '.' +
                                    o.className.toString().trim().split(/\s+/).slice(0, 2).join('.')
                                  : o.tagName.toLowerCase();
                        return (t.scrollCache.set(e, n), n);
                    }
                    o = o.parentElement;
                }
                return (t.scrollCache.set(e, 'body'), 'body');
            })(e.element, t)),
            e
        );
    }
    function A(e, t) {
        if (!e) return !1;
        const n = Math.max(0, t || 0),
            o = e.right >= -n && e.left <= window.innerWidth + n,
            r = e.bottom >= -n && e.top <= window.innerHeight + n;
        return o && r;
    }
    function M(e) {
        return 'webextension' === e.mode
            ? `WebExtension (${e.canSendMessage ? 'bridge:on' : 'bridge:off'})`
            : 'Injected (no bridge)';
    }
    const T = a('Overlay');
    function C() {
        return (
            !!e ||
            ('undefined' != typeof window &&
                (!0 === window.SPATIAL_NAV_DEBUG || !0 === window.flutterSpatialNavDebug))
        );
    }
    const O = 'spatnav-focus-styles',
        I = 'spatnav-focus-host',
        k = 'spatnav-focus-overlay',
        _ = 'spatnav-focus-label',
        N = 'spatnav-debug-hud',
        $ = 'data-spatnav-theme',
        R = 'data-spatnav-runtime';
    function F(e) {
        let t = document.getElementById(O);
        (t || ((t = document.createElement('style')), (t.id = O), document.head.appendChild(t)),
            (t.textContent =
                '\n/* GeckoView Spatial Nav: Shadow DOM overlay provides focus indicator */\n*:focus,\n*:focus-visible,\n*:focus-within,\na:focus, a:focus-visible,\na:link:focus, a:visited:focus, a:hover:focus, a:active:focus,\nbutton:focus, button:focus-visible,\ninput:focus, input:focus-visible,\nselect:focus, textarea:focus,\n[tabindex]:focus, [tabindex]:focus-visible,\n[contenteditable]:focus,\nbody *:focus, body *:focus-visible {\n    outline: none !important;\n    outline-width: 0 !important;\n    outline-style: none !important;\n    outline-color: transparent !important;\n    box-shadow: none !important;\n    -webkit-focus-ring-color: transparent !important;\n    -webkit-tap-highlight-color: transparent !important;\n}\n/* Also suppress Firefox-specific focus rings */\n*::-moz-focus-inner {\n    border: 0 !important;\n}\n\n/* Spatial navigation press feedback */\n.spatnav-pressed {\n    transform: scale(0.97) !important;\n    transition: transform 0.09s ease-out !important;\n    will-change: transform;\n}\n@media (prefers-reduced-motion: reduce) {\n    .spatnav-pressed {\n        transition: none !important;\n        transform: none !important;\n    }\n}\n'));
    }
    function P(e, t) {
        if (!document.body) return;
        let n = document.getElementById(I);
        (n && n.remove(),
            (n = document.createElement('div')),
            (n.id = I),
            (n.style.cssText = `position: fixed; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; z-index: ${e.overlayZIndex || 2147483646};`),
            n.setAttribute($, e.overlayTheme || 'default'),
            n.setAttribute('role', 'presentation'),
            n.setAttribute('aria-hidden', 'true'),
            document.body.appendChild(n));
        const o = n.attachShadow({ mode: 'open' }),
            r = document.createElement('style');
        ((r.textContent = (function (e) {
            let t = (function (e) {
                const t = { r: 21, g: 101, b: 192 };
                if (!e || 'string' != typeof e) return t;
                if (e.startsWith('#')) {
                    const t = e.slice(1);
                    if (3 === t.length)
                        return {
                            r: parseInt(t[0] + t[0], 16),
                            g: parseInt(t[1] + t[1], 16),
                            b: parseInt(t[2] + t[2], 16),
                        };
                    if (6 === t.length)
                        return {
                            r: parseInt(t.slice(0, 2), 16),
                            g: parseInt(t.slice(2, 4), 16),
                            b: parseInt(t.slice(4, 6), 16),
                        };
                }
                const n = e.match(/rgba?\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
                return n ? { r: parseInt(n[1], 10), g: parseInt(n[2], 10), b: parseInt(n[3], 10) } : t;
            })(e.color);
            const n = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
            n &&
                (0.299 * t.r + 0.587 * t.g + 0.114 * t.b) / 255 < 0.5 &&
                (t = {
                    r: Math.min(255, Math.round(1.3 * t.r)),
                    g: Math.min(255, Math.round(1.3 * t.g)),
                    b: Math.min(255, Math.round(1.3 * t.b)),
                });
            const o = `${t.r}, ${t.g}, ${t.b}`,
                r = e.overlayZIndex || 2147483646,
                i = r - 1,
                a = e.arrowScale || 1,
                s = Math.round(8 * a),
                l = Math.round(12 * a);
            return [
                ':host {',
                `  --sn-focus-rgb: ${o};`,
                `  --sn-disabled-rgb: ${e.disabledColor || '128, 128, 128'};`,
                `  --arrow-width: ${s}px;`,
                `  --arrow-length: ${l}px;`,
                `  --sn-scrim-alpha: ${e.overlayScrimOpacity};`,
                `  --sn-glow-alpha: ${e.overlayGlowOpacity};`,
                `  --sn-glow-blur: ${e.overlayGlowBlur}px;`,
                '  --sn-inner-glow-alpha: 0.16;',
                '  --sn-label-bg: rgba(0, 0, 0, 0.62);',
                '  --sn-label-fg: rgba(255, 255, 255, 0.92);',
                '  --sn-label-muted: rgba(255, 255, 255, 0.72);',
                '}',
                `:host([${$}="high-contrast"]) {`,
                '  --sn-scrim-alpha: 0.14;',
                '  --sn-glow-alpha: 0.55;',
                '  --sn-glow-blur: 18px;',
                '  --sn-inner-glow-alpha: 0.22;',
                '  --sn-label-bg: rgba(0, 0, 0, 0.78);',
                '}',
                `#${k} {`,
                '  position: fixed;',
                '  pointer-events: none;',
                '  overflow: visible;',
                '  will-change: left, top, width, height, border-radius, opacity, transform;',
                '  transition: left 0.14s cubic-bezier(0.2, 0.0, 0.2, 1), top 0.14s cubic-bezier(0.2, 0.0, 0.2, 1), width 0.14s cubic-bezier(0.2, 0.0, 0.2, 1), height 0.14s cubic-bezier(0.2, 0.0, 0.2, 1), border-radius 0.14s cubic-bezier(0.2, 0.0, 0.2, 1), opacity 0.12s ease-out, transform 0.12s ease-out;',
                `  outline: ${e.outlineWidth}px solid rgb(var(--sn-focus-rgb));`,
                `  outline-offset: ${e.outlineOffset}px;`,
                '  background-color: rgba(var(--sn-focus-rgb), var(--sn-scrim-alpha));',
                '  box-shadow: 0 0 var(--sn-glow-blur) rgba(var(--sn-focus-rgb), var(--sn-glow-alpha)), inset 0 0 0 1px rgba(var(--sn-focus-rgb), var(--sn-inner-glow-alpha));',
                '  border-radius: 8px;',
                '  box-sizing: border-box;',
                `  z-index: ${r};`,
                '  opacity: 0;',
                '}',
                `#${_} {`,
                '  position: fixed;',
                '  pointer-events: none;',
                `  z-index: ${r + 2};`,
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
                `#${_}.visible {`,
                '  opacity: 1;',
                '}',
                `#${_} .sn-label-text {`,
                '  min-width: 0;',
                '  overflow: hidden;',
                '  text-overflow: ellipsis;',
                '  white-space: nowrap;',
                '}',
                `#${_} .sn-label-badge {`,
                '  padding: 1px 6px;',
                '  border-radius: 999px;',
                '  font: 10px/1.2 ui-monospace, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;',
                '  background: rgba(255, 255, 255, 0.14);',
                '  color: var(--sn-label-muted);',
                '  white-space: nowrap;',
                '}',
                `#${_} .sn-label-suppressed {`,
                '  background: rgba(255, 64, 64, 0.22);',
                '  color: rgba(255, 220, 220, 0.95);',
                '}',
                `#${N} {`,
                '  position: fixed;',
                '  pointer-events: none;',
                '  display: none;',
                `  z-index: ${r + 3};`,
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
                `#${k}.visible {`,
                '  opacity: 1;',
                '}',
                `#${k}.click-animate {`,
                '  transform: scale(0.96) !important;',
                '  transition: transform 0.09s ease-out !important;',
                '}',
                '#focus-preview-layer {',
                '  position: fixed;',
                '  inset: 0;',
                '  pointer-events: none;',
                `  z-index: ${i};`,
                '}',
                '.focus-preview {',
                '  position: fixed;',
                '  pointer-events: none;',
                '  border: 1px solid rgba(var(--sn-focus-rgb), 0.4);',
                '  background-color: rgba(var(--sn-focus-rgb), 0.10);',
                '  border-radius: 999px;',
                '  opacity: 0;',
                '  transform: translate3d(0, 0, 0);',
                '  transition: opacity 0.16s cubic-bezier(0.4, 0.0, 0.2, 1), transform 0.16s cubic-bezier(0.4, 0.0, 0.2, 1);',
                '}',
                '.focus-preview.show {',
                '  opacity: 0.92;',
                '}',
                '.focus-preview.disabled {',
                '  border: 2px solid rgba(var(--sn-disabled-rgb), 0.7);',
                '  background-color: rgba(var(--sn-disabled-rgb), 0.2);',
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
                `#${k}.pulse {`,
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
                '  border-top: var(--arrow-width) solid transparent;',
                '  border-bottom: var(--arrow-width) solid transparent;',
                '  border-left: var(--arrow-length) solid rgba(var(--sn-focus-rgb), 0.95);',
                '}',
                '.focus-preview-left .focus-preview-arrow {',
                '  top: 50%;',
                '  left: 50%;',
                '  transform: translate(-50%, -50%);',
                '  border-top: var(--arrow-width) solid transparent;',
                '  border-bottom: var(--arrow-width) solid transparent;',
                '  border-right: var(--arrow-length) solid rgba(var(--sn-focus-rgb), 0.95);',
                '}',
                '.focus-preview-down .focus-preview-arrow {',
                '  top: 50%;',
                '  left: 50%;',
                '  transform: translate(-50%, -50%);',
                '  border-left: var(--arrow-width) solid transparent;',
                '  border-right: var(--arrow-width) solid transparent;',
                '  border-top: var(--arrow-length) solid rgba(var(--sn-focus-rgb), 0.95);',
                '}',
                '.focus-preview-up .focus-preview-arrow {',
                '  top: 50%;',
                '  left: 50%;',
                '  transform: translate(-50%, -50%);',
                '  border-left: var(--arrow-width) solid transparent;',
                '  border-right: var(--arrow-width) solid transparent;',
                '  border-bottom: var(--arrow-length) solid rgba(var(--sn-focus-rgb), 0.95);',
                '}',
                '@media (prefers-reduced-motion: reduce) {',
                `  #${k},`,
                '  .focus-preview,',
                `  #${_},`,
                '  .focus-preview-arrow {',
                '    transition: none;',
                '  }',
                `  #${k}.pulse {`,
                '    animation: none;',
                '  }',
                '}',
            ].join('\n');
        })(e)),
            o.appendChild(r));
        const i = document.createElement('div');
        ((i.id = 'focus-preview-layer'), o.appendChild(i));
        const a = document.createElement('div');
        ((a.id = k),
            (a.style.display = 'none'),
            (a.style.transform = 'translate3d(0, 0, 0)'),
            o.appendChild(a));
        const s = document.createElement('div');
        s.id = _;
        const l = document.createElement('span');
        l.className = 'sn-label-text';
        const c = document.createElement('span');
        c.className = 'sn-label-badge sn-label-runtime';
        const u = document.createElement('span');
        ((u.className = 'sn-label-badge sn-label-suppressed'),
            s.appendChild(l),
            s.appendChild(c),
            s.appendChild(u),
            o.appendChild(s));
        const d = document.createElement('div');
        ((d.id = N), (d.style.display = 'none'), o.appendChild(d));
        const f = n.shadowRoot?.getElementById(k);
        if (
            (f
                ? ((t.overlay = f),
                  (function (e) {
                      if (!e.overlay) return;
                      if (!C()) return void e.overlay.removeAttribute(R);
                      const t = e.runtime;
                      if (!t) return void e.overlay.removeAttribute(R);
                      const n = M(t);
                      e.overlay.setAttribute(R, n);
                  })(t),
                  D(t))
                : T.error('failed to get overlay reference from shadow DOM'),
            n.shadowRoot)
        ) {
            const e = n.shadowRoot.getElementById('focus-preview-layer');
            e && (t.previewLayer = e);
        }
        t.overlayHost = n;
    }
    function D(e) {
        const t = e.overlayHost?.shadowRoot;
        if (!t) return;
        const n = t.getElementById(N);
        if (!n) return;
        if (!C()) return void (n.style.display = 'none');
        const o = e.runtime ? M(e.runtime) : 'unknown',
            r = e.overlaySuppressed ? 'suppressed' : 'active';
        n.textContent = `SpatialNav · ${o} · ${r}`;
        const i = Math.max(0, e.config?.safeAreaMargin ?? 0);
        ((n.style.left = i + 8 + 'px'), (n.style.top = i + 8 + 'px'), (n.style.display = 'block'));
    }
    function L(e, t, n = !1) {
        if (!t.overlay || !e) {
            t.overlay && t.overlay.classList.remove('visible');
            const e = t.overlayHost?.shadowRoot,
                n = e?.getElementById(_);
            return (n && n.classList.remove('visible'), void D(t));
        }
        const o = E(e),
            r = t.overlay,
            i = window.getComputedStyle(e).borderRadius || '4px',
            a = '0px' !== i ? i : '8px',
            s = t.config,
            l = s.outlineOffset || 3,
            c = (s.outlineWidth || 3) + l + 2 + Math.max(0, s.safeAreaMargin ?? 0);
        (T.debug(`overlay positioned on ${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''}`, {
            L: o.left.toFixed(1),
            T: o.top.toFixed(1),
            W: o.width.toFixed(1),
            H: o.height.toFixed(1),
        }),
            (r.style.display = 'block'),
            r.classList.add('visible'));
        const u = Math.max(c, o.left),
            d = Math.max(c, o.top),
            f = Math.min(window.innerWidth - c, o.right),
            p = Math.min(window.innerHeight - c, o.bottom);
        ((r.style.left = u + 'px'),
            (r.style.top = d + 'px'),
            (r.style.width = f - u + 'px'),
            (r.style.height = p - d + 'px'),
            (r.style.borderRadius = a),
            D(t),
            (function (e, t, n) {
                const o = e.overlayHost?.shadowRoot;
                if (!o) return;
                const r = o.getElementById(_);
                if (!r) return;
                if (!C()) return void r.classList.remove('visible');
                const i = r.querySelector('.sn-label-text'),
                    a = r.querySelector('.sn-label-runtime'),
                    s = r.querySelector('.sn-label-suppressed'),
                    l = (function (e) {
                        const t = e.getAttribute('aria-label')?.trim();
                        if (t) return t;
                        const n = e.getAttribute('aria-labelledby')?.trim();
                        if (n) {
                            const e = n.split(/\s+/).filter(Boolean);
                            for (const t of e) {
                                const e = document.getElementById(t),
                                    n = e?.textContent?.trim();
                                if (n) return n;
                            }
                        }
                        const o = e.getAttribute('title')?.trim();
                        if (o) return o;
                        const r = e.getAttribute('alt')?.trim();
                        if (r) return r;
                        const i = e.textContent?.replace(/\s+/g, ' ').trim();
                        if (i) return i;
                        const a = e.getAttribute('role')?.trim();
                        return a || e.tagName.toLowerCase();
                    })(t),
                    c = (function (e) {
                        if (!e) return '';
                        const t = e.replace(/\s+/g, ' ').trim();
                        return t.length <= 48 ? t : t.slice(0, Math.max(0, 47)).trimEnd() + '…';
                    })(l);
                if ((i && ((i.textContent = c), i.setAttribute('title', l)), a)) {
                    const t = e.runtime ? M(e.runtime) : 'unknown';
                    ((a.textContent = t), (a.style.display = t ? '' : 'none'));
                }
                s &&
                    ((s.textContent = e.overlaySuppressed ? 'suppressed' : ''),
                    (s.style.display = e.overlaySuppressed ? '' : 'none'));
                const u = Math.max(0, e.config?.safeAreaMargin ?? 0),
                    d = Math.max(0, (window?.innerWidth ?? 0) - u - 1),
                    f = Math.max(0, (window?.innerHeight ?? 0) - u - 1),
                    p = Math.min(Math.max(u, n.left + 6), d),
                    m = Math.min(Math.max(u, n.top + 6), f);
                ((r.style.left = p + 'px'), (r.style.top = m + 'px'));
                const b = Math.min(
                    Math.max(120, n.width - 12),
                    Math.max(120, (window?.innerWidth ?? 0) - 2 * u - 12)
                );
                ((r.style.maxWidth = b + 'px'), r.classList.add('visible'));
            })(t, e, { left: u, top: d, width: f - u }));
        try {
            (e.style.setProperty('outline', 'none', 'important'),
                e.style.setProperty('box-shadow', 'none', 'important'));
        } catch {}
        if (
            (n && (r.classList.remove('pulse'), r.offsetWidth, r.classList.add('pulse')),
            t.activeResizeObserver && (t.activeResizeObserver.disconnect(), (t.activeResizeObserver = null)),
            'undefined' != typeof ResizeObserver)
        ) {
            const n = new ResizeObserver(() => {
                if (t.lastFocusedElement === e) {
                    const n = E(e),
                        o = t.config.outlineOffset || 3,
                        i = (t.config.outlineWidth || 3) + o + 2 + Math.max(0, t.config.safeAreaMargin ?? 0),
                        a = Math.max(i, n.left),
                        s = Math.max(i, n.top),
                        l = Math.min(window.innerWidth - i, n.right),
                        c = Math.min(window.innerHeight - i, n.bottom);
                    ((r.style.left = a + 'px'),
                        (r.style.top = s + 'px'),
                        (r.style.width = l - a + 'px'),
                        (r.style.height = c - s + 'px'));
                }
            });
            (n.observe(e), (t.activeResizeObserver = n));
        }
    }
    function B(e) {
        (e.overlay && e.overlay.classList.remove('visible'),
            e.activeResizeObserver && (e.activeResizeObserver.disconnect(), (e.activeResizeObserver = null)));
        const t = e.overlayHost?.shadowRoot,
            n = t?.getElementById(_);
        (n && n.classList.remove('visible'), D(e));
    }
    const q = ['up', 'down', 'left', 'right'];
    function W(e) {
        e.previewElements &&
            q.forEach(function (t) {
                const n = e.previewElements[t];
                n &&
                    n.container &&
                    ((n.container.className = 'focus-preview focus-preview-' + t),
                    (n.container.style.left = ''),
                    (n.container.style.top = ''),
                    (n.container.style.width = ''),
                    (n.container.style.height = ''),
                    n.container.removeAttribute('data-target'),
                    n.arrow && (n.arrow.style.display = ''));
            });
    }
    function z(e, t, n) {
        return Math.min(Math.max(e, t), n);
    }
    function V(e, t, n, o) {
        const r = {};
        return 'number' != typeof e || e < 0 || !o.focusables.length
            ? (q.forEach(function (e) {
                  r[e] = null;
              }),
              (o.nextTargets = r),
              r)
            : (q.forEach(function (i) {
                  const a = n[i];
                  r[i] = t(e, a, o);
              }),
              (o.nextTargets = r),
              r);
    }
    function G(e, t, n, o, r, i) {
        const a = (function (e) {
            if (!e.previewLayer) return null;
            if (!e.previewElements) {
                const t = {};
                (q.forEach(function (n) {
                    const o = document.createElement('div');
                    ((o.className = 'focus-preview focus-preview-' + n), (o.dataset.direction = n));
                    const r = document.createElement('div');
                    ((r.className = 'focus-preview-arrow'),
                        o.appendChild(r),
                        e.previewLayer.appendChild(o),
                        (t[n] = { container: o, arrow: r }));
                }),
                    (e.previewElements = t));
            }
            return e.previewElements;
        })(i);
        if (!a) return void (i.nextTargets = { up: null, down: null, left: null, right: null });
        if (!i.previewEnabled || !e)
            return (W(i), void (i.nextTargets = { up: null, down: null, left: null, right: null }));
        const s = e.getBoundingClientRect(),
            l = V(i.currentIndex, n, o, i);
        q.forEach(function (e) {
            const t = a[e];
            if (!t || !t.container) return;
            const n = l[e];
            if (!n || !n.data || !n.data.element)
                return (
                    -1 === t.container.className.indexOf('disabled') &&
                        ((t.container.className = 'focus-preview focus-preview-' + e),
                        (t.container.style.left = ''),
                        (t.container.style.top = ''),
                        (t.container.style.width = ''),
                        (t.container.style.height = ''),
                        (t.container.style.opacity = ''),
                        t.container.removeAttribute('data-target')),
                    void (t.arrow && (t.arrow.style.display = ''))
                );
            (!(function (e, t, n, o = 0) {
                if (!e || !e.container || !n) return;
                const r = Math.max(14, Math.min(26, Math.round(0.28 * Math.min(n.width, n.height)))),
                    i = Math.max(10, Math.round(0.75 * r));
                let a = n.left,
                    s = n.top;
                switch (t) {
                    case 'right':
                        ((a = n.right + i), (s = n.top + n.height / 2 - r / 2));
                        break;
                    case 'left':
                        ((a = n.left - i - r), (s = n.top + n.height / 2 - r / 2));
                        break;
                    case 'down':
                        ((a = n.left + n.width / 2 - r / 2), (s = n.bottom + i));
                        break;
                    case 'up':
                        ((a = n.left + n.width / 2 - r / 2), (s = n.top - i - r));
                }
                const l = window?.innerWidth ?? 0,
                    c = window?.innerHeight ?? 0,
                    u = Math.max(0, o || 0);
                ((a = z(a, u, Math.max(u, l - u - r))),
                    (s = z(s, u, Math.max(u, c - u - r))),
                    (e.container.style.left = a + 'px'),
                    (e.container.style.top = s + 'px'),
                    (e.container.style.width = r + 'px'),
                    (e.container.style.height = r + 'px'),
                    (e.container.style.opacity = ''),
                    (e.container.className = 'focus-preview focus-preview-' + t + ' show'),
                    e.arrow && (e.arrow.style.display = ''));
            })(t, e, s, i.config.safeAreaMargin ?? 0),
                t.container.setAttribute('data-target', r(n.data.element)));
        });
    }
    const Y = {
        parent(e) {
            const t = e.lastIndexOf('.');
            return t > 0 ? e.substring(0, t) : null;
        },
        depth: (e) => e.split('.').length,
        isDescendant: (e, t) => e.startsWith(t + '.'),
        areSiblings: (e, t) => Y.parent(e) === Y.parent(t),
        ancestors(e) {
            const t = [];
            let n = Y.parent(e);
            for (; n; ) (t.push(n), (n = Y.parent(n)));
            return t;
        },
        root(e) {
            const t = e.indexOf('.');
            return t > 0 ? e.substring(0, t) : e;
        },
        leaf(e) {
            const t = e.lastIndexOf('.');
            return t > 0 ? e.substring(t + 1) : e;
        },
    };
    class H {
        constructor(e, t, n = {}) {
            ((this.parent = null),
                (this.children = new Map()),
                (this.id = e),
                (this.element = t),
                (this.members = []),
                (this.options = {
                    boundary: n.boundary || 'exit',
                    rememberLast: !1 !== n.rememberLast,
                    enterMode: n.enterMode || 'default',
                    priority: n.priority ?? 0,
                    inheritOptions: !1 !== n.inheritOptions,
                    ...n,
                }),
                (this.lastFocused = null),
                (this._depth = Y.depth(e)));
        }
        get depth() {
            return this._depth;
        }
        get parentId() {
            return Y.parent(this.id);
        }
        get isRoot() {
            return 1 === this._depth;
        }
        getEffectiveOptions() {
            return this.options.inheritOptions && this.parent
                ? { ...this.parent.getEffectiveOptions(), ...this.options, priority: this.options.priority }
                : this.options;
        }
        setParent(e) {
            ((this.parent = e), e.children.set(this.id, this));
        }
        removeFromParent() {
            this.parent && (this.parent.children.delete(this.id), (this.parent = null));
        }
        addMember(e) {
            this.members.includes(e) || (this.members.push(e), (e.groupId = this.id));
        }
        removeMember(e) {
            const t = this.members.indexOf(e);
            (t > -1 && this.members.splice(t, 1), e.groupId === this.id && (e.groupId = null));
        }
        updateLastFocused(e) {
            if (this.members.includes(e)) {
                this.lastFocused = e;
                let t = this.parent;
                for (; t; ) {
                    if (!t.lastFocused || !document.body.contains(t.lastFocused.element)) {
                        const n = t.members.find(
                            (t) => t.element.contains(e.element) || t.element === e.element
                        );
                        n && (t.lastFocused = n);
                    }
                    t = t.parent;
                }
            }
        }
        getPreferredEntry() {
            const e = this.getEffectiveOptions();
            return 'last' === e.enterMode &&
                this.lastFocused &&
                document.body.contains(this.lastFocused.element)
                ? this.lastFocused
                : ('first' === e.enterMode || e.enterMode, this.members[0]);
        }
        getAllDescendants() {
            const e = [];
            for (const t of this.children.values()) (e.push(t), e.push(...t.getAllDescendants()));
            return e;
        }
        getAllMembers() {
            const e = [...this.members];
            for (const t of this.children.values()) e.push(...t.getAllMembers());
            return e;
        }
        findChild(e) {
            const t = this.id + '.' + e;
            return this.children.get(t) ?? null;
        }
        canExit() {
            const e = this.getEffectiveOptions();
            return 'exit' === e.boundary || 'wrap' === e.boundary;
        }
        shouldWrap() {
            return 'wrap' === this.getEffectiveOptions().boundary;
        }
    }
    function j(e) {
        if (!e) return null;
        const t = e.split(';'),
            n = t[0].trim(),
            o = {};
        t.length > 1 &&
            t.slice(1).forEach((e) => {
                const [t, n] = e.split('=').map((e) => e.trim());
                t && n && (o[t] = 'true' === n || ('false' !== n && n));
            });
        const r = {};
        return (
            o.boundary && (r.boundary = o.boundary),
            void 0 !== o.remember && (r.rememberLast = o.remember),
            o.enter && (r.enterMode = o.enter),
            { id: n, options: r }
        );
    }
    function X(e) {
        let t = e;
        for (; t && t !== document.body; ) {
            if (t.hasAttribute('data-focus-group')) return t;
            t = t.parentElement;
        }
        return null;
    }
    const K = a('Intersection');
    function U() {
        return 'undefined' != typeof window && void 0 !== window.IntersectionObserver;
    }
    const J = a('DOM'),
        Z =
            'a[href], a[aria-haspopup], [role="link"], button:not([disabled]), [role="button"], [aria-haspopup="true"], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';
    function Q(e, t, n = new Set(), o = new Set()) {
        const r = [];
        if (n.has(e)) return r;
        11 === e.nodeType && n.add(e);
        try {
            const t = e.querySelectorAll(Z);
            for (const e of t) o.has(e) || (o.add(e), r.push(e));
        } catch {}
        if (!t || !t.traverseShadowDom) return r;
        try {
            const i = e.querySelectorAll('*');
            for (const e of i) {
                const i = e;
                if (i.shadowRoot && !n.has(i.shadowRoot)) {
                    const e = Q(i.shadowRoot, t, n, o);
                    r.push(...e);
                }
            }
        } catch (e) {
            J.warn('shadow DOM traversal error', e);
        }
        try {
            const i = e.querySelectorAll('slot');
            for (const e of i) {
                const i = e.assignedElements({ flatten: !0 });
                for (const e of i)
                    if (
                        (!o.has(e) && e.matches && e.matches(Z) && (o.add(e), r.push(e)),
                        e.shadowRoot && t.traverseShadowDom && !n.has(e.shadowRoot))
                    ) {
                        const i = Q(e.shadowRoot, t, n, o);
                        r.push(...i);
                    }
            }
        } catch {}
        return r;
    }
    function ee(e) {
        const t = e.config;
        if (!t.observeVirtualContainers) return;
        e.virtualSentinelObserver &&
            (e.virtualSentinelObserver.disconnect(), (e.virtualSentinelObserver = null));
        const n = (function (e) {
            if (!e || !e.observeVirtualContainers) return [];
            const t = e.virtualContainerSelectors || [],
                n = [];
            for (const e of t)
                try {
                    const t = document.querySelectorAll(e);
                    for (const e of Array.from(t)) n.includes(e) || n.push(e);
                } catch {}
            return n;
        })(t);
        if (((e.virtualContainers = n), 0 === n.length)) return;
        J.debug(`detected ${n.length} virtual scroll containers`);
        const o = t.virtualScrollDebounce || 150;
        let r = null;
        const i = new IntersectionObserver(
            (t) => {
                t.some((e) => e.isIntersecting) &&
                    !e.virtualScrollPending &&
                    ((e.virtualScrollPending = !0),
                    r && clearTimeout(r),
                    (r = setTimeout(() => {
                        (J.debug('virtual scroll sentinel triggered refresh'),
                            re(e),
                            (e.virtualScrollPending = !1),
                            (e.dirty = !0));
                    }, o)));
            },
            { rootMargin: '300px', threshold: 0 }
        );
        for (const e of n) {
            const t = e.children;
            t.length > 2
                ? (i.observe(t[1]), i.observe(t[Math.floor(t.length / 2)]), i.observe(t[t.length - 2]))
                : t.length > 0 && (i.observe(t[0]), t.length > 1 && i.observe(t[t.length - 1]));
        }
        e.virtualSentinelObserver = i;
    }
    function te(e, t, n = 'polite') {
        t.config.enableAria &&
            t.announcer &&
            (t.announcer.setAttribute('aria-live', n),
            (t.announcer.textContent = ''),
            requestAnimationFrame(() => {
                t.announcer && (t.announcer.textContent = e);
            }));
    }
    function ne() {
        const e = document.activeElement;
        return e && e !== document.body && e !== document.documentElement ? e : null;
    }
    function oe(e) {
        if (!e || !e.tagName) return '';
        const t = e.id ? '#' + e.id : '';
        let n = '';
        'string' == typeof e.className &&
            e.className.trim().length > 0 &&
            (n = '.' + e.className.trim().split(/\s+/).slice(0, 2).join('.'));
        const o = e.textContent ? ` ("${e.textContent.trim().substring(0, 20)}")` : '';
        return e.tagName.toLowerCase() + t + n + o;
    }
    function re(e) {
        const t = performance.now(),
            n = e.config;
        let o;
        if (
            (n.traverseShadowDom
                ? ((o = Q(document, n)), J.debug(`shadow DOM traversal found ${o.length} focusables`))
                : (o = Array.from(document.querySelectorAll(Z))),
            J.debug(`candidate nodes found: ${o.length}`),
            n.iframeSupport && n.iframeSupport.enabled)
        )
            try {
                Array.from(document.querySelectorAll(n.iframeSupport.selector || 'iframe')).forEach((e) => {
                    o.includes(e) || o.push(e);
                });
            } catch (e) {
                J.warn('iframe selector failed', e);
            }
        const r = [],
            i = e.focusGroups || {};
        e.focusGroups = {};
        for (let t = 0; t < o.length; t++) {
            const n = o[t];
            if (!n || 'function' != typeof n.getBoundingClientRect) continue;
            const a = window.getComputedStyle(n);
            if (!a || 'hidden' === a.visibility || 'none' === a.display || n.disabled) continue;
            const s = { element: n, index: t };
            S(s, e);
            const l = e.config.minElementSize || 1;
            if (!s.rect || s.width <= 1 || s.height <= 1 || s.width < l || s.height < l) continue;
            if (n.closest('[aria-hidden="true"]')) continue;
            const c = X(n);
            if (c) {
                const t = j(c.getAttribute('data-focus-group'));
                if (t && t.id) {
                    let n = e.focusGroups[t.id];
                    if (!n) {
                        const o = i[t.id];
                        ((n = new H(t.id, c, t.options)),
                            o && (n.lastFocused = o.lastFocused),
                            (e.focusGroups[t.id] = n));
                    }
                    n.addMember(s);
                }
            }
            r.push(s);
        }
        if (
            (r.forEach((e, t) => {
                e.index = t;
            }),
            (e.focusables = r),
            (e.focusableElements = r.map((e) => e.element)),
            (e.focusableCount = r.length),
            (e.currentIndex = e.focusableElements.indexOf(document.activeElement)),
            (function (e) {
                e.config.observeIntersection && U()
                    ? (e.intersectionObserver
                          ? e.intersectionObserver.disconnect()
                          : (e.intersectionObserver = (function (e) {
                                if (!U())
                                    return (
                                        K.debug('IntersectionObserver unsupported in this environment'),
                                        null
                                    );
                                const t = e.config,
                                    n = {
                                        root: null,
                                        rootMargin: t.intersectionRootMargin || '200px',
                                        threshold: t.intersectionThreshold || 0,
                                    },
                                    o = new IntersectionObserver((t) => {
                                        t.forEach((t) => {
                                            const n = t.target;
                                            if (!e.focusableElements) return;
                                            const r = e.focusableElements.indexOf(n);
                                            if (-1 === r) return void o.unobserve(n);
                                            const i = e.focusables && e.focusables[r];
                                            i && S(i, e);
                                        });
                                    }, n);
                                return o;
                            })(e)),
                      e.intersectionObserver &&
                          Array.isArray(e.focusableElements) &&
                          e.focusableElements.forEach((t) => {
                              try {
                                  e.intersectionObserver && e.intersectionObserver.observe(t);
                              } catch {}
                          }))
                    : (function (e) {
                          e &&
                              e.intersectionObserver &&
                              (e.intersectionObserver.disconnect(), (e.intersectionObserver = null));
                      })(e);
            })(e),
            -1 !== e.currentIndex)
        ) {
            const t = e.focusables[e.currentIndex];
            if (t && t.groupId) {
                const n = e.focusGroups[t.groupId];
                n && n.updateLastFocused(t);
            }
        }
        const a = performance.now() - t;
        e.perf &&
            (e.perf.refreshCount++,
            (e.perf.totalRefreshTime += a),
            (e.perf.averageRefreshTime = e.perf.totalRefreshTime / e.perf.refreshCount),
            (e.perf.lastRefreshTime = a),
            a > 50 &&
                (e.perf.slowRefreshCount++,
                J.warn(`slow refresh: ${a.toFixed(2)}ms (${r.length} elements)`)));
    }
    function ie(e, t) {
        if (!e || 'function' != typeof e.getBoundingClientRect) return;
        const n = window.getComputedStyle(e);
        if (!n || 'hidden' === n.visibility || 'none' === n.display || e.disabled) return;
        const o = { element: e };
        if ((S(o, t), !o.rect || o.width <= 1 || o.height <= 1)) return;
        const r = X(e);
        if (r) {
            const e = j(r.getAttribute('data-focus-group'));
            if (e && e.id) {
                const n = t.focusGroups[e.id];
                n && n.addMember(o);
            }
        }
        (t.focusables.push(o),
            t.focusableElements.push(e),
            t.focusables.forEach((e, t) => (e.index = t)),
            (t.focusableCount = t.focusables.length),
            (function (e, t) {
                if (e && t && e.intersectionObserver)
                    try {
                        e.intersectionObserver.observe(t);
                    } catch {}
            })(t, e),
            J.debug('inserted entry', oe(e)));
    }
    function ae(e, t) {
        if (e < 0 || e >= t.focusables.length) return;
        const n = t.focusables[e];
        if ((J.debug('removing entry', oe(n.element)), n.groupId)) {
            const e = t.focusGroups[n.groupId];
            e && e.removeMember(n);
        }
        (t.focusables.splice(e, 1),
            t.focusableElements.splice(e, 1),
            (function (e, t) {
                if (e && t && e.intersectionObserver)
                    try {
                        e.intersectionObserver.unobserve(t);
                    } catch {}
            })(t, n.element),
            t.lastFocusedElement === n.element && (t.lastFocusedElement = null),
            t.focusables.forEach((e, t) => (e.index = t)),
            (t.focusableCount = t.focusables.length),
            t.currentIndex === e ? (t.currentIndex = -1) : t.currentIndex > e && t.currentIndex--);
    }
    function se(e) {
        if (!c().useCSSProperties) return { contain: 'auto', action: 'auto', function: 'normal' };
        try {
            const t = getComputedStyle(e),
                n = t.getPropertyValue('--spatial-navigation-contain').trim(),
                o = t.getPropertyValue('--spatial-navigation-action').trim();
            return {
                contain: 'contain' === n ? 'contain' : 'auto',
                action: 'focus' === o || 'scroll' === o ? o : 'auto',
                function:
                    'grid' === t.getPropertyValue('--spatial-navigation-function').trim() ? 'grid' : 'normal',
            };
        } catch {
            return { contain: 'auto', action: 'auto', function: 'normal' };
        }
    }
    function le(e) {
        return se(e).contain;
    }
    const ce = a('Scoring');
    function ue(e, t, n, o) {
        if ('x' === n.axis) {
            const n = (e.top + e.bottom) / 2,
                r = (t.top + t.bottom) / 2;
            return Math.abs(n - r) <= o;
        }
        {
            const n = (e.left + e.right) / 2,
                r = (t.left + t.right) / 2;
            return Math.abs(n - r) <= o;
        }
    }
    function de(e, t, n, o) {
        const r = c(),
            i = n.axis,
            a = n.sign,
            s = !1 !== o.strictEdges,
            l = !0 === o.allowOverlap,
            u = o.overlapThreshold ?? r.overlapThreshold ?? 0,
            d = o.distanceFunction ?? r.distanceFunction ?? 'euclidean',
            f = 4 + u;
        if (s)
            if ('x' === i) {
                if (a > 0 && t.left < e.right - f) return null;
                if (a < 0 && t.right > e.left + f) return null;
            } else {
                if (a > 0 && t.top < e.bottom - f) return null;
                if (a < 0 && t.bottom > e.top + f) return null;
            }
        const p = t.centerX - e.centerX,
            m = t.centerY - e.centerY,
            b = l ? -(12 + u) : 1;
        if ('x' === i) {
            if (a > 0 && p <= b) return null;
            if (a < 0 && p >= -b) return null;
        } else {
            if (a > 0 && m <= b) return null;
            if (a < 0 && m >= -b) return null;
        }
        const g = Math.abs('x' === i ? p : m),
            h = Math.abs('x' === i ? m : p),
            v = (function (e, t, n, o) {
                switch (n) {
                    case 'manhattan':
                        return Math.abs(e) + Math.abs(t);
                    case 'projected':
                        return o
                            ? ('x' === o.axis ? Math.abs(e) : Math.abs(t)) +
                                  0.5 * ('x' === o.axis ? Math.abs(t) : Math.abs(e))
                            : Math.sqrt(e * e + t * t);
                    default:
                        return Math.sqrt(e * e + t * t);
                }
            })(p, m, d, n);
        return h > Math.max(4, 3 * g)
            ? null
            : {
                  primary: g,
                  secondary: h,
                  distance: v,
                  alignment: 0 === h ? 10 : Math.max(0, 10 - h / 50),
                  deltaX: p,
                  deltaY: m,
                  gridAligned: ue(e, t, n, r.gridAlignmentTolerance),
              };
    }
    function fe(e, t, n, o) {
        const r = c(),
            i = o.focusables[e];
        if (!i || !i.element) return null;
        S(i, o);
        const a = !1 !== n.strictEdges,
            s = !0 === n.allowOverlap,
            l = !1 !== n.requireViewport,
            u = n.viewportMargin ?? 0,
            d = n.alignmentWeight ?? 10,
            f = n.distanceWeight ?? 1,
            p = !1 !== n.preferScrollGroup,
            m =
                r.useCSSProperties && i.element
                    ? (function (e) {
                          const t = c();
                          if ('grid' === t.scoringMode) return 'grid';
                          if (t.useCSSProperties) {
                              const t = (function (e) {
                                  return se(e).function;
                              })(e);
                              if ('grid' === t) return 'grid';
                          }
                          return 'geometric';
                      })(i.element)
                    : (n.scoringMode ?? r.scoringMode ?? 'geometric'),
            b = 'grid' === m ? 500 : 0,
            g =
                r.useCSSProperties && i.element
                    ? (function (e) {
                          const t = (function (e) {
                              if (!c().useCSSProperties) return null;
                              let t = e.parentElement;
                              for (; t && t !== document.documentElement; ) {
                                  if ('contain' === le(t)) return t;
                                  t = t.parentElement;
                              }
                              return null;
                          })(e);
                          return { contained: null !== t, container: t };
                      })(i.element)
                    : { contained: !1, container: null },
            h = [];
        for (let c = 0; c < o.focusables.length; c++) {
            if (c === e) continue;
            const m = o.focusables[c];
            if (!m || !m.element) continue;
            S(m, o);
            const v = r.minElementSize || 1;
            if (!m.rect || m.width < v || m.height < v) continue;
            if (l && !A(m.rect, u)) continue;
            if (g.contained && g.container && m.element && !g.container.contains(m.element)) continue;
            const w = de(i, m, t, {
                strictEdges: a,
                allowOverlap: s,
                overlapThreshold: n.overlapThreshold,
                distanceFunction: n.distanceFunction,
            });
            if (!w) continue;
            let y = 1e3 * w.primary + w.secondary * d + w.distance * f;
            b && w.gridAligned && (y -= b);
            const x = i.groupId,
                E = m.groupId;
            if (x) {
                const e = o.focusGroups[x],
                    t = x === E;
                if (e && 'contain' === e.options.boundary && !t) continue;
                t && (y -= 2e3);
            }
            if (E && E !== x) {
                const e = o.focusGroups[E];
                if (e && 'last' === e.options.enterMode && e.lastFocused) {
                    if (m.element !== e.lastFocused.element) continue;
                    y -= 1e3;
                }
            }
            (p && (m.scrollKey && m.scrollKey === i.scrollKey ? (y -= 150) : (y += 75)),
                A(m.rect, 0) || (y += 120),
                h.push({ index: c, data: m, rect: m.rect, score: y, metrics: w }));
        }
        return h.length
            ? (h.sort((e, t) =>
                  'grid' === m && e.metrics.gridAligned !== t.metrics.gridAligned
                      ? e.metrics.gridAligned
                          ? -1
                          : 1
                      : e.score !== t.score
                        ? e.score - t.score
                        : e.metrics.distance - t.metrics.distance
              ),
              h[0])
            : null;
    }
    function pe(e, t, n) {
        if (!t) return null;
        const o = [
            {
                strictEdges: !0,
                allowOverlap: !1,
                requireViewport: !0,
                viewportMargin: 0,
                alignmentWeight: 10,
                distanceWeight: 1,
                preferScrollGroup: !0,
            },
            {
                strictEdges: !1,
                allowOverlap: !0,
                requireViewport: !0,
                viewportMargin: 160,
                alignmentWeight: 8,
                distanceWeight: 0.9,
                preferScrollGroup: !0,
            },
            {
                strictEdges: !1,
                allowOverlap: !0,
                requireViewport: !1,
                viewportMargin: 0,
                alignmentWeight: 6,
                distanceWeight: 0.7,
                preferScrollGroup: !1,
            },
        ];
        for (let r = 0; r < o.length; r++) {
            const i = fe(e, t, o[r], n);
            if (i) return ((i.passIndex = r), i);
        }
        return (
            ce.debug(`no candidate for ${t.name} after ${o.length} passes`),
            c().wrapNavigation
                ? (function (e, t, n) {
                      const o = n.focusables[e];
                      if (!o || !o.element) return null;
                      S(o, n);
                      const r = c(),
                          i = 'grid' === r.scoringMode,
                          a = r.gridAlignmentTolerance,
                          s = [];
                      for (let r = 0; r < n.focusables.length; r++) {
                          if (r === e) continue;
                          const l = n.focusables[r];
                          if (!l || !l.element) continue;
                          if ((S(l, n), !l.rect || l.width <= 1 || l.height <= 1)) continue;
                          const c = !!i && ue(o, l, t, a);
                          let u;
                          switch (t.name) {
                              case 'down':
                                  u = l.top;
                                  break;
                              case 'up':
                                  u = -l.bottom;
                                  break;
                              case 'right':
                                  u = l.left;
                                  break;
                              case 'left':
                                  u = -l.right;
                          }
                          s.push({ index: r, data: l, position: u, gridAligned: c });
                      }
                      if (!s.length) return null;
                      s.sort((e, t) =>
                          i && e.gridAligned !== t.gridAligned
                              ? e.gridAligned
                                  ? -1
                                  : 1
                              : e.position - t.position
                      );
                      const l = s[0];
                      return {
                          index: l.index,
                          data: l.data,
                          rect: l.data.rect,
                          score: 0,
                          metrics: {
                              primary: 0,
                              secondary: 0,
                              distance: 0,
                              alignment: 0,
                              deltaX: 0,
                              deltaY: 0,
                              gridAligned: l.gridAligned,
                          },
                          passIndex: -1,
                      };
                  })(e, t, n)
                : null
        );
    }
    function me(e, t, n) {
        if (!t || !n) return !0;
        const o = { dir: n.dir, relatedTarget: n.relatedTarget || null };
        (void 0 !== n.inTrap && (o.inTrap = !!n.inTrap),
            n.trapElement && (o.trapElement = n.trapElement),
            n.escapeElement && (o.escapeElement = n.escapeElement),
            n.escapeKey && (o.escapeKey = n.escapeKey));
        const r = new CustomEvent(e, { bubbles: !0, cancelable: !0, detail: o });
        return t.dispatchEvent(r);
    }
    function be(e) {
        if (e instanceof Error) return JSON.stringify({ name: e.name, message: e.message, stack: e.stack });
        if (e && 'object' == typeof e && 'message' in e && 'string' == typeof e.message)
            try {
                return JSON.stringify({ ...e, message: e.message });
            } catch {}
        try {
            return JSON.stringify(e);
        } catch {
            return String(e);
        }
    }
    function ge(e, t) {
        try {
            return e.getAttribute(t);
        } catch {
            return null;
        }
    }
    const he = a('Bridge');
    function ve() {
        const e = globalThis,
            t = e.browser?.runtime ?? e.chrome?.runtime;
        return t && 'function' == typeof t.sendMessage ? t : null;
    }
    function we(e) {
        return e instanceof Error
            ? `${e.name}: ${e.message}`
            : String('object' == typeof e && null !== e && 'message' in e ? e.message : e);
    }
    async function ye(e, t, n = { useFallback: !0 }) {
        if (null === ve()) {
            if (n.useFallback)
                try {
                    globalThis.alert?.(`__FOCUS_EXIT__:${e}`);
                } catch {}
            return { success: !1, error: 'No extension bridge available' };
        }
        return (async function (e, t = {}) {
            const n = ve();
            if (!n)
                return (
                    t.debug && he.debug('No extension bridge available'),
                    { success: !1, error: 'No extension bridge available' }
                );
            try {
                if (
                    (t.debug && he.debug(`Sending message: ${be(e)}`),
                    (function () {
                        const e = globalThis,
                            t = ve();
                        return null !== t && e.browser?.runtime === t;
                    })())
                ) {
                    const o = n.sendMessage(e);
                    if (o && 'function' == typeof o.then)
                        try {
                            const e = await o;
                            return (
                                t.debug && he.debug(`Response (promise): ${be(e)}`),
                                { success: !0, response: e }
                            );
                        } catch (e) {
                            const t = we(e);
                            return (he.error(`Bridge error (promise): ${t}`), { success: !1, error: t });
                        }
                    return { success: !0 };
                }
                return new Promise((o) => {
                    n.sendMessage(e, (e) => {
                        const r = e,
                            i = n.lastError;
                        if (i) {
                            const e = we(i);
                            (he.error(`Bridge error (callback): ${e}`), o({ success: !1, error: e }));
                        } else
                            (t.debug && he.debug(`Response (callback): ${be(r)}`),
                                o({ success: !0, response: r }));
                    });
                });
            } catch (e) {
                const t = we(e);
                return (he.error(`Bridge exception: ${t}`), { success: !1, error: t });
            }
        })({ type: 'focusExit', direction: e, inTrap: t });
    }
    const xe = a('Movement');
    function Ee(e, t, n) {
        n.overlaySuppressed && (n.overlaySuppressed = !1);
        const o = n.config,
            r = ne(),
            i = r && r instanceof HTMLElement ? n.focusableElements.indexOf(r) : -1;
        if (-1 === i) return !1;
        const a = n.focusables[i];
        S(a, n);
        const s = (function (e, t, n) {
            const o = n.config.precomputeCacheTimeout || 500,
                r = Date.now() - (n.precomputedTimestamp || 0);
            return n.precomputedForIndex === e &&
                !n.dirty &&
                r < o &&
                n.precomputedTargets &&
                n.precomputedTargets &&
                n.precomputedTargets[t.name]
                ? (xe.debug(`using cached candidate for ${t.name}`), n.precomputedTargets[t.name])
                : pe(e, t, n);
        })(i, e, n);
        if (!s) {
            const t = (function (e, t) {
                if (!t || !t.focusTrapDetection) return null;
                const n = [
                    '[role="dialog"]',
                    '[aria-modal="true"]',
                    '.modal:not([style*="display: none"]):not([style*="visibility: hidden"])',
                    '.overlay:not([style*="display: none"])',
                    '[data-focus-trap]',
                    '.MuiDialog-root',
                    '.ReactModal__Content',
                    '.chakra-modal__content',
                ];
                for (const t of n)
                    try {
                        const n = e.closest(t);
                        if (n) {
                            const e = n.querySelector(
                                '[data-dismiss], [aria-label*="close" i], [aria-label*="Close" i], button[class*="close" i], .close-button, [data-testid*="close" i]'
                            );
                            return {
                                trap: n,
                                escapeKey: n.dataset.escapeKey || 'Escape',
                                closeButton: e,
                                trapId: n.id || n.getAttribute('aria-labelledby') || 'dialog',
                            };
                        }
                    } catch {}
                return null;
            })(a.element, o);
            (me('navnotarget', a.element, {
                dir: e.name,
                inTrap: !!t,
                trapElement: t?.trap,
                escapeElement: t?.closeButton ?? void 0,
                escapeKey: t?.escapeKey,
            }),
                o.announceBoundaries &&
                    te(
                        t
                            ? `In ${t.trapId}. Press ${t.escapeKey} to close.`
                            : `Edge of content. Cannot move ${e.name}.`,
                        n,
                        'polite'
                    ),
                xe.debug(`boundary reached, notifying native: ${e.name}`),
                ye(e.name, !!t)
                    .then((e) => {
                        e.success || xe.debug('focusExit relay error', e.error);
                    })
                    .catch((e) => {
                        xe.debug('focusExit error', e);
                    }));
            try {
                const n = new CustomEvent('spatialNavigationExit', {
                    detail: { direction: e.name, inTrap: !!t, trapInfo: t },
                    bubbles: !0,
                    cancelable: !1,
                });
                document.dispatchEvent(n);
            } catch (e) {
                xe.warn('failed to dispatch exit event', e);
            }
            return (
                (n.overlaySuppressed = !0),
                n.updateTimer && (cancelAnimationFrame(n.updateTimer), (n.updateTimer = null)),
                B(n),
                W(n),
                n.nextTargets && (n.nextTargets[e.name] = null),
                (n.currentTrap = t),
                !1
            );
        }
        if (!me('navbeforefocus', s.data.element, { dir: e.name, relatedTarget: a.element }))
            return (
                xe.debug('navigation cancelled by navbeforefocus handler'),
                t && (t.preventDefault(), t.stopPropagation()),
                !1
            );
        if (
            (t && (t.preventDefault(), t.stopPropagation()),
            (n.lastMove = {
                fromIndex: i,
                toIndex: s.index,
                direction: e.name,
                passIndex: 'number' == typeof s.passIndex ? s.passIndex : 0,
                timestamp: Date.now(),
            }),
            (function (e, t) {
                if (e)
                    try {
                        (e.dispatchEvent(
                            new MouseEvent('mouseout', { bubbles: !0, cancelable: !0, view: window })
                        ),
                            e.dispatchEvent(
                                new MouseEvent('mouseleave', { bubbles: !1, cancelable: !1, view: window })
                            ));
                    } catch {}
                if (t)
                    try {
                        (t.dispatchEvent(
                            new MouseEvent('mouseover', { bubbles: !0, cancelable: !0, view: window })
                        ),
                            t.dispatchEvent(
                                new MouseEvent('mouseenter', { bubbles: !1, cancelable: !1, view: window })
                            ),
                            t.dispatchEvent(
                                new MouseEvent('mousemove', { bubbles: !0, cancelable: !0, view: window })
                            ));
                    } catch {}
            })(a.element, s.data.element),
            !Se(s.data.element, n))
        )
            return !1;
        if (((n.currentIndex = s.index), (n.currentTrap = null), o.announceNavigation)) {
            const e = (function (e, t) {
                if (!e || !e.tagName) return '';
                const n = [],
                    o = e.getAttribute('aria-label'),
                    r = e.getAttribute('aria-labelledby'),
                    i = e.getAttribute('title');
                if (o) n.push(o);
                else if (r) {
                    const e = document.getElementById(r);
                    e && n.push(e.textContent?.trim() || '');
                } else {
                    const t = e.textContent?.trim().substring(0, 50);
                    t && n.push(t);
                }
                i && !n.includes(i) && n.push(i);
                const a = e.getAttribute('role') || e.tagName.toLowerCase(),
                    s =
                        {
                            a: 'link',
                            button: 'button',
                            input: e.type || 'text field',
                            select: 'dropdown',
                            textarea: 'text area',
                            checkbox: 'checkbox',
                            radio: 'radio button',
                        }[a] || a;
                return t && t.verboseDescriptions ? `${n.join(', ')} (${s})` : n.join(', ') || s;
            })(s.data.element, o);
            te(e, n, 'polite');
        }
        return (
            n.instrumentation &&
                ((n.instrumentation.lastActive = oe(s.data.element)),
                (n.instrumentation.lastOverlay = oe(s.data.element)),
                (n.instrumentation.activeIndex = s.data.index),
                (n.instrumentation.lastUpdate = Date.now()),
                (n.instrumentation.lastDirection = e.name)),
            (function (e) {
                var t;
                e.config.precomputeCandidates &&
                    ((t = () => {
                        const t = ne(),
                            n = t && t instanceof HTMLElement ? e.focusableElements.indexOf(t) : -1;
                        if (-1 === n) return;
                        if (e.precomputedForIndex === n && !e.dirty) return;
                        const o = {},
                            r = v;
                        for (const [t, i] of Object.entries(r)) o[t] = pe(n, i, e);
                        ((e.precomputedTargets = o),
                            (e.precomputedForIndex = n),
                            (e.precomputedTimestamp = Date.now()),
                            (e.dirty = !1),
                            xe.debug(`pre-computed candidates for index ${n}`));
                    }),
                    'undefined' != typeof requestIdleCallback
                        ? requestIdleCallback(t, { timeout: 100 })
                        : setTimeout(t, 50));
            })(n),
            requestAnimationFrame(function () {
                try {
                    const e = window.getComputedStyle(s.data.element).scrollSnapAlign;
                    let t = 'nearest',
                        n = 'nearest';
                    (e &&
                        'none' !== e &&
                        (e.includes('start')
                            ? (t = 'start')
                            : e.includes('center')
                              ? (t = 'center')
                              : e.includes('end') && (t = 'end'),
                        e.includes('start')
                            ? (n = 'start')
                            : e.includes('center')
                              ? (n = 'center')
                              : e.includes('end') && (n = 'end')),
                        s.data.element.scrollIntoView({ block: t, inline: n }));
                } catch {}
            }),
            !0
        );
    }
    function Se(e, t) {
        if (!e) return null;
        const n = e,
            o = (n.tagName || '').toLowerCase();
        try {
            if ('iframe' === o && t.config?.iframeSupport?.enabled) {
                const o = n;
                if (
                    'contentWindow' === t.config.iframeSupport.focusMethod &&
                    o.contentWindow &&
                    'function' == typeof o.contentWindow.focus
                )
                    return (o.contentWindow.focus(), (t.lastFocusedElement = n), e);
            }
            const r = () => {
                if ('function' == typeof n.focus)
                    try {
                        n.focus({ preventScroll: !0 });
                    } catch {
                        try {
                            n.focus();
                        } catch {}
                    }
            };
            if (
                (r(),
                document.activeElement !== n &&
                    (n.hasAttribute('tabindex') ||
                        (xe.debug(`element not accepting focus, setting tabindex="-1": ${oe(n)}`),
                        n.setAttribute('tabindex', '-1'),
                        r())),
                document.activeElement === n)
            )
                return ((t.lastFocusedElement = n), e);
            xe.debug(
                `focus call failed to change activeElement for ${oe(n)}; current=${oe(document.activeElement)}`
            );
        } catch (e) {
            xe.warn('error during applyFocus', e);
        }
        return document.activeElement === n ? ((t.lastFocusedElement = n), e) : null;
    }
    function Ae(e, t, n) {
        return Math.min(Math.max(e, t), n);
    }
    function Me(e, t) {
        const n = Math.max(0, (window?.innerWidth ?? 0) - 1),
            o = Math.max(0, (window?.innerHeight ?? 0) - 1);
        return { x: Ae(e, 0, n), y: Ae(t, 0, o) };
    }
    function Te(e, t) {
        if (!e) return !1;
        if (e === t) return !0;
        try {
            return t.contains(e);
        } catch {
            return !1;
        }
    }
    const Ce = a('Focus');
    function Oe(e, t) {
        if (t.overlaySuppressed)
            return (
                t.updateTimer && (cancelAnimationFrame(t.updateTimer), (t.updateTimer = null)),
                void (e && 1 === e.nodeType && (t.lastFocusedElement = e))
            );
        (t.updateTimer && cancelAnimationFrame(t.updateTimer),
            (t.updateTimer = requestAnimationFrame(function () {
                (t.overlaySuppressed ||
                    (L(e, t, !0),
                    G(e, 0, pe, v, oe, t),
                    t.instrumentation &&
                        ((t.instrumentation.lastActive = oe(e) || 'EMPTY_DESC'),
                        (t.instrumentation.lastOverlay = oe(e)),
                        (t.instrumentation.activeIndex = t.focusableElements
                            ? t.focusableElements.indexOf(e)
                            : -1),
                        (t.instrumentation.lastUpdate = Date.now())),
                    e && 1 === e.nodeType && (t.lastFocusedElement = e)),
                    (t.updateTimer = null));
            })));
    }
    const Ie = a('MenuToggle');
    function ke(e) {
        const t = e.tagName.toLowerCase();
        if ('ul' === t || 'ol' === t) return !0;
        const n = ge(e, 'role');
        if ('menu' === n || 'listbox' === n) return !0;
        const o = ge(e, 'class') || '';
        if (/(menu|submenu|dropdown|child)/i.test(o)) return !0;
        try {
            return !!e.querySelector?.(
                'a[href], button, [role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"]'
            );
        } catch {
            return !1;
        }
    }
    function _e(e) {
        const t = ge(e, 'aria-expanded'),
            n = (function (e) {
                const t = ge(e, 'aria-controls');
                if (t) {
                    const e = document.getElementById(t);
                    if (e && 1 === e.nodeType) return e;
                }
                const n = e.nextElementSibling;
                if (n && 1 === n.nodeType && ke(n)) return n;
                const o = e.closest?.('.folder-parent, li, nav, header, [role="menuitem"]');
                if (o)
                    for (const t of Array.from(o.children))
                        if (t !== e && 1 === t.nodeType && ke(t)) return t;
                return null;
            })(e);
        return 'true' === t
            ? { isOpen: !0, ariaExpanded: t, submenu: n, reason: 'aria-expanded' }
            : 'false' === t
              ? { isOpen: !1, ariaExpanded: t, submenu: n, reason: 'aria-expanded' }
              : n &&
                  (function (e) {
                      if (!e) return !1;
                      try {
                          const t = window.getComputedStyle(e);
                          if ('none' === t.display || 'hidden' === t.visibility) return !1;
                          if ('string' == typeof t.opacity && t.opacity.length && parseFloat(t.opacity) <= 0)
                              return !1;
                      } catch {}
                      try {
                          const t = e.getBoundingClientRect();
                          return t.width > 0 && t.height > 0;
                      } catch {
                          return !1;
                      }
                  })(n)
                ? { isOpen: !0, ariaExpanded: t, submenu: n, reason: 'submenu-visible' }
                : n
                  ? { isOpen: !1, ariaExpanded: t, submenu: n, reason: 'submenu-hidden' }
                  : { isOpen: !1, ariaExpanded: t, submenu: null, reason: 'no-submenu' };
    }
    function Ne(e, t) {
        if (!e) return !1;
        for (const n of t)
            if (n) {
                if (e === n) return !0;
                try {
                    if (n.contains(e)) return !0;
                } catch {}
            }
        return !1;
    }
    function $e(e) {
        if (!e) return !1;
        try {
            const t = e.tagName?.toLowerCase();
            if (!t) return !1;
            if ('a' === t) return null !== ge(e, 'href');
            if ('button' === t || 'input' === t || 'select' === t || 'textarea' === t) return !0;
            const n = ge(e, 'role');
            if ('button' === n || 'menuitem' === n || 'link' === n) return !0;
            const o = ge(e, 'tabindex');
            return null !== o && '-1' !== o;
        } catch {
            return !1;
        }
    }
    function Re(e) {
        const { toggleRect: t, submenuRect: n, exclusions: o } = e,
            r = [];
        (n &&
            (r.push({ label: 'submenu-below', x: n.left + n.width / 2, y: n.bottom + 8 }),
            r.push({ label: 'submenu-right', x: n.right + 8, y: n.top + 8 }),
            r.push({ label: 'submenu-left', x: n.left - 8, y: n.top + 8 }),
            r.push({ label: 'submenu-above', x: n.left + n.width / 2, y: n.top - 8 })),
            r.push({ label: 'toggle-below', x: t.left + t.width / 2, y: t.bottom + 8 }),
            r.push({ label: 'toggle-above', x: t.left + t.width / 2, y: t.top - 8 }),
            r.push({
                label: 'viewport-center',
                x: (window?.innerWidth ?? 0) / 2,
                y: (window?.innerHeight ?? 0) / 2,
            }),
            r.push({ label: 'viewport-top-left', x: 8, y: 8 }),
            r.push({ label: 'viewport-top-right', x: (window?.innerWidth ?? 0) - 8, y: 8 }),
            r.push({ label: 'viewport-bottom-left', x: 8, y: (window?.innerHeight ?? 0) - 8 }),
            r.push({
                label: 'viewport-bottom-right',
                x: (window?.innerWidth ?? 0) - 8,
                y: (window?.innerHeight ?? 0) - 8,
            }));
        let i = null;
        for (const e of r) {
            const t = Me(e.x, e.y),
                n = document.elementFromPoint(t.x, t.y);
            if (Ne(n, o)) continue;
            const r = { x: t.x, y: t.y, label: e.label, hit: n };
            if (!$e(n)) return r;
            i || (i = r);
        }
        if (i) return i;
        const a = Me(t.left + t.width / 2, t.top + t.height / 2);
        return { x: a.x, y: a.y, label: 'toggle-center', hit: document.elementFromPoint(a.x, a.y) };
    }
    function Fe(e, t, n) {
        const o = {
            bubbles: !0,
            cancelable: !0,
            view: window,
            clientX: t,
            clientY: n,
            buttons: 0,
            detail: 0,
        };
        if ('function' == typeof PointerEvent) {
            const t = { ...o, pointerId: 1, pointerType: 'mouse', isPrimary: !0, button: -1, pressure: 0 };
            (e.dispatchEvent(new PointerEvent('pointerout', t)),
                e.dispatchEvent(new PointerEvent('pointerleave', t)));
        }
        (e.dispatchEvent(new MouseEvent('mouseout', o)), e.dispatchEvent(new MouseEvent('mouseleave', o)));
    }
    const Pe = a('Handlers'),
        De = 'data-spatnav-handler-id',
        Le = 'data-spatnav-handler-counter',
        Be = 'data-spatnav-event-lock',
        qe = new Set(['div', 'span', 'button', 'video', 'img']),
        We = new Set(['button', 'submit', 'reset', 'checkbox', 'radio', 'image', 'file']);
    function ze(e, t) {
        if (!e) return;
        const n = t.handlerId,
            o = document.documentElement.getAttribute(De);
        if (String(n) !== o) return void Pe.debug(`stale handler blocked: my=${n} current=${o}`);
        const r = Number.isFinite(e.timeStamp) ? e.timeStamp : 0,
            i = `${e.type || 'keydown'}:${e.key || ''}:${r.toFixed(3)}`;
        if (document.documentElement.getAttribute(Be) === i) return void Pe.debug(`event lock hit: ${i}`);
        document.documentElement.setAttribute(Be, i);
        const a = () => {
            try {
                if (document.documentElement.getAttribute(Be) !== i) return;
                document.documentElement.removeAttribute(Be);
            } catch {}
        };
        ('function' == typeof queueMicrotask ? queueMicrotask(a) : setTimeout(a, 0),
            e.stopImmediatePropagation());
        const s = Date.now();
        window.__SPATIAL_NAV_KEYDOWN_COUNT__ = (window.__SPATIAL_NAV_KEYDOWN_COUNT__ || 0) + 1;
        const l = window.__SPATIAL_NAV_KEYDOWN_COUNT__,
            c = window.__SPATIAL_NAV_LAST_KEY_TIME__ || 0,
            u = window.__SPATIAL_NAV_LAST_KEY__ || '',
            d = s - c;
        if (
            (Pe.debug(`keydown #${l} key="${e.key}" handler=${n} since=${d}ms`),
            (window.__SPATIAL_NAV_LAST_KEY_TIME__ = s),
            (window.__SPATIAL_NAV_LAST_KEY__ = e.key),
            e.key === u && d < 50 && d > 0)
        )
            return (
                Pe.debug(`rapid repeat blocked: "${e.key}" within ${d}ms`),
                e.preventDefault(),
                e.stopPropagation(),
                void e.stopImmediatePropagation()
            );
        if ('Enter' === e.key || ' ' === e.key)
            return void (function (e, t, n) {
                const o = ne();
                if (!o) return;
                const r = o.tagName.toLowerCase(),
                    i = o,
                    a = o;
                if (i.isContentEditable || 'textarea' === r || ('input' === r && !We.has(a.type || '')))
                    return;
                const s = ge(o, 'href'),
                    l = ge(o, 'role'),
                    c = ge(o, 'aria-haspopup'),
                    u = ge(o, 'aria-expanded');
                Pe.debug(`${' ' === e.key ? 'SPACE' : 'ENTER'} on ${oe(o)}`, {
                    tagName: r,
                    role: l,
                    hasHref: !!s,
                    ariaHasPopup: c,
                    ariaExpanded: u,
                });
                let d = o;
                try {
                    const e = o.closest?.('[aria-haspopup], [aria-expanded]');
                    e && (d = e);
                } catch {}
                const f = d.tagName.toLowerCase(),
                    p = ge(d, 'role'),
                    m = (function (e) {
                        const t = ge(e, 'aria-haspopup'),
                            n = ge(e, 'aria-expanded');
                        return (null !== t && 'false' !== t) || null !== n;
                    })(d),
                    b = ('a' === f && !d.hasAttribute('href')) || qe.has(f) || 'button' === p,
                    g = globalThis,
                    h = g.browser?.runtime ?? g.chrome?.runtime,
                    v = !!h && 'function' == typeof h.sendMessage;
                if (
                    m &&
                    (function (e) {
                        const {
                                actionElement: t,
                                state: n,
                                event: o,
                                handlerId: r,
                                runtimeApi: i,
                                canRequestNativeClick: a,
                            } = e,
                            s = _e(t);
                        if (!s.isOpen) return !1;
                        const l = r,
                            c = t.closest?.('.folder-parent') || t.parentElement || t,
                            u = (function (e) {
                                let t = e,
                                    n = 0;
                                for (; t && n < 12; ) {
                                    const e = t.tagName?.toLowerCase();
                                    if ('nav' === e || 'header' === e) return t;
                                    if ('navigation' === ge(t, 'role')) return t;
                                    const o = ge(t, 'id') || '';
                                    if (o && /nav/i.test(o) && o.length <= 48)
                                        try {
                                            if (t.querySelector?.('a, [role="menuitem"], [role="link"]'))
                                                return t;
                                        } catch {
                                            return t;
                                        }
                                    ((t = t.parentElement), (n += 1));
                                }
                                return null;
                            })(t),
                            d = [c, s.submenu, t, u].filter(Boolean),
                            f = s.submenu ? s.submenu.getBoundingClientRect() : null,
                            p = Re({ toggleRect: t.getBoundingClientRect(), submenuRect: f, exclusions: d });
                        if (
                            (Ie.debug(
                                `menu toggle OPEN (${s.reason}) — closing via hover-exit + outside click`,
                                {
                                    toggle: oe(t),
                                    ariaExpanded: s.ariaExpanded,
                                    submenu: s.submenu ? oe(s.submenu) : null,
                                    navRoot: u ? oe(u) : null,
                                    outside: { label: p.label, x: p.x, y: p.y, hit: oe(p.hit) },
                                }
                            ),
                            Fe(t, p.x, p.y),
                            s.submenu && Fe(s.submenu, p.x, p.y),
                            !_e(t).isOpen)
                        ) {
                            (Ie.debug(`menu closed via hover-exit (${s.reason}) — skipping outside click`),
                                (n.dirty = !0));
                            try {
                                (t.focus?.(), Oe(t, n));
                            } catch {}
                            return (o.preventDefault(), o.stopPropagation(), !0);
                        }
                        return (
                            setTimeout(() => {
                                const e = document.documentElement.getAttribute('data-spatnav-handler-id');
                                if (String(l) !== e) return;
                                const o = _e(t);
                                if (!o.isOpen) return;
                                const r = Re({
                                    toggleRect: t.getBoundingClientRect(),
                                    submenuRect: o.submenu ? o.submenu.getBoundingClientRect() : f,
                                    exclusions: d,
                                });
                                Ie.debug('menu still open — outside-click fallback', {
                                    toggle: oe(t),
                                    outside: { label: r.label, x: r.x, y: r.y, hit: oe(r.hit) },
                                });
                                const s = i;
                                if (a && s && 'function' == typeof s.sendMessage) {
                                    const e = window.devicePixelRatio || 1,
                                        t = r.x * e,
                                        n = r.y * e;
                                    try {
                                        (Ie.debug('closing menu toggle via NATIVE outside click', {
                                            css: { x: r.x, y: r.y, point: r.label },
                                            dpr: e,
                                            final: { x: t, y: n },
                                        }),
                                            s.sendMessage({
                                                type: 'simulateClick',
                                                x: t,
                                                y: n,
                                                debug: {
                                                    cssX: r.x,
                                                    cssY: r.y,
                                                    point: r.label,
                                                    hit: oe(r.hit),
                                                    context: 'menuToggleClose',
                                                },
                                            }));
                                    } catch (e) {
                                        Ie.warn('native outside-click failed, using JS fallback', e);
                                    }
                                } else {
                                    const e = r.hit;
                                    try {
                                        (e &&
                                            'function' == typeof e.dispatchEvent &&
                                            (e.dispatchEvent(
                                                new MouseEvent('mousedown', {
                                                    bubbles: !0,
                                                    cancelable: !0,
                                                    view: window,
                                                    clientX: r.x,
                                                    clientY: r.y,
                                                    buttons: 1,
                                                    detail: 1,
                                                })
                                            ),
                                            e.dispatchEvent(
                                                new MouseEvent('mouseup', {
                                                    bubbles: !0,
                                                    cancelable: !0,
                                                    view: window,
                                                    clientX: r.x,
                                                    clientY: r.y,
                                                    buttons: 1,
                                                    detail: 1,
                                                })
                                            )),
                                            e && 'function' == typeof e.click
                                                ? e.click()
                                                : 'function' == typeof document.body?.click &&
                                                  document.body.click());
                                    } catch {}
                                }
                                setTimeout(() => {
                                    const e =
                                        document.documentElement.getAttribute('data-spatnav-handler-id');
                                    if (String(l) === e)
                                        try {
                                            (t.focus?.(), Oe(t, n));
                                        } catch {}
                                }, 120);
                            }, 0),
                            (n.dirty = !0),
                            o.preventDefault(),
                            o.stopPropagation(),
                            !0
                        );
                    })({
                        actionElement: d,
                        state: t,
                        event: e,
                        handlerId: n,
                        runtimeApi: h,
                        canRequestNativeClick: v,
                    })
                )
                    return;
                const w = v && b;
                Pe.debug('click strategy: ' + (w ? 'NATIVE' : 'JS .click()'), {
                    actionTag: f,
                    actionRole: p,
                    isMenuToggle: m,
                    runtimeMode: t.runtime?.mode,
                });
                const y = d.getBoundingClientRect(),
                    x = Me(y.left + y.width / 2, y.top + y.height / 2),
                    E = document.elementFromPoint(x.x, x.y) || d,
                    S = m ? d : E,
                    A = (function (e) {
                        const t = e.getBoundingClientRect(),
                            n = [
                                { label: 'center', x: t.left + t.width / 2, y: t.top + t.height / 2 },
                                { label: 'top-left', x: t.left + 1, y: t.top + 1 },
                                { label: 'top-right', x: t.right - 1, y: t.top + 1 },
                                { label: 'bottom-left', x: t.left + 1, y: t.bottom - 1 },
                                { label: 'bottom-right', x: t.right - 1, y: t.bottom - 1 },
                                { label: 'top-center', x: t.left + t.width / 2, y: t.top + 1 },
                                { label: 'bottom-center', x: t.left + t.width / 2, y: t.bottom - 1 },
                                { label: 'center-left', x: t.left + 1, y: t.top + t.height / 2 },
                                { label: 'center-right', x: t.right - 1, y: t.top + t.height / 2 },
                            ];
                        for (const t of n) {
                            const n = Me(t.x, t.y),
                                o = document.elementFromPoint(n.x, n.y);
                            if (Te(o, e)) return { x: n.x, y: n.y, label: t.label, hit: o };
                        }
                        const o = Me(n[0].x, n[0].y);
                        return { x: o.x, y: o.y, label: 'center', hit: document.elementFromPoint(o.x, o.y) };
                    })(S),
                    M = A.x,
                    T = A.y;
                Pe.debug('hit-test', {
                    action: oe(d),
                    clickTarget: oe(S),
                    actionCenter: { x: x.x, y: x.y, hit: oe(E) },
                    picked: { x: M, y: T, label: A.label, hit: oe(A.hit) },
                });
                const C = {
                    bubbles: !0,
                    cancelable: !0,
                    view: window,
                    clientX: M,
                    clientY: T,
                    buttons: 1,
                    detail: 1,
                };
                if (w) {
                    (!(function (e, t) {
                        if ('function' == typeof PointerEvent) {
                            const n = {
                                ...t,
                                pointerId: 1,
                                pointerType: 'touch',
                                isPrimary: !0,
                                button: 0,
                                pressure: 0,
                            };
                            (e.dispatchEvent(new PointerEvent('pointerover', n)),
                                e.dispatchEvent(new PointerEvent('pointerenter', n)));
                        }
                        (e.dispatchEvent(new MouseEvent('mouseover', t)),
                            e.dispatchEvent(new MouseEvent('mouseenter', t)));
                    })(S, C),
                        'function' == typeof i.focus && i.focus(),
                        Pe.debug('requesting native MotionEvent injection'));
                    const n = window.devicePixelRatio || 1,
                        o = M * n,
                        r = T * n;
                    Pe.debug('native injection request', {
                        css: { x: M, y: T, point: A.label },
                        dpr: n,
                        final: { x: o, y: r },
                    });
                    try {
                        const e = { type: 'simulateClick', x: o, y: r },
                            t = h.sendMessage;
                        if ('function' != typeof t) throw new Error('runtime.sendMessage unavailable');
                        if (g.browser?.runtime === h) {
                            const n = t(e);
                            n &&
                                'function' == typeof n.then &&
                                n
                                    .then((e) => {
                                        Pe.debug('background relay success (promise)', e);
                                    })
                                    .catch((e) => {
                                        Pe.error('background relay failed (promise)', e);
                                    });
                        } else
                            t(e, (e) => {
                                const t = h.lastError;
                                t
                                    ? Pe.error('background relay failed (lastError)', t)
                                    : Pe.debug('background relay success (callback)', e);
                            });
                    } catch (t) {
                        Pe.warn('native injection unavailable, falling back to JS .click()', t);
                        try {
                            'function' == typeof S.click ? S.click() : i.click();
                        } catch {
                            i.click();
                        }
                        return (e.preventDefault(), void e.stopPropagation());
                    }
                    return (Ve(t, i), e.preventDefault(), void e.stopPropagation());
                }
                !(function (e, t, n) {
                    if ('function' == typeof PointerEvent) {
                        const t = {
                            ...n,
                            pointerId: 1,
                            pointerType: 'touch',
                            isPrimary: !0,
                            button: 0,
                            pressure: 0.5,
                        };
                        (e.dispatchEvent(new PointerEvent('pointerover', t)),
                            e.dispatchEvent(new PointerEvent('pointerenter', t)),
                            e.dispatchEvent(new PointerEvent('pointerdown', t)));
                    }
                    if (
                        (e.dispatchEvent(new MouseEvent('mouseover', n)),
                        e.dispatchEvent(new MouseEvent('mouseenter', n)),
                        e.dispatchEvent(new MouseEvent('mousedown', n)),
                        'function' == typeof t.focus && t.focus(),
                        e.dispatchEvent(new MouseEvent('mouseup', n)),
                        'function' == typeof PointerEvent)
                    ) {
                        const t = {
                            ...n,
                            pointerId: 1,
                            pointerType: 'touch',
                            isPrimary: !0,
                            button: 0,
                            pressure: 0,
                        };
                        e.dispatchEvent(new PointerEvent('pointerup', t));
                    }
                })(S, i, C);
                try {
                    'function' == typeof S.click ? S.click() : i.click();
                } catch {
                    i.click();
                }
                (Ve(t, i), e.preventDefault(), e.stopPropagation());
            })(e, t, n);
        const f = h;
        if (!f[e.key]) return;
        Pe.debug(`directional key: ${e.key}`);
        const p = Date.now(),
            m = t.lastRefreshTime || 0;
        if (
            ((t.dirty || p - m > 150) && (re(t), (t.lastRefreshTime = p), (t.dirty = !1)),
            0 === t.focusables.length && (re(t), (t.lastRefreshTime = Date.now()), 0 === t.focusables.length))
        )
            return (Pe.debug('no focusable elements found'), e.preventDefault(), void e.stopPropagation());
        const b = (function (e) {
            if (e.config && !1 === e.config.autoRefocus) return ne();
            const t = ne();
            if (t && t instanceof HTMLElement && e.focusableElements.includes(t)) return t;
            const n = e.lastFocusedElement;
            if (n && e.focusableElements.includes(n) && Se(n, e))
                return ((e.currentIndex = e.focusableElements.indexOf(n)), n);
            xe.debug('focus lost, attempting recovery');
            const o = e.instrumentation?.lastOverlay;
            if (o) {
                const t = e.focusables.find((e) => oe(e.element) === o);
                if (t?.element && Se(t.element, e))
                    return (
                        xe.debug(`recovered via lastOverlay: ${o}`),
                        (e.currentIndex = e.focusableElements.indexOf(t.element)),
                        t.element
                    );
            }
            const r = e.lastFocusPosition,
                i = r ? Date.now() - r.timestamp : 1 / 0;
            if (r && i < 2e3 && e.focusables.length > 0) {
                xe.debug(`using position hint (${i}ms old)`);
                let t = null,
                    n = 1 / 0;
                for (const o of e.focusables) {
                    if (!o.rect) continue;
                    const e = o.centerX - r.centerX,
                        i = o.centerY - r.centerY,
                        a = Math.sqrt(e * e + i * i);
                    a < n && ((n = a), (t = o));
                }
                if (t?.element && Se(t.element, e))
                    return (
                        xe.debug(`position-based recovery: ${oe(t.element)} at ${n.toFixed(0)}px`),
                        (e.currentIndex = e.focusableElements.indexOf(t.element)),
                        (e.lastFocusPosition = null),
                        t.element
                    );
            }
            const a =
                'first' === (e.config?.refocusStrategy ?? 'closest')
                    ? e.focusables[0]
                    : e.focusables.find((e) => e.rect && A(e.rect, 0)) || e.focusables[0];
            return a?.element && Se(a.element, e)
                ? (xe.debug(`fallback recovery: ${oe(a.element)}`),
                  (e.currentIndex = e.focusableElements.indexOf(a.element)),
                  a.element)
                : null;
        })(t);
        if (!b)
            return (
                Pe.warn('unable to recover focus — aborting navigation'),
                e.preventDefault(),
                void e.stopPropagation()
            );
        const g = b,
            w = g ? t.focusableElements.indexOf(g) : -1;
        Pe.debug(`current focus: ${oe(g)} (index=${w})`);
        const y = V(w, pe, v, t);
        Pe.debug('next targets', {
            up: y.up?.data ? oe(y.up.data.element) : null,
            down: y.down?.data ? oe(y.down.data.element) : null,
            left: y.left?.data ? oe(y.left.data.element) : null,
            right: y.right?.data ? oe(y.right.data.element) : null,
        });
        const x = f[e.key];
        Pe.debug(`moving direction: ${x.name}`);
        const E = Ee(x, e, t),
            S = ne();
        if (E) (Pe.debug(`new focus: ${oe(S)}`), S && Oe(S, t));
        else if (
            (Pe.debug('movement failed — retrying with forced refresh'),
            re(t),
            (t.lastRefreshTime = Date.now()),
            Ee(x, e, t))
        ) {
            Pe.debug('retry succeeded');
            const e = ne();
            e && Oe(e, t);
        } else
            (Pe.debug(`boundary reached: ${x.name}`),
                (t.lastBoundary = x.name),
                e.preventDefault(),
                e.stopPropagation());
    }
    function Ve(e, t) {
        e.overlay &&
            (e.overlay.classList.remove('click-animate'),
            e.overlay.offsetWidth,
            e.overlay.classList.add('click-animate'),
            t.classList.add('spatnav-pressed'),
            setTimeout(() => {
                (e.overlay && e.overlay.classList.remove('click-animate'),
                    t.classList.remove('spatnav-pressed'));
            }, 150));
    }
    const Ge = a('Observer'),
        Ye = ['style', 'class', 'disabled', 'hidden', 'aria-hidden', 'tabindex', 'contenteditable'],
        He = [];
    let je = null;
    const Xe = {
        react: {
            name: 'React',
            detect: () => {
                const e = 'undefined' != typeof window && window.__REACT_DEVTOOLS_GLOBAL_HOOK__,
                    t = document.querySelector('[data-reactroot]'),
                    n = document.querySelector('[data-reactid]');
                return !!(e || t || n);
            },
            scheduleRefresh: (e) => {
                'undefined' != typeof scheduler && scheduler.postTask
                    ? scheduler.postTask(e, { priority: 'background' })
                    : 'undefined' != typeof requestIdleCallback
                      ? requestIdleCallback(e, { timeout: 200 })
                      : Promise.resolve().then(() => requestAnimationFrame(e));
            },
        },
        vue: {
            name: 'Vue',
            detect: () => {
                const e = 'undefined' != typeof window && window.__VUE__,
                    t = document.querySelector('[data-v-]'),
                    n = document.querySelector('.__vue_app__');
                return !!(e || t || n);
            },
            scheduleRefresh: (e) => {
                Promise.resolve().then(() => setTimeout(e, 50));
            },
        },
        angular: {
            name: 'Angular',
            detect: () => {
                const e =
                        'undefined' != typeof window &&
                        'function' == typeof window.getAllAngularTestabilities,
                    t = document.querySelector('[ng-version]'),
                    n = document.querySelector('app-root');
                return !!(e || t || n);
            },
            scheduleRefresh: (e) => {
                if ('function' == typeof window.getAllAngularTestabilities) {
                    const t = window.getAllAngularTestabilities();
                    if (t && t.length > 0) return void t[0].whenStable(e);
                }
                setTimeout(e, 100);
            },
        },
        svelte: {
            name: 'Svelte',
            detect: () => !('undefined' == typeof window || !document.querySelector('[class*="svelte-"]')),
            scheduleRefresh: (e) => {
                Promise.resolve().then(e);
            },
        },
    };
    function Ke(t) {
        if (0 === He.length) return;
        const n = t.config.mutationDebounce || 100;
        (je && clearTimeout(je),
            (je = setTimeout(() => {
                !(function (t) {
                    const n = ne();
                    if (!(n && n instanceof HTMLElement)) return;
                    const o = t.focusableElements.indexOf(n);
                    if (-1 === o) return;
                    const r = t.focusables[o];
                    r &&
                        r.rect &&
                        ((t.lastFocusPosition = {
                            centerX: r.centerX,
                            centerY: r.centerY,
                            top: r.top,
                            left: r.left,
                            elementDesc: oe(n),
                            timestamp: Date.now(),
                        }),
                        e &&
                            Ce.debug(
                                `Stored position hint: ${t.lastFocusPosition.elementDesc} at (${r.centerX.toFixed(0)}, ${r.centerY.toFixed(0)})`
                            ));
                })(t);
                const n = He.some((e) => 'childList' === e.type);
                ((t.dirty = !0),
                    (t.precomputedTargets = null),
                    (function (e, t) {
                        if (!t.config.frameworkAwareRefresh) return void e();
                        const n = (function (e) {
                            if (e.detectedFramework) return e.detectedFramework;
                            if (!1 === e.detectedFramework) return null;
                            for (const [, t] of Object.entries(Xe))
                                try {
                                    if (t.detect())
                                        return (
                                            Ge.debug(`detected framework: ${t.name}`),
                                            (e.detectedFramework = t),
                                            t
                                        );
                                } catch {}
                            return ((e.detectedFramework = !1), null);
                        })(t);
                        n ? n.scheduleRefresh(e) : e();
                    })(() => {
                        n
                            ? (Ge.debug('childList mutation → full refresh'), re(t))
                            : (Ge.debug('attribute mutation → incremental update'),
                              (function (e, t) {
                                  for (const n of t)
                                      if ('attributes' === n.type) {
                                          const t = n.target,
                                              o = e.focusableElements.indexOf(t);
                                          let r = !1;
                                          if (t.matches && t.matches(Z)) {
                                              const e = window.getComputedStyle(t),
                                                  n = e && 'hidden' !== e.visibility && 'none' !== e.display,
                                                  o = !t.disabled,
                                                  i = 'true' !== t.getAttribute('aria-hidden');
                                              r = n && o && i;
                                          }
                                          -1 === o && r
                                              ? ie(t, e)
                                              : -1 === o || r
                                                ? -1 !== o && S(e.focusables[o], e)
                                                : ae(o, e);
                                      }
                                  J.debug(`incremental refresh complete: ${e.focusables.length} focusables`);
                              })(t, He));
                        const e = ne();
                        e && t.focusableElements && t.focusableElements.includes(e)
                            ? Oe(e, t)
                            : t.overlay &&
                              (Ge.debug('current focus invalidated by mutation, hiding overlay'), B(t));
                    }, t),
                    (He.length = 0),
                    (je = null));
            }, n)));
    }
    function Ue(e) {
        if (e.mutationObserver) return;
        if (!1 === e.config.observeMutations) return void Ge.debug('mutation observer disabled by config');
        const t = new MutationObserver((t) => {
            const n = t.filter((e) =>
                'childList' === e.type
                    ? e.addedNodes.length > 0 || e.removedNodes.length > 0
                    : 'attributes' === e.type && Ye.includes(e.attributeName || '')
            );
            n.length > 0 && (He.push(...n), Ke(e));
        });
        (t.observe(document.body, { childList: !0, subtree: !0, attributes: !0, attributeFilter: Ye }),
            (e.mutationObserver = t),
            Ge.debug('mutation observer attached'));
    }
    const Je = a('Deprecation'),
        Ze = new Set();
    function Qe(e, t) {
        Ze.has(e) ||
            (Ze.add(e),
            Je.warn(`\`window.${e}\` is deprecated and will be removed in v4. Use \`window.${t}\` instead.`));
    }
    const et = a('Main');
    let tt = null;
    !(function () {
        window.__SPATIAL_NAV_INIT_COUNT__ = (window.__SPATIAL_NAV_INIT_COUNT__ || 0) + 1;
        const e = window.__SPATIAL_NAV_INIT_COUNT__;
        if (
            (et.debug(`init attempt #${e}`, {
                url: location.href.substring(0, 100),
                readyState: document.readyState,
                hasBody: !!document.body,
                isTop: window === window.top,
            }),
            window !== window.top)
        )
            return void et.debug('Skipping iframe', window.location.href.substring(0, 80));
        if ('about:blank' === location.href) return void et.debug('Skipping about:blank');
        if ('loading' === document.readyState && !document.body)
            return void et.debug('Skipping loading document without body');
        (document.documentElement.setAttribute('data-spatnav-init', String(e)),
            (window.__SPATIAL_NAV_INIT_COMPLETE__ = !0));
        const t = c(),
            n = (function (e) {
                const t = window.spatialNavState || window.flutterFocusState || {};
                return (
                    (window.spatialNavState = t),
                    (window.flutterFocusState = t),
                    (t.config = e),
                    (t.version = '3.0.0'),
                    (t.currentIndex = 'number' == typeof t.currentIndex ? t.currentIndex : -1),
                    (t.initialized = !!t.initialized),
                    (t.handlersAttached = !!t.handlersAttached),
                    (t.runtime = t.runtime || {
                        mode: 'injected',
                        hasBrowser: !1,
                        hasChrome: !1,
                        canConnect: !1,
                        canSendMessage: !1,
                    }),
                    (t.focusables = Array.isArray(t.focusables) ? t.focusables : []),
                    (t.focusableElements = Array.isArray(t.focusableElements) ? t.focusableElements : []),
                    (t.focusGroups = t.focusGroups || {}),
                    (t.lastRefreshTime = t.lastRefreshTime || 0),
                    (t.focusableCount = t.focusableCount || 0),
                    (t.previewEnabled = void 0 === t.previewEnabled || !!t.previewEnabled),
                    (t.previewElements = t.previewElements || null),
                    (t.previewLayer = t.previewLayer || null),
                    (t.overlay = t.overlay || null),
                    (t.overlayHost = t.overlayHost || null),
                    (t.activeResizeObserver = t.activeResizeObserver || null),
                    (t.updateTimer = t.updateTimer || null),
                    (t.overlaySuppressed = t.overlaySuppressed ?? !1),
                    (t.nextTargets = t.nextTargets || { up: null, down: null, left: null, right: null }),
                    (t.noTargetTimers = t.noTargetTimers || {
                        up: null,
                        down: null,
                        left: null,
                        right: null,
                    }),
                    (t.lastFocusedElement = t.lastFocusedElement || null),
                    (t.lastFocusPosition = t.lastFocusPosition || null),
                    (t.lastMove = t.lastMove || null),
                    (t.lastBoundary = t.lastBoundary || null),
                    (t.scrollCache = t.scrollCache || new WeakMap()),
                    (t.scrollListenerAttached = !!t.scrollListenerAttached),
                    (t.intersectionObserver = t.intersectionObserver || null),
                    (t.mutationObserver = t.mutationObserver || null),
                    (t.emitTitleOnMismatch = !!t.emitTitleOnMismatch),
                    (t.instrumentation = t.instrumentation || {
                        lastOverlay: '',
                        lastActive: '',
                        mismatchCount: 0,
                        overlayIndex: -1,
                        activeIndex: -1,
                        lastMismatch: null,
                        lastUpdate: 0,
                        lastDirection: '',
                    }),
                    (t.perf = t.perf || {
                        refreshCount: 0,
                        totalRefreshTime: 0,
                        averageRefreshTime: 0,
                        lastRefreshTime: 0,
                        slowRefreshCount: 0,
                    }),
                    (t.virtualContainers = t.virtualContainers || []),
                    (t.virtualSentinelObserver = t.virtualSentinelObserver || null),
                    (t.virtualScrollPending = !1),
                    (t.precomputedTargets = t.precomputedTargets || null),
                    (t.precomputedForIndex = t.precomputedForIndex ?? -1),
                    (t.precomputedTimestamp = t.precomputedTimestamp ?? 0),
                    (t.dirty = t.dirty ?? !1),
                    (t.announcer = t.announcer || null),
                    (t.currentTrap = t.currentTrap || null),
                    (t.detectedFramework = t.detectedFramework || null),
                    (t.handlerId = t.handlerId || 0),
                    t
                );
            })(t);
        if (
            ((n.version = '3.0.0'),
            (n.runtime = (function () {
                const e = globalThis,
                    t = void 0 !== e.browser && !!e.browser,
                    n = void 0 !== e.chrome && !!e.chrome,
                    o = e.browser?.runtime ?? e.chrome?.runtime;
                return {
                    mode: t || n ? 'webextension' : 'injected',
                    hasBrowser: t,
                    hasChrome: n,
                    canConnect: 'function' == typeof o?.connect,
                    canSendMessage: 'function' == typeof o?.sendMessage,
                };
            })()),
            et.info(`runtime mode: ${M(n.runtime)}`, n.runtime),
            et.info(`init v${n.version}`, location.href),
            (function (e) {
                if (tt) return tt;
                try {
                    if ('undefined' != typeof browser && browser?.runtime?.connect)
                        return (
                            (tt = browser.runtime.connect({ name: 'spatial-nav-content' })),
                            tt.onMessage.addListener((t) => {
                                (et.debug(`Message from background: ${be(t)}`),
                                    (function (e, t) {
                                        if (e && e.type)
                                            switch (e.type) {
                                                case 'configUpdate':
                                                    if (e.config) {
                                                        const n = g(e.config);
                                                        (Object.assign(t.config, n),
                                                            et.info('Config updated from native', n));
                                                    }
                                                    break;
                                                case 'navigate':
                                                    e.direction &&
                                                        v[e.direction] &&
                                                        Ee(v[e.direction], null, t);
                                                    break;
                                                case 'refresh':
                                                    re(t);
                                                    break;
                                                default:
                                                    et.debug('Unknown message type', e.type);
                                            }
                                    })(t, e));
                            }),
                            tt.onDisconnect.addListener(() => {
                                (et.debug('Background port disconnected'), (tt = null));
                            }),
                            et.debug('Connected to background script'),
                            tt
                        );
                } catch (e) {
                    et.debug('Background connection not available', e.message);
                }
            })(n),
            (function (e) {
                if (tt)
                    try {
                        return (tt.postMessage(e), !0);
                    } catch (e) {
                        (et.warn('Failed to post to background', e.message), (tt = null));
                    }
                try {
                    if ('undefined' != typeof browser && browser?.runtime?.sendNativeMessage)
                        return (browser.runtime.sendNativeMessage('flutter_geckoview', e), !0);
                } catch {}
            })({ type: 'spatialNavInit', version: n.version, url: location.href, timestamp: Date.now() }),
            F(),
            P(t, n),
            (function (e) {
                if (!e.config.enableAria) return;
                let t = document.getElementById('spatnav-announcer');
                (t ||
                    ((t = document.createElement('div')),
                    (t.id = 'spatnav-announcer'),
                    t.setAttribute('aria-live', 'polite'),
                    t.setAttribute('aria-atomic', 'true'),
                    t.setAttribute('role', 'status'),
                    (t.className = 'sr-only'),
                    (t.style.cssText =
                        'position: absolute !important;width: 1px !important;height: 1px !important;padding: 0 !important;margin: -1px !important;overflow: hidden !important;clip: rect(0, 0, 0, 0) !important;white-space: nowrap !important;border: 0 !important;'),
                    document.body.appendChild(t),
                    J.debug('accessibility announcer created')),
                    (e.announcer = t));
            })(n),
            re(n),
            ee(n),
            n.instrumentation)
        ) {
            const e = ne();
            ((n.instrumentation.lastActive = oe(e)), (n.instrumentation.activeIndex = n.currentIndex));
        }
        ((n.handlersAttached = !1),
            (function (e) {
                const t = document.documentElement.getAttribute(Le),
                    n = parseInt(t || '0', 10) + 1;
                document.documentElement.setAttribute(Le, String(n));
                const o = (Date.now() % 1e5) * 1e3 + 100 * n + Math.floor(100 * Math.random());
                if (e.handlersAttached) return void Pe.debug('state already has handlers, skipping');
                (document.documentElement.setAttribute(De, String(o)),
                    (e.handlerId = o),
                    (window.__SPATIAL_NAV_HANDLER_ID__ = o),
                    (window.__SPATIAL_NAV_KEYDOWN_COUNT__ = 0));
                const r = o;
                (window.addEventListener(
                    'keydown',
                    function (t) {
                        const n = document.documentElement.getAttribute(De);
                        String(r) === n && ze(t, e);
                    },
                    !0
                ),
                    window.addEventListener(
                        'focus',
                        function (t) {
                            const n = t.target;
                            n !== window && n !== document && (re(e), Oe(n, e));
                        },
                        !0
                    ),
                    (function (e) {
                        const t = e.config;
                        if (!1 === t.observeScroll)
                            return void Pe.debug('scroll listener disabled by config');
                        const n = new WeakMap();
                        let o = null;
                        (window.addEventListener(
                            'scroll',
                            (r) => {
                                o ||
                                    (o = requestAnimationFrame(() => {
                                        const i = r && r.target ? r.target : window;
                                        if (!i) return void (o = null);
                                        const a = i === document ? window : i,
                                            s = t.scrollThreshold || 8;
                                        let l, c;
                                        if (a === window) ((l = window.scrollY), (c = window.scrollX));
                                        else {
                                            if (void 0 === a.scrollTop) return void (o = null);
                                            ((l = a.scrollTop), (c = a.scrollLeft));
                                        }
                                        const u = n.get(a) || { scrollY: l, scrollX: c },
                                            d = Math.abs(l - u.scrollY),
                                            f = Math.abs(c - u.scrollX);
                                        if (d > s || f > s) {
                                            const t = ne();
                                            if (t && -1 !== e.currentIndex) {
                                                const n = e.focusables[e.currentIndex];
                                                if (n) {
                                                    const o = t.getBoundingClientRect();
                                                    ((n.left = o.left),
                                                        (n.top = o.top),
                                                        (n.right = o.right),
                                                        (n.bottom = o.bottom),
                                                        (n.centerX = o.left + o.width / 2),
                                                        (n.centerY = o.top + o.height / 2),
                                                        (n.rect = o),
                                                        Oe(t, e));
                                                }
                                            }
                                            n.set(a, { scrollY: l, scrollX: c });
                                        }
                                        o = null;
                                    }));
                            },
                            { capture: !0, passive: !0 }
                        ),
                            (e.scrollListenerAttached = !0));
                    })(e),
                    (e.handlersAttached = !0));
            })(n),
            Ue(n),
            (function (e) {
                ((window.flutterFocusDebug = window.flutterFocusDebug || {}),
                    (window.flutterFocusInstrumentation = e.instrumentation),
                    (window.flutterFocusDebug.move = function (t) {
                        const n = v[t];
                        if (!n) return !1;
                        re(e);
                        const o = Ee(n, null, e);
                        try {
                            document.title =
                                'focusDebugMove:' +
                                JSON.stringify({
                                    direction: t,
                                    moved: !!o,
                                    active: oe(ne()),
                                    timestamp: Date.now(),
                                });
                        } catch {}
                        return o;
                    }),
                    (window.flutterFocusDebug.setPreviewEnabled = function (t) {
                        if (((e.previewEnabled = !1 !== t), e.previewEnabled)) {
                            const t = ne();
                            t && G(t, 0, pe, v, oe, e);
                        } else (W(e), (e.nextTargets = { up: null, down: null, left: null, right: null }));
                        try {
                            document.title =
                                'focusPreviewToggle:' +
                                JSON.stringify({ enabled: e.previewEnabled, timestamp: Date.now() });
                        } catch {}
                        return e.previewEnabled;
                    }),
                    (window.flutterFocusDebug.previewTargets = function (t) {
                        const n = {};
                        w.forEach(function (t) {
                            const o = e.nextTargets && e.nextTargets[t];
                            n[t] = o && o.data && o.data.element ? oe(o.data.element) : '[blocked]';
                        });
                        try {
                            document.title =
                                'focusPreview:' +
                                JSON.stringify({ label: t || '', targets: n, timestamp: Date.now() });
                        } catch {}
                        return n;
                    }),
                    (window.flutterFocusDebug.snapshot = function (t) {
                        const n = e.instrumentation;
                        try {
                            document.title =
                                'focusInstrumentation:' +
                                JSON.stringify({
                                    label: t || '',
                                    lastOverlay: n.lastOverlay || '',
                                    lastActive: n.lastActive || '',
                                    mismatchCount: n.mismatchCount || 0,
                                    overlayIndex: 'number' == typeof n.overlayIndex ? n.overlayIndex : -1,
                                    activeIndex: 'number' == typeof n.activeIndex ? n.activeIndex : -1,
                                    focusableCount: e.focusableCount || 0,
                                    lastDirection: n.lastDirection || '',
                                    timestamp: Date.now(),
                                });
                        } catch {}
                        return n;
                    }),
                    (window.flutterSpatNavPerf = function () {
                        return e.perf || {};
                    }));
            })(n),
            (function (e) {
                if (!('navigate' in window)) {
                    if (
                        ((window.navigate = function (t) {
                            const n = v[t];
                            n && Ee(n, null, e);
                        }),
                        Element.prototype.spatialNavigationSearch ||
                            (Element.prototype.spatialNavigationSearch = function (t, n = {}) {
                                const o = v[t];
                                if (!o) return null;
                                const r = e.focusableElements.indexOf(this);
                                if (-1 === r) return null;
                                const i = pe(r, o, e);
                                return (
                                    i || et.debug(`spatialNavigationSearch: no candidate for ${o.name}`),
                                    i?.data.element ?? null
                                );
                            }),
                        !Element.prototype.focusableAreas)
                    ) {
                        const e =
                            'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';
                        Element.prototype.focusableAreas = function (t = { mode: 'visible' }) {
                            const n = Array.from(this.querySelectorAll(e));
                            return 'all' === t.mode
                                ? n
                                : n.filter((e) => {
                                      const t = window.getComputedStyle(e);
                                      if ('hidden' === t.visibility || 'none' === t.display) return !1;
                                      const n = e.getBoundingClientRect();
                                      return n.width > 0 && n.height > 0;
                                  });
                        };
                    }
                    (Element.prototype.getSpatialNavigationContainer ||
                        (Element.prototype.getSpatialNavigationContainer = function () {
                            let e = this;
                            for (; e && e !== document.documentElement; ) {
                                if (e.hasAttribute('data-focus-group')) return e;
                                const t = window.getComputedStyle(e),
                                    n = (t.overflow + t.overflowX + t.overflowY).toLowerCase();
                                if (n.includes('auto') || n.includes('scroll')) return e;
                                e = e.parentElement;
                            }
                            return document.documentElement;
                        }),
                        et.debug('WICG polyfill installed'));
                }
            })(n),
            (window.spatialNavState = n),
            (window.showSpatialNavOverlay = (e) => L(e, n)),
            (function (e, t) {
                try {
                    Object.defineProperty(window, 'flutterFocusState', {
                        configurable: !0,
                        enumerable: !0,
                        get: () => (Qe('flutterFocusState', 'spatialNavState'), e),
                        set: (e) => {
                            (Qe('flutterFocusState', 'spatialNavState'), (window.spatialNavState = e));
                        },
                    });
                } catch {
                    window.flutterFocusState = e;
                }
                window.flutterShowOverlay = (e) => {
                    (Qe('flutterShowOverlay', 'showSpatialNavOverlay'), t(e));
                };
            })(n, (e) => L(e, n)),
            L(null, n),
            (n.initialized = !0),
            et.info('initialization complete'));
        const o = (e) => {
            ((n.overlaySuppressed = !0),
                n.updateTimer && (cancelAnimationFrame(n.updateTimer), (n.updateTimer = null)),
                B(n),
                W(n),
                et.debug(`overlay suppressed (${e})`));
        };
        (window.addEventListener('blur', () => o('window.blur')),
            document.addEventListener('visibilitychange', () => {
                document.hidden && o('document.hidden');
            }),
            document.addEventListener('spatialNavigationExit', () => o('spatialNavigationExit')));
        let r = 0;
        window.addEventListener('pageshow', () => {
            const e = Date.now();
            e - r < 100
                ? et.debug('pageshow debounced')
                : ((r = e),
                  (function (e) {
                      const t = e.config,
                          n = !!document.getElementById('spatnav-focus-styles'),
                          o = !!document.getElementById('spatnav-focus-host'),
                          r = !!e.overlayHost && !!document.body && document.body.contains(e.overlayHost);
                      et.debug('pageshow audit', {
                          readyState: document.readyState,
                          hasStyle: n,
                          hasOverlayHost: o,
                          overlayAttached: r,
                          focusableCount: e.focusableCount,
                      });
                      const i = !n,
                          a = !o || !r;
                      i || a
                          ? (et.debug('pageshow: re-initializing', { needsStyles: i, needsOverlay: a }),
                            a && ((e.overlayHost = null), (e.overlay = null)),
                            i && F(),
                            a && P(t, e),
                            e.mutationObserver &&
                                (e.mutationObserver.disconnect(), (e.mutationObserver = null)),
                            Ue(e),
                            e.virtualSentinelObserver &&
                                (e.virtualSentinelObserver.disconnect(), (e.virtualSentinelObserver = null)),
                            ee(e),
                            re(e),
                            L(null, e))
                          : et.debug('pageshow: DOM intact, no re-init needed');
                  })(n));
        });
    })();
})();
