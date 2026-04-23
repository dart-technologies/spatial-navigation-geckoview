/**
 * Messaging Adapter Factory
 *
 * Platform detection is delegated to {@link ../utils/runtime.ts} so the
 * detection logic lives in one place.
 */

import type { MessagingAdapter } from './adapter';
import { GeckoViewMessagingAdapter } from './geckoview';
import { NoopMessagingAdapter } from './noop';
import { createLogger } from '../utils/logger';
import { detectPlatform, type PlatformType } from '../utils/runtime';

const log = createLogger('Messaging');

// Re-export the platform type for consumers that want the factory's inputs
// without reaching into utils/runtime.
export { detectPlatform, type PlatformType };

/**
 * Configuration options for adapter creation.
 */
export interface AdapterOptions {
    /** Force a specific platform instead of auto-detecting. */
    platform?: PlatformType;
    /** Enable verbose logging for the no-op adapter. */
    verbose?: boolean;
    /** Native-messaging app id, forwarded to {@link GeckoViewMessagingAdapter}. */
    nativeAppId?: string;
}

/**
 * Create a messaging adapter for the current environment.
 */
export function createMessagingAdapter(options: AdapterOptions = {}): MessagingAdapter {
    const platform = options.platform ?? detectPlatform();

    switch (platform) {
        case 'geckoview':
            return new GeckoViewMessagingAdapter({ nativeAppId: options.nativeAppId });

        case 'react-native':
            log.warn('react-native adapter not yet implemented — using noop');
            return new NoopMessagingAdapter(options.verbose);

        case 'wkwebview':
            log.warn('wkwebview adapter not yet implemented — using noop');
            return new NoopMessagingAdapter(options.verbose);

        case 'android-webview':
            log.warn('android-webview adapter not yet implemented — using noop');
            return new NoopMessagingAdapter(options.verbose);

        case 'standalone':
        default:
            return new NoopMessagingAdapter(options.verbose);
    }
}
