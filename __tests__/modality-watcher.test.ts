/**
 * Tests for `core/modality_watcher.ts` — the in-page pointer/touch watcher
 * the extension installs to report touch-mode transitions back to the
 * native host.
 *
 * Coverage:
 *   - Trusted pointer + touchstart events fire the postback exactly once
 *     per (hardware-nav → touch) transition
 *   - Synthetic (isTrusted=false) events are filtered (the click-activation
 *     sequence in `handlers.ts` dispatches these — must NOT flip modality)
 *   - `state.lastReportedModality` throttles repeat postbacks
 *   - Idempotent install (double-call no-ops)
 *   - The proper `inputModalityChange` outbound AND the back-compat
 *     title-channel postback fire together
 *   - The back-compat title is restored on the next tick
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { setupDomEnv, teardownDomEnv, createTestState } from './helpers/dom_env';
import {
    setupInputModalityWatcher,
    buildDefaultModalityPostback,
    MODALITY_TITLE_PREFIX,
} from '../core/modality_watcher';

interface CapturedPostback {
    calls: ('touch' | 'hardware-nav')[];
    postback: (modality: 'touch' | 'hardware-nav') => void;
}

function makeCapturingPostback(): CapturedPostback {
    const calls: ('touch' | 'hardware-nav')[] = [];
    return {
        calls,
        postback(modality) {
            calls.push(modality);
        },
    };
}

/**
 * Force `isTrusted` to an explicit value. happy-dom does not implement
 * `isTrusted` at all (it returns `undefined`), so any test asserting on
 * the watcher's `isTrusted === false` early-return MUST set the value
 * explicitly — otherwise the production filter is bypassed and the test
 * passes for the wrong reason.
 */
function setIsTrusted<T extends Event>(event: T, value: boolean): T {
    Object.defineProperty(event, 'isTrusted', {
        value,
        configurable: true,
    });
    return event;
}

