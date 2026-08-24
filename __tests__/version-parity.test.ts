/**
 * Version parity — pins RELEASING.md's "Version locations" table so a bump
 * can never ship split again (3.3.0 initially shipped with package.json /
 * manifest at 3.3.0 while `main.ts` VERSION and both `core/state.ts`
 * literals still said 3.2.0 — the host plugin gates
 * `waitForSpatialNavInit` on the runtime-reported version, so a split
 * identity times out spatial-nav init downstream).
 *
 * Sources are read as TEXT (importing main.ts would execute the content
 * script's top-level init). The built prod bundle is checked too so a
 * stale `extension/spatial_navigation.js` fails the suite until rebuilt.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string): string => readFileSync(join(root, rel), 'utf8');

const pkgVersion = (JSON.parse(read('package.json')) as { version: string }).version;

test('manifest version matches package.json', () => {
    const manifest = JSON.parse(read('extension/manifest.json')) as { version: string };
    assert.equal(manifest.version, pkgVersion, 'run `npm run sync:manifest`');
});

test('main.ts VERSION constant matches package.json', () => {
    const m = read('main.ts').match(/const VERSION = '([^']+)';/);
    assert.ok(m, 'main.ts must declare `const VERSION`');
    assert.equal(m![1], pkgVersion);
});

test('core/state.ts version literals (both sites) match package.json', () => {
    const src = read('core/state.ts');
    const assignment = src.match(/state\.version = '([^']+)';/);
    assert.ok(assignment, 'state.ts must assign state.version');
    assert.equal(assignment![1], pkgVersion, 'state.version assignment');
    const fallback = src.match(/state\.version \|\| '([^']+)'/);
    assert.ok(fallback, 'state.ts must carry the version fallback literal');
    assert.equal(fallback![1], pkgVersion, 'state.version fallback literal');
});

test('built prod bundle reports the package version', () => {
    const bundle = read('extension/spatial_navigation.js');
    assert.ok(
        bundle.includes(`'${pkgVersion}'`) || bundle.includes(`"${pkgVersion}"`),
        `extension/spatial_navigation.js does not contain ${pkgVersion} — run \`npm run build:all\``
    );
});
