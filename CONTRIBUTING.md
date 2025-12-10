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
│   ├── config.ts       # Configuration management
│   ├── focus_group.ts  # Focus group hierarchies
│   ├── geometry.ts     # Rect/distance calculations
│   ├── overlay.ts      # Visual focus indicator
│   ├── preview.ts      # Direction preview arrows
│   ├── scoring.ts      # Candidate scoring algorithm
│   └── state.ts        # Global state management
├── messaging/      # Native communication adapters
│   ├── adapter.ts      # Abstract interface
│   ├── geckoview.ts    # GeckoView WebExtension
│   ├── noop.ts         # Standalone/testing
│   └── factory.ts      # Auto-detection factory
├── navigation/     # Movement and event handling
│   ├── handlers.ts     # Keyboard event handlers
│   └── movement.ts     # Focus movement logic
├── utils/          # Utilities
│   ├── css-properties.ts  # WICG CSS property reading
│   ├── debug.ts           # Debug API
│   ├── dom.ts             # DOM traversal
│   ├── events.ts          # Custom event dispatch
│   ├── intersection.ts    # IntersectionObserver
│   ├── logger.ts          # Tree-shakeable logging
│   └── observer.ts        # MutationObserver
├── extension/      # Built GeckoView extension files
├── dist/           # Built distribution files
├── __tests__/      # Unit tests
└── e2e/            # Playwright visual tests
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run build` | Build all distribution formats |
| `npm run build:all` | Build + copy to extension folder |
| `npm run build:types` | Generate TypeScript declarations |
| `npm test` | Run unit tests |
| `npm run test:watch` | Run tests in watch mode |
| `npm run test:benchmark` | Run performance benchmarks |
| `npm run test:visual` | Run Playwright visual tests |
| `npm run lint` | Type-check with TypeScript |
| `npm run clean` | Remove dist/ directory |

## Code Style

- **TypeScript**: Strict mode enabled (`noImplicitAny: true`)
- **Formatting**: No specific formatter enforced, maintain consistency with existing code
- **Naming**: camelCase for functions/variables, PascalCase for types/classes
- **Comments**: JSDoc for public APIs, inline comments for complex logic

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

Performance benchmarks in `__tests__/benchmark.test.ts`. Run with:

```bash
npm run test:benchmark
```

Target: <5ms navigation latency with 1000+ elements.

## Pull Request Process

1. **Fork** the repository and create a feature branch
2. **Write tests** for new functionality
3. **Run all tests** to ensure nothing is broken:
   ```bash
   npm test
   npm run lint
   npm run build:all
   ```
4. **Update documentation** if adding new features (README, CHANGELOG)
5. **Submit PR** with a clear description of changes

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
