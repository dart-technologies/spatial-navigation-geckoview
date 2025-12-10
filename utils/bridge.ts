/**
 * Bridge messaging utilities for Spatial Navigation System
 *
 * Centralizes browser/chrome runtime messaging with consistent
 * Promise/callback handling and error formatting.
 */

import { createLogger } from './logger';
import { safeJson } from './json';

const log = createLogger('Bridge');

/**
 * Result of a bridge message send operation.
 */
export interface BridgeResult<T = unknown> {
    success: boolean;
    response?: T;
    error?: string;
}

/**
 * Runtime API type (browser.runtime or chrome.runtime equivalent).
 */
export interface RuntimeApi {
    sendMessage: (message: unknown, callback?: (response: unknown) => void) => unknown;
    lastError?: Error | null;
}

/**
 * Get the runtime API (browser.runtime or chrome.runtime).
 * Returns null if no extension bridge is available.
 */
export function getRuntimeApi(): RuntimeApi | null {
    const globalAny = globalThis as {
        browser?: { runtime?: RuntimeApi };
        chrome?: { runtime?: RuntimeApi };
    };

    const runtime = globalAny.browser?.runtime ?? globalAny.chrome?.runtime;
    if (!runtime || typeof runtime.sendMessage !== 'function') {
        return null;
    }
    return runtime;
}

/**
 * Check if the extension bridge is available for sending messages.
 */
export function canSendMessage(): boolean {
    return getRuntimeApi() !== null;
}

/**
 * Check if this is running as a Firefox-style extension (Promise API).
 */
export function isFirefoxStyle(): boolean {
    const globalAny = globalThis as {
        browser?: { runtime?: unknown };
        chrome?: { runtime?: unknown };
    };
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
export async function sendBridgeMessage<T = unknown>(
    message: unknown,
    options: { debug?: boolean } = {}
): Promise<BridgeResult<T>> {
    const runtime = getRuntimeApi();
    if (!runtime) {
        if (options.debug) {
            log.debug('No extension bridge available');
        }
        return { success: false, error: 'No extension bridge available' };
    }

    try {
        if (options.debug) {
            log.debug(`Sending message: ${safeJson(message)}`);
        }

        if (isFirefoxStyle()) {
            // Firefox-style Promise API
            const result = runtime.sendMessage(message) as Promise<T> | undefined;
            if (result && typeof (result as Promise<T>).then === 'function') {
                try {
                    const response = await result;
                    if (options.debug) {
                        log.debug(`Response (promise): ${safeJson(response)}`);
                    }
                    return { success: true, response };
                } catch (error) {
                    const errorMessage = formatBridgeError(error);
                    log.error(`Bridge error (promise): ${errorMessage}`);
                    return { success: false, error: errorMessage };
                }
            }
            return { success: true };
        } else {
            // Chrome-style callback API
            return new Promise((resolve) => {
                runtime.sendMessage(message, (response: T) => {
                    const runtimeWithError = runtime as typeof runtime & { lastError?: Error | null };
                    const lastError = runtimeWithError.lastError;
                    if (lastError) {
                        const errorMessage = formatBridgeError(lastError);
                        log.error(`Bridge error (callback): ${errorMessage}`);
                        resolve({ success: false, error: errorMessage });
                    } else {
                        if (options.debug) {
                            log.debug(`Response (callback): ${safeJson(response)}`);
                        }
                        resolve({ success: true, response });
                    }
                });
            });
        }
    } catch (error) {
        const errorMessage = formatBridgeError(error);
        log.error(`Bridge exception: ${errorMessage}`);
        return { success: false, error: errorMessage };
    }
}

/**
 * Format bridge error for consistent logging.
 */
function formatBridgeError(error: unknown): string {
    if (error instanceof Error) {
        return `${error.name}: ${error.message}`;
    }
    if (typeof error === 'object' && error !== null && 'message' in error) {
        return String((error as { message: unknown }).message);
    }
    return String(error);
}

/**
 * Send a simulate click message to the native layer.
 *
 * @param x - Physical pixel X coordinate
 * @param y - Physical pixel Y coordinate
 * @param debug - Optional debug info
 */
export async function sendSimulateClick(
    x: number,
    y: number,
    debug?: Record<string, unknown>
): Promise<BridgeResult> {
    const message: { type: string; x: number; y: number; debug?: Record<string, unknown> } = {
        type: 'simulateClick',
        x,
        y
    };
    if (debug) {
        message.debug = debug;
    }
    return sendBridgeMessage(message, { debug: !!debug });
}

/**
 * Send a focus exit message to the native layer.
 * Falls back to alert() when no extension bridge is available (injected scripts).
 *
 * @param direction - Exit direction (up, down, left, right)
 * @param inTrap - Whether focus is in a trap (dialog, modal)
 * @param options - Optional configuration
 */
export async function sendFocusExit(
    direction: string,
    inTrap: boolean,
    options: { useFallback?: boolean } = { useFallback: true }
): Promise<BridgeResult> {
    // Check if bridge is available
    if (!canSendMessage()) {
        // Fallback for injected scripts (no extension context)
        if (options.useFallback) {
            try {
                // Use globalThis.alert to ensure we use the mocked version in tests
                (globalThis as { alert?: (msg: string) => void }).alert?.(`__FOCUS_EXIT__:${direction}`);
            } catch {
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
