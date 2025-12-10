/**
 * Messaging Module Index
 *
 * Exports all messaging-related types, adapters, and the factory function.
 */

// Types
export type {
    OutboundMessage,
    InboundMessage,
    OutboundMessageType,
    InboundMessageType,
    InitMessage,
    FocusChangeMessage,
    FocusExitMessage,
    ConfigUpdateMessage,
    NavigateMessage,
    RefreshMessage,
    MessageCallback,
    ConnectionState,
    MessagingEvents
} from './types';

// Adapter interface and base class
export type { MessagingAdapter } from './adapter';
export { BaseMessagingAdapter } from './adapter';

// Concrete adapters
export { GeckoViewMessagingAdapter } from './geckoview';
export { NoopMessagingAdapter } from './noop';

// Factory
export { createMessagingAdapter, detectPlatform, type PlatformType } from './factory';
