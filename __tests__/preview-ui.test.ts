/**
 * Preview UI tests (chevrons around focus ring)
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { directionByName } from '../core/config';
import { updatePreviewVisuals } from '../core/preview';
import { setupMockEnv } from './helpers/mock_env';

function makePreviewEntry() {
    const container = {
        className: 'focus-preview',
        style: {} as Record<string, string>,
        setAttribute: () => { },
        removeAttribute: () => { },
    } as unknown as HTMLElement;

    const arrow = { style: {} as Record<string, string> } as unknown as HTMLElement;

    return { container, arrow };
}

test('updatePreviewVisuals positions chevron outside current rect (right)', () => {
    setupMockEnv({ innerWidth: 1920, innerHeight: 1080 });

    const currentRect = {
        left: 100,
        top: 100,
        right: 200,
        bottom: 140,
        width: 100,
        height: 40,
        x: 100,
        y: 100,
        toJSON: () => ({})
    } as DOMRect;

    const right = makePreviewEntry();
    const state: any = {
        currentIndex: 0,
        focusables: [{ element: {} }],
        focusableElements: [{}],
        previewEnabled: true,
        previewLayer: {} as any,
        previewElements: {
            up: makePreviewEntry(),
            down: makePreviewEntry(),
            left: makePreviewEntry(),
            right,
        },
        nextTargets: { up: null, down: null, left: null, right: null },
        config: { safeAreaMargin: 0 },
    };

    const candidateEl = {} as any;
    const findCandidate = (_currentIndex: number, dir: any) => {
        if (dir?.name === 'right') {
            return { data: { element: candidateEl }, index: 1 } as any;
        }
        return null;
    };

    updatePreviewVisuals(
        {} as any,
        currentRect,
        findCandidate as any,
        directionByName as any,
        () => 'candidate',
        state
    );

    // size = clamp(14..26, round(min(100,40)*0.28)=11) => 14
    // offset = max(10, round(14*0.75)=11) => 11
    assert.equal((right.container as any).style.left, '211px');
    assert.equal((right.container as any).style.top, '113px');
    assert.equal((right.container as any).style.width, '14px');
    assert.equal((right.container as any).style.height, '14px');
    assert.equal((right.container as any).className, 'focus-preview focus-preview-right show');
});

test('updatePreviewVisuals clamps chevrons to safeAreaMargin', () => {
    setupMockEnv({ innerWidth: 300, innerHeight: 300 });

    const currentRect = {
        left: 10,
        top: 10,
        right: 60,
        bottom: 40,
        width: 50,
        height: 30,
        x: 10,
        y: 10,
        toJSON: () => ({})
    } as DOMRect;

    const left = makePreviewEntry();
    const state: any = {
        currentIndex: 0,
        focusables: [{ element: {} }],
        focusableElements: [{}],
        previewEnabled: true,
        previewLayer: {} as any,
        previewElements: {
            up: makePreviewEntry(),
            down: makePreviewEntry(),
            left,
            right: makePreviewEntry(),
        },
        nextTargets: { up: null, down: null, left: null, right: null },
        config: { safeAreaMargin: 20 },
    };

    const candidateEl = {} as any;
    const findCandidate = (_currentIndex: number, dir: any) => {
        if (dir?.name === 'left') {
            return { data: { element: candidateEl }, index: 1 } as any;
        }
        return null;
    };

    updatePreviewVisuals(
        {} as any,
        currentRect,
        findCandidate as any,
        directionByName as any,
        () => 'candidate',
        state
    );

    assert.equal((left.container as any).style.left, '20px');
    assert.equal((left.container as any).style.top, '20px');
    assert.equal((left.container as any).className, 'focus-preview focus-preview-left show');
});

