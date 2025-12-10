/**
 * Visual regression tests for Spatial Navigation
 *
 * Tests focus overlay appearance using Playwright screenshot comparisons.
 * Navigation logic is tested in unit tests; these tests verify visual rendering.
 */

import { test, expect } from '@playwright/test';

test.describe('Spatial Navigation Visual Tests', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
        // Wait for spatial nav to initialize
        await page.waitForTimeout(300);
    });

    test('initial page layout', async ({ page }) => {
        // Just verify the page loads correctly
        await expect(page.locator('h1')).toContainText('Spatial Navigation');
        await expect(page).toHaveScreenshot('grid-initial.png');
    });

    test('focus overlay visible on card', async ({ page }) => {
        // Click on first card to focus it
        await page.locator('.card').first().click();
        await page.waitForTimeout(200);

        // Check that card is focused
        const focused = await page.locator('.card:focus');
        await expect(focused).toBeVisible();

        await expect(page).toHaveScreenshot('focus-overlay-visible.png');
    });

    test('grid section layout', async ({ page }) => {
        // Just verify grid section renders
        await expect(page.locator('.grid').first()).toBeVisible();
        await expect(page.locator('.card')).toHaveCount(12); // 8 + 4 grid mode
    });

    test('contained section visible', async ({ page }) => {
        // Verify contained section renders with CSS property
        const contained = page.locator('.contained-section');
        await expect(contained).toBeVisible();
        await expect(contained).toHaveCSS('--spatial-navigation-contain', 'contain');
    });

    test('grid mode section visible', async ({ page }) => {
        // Verify grid mode section renders with CSS property
        const gridMode = page.locator('.grid-mode-section');
        await expect(gridMode).toBeVisible();
        await expect(gridMode).toHaveCSS('--spatial-navigation-function', 'grid');
    });

    test('focus moves between cards with Tab', async ({ page }) => {
        // Click first card to establish focus
        await page.locator('.card').first().click();
        await page.waitForTimeout(100);

        const focused1 = page.locator(':focus');
        await expect(focused1).toHaveAttribute('data-id', '1');

        // Tab to next card
        await page.keyboard.press('Tab');
        await page.waitForTimeout(100);

        const focused2 = page.locator(':focus');
        await expect(focused2).toHaveAttribute('data-id', '2');
    });

    test('status indicator updates on focus', async ({ page }) => {
        // Focus first card
        await page.locator('[data-id="1"]').focus();
        await page.waitForTimeout(100);

        // Check status shows card ID
        const status = await page.locator('#focus-target').textContent();
        expect(status).toBe('1');
    });

    test('focus moves with Arrow keys', async ({ page }) => {
        await page.locator('.card').first().click();
        await page.waitForTimeout(100);

        await page.keyboard.press('ArrowRight');
        await page.waitForTimeout(50);
        await expect(page.locator(':focus')).toHaveAttribute('data-id', '2');

        await page.keyboard.press('ArrowLeft');
        await page.waitForTimeout(50);
        await expect(page.locator(':focus')).toHaveAttribute('data-id', '1');
    });

    test('grid boundary navigation', async ({ page }) => {
        // Focus the last grid-mode card (g4) - it's at the right boundary
        const gridModeCards = page.locator('.grid-mode-section .card');
        await gridModeCards.last().focus();
        await page.waitForTimeout(50);

        // Verify we're focused on g4
        await expect(page.locator(':focus')).toHaveAttribute('data-id', 'g4');

        // Press ArrowRight at the boundary
        await page.keyboard.press('ArrowRight');
        await page.waitForTimeout(100);

        // Since grid-mode section doesn't have containment, focus may escape
        // The key behavior is that SOME focusable element receives focus
        const focusedElement = page.locator(':focus');
        await expect(focusedElement).toBeVisible();

        // Verify focus stayed or moved appropriately (not lost)
        const tagName = await focusedElement.evaluate(el => el.tagName);
        expect(tagName).toBe('BUTTON');
    });
});
