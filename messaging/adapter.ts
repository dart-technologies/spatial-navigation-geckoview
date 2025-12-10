/**
 * Abstract Messaging Adapter Interface
 *
 * Defines the contract for native messaging implementations.
 * Allows spatial navigation to work with different webview hosts:
 * - GeckoView (WebExtension API)
 * - react-native-webview (postMessage bridge)
 * - WKWebView (webkit.messageHandlers)
 * - Android WebView (JavascriptInterface)
 */

import type {
    OutboundMessage,
    InboundMessage,
    MessageCallback,
    ConnectionState,
    MessagingEvents
} from './types';

/**
 * Abstract messaging adapter interface.
 *
 * Implementations handle the platform-specific details of
 * communicating between the web content and the native host.
 */
export interface MessagingAdapter {
    /**
     * Unique identifier for this adapter type.
     */
    readonly id: string;

    /**
     * Human-readable name for logging.
     */
    readonly name: string;

    /**
     * Current connection state.
     */
    readonly state: ConnectionState;

    /**
     * Initialize the adapter and establish connection.
     * @returns Promise that resolves when connected or rejects on failure.
     */
    connect(): Promise<void>;

    /**
     * Disconnect and clean up resources.
     */
    disconnect(): void;

    /**
     * Send a message to the native layer.
     * @param message - The message to send.
     * @returns True if message was sent successfully.
     */
    send(message: OutboundMessage): boolean;

    /**
     * Register a callback for incoming messages.
     * @param callback - Function to call when message is received.
     * @returns Unsubscribe function.
     */
    onMessage(callback: MessageCallback): () => void;

    /**
     * Register event listeners.
     * @param events - Event handlers to register.
     */
    on(events: Partial<MessagingEvents>): void;

    /**
     * Check if the adapter is available in the current environment.
     * @returns True if the adapter can be used.
     */
    isAvailable(): boolean;
}

/**
 * Base class with common functionality for messaging adapters.
 */
export abstract class BaseMessagingAdapter implements MessagingAdapter {
    abstract readonly id: string;
    abstract readonly name: string;

    protected _state: ConnectionState = 'disconnected';
    protected messageCallbacks: Set<MessageCallback> = new Set();
    protected eventHandlers: Partial<MessagingEvents> = {};

    get state(): ConnectionState {
        return this._state;
    }

    abstract connect(): Promise<void>;
    abstract disconnect(): void;
    abstract send(message: OutboundMessage): boolean;
    abstract isAvailable(): boolean;

    onMessage(callback: MessageCallback): () => void {
        this.messageCallbacks.add(callback);
        return () => {
            this.messageCallbacks.delete(callback);
        };
    }

    on(events: Partial<MessagingEvents>): void {
        this.eventHandlers = { ...this.eventHandlers, ...events };
    }

    /**
     * Dispatch a message to all registered callbacks.
     */
    protected dispatchMessage(message: InboundMessage): void {
        for (const callback of this.messageCallbacks) {
            try {
                callback(message);
            } catch (error) {
                console.error('[MessagingAdapter] Callback error:', error);
            }
        }
        this.eventHandlers.onMessage?.(message);
    }

    /**
     * Update connection state and emit events.
     */
    protected setState(newState: ConnectionState): void {
        const oldState = this._state;
        this._state = newState;

        if (oldState !== newState) {
            if (newState === 'connected') {
                this.eventHandlers.onConnect?.();
            } else if (newState === 'disconnected' && oldState === 'connected') {
                this.eventHandlers.onDisconnect?.();
            }
        }
    }

    /**
     * Emit an error event.
     */
    protected emitError(error: Error): void {
        this._state = 'error';
        this.eventHandlers.onError?.(error);
    }
}
