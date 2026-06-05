/**
 * Integration tests for messaging adapters.
 *
 * Covers the cross-platform contract: factory detection, NoopMessagingAdapter
 * always-available behaviour, and GeckoViewMessagingAdapter's connect/queue/
 * reconnect lifecycle. We mock the `browser.runtime` global so tests run
 * under plain Node without a WebExtension host.
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
    NoopMessagingAdapter,
    GeckoViewMessagingAdapter,
    createMessagingAdapter,
    detectPlatform,
} from '../messaging';
import type { OutboundMessage, InboundMessage } from '../messaging';

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

interface MockListener<T> {
    handlers: ((arg: T) => void)[];
    addListener(cb: (arg: T) => void): void;
    fire(arg: T): void;
}

function makeListener<T>(): MockListener<T> {
    return {
        handlers: [],
        addListener(cb) {
            this.handlers.push(cb);
        },
        fire(arg) {
            for (const h of [...this.handlers]) h(arg);
        },
    };
}

interface MockPort {
    name: string;
    sent: unknown[];
    onMessage: MockListener<unknown>;
    onDisconnect: MockListener<void>;
    postMessage: (m: unknown) => void;
}

function makePort(name = 'spatial-nav-content'): MockPort {
    const sent: unknown[] = [];
    const onMessage = makeListener<unknown>();
    const onDisconnect = makeListener<void>();
    return {
        name,
        sent,
        onMessage,
        onDisconnect,
        postMessage(m) {
            sent.push(m);
        },
    };
}

interface MockBrowserRuntime {
    connect?: (opts: { name: string }) => MockPort;
    sendNativeMessage?: (appId: string, message: unknown) => Promise<unknown>;
    sendMessage?: (...args: unknown[]) => unknown;
    onMessage?: { addListener: (cb: unknown) => void };
}

const globalScope = globalThis as { browser?: { runtime: MockBrowserRuntime } };

function withMockBrowser(runtime: MockBrowserRuntime, fn: () => void | Promise<void>): Promise<void> {
    const prior = globalScope.browser;
    globalScope.browser = { runtime };
    try {
        const result = fn();
        if (result instanceof Promise) {
            return result.finally(() => {
                if (prior === undefined) delete globalScope.browser;
                else globalScope.browser = prior;
            });
        }
        if (prior === undefined) delete globalScope.browser;
        else globalScope.browser = prior;
        return Promise.resolve();
    } catch (e) {
        if (prior === undefined) delete globalScope.browser;
        else globalScope.browser = prior;
        throw e;
    }
}

// ---------------------------------------------------------------------------
// NoopMessagingAdapter
// ---------------------------------------------------------------------------

describe('NoopMessagingAdapter', () => {
    test('reports available even with no host', () => {
        const a = new NoopMessagingAdapter();
        assert.equal(a.isAvailable(), true);
    });

    test('connect transitions state to connected', async () => {
        const a = new NoopMessagingAdapter();
        const states: string[] = [];
        a.on({ onConnect: () => states.push('connected') });
        await a.connect();
        assert.equal(a.state, 'connected');
        assert.deepEqual(states, ['connected']);
    });

    test('disconnect transitions to disconnected', async () => {
        const a = new NoopMessagingAdapter();
        await a.connect();
        const states: string[] = [];
        a.on({ onDisconnect: () => states.push('disconnected') });
        a.disconnect();
        assert.equal(a.state, 'disconnected');
        assert.deepEqual(states, ['disconnected']);
    });

    test('send always returns true (silent acceptance)', () => {
        const a = new NoopMessagingAdapter();
        assert.equal(a.send({ type: 'spatialNavInit' } as OutboundMessage), true);
    });

    test('onMessage returns an unsubscribe function', () => {
        const a = new NoopMessagingAdapter();
        const calls: InboundMessage[] = [];
        const unsubscribe = a.onMessage((m) => calls.push(m));
        assert.equal(typeof unsubscribe, 'function');
        unsubscribe();
    });
});

// ---------------------------------------------------------------------------
// GeckoViewMessagingAdapter
// ---------------------------------------------------------------------------

describe('GeckoViewMessagingAdapter', () => {
    let port: MockPort;

    beforeEach(() => {
        port = makePort();
    });

    afterEach(() => {
        delete globalScope.browser;
    });

    test('isAvailable reports false when browser is undefined', () => {
        delete globalScope.browser;
        const a = new GeckoViewMessagingAdapter();
        assert.equal(a.isAvailable(), false);
    });

    test('isAvailable reports true when browser.runtime.connect exists', async () => {
        await withMockBrowser({ connect: () => port }, () => {
            const a = new GeckoViewMessagingAdapter();
            assert.equal(a.isAvailable(), true);
        });
    });

    test('connect uses port and flushes queued messages', async () => {
        await withMockBrowser({ connect: () => port }, async () => {
            const a = new GeckoViewMessagingAdapter();
            await a.connect();
            assert.equal(a.state, 'connected');

            a.send({ type: 'spatialNavInit', version: '3.0.0' } as OutboundMessage);
            assert.equal(port.sent.length, 1);

            const sent = port.sent[0] as { type: string; timestamp?: number };
            assert.equal(sent.type, 'spatialNavInit');
            assert.equal(typeof sent.timestamp, 'number');
        });
    });

    test('inbound messages are dispatched to onMessage subscribers', async () => {
        await withMockBrowser({ connect: () => port }, async () => {
            const a = new GeckoViewMessagingAdapter();
            await a.connect();

            const received: InboundMessage[] = [];
            a.onMessage((m) => received.push(m));

            port.onMessage.fire({ type: 'navigate', direction: 'down' });

            assert.equal(received.length, 1);
            assert.equal(received[0].type, 'navigate');
        });
    });

    test('drops malformed inbound messages at the port boundary (L2)', async () => {
        await withMockBrowser({ connect: () => port }, async () => {
            const a = new GeckoViewMessagingAdapter();
            await a.connect();

            const received: InboundMessage[] = [];
            a.onMessage((m) => received.push(m));

            // None of these have a string `type` — all dropped.
            port.onMessage.fire(null);
            port.onMessage.fire('a string');
            port.onMessage.fire(42);
            port.onMessage.fire({ noType: true });
            port.onMessage.fire({ type: 123 });
            assert.equal(received.length, 0, 'malformed inbound messages are dropped');

            // A well-formed message still gets through.
            port.onMessage.fire({ type: 'refresh' });
            assert.equal(received.length, 1);
            assert.equal(received[0].type, 'refresh');
        });
    });

    test('queues messages when no connection is available', async () => {
        delete globalScope.browser;
        const a = new GeckoViewMessagingAdapter();
        const result = a.send({ type: 'spatialNavInit' } as OutboundMessage);
        assert.equal(result, false, 'send returns false when not connected');
    });

    test('falls back to sendNativeMessage when port send throws', async () => {
        const sentNative: unknown[] = [];
        await withMockBrowser(
            {
                connect: () => port,
                sendNativeMessage: async (_app, m) => {
                    sentNative.push(m);
                    return undefined;
                },
            },
            async () => {
                const a = new GeckoViewMessagingAdapter();
                await a.connect();

                port.postMessage = () => {
                    throw new Error('port closed');
                };

                a.send({ type: 'spatialNavInit' } as OutboundMessage);
                assert.equal(sentNative.length, 1);
            }
        );
    });

    test('per-adapter native sender locks the host across concurrent fallback sends', async () => {
        const calls: string[] = [];
        let release: () => void = () => {};
        const gate = new Promise<void>((r) => {
            release = r;
        });
        await withMockBrowser(
            {
                // No `connect` → the adapter uses the sendNativeMessage fallback,
                // which routes through this adapter's own probe-and-lock sender.
                sendNativeMessage: (appId: string) => {
                    calls.push(appId);
                    return appId === 'react-native-geckoview'
                        ? gate.then(() => 'ok')
                        : Promise.reject(new Error('not registered'));
                },
            },
            async () => {
                const a = new GeckoViewMessagingAdapter();
                await a.connect();

                // Three sends fire before the first probe resolves.
                a.send({ type: 'spatialNavInit' } as OutboundMessage);
                a.send({ type: 'focusExit' } as OutboundMessage);
                a.send({ type: 'inputModalityChange' } as OutboundMessage);
                await new Promise((r) => setTimeout(r, 0));

                // The shared probe hit flutter once (it rejected) then locked onto
                // react-native; the other two sends parked on the lock instead of
                // re-probing flutter from the top.
                assert.equal(
                    calls.filter((c) => c === 'flutter_geckoview').length,
                    1,
                    'flutter probed once, not once per send'
                );

                release();
                await new Promise((r) => setTimeout(r, 0));

                // All three messages were delivered to the single locked host.
                assert.equal(calls.filter((c) => c === 'react-native-geckoview').length, 3);
            }
        );
    });

    test('disconnect clears queue and reconnect timer', async () => {
        await withMockBrowser({ connect: () => port }, async () => {
            const a = new GeckoViewMessagingAdapter();
            await a.connect();
            a.disconnect();
            assert.equal(a.state, 'disconnected');
        });
    });

    test('emits error when connect throws', async () => {
        await withMockBrowser(
            {
                connect: () => {
                    throw new Error('boom');
                },
            },
            async () => {
                const a = new GeckoViewMessagingAdapter();
                const errors: Error[] = [];
                a.on({ onError: (e) => errors.push(e) });
                await assert.rejects(() => a.connect(), /boom/);
                assert.equal(errors.length, 1);
            }
        );
    });
});

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

describe('createMessagingAdapter / detectPlatform', () => {
    afterEach(() => {
        delete globalScope.browser;
    });

    test('detectPlatform returns "standalone" with no native host', () => {
        delete globalScope.browser;
        assert.equal(detectPlatform(), 'standalone');
    });

    test('detectPlatform returns "geckoview" when browser.runtime.connect exists', async () => {
        await withMockBrowser({ connect: () => makePort() }, () => {
            assert.equal(detectPlatform(), 'geckoview');
        });
    });

    test('createMessagingAdapter returns Noop for standalone', () => {
        delete globalScope.browser;
        const adapter = createMessagingAdapter();
        assert.equal(adapter.id, 'noop');
    });

    test('createMessagingAdapter returns GeckoView when bridge present', async () => {
        await withMockBrowser({ connect: () => makePort() }, () => {
            const adapter = createMessagingAdapter();
            assert.equal(adapter.id, 'geckoview');
        });
    });

    test('createMessagingAdapter respects forced platform', () => {
        const adapter = createMessagingAdapter({ platform: 'standalone' });
        assert.equal(adapter.id, 'noop');
    });
});
