/**
 * Native Messaging Protocol for GeckoView Spatial Navigation
 * 
 * Defines the communication protocol between the web extension and native apps
 * (Flutter, React Native, or any GeckoView host).
 * 
 * @version 3.0.0
 * @see https://firefox-source-docs.mozilla.org/mobile/android/geckoview/consumer/web-extensions.html
 */

import type {
    Direction,
    NativeMessage,
    FocusChangeMessage,
    FocusExitMessage,
    ElementDescriptor,
    SpatialNavigationState,
    FocusableEntry,
    FocusTrapInfo
} from '../types/index.js';

/** Native app identifier for GeckoView messaging */
export const NATIVE_APP_ID = 'flutter_geckoview';

/** Extension version */
export const VERSION = '3.0.0';

// ============================================================================
// Element Description
// ============================================================================

/**
 * Create a serializable descriptor for a DOM element.
 * Used when sending element info to native layer.
 */
export function describeElementForNative(element: Element | null): ElementDescriptor | null {
    if (!element || !element.tagName) {
        return null;
    }

    const rect = element.getBoundingClientRect();

    // Get text content (truncated)
    let text: string | undefined;
    const textContent = element.textContent?.trim();
    if (textContent && textContent.length > 0) {
        text = textContent.substring(0, 100);
        if (textContent.length > 100) {
            text += '...';
        }
    }

    // Get class names (first 2)
    let className: string | undefined;
    if (typeof element.className === 'string' && element.className.trim()) {
        className = element.className.trim().split(/\s+/).slice(0, 2).join(' ');
    }

    return {
        tagName: element.tagName.toLowerCase(),
        id: element.id || undefined,
        className: className || undefined,
        text,
        rect: {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height)
        },
        ariaLabel: element.getAttribute('aria-label') || undefined
    };
}

// ============================================================================
// Message Builders
// ============================================================================

/**
 * Create an initialization message.
 */
export function createInitMessage(url: string): NativeMessage {
    return {
        type: 'spatialNavInit',
        version: VERSION,
        timestamp: Date.now(),
        url
    };
}

/**
 * Create a focus change message.
 */
export function createFocusChangeMessage(
    direction: Direction,
    fromEntry: FocusableEntry | null,
    toEntry: FocusableEntry,
    passIndex: number
): FocusChangeMessage {
    return {
        type: 'focusChange',
        version: VERSION,
        timestamp: Date.now(),
        payload: {
            direction,
            fromElement: fromEntry ? describeElementForNative(fromEntry.element) : null,
            toElement: describeElementForNative(toEntry.element)!,
            passIndex
        }
    };
}

/**
 * Create a focus exit (boundary) message.
 */
export function createFocusExitMessage(
    direction: Direction,
    trapInfo: FocusTrapInfo | null
): FocusExitMessage {
    return {
        type: 'focusExit',
        version: VERSION,
        timestamp: Date.now(),
        payload: {
            direction,
            inTrap: !!trapInfo,
            trapId: trapInfo?.trapId,
            escapeKey: trapInfo?.escapeKey
        }
    };
}

/**
 * Create an error message.
 */
export function createErrorMessage(error: string, details?: unknown): NativeMessage {
    return {
        type: 'error',
        version: VERSION,
        timestamp: Date.now(),
        payload: {
            error,
            details
        }
    };
}

// ============================================================================
// Native Messaging Functions
// ============================================================================

// Type declaration for the browser WebExtension API
declare const browser: {
    runtime: {
        sendNativeMessage: (appId: string, message: unknown) => Promise<unknown>;
        connectNative: (appId: string) => {
            postMessage: (message: unknown) => void;
            onMessage: {
                addListener: (callback: (message: unknown) => void) => void;
                removeListener: (callback: (message: unknown) => void) => void;
            };
            onDisconnect: {
                addListener: (callback: () => void) => void;
            };
            disconnect: () => void;
        };
        onConnect: {
            addListener: (callback: (port: unknown) => void) => void;
        };
    };
} | undefined;

/**
 * Check if native messaging is available.
 */
export function isNativeMessagingAvailable(): boolean {
    return typeof browser !== 'undefined' &&
        browser?.runtime?.sendNativeMessage !== undefined;
}

/**
 * Send a one-off message to native layer.
 * Used for init, focus changes, and boundaries.
 */
