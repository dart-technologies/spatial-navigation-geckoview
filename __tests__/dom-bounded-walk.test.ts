/**
 * Tests for walkElementsBounded — the lazy, budget-bounded element walk that
 * backs every focusable scan in utils/dom.ts.
 *
 * The security-relevant property: it must STOP at the budget without visiting
 * (let alone materializing) the rest of the tree, so a hostile, very large DOM
 * cannot force a full enumeration. It must also preserve querySelectorAll-style
 * document (pre-order) ordering so focusable discovery is unchanged.
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { setupDomEnv, teardownDomEnv } from './helpers/dom_env';
import { walkElementsBounded, MAX_SCAN_NODES } from '../utils/dom';

describe('walkElementsBounded', () => {
    beforeEach(() => setupDomEnv());
    afterEach(() => teardownDomEnv());

    function build(html: string): Element {
        const root = document.createElement('div');
        root.innerHTML = html;
        document.body.appendChild(root);
        return root;
    }

    test('visits descendants in document (pre-order) order', () => {
        const root = build('<div id="1"><span id="2"></span><span id="3"></span></div><div id="4"></div>');
        const seen: string[] = [];
        walkElementsBounded(root, { nodes: 100 }, (el) => seen.push(el.id));
        assert.deepEqual(seen, ['1', '2', '3', '4']);
    });

    test('stops at the budget without visiting the rest (bounded enumeration)', () => {
        const root = document.createElement('div');
        for (let i = 0; i < 50; i++) {
            const c = document.createElement('span');
            c.id = `s${i}`;
            root.appendChild(c);
        }
        document.body.appendChild(root);

        const seen: string[] = [];
        const budget = { nodes: 5 };
        walkElementsBounded(root, budget, (el) => seen.push(el.id));

        assert.equal(seen.length, 5, 'visited exactly the budget, not all 50');
        assert.deepEqual(seen, ['s0', 's1', 's2', 's3', 's4']);
        assert.equal(budget.nodes, 0, 'budget fully consumed');
    });

    test('decrements the shared budget by the number of elements visited', () => {
        const root = build('<div></div><div></div><div></div>');
        const budget = { nodes: 100 };
        walkElementsBounded(root, budget, () => {});
        assert.equal(budget.nodes, 97);
    });

    test('a shared budget is consumed across successive walks (recursion semantics)', () => {
        const a = build('<div></div><div></div>'); // 2 elements
        const b = build('<div></div><div></div><div></div>'); // 3 elements
        const budget = { nodes: 4 };
        const seen: number[] = [];
        walkElementsBounded(a, budget, () => seen.push(1)); // consumes 2 → budget 2
        walkElementsBounded(b, budget, () => seen.push(2)); // consumes 2 → budget 0, 1 element skipped
        assert.equal(seen.length, 4, 'second walk stopped when the shared budget ran out');
        assert.equal(budget.nodes, 0);
    });

    test('does nothing on a childless root', () => {
        const root = build('');
        let calls = 0;
        walkElementsBounded(root, { nodes: 10 }, () => calls++);
        assert.equal(calls, 0);
    });

    test('MAX_SCAN_NODES is a finite, generously-sized bound', () => {
        assert.ok(Number.isFinite(MAX_SCAN_NODES));
        assert.ok(MAX_SCAN_NODES >= 50_000);
    });
});
