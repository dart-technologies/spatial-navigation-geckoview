/**
 * Background script for Spatial Navigation Extension
 * 
 * Acts as a bridge between Content Script and Native Layer.
 * Required because direct nativeMessaging from content scripts can be unreliable
 * or restricted in some GeckoView configurations.
 */

/// <reference path="./globals.d.ts" />

// console.log('[SpatialNav-BG] Background script loaded');

import { safeJson } from './utils/json';

try {
    (browser.runtime as any).onMessage.addListener((message: any, sender: any, sendResponse: (response: any) => void) => {
        console.log(`[SpatialNav-BG] Received message: ${safeJson(message)}`);

        // Forward ALL messages to Native Layer
        // Native App ID must match what is registered in Kotlin ('flutter_geckoview')
        try {
            const nativeApi = (browser.runtime as any).sendNativeMessage;
            if (typeof nativeApi !== 'function') {
                console.error('[SpatialNav-BG] sendNativeMessage unavailable on browser.runtime');
                sendResponse({ success: false, error: 'sendNativeMessage unavailable' });
                return true;
            }

            nativeApi('flutter_geckoview', message)
                .then((response: any) => {
                    console.log(`[SpatialNav-BG] Native response: ${safeJson(response)}`);
                    sendResponse({ success: true, nativeUser: response });
                })
                .catch((error: any) => {
                    const messageText = (error instanceof Error)
                        ? `${error.name}: ${error.message}`
                        : (typeof error?.message === 'string' ? error.message : String(error));
                    console.error(`[SpatialNav-BG] Native relay error: ${messageText} ${safeJson(error)}`);
                    sendResponse({ success: false, error: error?.message || error });
                });
        } catch (e) {
            console.error(`[SpatialNav-BG] Exception relaying to native: ${safeJson(e)}`);
            sendResponse({ success: false, error: (e as any)?.message || String(e) });
        }

        // Return true to indicate we will sendResponse asynchronously
        return true;
    });
    // console.log('[SpatialNav-BG] Registered generic onMessage relay listener');
} catch (e) {
    console.error('[SpatialNav-BG] Error registering relay listener:', e);
}
