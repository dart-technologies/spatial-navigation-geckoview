/**
 * Tests for the background.ts content/native relay.
 *
 * The module auto-registers a runtime.onMessage listener at import time.
 * We set up the recording bridge BEFORE the first import so the listener
 * is captured and can be exercised synthetically.
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';

import { OUTBOUND_MESSAGE_TYPES } from '../messaging/types';

interface RecordedListener {
    (msg: unknown, sender: unknown, sendResponse: (r: unknown) => void): boolean | void;
}

const recorded: { listener: RecordedListener | null } = { listener: null };
const nativeBehavior: {
    impl?: (appId: string, msg: unknown) => Promise<unknown> | unknown;
} = {};

// Pre-install the bridge BEFORE the dynamic import below — background.ts
// reads `browser` from globalThis the moment the module evaluates.
function buildBridge() {
    return {
        runtime: {
            // Own extension id — the relay rejects a sender whose id differs.
            id: 'self-ext',
            onMessage: {
                addListener: (cb: RecordedListener) => {
                    recorded.listener = cb;
                },
            },
            sendNativeMessage: (appId: string, msg: unknown) => {
                if (typeof nativeBehavior.impl === 'function') {
                    return nativeBehavior.impl(appId, msg);
                }
                return Promise.resolve('default');
            },
        },
    };
}

(globalThis as { browser?: unknown }).browser = buildBridge();

before(async () => {
    // Trigger the module side effect.
    await import('../background');
});

describe('background relay', () => {
    test('registers an onMessage listener with the runtime', () => {
        assert.equal(typeof recorded.listener, 'function');
    });

    test('happy path: sendNativeMessage resolves → sendResponse({success:true, nativeUser})', async () => {
        nativeBehavior.impl = async () => ({ ok: 1 });
        let resp: unknown;
        recorded.listener!({ type: 'spatialNavInit' }, {}, (r) => {
            resp = r;
        });
        // Allow the .then() chain to fire.
        await new Promise((r) => setTimeout(r, 0));
        const typed = resp as { success: boolean; nativeUser?: { ok: number } };
        assert.equal(typed.success, true);
        assert.deepEqual(typed.nativeUser, { ok: 1 });
    });

    test('reject with Error → sendResponse error includes message', async () => {
        nativeBehavior.impl = async () => {
            throw new Error('boom');
        };
        let resp: unknown;
        recorded.listener!({ type: 'spatialNavInit' }, {}, (r) => {
            resp = r;
        });
        await new Promise((r) => setTimeout(r, 0));
        const typed = resp as { success: boolean; error: string };
        assert.equal(typed.success, false);
        assert.match(typed.error, /boom/);
    });

    test('reject with {message:string} object', async () => {
        nativeBehavior.impl = async () => {
            return Promise.reject({ message: 'object-error' });
        };
        let resp: unknown;
        recorded.listener!({ type: 'spatialNavInit' }, {}, (r) => {
            resp = r;
        });
        await new Promise((r) => setTimeout(r, 0));
        const typed = resp as { success: boolean; error: string };
        assert.equal(typed.success, false);
        assert.equal(typed.error, 'object-error');
    });

    test('reject with primitive string → coerced via String()', async () => {
        nativeBehavior.impl = async () => Promise.reject('plain-string-error');
        let resp: unknown;
        recorded.listener!({ type: 'spatialNavInit' }, {}, (r) => {
            resp = r;
        });
        await new Promise((r) => setTimeout(r, 0));
        const typed = resp as { success: boolean; error: string };
        assert.equal(typed.success, false);
        assert.equal(typed.error, 'plain-string-error');
    });

    test('sendNativeMessage throws synchronously → caught with success:false', () => {
        nativeBehavior.impl = () => {
            throw new Error('sync-boom');
        };
        let resp: unknown;
        recorded.listener!({ type: 'spatialNavInit' }, {}, (r) => {
            resp = r;
        });
        const typed = resp as { success: boolean; error: string };
        assert.equal(typed.success, false);
        assert.match(typed.error, /sync-boom/);
    });

    test('drops a message with an unknown type before reaching native (L2)', () => {
        let nativeCalled = false;
        nativeBehavior.impl = () => {
            nativeCalled = true;
            return Promise.resolve('should-not-happen');
        };
        let resp: unknown;
        recorded.listener!({ type: 'totally-bogus' }, {}, (r) => {
            resp = r;
        });
        const typed = resp as { success: boolean; error: string };
        assert.equal(typed.success, false);
        assert.match(typed.error, /unknown message type/);
        assert.equal(nativeCalled, false, 'native host is never contacted');
    });

    test('drops a message with no type at all (L2)', () => {
        let resp: unknown;
        recorded.listener!({ direction: 'down' }, {}, (r) => {
            resp = r;
        });
        const typed = resp as { success: boolean; error: string };
        assert.equal(typed.success, false);
        assert.match(typed.error, /unknown message type/);
    });

    test('drops a message from a foreign sender (L2)', () => {
        let nativeCalled = false;
        nativeBehavior.impl = () => {
            nativeCalled = true;
            return Promise.resolve('should-not-happen');
        };
        let resp: unknown;
        recorded.listener!({ type: 'spatialNavInit' }, { id: 'attacker-ext' }, (r) => {
            resp = r;
        });
        const typed = resp as { success: boolean; error: string };
        assert.equal(typed.success, false);
        assert.match(typed.error, /sender not allowed/);
        assert.equal(nativeCalled, false, 'native host is never contacted');
    });

    test('accepts a same-extension sender (matching id)', async () => {
        nativeBehavior.impl = async () => ({ ok: 2 });
        let resp: unknown;
        recorded.listener!({ type: 'spatialNavInit' }, { id: 'self-ext' }, (r) => {
            resp = r;
        });
        await new Promise((r) => setTimeout(r, 0));
        const typed = resp as { success: boolean };
        assert.equal(typed.success, true);
    });

    test('forwards simulateClick to the native host (not dropped by the allowlist)', async () => {
        let sentMsg: unknown;
        let sentAppId: string | undefined;
        nativeBehavior.impl = (appId, msg) => {
            sentAppId = appId;
            sentMsg = msg;
            return Promise.resolve('injected');
        };
        let resp: unknown;
        recorded.listener!({ type: 'simulateClick', x: 12, y: 34 }, { id: 'self-ext' }, (r) => {
            resp = r;
        });
        await new Promise((r) => setTimeout(r, 0));
        const typed = resp as { success: boolean; nativeUser?: unknown };
        assert.equal(typed.success, true, 'simulateClick must reach native, not be dropped');
        assert.deepEqual(sentMsg, { type: 'simulateClick', x: 12, y: 34 });
        assert.ok(sentAppId, 'native host was contacted');
    });

    test('forwards focusExit to the native host (not dropped by the allowlist)', async () => {
        let sentMsg: unknown;
        nativeBehavior.impl = (_appId, msg) => {
            sentMsg = msg;
            return Promise.resolve('ok');
        };
        let resp: unknown;
        recorded.listener!({ type: 'focusExit', direction: 'down' }, { id: 'self-ext' }, (r) => {
            resp = r;
        });
        await new Promise((r) => setTimeout(r, 0));
        assert.equal((resp as { success: boolean }).success, true);
        assert.deepEqual(sentMsg, { type: 'focusExit', direction: 'down' });
    });

    // Regression guard for the simulateClick class of bug: every type the
    // allowlist declares must actually be forwarded by the relay, so a type that
    // is sent through the relay can never be silently dropped. (Adding a new
    // relay-bound type means adding it to OUTBOUND_MESSAGE_TYPES.)
    test('every OUTBOUND_MESSAGE_TYPES value is forwarded, never dropped', async () => {
        for (const type of OUTBOUND_MESSAGE_TYPES) {
            let nativeCalled = false;
            nativeBehavior.impl = () => {
                nativeCalled = true;
                return Promise.resolve('ok');
            };
            let resp: unknown;
            recorded.listener!({ type }, { id: 'self-ext' }, (r) => {
                resp = r;
            });
            await new Promise((r) => setTimeout(r, 0));
            assert.equal(
                (resp as { success: boolean }).success,
                true,
                `relay dropped a known outbound type: ${type}`
            );
            assert.equal(nativeCalled, true, `native not contacted for type: ${type}`);
        }
    });
});
