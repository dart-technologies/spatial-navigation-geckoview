/**
 * Menu-toggle handling helpers for Spatial Navigation.
 *
 * Some sites use hover-driven navigation menus that open on pointer enter and do
 * not reliably close on click/tap. For D-pad/Enter interactions we treat
 * aria-haspopup/aria-expanded toggles as true toggles: second press closes.
 */

import { safeGetAttr, safeJson } from '../utils/json';
import { describeElement } from '../utils/dom';
import { scheduleOverlayUpdate } from '../utils/focus-helpers';
import { clampToViewport } from './click_utils';
import type { SpatialNavState } from '../core/state';

interface MenuToggleState {
    isOpen: boolean;
    ariaExpanded: string | null;
    submenu: HTMLElement | null;
    reason: 'aria-expanded' | 'submenu-visible' | 'submenu-hidden' | 'no-submenu';
}

export function isMenuToggleElement(el: Element): boolean {
    const ariaHasPopup = safeGetAttr(el, 'aria-haspopup');
    const ariaExpanded = safeGetAttr(el, 'aria-expanded');
    return (ariaHasPopup !== null && ariaHasPopup !== 'false') || ariaExpanded !== null;
}

function isElementVisible(el: HTMLElement | null): boolean {
    if (!el) return false;
    try {
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        if (typeof style.opacity === 'string' && style.opacity.length && parseFloat(style.opacity) <= 0) return false;
    } catch {
        // If we can't read styles, fall back to geometry checks.
    }
    try {
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
    } catch {
        return false;
    }
}

function looksLikeSubmenu(el: HTMLElement): boolean {
    const tag = el.tagName.toLowerCase();
    if (tag === 'ul' || tag === 'ol') return true;

    const role = safeGetAttr(el, 'role');
    if (role === 'menu' || role === 'listbox') return true;

    const className = safeGetAttr(el, 'class') || '';
    if (/(menu|submenu|dropdown|child)/i.test(className)) return true;

    try {
        return !!el.querySelector?.('a[href], button, [role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"]');
    } catch {
        return false;
    }
}

function findNavigationRoot(start: Element): Element | null {
    let current: Element | null = start;
    let depth = 0;

    while (current && depth < 12) {
        const tagName = (current as any).tagName?.toLowerCase?.() as string | undefined;
        if (tagName === 'nav' || tagName === 'header') {
            return current;
        }

        const role = safeGetAttr(current, 'role');
        if (role === 'navigation') {
            return current;
        }

        const id = safeGetAttr(current, 'id') || '';
        if (id && /nav/i.test(id) && id.length <= 48) {
            try {
                // Heuristic: treat as navigation only if it actually contains links/menuitems.
                if ((current as HTMLElement).querySelector?.('a, [role="menuitem"], [role="link"]')) {
                    return current;
                }
            } catch {
                return current;
            }
        }

        current = (current as any).parentElement as Element | null;
        depth += 1;
    }

    return null;
}

function findAssociatedSubmenu(toggle: Element): HTMLElement | null {
    const ariaControls = safeGetAttr(toggle, 'aria-controls');
    if (ariaControls) {
        const controlled = document.getElementById(ariaControls);
        if (controlled && controlled.nodeType === 1) return controlled as unknown as HTMLElement;
    }

    const nextSibling = (toggle as HTMLElement).nextElementSibling;
    if (nextSibling && nextSibling.nodeType === 1 && looksLikeSubmenu(nextSibling as HTMLElement)) {
        return nextSibling as HTMLElement;
    }

    // Common wrappers for drop-down menus.
    const container = (toggle as HTMLElement).closest?.('.folder-parent, li, nav, header, [role="menuitem"]') as HTMLElement | null;
    if (container) {
        const directChildren = Array.from(container.children);
        for (const child of directChildren) {
            if (child === toggle) continue;
            if (child.nodeType === 1 && looksLikeSubmenu(child as HTMLElement)) {
                return child as HTMLElement;
            }
        }
    }

    return null;
}

function detectMenuToggleState(toggle: Element): MenuToggleState {
    const ariaExpanded = safeGetAttr(toggle, 'aria-expanded');
    const submenu = findAssociatedSubmenu(toggle);

    if (ariaExpanded === 'true') {
        return { isOpen: true, ariaExpanded, submenu, reason: 'aria-expanded' };
    }
    if (ariaExpanded === 'false') {
        return { isOpen: false, ariaExpanded, submenu, reason: 'aria-expanded' };
    }

    if (submenu && isElementVisible(submenu)) {
        return { isOpen: true, ariaExpanded, submenu, reason: 'submenu-visible' };
    }

    if (submenu) {
        return { isOpen: false, ariaExpanded, submenu, reason: 'submenu-hidden' };
    }

    return { isOpen: false, ariaExpanded, submenu: null, reason: 'no-submenu' };
}

function isWithinAny(hit: Element | null, roots: Array<Element | null | undefined>): boolean {
    if (!hit) return false;
    for (const root of roots) {
        if (!root) continue;
        if (hit === root) return true;
        try {
            if (root.contains(hit)) return true;
        } catch {
            // ignore
        }
    }
    return false;
}

