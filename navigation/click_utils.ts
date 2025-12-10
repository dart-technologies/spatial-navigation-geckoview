/**
 * Click/hit-testing helpers for Spatial Navigation.
 *
 * Kept separate from handlers.ts to reduce file size and make the
 * click path easier to test and reason about.
 */

function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
}

export function clampToViewport(x: number, y: number): { x: number; y: number } {
    const maxX = Math.max(0, (window?.innerWidth ?? 0) - 1);
    const maxY = Math.max(0, (window?.innerHeight ?? 0) - 1);
    return {
        x: clamp(x, 0, maxX),
        y: clamp(y, 0, maxY)
    };
}

function isHitWithinTarget(hit: Element | null, target: Element): boolean {
    if (!hit) return false;
    if (hit === target) return true;
    try {
        return target.contains(hit);
    } catch {
        return false;
    }
}

export function pickClickPoint(target: Element): { x: number; y: number; label: string; hit: Element | null } {
    const rect = target.getBoundingClientRect();
    const inset = 1;

    const points = [
        { label: 'center', x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
        { label: 'top-left', x: rect.left + inset, y: rect.top + inset },
        { label: 'top-right', x: rect.right - inset, y: rect.top + inset },
        { label: 'bottom-left', x: rect.left + inset, y: rect.bottom - inset },
        { label: 'bottom-right', x: rect.right - inset, y: rect.bottom - inset },
        { label: 'top-center', x: rect.left + rect.width / 2, y: rect.top + inset },
        { label: 'bottom-center', x: rect.left + rect.width / 2, y: rect.bottom - inset },
        { label: 'center-left', x: rect.left + inset, y: rect.top + rect.height / 2 },
        { label: 'center-right', x: rect.right - inset, y: rect.top + rect.height / 2 }
    ];

    for (const point of points) {
        const clamped = clampToViewport(point.x, point.y);
        const hit = document.elementFromPoint(clamped.x, clamped.y);
        if (isHitWithinTarget(hit, target)) {
            return { x: clamped.x, y: clamped.y, label: point.label, hit };
        }
    }

    const fallback = clampToViewport(points[0].x, points[0].y);
    return { x: fallback.x, y: fallback.y, label: 'center', hit: document.elementFromPoint(fallback.x, fallback.y) };
}

