# ADR 0001 — Commit built `extension/` bundles to the repository

- **Status:** Accepted
- **Date:** 2026-06-05

## Context

The loadable WebExtension lives in `extension/` (`spatial_navigation.js`,
`spatial_navigation.debug.js`, `background.js`, `manifest.json`). These are
**build outputs** of the TypeScript source. The primary consumer,
[flutter-geckoview](https://github.com/dart-technologies/flutter-geckoview),
vendors this repo as a git submodule / asset and loads the `extension/` folder
directly via GeckoView's `ensureBuiltIn(...)` — it does **not** run a Node build
of this package.

## Decision

Commit the built `extension/` bundles to git, and enforce a CI **bundle-freshness
gate** (`git diff --exit-code -- extension/` after `npm run build:all`) so the
committed artifacts can never silently drift from source.

## Consequences

**Positive**

- Submodule/asset consumers get ready-to-load bundles with no build step.
- The freshness gate guarantees `extension/` always reflects the committed source.
- Bundles are reviewable in PRs (security-sensitive output is visible).

**Negative / trade-offs**

- Every change that alters bundle bytes must include a rebuild commit — including
  **build-tooling bumps** (rollup, terser, `@rollup/plugin-typescript`). A
  Dependabot PR that bumps a bundler will fail the freshness gate until someone
  runs `npm run build:all && git commit`. This is expected; treat it as part of
  merging any build-dep update.
- Larger diffs and occasional merge noise on the generated files.

## Alternatives considered

- **Build on install / publish only** — cleaner history, but breaks the
  submodule consumer that loads `extension/` directly without a Node toolchain.
- **`.gitattributes merge=ours` / generated-file markers** — reduces diff noise
  but weakens the reviewability and the freshness guarantee.

Revisit if the submodule consumer gains a build step, at which point bundles
could move to a release artifact instead.
