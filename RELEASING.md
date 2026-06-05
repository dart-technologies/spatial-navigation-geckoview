# Releasing

This document captures the steps to cut a release of `@dart-technologies/spatial-navigation-geckoview`. The audience is the maintainer with publish access.

## Versioning

We follow [SemVer](https://semver.org/):

- **MAJOR** — breaking changes to the WICG-compat API surface, the `window.spatialNavConfig` schema, the messaging protocol, or removal of a deprecated alias.
- **MINOR** — backward-compatible feature additions (new config keys, new outbound message types, new opt-in behaviors).
- **PATCH** — backward-compatible bug fixes, security hardening, internal refactors, documentation.

Security fixes ship as PATCH unless they require a behavior change that breaks downstream consumers — in which case they ship as MINOR with the security context called out in the CHANGELOG.

## Version locations

The version number appears in **four** source files. They must all be kept in sync. `scripts/sync-manifest-version.mjs` automates the second one from the first.

| File                      | Field                                                                         | Synced by                |
| ------------------------- | ----------------------------------------------------------------------------- | ------------------------ |
| `package.json`            | `"version"`                                                                   | manual (source of truth) |
| `extension/manifest.json` | `"version"`                                                                   | `npm run sync:manifest`  |
| `main.ts`                 | `const VERSION`                                                               | manual                   |
| `core/state.ts`           | `state.version = '…'` assignment **and** the `'…'` fallback literal (2 sites) | manual                   |

After bumping `package.json`, run `npm run build:all` — that runs the build then sync-manifest, leaving only the two `*.ts` constants for you to update by hand.

## Pre-release checklist

Run from a clean working tree on `main`:

```bash
# 1. Ensure everything green
npm run format:check
npm run lint
npm run typecheck
npm run typecheck:tests
npm test
npm run test:coverage
npm run audit:check
npm run size

# 2. Verify the build is fresh
npm run build:all
npm run build:types

# 3. Inspect what's going into the npm tarball
npm pack --dry-run
```

The tarball must include `dist/`, `extension/`, `README.md`, `CHANGELOG.md`, `LICENSE`. It must **not** include `__tests__/`, `e2e/`, `perf/`, `coverage/`, or `node_modules/`.

## Cutting a release

> **Shortcut:** `npm run release 3.3.0` (or `node scripts/release.mjs 3.3.0`)
> automates steps 1–3 below — it bumps every version site, dates the
> `## [Unreleased]` CHANGELOG section, syncs the lockfile + manifest, rebuilds
> bundles, and prints the commit/tag/push commands. Add `--dry-run` to preview.
> The manual steps below remain the source of truth for what it does.

### 1. Bump version

Update all four locations listed above to the new version. Example for a `3.1.0` cut:

```bash
# Edit package.json -> "version": "3.1.0"
# Edit main.ts -> const VERSION = '3.1.0';
# Edit core/state.ts -> the `state.version = '3.1.0'` assignment AND the
#   `version: state.version || '3.1.0'` fallback literal (2 sites; a find/replace
#   of the old version string across state.ts catches both)
npm run build:all   # syncs extension/manifest.json
```

### 2. Update CHANGELOG

Edit `CHANGELOG.md`. The next-version heading should already be in place from feature PRs (Keep-a-Changelog convention is to land changelog entries with the change). Replace `[X.Y.Z] — Unreleased` with `[X.Y.Z] — YYYY-MM-DD`.

### 3. Update README badge

```
[![Version](https://img.shields.io/badge/version-X.Y.Z-blue.svg)](...)
```

### 4. Update MIGRATION.md (if behavior changed)

Only required if existing users need to do something. Pure-addition releases don't need a new MIGRATION section.

### 5. Commit and tag

```bash
git add -p   # review each hunk
git commit -m "chore(release): vX.Y.Z — <one-line summary>"
git tag -a vX.Y.Z -m "vX.Y.Z — <one-line summary>"
```

### 6. Push

```bash
git push origin main
git push origin vX.Y.Z
```

Pushing the tag triggers the publish workflow (`.github/workflows/publish.yml`), which:

- Runs the full CI suite.
- Builds `dist/` and `dist/types/`.
- Publishes to GitHub Packages (`npm.pkg.github.com`).
- Creates a GitHub Release with auto-generated notes from the tag.

### 7. Smoke-test the published package

After the publish workflow finishes:

```bash
# Verify on the registry
npm view @dart-technologies/spatial-navigation-geckoview@X.Y.Z

# Pull into a scratch directory
mkdir /tmp/spatnav-smoke && cd /tmp/spatnav-smoke
npm init -y
echo "@dart-technologies:registry=https://npm.pkg.github.com" > .npmrc
npm install @dart-technologies/spatial-navigation-geckoview@X.Y.Z
```

Confirm `node_modules/@dart-technologies/spatial-navigation-geckoview/extension/manifest.json` reads version `X.Y.Z`.

### 8. Manual extension load test

Load `extension/` as a temporary GeckoView add-on (or in Firefox via `about:debugging`):

- Confirm overlay renders on a basic page.
- Confirm D-pad/arrow navigation moves focus.
- Confirm `inputModalityChange` fires when switching between mouse and keyboard.
- Confirm `boundaryScrollBehavior` defaults work (scrolling at container edges).
- For security releases: verify the specific hardening behaves as described in CHANGELOG.

## Hotfix releases

For an out-of-band PATCH from a tag:

```bash
git checkout -b hotfix/X.Y.Z+1 vX.Y.Z
# make the fix, commit
# bump version (PATCH-only locations)
npm run build:all
git commit -am "chore(release): vX.Y.Z+1 — <summary>"
git tag -a vX.Y.Z+1 -m "vX.Y.Z+1"
git push origin hotfix/X.Y.Z+1
# Open PR to merge back into main; tag push triggers publish
```

For **security** hotfixes, also open a private GitHub Security Advisory (see [`SECURITY.md`](SECURITY.md)) and request a CVE if the issue warrants one. Disclose publicly only after the fix is published and downstream consumers have had time to upgrade.

## Yanking a bad release

```bash
# Deprecate the published version
npm deprecate @dart-technologies/spatial-navigation-geckoview@X.Y.Z "Use X.Y.Z+1 — <reason>"

# Push a follow-up release with the fix
# (do NOT unpublish — that breaks installs for anyone who pinned)
```

Add a `[X.Y.Z+1]` CHANGELOG entry that explicitly notes the predecessor was withdrawn and why.

## Notes

- We never amend a tagged commit. If a release commit needs a follow-up, cut a new PATCH.
- We never force-push `main` or rewrite history near a tag.
- Bundle artifacts (`extension/*.js`, `dist/`) **are** committed to the repository — they are part of the published package and need to be reviewable. Always rebuild them on the release commit.
- Pre-commit hooks (`.husky/pre-commit`) run `lint-staged`, which runs Prettier + ESLint on every staged `*.ts`. If a release-bump commit fails the hook, fix the formatting and re-stage; never use `--no-verify`.