function looksInteractive(el: Element | null): boolean {
    if (!el) return false;
    try {
        const tagName = (el as any).tagName?.toLowerCase?.() as string | undefined;
        if (!tagName) return false;

        if (tagName === 'a') return safeGetAttr(el, 'href') !== null;
        if (tagName === 'button' || tagName === 'input' || tagName === 'select' || tagName === 'textarea') return true;

        const role = safeGetAttr(el, 'role');
        if (role === 'button' || role === 'menuitem' || role === 'link') return true;

        const tabIndex = safeGetAttr(el, 'tabindex');
        if (tabIndex !== null && tabIndex !== '-1') return true;
        return false;
    } catch {
        return false;
    }
}

function pickOutsidePoint(options: {
    toggleRect: DOMRect;
    submenuRect: DOMRect | null;
    exclusions: Element[];
}): { x: number; y: number; label: string; hit: Element | null } {
    const inset = 8;
    const { toggleRect, submenuRect, exclusions } = options;

    const points: Array<{ label: string; x: number; y: number }> = [];

    if (submenuRect) {
        points.push({ label: 'submenu-below', x: submenuRect.left + submenuRect.width / 2, y: submenuRect.bottom + inset });
        points.push({ label: 'submenu-right', x: submenuRect.right + inset, y: submenuRect.top + inset });
        points.push({ label: 'submenu-left', x: submenuRect.left - inset, y: submenuRect.top + inset });
        points.push({ label: 'submenu-above', x: submenuRect.left + submenuRect.width / 2, y: submenuRect.top - inset });
    }

    points.push({ label: 'toggle-below', x: toggleRect.left + toggleRect.width / 2, y: toggleRect.bottom + inset });
    points.push({ label: 'toggle-above', x: toggleRect.left + toggleRect.width / 2, y: toggleRect.top - inset });
    points.push({ label: 'viewport-center', x: (window?.innerWidth ?? 0) / 2, y: (window?.innerHeight ?? 0) / 2 });
    points.push({ label: 'viewport-top-left', x: inset, y: inset });
    points.push({ label: 'viewport-top-right', x: (window?.innerWidth ?? 0) - inset, y: inset });
    points.push({ label: 'viewport-bottom-left', x: inset, y: (window?.innerHeight ?? 0) - inset });
    points.push({ label: 'viewport-bottom-right', x: (window?.innerWidth ?? 0) - inset, y: (window?.innerHeight ?? 0) - inset });

    let fallback: { x: number; y: number; label: string; hit: Element | null } | null = null;

    for (const point of points) {
        const clamped = clampToViewport(point.x, point.y);
        const hit = document.elementFromPoint(clamped.x, clamped.y);
        if (isWithinAny(hit, exclusions)) continue;

        const candidate = { x: clamped.x, y: clamped.y, label: point.label, hit };
        if (!looksInteractive(hit)) {
            return candidate;
        }
        if (!fallback) fallback = candidate;
    }

    if (fallback) return fallback;

    const center = clampToViewport(toggleRect.left + toggleRect.width / 2, toggleRect.top + toggleRect.height / 2);
    return { x: center.x, y: center.y, label: 'toggle-center', hit: document.elementFromPoint(center.x, center.y) };
}

function dispatchHoverExit(target: Element, clientX: number, clientY: number): void {
    const commonOptions = {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX,
        clientY,
        buttons: 0,
        detail: 0
    };

    // Dispatch both Pointer and Mouse exit events for better compatibility.
    if (typeof (window as any).PointerEvent === 'function') {
        const pointerExit = {
            ...commonOptions,
            pointerId: 1,
            pointerType: 'mouse',
            isPrimary: true,
            button: -1,
            pressure: 0
        } as any;
        target.dispatchEvent(new (window as any).PointerEvent('pointerout', pointerExit));
        target.dispatchEvent(new (window as any).PointerEvent('pointerleave', pointerExit));
    }

    target.dispatchEvent(new MouseEvent('mouseout', commonOptions));
    target.dispatchEvent(new MouseEvent('mouseleave', commonOptions));
}