export async function sendNativeMessage(message: NativeMessage): Promise<unknown> {
    if (!isNativeMessagingAvailable()) {
        console.log('[SpatialNav] Native messaging not available');
        return null;
    }

    try {
        const response = await browser!.runtime.sendNativeMessage(NATIVE_APP_ID, message);
        console.log('[SpatialNav] Native message sent:', message.type, '-> response:', response);
        return response;
    } catch (error) {
        // Silently fail - native messaging may not be configured
        console.log('[SpatialNav] Native message send failed:', (error as Error).message);
        return null;
    }
}

/**
 * Send a fire-and-forget message (no response expected).
 */
export function postNativeMessage(message: NativeMessage): void {
    if (!isNativeMessagingAvailable()) {
        return;
    }

    try {
        // Use sendNativeMessage but don't await
        browser!.runtime.sendNativeMessage(NATIVE_APP_ID, message).catch(() => {
            // Silently ignore errors
        });
    } catch {
        // Silently fail
    }
}

// ============================================================================
// Connection-Based Messaging (for persistent connections)
// ============================================================================

// Define NativePort type inline to avoid issues with undefined browser
interface NativePort {
    postMessage: (message: unknown) => void;
    onMessage: {
        addListener: (callback: (message: unknown) => void) => void;
        removeListener: (callback: (message: unknown) => void) => void;
    };
    onDisconnect: {
        addListener: (callback: () => void) => void;
    };
    disconnect: () => void;
}

type MessageHandler = (message: unknown) => void;

let persistentPort: NativePort | null = null;
const messageHandlers: Set<MessageHandler> = new Set();

/**
 * Establish a persistent connection to native layer.
 * Preferred for high-frequency events like focus changes.
 */
export function connectNative(): NativePort | null {
    if (!isNativeMessagingAvailable()) {
        console.log('[SpatialNav] Cannot connect - native messaging not available');
        return null;
    }

    if (persistentPort) {
        return persistentPort;
    }

    try {
        persistentPort = browser!.runtime.connectNative(NATIVE_APP_ID);

        persistentPort.onMessage.addListener((message: unknown) => {
            console.log('[SpatialNav] Received native message:', message);
            for (const handler of messageHandlers) {
                try {
                    handler(message);
                } catch (error) {
                    console.error('[SpatialNav] Message handler error:', error);
                }
            }
        });

        persistentPort.onDisconnect.addListener(() => {
            console.log('[SpatialNav] Native port disconnected');
            persistentPort = null;
        });

        console.log('[SpatialNav] Connected to native app:', NATIVE_APP_ID);
        return persistentPort;
    } catch (error) {
        console.log('[SpatialNav] Failed to connect:', (error as Error).message);
        return null;
    }
}

/**
 * Post a message on the persistent connection.
 */
export function postOnConnection(message: NativeMessage): boolean {
    const port = persistentPort || connectNative();
    if (!port) {
        return false;
    }

    try {
        port.postMessage(message);
        return true;
    } catch (error) {
        console.log('[SpatialNav] Post on connection failed:', (error as Error).message);
        persistentPort = null;
        return false;
    }
}

/**
 * Add a handler for incoming native messages.
 */
export function addMessageHandler(handler: MessageHandler): void {
    messageHandlers.add(handler);
}

/**
 * Remove a message handler.
 */
export function removeMessageHandler(handler: MessageHandler): void {
    messageHandlers.delete(handler);
}

/**
 * Disconnect from native layer.
 */
export function disconnectNative(): void {
    if (persistentPort) {
        try {
            persistentPort.disconnect();
        } catch {
            // Ignore
        }
        persistentPort = null;
    }
    messageHandlers.clear();
}

// ============================================================================
// High-Level API for Navigation Events
// ============================================================================

/**
 * Notify native layer of spatial navigation initialization.
 * @param _state - State object (unused, for API consistency)
 */
export function notifyInit(_state: SpatialNavigationState): void {
    const message = createInitMessage(location.href);
    postNativeMessage(message);
}

/**
 * Notify native layer of focus change.
 */
export function notifyFocusChange(
    direction: Direction,
    fromEntry: FocusableEntry | null,
    toEntry: FocusableEntry,
    passIndex: number
): void {
    const message = createFocusChangeMessage(direction, fromEntry, toEntry, passIndex);

    // Prefer connection-based messaging for lower latency
    if (!postOnConnection(message)) {
        postNativeMessage(message);
    }
}

/**
 * Notify native layer of focus exit (boundary reached).
 */
export function notifyFocusExit(
    direction: Direction,
    trapInfo: FocusTrapInfo | null
): void {
    const message = createFocusExitMessage(direction, trapInfo);

    // Prefer connection-based messaging for lower latency
    if (!postOnConnection(message)) {
        postNativeMessage(message);
    }
}
