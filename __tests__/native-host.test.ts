/**
 * Tests for messaging/native-host.ts — the probe-and-lock native sender that
 * powers react-native-geckoview support.
 *
 * SECURITY invariant: the sender only ever targets ids from the hard-coded
 * NATIVE_APP_IDS allowlist (never page-controlled), preserving the d23e1ab
 * anti-rerouting guarantee while supporting more than one host.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { createNativeSender, type SendNative } from '../messaging/native-host';
import { NATIVE_APP_IDS } from '../messaging/native-app-ids';

describe('NATIVE_APP_IDS allowlist', () => {
    test('is frozen and contains both supported hosts', () => {
        assert.ok(Object.isFrozen(NATIVE_APP_IDS));
        assert.ok(NATIVE_APP_IDS.includes('flutter_geckoview'));
        assert.ok(NATIVE_APP_IDS.includes('react-native-geckoview'));
    });
});

describe('createNativeSender — probe-and-lock', () => {
    test('locks onto the first host that resolves (flutter)', async () => {
        const calls: string[] = [];
        const sendNative: SendNative = (id, _msg) => {
            calls.push(id);
            return id === 'flutter_geckoview'
                ? Promise.resolve('ok')
                : Promise.reject(new Error('not registered'));
        };
        const send = createNativeSender();

        assert.equal(await send(sendNative, { type: 'a' }), 'ok');
        assert.deepEqual(calls, ['flutter_geckoview']);

        // Second message reuses the locked host without re-probing.
        await send(sendNative, { type: 'b' });
        assert.deepEqual(calls, ['flutter_geckoview', 'flutter_geckoview']);
    });

    test('falls through to react-native-geckoview when flutter rejects, then locks it', async () => {
        const calls: string[] = [];
        const sendNative: SendNative = (id, _msg) => {
            calls.push(id);
            return id === 'react-native-geckoview'
                ? Promise.resolve('rn')
                : Promise.reject(new Error('not registered'));
        };
        const send = createNativeSender();

        assert.equal(await send(sendNative, { type: 'a' }), 'rn');
        assert.deepEqual(calls, ['flutter_geckoview', 'react-native-geckoview']);

        // Locked onto RN — no more flutter probes.
        await send(sendNative, { type: 'b' });
        assert.deepEqual(calls, ['flutter_geckoview', 'react-native-geckoview', 'react-native-geckoview']);
    });

    test('never probes an id outside the allowlist', async () => {
        const calls: string[] = [];
        const sendNative: SendNative = (id) => {
            calls.push(id);
            return Promise.reject(new Error('nope'));
        };
        const send = createNativeSender();

        await assert.rejects(() => send(sendNative, { type: 'a' }));
        assert.deepEqual(calls, [...NATIVE_APP_IDS]);
        for (const id of calls) {
            assert.ok((NATIVE_APP_IDS as readonly string[]).includes(id));
        }
    });

    test('a synchronous throw on the first attempt propagates synchronously', () => {
        const sendNative: SendNative = () => {
            throw new Error('broken-api');
        };
        const send = createNativeSender();
        assert.throws(() => send(sendNative, { type: 'a' }), /broken-api/);
    });

    test('rejects with the last error when every host rejects', async () => {
        const sendNative: SendNative = (id) => Promise.reject(new Error(`no-${id}`));
        const send = createNativeSender(['a', 'b']);
        await assert.rejects(() => send(sendNative, {}), /no-b/);
    });

    test('concurrent cold-start sends share one probe and do not re-probe', async () => {
        const calls: string[] = [];
        let releaseFlutter: () => void = () => {};
        const gate = new Promise<void>((resolve) => {
            releaseFlutter = resolve;
        });
        const sendNative: SendNative = (id) => {
            calls.push(id);
            return id === 'flutter_geckoview'
                ? gate.then(() => 'ok')
                : Promise.reject(new Error('not registered'));
        };
        const send = createNativeSender();

        // Three sends fire before the first probe resolves.
        const pending = [
            send(sendNative, { type: 'a' }),
            send(sendNative, { type: 'b' }),
            send(sendNative, { type: 'c' }),
        ];

        // Only the first caller has probed; the other two are parked on the lock,
        // not fanning their payload out across the allowlist again.
        assert.deepEqual(calls, ['flutter_geckoview']);

        releaseFlutter();
        assert.deepEqual(await Promise.all(pending), ['ok', 'ok', 'ok']);

        // Once locked, the two queued sends went straight to the locked host —
        // one delivery each, never re-probing from the top.
        assert.deepEqual(calls, ['flutter_geckoview', 'flutter_geckoview', 'flutter_geckoview']);
    });

    test('a send queued behind a failing probe rejects with the same error and does not re-probe', async () => {
        const calls: string[] = [];
        let release: () => void = () => {};
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        const sendNative: SendNative = (id) => {
            calls.push(id);
            return gate.then(() => Promise.reject(new Error(`no-${id}`)));
        };
        const send = createNativeSender(['a', 'b']);

        const first = send(sendNative, { type: 'a' });
        const queued = send(sendNative, { type: 'b' }); // parks on the lock
        // Capture rejections up front so neither can surface as unhandled.
        const firstErr = first.catch((e: unknown) => e);
        const queuedErr = queued.catch((e: unknown) => e);

        release();
        const [e1, e2] = await Promise.all([firstErr, queuedErr]);
        assert.match(String((e1 as Error).message), /no-b/);
        assert.match(String((e2 as Error).message), /no-b/);
        // The queued send rode the shared probe — it never started its own.
        assert.deepEqual(calls, ['a', 'b']);
    });

    test('rejects when constructed with an empty allowlist', async () => {
        const send = createNativeSender([]);
        await assert.rejects(() => send(() => Promise.resolve('x'), {}), /empty/);
    });
});
