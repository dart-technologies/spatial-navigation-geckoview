/**
 * Core messaging types for Spatial Navigation
 *
 * Platform-agnostic message definitions used by all adapters.
 */

import type { DirectionName } from '../core/config';

/**
 * Message types sent from the extension to the native layer.
 *
 * Backed by a frozen runtime array so the background relay can allowlist
 * incoming content-script messages by `type` before forwarding them to the
 * native host (a malformed/unknown type is dropped, not relayed).
 */
export const OUTBOUND_MESSAGE_TYPES = Object.freeze([
    'spatialNavInit',
    'focusExit',
    'inputModalityChange',
    'simulateClick',
] as const);

export type OutboundMessageType = (typeof OUTBOUND_MESSAGE_TYPES)[number];

/**
 * Message types received from the native layer.
 */
export type InboundMessageType = 'configUpdate' | 'navigate' | 'refresh' | 'focusElement';

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
 * Focus exit message sent when navigation hits a boundary.
 */
export interface FocusExitMessage extends OutboundMessage {
    type: 'focusExit';
    direction: DirectionName;
    inTrap?: boolean;
}

/**
 * Input modality change message sent when the user switches between
 * touch and hardware-nav (D-pad / arrow keys / rotary) input.
 *
 * Hosts use this to gate the focus-ring overlay's visibility: in touch
 * mode the ring is hidden, in hardware-nav mode it is shown. The
 * extension throttles emission to actual transitions — successive
 * pointer events in the same modality do not produce repeat messages.
 */
export interface InputModalityChangeMessage extends OutboundMessage {
    type: 'inputModalityChange';
    modality: 'touch' | 'hardware-nav';
}

/**
 * Native click-injection request. Asks the host to dispatch a synthetic
 * MotionEvent (tap) at the given PHYSICAL-pixel coordinates — used to activate
 * elements on hosts that require a real native click, and for the menu-close
 * outside-tap fallback. Coordinates are already device-pixel-scaled by the
 * sender.
 */
export interface SimulateClickMessage extends OutboundMessage {
    type: 'simulateClick';
    x: number;
    y: number;
    debug?: Record<string, unknown>;
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
