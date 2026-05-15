/**
 * Tests for the focus_group module — GroupPath utilities, the FocusGroup
 * class, and the module-level helpers (buildGroupHierarchy,
 * parseFocusGroupAttribute, findFocusGroupContainer).
 *
 * Prior to v3.1.0 these surfaces only had incidental coverage via tests
 * that exercise the wider navigation pipeline. This file exists to lock
 * in behavior of the focus-group internals directly so regressions in
 * hierarchy / boundary / enter-mode logic surface here first.
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
    FocusGroup,
    GroupPath,
    buildGroupHierarchy,
    parseFocusGroupAttribute,
    findFocusGroupContainer,
} from '../core/focus_group';
import type { FocusableEntry } from '../core/state';
import { setupDomEnv, teardownDomEnv, createElement, attachElement } from './helpers/dom_env';

/** Build a minimal FocusableEntry around an element for member-list tests. */
function makeEntry(element: HTMLElement, index = 0, groupId: string | null = null): FocusableEntry {
    return {
        element,
        index,
        rect: null,
        left: 0,
        right: 0,
        top: 0,
        bottom: 0,
        width: 0,
        height: 0,
        centerX: 0,
        centerY: 0,
        scrollKey: 'body',
        groupId,
    };
}

describe('GroupPath', () => {
    test('parent returns the substring before the last dot, or null for roots', () => {
        assert.equal(GroupPath.parent('sidebar.menu.item1'), 'sidebar.menu');
        assert.equal(GroupPath.parent('sidebar.menu'), 'sidebar');
        assert.equal(GroupPath.parent('sidebar'), null);
        assert.equal(GroupPath.parent(''), null);
    });

    test('depth counts dot-segments', () => {
        assert.equal(GroupPath.depth('sidebar'), 1);
        assert.equal(GroupPath.depth('sidebar.menu'), 2);
        assert.equal(GroupPath.depth('sidebar.menu.item1'), 3);
    });

    test('isDescendant requires a strict prefix match on a segment boundary', () => {
        assert.equal(GroupPath.isDescendant('sidebar.menu.item1', 'sidebar'), true);
        assert.equal(GroupPath.isDescendant('sidebar.menu.item1', 'sidebar.menu'), true);
        // not a descendant of itself
        assert.equal(GroupPath.isDescendant('sidebar', 'sidebar'), false);
        // partial-name match must not register as descendant
        assert.equal(GroupPath.isDescendant('sidebar-other', 'sidebar'), false);
        assert.equal(GroupPath.isDescendant('main.menu', 'sidebar'), false);
    });

    test('areSiblings checks same parent', () => {
        assert.equal(GroupPath.areSiblings('sidebar.menu', 'sidebar.footer'), true);
        assert.equal(GroupPath.areSiblings('sidebar.menu', 'sidebar.menu.item1'), false);
        // both root groups share parent === null
        assert.equal(GroupPath.areSiblings('sidebar', 'main'), true);
    });

    test('ancestors lists every parent up to root, excluding self', () => {
        assert.deepEqual(GroupPath.ancestors('sidebar.menu.item1'), ['sidebar.menu', 'sidebar']);
        assert.deepEqual(GroupPath.ancestors('sidebar.menu'), ['sidebar']);
        assert.deepEqual(GroupPath.ancestors('sidebar'), []);
    });

    test('root returns the first segment', () => {
        assert.equal(GroupPath.root('sidebar.menu.item1'), 'sidebar');
        assert.equal(GroupPath.root('sidebar'), 'sidebar');
    });

    test('leaf returns the last segment', () => {
        assert.equal(GroupPath.leaf('sidebar.menu.item1'), 'item1');
        assert.equal(GroupPath.leaf('sidebar'), 'sidebar');
    });
});

