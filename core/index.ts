/**
 * Core algorithms — public re-exports for the `/core` subpath bundle.
 *
 * Use this when you only need scoring/geometry/state/config without the
 * full content-script orchestration in main.ts.
 *
 * Note: `FocusGroup` is re-exported from `focus_group` (the canonical class).
 * `state` re-exports the same name as a type alias — explicit re-exports
 * below disambiguate.
 */

export * from './config';
export * from './geometry';
export * from './scoring';
export * from './focus_group'; // FocusGroup class
export * from './overlay';
export * from './preview';

// Re-export from state, omitting the `FocusGroup` alias (provided by focus_group above).
export {
    getState,
    type FocusableEntry,
    type PreviewElement,
    type PreviewElements,
    type Instrumentation,
    type RuntimeContext,
    type FrameworkAdapter,
    type SpatialNavState,
} from './state';
