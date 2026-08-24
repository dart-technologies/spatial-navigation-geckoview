/**
 * Input modality watcher — pointer/touch detection.
 *
 * Owned by the extension as of v3.1. Listens for real
 * `pointerdown` / `touchstart` events on `document` (capture phase, passive)
 * and reports `inputModalityChange: touch` to the native host whenever the
 * extension's locally-tracked `state.lastReportedModality` is currently
 * `hardware-nav` — i.e. when the user has been using the D-pad or arrow keys
 * and now switches back to touch.
 *
 * Filter: `event.isTrusted === false` returns early so synthetic events
 * dispatched by `dispatchFullPointerSequence` in `navigation/handlers.ts`
 * (the Enter/Space → simulated-click sequence) don't flip modality back to
 * touch every time the user activates an element with the D-pad. The browser
 * engine sets `isTrusted` itself; page JS cannot spoof it from a content
 * script's vantage.
 *
 * Back-compat: in addition to the proper `inputModalityChange` outbound
 * message, the watcher writes the legacy `flutter-modality-control:touch`
 * title-channel postback so wrappers older than the plugin-side handler can
 * still consume the signal. The title is restored on the next tick. Slated
 * for removal one extension release after all consuming apps have a Dart
 * handler for `inputModalityChange`.
 */

import type { SpatialNavState } from './state';
import { hideOverlay, setHostModality } from './overlay';
import { hidePreviewElements } from './preview';
import { createLogger } from '../utils/logger';

const log = createLogger('Main');

/**
 * Title-prefix used to postback modality changes via `document.title`.
 *
 * Keep in lockstep with the `_controlTitlePrefix` the host app's focus-style
 * manager reads off this title channel.
 */
export const MODALITY_TITLE_PREFIX = 'flutter-modality-control:';

/**
 * Function that delivers an outbound message to the native host. The watcher
 * is platform-agnostic so it does not import `messagingAdapter` directly —
 * `main.ts` passes a closure over the active adapter.
 */
export type ModalityPostback = (modality: 'touch' | 'hardware-nav') => void;

/**
 * Default postback implementation: emits via `postToNative` AND writes the
 * back-compat title channel. `main.ts` builds this around its module-scoped
 * messaging adapter.
 */
export function buildDefaultModalityPostback(
    postToNative: (msg: { type: 'inputModalityChange'; modality: 'touch' | 'hardware-nav' }) => void,
    documentRef: Document | undefined = typeof document !== 'undefined' ? document : undefined
): ModalityPostback {
    return (modality) => {
        postToNative({ type: 'inputModalityChange', modality });
        if (!documentRef) return;
        try {
            const prev = documentRef.title;
            documentRef.title = `${MODALITY_TITLE_PREFIX}${modality}`;
            setTimeout(() => {
                try {
                    documentRef.title = prev;
                } catch {
                    // ignore title-write failures on detached docs
                }
            }, 0);
        } catch {
            // Title write blocked (e.g., sandboxed iframe).
        }
    };
}

/**
 * Install the `pointerdown` / `touchstart` watcher on `document`.
 *
 * Idempotent: subsequent calls against the same document are no-ops (guarded
 * by `window.__spatnavModalityWatcherAttached`). Callers re-clear the marker
 * before re-invocation when a BFCache restore swaps the document.
 *
 * @returns `true` if the watcher was newly attached, `false` if a prior
 *   install was detected (no-op).
 */
export function setupInputModalityWatcher(
    state: SpatialNavState,
    postback: ModalityPostback,
    options: {
        windowRef?: Window & typeof globalThis;
        documentRef?: Document;
    } = {}
): boolean {
    const win = (options.windowRef ?? (typeof window !== 'undefined' ? window : undefined)) as
        (Window & typeof globalThis) | undefined;
    const doc = options.documentRef ?? (typeof document !== 'undefined' ? document : undefined);
    if (!doc || !win) return false;

    if (win.__spatnavModalityWatcherAttached === true) return false;
    win.__spatnavModalityWatcherAttached = true;

    const handlePointer = (e: Event): void => {
        // Synthetic events from `dispatchEvent` are stamped `isTrusted:
        // false` by the engine — including the click-activation sequence in
        // `handlers.ts:dispatchFullPointerSequence`. Page JS cannot spoof
        // this from a content-script's vantage. We deliberately do NOT
        // rewrite the synthetic events' `pointerType` because page-side
        // tap handlers inspect it to recognise a touch activation.
        if (e.isTrusted === false) return;
        // ALWAYS hide on a trusted pointer — even when modality is already
        // 'touch'. The old early-return above the hide meant a touch-only
        // session (lastReportedModality initializes to 'touch') never ran
        // the hide at all, so a ring painted by any other path stayed up.
        // Only the modality transition + postback below are throttled.
        hideOverlay(state);
        hidePreviewElements(state);
        if (state.lastReportedModality === 'touch') return;
        state.lastReportedModality = 'touch';
        setHostModality('touch');
        postback('touch');
    };

    doc.addEventListener('pointerdown', handlePointer, { passive: true, capture: true });
    doc.addEventListener('touchstart', handlePointer, { passive: true, capture: true });

    log.debug('input modality watcher installed');
    return true;
}
