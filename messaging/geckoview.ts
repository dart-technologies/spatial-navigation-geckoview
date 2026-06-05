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
import { createNativeSender } from './native-host';
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

const PORT_NAME = 'spatial-nav-content';

/**
 * Runtime type guard for messages arriving on the native port. The native host
 * is trusted, so this is defense-in-depth: a malformed payload (missing or
 * non-string `type`) is dropped at the boundary instead of being cast and
 * dispatched downstream.
 */
function isInboundMessage(message: unknown): message is InboundMessage {
    return (
        typeof message === 'object' &&
        message !== null &&
        typeof (message as { type?: unknown }).type === 'string'
    );
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

    /** Probe-and-lock sender over the hard-coded native-app-id allowlist. */
    private readonly sendToNative = createNativeSender();

    constructor() {
        super();
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
                    if (!isInboundMessage(message)) {
                        log.warn('dropping malformed inbound message');
                        return;
                    }
                    this.handleMessage(message);
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

        // Fallback to sendNativeMessage, selecting the host from the hard-coded
        // NATIVE_APP_IDS allowlist via probe-and-lock (never page-controlled).
        //
        // `sendToNative` is promise-returning, so a synchronous try/catch only
        // catches launch-path errors (e.g. the API throws synchronously). The
        // async failure case (native host not installed, runtime rejects the
        // message) lands as a promise rejection — we attach `.catch` so the
        // message gets queued for retry and we never leak an unhandled rejection.
        const b = getBrowser();
        const runtime = b?.runtime;
        if (runtime?.sendNativeMessage) {
            // Bound closure preserves `this === runtime` for the native call.
            const sendNative = (appId: string, msg: unknown) => runtime.sendNativeMessage!(appId, msg);
            try {
                this.sendToNative(sendNative, fullMessage).catch((err) => {
                    log.warn('sendNativeMessage rejected, requeueing', err);
                    this.queueMessage(fullMessage);
                });
                return true;
            } catch (err) {
                log.warn('sendNativeMessage threw, requeueing', err);
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
