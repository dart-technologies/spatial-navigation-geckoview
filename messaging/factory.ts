/**
 * Messaging Adapter Factory
 *
 * Auto-detects the runtime environment and creates the appropriate
 * messaging adapter for communicating with the native host.
 */

import type { MessagingAdapter } from './adapter';
import { GeckoViewMessagingAdapter } from './geckoview';
import { NoopMessagingAdapter } from './noop';

/**
 * Supported platform types.
 */
export type PlatformType =
    | 'geckoview'      // GeckoView WebExtension
    | 'react-native'   // react-native-webview (future)
    | 'wkwebview'      // iOS WKWebView (future)
    | 'android-webview' // Android WebView (future)
    | 'standalone';    // No native host

/**
 * Detect the current platform based on available APIs.
 */
export function detectPlatform(): PlatformType {
    // Check for GeckoView WebExtension API
    if (typeof browser !== 'undefined') {
        const b = browser as { runtime?: { connect?: unknown; sendNativeMessage?: unknown } };
        if (b?.runtime?.connect || b?.runtime?.sendNativeMessage) {
            return 'geckoview';
        }
    }

    // Check for React Native WebView
    if (typeof window !== 'undefined') {
        const w = window as { ReactNativeWebView?: { postMessage?: unknown } };
        if (w.ReactNativeWebView?.postMessage) {
            return 'react-native';
        }
    }

    // Check for iOS WKWebView
    if (typeof window !== 'undefined') {
        const w = window as { webkit?: { messageHandlers?: unknown } };
        if (w.webkit?.messageHandlers) {
            return 'wkwebview';
        }
    }

    // Check for Android WebView JavascriptInterface
    if (typeof window !== 'undefined') {
        const w = window as { SpatialNavBridge?: unknown };
        if (w.SpatialNavBridge) {
            return 'android-webview';
        }
    }

    return 'standalone';
}

/**
 * Configuration options for adapter creation.
 */
export interface AdapterOptions {
    /**
     * Force a specific platform instead of auto-detecting.
     */
    platform?: PlatformType;

    /**
     * Enable verbose logging for no-op adapter.
     */
    verbose?: boolean;
}

/**
 * Create a messaging adapter for the current environment.
 *
 * @param options - Configuration options
 * @returns A messaging adapter instance
 */
export function createMessagingAdapter(options: AdapterOptions = {}): MessagingAdapter {
    const platform = options.platform ?? detectPlatform();

    switch (platform) {
        case 'geckoview':
            return new GeckoViewMessagingAdapter();

        case 'react-native':
            // TODO: Implement ReactNativeMessagingAdapter
            console.warn('[MessagingFactory] react-native adapter not yet implemented, using noop');
            return new NoopMessagingAdapter(options.verbose);

        case 'wkwebview':
            // TODO: Implement WKWebViewMessagingAdapter
            console.warn('[MessagingFactory] wkwebview adapter not yet implemented, using noop');
            return new NoopMessagingAdapter(options.verbose);

        case 'android-webview':
            // TODO: Implement AndroidWebViewMessagingAdapter
            console.warn('[MessagingFactory] android-webview adapter not yet implemented, using noop');
            return new NoopMessagingAdapter(options.verbose);

        case 'standalone':
        default:
            return new NoopMessagingAdapter(options.verbose);
    }
}

// Declare browser for TypeScript
declare const browser: unknown;
