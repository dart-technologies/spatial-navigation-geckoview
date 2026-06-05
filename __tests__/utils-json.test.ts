/**
 * Tests for utils/json.ts — safe JSON serialization and attribute access.
 *
 * Covers every branch of safeJson (Error / error-like object / primitive /
 * JSON.stringify throw / circular ref fallback) and safeGetAttr (happy path
 * + getAttribute throw recovery).
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { safeJson, safeGetAttr } from '../utils/json';
import { setupDomEnv, teardownDomEnv, createElement } from './helpers/dom_env';

describe('safeJson', () => {
    test('serializes Error with name, message, and stack', () => {
        const err = new TypeError('boom');
        const out = safeJson(err);
        const parsed = JSON.parse(out);
        assert.equal(parsed.name, 'TypeError');
        assert.equal(parsed.message, 'boom');
        assert.equal(typeof parsed.stack, 'string');
    });

    test('serializes Error subclass (DOMException-like) preserving name', () => {
        class MyError extends Error {
            constructor() {
                super('custom');
                this.name = 'MyError';
            }
        }
        const parsed = JSON.parse(safeJson(new MyError()));
        assert.equal(parsed.name, 'MyError');
        assert.equal(parsed.message, 'custom');
    });

    test('serializes error-like object (has string `message`) preserving message', () => {
        const errLike = { message: 'rejected', code: 42, extra: ['a', 'b'] };
        const parsed = JSON.parse(safeJson(errLike));
        assert.equal(parsed.message, 'rejected');
        assert.equal(parsed.code, 42);
        assert.deepEqual(parsed.extra, ['a', 'b']);
    });

    test('error-like with non-string message falls through to plain stringify', () => {
        const obj = { message: 123, code: 'fail' };
        const parsed = JSON.parse(safeJson(obj));
        // Plain JSON.stringify keeps the numeric message unchanged.
        assert.equal(parsed.message, 123);
        assert.equal(parsed.code, 'fail');
    });

    test('serializes plain object', () => {
        const out = safeJson({ a: 1, b: 'hi' });
        assert.equal(out, '{"a":1,"b":"hi"}');
    });

    test('serializes primitives and null', () => {
        assert.equal(safeJson(42), '42');
        assert.equal(safeJson('hello'), '"hello"');
        assert.equal(safeJson(null), 'null');
        assert.equal(safeJson(true), 'true');
    });

    test('returns String(value) when JSON.stringify throws (BigInt)', () => {
        // JSON.stringify on BigInt throws TypeError — safeJson must fall back to String().
        const out = safeJson(BigInt(5));
        assert.equal(out, '5');
    });

    test('error-like spread path recovers when stringify throws on inner ref', () => {
        // Circular ref under the error-like spread branch — JSON.stringify throws,
        // falls through to outer try, also throws → String() fallback.
        const circular: { message: string; self?: unknown } = { message: 'oops' };
        circular.self = circular;
        const out = safeJson(circular);
        // Either succeeds with circular-ref handling or falls back to String() —
        // both are "didn't crash" wins. Assert no throw and string returned.
        assert.equal(typeof out, 'string');
        assert.ok(out.length > 0);
    });
});

describe('safeGetAttr', () => {
    beforeEach(() => setupDomEnv());
    afterEach(() => teardownDomEnv());

    test('returns attribute value for live element', () => {
        const el = createElement({ attrs: { 'data-id': 'card-1' } });
        assert.equal(safeGetAttr(el, 'data-id'), 'card-1');
    });

    test('returns null for missing attribute (happy-dom standard behavior)', () => {
        const el = createElement();
        assert.equal(safeGetAttr(el, 'data-missing'), null);
    });

    test('returns null when getAttribute throws (proxy stand-in)', () => {
        // Synthesize an element-like object whose getAttribute throws —
        // safeGetAttr must swallow and return null.
        const exploding = {
            getAttribute() {
                throw new Error('cross-origin');
            },
        } as unknown as Element;
        assert.equal(safeGetAttr(exploding, 'any'), null);
    });
});
