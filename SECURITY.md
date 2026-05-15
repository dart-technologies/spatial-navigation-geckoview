# Security Policy

## Supported versions

Security fixes are backported only to the latest minor release in each major version line.

| Version | Supported | Notes                                                                                                     |
| ------- | --------- | --------------------------------------------------------------------------------------------------------- |
| 3.0.x   | ✅        | Active. 3.0.1 ships eight hardening fixes (see [CHANGELOG](CHANGELOG.md#301--2026-05-15)).                |
| 3.0.0   | ⚠️        | Superseded. Upgrade to 3.0.1 — 3.0.0 has CSS injection, DoS, and info-disclosure surfaces fixed in 3.0.1. |
| < 3.0   | ❌        | Internal pre-public builds embedded in flutter-geckoview. Not supported standalone.                       |

## Reporting a vulnerability

Please report security issues **privately** so a fix can be prepared before public disclosure.

### Preferred: GitHub Security Advisories

Open a private advisory at:
<https://github.com/dart-technologies/spatial-navigation-geckoview/security/advisories/new>

GitHub will notify the maintainers privately, and we can collaborate on a fix and a CVE assignment from the same thread.

### Alternative: email

If you cannot use GitHub Security Advisories, email **security@dart-technologies.com** with:

- A description of the vulnerability and its impact
- A minimal reproduction (extension build + a victim page if applicable)
- The affected version range (e.g., "3.0.0, 3.0.1 not tested")
- Whether you intend to publish a CVE / blog post and on what timeline

### What to expect

- **Acknowledgement** within **3 business days**.
- **Triage + severity assessment** within **7 business days** (CVSS 3.1 if applicable).
- **Patch release** for high/critical issues within **30 days** of triage.
- **Public disclosure** coordinated with the reporter — typically 90 days after the fix is available or sooner if the issue is already public.
- **Credit** in the release notes if you want it (anonymous reports are also fine).

## In scope

The extension ships as both an npm package (`@dart-technologies/spatial-navigation-geckoview`) and a loadable WebExtension under `extension/`. Both are in scope for:

- **Content-script trust boundary violations** — anything that lets a page hijack the extension's privileged context, native-messaging pipe, or background script.
- **Shadow-DOM / overlay injection** — CSS, HTML, or script injection through config values, message payloads, or overlay rendering paths.
- **Prototype pollution** in the spatial-navigation hot path (config validation, scoring, geometry, observers).
- **DoS** triggered by malicious config or message payloads (extreme numeric values, oversized arrays, deeply nested objects).
- **Information disclosure** via debug logs, native messages, or `web_accessible_resources` that should not be reachable from a page context.
- **Native messaging exfiltration** — anything that lets a page reroute messages to an attacker-controlled host.

## Out of scope

- Vulnerabilities in GeckoView, Firefox, or the WebExtension runtime itself — please report those directly to [Mozilla](https://www.mozilla.org/en-US/security/).
- Bugs that require physically modifying the user's device or the installed extension package.
- Social-engineering scenarios where the user is tricked into installing a malicious build of this extension.
- Performance issues that don't constitute a denial-of-service (page jank, slow scrolling, etc.).
- Vulnerabilities in `flutter-geckoview` host apps that don't originate in this extension — report those to the [flutter-geckoview](https://github.com/dart-technologies/flutter-geckoview/security) advisory channel.

## Hardening surface

v3.0.1 explicitly hardened these surfaces. New reports against these areas are very welcome — we may have missed cases.

- **Config validation** (`core/config.ts`) — type checking, enum allowlists, numeric clamping, array length caps, color-string allowlist.
- **Native messaging** (`messaging/`) — pinned native app id, frozen direction lookup tables, message-shape validation.
- **Overlay rendering** (`core/overlay.ts`) — color values pass through `parseColor()` before reaching the shadow-DOM stylesheet.
- **State isolation** (`core/state.ts`) — module-cache-only reads; `window.spatialNavState` is publish-only.
- **Build-time gating** (`utils/logger.ts`, `rollup.config.js`) — `DEBUG` and `SPATIAL_NAV_DEBUG` are tree-shaken from production bundles; debug bundle is not in `web_accessible_resources`.

## Acknowledgements

We thank everyone who has reported security issues responsibly. Reporters who wish to be credited will be listed in the release notes for the patch that addresses their report.
