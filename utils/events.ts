/**
 * Event utilities for WICG-compliant Navigation Events
 *
 * Implements dispatchNavEvent for navbeforefocus and navnotarget events.
 * Spec: https://drafts.csswg.org/css-nav-1/#events-navigationevent
 */

import type { DirectionName } from '../core/config';

interface NavEventDetails {
    dir: DirectionName | string; // Allow string for flexibility, typically DirectionName
    relatedTarget?: Element | null;
    inTrap?: boolean;
    trapElement?: Element;
    escapeElement?: Element | null;
    escapeKey?: string;
}

/**
 * Dispatch a standard navigation event.
 *
 * @param type - Event type ('navbeforefocus' or 'navnotarget')
 * @param target - Target element to dispatch event on
 * @param details - Event details
 * @returns False if preventDefault() was called, true otherwise
 */
export function dispatchNavEvent(type: string, target: Element, details: NavEventDetails): boolean {
    if (!target || !details) {
        return true;
    }

    // Build detail payload with all provided fields
    const detail: NavEventDetails = {
        dir: details.dir,
        relatedTarget: details.relatedTarget || null
    };

    // Forward focus-trap metadata for navnotarget events
    if (details.inTrap !== undefined) {
        detail.inTrap = !!details.inTrap;
    }
    if (details.trapElement) {
        detail.trapElement = details.trapElement;
    }
    if (details.escapeElement) {
        detail.escapeElement = details.escapeElement;
    }
    if (details.escapeKey) {
        detail.escapeKey = details.escapeKey;
    }

    const event = new CustomEvent(type, {
        bubbles: true,
        cancelable: true,
        detail: detail
    });

    const result = target.dispatchEvent(event);

    // Log for debugging
    /*
    console.log(`[SpatialNav] ${type} event dispatched:`, {
        target: target.tagName + (target.id ? '#' + target.id : ''),
        dir: details.dir,
        inTrap: detail.inTrap,
        escapeKey: detail.escapeKey,
        defaultPrevented: !result
    });
    */

    return result;
}
