# Architecture

How the extension is structured and how messages flow between the web page, the
content script, the background relay, and the native GeckoView host.

## Components

```
┌─────────────────────────── GeckoView WebView ───────────────────────────┐
│  Web page (untrusted)                                                    │
│    window.spatialNavConfig, data-focus-group attrs, WICG API calls       │
│                                                                          │
│  Content script  (spatial_navigation.js — bundled main.ts)              │
│    core/      scoring, geometry, overlay, focus groups, modality watcher │
│    navigation/ keydown handlers, movement, menu-toggle, click utils      │
│    utils/      DOM scan, intersection, logger, bridge, deprecation       │
│    messaging/  adapter + native-host probe-and-lock                      │
│                                                                          │
│  Background script  (background.js — bundled background.ts)             │
│    Relays content→native messages, gated by an outbound `type` allowlist │
└──────────────────────────────────────────────────────────────────────────┘
                                   │  native messaging
                                   ▼
                    Native host app (flutter_geckoview / react-native-geckoview)
```

The content script runs in an isolated world on every top-level page. The page
is **untrusted** — every value it can influence (config, `data-focus-group`,
message payloads, DOM size) is treated as a potential attack input.

## Message flow

There are **two distinct outbound paths** to native — this is the most important
thing to understand, and it isn't obvious from the code:

| Path        | Route                                                                                 | Carries                                 | Gated by                                                                    |
| ----------- | ------------------------------------------------------------------------------------- | --------------------------------------- | --------------------------------------------------------------------------- |
| **Relay**   | content → `runtime.sendMessage` → `background.ts` `onMessage` → `sendToNative`        | `simulateClick`, `focusExit`            | `OUTBOUND_MESSAGE_TYPES` allowlist + foreign-sender check (`background.ts`) |
| **Adapter** | content → `GeckoViewMessagingAdapter.send` → port `postMessage` / `sendNativeMessage` | `spatialNavInit`, `inputModalityChange` | native-app-id allowlist (probe-and-lock)                                    |

A message sent through the relay whose `type` is **not** in
`OUTBOUND_MESSAGE_TYPES` is dropped before reaching native — so any new
relay-bound message type must be added there (and ideally given an interface
extending `OutboundMessage`, which makes the omission a compile error).

**Inbound** (native → content) always arrives on the adapter's port, is
validated by `isInboundMessage` (must be an object with a string `type`), then
dispatched: `configUpdate`, `navigate`, `refresh`.

The live protocol is exactly:

- **Out:** `spatialNavInit`, `focusExit`, `inputModalityChange`, `simulateClick`
- **In:** `configUpdate`, `navigate`, `refresh`

## Native host selection

`messaging/native-app-ids.ts` is a **frozen, compile-time** allowlist
(`flutter_geckoview`, `react-native-geckoview`). `messaging/native-host.ts`
(`createNativeSender`) probes it in order on first use and **locks** onto the
first host that responds; later sends reuse the locked host. The allowlist is
never read from page input — preventing a hostile page from rerouting native
traffic (the `d23e1ab` invariant).

## Security model (trust boundaries)

- **Page → content config** — every numeric value is clamped to a safe range;
  `color`/`disabledColor` pass a CSS-color allowlist; selector arrays are length-
  capped; `focusGroups`/`iframeSupport` are field-validated. See
  [CONFIGURATION.md](CONFIGURATION.md).
- **Page-controlled DOM** — focus-group ids key a **null-prototype** map
  (`Object.create(null)`), and every page-scanning path in `utils/dom.ts` uses a
  budget-bounded lazy walker (`walkElementsBounded`) instead of
  `querySelectorAll`, so a hostile DOM can't force a full enumeration or an
  unbounded `getComputedStyle` loop.
- **Content → background relay** — outbound `type` allowlist + foreign-sender
  rejection; logs carry the message **type** only, never bodies.
- **Native → content port** — `isInboundMessage` shape check before dispatch.
- **Build-time gating** — the page-callable debug API and verbose logging are
  folded out of production bundles via `process.env.NODE_ENV` (see
  `utils/logger.ts`); auto-init is likewise gated on `NODE_ENV !== 'test'`.

## Build outputs

`rollup.config.js` emits each bundle from a **single-output build per target
directory** (so `@rollup/plugin-typescript`'s `outDir` matches each output):

- `dist/` — UMD / ESM / IIFE / debug / subpath (`core`, `messaging`) bundles for npm consumers.
- `extension/` — the loadable WebExtension (`spatial_navigation.js`, `…debug.js`, `background.js`, `manifest.json`).
- `e2e/fixtures/` — the IIFE bundle the Playwright suite loads, kept in lockstep with source.

The `extension/` bundles are **committed to git** (see
[adr/0001-commit-built-bundles.md](adr/0001-commit-built-bundles.md)) and a CI
gate (`git diff --exit-code -- extension/`) fails if they drift from source.
