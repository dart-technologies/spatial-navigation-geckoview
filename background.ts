/**
 * Background script for the Spatial Navigation extension.
 *
 * Acts as a bridge between the content script and the native layer. We need
 * this relay because direct `nativeMessaging` from content scripts can be
 * unreliable or restricted in some GeckoView configurations.
 */

import { safeJson } from './utils/json';
import { createLogger } from './utils/logger';
import type { BrowserRuntime } from './globals';

const log = createLogger('Background');

/** Native app identifier — must match the value registered in the host. */
const NATIVE_APP_ID = 'flutter_geckoview';

interface SendResponse {
    (response: { success: boolean; nativeUser?: unknown; error?: string }): void;
}

try {
    const runtime = browser?.runtime as BrowserRuntime | undefined;
    if (!runtime?.onMessage?.addListener) {
        log.warn('browser.runtime.onMessage unavailable — background relay inert');
    } else {
        runtime.onMessage.addListener((message: unknown, _sender: unknown, sendResponse: SendResponse) => {
            log.debug(`received message: ${safeJson(message)}`);

            try {
                const sendNative = runtime.sendNativeMessage;
                if (typeof sendNative !== 'function') {
                    log.error('sendNativeMessage unavailable on browser.runtime');
                    sendResponse({ success: false, error: 'sendNativeMessage unavailable' });
                    return true;
                }

                sendNative(NATIVE_APP_ID, message)
                    .then((response: unknown) => {
                        log.debug(`native response: ${safeJson(response)}`);
                        sendResponse({ success: true, nativeUser: response });
                    })
                    .catch((error: unknown) => {
                        const messageText =
                            error instanceof Error
                                ? `${error.name}: ${error.message}`
                                : typeof (error as { message?: string })?.message === 'string'
                                  ? (error as { message: string }).message
                                  : String(error);
                        log.error(`native relay error: ${messageText}`, error);
                        sendResponse({
                            success: false,
                            error: (error as { message?: string })?.message || String(error),
                        });
                    });
            } catch (e) {
                log.error('exception relaying to native', e);
                sendResponse({ success: false, error: (e as Error)?.message || String(e) });
            }

            // Returning true keeps the channel open for the async sendResponse.
            return true;
        });
        log.debug('background relay listener registered');
    }
} catch (e) {
    log.error('error registering relay listener', e);
}
