/**
 * GeckoView Messaging Adapter
 *
 * Implements native messaging for GeckoView WebExtension environment.
 * Uses browser.runtime.connect() for persistent connection to background script,
 * with fallback to browser.runtime.sendNativeMessage() for one-off messages.
 *
 * @see https://firefox-source-docs.mozilla.org/mobile/android/geckoview/consumer/web-extensions.html
 */

import { BaseMessagingAdapter } from './adapter';
import type { OutboundMessage, InboundMessage } from './types';

// GeckoView WebExtension API types
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
 * Native app identifier for GeckoView messaging.
 * Must match the value in the host application.
 */
const NATIVE_APP_ID = 'geckoview-spatial-nav';
const PORT_NAME = 'spatial-nav-content';

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
    private maxReconnectAttempts = 3;
    private reconnectDelay = 1000;

    isAvailable(): boolean {
        return typeof browser !== 'undefined' &&
            browser?.runtime !== undefined &&
            (typeof browser.runtime.connect === 'function' ||
             typeof browser.runtime.sendNativeMessage === 'function');
    }

    async connect(): Promise<void> {
        if (!this.isAvailable()) {
            throw new Error('GeckoView WebExtension API not available');
        }

        this.setState('connecting');

        try {
            if (browser?.runtime?.connect) {
                this.port = browser.runtime.connect({ name: PORT_NAME });

                this.port.onMessage.addListener((message) => {
                    this.handleMessage(message as InboundMessage);
                });

                this.port.onDisconnect.addListener(() => {
                    this.handleDisconnect();
                });

                this.setState('connected');
                this.reconnectAttempts = 0;
                this.flushQueue();

                console.log('[GeckoViewAdapter] Connected to background script');
            } else {
                // No persistent connection available, use sendNativeMessage
                this.setState('connected');
                console.log('[GeckoViewAdapter] Using sendNativeMessage mode (no persistent connection)');
            }
        } catch (error) {
            this.emitError(error as Error);
            throw error;
        }
    }

    disconnect(): void {
        this.port = null;
        this.messageQueue = [];
        this.setState('disconnected');
        console.log('[GeckoViewAdapter] Disconnected');
    }

    send(message: OutboundMessage): boolean {
        // Add timestamp if not present
        const fullMessage = {
            ...message,
            timestamp: message.timestamp ?? Date.now()
        };

        // Try persistent connection first
        if (this.port) {
            try {
                this.port.postMessage(fullMessage);
                return true;
            } catch (error) {
                console.warn('[GeckoViewAdapter] Port send failed:', error);
                this.port = null;
            }
        }

        // Fallback to sendNativeMessage
        if (browser?.runtime?.sendNativeMessage) {
            try {
                browser.runtime.sendNativeMessage(NATIVE_APP_ID, fullMessage);
                return true;
            } catch {
                // Queue for later
                this.queueMessage(fullMessage);
                return false;
            }
        }

        // Queue if not connected
        this.queueMessage(fullMessage);
        return false;
    }

    private handleMessage(message: InboundMessage): void {
        console.log('[GeckoViewAdapter] Message received:', message?.type);
        this.dispatchMessage(message);
    }

    private handleDisconnect(): void {
        console.log('[GeckoViewAdapter] Port disconnected');
        this.port = null;
        this.setState('disconnected');

        // Attempt reconnect
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            console.log(`[GeckoViewAdapter] Reconnect attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts}`);

            setTimeout(() => {
                this.connect().catch((error) => {
                    console.warn('[GeckoViewAdapter] Reconnect failed:', error);
                });
            }, this.reconnectDelay * this.reconnectAttempts);
        }
    }

    private queueMessage(message: OutboundMessage): void {
        this.messageQueue.push(message);
        // Prevent unbounded growth
        if (this.messageQueue.length > 100) {
            this.messageQueue.shift();
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