describe('setupInputModalityWatcher', () => {
    beforeEach(() => setupDomEnv());
    afterEach(() => teardownDomEnv());

    test('attaches once per document, second call is no-op', () => {
        const state = createTestState();
        const cap = makeCapturingPostback();
        const first = setupInputModalityWatcher(state, cap.postback);
        const second = setupInputModalityWatcher(state, cap.postback);
        assert.equal(first, true, 'first install attaches');
        assert.equal(second, false, 'second install detects existing marker');
    });

    test('trusted pointerdown while in hardware-nav fires postback exactly once', () => {
        const state = createTestState([], { lastReportedModality: 'hardware-nav' });
        const cap = makeCapturingPostback();
        setupInputModalityWatcher(state, cap.postback);

        document.dispatchEvent(setIsTrusted(new PointerEvent('pointerdown', { bubbles: true }), true));

        assert.deepEqual(cap.calls, ['touch']);
        assert.equal(state.lastReportedModality, 'touch');
    });

    test('trusted touchstart while in hardware-nav fires postback', () => {
        const state = createTestState([], { lastReportedModality: 'hardware-nav' });
        const cap = makeCapturingPostback();
        setupInputModalityWatcher(state, cap.postback);

        document.dispatchEvent(setIsTrusted(new Event('touchstart', { bubbles: true }), true));

        assert.deepEqual(cap.calls, ['touch']);
    });

    test('synthetic pointerdown (isTrusted=false) is ignored', () => {
        // This is the load-bearing case: `dispatchFullPointerSequence` in
        // `navigation/handlers.ts` synthesises a `pointerdown` to simulate
        // a tap when the user presses Enter/Space on the D-pad. The watcher
        // MUST NOT flip modality back to touch on that event — otherwise
        // every activation makes the focus ring disappear.
        const state = createTestState([], { lastReportedModality: 'hardware-nav' });
        const cap = makeCapturingPostback();
        setupInputModalityWatcher(state, cap.postback);

        // Real Gecko stamps `isTrusted: false` on `dispatchEvent`-fired
        // events automatically; happy-dom does not implement `isTrusted` at
        // all (it returns `undefined`), so we set it explicitly here to
        // exercise the production filter.
        document.dispatchEvent(setIsTrusted(new PointerEvent('pointerdown', { bubbles: true }), false));

        assert.deepEqual(cap.calls, []);
        assert.equal(
            state.lastReportedModality,
            'hardware-nav',
            'state must remain hardware-nav after a synthetic dispatch'
        );
    });

    test('trusted pointerdown while already in touch does NOT re-fire', () => {
        const state = createTestState([], { lastReportedModality: 'touch' });
        const cap = makeCapturingPostback();
        setupInputModalityWatcher(state, cap.postback);

        document.dispatchEvent(setIsTrusted(new PointerEvent('pointerdown', { bubbles: true }), true));
        document.dispatchEvent(setIsTrusted(new PointerEvent('pointerdown', { bubbles: true }), true));

        assert.deepEqual(cap.calls, [], 'no postback while already in touch');
    });

    test('a hardware-nav → touch → hardware-nav cycle posts twice', () => {
        // First transition: hardware-nav → touch (fires).
        // Then external code (e.g., handlers.ts keydown) sets the modality
        // back to hardware-nav. Next trusted pointer should fire again.
        const state = createTestState([], { lastReportedModality: 'hardware-nav' });
        const cap = makeCapturingPostback();
        setupInputModalityWatcher(state, cap.postback);

        document.dispatchEvent(setIsTrusted(new PointerEvent('pointerdown', { bubbles: true }), true));
        assert.deepEqual(cap.calls, ['touch']);

        // Simulate the keydown handler flipping us back.
        state.lastReportedModality = 'hardware-nav';

        document.dispatchEvent(setIsTrusted(new PointerEvent('pointerdown', { bubbles: true }), true));
        assert.deepEqual(cap.calls, ['touch', 'touch'], 'second transition fires');
    });

    test(
        'touch transition synchronously hides the ring AND the preview ' +
            'chevrons — closes the host-recreation race that left the ' +
            '`.show`-classed chevrons visible on YouTube hamburger menu ' +
            'when the wrapper`s shadow-DOM CSS gate landed late',
        () => {
            // Set up a state with a "visible" ring overlay + chevrons
            // that have the `.show` class — the configuration we`d see
            // during an active hardware-nav navigation just before a
            // touch.
            const state = createTestState([], { lastReportedModality: 'hardware-nav' });
            const overlay = document.createElement('div');
            overlay.classList.add('visible');
            state.overlay = overlay;
            // Distinct container per direction — `hidePreviewElements`
            // iterates and rewrites each container's `className`, so a
            // shared container would only retain the last iteration's
            // class string.
            const makeEntry = (dir: string) => {
                const container = document.createElement('div');
                container.className = `focus-preview focus-preview-${dir} show`;
                const arrow = document.createElement('div');
                arrow.className = 'focus-preview-arrow';
                container.appendChild(arrow);
                return { container, arrow };
            };
            const upEntry = makeEntry('up');
            state.previewElements = {
                up: upEntry,
                down: makeEntry('down'),
                left: makeEntry('left'),
                right: makeEntry('right'),
            };
            const previewContainer = upEntry.container;

            const cap = makeCapturingPostback();
            setupInputModalityWatcher(state, cap.postback);

            document.dispatchEvent(setIsTrusted(new PointerEvent('pointerdown', { bubbles: true }), true));

            assert.equal(
                overlay.classList.contains('visible'),
                false,
                'ring overlay must lose `.visible` class on touch — closes ' +
                    'the wrapper-CSS race for the host-recreation case'
            );
            assert.equal(
                previewContainer.className,
                'focus-preview focus-preview-up',
                'chevron container must lose the `.show` class so its own ' +
                    'opacity rule (0) takes effect — independent of the ' +
                    'wrapper`s shadow-DOM `:host { opacity: 0 }` gate'
            );
            assert.deepEqual(cap.calls, ['touch'], 'postback still fires after the synchronous hide');
        }
    );
});

describe('buildDefaultModalityPostback', () => {
    beforeEach(() => setupDomEnv());
    afterEach(() => teardownDomEnv());

    test('emits the inputModalityChange outbound message', () => {
        const sent: { type: string; modality: string }[] = [];
        const postback = buildDefaultModalityPostback((msg) => {
            sent.push(msg);
        });

        postback('touch');

        assert.equal(sent.length, 1);
        assert.equal(sent[0].type, 'inputModalityChange');
        assert.equal(sent[0].modality, 'touch');
    });

    test('writes the back-compat title-channel postback then restores', async () => {
        const sent: { type: string; modality: string }[] = [];
        document.title = 'Real Page Title';
        const postback = buildDefaultModalityPostback((msg) => {
            sent.push(msg);
        });

        postback('touch');
        assert.equal(
            document.title,
            `${MODALITY_TITLE_PREFIX}touch`,
            'title is briefly set to the control-channel value'
        );

        // The restoration uses `setTimeout(..., 0)` — wait for the macrotask.
        await new Promise((resolve) => setTimeout(resolve, 5));
        assert.equal(document.title, 'Real Page Title', 'original title is restored');
    });

    test('skips title writes when document is undefined', () => {
        const sent: { type: string; modality: string }[] = [];
        const postback = buildDefaultModalityPostback((msg) => sent.push(msg), undefined);
        // Should not throw despite no document.
        assert.doesNotThrow(() => postback('touch'));
        assert.equal(sent.length, 1);
    });
});