describe('FocusGroup class', () => {
    beforeEach(() => setupDomEnv());
    afterEach(() => teardownDomEnv());

    test('constructor applies defaults for missing options + caches depth', () => {
        const el = attachElement(createElement({ tagName: 'div' }));
        const group = new FocusGroup('sidebar.menu', el);

        assert.equal(group.id, 'sidebar.menu');
        assert.equal(group.element, el);
        assert.equal(group.options.boundary, 'exit');
        assert.equal(group.options.rememberLast, true);
        assert.equal(group.options.enterMode, 'default');
        assert.equal(group.options.priority, 0);
        assert.equal(group.options.inheritOptions, true);
        assert.equal(group.depth, 2);
        assert.equal(group.parentId, 'sidebar');
        assert.equal(group.isRoot, false);
        assert.equal(group.lastFocused, null);
        assert.deepEqual(group.members, []);
    });

    test('isRoot is true for depth-1 groups', () => {
        const el = attachElement(createElement({ tagName: 'div' }));
        const root = new FocusGroup('sidebar', el);
        assert.equal(root.isRoot, true);
        assert.equal(root.parentId, null);
    });

    test('addMember + removeMember keep members list and groupId stamp consistent', () => {
        const el = attachElement(createElement({ tagName: 'div' }));
        const group = new FocusGroup('sidebar', el);
        const a = makeEntry(createElement({ tagName: 'button' }));
        const b = makeEntry(createElement({ tagName: 'button' }));

        group.addMember(a);
        group.addMember(b);
        assert.deepEqual(group.members, [a, b]);
        assert.equal(a.groupId, 'sidebar');
        assert.equal(b.groupId, 'sidebar');

        // Idempotent
        group.addMember(a);
        assert.equal(group.members.length, 2);

        group.removeMember(a);
        assert.deepEqual(group.members, [b]);
        assert.equal(a.groupId, null, 'removed member loses groupId stamp');

        // Removing a non-member is a no-op
        const stranger = makeEntry(createElement({ tagName: 'button' }));
        stranger.groupId = 'someOther';
        group.removeMember(stranger);
        assert.equal(stranger.groupId, 'someOther');
    });

    test('setParent + removeFromParent maintain bidirectional reference', () => {
        const rootEl = attachElement(createElement({ tagName: 'div' }));
        const childEl = attachElement(createElement({ tagName: 'div' }));
        const root = new FocusGroup('sidebar', rootEl);
        const child = new FocusGroup('sidebar.menu', childEl);

        child.setParent(root);
        assert.equal(child.parent, root);
        assert.equal(root.children.get('sidebar.menu'), child);

        child.removeFromParent();
        assert.equal(child.parent, null);
        assert.equal(root.children.has('sidebar.menu'), false);

        // removeFromParent on an orphan is safe
        child.removeFromParent();
        assert.equal(child.parent, null);
    });

    test('getEffectiveOptions inherits parent extras when inheritOptions is true (default)', () => {
        // Standard options (boundary / rememberLast / enterMode) always get
        // a constructor default on the child, so they always override the
        // parent under the `{ ...parent, ...self }` merge. Inheritance only
        // bleeds through for free-form options that the child does NOT
        // explicitly set.
        const rootEl = attachElement(createElement({ tagName: 'div' }));
        const childEl = attachElement(createElement({ tagName: 'div' }));
        const root = new FocusGroup('sidebar', rootEl, {
            boundary: 'contain',
            customExtra: 'fromParent',
        });
        const child = new FocusGroup('sidebar.menu', childEl, { priority: 9 });
        child.setParent(root);

        const eff = child.getEffectiveOptions();
        assert.equal(
            (eff as Record<string, unknown>).customExtra,
            'fromParent',
            'free-form extras bleed through'
        );
        assert.equal(eff.priority, 9, 'priority is never inherited — always self');
        // Standard fields are always set by the constructor, so they win
        // over the parent regardless of inheritOptions.
        assert.equal(eff.boundary, 'exit', 'standard field uses own default, not parent');
    });

    test('getEffectiveOptions returns own options when inheritOptions is false', () => {
        const rootEl = attachElement(createElement({ tagName: 'div' }));
        const childEl = attachElement(createElement({ tagName: 'div' }));
        const root = new FocusGroup('sidebar', rootEl, {
            customExtra: 'fromParent',
        });
        const child = new FocusGroup('sidebar.menu', childEl, { inheritOptions: false });
        child.setParent(root);

        const eff = child.getEffectiveOptions();
        // With inheritOptions:false, even free-form extras are not inherited.
        assert.equal((eff as Record<string, unknown>).customExtra, undefined);
        assert.equal(eff.boundary, 'exit');
    });

    test('getEffectiveOptions returns self when there is no parent', () => {
        const el = attachElement(createElement({ tagName: 'div' }));
        const root = new FocusGroup('sidebar', el, { boundary: 'contain' });
        assert.equal(root.getEffectiveOptions().boundary, 'contain');
    });

    test('canExit / shouldWrap reflect effective boundary mode', () => {
        const el = attachElement(createElement({ tagName: 'div' }));
        const exitGroup = new FocusGroup('a', el, { boundary: 'exit' });
        const containGroup = new FocusGroup('b', el, { boundary: 'contain' });
        const wrapGroup = new FocusGroup('c', el, { boundary: 'wrap' });
        const stopGroup = new FocusGroup('d', el, { boundary: 'stop' });

        assert.equal(exitGroup.canExit(), true);
        assert.equal(containGroup.canExit(), false);
        assert.equal(wrapGroup.canExit(), true, 'wrap also reports canExit (per implementation)');
        assert.equal(stopGroup.canExit(), false);

        assert.equal(exitGroup.shouldWrap(), false);
        assert.equal(wrapGroup.shouldWrap(), true);
        assert.equal(containGroup.shouldWrap(), false);
    });

    test('getPreferredEntry returns lastFocused under enterMode=last when present and attached', () => {
        const containerEl = attachElement(createElement({ tagName: 'div' }));
        const group = new FocusGroup('sidebar', containerEl, { enterMode: 'last' });
        const first = makeEntry(attachElement(createElement({ tagName: 'button' })));
        const second = makeEntry(attachElement(createElement({ tagName: 'button' })));
        group.addMember(first);
        group.addMember(second);

        group.updateLastFocused(second);
        assert.equal(group.getPreferredEntry(), second);
    });

    test('getPreferredEntry falls back to first member under enterMode=first / default', () => {
        const containerEl = attachElement(createElement({ tagName: 'div' }));
        const firstMode = new FocusGroup('a', containerEl, { enterMode: 'first' });
        const defaultMode = new FocusGroup('b', containerEl, { enterMode: 'default' });
        const a = makeEntry(attachElement(createElement({ tagName: 'button' })));
        const b = makeEntry(attachElement(createElement({ tagName: 'button' })));
        firstMode.addMember(a);
        firstMode.addMember(b);
        defaultMode.addMember(a);
        defaultMode.addMember(b);

        assert.equal(firstMode.getPreferredEntry(), a);
        assert.equal(defaultMode.getPreferredEntry(), a);
    });

    test('updateLastFocused walks ancestors and stamps lastFocused on each', () => {
        const rootEl = attachElement(createElement({ tagName: 'div' }));
        const childEl = attachElement(createElement({ tagName: 'div' }));
        rootEl.appendChild(childEl);
        const focusEl = attachElement(createElement({ tagName: 'button' }));
        childEl.appendChild(focusEl);

        const root = new FocusGroup('sidebar', rootEl);
        const child = new FocusGroup('sidebar.menu', childEl);
        child.setParent(root);

        const focusEntry = makeEntry(focusEl);
        const childMemberEntry = makeEntry(childEl);
        root.addMember(childMemberEntry);
        child.addMember(focusEntry);

        child.updateLastFocused(focusEntry);
        assert.equal(child.lastFocused, focusEntry);
        // root.lastFocused stamped to the ancestor's own member (childMemberEntry,
        // which contains focusEl).
        assert.equal(root.lastFocused, childMemberEntry);
    });

    test('getAllDescendants traverses recursively', () => {
        const el = attachElement(createElement({ tagName: 'div' }));
        const root = new FocusGroup('a', el);
        const child = new FocusGroup('a.b', el);
        const grandchild = new FocusGroup('a.b.c', el);
        child.setParent(root);
        grandchild.setParent(child);

        assert.deepEqual(root.getAllDescendants(), [child, grandchild]);
        assert.deepEqual(child.getAllDescendants(), [grandchild]);
        assert.deepEqual(grandchild.getAllDescendants(), []);
    });

    test('getAllMembers collects own + descendant members', () => {
        const el = attachElement(createElement({ tagName: 'div' }));
        const root = new FocusGroup('a', el);
        const child = new FocusGroup('a.b', el);
        child.setParent(root);

        const rootMember = makeEntry(createElement({ tagName: 'button' }));
        const childMember = makeEntry(createElement({ tagName: 'button' }));
        root.addMember(rootMember);
        child.addMember(childMember);

        assert.deepEqual(root.getAllMembers(), [rootMember, childMember]);
    });

    test('findChild resolves by relative path under its own id', () => {
        const el = attachElement(createElement({ tagName: 'div' }));
        const root = new FocusGroup('sidebar', el);
        const child = new FocusGroup('sidebar.menu', el);
        child.setParent(root);

        assert.equal(root.findChild('menu'), child);
        assert.equal(root.findChild('does.not.exist'), null);
    });
});

