import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
    testDir: './e2e',
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    workers: process.env.CI ? 1 : undefined,
    reporter: 'html',

    use: {
        baseURL: 'http://localhost:3001',
        trace: 'on-first-retry',
        screenshot: 'only-on-failure',
    },

    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] },
        },
    ],

    webServer: {
        command: 'npx serve e2e/fixtures -p 3001',
        url: 'http://localhost:3001',
        reuseExistingServer: !process.env.CI,
    },

    expect: {
        toHaveScreenshot: {
            maxDiffPixelRatio: 0.1,
            threshold: 0.2,
        },
    },

    snapshotPathTemplate: '{testDir}/{testFileName}-snapshots/{arg}-{projectName}{ext}',
});
