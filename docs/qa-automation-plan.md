# Client QA Automation Plan

This document describes the plan for converting the manual OutlineVPN Client QA
checklist ([go/outlinevpn-client-qa](http://go/outlinevpn-client-qa)) into an
automated test suite. Each manual checklist item has a stable identifier (e.g.
`Vpn.Connect`, `App.Certificate.Windows.Installer`); automated tests are tagged
with these identifiers so that coverage can be traced and a release sign-off
sheet can be generated automatically.

## Architecture insight

The client is one shared web UI ([client/web](../client/web), Polymer/Lit web
components) wrapped by Cordova (Android, iOS, macOS) and Electron (Windows,
Linux), with all VPN/transport logic in a shared Go backend
([client/go](../client/go)). The native layer is reached only through a narrow
`MethodChannel` interface ([client/web/app/method_channel.ts](../client/web/app/method_channel.ts))
and the platform VPN APIs.

Consequently, most checklist items do **not** need per-platform E2E automation:

- UI behavior (add key, rename, i18n, about, feedback form) is identical on all
  five platforms and can be tested once, in a browser, with a mocked method
  channel.
- Access-key parsing and transport correctness (prefix, ssconf, JSON, WebSocket
  configs) live in shared TS/Go code and are best proven by integration tests
  against a local Shadowsocks server.
- Only real tunnel establishment, OS network integration, and installers need
  per-platform harnesses.

## The five layers

### Layer 1 — Shared-UI suite (Playwright, browser mode)

Runs on every PR on `ubuntu-latest`. Builds the web bundle, serves it, drives
it with [Playwright](https://playwright.dev) (chosen because it pierces Shadow
DOM natively, has first-class network interception, and also covers Electron in
Layer 3).

Groundwork:

1. **Test-mode method channel** — a fake native bridge implementing the same
   interface the Cordova/Electron bridges install, with scriptable responses
   (connect succeeds, connect fails with error X, reconnecting event fires).
2. **Stable selectors** — `data-testid` attributes on the server card, add-key
   dialog, navigation, and toasts.

Also provides:

- Visual regression for RTL/Farsi (`Ui.I18n.FarsiAlt`) via Playwright
  screenshot assertions (optionally Storybook-based per-component snapshots).
- `Report.UserFeedback` by intercepting the outgoing Sentry request.

Covers: `Vpn.Default.Clean`, `Vpn.AddKey`, `Vpn.AddKey.InvalidKey`,
`Ui.ServerRename`, `Ui.I18n`, `Ui.I18n.FarsiAlt`, `Ui.About`,
`Report.UserFeedback`, UI halves of `Vpn.OnlineConfig.*`.

### Layer 2 — Transport correctness (Go integration tests, hermetic servers)

Extends the existing `go test ./client/...` CI job. A per-run ephemeral test
harness replaces the shared QA droplet:

- `outline-ss-server` (Outline's own Shadowsocks server; supports TCP/UDP and
  WebSocket listeners) started locally on the runner.
- A local static HTTP server serving generated `ssconf://` dynamic configs
  pointing at the local ss-server.

Tests assert: dial through each config format, TCP/UDP round-trips, prefix
bytes on the wire, WebSocket transport, and the expected
`InvalidServiceConfiguration` error for `basic-access` configs.

A nightly canary job runs the same assertions against the real QA servers, but
PRs are never gated on it.

Covers: `Vpn.Connect.WithPrefix` (transport half), `Vpn.OnlineConfig.*` key
formats, `Net.Raw.Tcp`, `Net.Raw.Udp`.

### Layer 3 — Desktop E2E (Playwright Electron, Windows + Linux)

Playwright's `_electron.launch()` drives the real main process and renderer.

- **Linux** (`ubuntu-latest`): runners allow sudo and expose `/dev/net/tun`, so
  a *real* VPN can be established. `Net.Web` is verified hermetically: assert a
  target reachable only through the tunnel responds / egress IP matches the
  local ss-server. `Vpn.AutoReconnect` by bouncing the network interface.
- **Windows** (`windows-2022`): runners are elevated, so the TAP-based tunnel
  is plausible in CI; validate early. Fallback: mocked VPN service for UI
  flows, real-tunnel checks moved to the release-gate VM job.

Covers: `App.Start`, `App.Terminate`, `Vpn.Connect`, `Vpn.Disconnect`,
`Vpn.AutoReconnect`, `Net.Web`, server persistence across real restarts.

### Layer 4 — Mobile and Apple desktop

**Android — Maestro on emulator** (nightly CI):

- `reactivecircus/android-emulator-runner` on `ubuntu-latest` (KVM available).
- `VpnService` works on emulators and the consent dialog is tappable, so real
  connect + `Net.Web` checks are automatable.
- Deep links via `adb shell am start` / Maestro `openLink`.
- `Vpn.AutoReconnect` via `adb shell svc wifi disable/enable`.
- Spike required: Maestro sees webview content through the accessibility tree;
  Cordova/Polymer content may need accessibility labels. Fallback: Appium
  (UiAutomator2) with hybrid-context switching into the webview DOM.

**iOS — split UI tests from tunnel tests.** `NEPacketTunnelProvider` does not
run on the iOS Simulator, so:

- Simulator (CI): UI flows with the VPN mocked — Maestro or XCUITest (XCTest
  targets and iPhone simulator jobs already exist in CI).
- Real device (nightly/pre-release): true connect + `Net.Web` on a physical
  iPhone attached to a self-hosted Mac runner, driven by XCUITest. Device
  clouds generally cannot grant VPN permission dialogs reliably.

**macOS — XCUITest** on the existing Catalyst CI job. System-extension
approval prompts make real tunnels unreliable on hosted CI; real-tunnel smoke
runs on the self-hosted Mac (which doubles as the iOS device host).

### Layer 5 — Installer & lifecycle checks (scripted, release gate)

PowerShell/bash scripts in a release-gate workflow, run against signed
artifacts:

- **Signature (P0)**: `Get-AuthenticodeSignature` — exactly one valid
  signature, issued to "Jigsaw Operations LLC", valid dates.
- **Clean install**: a fresh hosted Windows runner *is* the clean VM. Silent
  NSIS install (`/S`), assert exit code, installed files, TAP0 adapter
  (`Get-NetAdapter`), Start Menu entry.
- **Reinstall/Upgrade/Uninstall**: previous release → current release, assert
  persisted servers and a single TAP device; uninstall and assert clean
  removal. Linux: same pattern with the `.deb`.

Covers: `App.Certificate.Windows.Installer`, `App.Install.Clean`,
`App.Install.Reinstall`, `App.Install.Upgrade`, `App.Uninstall`.

## CI shape

| Trigger | Contents |
| :--- | :--- |
| Per-PR | Layer 1 Playwright UI suite, Layer 2 Go transport tests, existing unit tests. Fast and hermetic. |
| Nightly | Layer 3 Electron E2E, Layer 4 Android emulator Maestro + iOS simulator suite, canary vs. real QA servers. |
| Release gate (manual dispatch) | Layer 5 installer checks on signed artifacts, real-device iOS/macOS smoke on self-hosted Mac, full nightly suite pinned to the release build, sign-off sheet generation. |

## Traceability & sign-off generation

Every automated test is tagged with its checklist ID (`Vpn.Connect`,
`App.Certificate.Windows.Installer`, …). The release workflow aggregates
results and generates the sign-off sheet: each ID marked pass / fail /
not-automated with a link to the CI run. Items that remain manual are listed
explicitly.

## What stays manual

- App-store install/upgrade flows (TestFlight / Play Store mechanics).
- Minimum-supported-OS-version matrix (old-OS VMs/devices possible later via
  self-hosted Tart macOS VMs and old emulator images; not blocking).
- Visual/UX judgment calls.

## Phasing & status

- [ ] **Phase 0 — groundwork**
  - [x] Test-mode method channel (the Capacitor browser build's
        `CapacitorBrowserMethodChannel` + `FakeVpnApi`, which now emits status
        change events; demo-server seeding suppressible via
        `?demoServers=false`)
  - [x] `data-testid` attributes on key components (zero state, header,
        add-key dialog, server cards, rename dialog)
  - [ ] Hermetic ss-server harness (local Shadowsocks + ssconf file server)
  - [ ] Maestro-on-Cordova-webview spike (Android)
- [ ] **Phase 1 — per-PR suites**
  - [x] Playwright shared-UI suite, tagged with checklist IDs
        (`client/e2e`; covers App.Start, Vpn.Default.Clean, Vpn.AddKey,
        Vpn.AddKey.InvalidKey, Vpn.Connect/Disconnect at UI level,
        Ui.ServerRename, Ui.About)
  - [ ] Go transport integration tests against the hermetic harness
  - [x] Wire the Playwright suite into per-PR CI
        (`shared_ui_e2e_test` job in build_and_test_debug_client.yml)
- [ ] **Phase 2 — desktop E2E**
  - [ ] Playwright Electron on Linux (real tunnel, Net.Web, AutoReconnect)
  - [ ] Playwright Electron on Windows
  - [ ] Windows installer/signature scripts on the release gate
- [ ] **Phase 3 — Android**
  - [ ] Maestro flows on emulator in nightly CI (real VPN + Net.Web)
- [ ] **Phase 4 — Apple platforms**
  - [ ] iOS simulator UI suite (mocked VPN)
  - [ ] macOS Catalyst XCUITest suite
  - [ ] Self-hosted Mac mini for real-device/real-tunnel smoke
- [ ] **Phase 5 — sign-off automation**
  - [ ] Checklist-ID tagging convention + results aggregation
  - [ ] Sign-off sheet generation in the release workflow
