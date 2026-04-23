/**
 * Preview UI tests — chevrons positioned around the focus ring.
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { directionByName, type Direction } from '../core/config';
import { updatePreviewVisuals } from '../core/preview';
import {
    setupDomEnv,
    teardownDomEnv,
    attachElement,
    createElement,
    createTestState,
} from './helpers/dom_env';
import type { NavigationCandidate } from '../core/scoring';

function makePreviewLayer(): {
    layer: HTMLElement;
    entries: Record<'up' | 'down' | 'left' | 'right', { container: HTMLElement; arrow: HTMLElement }>;
} {
    const layer = attachElement(createElement({ tagName: 'div', id: 'preview-layer' }));
    const directions = ['up', 'down', 'left', 'right'] as const;
    const entries = {} as Record<
        'up' | 'down' | 'left' | 'right',
        { container: HTMLElement; arrow: HTMLElement }
    >;
    for (const dir of directions) {
        const container = createElement({ tagName: 'div', className: `focus-preview focus-preview-${dir}` });
        const arrow = createElement({ tagName: 'div', className: 'focus-preview-arrow' });
        container.appendChild(arrow);
        layer.appendChild(container);
        entries[dir] = { container, arrow };
    }
    return { layer, entries };
}

describe('updatePreviewVisuals', () => {
    beforeEach(() => setupDomEnv({ innerWidth: 1920, innerHeight: 1080 }));
    afterEach(() => teardownDomEnv());

    test('positions the right chevron just outside the current rect', () => {
        const current = attachElement(
            createElement({ tagName: 'button', rect: { x: 100, y: 100, width: 100, height: 40 } })
        );
        const target = attachElement(
            createElement({ tagName: 'button', rect: { x: 300, y: 100, width: 100, height: 40 } })
        );

        const { layer, entries } = makePreviewLayer();
        const state = createTestState([current, target], {
            previewEnabled: true,
            previewLayer: layer,
            previewElements: entries,
        });
        state.currentIndex = 0;

        const findCandidate = (_idx: number, dir: Direction): NavigationCandidate | null =>
            dir.name === 'right'
                ? ({ data: { element: target }, index: 1 } as unknown as NavigationCandidate)
                : null;

        updatePreviewVisuals(
            current,
            current.getBoundingClientRect(),
            findCandidate,
            directionByName,
            (el) => (el ? 'candidate' : ''),
            state
        );

        // size = clamp(14..26, round(min(100,40)*0.28)=11) → 14
        // offset = max(10, round(14*0.75)=11) → 11 → right edge 200 + 11 = 211
        assert.equal(entries.right.container.style.left, '211px');
        assert.equal(entries.right.container.style.width, '14px');
        assert.equal(entries.right.container.className, 'focus-preview focus-preview-right show');
    });

    test('clamps chevrons to safeAreaMargin near the viewport edge', () => {
        const current = attachElement(
            createElement({ tagName: 'button', rect: { x: 10, y: 10, width: 50, height: 30 } })
        );
        const target = attachElement(
            createElement({ tagName: 'button', rect: { x: 200, y: 10, width: 50, height: 30 } })
        );

        teardownDomEnv();
        setupDomEnv({ innerWidth: 300, innerHeight: 300 });

        const current2 = attachElement(
            createElement({ tagName: 'button', rect: { x: 10, y: 10, width: 50, height: 30 } })
        );
        const target2 = attachElement(
            createElement({ tagName: 'button', rect: { x: 200, y: 10, width: 50, height: 30 } })
        );
        void current;
        void target;

        const { layer, entries } = makePreviewLayer();
        const state = createTestState(
            [current2, target2],
            {
                previewEnabled: true,
                previewLayer: layer,
                previewElements: entries,
            },
            { safeAreaMargin: 20 }
        );
        state.currentIndex = 0;

        const findCandidate = (_idx: number, dir: Direction): NavigationCandidate | null =>
            dir.name === 'left'
                ? ({ data: { element: target2 }, index: 1 } as unknown as NavigationCandidate)
                : null;

        updatePreviewVisuals(
            current2,
            current2.getBoundingClientRect(),
            findCandidate,
            directionByName,
            (el) => (el ? 'candidate' : ''),
            state
        );

        assert.equal(entries.left.container.style.left, '20px');
        assert.equal(entries.left.container.style.top, '20px');
        assert.equal(entries.left.container.className, 'focus-preview focus-preview-left show');
    });

    test('hides the chevron when no candidate exists in that direction', () => {
        const current = attachElement(
            createElement({ tagName: 'button', rect: { x: 100, y: 100, width: 100, height: 40 } })
        );

        const { layer, entries } = makePreviewLayer();
        const state = createTestState([current], {
            previewEnabled: true,
            previewLayer: layer,
            previewElements: entries,
        });
        state.currentIndex = 0;

        updatePreviewVisuals(
            current,
            current.getBoundingClientRect(),
            () => null,
            directionByName,
            () => '',
            state
        );

        assert.equal(entries.up.container.className, 'focus-preview focus-preview-up');
        assert.equal(entries.up.container.style.left, '');
    });
});
