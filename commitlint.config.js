/**
 * commitlint config — enforces Conventional Commits.
 *
 * Format: `<type>(<scope>): <subject>`
 * Types: feat, fix, docs, refactor, test, chore, perf, ci, build, revert
 */
export default {
    extends: ['@commitlint/config-conventional'],
    rules: {
        'header-max-length': [2, 'always', 100],
        'subject-case': [2, 'never', ['start-case', 'pascal-case', 'upper-case']],
    },
};
