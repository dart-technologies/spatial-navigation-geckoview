/**
 * Behavior-driven end-to-end tests.
 *
 * Unlike visual.spec.ts these don't compare screenshots — they assert on the
 * functional outcome of keyboard navigation: which element ends up focused,
 * whether the focus group containment fires, whether Enter activates the
 * focused element, etc.
 *
 * Runs the production extension bundle (e2e/fixtures/spatial-navigation.js)
 * inside Chromium via Playwright.
 */

import { test, expect, type Page } from '@playwright/test';

async function focusedDataId(page: Page): Promise<string | null> {
    return page.evaluate(() => {
        const active = document.activeElement as HTMLElement | null;
        return active?.dataset.id ?? null;
    });
}

async function pressAndSettle(page: Page, key: string): Promise<void> {
    await page.keyboard.press(key);
    // Must exceed the RAPID_REPEAT_THRESHOLD_MS (50ms) guard in handlers.ts,
    // otherwise the next same-key press is discarded as a synthetic repeat.
    await page.waitForTimeout(80);
}

// ---------------------------------------------------------------------------
// Plain row + column navigation
// ---------------------------------------------------------------------------

test.describe('Behavior: plain row / column navigation', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/behavior.html');
        await page.waitForFunction(() => !!(window as { spatialNavState?: object }).spatialNavState);
    });

    test('ArrowRight moves through the row in order', async ({ page }) => {
        await page.locator('[data-id="r1"]').focus();
        await pressAndSettle(page, 'ArrowRight');
        expect(await focusedDataId(page)).toBe('r2');
        await pressAndSettle(page, 'ArrowRight');
        expect(await focusedDataId(page)).toBe('r3');
        await pressAndSettle(page, 'ArrowRight');
        expect(await focusedDataId(page)).toBe('r4');
    });

    test('ArrowLeft reverses through the row', async ({ page }) => {
        await page.locator('[data-id="r4"]').focus();
        await pressAndSettle(page, 'ArrowLeft');
        expect(await focusedDataId(page)).toBe('r3');
        await pressAndSettle(page, 'ArrowLeft');
        expect(await focusedDataId(page)).toBe('r2');
    });

    test('ArrowDown / ArrowUp walks the column', async ({ page }) => {
        await page.locator('[data-id="c1"]').focus();
        await pressAndSettle(page, 'ArrowDown');
        expect(await focusedDataId(page)).toBe('c2');
        await pressAndSettle(page, 'ArrowDown');
        expect(await focusedDataId(page)).toBe('c3');
        await pressAndSettle(page, 'ArrowUp');
        expect(await focusedDataId(page)).toBe('c2');
    });
});

// ---------------------------------------------------------------------------
// Focus group containment
// ---------------------------------------------------------------------------

test.describe('Behavior: focus group boundary=contain', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/behavior.html');
        await page.waitForFunction(() => !!(window as { spatialNavState?: object }).spatialNavState);
    });

    test('cannot exit a contained group via ArrowDown from the last item', async ({ page }) => {
        await page.locator('[data-id="g3"]').focus();
        await pressAndSettle(page, 'ArrowDown');
        // Focus must remain inside the group — should not jump to "below1".
        const id = await focusedDataId(page);
        expect(['g3', 'g1', 'g2']).toContain(id ?? '');
        expect(id).not.toBe('below1');
        expect(id).not.toBe('below2');
    });

    test('can navigate within the contained group', async ({ page }) => {
        await page.locator('[data-id="g1"]').focus();
        await pressAndSettle(page, 'ArrowDown');
        expect(await focusedDataId(page)).toBe('g2');
        await pressAndSettle(page, 'ArrowDown');
        expect(await focusedDataId(page)).toBe('g3');
    });
});

// ---------------------------------------------------------------------------
// Enter activation
// ---------------------------------------------------------------------------

test.describe('Behavior: Enter key activation', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/behavior.html');
        await page.waitForFunction(() => !!(window as { spatialNavState?: object }).spatialNavState);
    });

    test('Enter activates the focused button (.click() fires)', async ({ page }) => {
        await page.locator('[data-id="r2"]').focus();
        await pressAndSettle(page, 'Enter');
        const activated = await page
            .locator('#last-activated')
            .evaluate((el) => el.getAttribute('data-activated'));
        expect(activated).toBe('r2');
    });

    test('Space also activates the focused button', async ({ page }) => {
        await page.locator('[data-id="r3"]').focus();
        await pressAndSettle(page, 'Space');
        const activated = await page
            .locator('#last-activated')
            .evaluate((el) => el.getAttribute('data-activated'));
        expect(activated).toBe('r3');
    });
});

// ---------------------------------------------------------------------------
// WICG polyfill installation
// ---------------------------------------------------------------------------

test.describe('Behavior: WICG polyfill APIs', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/behavior.html');
        await page.waitForFunction(() => !!(window as { spatialNavState?: object }).spatialNavState);
    });

    test('window.navigate is installed and moves focus', async ({ page }) => {
        await page.locator('[data-id="r1"]').focus();
        await page.evaluate(() => (window as { navigate?: (d: string) => void }).navigate?.('right'));
        await page.waitForTimeout(40);
        expect(await focusedDataId(page)).toBe('r2');
    });

    test('Element.focusableAreas returns the document focusables', async ({ page }) => {
        const count = await page.evaluate(() => {
            const areas = (
                document.body as Element & { focusableAreas?: () => Element[] }
            ).focusableAreas?.();
            return areas?.length ?? 0;
        });
        // 4 row + 3 col + 3 group + 2 below = 12
        expect(count).toBeGreaterThanOrEqual(12);
    });

    test('Element.spatialNavigationSearch finds the right neighbor', async ({ page }) => {
        const id = await page.evaluate(() => {
            const r1 = document.querySelector('[data-id="r1"]') as Element & {
                spatialNavigationSearch?: (d: string) => Element | null;
            };
            const next = r1.spatialNavigationSearch?.('right') as HTMLElement | null;
            return next?.dataset.id ?? null;
        });
        expect(id).toBe('r2');
    });
});

// ---------------------------------------------------------------------------
// Overlay rendering & accessibility attributes
// ---------------------------------------------------------------------------

test.describe('Behavior: overlay accessibility', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/behavior.html');
        await page.waitForFunction(() => !!(window as { spatialNavState?: object }).spatialNavState);
    });

    test('overlay host carries role="presentation" and aria-hidden="true"', async ({ page }) => {
        await page.locator('[data-id="r1"]').focus();
        await pressAndSettle(page, 'ArrowRight');
        const host = page.locator('#spatnav-focus-host');
        await expect(host).toHaveAttribute('role', 'presentation');
        await expect(host).toHaveAttribute('aria-hidden', 'true');
    });
});
