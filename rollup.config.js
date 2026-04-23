import typescript from '@rollup/plugin-typescript';
import replace from '@rollup/plugin-replace';
import { minify } from 'terser';

/**
 * Rollup configuration for GeckoView Spatial Navigation.
 *
 * Produces multiple output formats:
 *   1. UMD bundle for general usage (dist/spatial-navigation.js)
 *   2. ES Module for modern bundlers (dist/spatial-navigation.esm.js)
 *   3. IIFE for GeckoView extension (dist/spatial-navigation.extension.js)
 *   4. Debug bundle with sourcemaps + console preserved (dist/spatial-navigation.debug.js)
 *   5. Background script (dist/background.js)
 *   6. Subpath bundles: dist/core.*, dist/messaging.*
 *
 * Production bundles:
 *   - Set process.env.NODE_ENV = "production" so logger.ts's DEBUG constant folds to false.
 *   - Drop console.log / console.info / console.debug at minification (warn/error preserved).
 *
 * Debug bundle:
 *   - NODE_ENV = "development" so all debug logs remain.
 *   - Not minified; sourcemaps emitted.
 */

const makeTypescriptPlugin = () =>
    typescript({
        tsconfig: './tsconfig.json',
        declaration: false,
        declarationDir: undefined,
        noEmit: false,
        compilerOptions: {
            noEmit: false,
            declaration: false,
        },
    });

const makeReplacePlugin = (isProduction) =>
    replace({
        preventAssignment: true,
        values: {
            'process.env.NODE_ENV': JSON.stringify(isProduction ? 'production' : 'development'),
        },
    });

const terserPlugin = (reserved = []) => ({
    name: 'terser-inline',
    async renderChunk(code, chunk, outputOptions) {
        const sourceMap = outputOptions.sourcemap === true || typeof outputOptions.sourcemap === 'string';

        const result = await minify(code, {
            ecma: 2020,
            sourceMap,
            module: outputOptions.format === 'es',
            toplevel: outputOptions.format === 'cjs',
            compress: {
                passes: 2,
                // Drop low-severity logging in production; keep warn/error so real problems
                // still surface in the host app's console.
                drop_console: ['log', 'info', 'debug', 'trace'],
                pure_funcs: ['console.log', 'console.info', 'console.debug', 'console.trace'],
            },
            mangle: {
                reserved: [
                    'window',
                    'document',
                    'browser',
                    'spatialNavState',
                    'spatialNavConfig',
                    'flutterFocusState',
                    'flutterSpatialNavConfig',
                    'flutterShowOverlay',
                    'navigate',
                    'spatialNavigationSearch',
                    'focusableAreas',
                    'getSpatialNavigationContainer',
                    ...reserved,
                ],
            },
            format: {
                comments: false,
            },
        });

        if (!result.code) {
            return null;
        }

        if (sourceMap && result.map) {
            const map = typeof result.map === 'string' ? JSON.parse(result.map) : result.map;
            return { code: result.code, map };
        }

        return result.code;
    },
});

const productionPlugins = () => [makeReplacePlugin(true), makeTypescriptPlugin(), terserPlugin()];

const debugPlugins = () => [makeReplacePlugin(false), makeTypescriptPlugin()];

export default [
    // UMD bundle
    {
        input: 'main.ts',
        output: {
            file: 'dist/spatial-navigation.js',
            format: 'umd',
            name: 'SpatialNavigation',
            exports: 'named',
            strict: true,
        },
        plugins: productionPlugins(),
    },

    // ES Module bundle
    {
        input: 'main.ts',
        output: {
            file: 'dist/spatial-navigation.esm.js',
            format: 'es',
            exports: 'named',
        },
        plugins: productionPlugins(),
    },

    // GeckoView extension IIFE bundle — emitted to BOTH dist/ and extension/
    // so consumers loading the extension folder directly get a fresh build.
    {
        input: 'main.ts',
        output: [
            {
                file: 'dist/spatial-navigation.extension.js',
                format: 'iife',
                name: 'SpatialNavigation',
                strict: true,
            },
            {
                file: 'extension/spatial_navigation.js',
                format: 'iife',
                name: 'SpatialNavigation',
                strict: true,
            },
        ],
        plugins: productionPlugins(),
    },

    // Debug bundle (unminified, sourcemaps, console preserved) — also dual-emitted.
    {
        input: 'main.ts',
        output: [
            {
                file: 'dist/spatial-navigation.debug.js',
                format: 'iife',
                name: 'SpatialNavigation',
                strict: true,
                sourcemap: true,
            },
            {
                file: 'extension/spatial_navigation.debug.js',
                format: 'iife',
                name: 'SpatialNavigation',
                strict: true,
                sourcemap: true,
            },
        ],
        plugins: debugPlugins(),
    },

    // Background script — dual-emitted for the same reason.
    {
        input: 'background.ts',
        output: [
            {
                file: 'dist/background.js',
                format: 'iife',
                name: 'SpatialNavBackground',
                strict: true,
            },
            {
                file: 'extension/background.js',
                format: 'iife',
                name: 'SpatialNavBackground',
                strict: true,
            },
        ],
        plugins: productionPlugins(),
    },

    // Subpath: core-only bundle (UMD + ESM)
    {
        input: 'src/core-entry.ts',
        output: [
            {
                file: 'dist/core.js',
                format: 'umd',
                name: 'SpatialNavigationCore',
                exports: 'named',
                strict: true,
            },
            {
                file: 'dist/core.esm.js',
                format: 'es',
                exports: 'named',
            },
        ],
        plugins: productionPlugins(),
    },

    // Subpath: messaging-only bundle (UMD + ESM)
    {
        input: 'src/messaging-entry.ts',
        output: [
            {
                file: 'dist/messaging.js',
                format: 'umd',
                name: 'SpatialNavigationMessaging',
                exports: 'named',
                strict: true,
            },
            {
                file: 'dist/messaging.esm.js',
                format: 'es',
                exports: 'named',
            },
        ],
        plugins: productionPlugins(),
    },
];