describe('buildGroupHierarchy', () => {
    beforeEach(() => setupDomEnv());
    afterEach(() => teardownDomEnv());

    test('wires every parent/child relationship from a flat map of groups', () => {
        const el = attachElement(createElement({ tagName: 'div' }));
        const groups: Record<string, FocusGroup> = {
            sidebar: new FocusGroup('sidebar', el),
            'sidebar.menu': new FocusGroup('sidebar.menu', el),
            'sidebar.menu.item1': new FocusGroup('sidebar.menu.item1', el),
            'sidebar.footer': new FocusGroup('sidebar.footer', el),
        };

        buildGroupHierarchy(groups);

        assert.equal(groups['sidebar.menu'].parent, groups.sidebar);
        assert.equal(groups['sidebar.menu.item1'].parent, groups['sidebar.menu']);
        assert.equal(groups['sidebar.footer'].parent, groups.sidebar);
        assert.equal(groups.sidebar.parent, null);
    });

    test('orphans without a parent in the map stay parent-less', () => {
        const el = attachElement(createElement({ tagName: 'div' }));
        const groups: Record<string, FocusGroup> = {
            'orphan.deep': new FocusGroup('orphan.deep', el),
        };
        buildGroupHierarchy(groups);
        assert.equal(groups['orphan.deep'].parent, null);
    });
});

