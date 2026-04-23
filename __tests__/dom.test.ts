/**
 * Tests for DOM utilities — exercised against a real DOM (happy-dom).
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
    setupDomEnv,
    teardownDomEnv,
    attachElement,
    createElement,
    createTestState,
} from './helpers/dom_env';
import { insertEntry, removeEntry, refreshFocusables, describeElement, getActiveElement } from '../utils/dom';

describe('insertEntry / removeEntry', () => {
    beforeEach(() => setupDomEnv());
    afterEach(() => teardownDomEnv());

    test('insertEntry appends a focusable and triggers intersection observation', () => {
        const observed: Element[] = [];
        const state = createTestState([], {
            intersectionObserver: {
                observe: (el: Element) => observed.push(el),
                unobserve: () => {},
                disconnect: () => {},
            } as unknown as IntersectionObserver,
        });

        const button = attachElement(
            createElement({ tagName: 'button', id: 'primary', rect: { width: 100, height: 30 } })
        );

        insertEntry(button, state);

        assert.equal(state.focusables.length, 1);
        assert.equal(state.focusables[0].index, 0);
        assert.equal(state.focusableElements[0], button);
        assert.deepEqual(observed, [button]);
    });

    test('removeEntry reindexes survivors and unobserves the removed element', () => {
        const unobserved: Element[] = [];
        const state = createTestState([], {
            intersectionObserver: {
                observe: () => {},
                unobserve: (el: Element) => unobserved.push(el),
                disconnect: () => {},
            } as unknown as IntersectionObserver,
        });

        const first = attachElement(
            createElement({ tagName: 'button', id: 'first', rect: { width: 100, height: 30 } })
        );
        const second = attachElement(
            createElement({ tagName: 'button', id: 'second', rect: { width: 100, height: 30 } })
        );

        insertEntry(first, state);
        insertEntry(second, state);
        state.currentIndex = 1;

        removeEntry(0, state);

        assert.equal(state.focusables.length, 1);
        assert.equal(state.focusables[0].element, second);
        assert.equal(state.focusables[0].index, 0);
        assert.equal(state.currentIndex, 0);
        assert.deepEqual(unobserved, [first]);
    });
});

describe('refreshFocusables', () => {
    beforeEach(() => setupDomEnv());
    afterEach(() => teardownDomEnv());

    test('discovers anchors, buttons, and tabindex elements', () => {
        attachElement(createElement({ tagName: 'a', href: '/x', rect: { width: 50, height: 20 } }));
        attachElement(createElement({ tagName: 'button', id: 'go', rect: { width: 80, height: 30 } }));
        attachElement(createElement({ tagName: 'div', tabindex: '0', rect: { width: 100, height: 40 } }));
        // Should NOT be picked up:
        attachElement(createElement({ tagName: 'div', text: 'plain', rect: { width: 100, height: 40 } }));

        const state = createTestState();
        refreshFocusables(state);

        assert.equal(state.focusables.length, 3);
        const tags = state.focusableElements.map((el) => el.tagName.toLowerCase()).sort();
        assert.deepEqual(tags, ['a', 'button', 'div']);
    });

    test('skips disabled buttons and aria-hidden subtrees', () => {
        const enabledBtn = attachElement(
            createElement({ tagName: 'button', id: 'enabled', rect: { width: 80, height: 30 } })
        );
        const disabled = attachElement(
            createElement({ tagName: 'button', id: 'disabled', rect: { width: 80, height: 30 } })
        );
        (disabled as HTMLButtonElement).disabled = true;

        const hiddenWrapper = attachElement(
            createElement({ tagName: 'div', attrs: { 'aria-hidden': 'true' } })
        );
        const hiddenChild = createElement({
            tagName: 'button',
            id: 'hidden-child',
            rect: { width: 80, height: 30 },
        });
        hiddenWrapper.appendChild(hiddenChild);

        const state = createTestState();
        refreshFocusables(state);

        assert.equal(state.focusables.length, 1);
        assert.equal(state.focusables[0].element, enabledBtn);
    });
});

describe('describeElement', () => {
    beforeEach(() => setupDomEnv());
    afterEach(() => teardownDomEnv());

    test('formats tag, id, and first two classes', () => {
        const el = createElement({ tagName: 'button', id: 'x', className: 'a b c' });
        assert.equal(describeElement(el), 'button#x.a.b');
    });

    test('appends truncated textContent', () => {
        const el = createElement({ tagName: 'span', text: 'hello world this is long' });
        assert.match(describeElement(el), /^span \("hello world this is/);
    });

    test('returns empty string for null', () => {
        assert.equal(describeElement(null), '');
    });
});

describe('getActiveElement', () => {
    beforeEach(() => setupDomEnv());
    afterEach(() => teardownDomEnv());

    test('returns null when body is the active element', () => {
        assert.equal(getActiveElement(), null);
    });

    test('returns the focused element when one is focused', () => {
        const button = attachElement(createElement({ tagName: 'button', tabindex: '0' }));
        button.focus();
        assert.equal(getActiveElement(), button);
    });
});
