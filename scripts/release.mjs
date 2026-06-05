#!/usr/bin/env node
/**
 * Release helper. Bumps the version across every source of truth, dates the
 * CHANGELOG, syncs the lockfile + manifest, and rebuilds bundles. It stops short
 * of the irreversible steps — it prints the commit/tag/push commands for you to
 * run after reviewing. See RELEASING.md.
 *
 * Usage:
 *   node scripts/release.mjs <new-version>            # e.g. 3.3.0
 *   node scripts/release.mjs <new-version> --dry-run  # report, don't write
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const newVersion = args.find((a) => !a.startsWith('--'));

if (!newVersion || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(newVersion)) {
    console.error('Usage: node scripts/release.mjs <semver> [--dry-run]   (e.g. 3.3.0)');
    process.exit(1);
}

const current = JSON.parse(readFileSync('package.json', 'utf8')).version;
const cmp = (a, b) => a.localeCompare(b, undefined, { numeric: true });
if (cmp(newVersion, current) <= 0) {
    console.error(`Refusing: ${newVersion} is not greater than the current ${current}.`);
    process.exit(1);
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Replace the version in `file` via `makeRegex(oldVersion)`, asserting a match. */
function bump(file, makeRegex, replacement) {
    const before = readFileSync(file, 'utf8');
    const re = makeRegex(esc(current));
    if (!re.test(before)) {
        console.error(`! ${file}: expected version ${current} not found (pattern ${re}).`);
        process.exit(1);
    }
    if (!dryRun) writeFileSync(file, before.replace(re, replacement));
    console.log(`  ${dryRun ? 'would bump' : 'bumped'} ${file}`);
}

console.log(`Releasing ${current} -> ${newVersion}${dryRun ? '  (dry run)' : ''}`);

bump('package.json', (v) => new RegExp(`("version":\\s*")${v}(")`), `$1${newVersion}$2`);
bump('main.ts', (v) => new RegExp(`(const VERSION = ')${v}(')`), `$1${newVersion}$2`);
bump('core/state.ts', (v) => new RegExp(`(state\\.version = ')${v}(')`), `$1${newVersion}$2`);
bump('core/state.ts', (v) => new RegExp(`(state\\.version \\|\\| ')${v}(')`), `$1${newVersion}$2`);
bump('README.md', (v) => new RegExp(`(badge/version-)${v}(-blue)`), `$1${newVersion}$2`);

// Date the CHANGELOG: `## [Unreleased]` -> `## [X.Y.Z] — YYYY-MM-DD`.
const date = new Date().toISOString().slice(0, 10);
const changelog = readFileSync('CHANGELOG.md', 'utf8');
if (!/^## \[Unreleased\]/m.test(changelog)) {
    console.error('! CHANGELOG.md: no "## [Unreleased]" section to release — add one first.');
    process.exit(1);
}
if (!dryRun) {
    writeFileSync('CHANGELOG.md', changelog.replace(/^## \[Unreleased\]/m, `## [${newVersion}] — ${date}`));
}
console.log(`  ${dryRun ? 'would date' : 'dated'} CHANGELOG.md (${date})`);

if (dryRun) {
    console.log('\nDry run complete — all version sites matched, nothing written.');
    process.exit(0);
}

console.log('Syncing lockfile + manifest, rebuilding bundles...');
execSync('npm install --package-lock-only --ignore-scripts', { stdio: 'inherit' });
execSync('npm run build:all', { stdio: 'inherit' });
execSync('npm run build:types', { stdio: 'inherit' });

console.log(`\n✅ ${newVersion} staged in the working tree. Review, then:`);
console.log(`   git add -A`);
console.log(`   git commit -m "feat(release): v${newVersion} — <summary>"`);
console.log(`   git tag -a v${newVersion} -m "v${newVersion} — <summary>"`);
console.log(`   git push origin main && git push origin v${newVersion}   # tag push publishes`);
