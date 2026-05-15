/**
 * Tree-shakeable Logging System for Spatial Navigation
 *
 * Provides structured logging with:
 * - Build-time DEBUG constant for tree-shaking (replaced by Rollup)
 * - Debug-bundle-only runtime opt-in via window.SPATIAL_NAV_DEBUG /
 *   flutterSpatialNavDebug (gated on DEBUG so a malicious page can't
 *   re-enable verbose logs in a production build)
 * - Namespaced loggers for subsystems
 * - Performance timing utilities
 *
 * Usage:
 *   import { createLogger, DEBUG } from './logger';
 *   const log = createLogger('Movement');
 *   log.debug('Moving focus', { direction: 'down' });
 *
 * Build-time: Rollup replaces `process.env.NODE_ENV` with "production" or "development".
 * Production bundles tree-shake debug calls and the runtime opt-in; only
 * the debug bundle honours window.SPATIAL_NAV_DEBUG.
 */

/**
 * Build-time debug flag.
 *
 * Replaced by Rollup's @rollup/plugin-replace at build time. The substitution
 * targets the LITERAL `process.env.NODE_ENV` token; aliasing the access (e.g.
 * `const env = process.env; env?.NODE_ENV`) defeats the replacement and lets
 * the IIFE run unchanged in browsers — where `typeof process === 'undefined'`
 * is **false** under Webpack-style globals but **true** under content-script
 * isolation, so the original aliased form unintentionally returned `true`
 * (debug enabled) in production extension bundles. The direct comparison
 * below is folded to a literal `false` by Terser in production builds and to
 * `true` in development builds.
 *
 * In production builds this is `false`, allowing Terser to eliminate
 * debug-only code via dead-code elimination.
 */
export const DEBUG: boolean = process.env.NODE_ENV !== 'production';

/**
 * Runtime debug flag — checked on every log call, but ONLY in debug builds.
 *
 * In debug bundles (`DEBUG === true`) a developer can set
 * `window.SPATIAL_NAV_DEBUG = true` (or the legacy `flutterSpatialNavDebug`)
 * to turn on verbose logging. In production bundles the build-time
 * `DEBUG` constant is `false`, so this function unconditionally returns
 * false and the call is dead-code-eliminated by Terser along with the
 * surrounding `console.log` — pages cannot re-enable verbose logging by
 * poking a page-visible global.
 */
function isRuntimeDebugEnabled(): boolean {
    if (!DEBUG) return false;
    if (typeof window === 'undefined') return false;
    const w = window as { SPATIAL_NAV_DEBUG?: boolean; flutterSpatialNavDebug?: boolean };
    return w.SPATIAL_NAV_DEBUG === true || w.flutterSpatialNavDebug === true;
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

const LOG_LEVEL_ORDER: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
    silent: 4,
};

let currentLevel: LogLevel = DEBUG ? 'debug' : 'warn';

export function setLogLevel(level: LogLevel): void {
    currentLevel = level;
}

export function getLogLevel(): LogLevel {
    return currentLevel;
}

function shouldLog(level: LogLevel): boolean {
    return LOG_LEVEL_ORDER[level] >= LOG_LEVEL_ORDER[currentLevel];
}

function formatMessage(namespace: string, message: string): string {
    return `[SpatialNav:${namespace}] ${message}`;
}

export interface Logger {
    debug(message: string, data?: unknown): void;
    info(message: string, data?: unknown): void;
    warn(message: string, data?: unknown): void;
    error(message: string, data?: unknown): void;
    time(label: string): void;
    timeEnd(label: string): void;
    group(label: string): void;
    groupEnd(): void;
}

/**
 * Create a namespaced logger.
 *
 * @param namespace - Logger namespace (e.g., 'Movement', 'Scoring', 'DOM')
 */
export function createLogger(namespace: string): Logger {
    const timers = new Map<string, number>();

    return {
        debug(message: string, data?: unknown): void {
            // Tree-shakeable in production: when DEBUG is false at build time,
            // this whole branch can be removed by Terser unless runtime opt-in fires.
            if (!DEBUG && !isRuntimeDebugEnabled()) return;
            if (!shouldLog('debug')) return;
            if (data !== undefined) {
                console.log(formatMessage(namespace, message), data);
            } else {
                console.log(formatMessage(namespace, message));
            }
        },

        info(message: string, data?: unknown): void {
            if (!shouldLog('info')) return;
            if (data !== undefined) {
                console.info(formatMessage(namespace, message), data);
            } else {
                console.info(formatMessage(namespace, message));
            }
        },

        warn(message: string, data?: unknown): void {
            if (!shouldLog('warn')) return;
            if (data !== undefined) {
                console.warn(formatMessage(namespace, message), data);
            } else {
                console.warn(formatMessage(namespace, message));
            }
        },

        error(message: string, data?: unknown): void {
            if (!shouldLog('error')) return;
            if (data !== undefined) {
                console.error(formatMessage(namespace, message), data);
            } else {
                console.error(formatMessage(namespace, message));
            }
        },

        time(label: string): void {
            if (!DEBUG && !isRuntimeDebugEnabled()) return;
            timers.set(label, performance.now());
        },

        timeEnd(label: string): void {
            if (!DEBUG && !isRuntimeDebugEnabled()) return;
            const start = timers.get(label);
            if (start !== undefined) {
                const duration = performance.now() - start;
                timers.delete(label);
                this.debug(`${label}: ${duration.toFixed(2)}ms`);
            }
        },

        group(label: string): void {
            if (!DEBUG && !isRuntimeDebugEnabled()) return;
            if (!shouldLog('debug')) return;
            console.group(formatMessage(namespace, label));
        },

        groupEnd(): void {
            if (!DEBUG && !isRuntimeDebugEnabled()) return;
            if (!shouldLog('debug')) return;
            console.groupEnd();
        },
    };
}

/**
 * Pre-created loggers for common subsystems.
 */
export const logCore = /* @__PURE__ */ createLogger('Core');
export const logMovement = /* @__PURE__ */ createLogger('Movement');
export const logScoring = /* @__PURE__ */ createLogger('Scoring');
export const logDOM = /* @__PURE__ */ createLogger('DOM');
export const logMessaging = /* @__PURE__ */ createLogger('Messaging');
export const logOverlay = /* @__PURE__ */ createLogger('Overlay');

/**
 * Performance measurement decorator (development only).
 * Wraps a function to measure and log execution time.
 */
export function measurePerformance<T extends (...args: unknown[]) => unknown>(
    namespace: string,
    label: string,
    fn: T
): T {
    if (!DEBUG) return fn;

    const log = createLogger(namespace);

    return ((...args: Parameters<T>) => {
        log.time(label);
        try {
            return fn(...args);
        } finally {
            log.timeEnd(label);
        }
    }) as T;
}

/**
 * Conditional logging based on a predicate.
 * Useful for expensive-to-compute log data — the predicate is only evaluated
 * when debug logging is active, avoiding the cost in production.
 */
export function logIf(condition: boolean, logFn: () => void): void {
    if ((DEBUG || isRuntimeDebugEnabled()) && condition) {
        logFn();
    }
}
