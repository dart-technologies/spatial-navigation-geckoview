# Config Presets

Built-in configuration profiles for common form factors. Apply one before
the extension initializes; user-set values still win over preset defaults.

## Quick start

```html
<script>
  // Set BEFORE the extension's content script runs.
  // (For host apps, this means before `addContentScript()` in your GeckoView code.)
  spatialNavigation.applyPreset('tv');
</script>
```

Or from JS module land:

```js
import { applyPreset } from '@dart-technologies/spatial-navigation-geckoview/core';

applyPreset('tv');
applyPreset('tv', { color: '#ff0000' }); // Preset + custom override
```

## Available presets

### `tv`

For Android TV / set-top-box D-pad navigation.

| Setting                    | Value    | Why                                                  |
| -------------------------- | -------- | ---------------------------------------------------- |
| `scoringMode`              | `'grid'` | Most TV UIs are grid-aligned (cards, tiles).         |
| `gridAlignmentTolerance`   | `40`     | Generous — TV designs aren't pixel-precise.          |
| `overlapThreshold`         | `8`      | Nearby tiles often share edges.                      |
| `outlineWidth`             | `4`      | Visible from across the room.                        |
| `outlineOffset`            | `4`      |                                                      |
| `arrowScale`               | `1.25`   | Larger directional preview.                          |
| `safeAreaMargin`           | `24`     | Account for TV overscan.                             |
| `observeVirtualContainers` | `true`   | YouTube / streaming apps use virtual scroll heavily. |
| `focusTrapDetection`       | `true`   | Modal player overlays are common.                    |

ARIA announcements stay off because TV remotes don't drive screen readers.

### `phone`

Touch-first phone with optional D-pad mode (e.g., AAOS gear-shift navigation).

| Setting                  | Value         | Why                                  |
| ------------------------ | ------------- | ------------------------------------ |
| `scoringMode`            | `'geometric'` | Phone layouts vary more than TV.     |
| `gridAlignmentTolerance` | `12`          | Tighter — phone designs are precise. |
| `overlapThreshold`       | `0`           | Touch targets shouldn't overlap.     |
| `outlineWidth`           | `2`           | Subtle on small screens.             |
| `outlineOffset`          | `2`           |                                      |
| `arrowScale`             | `0.85`        | Smaller directional preview.         |
| `safeAreaMargin`         | `8`           |                                      |

### `tablet`

Mid-density tablet — balanced settings.

| Setting                  | Value         |
| ------------------------ | ------------- |
| `scoringMode`            | `'geometric'` |
| `gridAlignmentTolerance` | `24`          |
| `overlapThreshold`       | `4`           |
| `outlineWidth`           | `3`           |
| `outlineOffset`          | `3`           |
| `arrowScale`             | `1.0`         |
| `safeAreaMargin`         | `16`          |

### `kiosk`

Locked-down kiosk: focus wraps at boundaries, ARIA on for accessibility,
no exit events to native UI.

| Setting                  | Value    | Why                                        |
| ------------------------ | -------- | ------------------------------------------ |
| `scoringMode`            | `'grid'` | Kiosks are usually grid-style.             |
| `gridAlignmentTolerance` | `32`     |                                            |
| `wrapNavigation`         | `true`   | User can't escape — wrap to opposite edge. |
| `enableAria`             | `true`   | Compliance.                                |
| `announceNavigation`     | `true`   | Compliance.                                |
| `announceBoundaries`     | `true`   | Compliance.                                |
| `outlineWidth`           | `4`      |                                            |
| `outlineOffset`          | `4`      |                                            |
| `arrowScale`             | `1.15`   |                                            |
| `safeAreaMargin`         | `20`     |                                            |

## Custom presets

Presets are just `PartialSpatialNavConfig` objects. Build your own:

```ts
import {
  applyPreset,
  type PartialSpatialNavConfig,
  updateConfig,
} from '@dart-technologies/spatial-navigation-geckoview/core';

const myPreset: PartialSpatialNavConfig = {
  scoringMode: 'grid',
  gridAlignmentTolerance: 16,
  color: '#0066cc',
  enableAria: true,
};

updateConfig(myPreset);
```

Or extend a built-in:

```ts
import { CONFIG_PRESETS, updateConfig } from '@dart-technologies/spatial-navigation-geckoview/core';

updateConfig({ ...CONFIG_PRESETS.tv, color: '#ff6600' });
```

## Precedence

When `applyPreset(name, overrides)` runs:

1. **Preset values** are applied as the base.
2. **Existing user values** in `window.spatialNavConfig` win over the preset
   (so users keep their explicit choices).
3. **`overrides`** parameter wins over both.

This means presets are safe to call after a user has already set some config —
you won't clobber their customizations.
