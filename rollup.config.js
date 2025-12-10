import typescript from '@rollup/plugin-typescript';
import { minify } from 'terser';

/**
 * Rollup configuration for GeckoView Spatial Navigation v3.0.0
 *
 * Now supports TypeScript source files (.ts).
 * Produces multiple output formats:
 * 1. UMD bundle for general usage (dist/spatial-navigation.js)
 * 2. ES Module for modern bundlers (dist/spatial-navigation.esm.js)
 * 3. IIFE for GeckoView extension (dist/spatial-navigation.extension.js)
 * 4. Debug bundle with sourcemaps (dist/spatial-navigation.debug.js)
 */

const makeTypescriptPlugin = () => typescript({
    tsconfig: './tsconfig.json',
    declaration: false,
    declarationDir: undefined,
    noEmit: false,
    compilerOptions: {
        noEmit: false,
        declaration: false,
    }
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
                drop_console: false
            },
            mangle: {
                reserved: [
                    'window', 'document', 'browser',
                    'spatialNavState', 'spatialNavConfig',
                    'flutterFocusState', 'flutterSpatialNavConfig', 'flutterShowOverlay',
                    'navigate', 'spatialNavigationSearch', 'focusableAreas', 'getSpatialNavigationContainer',
                    ...reserved
                ]
            },
            format: {
                comments: false
            }
        });

        if (!result.code) {
            return null;
        }

        if (sourceMap && result.map) {
            const map = typeof result.map === 'string' ? JSON.parse(result.map) : result.map;
            return { code: result.code, map };
        }

        return result.code;
    }
});

export default [
    // UMD bundle
    {
        input: 'main.ts',
        output: {
            file: 'dist/spatial-navigation.js',
            format: 'umd',
            name: 'SpatialNavigation',
            exports: 'named',
            strict: true
        },
        plugins: [
            makeTypescriptPlugin(),
            terserPlugin()
        ]
    },

    // ES Module bundle
    {
        input: 'main.ts',
        output: {
            file: 'dist/spatial-navigation.esm.js',
            format: 'es',
            exports: 'named'
        },
        plugins: [
            makeTypescriptPlugin(),
            terserPlugin()
        ]
    },

    // GeckoView extension IIFE bundle
    {
        input: 'main.ts',
        output: {
            file: 'dist/spatial-navigation.extension.js',
            format: 'iife',
            name: 'SpatialNavigation',
            strict: true
        },
        plugins: [
            makeTypescriptPlugin(),
            terserPlugin()
        ]
    },

    // Debug bundle (unminified, with sourcemaps)
    {
        input: 'main.ts',
        output: {
            file: 'dist/spatial-navigation.debug.js',
            format: 'iife',
            name: 'SpatialNavigation',
            strict: true,
            sourcemap: true
        },
        plugins: [
            makeTypescriptPlugin()
        ]
    },

    // Background Script bundle
    {
        input: 'background.ts',
        output: {
            file: 'dist/background.js',
            format: 'iife',
            name: 'SpatialNavBackground',
            strict: true
        },
        plugins: [
            makeTypescriptPlugin(),
            terserPlugin()
        ]
    }
];
