# Scoring Algorithm

This document explains how the spatial navigation engine picks the next focus
target for an arrow-key / D-pad press. It targets contributors and integrators
who want to tune the behavior or extend it. The hot path lives in
[core/scoring.ts](../core/scoring.ts) and the named constants in
[core/config.ts](../core/config.ts) (search for `SCORING_CONSTANTS`).

## High-level shape

A keypress produces a `Direction` (`{axis: 'x'|'y', sign: 1|-1, name}`).
[`findDirectionalCandidate()`](../core/scoring.ts) runs **three passes** with
progressively relaxed constraints:

| Pass | strictEdges | allowOverlap | requireViewport | viewportMargin | alignmentWeight | distanceWeight | preferScrollGroup |
| ---- | ----------- | ------------ | --------------- | -------------- | --------------- | -------------- | ----------------- |
| 1    | true        | false        | true            | 0              | 10              | 1              | true              |
| 2    | false       | true         | true            | 160            | 8               | 0.9            | true              |
| 3    | false       | true         | false           | 0              | 6               | 0.7            | false             |

The first pass that returns a candidate wins. If all three return null and
`wrapNavigation` is on, [`findWrapCandidate()`](../core/scoring.ts) picks the
opposite-edge element instead.

Each pass is implemented by `chooseBestCandidate()`, which:

1. Iterates every focusable other than the current one.
2. Drops candidates that fail `computeDirectionalMetrics()` (wrong direction,
   off-axis cone, edge containment).
3. Scores survivors using a linear combination of primary distance, secondary
   (off-axis) distance, raw distance, and a series of bonuses/penalties.
4. Sorts by score (lowest wins), then by distance as a tiebreak.

## Score formula

```
score = primary * PRIMARY_WEIGHT
      + secondary * alignmentWeight
      + distance * distanceWeight
      − GRID_BONUS                  (if grid mode and gridAligned)
      − SAME_GROUP_BONUS            (if same focus group as current)
      − GROUP_ENTER_LAST_BONUS      (if entering a group via lastFocused, enterMode='last')
      − SAME_SCROLL_BONUS           (if same scroll container)
      + DIFFERENT_SCROLL_PENALTY    (if different scroll container)
      + OFFSCREEN_PENALTY           (if not in viewport)
```

Lower scores win. The signs of the bonuses are intentional — bonuses subtract
because we want to favor those candidates over alternatives.

## Why this hierarchy

The constants in `SCORING_CONSTANTS` are calibrated to enforce a strict
priority ordering. Reading from highest to lowest:

| Constant                   | Value | What it expresses                                                                                  |
| -------------------------- | ----- | -------------------------------------------------------------------------------------------------- |
| `PRIMARY_WEIGHT`           | 1000  | Primary-axis distance dominates. Closer-on-axis always beats farther-on-axis.                      |
| `SAME_GROUP_BONUS`         | 2000  | "Stay in the same focus group" outranks every other consideration.                                 |
| `GROUP_ENTER_LAST_BONUS`   | 1000  | When entering a group with `enterMode=last`, prefer the remembered element.                        |
| `GRID_BONUS`               | 500   | In grid mode, prefer same row/column.                                                              |
| `SAME_SCROLL_BONUS`        | 150   | Prefer same scroll container — feels less jarring.                                                 |
| `OFFSCREEN_PENALTY`        | 120   | Soft-reject off-screen candidates without excluding them entirely (matters for virtualized lists). |
| `DIFFERENT_SCROLL_PENALTY` | 75    | Penalize cross-container moves.                                                                    |

The "stay in the same group" bonus (2000) is intentionally larger than every
other tunable factor combined for a typical keypress, because the user has
told us that the group is a logical region (sidebar, modal, list) and
spuriously jumping out of it is the worst-feeling failure mode.

## Cone and edge guards

Before scoring, two geometric guards run in `computeDirectionalMetrics()`:

- **Strict edge containment** (pass 1 only): the candidate's leading edge
  must be past the current element's trailing edge by at least
  `EDGE_EPS_BASE + overlapThreshold` pixels. This prevents picking
  almost-overlapping elements as the "next" target.
- **Cone check** (every pass): the off-axis spread (`secondary`) must be
  ≤ `max(CONE_TOLERANCE_BASE_PX, primary * CONE_TOLERANCE_RATIO)`.
  In other words, candidates farther forward have a wider cone — a candidate
  100px ahead can be up to 300px off-axis (3× ratio), but a candidate 10px
  ahead is bounded to 4px off-axis (the floor).

## Distance functions

`calculateDistance()` supports three modes (selectable via `config.distanceFunction`):

- `euclidean` (default): `sqrt(dx² + dy²)` — standard Pythagorean.
- `manhattan`: `|dx| + |dy|` — cheaper, slightly biased toward axis-aligned moves.
- `projected`: `primary + secondary * PROJECTED_SECONDARY_WEIGHT` — WICG-style;
  weights the navigation axis heavily so aligned candidates always win.

## Tuning

If you change a constant, run `npm test` — `__tests__/scoring.test.ts`
exercises the boundaries. Most tuning failures show up as either:

- Navigation feeling "sticky" (group bonus too high) or "leaky" (too low).
- Diagonal candidates winning over straight-ahead (cone tolerance too generous).
- Off-screen items being picked aggressively (OFFSCREEN_PENALTY too small
  relative to PRIMARY_WEIGHT).

When in doubt, prefer a real fix in `computeDirectionalMetrics()` over
hand-tuning weights — the scoring layer should reflect the geometry, not
paper over it.
