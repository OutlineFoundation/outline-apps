# Android E2E (Layer 4 — native seams)

Maestro flows that exercise what only a real Android OS can: the `ss://`
deep-link intent, the real `VpnService` tunnel, the OS VPN-consent dialog, and
disconnect. UI behavior is owned by the shared-UI Playwright suite
([client/e2e](../)); these flows deliberately stay off that turf.

They run nightly in CI on an emulator
([nightly_android_e2e.yml](../../../.github/workflows/nightly_android_e2e.yml))
against the hermetic Shadowsocks server in
[client/go/e2etest/cmd/ss-server](../../go/e2etest/cmd/ss-server), which the
emulator reaches on the host's loopback via `10.0.2.2`. `Net.Web` is asserted
server-side: the client's connectivity probes only show up in the ss-server
log if the tunnel is actually up.

## Spike findings (2026-07) — why Maestro, and the sharp edges

The driver decision (Maestro vs. Appium hybrid) hinged on whether the Cordova
webview's Polymer/Lit content is visible through the accessibility tree.
Verified on emulators (API 35 default and API 36.1 Play images):

- **Webview button text IS in the a11y tree** — `Connect`, `Disconnect`,
  `Confirm`, `Got It`, server names and addresses are all visible and tappable
  by text. No accessibility labels needed for these flows (adding them is
  still a worthwhile product improvement).
- **CSS `text-transform` propagates to the a11y tree** (`CONNECT`), so flows
  match case-insensitively: `"(?i)^connect$"`.
- **Text is localized** — CI emulators default to `en-US`; pin the locale if
  that ever changes.
- **The `server-connection-indicator` is invisible to a11y** (pure SVG, no
  text). Connection state is asserted via the button label flip plus
  server-side traffic, which is stronger anyway.
- **Two one-time dialogs need optional taps**: the first-run privacy notice
  and the first-connect "Stay protected, always" tip (both webview, both
  "Got It").
- **The VPN consent dialog is a plain system alert** with an `OK` button;
  Maestro taps it fine. Consent persists per-app until the app is
  *uninstalled* (`pm clear` does not revoke it), so a true first-connect test
  needs a fresh install.

## Running locally

```sh
# 1. Hermetic Shadowsocks target (leave running)
cd client/go/e2etest && go run ./cmd/ss-server -port 18388 -secret e2e-test-secret

# 2. Build + install the debug client on a running emulator
npm run action client/src/cordova/build android
adb install -r client/platforms/android/app/build/outputs/apk/debug/app-debug.apk

# 3. Run the flows (Maestro: https://maestro.mobile.dev)
SS_URL="ss://$(printf 'chacha20-ietf-poly1305:e2e-test-secret' | base64 | tr -d '=' | tr '+/' '-_')@10.0.2.2:18388/#E2E"
maestro test -e SS_URL="$SS_URL" client/e2e/android/flows/
```

For a full first-run (privacy notice + consent dialog), uninstall first:
`adb uninstall org.outline.android.client`.

## Open items

- Validate the workflow on CI runners (spike ran on a local arm64 emulator;
  CI uses x86_64 with KVM — expected to work, unproven).
- `Vpn.AutoReconnect` flow (`adb shell svc wifi disable/enable`) — assess
  emulator reliability before adding.
- The Linux Electron real-tunnel branch (`qa-automation-electron-tunnel`) has
  its own ss-server cmd staged; unify the two when it lands.