describe('parseFocusGroupAttribute', () => {
    test('returns null for null or empty input', () => {
        assert.equal(parseFocusGroupAttribute(null), null);
        assert.equal(parseFocusGroupAttribute(''), null);
    });

    test('parses bare id with no options', () => {
        const result = parseFocusGroupAttribute('sidebar');
        assert.equal(result?.id, 'sidebar');
        assert.deepEqual(result?.options, {});
    });

    test('parses id + options, mapping attribute names to internal options', () => {
        const result = parseFocusGroupAttribute('sidebar;boundary=contain;remember=false;enter=last');
        assert.equal(result?.id, 'sidebar');
        assert.equal(result?.options.boundary, 'contain');
        assert.equal(result?.options.rememberLast, false);
        assert.equal(result?.options.enterMode, 'last');
    });

    test('coerces "true" / "false" strings to booleans', () => {
        const result = parseFocusGroupAttribute('sidebar;remember=true');
        assert.equal(result?.options.rememberLast, true);
    });

    test('ignores unrecognized option keys', () => {
        const result = parseFocusGroupAttribute('sidebar;totally-fake=42');
        assert.deepEqual(result?.options, {});
    });
});

describe('findFocusGroupContainer', () => {
    beforeEach(() => setupDomEnv());
    afterEach(() => teardownDomEnv());

    test('walks ancestors and returns the nearest [data-focus-group] element', () => {
        const outer = attachElement(createElement({ tagName: 'section' }));
        outer.setAttribute('data-focus-group', 'outer');
        const middle = createElement({ tagName: 'div' });
        outer.appendChild(middle);
        const inner = createElement({ tagName: 'button' });
        middle.appendChild(inner);

        assert.equal(findFocusGroupContainer(inner), outer);
    });

    test('returns null if no ancestor has the attribute', () => {
        const isolated = attachElement(createElement({ tagName: 'div' }));
        assert.equal(findFocusGroupContainer(isolated), null);
    });

    test('prefers the closest match when groups are nested', () => {
        const outer = attachElement(createElement({ tagName: 'section' }));
        outer.setAttribute('data-focus-group', 'outer');
        const inner = createElement({ tagName: 'div' });
        inner.setAttribute('data-focus-group', 'inner');
        outer.appendChild(inner);
        const leaf = createElement({ tagName: 'button' });
        inner.appendChild(leaf);

        assert.equal(findFocusGroupContainer(leaf), inner);
    });
});
