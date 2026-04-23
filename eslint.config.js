// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
    eslint.configs.recommended,
    ...tseslint.configs.recommended,
    prettier,
    {
        ignores: [
            'dist/**',
            'extension/spatial_navigation.js',
            'extension/spatial_navigation.debug.js',
            'extension/background.js',
            'e2e/fixtures/spatial-navigation.js',
            'node_modules/**',
            'playwright-report/**',
            'coverage/**',
            'e2e/visual.spec.ts-snapshots/**',
            '*.config.js',
            'scripts/**',
            '.husky/**',
        ],
    },
    {
        files: ['**/*.ts'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            globals: {
                window: 'readonly',
                document: 'readonly',
                console: 'readonly',
                browser: 'readonly',
                chrome: 'readonly',
            },
        },
        rules: {
            // Hygiene: bare console.* is banned in source — use the logger.
            // Allowed in tests, scripts, and the logger itself (configured below).
            'no-console': ['error', { allow: ['warn', 'error'] }],
            '@typescript-eslint/no-explicit-any': 'warn',
            '@typescript-eslint/no-unused-vars': [
                'error',
                {
                    argsIgnorePattern: '^_',
                    varsIgnorePattern: '^_',
                    caughtErrorsIgnorePattern: '^_',
                },
            ],
            '@typescript-eslint/consistent-type-imports': [
                'warn',
                { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
            ],
            eqeqeq: ['error', 'smart'],
            'no-var': 'error',
            'prefer-const': 'warn',
        },
    },
    {
        // Logger module IS allowed to call console.* directly.
        files: ['utils/logger.ts'],
        rules: {
            'no-console': 'off',
        },
    },
    {
        // Tests + benchmarks can use any patterns + console.
        files: ['__tests__/**/*.ts', 'e2e/**/*.ts', 'perf/**/*.ts'],
        rules: {
            'no-console': 'off',
            '@typescript-eslint/no-explicit-any': 'off',
            '@typescript-eslint/no-unused-vars': 'off',
            '@typescript-eslint/consistent-type-imports': 'off',
        },
    }
);
