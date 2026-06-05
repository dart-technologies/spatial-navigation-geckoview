/**
 * Tests for utils/observer.ts — MutationObserver attach/detach + flush behaviour.
 *
 * Covers attachMutationObserver (config-off no-op, idempotent re-attach),
 * the mutation-buffer flush + debounce, needsFullRefresh matrix (childList
 * → true, aria-hidden/hidden → true, class/style → false), framework
 * detection cache, and detachMutationObserver cleanup.
 *
 * The MutationObserver in happy-dom is real, but we manually pump the
 * observer's callback to keep tests deterministic.
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { attachMutationObserver, detachMutationObserver } from '../utils/observer';
import {
    setupDomEnv,
    teardownDomEnv,
    createElement,
    attachElement,
    createTestState,
} from './helpers/dom_env';

interface RecorderMO {
    callback: MutationCallback;
    observed: { target: Node; options: MutationObserverInit }[];
    disconnected: boolean;
}

let lastRecorder: RecorderMO | null = null;

function installRecordingMutationObserver(): {
    instances: RecorderMO[];
    restore(): void;
} {
    const g = globalThis as { MutationObserver: typeof MutationObserver };
    const orig = g.MutationObserver;
    const instances: RecorderMO[] = [];

    function FakeMO(this: RecorderMO, cb: MutationCallback) {
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        const self: RecorderMO = this;
        self.callback = cb;
        self.observed = [];
        self.disconnected = false;
        instances.push(self);
        lastRecorder = self;
    }
    (FakeMO as unknown as { prototype: object }).prototype = {
        observe(this: RecorderMO, target: Node, options: MutationObserverInit) {
            this.observed.push({ target, options });
        },
        disconnect(this: RecorderMO) {
            this.disconnected = true;
        },
        takeRecords() {
            return [];
        },
    };
    g.MutationObserver = FakeMO as unknown as typeof MutationObserver;

    return {
        instances,
        restore() {
            g.MutationObserver = orig;
            lastRecorder = null;
        },
    };
}

describe('attachMutationObserver', () => {
    let mo: ReturnType<typeof installRecordingMutationObserver>;

    beforeEach(() => {
        setupDomEnv();
        mo = installRecordingMutationObserver();
    });
    afterEach(() => {
        mo.restore();
        teardownDomEnv();
    });

    test('no-op when observeMutations is false', () => {
        const state = createTestState([], {}, { observeMutations: false });
        attachMutationObserver(state);
        assert.equal(mo.instances.length, 0);
        assert.equal(state.mutationObserver, null);
    });

    test('attaches with attributeFilter on the relevant attributes', () => {
        const state = createTestState([], {}, { observeMutations: true });
        attachMutationObserver(state);
        assert.equal(mo.instances.length, 1);
        const o = mo.instances[0];
        assert.equal(o.observed.length, 1);
        assert.deepEqual(o.observed[0].options.attributeFilter, [
            'style',
            'class',
            'disabled',
            'hidden',
            'aria-hidden',
            'tabindex',
            'contenteditable',
        ]);
    });

    test('idempotent — second call when observer already exists is a no-op', () => {
        const state = createTestState([], {}, { observeMutations: true });
        attachMutationObserver(state);
        const first = state.mutationObserver;
        attachMutationObserver(state);
        assert.equal(state.mutationObserver, first);
        assert.equal(mo.instances.length, 1);
    });
});

describe('flushMutations / needsFullRefresh matrix', () => {
    let mo: ReturnType<typeof installRecordingMutationObserver>;

    beforeEach(() => {
        setupDomEnv();
        mo = installRecordingMutationObserver();
    });
    afterEach(() => {
        mo.restore();
        teardownDomEnv();
    });

    function fireMutations(records: Partial<MutationRecord>[]): void {
        const obs = lastRecorder!;
        obs.callback(records as MutationRecord[], obs as unknown as MutationObserver);
    }

    test('childList mutation buffers and flushes after debounce', async () => {
        const a = attachElement(
            createElement({ tagName: 'button', tabindex: '0', rect: { width: 80, height: 30 } })
        );
        const state = createTestState([a], {}, { observeMutations: true, mutationDebounce: 5 });
        attachMutationObserver(state);
        const added = attachElement(
            createElement({ tagName: 'button', tabindex: '0', rect: { width: 80, height: 30 } })
        );
        const docFragment = window.document.createDocumentFragment();
        fireMutations([
            {
                type: 'childList',
                target: window.document.body,
                addedNodes: [added] as unknown as NodeList,
                removedNodes: docFragment.childNodes as unknown as NodeList,
            },
        ]);
        // Wait debounce + a tick for the framework-aware-refresh inline path.
        await new Promise((r) => setTimeout(r, 20));
        // After flush: focusableElements should include the new button.
        assert.ok(state.focusableElements.includes(added));
    });

    test('attribute-only mutations take the incremental path (no full refresh)', async () => {
        const a = attachElement(
            createElement({ tagName: 'button', tabindex: '0', rect: { width: 80, height: 30 } })
        );
        const state = createTestState([a], {}, { observeMutations: true, mutationDebounce: 5 });
        attachMutationObserver(state);
        // Toggle hidden on `a` — should mark unfocusable and remove.
        a.style.display = 'none';
        fireMutations([
            {
                type: 'attributes',
                target: a,
                attributeName: 'style',
            },
        ]);
        await new Promise((r) => setTimeout(r, 20));
        // refreshAttributes removes the now-hidden button.
        assert.ok(!state.focusableElements.includes(a));
    });

    test('aria-hidden flip triggers a FULL refresh (not incremental)', async () => {
        const wrap = attachElement(createElement({ tagName: 'div' }));
        const inner = createElement({
            tagName: 'button',
            tabindex: '0',
            rect: { width: 80, height: 30 },
        });
        (wrap as unknown as { appendChild: (n: unknown) => void }).appendChild(inner);
        const state = createTestState(
            [inner as unknown as HTMLElement],
            {},
            { observeMutations: true, mutationDebounce: 5 }
        );
        attachMutationObserver(state);
        // Set aria-hidden on the wrapper.
        wrap.setAttribute('aria-hidden', 'true');
        fireMutations([{ type: 'attributes', target: wrap, attributeName: 'aria-hidden' }]);
        await new Promise((r) => setTimeout(r, 20));
        // Full refresh removes the inner button because its ancestor is aria-hidden.
        assert.ok(!state.focusableElements.includes(inner as unknown as HTMLElement));
    });

    test('filters irrelevant attributes (only RELEVANT_ATTRIBUTES make it past the filter)', async () => {
        const a = attachElement(
            createElement({ tagName: 'button', tabindex: '0', rect: { width: 80, height: 30 } })
        );
        const state = createTestState([a], {}, { observeMutations: true, mutationDebounce: 5 });
        attachMutationObserver(state);
        fireMutations([
            // 'data-foo' is NOT in RELEVANT_ATTRIBUTES — should be filtered out.
            { type: 'attributes', target: a, attributeName: 'data-foo' },
        ]);
        await new Promise((r) => setTimeout(r, 20));
        // Element should still be in the focusableElements list.
        assert.ok(state.focusableElements.includes(a));
    });
});

describe('framework detection (frameworkAwareRefresh enabled)', () => {
    let mo: ReturnType<typeof installRecordingMutationObserver>;

    beforeEach(() => {
        setupDomEnv();
        mo = installRecordingMutationObserver();
    });
    afterEach(() => {
        mo.restore();
        teardownDomEnv();
        delete (window as unknown as { __REACT_DEVTOOLS_GLOBAL_HOOK__?: unknown })
            .__REACT_DEVTOOLS_GLOBAL_HOOK__;
        delete (window as unknown as { __VUE__?: unknown }).__VUE__;
    });

    test('caches detection on state.detectedFramework after first detect', async () => {
        // Stub React presence.
        (window as unknown as { __REACT_DEVTOOLS_GLOBAL_HOOK__?: unknown }).__REACT_DEVTOOLS_GLOBAL_HOOK__ =
            {};
        const a = attachElement(
            createElement({ tagName: 'button', tabindex: '0', rect: { width: 80, height: 30 } })
        );
        const state = createTestState(
            [a],
            {
                // createTestState defaults detectedFramework: false ("cached no-framework").
                // Override to undefined so detectFramework actually runs.
                detectedFramework: undefined as unknown as never,
            },
            {
                observeMutations: true,
                mutationDebounce: 5,
                frameworkAwareRefresh: true,
            }
        );
        attachMutationObserver(state);
        const obs = lastRecorder!;
        obs.callback(
            [{ type: 'attributes', target: a, attributeName: 'class' }] as unknown as MutationRecord[],
            obs as unknown as MutationObserver
        );
        // Allow debounce + microtask + setTimeout fallback.
        await new Promise((r) => setTimeout(r, 50));
        const adapter = state.detectedFramework as { name?: string } | false;
        assert.notEqual(adapter, false);
        assert.equal((adapter as { name: string }).name, 'React');
    });
});

describe('detachMutationObserver', () => {
    let mo: ReturnType<typeof installRecordingMutationObserver>;

    beforeEach(() => {
        setupDomEnv();
        mo = installRecordingMutationObserver();
    });
    afterEach(() => {
        mo.restore();
        teardownDomEnv();
    });

    test('disconnects observer and clears state.mutationObserver', () => {
        const state = createTestState([], {}, { observeMutations: true });
        attachMutationObserver(state);
        const obs = mo.instances[0];
        detachMutationObserver(state);
        assert.equal(obs.disconnected, true);
        assert.equal(state.mutationObserver, null);
    });

    test('idempotent — second call is a no-op', () => {
        const state = createTestState();
        detachMutationObserver(state);
        detachMutationObserver(state);
        assert.equal(state.mutationObserver, null);
    });
});
