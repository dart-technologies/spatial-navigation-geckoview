/**
 * Tree-shakeable Logging System for Spatial Navigation
 *
 * Provides structured logging with:
 * - Log levels (debug, info, warn, error)
 * - Namespaced loggers for subsystems
 * - Compile-time tree-shaking when DEBUG is false
 * - Performance timing utilities
 * - Conditional logging based on config
 *
 * Usage:
 *   import { createLogger, DEBUG } from './logger';
 *   const log = createLogger('Movement');
 *   log.debug('Moving focus', { direction: 'down' });
 *
 * In production builds, set DEBUG = false to tree-shake all debug calls.
 */

/**
 * Debug mode flag.
 * Set to false in production builds to eliminate debug logging.
 * Build tools (Rollup, Webpack, etc.) will tree-shake dead code.
 */
export const DEBUG = /* @__PURE__ */ (() => {
    // Check for explicit debug flag
    if (typeof window !== 'undefined') {
        const w = window as { SPATIAL_NAV_DEBUG?: boolean };
        if (w.SPATIAL_NAV_DEBUG !== undefined) {
            return w.SPATIAL_NAV_DEBUG;
        }
    }
    // Default: enabled in development, disabled in production
    return typeof process !== 'undefined' &&
        (process as { env?: { NODE_ENV?: string } }).env?.NODE_ENV !== 'production';
})();

/**
 * Log levels in order of verbosity.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

const LOG_LEVEL_ORDER: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
    silent: 4
};

/**
 * Current minimum log level.
 */
let currentLevel: LogLevel = DEBUG ? 'debug' : 'warn';

/**
 * Set the minimum log level.
 */
export function setLogLevel(level: LogLevel): void {
    currentLevel = level;
}

/**
 * Get the current log level.
 */
export function getLogLevel(): LogLevel {
    return currentLevel;
}

/**
 * Check if a log level should be output.
 */
function shouldLog(level: LogLevel): boolean {
    return LOG_LEVEL_ORDER[level] >= LOG_LEVEL_ORDER[currentLevel];
}

/**
 * Format a log message with namespace prefix.
 */
function formatMessage(namespace: string, message: string): string {
    return `[SpatialNav:${namespace}] ${message}`;
}

/**
 * Logger interface for typed logging.
 */
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
 * @returns Logger instance
 */
export function createLogger(namespace: string): Logger {
    const timers = new Map<string, number>();

    return {
        debug(message: string, data?: unknown): void {
            if (!DEBUG || !shouldLog('debug')) return;
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
            if (!DEBUG) return;
            timers.set(label, performance.now());
        },

        timeEnd(label: string): void {
            if (!DEBUG) return;
            const start = timers.get(label);
            if (start !== undefined) {
                const duration = performance.now() - start;
                timers.delete(label);
                this.debug(`${label}: ${duration.toFixed(2)}ms`);
            }
        },

        group(label: string): void {
            if (!DEBUG || !shouldLog('debug')) return;
            console.group(formatMessage(namespace, label));
        },

        groupEnd(): void {
            if (!DEBUG || !shouldLog('debug')) return;
            console.groupEnd();
        }
    };
}

/**
 * Pre-created loggers for common subsystems.
 * Import these directly for convenience.
 */
export const logCore = /* @__PURE__ */ createLogger('Core');
export const logMovement = /* @__PURE__ */ createLogger('Movement');
export const logScoring = /* @__PURE__ */ createLogger('Scoring');
export const logDOM = /* @__PURE__ */ createLogger('DOM');
export const logMessaging = /* @__PURE__ */ createLogger('Messaging');
export const logOverlay = /* @__PURE__ */ createLogger('Overlay');

/**
 * Performance measurement decorator (for development).
 * Wraps a function to measure and log execution time.
 *
 * @param namespace - Logger namespace
 * @param label - Label for the timing
 * @returns Decorator function
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
 * Useful for expensive-to-compute log data.
 *
 * @param condition - Whether to log
 * @param logFn - Function that produces the log call (only called if condition is true)
 */
export function logIf(condition: boolean, logFn: () => void): void {
    if (DEBUG && condition) {
        logFn();
    }
}
