# Contributing to Spatial Navigation for GeckoView

Thank you for your interest in contributing! This document provides guidelines for contributing to this project.

## Development Setup

```bash
# Clone the repository
git clone https://github.com/dart-technologies/spatial-navigation-geckoview.git
cd spatial-navigation-geckoview

# Install dependencies
npm install

# Build all outputs
npm run build:all

# Run tests
npm test
```

## Project Structure

```
├── core/           # Core navigation logic
│   ├── config.ts            # Config schema, validation, clamping, presets
│   ├── focus_group.ts       # Focus group hierarchies
│   ├── geometry.ts          # Rect/distance calculations + visual-rect logic
│   ├── modality_watcher.ts  # Pointer/touch detection → inputModalityChange
│   ├── overlay.ts           # Visual focus indicator (shadow DOM)
│   ├── preview.ts           # Direction preview chevrons
│   ├── scoring.ts           # Candidate scoring algorithm
│   └── state.ts             # Module-cached state (publish-only on window)
├── messaging/      # Native communication adapters
│   ├── adapter.ts           # Abstract interface
│   ├── geckoview.ts         # GeckoView WebExtension adapter
│   ├── noop.ts              # Standalone/testing adapter
│   ├── factory.ts           # Auto-detection factory
│   ├── native-app-ids.ts    # Frozen compile-time native-host allowlist
│   ├── native-host.ts       # Probe-and-lock native sender
│   └── types.ts             # Outbound message shapes + OUTBOUND_MESSAGE_TYPES
├── navigation/     # Movement and event handling
│   ├── handlers.ts          # Keyboard event handlers
│   └── movement.ts          # Focus movement, boundary scroll, exit logic
├── utils/          # Utilities
│   ├── css-properties.ts    # WICG CSS property reading
│   ├── debug.ts             # Debug API (debug-bundle only)
│   ├── deprecation.ts       # Legacy-global warning shims
│   ├── dom.ts               # DOM traversal
│   ├── events.ts            # Custom event dispatch
│   ├── focus-helpers.ts     # clearOverlaySuppression + recovery helpers
│   ├── intersection.ts      # IntersectionObserver
│   ├── logger.ts            # Tree-shakeable logging (build-time DEBUG gate)
│   └── observer.ts          # MutationObserver (refreshes on aria-hidden/hidden)
├── extension/      # Built GeckoView extension files
├── dist/           # Built distribution files
├── __tests__/      # Unit tests
└── e2e/            # Playwright visual tests + bundled fixture
```

## Scripts

| Command                   | Description                                      |
| ------------------------- | ------------------------------------------------ |
| `npm run build`           | Build all distribution formats                   |
| `npm run build:all`       | Build + sync manifest version                    |
| `npm run build:types`     | Generate TypeScript declarations                 |
| `npm test`                | Run unit tests                                   |
| `npm run test:watch`      | Run tests in watch mode                          |
| `npm run test:coverage`   | Run tests with c8 coverage (enforces thresholds) |
| `npm run test:benchmark`  | Run performance benchmarks                       |
| `npm run test:visual`     | Run Playwright visual tests                      |
| `npm run typecheck`       | tsc --noEmit (strict)                            |
| `npm run typecheck:tests` | tsc on **tests**/tsconfig.json                   |
| `npm run lint`            | Run ESLint                                       |
| `npm run lint:fix`        | Run ESLint with autofix                          |
| `npm run format`          | Apply Prettier                                   |
| `npm run format:check`    | Verify Prettier formatting (CI)                  |
| `npm run audit:check`     | npm audit on prod deps (--audit-level=high)      |
| `npm run size`            | Verify bundle size budgets                       |
| `npm run docs`            | Generate TypeDoc                                 |
| `npm run clean`           | Remove dist/ and coverage/                       |

## Code Style

- **TypeScript**: Full `strict: true` mode. All six strict flags (`noImplicitAny`, `strictNullChecks`, `strictFunctionTypes`, `strictBindCallApply`, `strictPropertyInitialization`, `noImplicitThis`) are enforced.
- **Formatting**: Prettier is enforced via Husky pre-commit hook (`lint-staged`) and a CI `format:check` step. Run `npm run format` to auto-fix.
- **Linting**: ESLint with `typescript-eslint` + `eslint-config-prettier`. `lint-staged` runs `eslint --fix --max-warnings=0` on every `*.ts` file in a commit.
- **Commit messages**: Conventional Commits enforced by `commitlint` (`@commitlint/config-conventional`) via a Husky `commit-msg` hook. See the PR Title Convention section below.
- **Naming**: camelCase for functions/variables, PascalCase for types/classes, SCREAMING_SNAKE for module-level constants.
- **Comments**: JSDoc on every exported symbol. Inline comments only where the _why_ is non-obvious (hidden invariants, workarounds, known browser bugs).

## Testing

### Unit Tests

Located in `__tests__/`. Run with:

```bash
npm test
```

Add tests for new features in the appropriate test file or create a new one following the pattern `*.test.ts`.

### Visual Tests

Playwright-based screenshot tests in `e2e/`. Run with:

```bash
npm run test:visual
```

Update baselines with:

```bash
npm run test:visual:update
```

### Benchmarks

Performance benchmarks in `perf/benchmark.test.ts`. Run with:

```bash
npm run test:benchmark
```

Target: <5ms navigation latency with 1000+ elements.

### Coverage

Coverage runs through `c8` on the unit test suite. CI enforces the thresholds
configured in `package.json` (`lines: 88`, `functions: 88`, `statements: 88`,
`branches: 80`). Run locally:

```bash
npm run test:coverage
```

HTML report writes to `coverage/`.

## Pull Request Process

1. **Fork** the repository and create a feature branch.
2. **Write tests** for new functionality. Test files go in `__tests__/` and follow `*.test.ts`.
3. **Run the local CI suite** to ensure nothing is broken:
   ```bash
   npm run format:check
   npm run lint
   npm run typecheck
   npm run typecheck:tests
   npm test
   npm run audit:check
   npm run build:all
   npm run size
   ```
4. **Update documentation** if adding user-visible features:
   - `CHANGELOG.md` — Keep-a-Changelog format under the next-version heading.
   - `README.md` — config table, features list, and migration paragraph.
   - `docs/MIGRATION.md` — only if behavior changed for existing users.
5. **Submit PR** using `.github/pull_request_template.md`. Include a clear description and link to any related issue.

For release engineering (cutting a version, tagging, publishing), see [`RELEASING.md`](RELEASING.md).

### PR Title Convention

Use conventional commit format:

- `feat: add new feature`
- `fix: resolve bug`
- `docs: update documentation`
- `refactor: improve code structure`
- `test: add tests`
- `chore: maintenance tasks`

## Reporting Issues

When reporting bugs, include:

- Browser/GeckoView version
- Host application (flutter-geckoview, react-native, etc.)
- Minimal reproduction steps
- Expected vs actual behavior
- Console logs if relevant

## Feature Requests

Feature requests are welcome! Please:

- Check existing issues first
- Describe the use case
- Explain how it benefits users
- Consider backwards compatibility

## Code of Conduct

- Be respectful and inclusive
- Focus on constructive feedback
- Help others learn and grow

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
