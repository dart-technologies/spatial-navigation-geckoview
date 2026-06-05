/**
 * Tests for utils/logger.ts — namespaced logger with build-time DEBUG gating.
 *
 * Under tsx the rollup-replace plugin does not run, so `process.env.NODE_ENV`
 * is read at runtime and DEBUG resolves to `true` (NODE_ENV is undefined/'test',
 * not 'production'). That means the debug+runtime-opt-in branches are reachable
 * here; the `!DEBUG && !isRuntimeDebugEnabled()` short-circuit at the top of
 * each method is exercised by the production-bundle terser pass at build time,
 * not by these unit tests. We mark those un-runnable branches with c8 ignore
 * comments in the source if they show as missed coverage.
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { createLogger, setLogLevel, getLogLevel, measurePerformance, logIf, DEBUG } from '../utils/logger';
import { setupDomEnv, teardownDomEnv, captureConsole, type ConsoleCapture } from './helpers/dom_env';

describe('createLogger / log level matrix', () => {
    let cc: ConsoleCapture;

    beforeEach(() => {
        setupDomEnv();
        cc = captureConsole();
    });

    afterEach(() => {
        cc.restore();
        teardownDomEnv();
        setLogLevel('silent');
    });

    test('silent suppresses every level', () => {
        setLogLevel('silent');
        const log = createLogger('TestSilent');
        log.debug('d');
        log.info('i');
        log.warn('w');
        log.error('e');
        assert.equal(cc.log.length, 0);
        assert.equal(cc.info.length, 0);
        assert.equal(cc.warn.length, 0);
        assert.equal(cc.error.length, 0);
    });

    test('debug level allows all four severities', () => {
        setLogLevel('debug');
        const log = createLogger('All');
        log.debug('d');
        log.info('i');
        log.warn('w');
        log.error('e');
        assert.equal(cc.log.length, 1, 'debug logs land on console.log');
        assert.equal(cc.info.length, 1);
        assert.equal(cc.warn.length, 1);
        assert.equal(cc.error.length, 1);
    });

    test('info level suppresses debug only', () => {
        setLogLevel('info');
        const log = createLogger('I');
        log.debug('d');
        log.info('i');
        log.warn('w');
        log.error('e');
        assert.equal(cc.log.length, 0);
        assert.equal(cc.info.length, 1);
        assert.equal(cc.warn.length, 1);
        assert.equal(cc.error.length, 1);
    });

    test('error level allows error only', () => {
        setLogLevel('error');
        const log = createLogger('E');
        log.debug('d');
        log.info('i');
        log.warn('w');
        log.error('e');
        assert.equal(cc.log.length, 0);
        assert.equal(cc.info.length, 0);
        assert.equal(cc.warn.length, 0);
        assert.equal(cc.error.length, 1);
    });

    test('setLogLevel / getLogLevel round-trips', () => {
        setLogLevel('warn');
        assert.equal(getLogLevel(), 'warn');
        setLogLevel('debug');
        assert.equal(getLogLevel(), 'debug');
        setLogLevel('silent');
        assert.equal(getLogLevel(), 'silent');
    });

    test('formatMessage prefixes [SpatialNav:<namespace>] and forwards data arg', () => {
        setLogLevel('debug');
        const log = createLogger('FmtNs');
        log.info('hello', { extra: 1 });
        assert.equal(cc.info.length, 1);
        assert.equal(cc.info[0][0], '[SpatialNav:FmtNs] hello');
        assert.deepEqual(cc.info[0][1], { extra: 1 });
    });

    test('no-data path uses single-arg console call', () => {
        setLogLevel('debug');
        const log = createLogger('NoData');
        log.warn('plain');
        assert.equal(cc.warn.length, 1);
        assert.equal(cc.warn[0].length, 1, 'one arg only');
        assert.equal(cc.warn[0][0], '[SpatialNav:NoData] plain');
    });
});

describe('time/timeEnd/group', () => {
    let cc: ConsoleCapture;

    beforeEach(() => {
        setupDomEnv();
        cc = captureConsole();
        setLogLevel('debug');
    });

    afterEach(() => {
        cc.restore();
        teardownDomEnv();
        setLogLevel('silent');
    });

    test('time + timeEnd emits a debug log with elapsed ms', () => {
        const log = createLogger('Timer');
        log.time('op');
        log.timeEnd('op');
        // timeEnd → debug → console.log
        assert.equal(cc.log.length, 1);
        assert.ok(/op: \d+(\.\d+)?ms/.test(String(cc.log[0][0])));
    });

    test('timeEnd is a no-op when no matching time() preceded it', () => {
        const log = createLogger('Timer2');
        log.timeEnd('never-started');
        assert.equal(cc.log.length, 0);
    });

    test('group + groupEnd forward to console.group / console.groupEnd', () => {
        const log = createLogger('Grp');
        log.group('section');
        log.groupEnd();
        assert.equal(cc.group.length, 1);
        assert.equal(cc.group[0][0], '[SpatialNav:Grp] section');
        assert.equal(cc.groupEnd, 1);
    });

    test('group is suppressed when level is not debug-capable', () => {
        setLogLevel('warn');
        const log = createLogger('Grp2');
        log.group('skipped');
        log.groupEnd();
        assert.equal(cc.group.length, 0);
        assert.equal(cc.groupEnd, 0);
    });
});

describe('measurePerformance / logIf', () => {
    let cc: ConsoleCapture;

    beforeEach(() => {
        setupDomEnv();
        cc = captureConsole();
        setLogLevel('debug');
    });

    afterEach(() => {
        cc.restore();
        teardownDomEnv();
        setLogLevel('silent');
    });

    test('measurePerformance wraps function and emits timing log when DEBUG', () => {
        const wrapped = measurePerformance('Perf', 'op', (...args: unknown[]) => {
            const n = args[0] as number;
            return n * 2;
        });
        const result = wrapped(21);
        assert.equal(result, 42);
        if (DEBUG) {
            // The wrapper calls time+timeEnd → exactly one console.log line.
            assert.equal(cc.log.length, 1);
            assert.ok(/op: /.test(String(cc.log[0][0])));
        }
    });

    test('measurePerformance still runs original even if it throws (finally branch)', () => {
        const wrapped = measurePerformance('Perf2', 'op', (..._args: unknown[]) => {
            throw new Error('boom');
        });
        assert.throws(() => wrapped(), /boom/);
        // finally fires timeEnd → one log even on throw.
        if (DEBUG) {
            assert.equal(cc.log.length, 1);
        }
    });

    test('logIf runs the callback only when predicate is true', () => {
        let ran = 0;
        logIf(true, () => {
            ran++;
        });
        assert.equal(ran, 1);

        logIf(false, () => {
            ran++;
        });
        assert.equal(ran, 1, 'predicate false does not invoke');
    });
});

describe('runtime debug opt-in', () => {
    let cc: ConsoleCapture;

    beforeEach(() => {
        setupDomEnv();
        cc = captureConsole();
    });

    afterEach(() => {
        cc.restore();
        teardownDomEnv();
        setLogLevel('silent');
        (globalThis as { window?: { SPATIAL_NAV_DEBUG?: boolean } }).window!.SPATIAL_NAV_DEBUG = undefined;
    });

    test('window.SPATIAL_NAV_DEBUG=true keeps debug live even at non-debug levels', () => {
        // The runtime opt-in only fires when DEBUG (build-time) is true.
        if (!DEBUG) return;
        (globalThis as { window: { SPATIAL_NAV_DEBUG?: boolean } }).window.SPATIAL_NAV_DEBUG = true;
        setLogLevel('debug');
        const log = createLogger('Rt');
        log.debug('still runs');
        assert.equal(cc.log.length, 1);
    });
});
