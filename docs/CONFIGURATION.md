# Configuration reference

All options are set via `window.spatialNavConfig` and validated against a schema —
malformed values are dropped with a warning rather than silently corrupting state.
The everyday options, their types, and defaults live in the
[README Configuration section](../README.md#configuration). This page is the deep
reference for the **safe-range clamping** and **per-field validation** the
validator applies.

## Safe-range clamping (3.0.1+, extended in 3.1.0)

Every numeric config value is clamped to a safe range at config read time.
Out-of-range values are corrected to the nearest bound. This stops a malicious
config from making the overlay invisible, off-screen, or paint-thread-prohibitive,
or from setting observer debounces / cache timeouts to hostile extremes.

### Visual styling

| Option                    | Min   | Max          | Default      |
| ------------------------- | ----- | ------------ | ------------ |
| `outlineWidth`            | `1`   | `20`         | `3`          |
| `outlineOffset`           | `0`   | `50`         | `3`          |
| `overlayZIndex`           | `1`   | `2147483646` | `2147483646` |
| `arrowScale`              | `0.1` | `4`          | `1.0`        |
| `safeAreaMargin`          | `0`   | `200`        | `12`         |
| `overlayScrimOpacity`     | `0`   | `1`          | `0.06`       |
| `overlayGlowOpacity`      | `0`   | `1`          | `0.35`       |
| `overlayGlowBlur`         | `0`   | `64`         | `14`         |
| `overlayInnerGlowOpacity` | `0`   | `1`          | `0.16`       |

### Observers and timers _(3.1+)_

| Option                   | Min | Max     | Default |
| ------------------------ | --- | ------- | ------- |
| `mutationDebounce`       | `0` | `5000`  | `100`   |
| `scrollThreshold`        | `0` | `1000`  | `8`     |
| `virtualScrollDebounce`  | `0` | `5000`  | `150`   |
| `precomputeCacheTimeout` | `0` | `60000` | `500`   |
| `intersectionThreshold`  | `0` | `1`     | `0`     |

### Scoring _(3.1+)_

| Option                   | Min | Max    | Default |
| ------------------------ | --- | ------ | ------- |
| `overlapThreshold`       | `0` | `4096` | `0`     |
| `gridAlignmentTolerance` | `0` | `4096` | `20`    |
| `minElementSize`         | `0` | `4096` | `1`     |

## Field validation

`color` and `disabledColor` are validated against an allowlist of CSS color
syntaxes (`#rgb`, `#rrggbb`, `rgb()`, `rgba()`, `hsl()`, `hsla()`, named colors)
by the same `parseColor()` validator. Strings that don't match the allowlist fall
back to the default — they cannot inject arbitrary CSS into the shadow-DOM `:host`
block.

`virtualContainerSelectors` is capped at **32 entries**; each entry is capped at
**256 characters**. Excess entries are dropped with a warning. This prevents DoS
via a config that supplies millions of selectors to `document.querySelectorAll`.

`iframeSupport` and `focusGroups` nested objects are field-validated _(3.1+)_:
unknown keys are dropped, `focusMethod`/`boundaryBehavior` enums are checked
against allowlists, and only plain objects (no Arrays, no `null` prototypes) are
accepted.
