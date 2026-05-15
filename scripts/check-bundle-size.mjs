#!/usr/bin/env node
/**
 * Bundle size budget check.
 *
 * Reads built artifacts in dist/ and asserts each one is under its budget.
 * Exits non-zero on a regression so CI can gate.
 *
 * Update the budgets after a deliberate increase (with PR justification).
 */

import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const DIST = 'dist';

/** Per-file budgets in bytes. Numbers are deliberate; bump with a PR comment. */
const BUDGETS = {
    'spatial-navigation.js': 110_000, // UMD
    'spatial-navigation.esm.js': 110_000, // ESM
    'spatial-navigation.extension.js': 110_000, // GeckoView IIFE (production)
    'spatial-navigation.debug.js': 320_000, // Debug bundle (sourcemap, no minify). Bumped 280K→320K in v3.1.0 for modality watcher + visual-rect logic.
    'background.js': 5_000, // Tiny background relay
    'core.js': 60_000,
    'core.esm.js': 60_000,
    'messaging.js': 12_000,
    'messaging.esm.js': 12_000,
};

let failed = false;
const rows = [];

const files = readdirSync(DIST).filter((f) => f.endsWith('.js'));
for (const file of files) {
    const path = join(DIST, file);
    const size = statSync(path).size;
    const budget = BUDGETS[file];

    if (budget == null) {
        rows.push({ file, size, budget: '—', status: 'no budget' });
        continue;
    }

    const utilization = ((size / budget) * 100).toFixed(1);
    const status = size <= budget ? `OK (${utilization}%)` : `OVER (${utilization}%)`;
    rows.push({ file, size, budget, status });

    if (size > budget) {
        failed = true;
    }
}

const fmt = (n) => (typeof n === 'number' ? `${(n / 1024).toFixed(1)}K` : n);
const widths = {
    file: Math.max(4, ...rows.map((r) => r.file.length)),
    size: 8,
    budget: 8,
    status: 14,
};

const pad = (s, w) => String(s).padEnd(w);
console.log(
    pad('file', widths.file) +
        '  ' +
        pad('size', widths.size) +
        '  ' +
        pad('budget', widths.budget) +
        '  ' +
        pad('status', widths.status)
);
console.log('-'.repeat(widths.file + widths.size + widths.budget + widths.status + 6));
for (const r of rows) {
    console.log(
        pad(r.file, widths.file) +
            '  ' +
            pad(fmt(r.size), widths.size) +
            '  ' +
            pad(fmt(r.budget), widths.budget) +
            '  ' +
            pad(r.status, widths.status)
    );
}

if (failed) {
    console.error(
        '\nBundle size regression. Bump the budget in scripts/check-bundle-size.mjs only after PR review.'
    );
    process.exit(1);
}
