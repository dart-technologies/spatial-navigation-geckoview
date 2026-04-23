/**
 * GeckoView Messaging Adapter
 *
 * Implements native messaging for the GeckoView WebExtension environment.
 * Uses `browser.runtime.connect()` for a persistent connection to the
 * background script, falling back to `browser.runtime.sendNativeMessage()`
 * for one-shot messages when no persistent channel is available.
 *
 * Reconnect strategy:
 *   - Each disconnect schedules a reconnect with exponential backoff
 *   - Backoff is capped at MAX_RECONNECT_DELAY_MS (30s) to prevent
 *     unbounded growth on a flapping native side
 *   - Outbound queue is bounded at MAX_QUEUE_SIZE so a long disconnect
 *     can't blow up memory
 *
 * @see https://firefox-source-docs.mozilla.org/mobile/android/geckoview/consumer/web-extensions.html
 */

import { BaseMessagingAdapter } from './adapter';
import { createLogger } from '../utils/logger';
import type { OutboundMessage, InboundMessage } from './types';

const log = createLogger('Messaging');

interface BrowserPort {
    postMessage: (message: unknown) => void;
    onMessage: { addListener: (callback: (message: unknown) => void) => void };
    onDisconnect: { addListener: (callback: () => void) => void };
}

interface BrowserRuntime {
    connect?: (options: { name: string }) => BrowserPort;
    sendNativeMessage?: (appId: string, message: unknown) => Promise<unknown>;
    connectNative?: (appId: string) => BrowserPort;
}

declare const browser: { runtime?: BrowserRuntime } | undefined;

/**
 * Safe accessor for the WebExtension `browser` global. In standalone/test
 * environments the global may be entirely absent — `typeof` guards against
 * `ReferenceError` that would otherwise be thrown by direct access.
 */
function getBrowser(): { runtime?: BrowserRuntime } | undefined {
    if (typeof browser !== 'undefined') return browser;
    return undefined;
}

/** Default native app identifier — override via constructor options. */
const DEFAULT_NATIVE_APP_ID = 'flutter_geckoview';
const PORT_NAME = 'spatial-nav-content';

export interface GeckoViewMessagingAdapterOptions {
    /** Native-messaging app id registered on the host side. */
    nativeAppId?: string;
}

/** Cap reconnect backoff so a flapping native peer doesn't push delay to infinity. */
const MAX_RECONNECT_DELAY_MS = 30_000;

/** Initial reconnect backoff (doubled on each failure, capped at MAX_RECONNECT_DELAY_MS). */
const INITIAL_RECONNECT_DELAY_MS = 1_000;

/** Maximum reconnect attempts before giving up entirely. */
const MAX_RECONNECT_ATTEMPTS = 6;

/** Outbound queue size — drops oldest message past this. */
const MAX_QUEUE_SIZE = 100;

/**
 * GeckoView WebExtension messaging adapter.
 *
 * Connects to the background script which relays messages to the native app.
 */
export class GeckoViewMessagingAdapter extends BaseMessagingAdapter {
    readonly id = 'geckoview';
    readonly name = 'GeckoView WebExtension';

    private port: BrowserPort | null = null;
    private messageQueue: OutboundMessage[] = [];
    private reconnectAttempts = 0;
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    private readonly nativeAppId: string;

    constructor(options: GeckoViewMessagingAdapterOptions = {}) {
        super();
        this.nativeAppId = options.nativeAppId ?? DEFAULT_NATIVE_APP_ID;
    }

    isAvailable(): boolean {
        const b = getBrowser();
        return (
            b?.runtime !== undefined &&
            (typeof b.runtime.connect === 'function' || typeof b.runtime.sendNativeMessage === 'function')
        );
    }

    async connect(): Promise<void> {
        if (!this.isAvailable()) {
            throw new Error('GeckoView WebExtension API not available');
        }

        this.setState('connecting');

        try {
            const b = getBrowser();
            if (b?.runtime?.connect) {
                this.port = b.runtime.connect({ name: PORT_NAME });

                this.port.onMessage.addListener((message) => {
                    this.handleMessage(message as InboundMessage);
                });

                this.port.onDisconnect.addListener(() => {
                    this.handleDisconnect();
                });

                this.setState('connected');
                this.reconnectAttempts = 0;
                this.flushQueue();

                log.debug('connected to background script');
            } else {
                // No persistent connection — `sendNativeMessage` only.
                this.setState('connected');
                log.debug('using sendNativeMessage mode (no persistent connection)');
            }
        } catch (error) {
            this.emitError(error as Error);
            throw error;
        }
    }

    disconnect(): void {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        this.port = null;
        this.messageQueue = [];
        this.reconnectAttempts = 0;
        this.setState('disconnected');
        log.debug('disconnected');
    }

    send(message: OutboundMessage): boolean {
        const fullMessage = {
            ...message,
            timestamp: message.timestamp ?? Date.now(),
        };

        // Try persistent connection first.
        if (this.port) {
            try {
                this.port.postMessage(fullMessage);
                return true;
            } catch (error) {
                log.warn('port send failed, falling back', error);
                this.port = null;
            }
        }

        // Fallback to sendNativeMessage.
        const b = getBrowser();
        if (b?.runtime?.sendNativeMessage) {
            try {
                b.runtime.sendNativeMessage(this.nativeAppId, fullMessage);
                return true;
            } catch {
                this.queueMessage(fullMessage);
                return false;
            }
        }

        // Not connected — queue.
        this.queueMessage(fullMessage);
        return false;
    }

    private handleMessage(message: InboundMessage): void {
        log.debug('message received', message?.type);
        this.dispatchMessage(message);
    }

    private handleDisconnect(): void {
        log.debug('port disconnected');
        this.port = null;
        this.setState('disconnected');

        if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
            log.warn(`max reconnect attempts (${MAX_RECONNECT_ATTEMPTS}) reached — giving up`);
            return;
        }

        this.reconnectAttempts++;

        // Exponential backoff capped at MAX_RECONNECT_DELAY_MS.
        const exponentialDelay = INITIAL_RECONNECT_DELAY_MS * Math.pow(2, this.reconnectAttempts - 1);
        const cappedDelay = Math.min(exponentialDelay, MAX_RECONNECT_DELAY_MS);

        log.debug(
            `reconnect attempt ${this.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS} in ${cappedDelay}ms`
        );

        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this.connect().catch((error) => {
                log.warn('reconnect failed', error);
            });
        }, cappedDelay);
    }

    private queueMessage(message: OutboundMessage): void {
        this.messageQueue.push(message);
        if (this.messageQueue.length > MAX_QUEUE_SIZE) {
            const dropped = this.messageQueue.shift();
            log.debug('queue full, dropped oldest message', dropped?.type);
        }
    }

    private flushQueue(): void {
        while (this.messageQueue.length > 0) {
            const message = this.messageQueue.shift();
            if (message) {
                this.send(message);
            }
        }
    }
}
