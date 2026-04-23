<!--
Thanks for contributing!

PR title must follow Conventional Commits:
  feat(scope): description    — new feature
  fix(scope): description     — bug fix
  docs(scope): description    — docs only
  refactor(scope): description
  test(scope): description
  chore(scope): description
  perf(scope): description
  ci(scope): description
  build(scope): description

The pre-commit hook runs lint + format. The PR also enforces tests + types + bundle size.
-->

## Summary

<!-- One paragraph: what changed and why. Link issues with `Fixes #N` / `Closes #N`. -->

## Type of change

- [ ] Bug fix (non-breaking)
- [ ] New feature (non-breaking)
- [ ] Breaking change (requires major version bump)
- [ ] Docs only
- [ ] Refactor / internal cleanup
- [ ] Performance improvement
- [ ] CI / build / tooling

## Testing

<!-- How did you verify this works? Include the *what* you tested, not just "ran the tests". -->

- [ ] `npm test` passes
- [ ] `npm run lint` passes (eslint + prettier)
- [ ] `npm run typecheck` passes (strict mode)
- [ ] `npm run build:all` succeeds
- [ ] If UI/visual change: ran `npm run test:visual` and updated snapshots if needed

## Bundle size impact

<!-- If your change touches `core/`, `navigation/`, `utils/`, `main.ts`, or `messaging/`, paste the size diff. -->

## Risks / rollout notes

<!-- Anything reviewers should be cautious about: breaking host integrations, performance regressions, race conditions. -->
