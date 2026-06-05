/**
 * Tests for utils/bridge.ts — Firefox/Chrome runtime messaging.
 *
 * Covers getRuntimeApi/canSendMessage/isFirefoxStyle, sendBridgeMessage on
 * both Promise (Firefox) and callback (Chrome) paths including error/lastError
 * limbs, sendSimulateClick, and the alert-fallback path in sendFocusExit.
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
    getRuntimeApi,
    canSendMessage,
    isFirefoxStyle,
    sendBridgeMessage,
    sendSimulateClick,
    sendFocusExit,
} from '../utils/bridge';
import {
    setupDomEnv,
    teardownDomEnv,
    installBrowserBridge,
    installChromeBridge,
    removeAllBridges,
    captureConsole,
    setRootAttr,
} from './helpers/dom_env';
import { setLogLevel } from '../utils/logger';

describe('getRuntimeApi / canSendMessage / isFirefoxStyle', () => {
    afterEach(() => removeAllBridges());

    test('getRuntimeApi returns null with no bridge', () => {
        removeAllBridges();
        assert.equal(getRuntimeApi(), null);
        assert.equal(canSendMessage(), false);
        assert.equal(isFirefoxStyle(), false);
    });

    test('getRuntimeApi returns null when sendMessage is not a function', () => {
        installBrowserBridge({ sendMessage: undefined });
        assert.equal(getRuntimeApi(), null);
        assert.equal(canSendMessage(), false);
    });

    test('getRuntimeApi returns runtime when browser.runtime.sendMessage is a function', () => {
        installBrowserBridge();
        const api = getRuntimeApi();
        assert.notEqual(api, null);
        assert.equal(typeof api!.sendMessage, 'function');
        assert.equal(canSendMessage(), true);
    });

    test('isFirefoxStyle is true when runtime came from `browser` global', () => {
        installBrowserBridge();
        assert.equal(isFirefoxStyle(), true);
    });

    test('isFirefoxStyle is false when runtime came from `chrome` global', () => {
        installChromeBridge();
        assert.equal(isFirefoxStyle(), false);
    });
});

describe('sendBridgeMessage — Firefox Promise path', () => {
    afterEach(() => {
        removeAllBridges();
        setLogLevel('silent');
    });

    test('resolves with success + response on resolved promise', async () => {
        installBrowserBridge({
            sendMessage: () => Promise.resolve({ acked: true }),
        });
        const result = await sendBridgeMessage<{ acked: boolean }>({ type: 'ping' });
        assert.equal(result.success, true);
        assert.deepEqual(result.response, { acked: true });
    });

    test('returns success without response when sendMessage returns non-thenable (sync ack)', async () => {
        // The existing installBrowserBridge default uses the callback shape (no Promise).
        installBrowserBridge();
        const result = await sendBridgeMessage({ type: 'fire-and-forget' });
        assert.equal(result.success, true);
        assert.equal(result.response, undefined);
    });

    test('rejected promise with Error → formatted error message', async () => {
        installBrowserBridge({
            sendMessage: () => Promise.reject(new TypeError('blocked')),
        });
        const result = await sendBridgeMessage({ type: 'x' });
        assert.equal(result.success, false);
        assert.equal(result.error, 'TypeError: blocked');
    });

    test('rejected promise with {message:string} object → message text', async () => {
        installBrowserBridge({
            sendMessage: () => Promise.reject({ message: 'string-message' }),
        });
        const result = await sendBridgeMessage({ type: 'x' });
        assert.equal(result.success, false);
        assert.equal(result.error, 'string-message');
    });

    test('rejected promise with primitive string → String() coerced', async () => {
        installBrowserBridge({
            sendMessage: () => Promise.reject('raw-string'),
        });
        const result = await sendBridgeMessage({ type: 'x' });
        assert.equal(result.success, false);
        assert.equal(result.error, 'raw-string');
    });
});

describe('sendBridgeMessage — Chrome callback path', () => {
    afterEach(() => {
        removeAllBridges();
        setLogLevel('silent');
    });

    test('resolves with success + response when callback fires without lastError', async () => {
        installChromeBridge({
            sendMessage: (_msg, cb) => {
                cb?.({ ok: 1 });
            },
        });
        const result = await sendBridgeMessage<{ ok: number }>({ type: 'cb' });
        assert.equal(result.success, true);
        assert.deepEqual(result.response, { ok: 1 });
    });

    test('reports lastError when runtime.lastError is set', async () => {
        installChromeBridge({
            sendMessage: function (this: { lastError?: Error }, _msg, cb) {
                // The handler must surface lastError synchronously before invoking cb.
                (this as { lastError?: Error }).lastError = new Error('disconnected');
                cb?.(undefined);
            },
        });
        // The mock's `this` would be the runtime — but our installChromeBridge
        // doesn't bind a `this`. Set lastError on the runtime directly via a fresh install.
        removeAllBridges();
        installChromeBridge({
            sendMessage: (_msg, cb) => {
                const g = globalThis as { chrome?: { runtime: { lastError?: Error } } };
                g.chrome!.runtime.lastError = new Error('disconnected');
                cb?.(undefined);
                // Clear lastError after to mimic chrome semantics.
                g.chrome!.runtime.lastError = null as unknown as Error | undefined;
            },
        });
        const result = await sendBridgeMessage({ type: 'cb-err' });
        assert.equal(result.success, false);
        assert.equal(result.error, 'Error: disconnected');
    });
});

describe('sendBridgeMessage — outer try/catch', () => {
    afterEach(() => {
        removeAllBridges();
        setLogLevel('silent');
    });

    test('returns failure when no bridge is available', async () => {
        removeAllBridges();
        const result = await sendBridgeMessage({ type: 'x' });
        assert.equal(result.success, false);
        assert.equal(result.error, 'No extension bridge available');
    });

    test('catches synchronous throw from sendMessage', async () => {
        installBrowserBridge({
            sendMessage: () => {
                throw new Error('sync-throw');
            },
        });
        const result = await sendBridgeMessage({ type: 'x' });
        assert.equal(result.success, false);
        assert.equal(result.error, 'Error: sync-throw');
    });

    test('debug: option enables a debug-log line (covers options branch)', async () => {
        setupDomEnv();
        const cc = captureConsole();
        setLogLevel('debug');
        installBrowserBridge({ sendMessage: () => Promise.resolve('hi') });

        await sendBridgeMessage({ type: 'with-debug' }, { debug: true });

        // The debug log is namespaced [SpatialNav:Bridge] — confirm at least one fired.
        const sawDebug = cc.log.some((args) => String(args[0]).startsWith('[SpatialNav:Bridge]'));
        assert.equal(sawDebug, true);

        cc.restore();
        teardownDomEnv();
    });
});

describe('sendSimulateClick', () => {
    afterEach(() => removeAllBridges());

    test('builds simulateClick message with x/y and no debug', async () => {
        const capture = installBrowserBridge({
            sendMessage: function (msg) {
                capture.messages.push(msg);
                capture.count++;
                return Promise.resolve();
            },
        });
        await sendSimulateClick(100, 200);
        // Two pushes can happen if both helpers record — pick the last with type.
        const last = capture.messages[capture.messages.length - 1] as {
            type: string;
            x: number;
            y: number;
            debug?: unknown;
        };
        assert.equal(last.type, 'simulateClick');
        assert.equal(last.x, 100);
        assert.equal(last.y, 200);
        assert.equal(last.debug, undefined);
    });

    test('attaches debug payload when provided', async () => {
        const capture = installBrowserBridge({
            sendMessage: function (msg) {
                capture.messages.push(msg);
                capture.count++;
                return Promise.resolve();
            },
        });
        await sendSimulateClick(10, 20, { source: 'menu-toggle' });
        const last = capture.messages[capture.messages.length - 1] as {
            type: string;
            debug?: { source: string };
        };
        assert.equal(last.type, 'simulateClick');
        assert.deepEqual(last.debug, { source: 'menu-toggle' });
    });
});

describe('sendFocusExit', () => {
    beforeEach(() => setupDomEnv());
    afterEach(() => {
        removeAllBridges();
        teardownDomEnv();
    });

    test('falls back to alert() when no bridge and useFallback default', async () => {
        removeAllBridges();
        const alerts: string[] = [];
        (globalThis as { alert?: (msg: string) => void }).alert = (msg: string) => {
            alerts.push(msg);
        };

        const result = await sendFocusExit('up', false);
        assert.equal(result.success, false);
        assert.deepEqual(alerts, ['__FOCUS_EXIT__:up']);
    });

    test('skips alert when useFallback explicitly false', async () => {
        removeAllBridges();
        const alerts: string[] = [];
        (globalThis as { alert?: (msg: string) => void }).alert = (msg: string) => {
            alerts.push(msg);
        };

        const result = await sendFocusExit('down', false, { useFallback: false });
        assert.equal(result.success, false);
        assert.equal(alerts.length, 0);
    });

    test('swallows alert throw silently', async () => {
        removeAllBridges();
        (globalThis as { alert?: (msg: string) => void }).alert = () => {
            throw new Error('blocked');
        };
        // Must not throw.
        const result = await sendFocusExit('left', true);
        assert.equal(result.success, false);
    });

    test('sends focusExit message via bridge when available', async () => {
        const capture = installBrowserBridge({
            sendMessage: function (msg) {
                capture.messages.push(msg);
                capture.count++;
                return Promise.resolve();
            },
        });
        // Avoid leftover root attr from previous setup.
        setRootAttr('data-test', '1');

        const result = await sendFocusExit('right', true);
        const sent = capture.messages.find((m) => (m as { type: string }).type === 'focusExit') as {
            type: string;
            direction: string;
            inTrap: boolean;
        };
        assert.equal(sent.type, 'focusExit');
        assert.equal(sent.direction, 'right');
        assert.equal(sent.inTrap, true);
        assert.equal(result.success, true);
    });
});
