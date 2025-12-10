/**
 * Core messaging types for Spatial Navigation
 *
 * Platform-agnostic message definitions used by all adapters.
 */

import type { DirectionName } from '../core/config';

/**
 * Message types sent from the extension to the native layer.
 */
export type OutboundMessageType =
    | 'spatialNavInit'
    | 'focusChange'
    | 'focusExit'
    | 'tabClosed'
    | 'extensionInstalled'
    | 'extensionUpdated';

/**
 * Message types received from the native layer.
 */
export type InboundMessageType =
    | 'configUpdate'
    | 'navigate'
    | 'refresh'
    | 'focusElement';

/**
 * Base message structure for outbound messages.
 */
export interface OutboundMessage {
    type: OutboundMessageType;
    version?: string;
    url?: string;
    timestamp?: number;
    tabId?: number;
    [key: string]: unknown;
}

/**
 * Initialization message sent when extension loads.
 */
export interface InitMessage extends OutboundMessage {
    type: 'spatialNavInit';
    version: string;
    url: string;
    timestamp: number;
}

/**
 * Focus change message sent when navigation moves focus.
 */
export interface FocusChangeMessage extends OutboundMessage {
    type: 'focusChange';
    direction: DirectionName;
    fromElement?: string;
    toElement?: string;
}

/**
 * Focus exit message sent when navigation hits a boundary.
 */
export interface FocusExitMessage extends OutboundMessage {
    type: 'focusExit';
    direction: DirectionName;
    inTrap?: boolean;
}

/**
 * Base message structure for inbound messages.
 */
export interface InboundMessage {
    type: InboundMessageType;
    tabId?: number;
    [key: string]: unknown;
}

/**
 * Config update message from native layer.
 */
export interface ConfigUpdateMessage extends InboundMessage {
    type: 'configUpdate';
    config: Record<string, unknown>;
}

/**
 * Navigate command from native layer.
 */
export interface NavigateMessage extends InboundMessage {
    type: 'navigate';
    direction: DirectionName;
}

/**
 * Refresh command from native layer.
 */
export interface RefreshMessage extends InboundMessage {
    type: 'refresh';
}

/**
 * Callback type for handling inbound messages.
 */
export type MessageCallback = (message: InboundMessage) => void;

/**
 * Connection state for messaging adapters.
 */
export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

/**
 * Events emitted by messaging adapters.
 */
export interface MessagingEvents {
    onConnect: () => void;
    onDisconnect: () => void;
    onError: (error: Error) => void;
    onMessage: MessageCallback;
}
