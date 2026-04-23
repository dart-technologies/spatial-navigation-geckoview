#!/usr/bin/env node
/**
 * Keep extension/manifest.json's `version` in lockstep with package.json.
 *
 * The WebExtension manifest version must match the published npm version
 * so users always know what build they have. Run after every build.
 */

import { readFileSync, writeFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const manifestPath = 'extension/manifest.json';
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

if (manifest.version === pkg.version) {
    console.log(`[manifest] version already in sync (${pkg.version})`);
    process.exit(0);
}

const previous = manifest.version;
manifest.version = pkg.version;
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
console.log(`[manifest] version ${previous} → ${pkg.version}`);
