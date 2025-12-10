/**
 * JSON utilities for Spatial Navigation System
 *
 * Provides safe JSON serialization shared across all modules.
 */

/**
 * Safely serialize any value to JSON, handling Error objects and circular references.
 * This is used for logging and debugging across the entire spatial navigation system.
 *
 * @param value - The value to serialize
 * @returns JSON string representation
 */
export function safeJson(value: unknown): string {
    if (value instanceof Error) {
        return JSON.stringify({
            name: value.name,
            message: value.message,
            stack: value.stack
        });
    }

    if (value && typeof value === 'object' && 'message' in (value as object) && typeof (value as { message: unknown }).message === 'string') {
        try {
            return JSON.stringify({
                ...(value as object),
                message: (value as { message: string }).message
            });
        } catch {
            // Fall through to best-effort stringify below.
        }
    }

    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}

/**
 * Safely get an attribute from an element, handling any exceptions.
 *
 * @param el - The element to get the attribute from
 * @param attr - The attribute name
 * @returns The attribute value or null
 */
export function safeGetAttr(el: Element, attr: string): string | null {
    try {
        return el.getAttribute(attr);
    } catch {
        return null;
    }
}
