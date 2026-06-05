/**
 * Native-host sender: selects which GeckoView host to talk to from the
 * hard-coded {@link NATIVE_APP_IDS} allowlist, with probe-and-lock.
 *
 * Used by both the background relay and the content-script `sendNativeMessage`
 * fallback so the host-selection policy lives in exactly one place.
 *
 * SECURITY: candidate app ids come only from the compile-time allowlist — never
 * from page-controlled input (see messaging/native-app-ids.ts). The probe sends
 * the real message; because only one host is registered on a given device, the
 * others reject WITHOUT delivering, so probing cannot leak a message to an
 * unintended host.
 */

import { NATIVE_APP_IDS } from './native-app-ids';

/** Shape of the WebExtension `runtime.sendNativeMessage` primitive. */
export type SendNative = (appId: string, message: unknown) => Promise<unknown>;

/**
 * Create a stateful native sender. The returned function probes the allowlist
 * in order on first use and locks onto the first host whose promise resolves;
 * subsequent calls reuse the locked host.
 *
 * Failure semantics mirror the raw primitive:
 *  - A SYNCHRONOUS throw from the first/locked attempt propagates synchronously
 *    (a broken API is fatal — we do not probe past it).
 *  - An ASYNCHRONOUS rejection means "this host isn't registered" and advances
 *    to the next candidate.
 *
 * @param appIds - candidate ids in probe order (defaults to the full allowlist;
 *                 overridable only for tests).
 */
export function createNativeSender(
    appIds: readonly string[] = NATIVE_APP_IDS
): (sendNative: SendNative, message: unknown) => Promise<unknown> {
    let resolvedAppId: string | null = null;
    // Outcome of the first probe, shared so a BURST of cold-start sends locks
    // once instead of each re-probing the whole allowlist (and re-hitting the
    // unregistered hosts with its payload). This promise NEVER rejects — it
    // resolves to a tagged result — so it can't raise an unhandledRejection when
    // no concurrent caller is waiting on it. Cleared on total failure so a later
    // send can retry from the top.
    type ProbeResult = { ok: true; appId: string } | { ok: false; error: unknown };
    let probe: Promise<ProbeResult> | null = null;

    return function sendToNative(sendNative: SendNative, message: unknown): Promise<unknown> {
        // Host already locked — reuse it directly.
        if (resolvedAppId !== null) {
            return sendNative(resolvedAppId, message);
        }

        // A probe is already in flight: wait for the lock, then send our OWN
        // message to the chosen host. Do not start a second probe.
        if (probe !== null) {
            return probe.then((result) =>
                result.ok ? sendNative(result.appId, message) : Promise.reject(result.error)
            );
        }

        if (appIds.length === 0) {
            return Promise.reject(new Error('createNativeSender: empty native app id allowlist'));
        }

        // We are the first caller: probe the allowlist with our message. The
        // first attempt runs synchronously so a synchronous throw propagates.
        let chain = sendNative(appIds[0], message).then((response) => {
            resolvedAppId = appIds[0];
            return response;
        });

        // Remaining candidates are tried only on async rejection.
        for (let i = 1; i < appIds.length; i++) {
            const appId = appIds[i];
            chain = chain.catch(() =>
                sendNative(appId, message).then((response) => {
                    resolvedAppId = appId;
                    return response;
                })
            );
        }

        // Publish the lock for any sends that arrive while this probe runs.
        // `chain` already set `resolvedAppId` before it resolves, so concurrent
        // callers read the locked id; on total failure they get the same error
        // and we reset so the next send re-probes. The onRejected handler also
        // consumes `chain`'s rejection, so the first caller's returned `chain` is
        // the only place the error surfaces (handled by that caller).
        probe = chain.then(
            (): ProbeResult => ({ ok: true, appId: resolvedAppId as string }),
            (error): ProbeResult => {
                probe = null;
                return { ok: false, error };
            }
        );

        // The first caller gets the probe's own response (and a synchronous
        // throw above already propagated before `probe` was assigned).
        return chain;
    };
}
