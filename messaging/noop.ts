/**
 * No-op Messaging Adapter
 *
 * A silent adapter for environments without native messaging support.
 * All operations succeed silently without side effects.
 *
 * Use cases:
 * - Standalone web pages without native host
 * - Testing/development environments
 * - Graceful degradation when native messaging unavailable
 */

import { BaseMessagingAdapter } from './adapter';
import { createLogger } from '../utils/logger';
import type { OutboundMessage } from './types';

const log = createLogger('Messaging');

/**
 * No-op messaging adapter that silently accepts all messages.
 */
export class NoopMessagingAdapter extends BaseMessagingAdapter {
    readonly id = 'noop';
    readonly name = 'No-op (Standalone)';

    private _verbose: boolean;

    constructor(verbose = false) {
        super();
        this._verbose = verbose;
    }

    isAvailable(): boolean {
        // Always available as a fallback
        return true;
    }

    async connect(): Promise<void> {
        this.setState('connected');
        if (this._verbose) {
            log.info('noop adapter connected (no-op mode)');
        }
    }

    disconnect(): void {
        this.setState('disconnected');
        if (this._verbose) {
            log.info('noop adapter disconnected');
        }
    }

    send(message: OutboundMessage): boolean {
        if (this._verbose) {
            log.debug('noop adapter message dropped', message.type);
        }
        return true;
    }
}