export function tryCloseOpenMenuToggle(options: {
    actionElement: Element;
    state: SpatialNavState;
    event: KeyboardEvent;
    handlerId: number;
    runtimeApi: unknown;
    canRequestNativeClick: boolean;
}): boolean {
    const { actionElement, state, event, handlerId, runtimeApi, canRequestNativeClick } = options;

    const menuState = detectMenuToggleState(actionElement);
    if (!menuState.isOpen) return false;

    const closeHandlerId = handlerId;
    const menuContainer =
        (actionElement as HTMLElement).closest?.('.folder-parent') ||
        (actionElement as HTMLElement).parentElement ||
        (actionElement as HTMLElement);

    const navRoot = findNavigationRoot(actionElement);
    const exclusions = [menuContainer, menuState.submenu, actionElement, navRoot].filter(Boolean) as Element[];

    const submenuRect = menuState.submenu ? menuState.submenu.getBoundingClientRect() : null;
    const toggleRect = actionElement.getBoundingClientRect();
    const outside = pickOutsidePoint({ toggleRect, submenuRect, exclusions });

    if (window.flutterSpatialNavDebug) {
        console.log(`[SpatialNav DEBUG] Menu toggle appears OPEN (${menuState.reason}) - closing via hover-exit + outside click ${safeJson({
            toggle: describeElement(actionElement),
            ariaExpanded: menuState.ariaExpanded,
            submenu: menuState.submenu ? describeElement(menuState.submenu) : null,
            navRoot: navRoot ? describeElement(navRoot) : null,
            outside: {
                label: outside.label,
                x: outside.x,
                y: outside.y,
                hit: describeElement(outside.hit)
            }
        })}`);
    }

    // 1) Try to close hover-driven menus (JS handlers attached to mouseleave).
    dispatchHoverExit(actionElement, outside.x, outside.y);
    if (menuState.submenu) {
        dispatchHoverExit(menuState.submenu, outside.x, outside.y);
    }

    // 2) If hover-exit already closed the menu, do NOT click outside.
    // Clicking outside will often steal focus from the toggle (unfocus), and on some
    // sites may accidentally trigger navigation if the point lands on chrome/nav.
    const afterHover = detectMenuToggleState(actionElement);
    if (!afterHover.isOpen) {
        if (window.flutterSpatialNavDebug) {
            console.log(`[SpatialNav DEBUG] Menu closed via hover-exit (${menuState.reason}) - skipping outside click`);
        }
        state.dirty = true;
        try {
            if (typeof (actionElement as any).focus === 'function') {
                (actionElement as any).focus();
            }
            scheduleOverlayUpdate(actionElement as HTMLElement, state);
        } catch {
            // ignore
        }
        event.preventDefault();
        event.stopPropagation();
        return true;
    }

    // 3) Still open: click outside as a fallback. Run in a later task to avoid
    // re-entrancy issues and to allow any menu close transitions to settle.
    setTimeout(() => {
        const currentDomHandlerId = document.documentElement.getAttribute('data-spatnav-handler-id');
        if (String(closeHandlerId) !== currentDomHandlerId) return;

        const stillOpen = detectMenuToggleState(actionElement);
        if (!stillOpen.isOpen) return;

        const toggleRectNow = actionElement.getBoundingClientRect();
        const submenuRectNow = stillOpen.submenu ? stillOpen.submenu.getBoundingClientRect() : submenuRect;
        const outsideNow = pickOutsidePoint({ toggleRect: toggleRectNow, submenuRect: submenuRectNow, exclusions });

        if (window.flutterSpatialNavDebug) {
            console.log(`[SpatialNav DEBUG] Menu still open - applying outside-click fallback ${safeJson({
                toggle: describeElement(actionElement),
                outside: {
                    label: outsideNow.label,
                    x: outsideNow.x,
                    y: outsideNow.y,
                    hit: describeElement(outsideNow.hit),
                }
            })}`);
        }

        // Prefer native outside click when available for trusted closing.
        if (canRequestNativeClick && runtimeApi && typeof (runtimeApi as any).sendMessage === 'function') {
            const dpr = window.devicePixelRatio || 1;
            const physicalX = outsideNow.x * dpr;
            const physicalY = outsideNow.y * dpr;
            try {
                console.log(`[SpatialNav] Closing menu toggle via NATIVE outside click ${safeJson({
                    css: { x: outsideNow.x, y: outsideNow.y, point: outsideNow.label },
                    dpr,
                    final: { x: physicalX, y: physicalY }
                })}`);
                (runtimeApi as any).sendMessage({
                    type: 'simulateClick',
                    x: physicalX,
                    y: physicalY,
                    debug: {
                        cssX: outsideNow.x,
                        cssY: outsideNow.y,
                        point: outsideNow.label,
                        hit: describeElement(outsideNow.hit),
                        context: 'menuToggleClose',
                    }
                });
            } catch (e) {
                console.warn('[SpatialNav] Native outside-click failed, using JS fallback', e);
            }
        } else {
            const hit = outsideNow.hit as any;
            try {
                if (hit && typeof hit.dispatchEvent === 'function') {
                    hit.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window, clientX: outsideNow.x, clientY: outsideNow.y, buttons: 1, detail: 1 }));
                    hit.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window, clientX: outsideNow.x, clientY: outsideNow.y, buttons: 1, detail: 1 }));
                }
                if (hit && typeof hit.click === 'function') {
                    hit.click();
                } else if (typeof document.body?.click === 'function') {
                    document.body.click();
                }
            } catch {
                // ignore
            }
        }

        // Restore focus to the toggle after the outside-click closes the menu.
        // Native injection will typically move focus to the clicked element.
        setTimeout(() => {
            const currentId2 = document.documentElement.getAttribute('data-spatnav-handler-id');
            if (String(closeHandlerId) !== currentId2) return;
            try {
                if (typeof (actionElement as any).focus === 'function') {
                    (actionElement as any).focus();
                }
                scheduleOverlayUpdate(actionElement as HTMLElement, state);
            } catch {
                // ignore
            }
        }, 120);
    }, 0);

    state.dirty = true;
    event.preventDefault();
    event.stopPropagation();
    return true;
}

