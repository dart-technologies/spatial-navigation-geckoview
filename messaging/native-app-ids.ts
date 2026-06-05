/**
 * Native-messaging app identifiers — the COMPLETE, hard-coded allowlist of
 * GeckoView host applications this extension will exchange native messages
 * with.
 *
 * SECURITY: this set is frozen and compile-time only. It MUST NOT be derived
 * from any page-visible surface. A page-writable `window.spatialNavConfig
 * .nativeAppId` previously let hostile web content reroute all outbound native
 * traffic to an attacker-registered host (fixed in commit d23e1ab); keeping the
 * allowlist in one frozen constant preserves that invariant while still letting
 * the extension run under more than one host. To add support for a new host,
 * append its registered native-messaging app id here and rebuild — nothing at
 * runtime can extend this set.
 *
 * Order matters: it is the probe order used by the background relay and the
 * content-script fallback. The first host that answers is locked in for the
 * remainder of the session (only one host is registered on any given device,
 * so the others reject without delivering the message).
 */
export const NATIVE_APP_IDS = Object.freeze(['flutter_geckoview', 'react-native-geckoview'] as const);

/** A native-messaging app id known to this extension. */
export type NativeAppId = (typeof NATIVE_APP_IDS)[number];
