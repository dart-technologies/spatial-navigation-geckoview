/**
 * Runtime & platform detection.
 *
 * GeckoView can run this bundle either:
 *  - As a WebExtension content script (browser/chrome runtime APIs available)
 *  - As an injected script (no extension runtime APIs)
 *
 * Other hosts (ReactNative WebView, iOS WKWebView, Android WebView) expose
 * different globals — {@link detectPlatform} returns a discriminated enum so
 * the messaging factory can pick the right adapter.
 */

import type { RuntimeContext } from '../core/state';

// ---------------------------------------------------------------------------
// Platform enum (consumed by messaging/factory.ts)
// ---------------------------------------------------------------------------

/** Supported host environments for the messaging adapter factory. */
export type PlatformType =
    | 'geckoview' // GeckoView WebExtension
    | 'react-native' // react-native-webview (future)
    | 'wkwebview' // iOS WKWebView (future)
    | 'android-webview' // Android WebView (future)
    | 'standalone'; // No native host

interface GlobalHost {
    browser?: { runtime?: { connect?: unknown; sendMessage?: unknown; sendNativeMessage?: unknown } };
    chrome?: { runtime?: { connect?: unknown; sendMessage?: unknown; sendNativeMessage?: unknown } };
    ReactNativeWebView?: { postMessage?: unknown };
    webkit?: { messageHandlers?: unknown };
    SpatialNavBridge?: unknown;
}

function globalHost(): GlobalHost {
    return globalThis as unknown as GlobalHost;
}

/**
 * Detect the current host platform. Returns `'standalone'` when no native
 * host is available (e.g., plain web page in a non-extension browser).
 */
export function detectPlatform(): PlatformType {
    const g = globalHost();

    if (g.browser?.runtime?.connect || g.browser?.runtime?.sendNativeMessage) {
        return 'geckoview';
    }
    if (g.ReactNativeWebView?.postMessage) return 'react-native';
    if (g.webkit?.messageHandlers) return 'wkwebview';
    if (g.SpatialNavBridge) return 'android-webview';
    return 'standalone';
}

// ---------------------------------------------------------------------------
// Fine-grained runtime context (consumed by state / debug HUD)
// ---------------------------------------------------------------------------

/**
 * Build a detailed runtime-context object used by the debug HUD and the
 * {@link formatRuntimeLabel} instrumentation.
 */
export function detectRuntimeContext(): RuntimeContext {
    const g = globalHost();

    const hasBrowser = typeof g.browser !== 'undefined' && !!g.browser;
    const hasChrome = typeof g.chrome !== 'undefined' && !!g.chrome;

    const runtime = g.browser?.runtime ?? g.chrome?.runtime;
    const canConnect = typeof runtime?.connect === 'function';
    const canSendMessage = typeof runtime?.sendMessage === 'function';

    // If either browser/chrome exists, treat this as WebExtension mode.
    const mode: RuntimeContext['mode'] = hasBrowser || hasChrome ? 'webextension' : 'injected';

    return { mode, hasBrowser, hasChrome, canConnect, canSendMessage };
}

export function formatRuntimeLabel(context: RuntimeContext): string {
    if (context.mode === 'webextension') {
        const bridge = context.canSendMessage ? 'bridge:on' : 'bridge:off';
        return `WebExtension (${bridge})`;
    }
    return 'Injected (no bridge)';
}
