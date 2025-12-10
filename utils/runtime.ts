/**
 * Runtime context detection (Injected script vs WebExtension).
 *
 * GeckoView can run this bundle either:
 * - As a WebExtension content script (browser/chrome runtime APIs available)
 * - As an injected script (no extension runtime APIs)
 */

import type { RuntimeContext } from '../core/state';

export function detectRuntimeContext(): RuntimeContext {
    const globalAny = globalThis as any;

    const hasBrowser = typeof globalAny.browser !== 'undefined' && !!globalAny.browser;
    const hasChrome = typeof globalAny.chrome !== 'undefined' && !!globalAny.chrome;

    const runtime = globalAny.browser?.runtime ?? globalAny.chrome?.runtime;
    const canConnect = typeof runtime?.connect === 'function';
    const canSendMessage = typeof runtime?.sendMessage === 'function';

    // If either browser/chrome exists, treat this as WebExtension mode.
    const mode: RuntimeContext['mode'] = (hasBrowser || hasChrome) ? 'webextension' : 'injected';

    return {
        mode,
        hasBrowser,
        hasChrome,
        canConnect,
        canSendMessage
    };
}

export function formatRuntimeLabel(context: RuntimeContext): string {
    if (context.mode === 'webextension') {
        const bridge = context.canSendMessage ? 'bridge:on' : 'bridge:off';
        return `WebExtension (${bridge})`;
    }
    return 'Injected (no bridge)';
}

