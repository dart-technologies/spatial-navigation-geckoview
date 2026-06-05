/**
 * Background script for the Spatial Navigation extension.
 *
 * Acts as a bridge between the content script and the native layer. We need
 * this relay because direct `nativeMessaging` from content scripts can be
 * unreliable or restricted in some GeckoView configurations.
 *
 * Hardening:
 *  - Only known outbound message types (OUTBOUND_MESSAGE_TYPES) from the same
 *    extension are forwarded; anything else is dropped before reaching native.
 *  - The native host is chosen from the hard-coded NATIVE_APP_IDS allowlist by
 *    probe-and-lock — never from page-controlled input.
 *  - Log lines carry the message TYPE only, never the (potentially sensitive)
 *    message/response bodies.
 */

import { createLogger } from './utils/logger';
import { createNativeSender } from './messaging/native-host';
import { OUTBOUND_MESSAGE_TYPES } from './messaging/types';
import type { BrowserRuntime } from './globals';

const log = createLogger('Background');

/** Known outbound message types — anything else is dropped, not relayed. */
const ALLOWED_TYPES = new Set<string>(OUTBOUND_MESSAGE_TYPES);

/** Probe-and-lock native sender shared across all relayed messages. */
const sendToNative = createNativeSender();

interface SendResponse {
    (response: { success: boolean; nativeUser?: unknown; error?: string }): void;
}

/**
 * Same-extension sender check. Rejects only a DEFINITE foreign sender: when the
 * runtime does not populate `id` (some GeckoView builds, test envs) we treat the
 * message as same-extension so the relay keeps working. `runtime.onMessage` is
 * not reachable by web pages without `externally_connectable` (not set), so this
 * is defense-in-depth.
 */
function isForeignSender(runtime: BrowserRuntime, sender: unknown): boolean {
    const senderId = (sender as { id?: string } | null)?.id;
    const ownId = (runtime as { id?: string }).id;
    return typeof senderId === 'string' && typeof ownId === 'string' && senderId !== ownId;
}

try {
    const runtime = browser?.runtime as BrowserRuntime | undefined;
    if (!runtime?.onMessage?.addListener) {
        log.warn('browser.runtime.onMessage unavailable — background relay inert');
    } else {
        runtime.onMessage.addListener((message: unknown, sender: unknown, sendResponse: SendResponse) => {
            const type = (message as { type?: unknown } | null)?.type;
            log.debug(`received message: ${typeof type === 'string' ? type : '<no-type>'}`);

            // Reject unknown message types before they reach the native host.
            if (typeof type !== 'string' || !ALLOWED_TYPES.has(type)) {
                log.warn(`dropping message with unknown type: ${String(type)}`);
                sendResponse({ success: false, error: 'unknown message type' });
                return true;
            }

            // Reject a definitively foreign sender.
            if (isForeignSender(runtime, sender)) {
                log.warn('dropping message from foreign sender');
                sendResponse({ success: false, error: 'sender not allowed' });
                return true;
            }

            try {
                const sendNative = runtime.sendNativeMessage;
                if (typeof sendNative !== 'function') {
                    log.error('sendNativeMessage unavailable on browser.runtime');
                    sendResponse({ success: false, error: 'sendNativeMessage unavailable' });
                    return true;
                }

                sendToNative(sendNative, message)
                    .then((response: unknown) => {
                        log.debug(`native response for ${type}`);
                        sendResponse({ success: true, nativeUser: response });
                    })
                    .catch((error: unknown) => {
                        const messageText =
                            error instanceof Error
                                ? `${error.name}: ${error.message}`
                                : typeof (error as { message?: string })?.message === 'string'
                                  ? (error as { message: string }).message
                                  : String(error);
                        log.error(`native relay error: ${messageText}`);
                        sendResponse({
                            success: false,
                            error: (error as { message?: string })?.message || String(error),
                        });
                    });
            } catch (e) {
                // Log the message only (never the raw error object) so the relay
                // cannot leak structured data attached to a thrown value — matches
                // the async `.catch` path above.
                const messageText = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
                log.error(`exception relaying to native: ${messageText}`);
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
