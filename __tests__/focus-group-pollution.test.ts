/**
 * Regression test (MEDIUM): page-controlled `data-focus-group` ids must not
 * crash focus discovery.
 *
 * Before the fix, `state.focusGroups` was a plain object. A focusable under
 * `data-focus-group="__proto__"` (or `constructor`, `hasOwnProperty`, …) made
 * `state.focusGroups[id]` resolve to an inherited `Object.prototype` member;
 * the truthy result skipped group creation and then threw an uncaught
 * `TypeError` on `group.addMember`, aborting EVERY keypress (refreshFocusables
 * runs on each directional key) and disabling navigation for the whole page.
 * The fix makes the map prototype-less (`Object.create(null)`).
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { refreshFocusables, insertEntry } from '../utils/dom';
import { getState, resetState } from '../core/state';
import { getConfig } from '../core/config';
import { setupDomEnv, teardownDomEnv, createElement, attachElement } from './helpers/dom_env';

const PROTO_KEYS = [
    '__proto__',
    'constructor',
    'prototype',
    'hasOwnProperty',
    'toString',
    'valueOf',
    'isPrototypeOf',
];

/** Attach `<div data-focus-group="${groupId}"><a href rect>…</a></div>` and return the link. */
function addGroupedLink(groupId: string, id: string): HTMLElement {
    const wrapper = createElement({ tagName: 'div', attrs: { 'data-focus-group': groupId } });
    attachElement(wrapper);
    const link = createElement({
        tagName: 'a',
        href: '#',
        id,
        text: 'x',
        rect: { x: 0, y: 0, width: 80, height: 30 },
    });
    (wrapper as unknown as { appendChild: (n: unknown) => void }).appendChild(link);
    return link;
}

describe('focus-group id prototype-chain pollution (DoS)', () => {
    beforeEach(() => {
        setupDomEnv();
        resetState();
    });

    afterEach(() => {
        resetState();
        teardownDomEnv();
    });

    for (const key of PROTO_KEYS) {
        test(`refreshFocusables does not throw for data-focus-group="${key}"`, () => {
            const link = addGroupedLink(key, 'lnk');
            const state = getState(getConfig());

            assert.doesNotThrow(() => refreshFocusables(state));
            assert.ok(
                state.focusableElements.includes(link),
                'grouped link is still discovered (navigation survives)'
            );
        });
    }

    test('insertEntry does not throw for a prototype-chain group id', () => {
        const state = getState(getConfig());
        refreshFocusables(state);

        const link = addGroupedLink('__proto__', 'lnk-insert');
        assert.doesNotThrow(() => insertEntry(link, state));
    });

    test('a normal focus-group id still groups the element', () => {
        const link = addGroupedLink('sidebar', 'lnk-normal');
        const state = getState(getConfig());
        refreshFocusables(state);

        const entry = state.focusables.find((e) => e.element === link);
        assert.ok(entry, 'link discovered');
        assert.equal(entry!.groupId, 'sidebar', 'still assigned to its group');
    });
});
