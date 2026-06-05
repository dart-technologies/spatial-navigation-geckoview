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

// One TS plugin instance per output directory. @rollup/plugin-typescript v12
// requires the compiler `outDir` to live inside the Rollup output's directory,
// so each build that targets a non-dist/ folder (extension/, e2e/fixtures/) gets
// its own plugin with a matching `outDir`. `outputToFilesystem: false` keeps the
// plugin from writing transpiled files into those folders — Rollup emits the
// bundle. Both are harmless on v11.
const makeTypescriptPlugin = (outDir = 'dist') =>
    typescript({
        tsconfig: './tsconfig.json',
        declaration: false,
        declarationDir: undefined,
        noEmit: false,
        outputToFilesystem: false,
        compilerOptions: {
            noEmit: false,
            declaration: false,
            outDir,
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

const productionPlugins = (outDir = 'dist') => [
    makeReplacePlugin(true),
    makeTypescriptPlugin(outDir),
    terserPlugin(),
];

const debugPlugins = (outDir = 'dist') => [makeReplacePlugin(false), makeTypescriptPlugin(outDir)];

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

    // GeckoView extension IIFE bundle — emitted to dist/, extension/, and the
    // Playwright e2e fixtures folder so consumers loading the extension folder
    // directly, and the e2e suite, all run the same freshly-built code. Split
    // into one single-output build per target directory (rather than a single
    // multi-output build) so each gets a TS plugin whose `outDir` matches its
    // folder. Output bytes are identical to the old multi-output emit.
    {
        input: 'main.ts',
        output: {
            file: 'dist/spatial-navigation.extension.js',
            format: 'iife',
            name: 'SpatialNavigation',
            strict: true,
        },
        plugins: productionPlugins('dist'),
    },
    {
        input: 'main.ts',
        output: {
            file: 'extension/spatial_navigation.js',
            format: 'iife',
            name: 'SpatialNavigation',
            strict: true,
        },
        plugins: productionPlugins('extension'),
    },
    {
        input: 'main.ts',
        output: {
            file: 'e2e/fixtures/spatial-navigation.js',
            format: 'iife',
            name: 'SpatialNavigation',
            strict: true,
        },
        plugins: productionPlugins('e2e/fixtures'),
    },

    // Debug bundle (unminified, sourcemaps, console preserved) — dual-emitted to
    // dist/ and extension/ as separate single-output builds (see above), so each
    // sourcemap is generated natively with the correct output file name.
    {
        input: 'main.ts',
        output: {
            file: 'dist/spatial-navigation.debug.js',
            format: 'iife',
            name: 'SpatialNavigation',
            strict: true,
            sourcemap: true,
        },
        plugins: debugPlugins('dist'),
    },
    {
        input: 'main.ts',
        output: {
            file: 'extension/spatial_navigation.debug.js',
            format: 'iife',
            name: 'SpatialNavigation',
            strict: true,
            sourcemap: true,
        },
        plugins: debugPlugins('extension'),
    },

    // Background script — dual-emitted to dist/ and extension/ as separate builds.
    {
        input: 'background.ts',
        output: {
            file: 'dist/background.js',
            format: 'iife',
            name: 'SpatialNavBackground',
            strict: true,
        },
        plugins: productionPlugins('dist'),
    },
    {
        input: 'background.ts',
        output: {
            file: 'extension/background.js',
            format: 'iife',
            name: 'SpatialNavBackground',
            strict: true,
        },
        plugins: productionPlugins('extension'),
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
