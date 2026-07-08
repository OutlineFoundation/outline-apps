# Manager QA Automation Plan

This document describes the plan for converting the manual OutlineVPN Server
Manager QA checklist ([go/outlinevpn-manager-qa](http://go/outlinevpn-manager-qa))
into an automated test suite. Each manual checklist item has a stable
identifier (e.g. `ServerCreate.Manual`, `App.Certificate.Windows.Installer`);
automated tests are tagged with these identifiers so that coverage can be
traced and a release sign-off sheet can be generated automatically.

It is the Manager counterpart of the client plan in
[qa-automation-plan.md](qa-automation-plan.md) and follows the same layering
and traceability conventions.

## Architecture insight

The Manager is one web UI ([server_manager/www](../server_manager/www),
Polymer/Lit web components) wrapped by a thin Electron shell
([server_manager/electron](../server_manager/electron)). Unlike the client,
there is no native tunnel: *everything* the app does is plain HTTPS from the
renderer —

- the DigitalOcean REST API (`api.digitalocean.com`),
- the GCP APIs (OAuth, Compute, Cloud Billing),
- and the Shadowbox management API of each server.

The Electron layer contributes only OAuth helpers, certificate-pinned fetch
(`fetchWithPin`, used when a manual server config carries a `certSha256`),
window management, and auto-update. A browser build already exists
(`server_manager/browser.webpack.js` / `www/browser_main.ts`) that stubs all
of these.

Consequently, almost the entire checklist can be automated in a plain
browser with network interception:

- Manual servers added *without* a certificate fingerprint use plain
  `window.fetch`, so Playwright's `page.route()` can impersonate a complete
  Shadowbox management API while the app runs 100% real code (repository,
  storage, UI). No fake objects need to be injected at all.
- `ManualServerRepository` and `CloudAccounts` persist to `localStorage`, so
  "restart the manager" checklist steps become `page.reload()`.
- The DigitalOcean flow is equally interceptable: the browser build's OAuth
  stub asks for a token via `window.prompt` (answerable from Playwright), and
  every subsequent call is REST against `api.digitalocean.com`.
- Only installers, signatures, real cloud-provider behavior, and the Electron
  shell itself need heavier harnesses.

## The five layers

### Layer 1 — Manager UI suite (Playwright, browser build)

Runs on every PR on `ubuntu-latest`. Builds the browser bundle
(`server_manager/browser.webpack.js`), serves it statically, drives it with
[Playwright](https://playwright.dev) (same tooling as the client suite; it
pierces Shadow DOM natively — essential for the Polymer app shell — and also
covers Electron in Layer 3).

Groundwork:

1. **Route-intercepted Shadowbox API** — a scriptable in-test fake of the
   management API (`/server`, `/access-keys`, `/metrics/transfer`, …) mounted
   on an `https://` origin via `page.route()` (the page CSP allows any
   `https:` connect target, and intercepted requests never leave the
   browser).
2. **Stable selectors** — `data-testid` attributes on the intro cards, manual
   server entry, server list, access-key table and its controls, and the
   feedback/about/language surfaces.

Covers: `App.Start`, `ServerCreate.Manual`, `ServerConnect.Manual`,
`ServerDestroy.Manual`, `Key.Add`, `Key.Delete`, `Key.Share` (UI half:
the access key is displayed and copyable), `Key.UsageData`, `Ui.I18n`,
`Ui.About` (partial: version string, no `-dev` check on release artifacts),
`Report.UserFeedback` (partial: success path at UI level — the browser build
initializes Sentry without a DSN, so no outgoing request exists to intercept
until the `@sentry/browser` split in
[#1311](https://github.com/Jigsaw-Code/outline-apps/issues/1311) lands).

The DigitalOcean flows run against an intercepted DO API
(`server_manager/e2e/tests/fake_digitalocean.ts`): the browser build's OAuth
stub asks for the token via `window.prompt` (answered through Playwright's
dialog handler), and everything after that — account status, region listing,
droplet creation, install-tag polling, destruction — is the app's real
DigitalOcean code over the intercepted REST API. Covers
`ServerCreate.DigitalOcean`, `ServerConnect.DigitalOcean`,
`ServerDestroy.DigitalOcean` (UI halves; the full-stack halves are Layer 4).

GCP is the remaining provider. It needs (a) a `runGcpOauth` stub in
`browser_main.ts` (the browser build currently has none, so the GCP intro
card is unusable outside Electron), and (b) a substantially larger
intercepted surface than DigitalOcean: the OAuth token exchange, Compute
(instances, static IPs, guest attributes, firewalls, zones, operation
polling), Resource Manager (project create/list + operations), Service Usage
(list/batchEnable + operations) and Cloud Billing. Deferred to its own
phase.

### Layer 2 — Real-Shadowbox integration (hermetic server, nightly)

The manual-server journey re-runs against a *real* Shadowbox: a container
started on the runner (`npm run action server_manager/e2e/test_real`), set
up the way `install_server.sh` does it — self-signed TLS certificate, API
prefix, first access key. This proves the management-API contract (the
Layer 1 fake and the real server can drift; this layer catches it).

It also completes `Key.Share`: the acceptance criterion is that the Outline
*Client* can connect with the shared key. The generated access key is handed
to the client's Go transport library (`client/go`), which dials through the
container — the same hermetic pattern as client Layer 2, reusing its
harness.

Covers: `ServerCreate.Manual` / `Key.*` (full-stack halves), `Key.Share`
(connect check).

### Layer 3 — Desktop E2E (Playwright Electron, Windows + Linux + macOS)

Playwright's `_electron.launch()` drives the real main process and renderer
(`npm run action server_manager/e2e/test_electron`): app starts, window
opens, servers persist across a real app restart, and the app quits cleanly
(no orphan process). Groundwork: `OUTLINE_MANAGER_USER_DATA_DIR` redirects
the app's state (and the single-instance lock, which is scoped to userData)
so tests are isolated from the user's real profile and any running Manager.
Playwright-fulfilled responses reach this app's renderer with `status: 0`
(its pages live on the custom `outline://` scheme), so the Shadowbox fake
serves over a real local HTTPS socket here and the app launches with
`--ignore-certificate-errors`.

Covers: `App.Start`, `App.Terminate`, `ServerConnect.Manual` (real restart).
Later: OAuth window smoke, `Ui.MainIcon` (partial: window/dock icon
present).

### Layer 4 — Cloud-provider canary (real DO/GCP, release gate)

The only honest test of `ServerCreate.DigitalOcean` / `ServerCreate.GCP` is
against the real providers: create a droplet/VM with a dedicated test
account, wait for the Shadowbox install to complete, add a key, connect,
destroy. Expensive and slow, so it runs on manual dispatch as part of the
release gate (optionally weekly), with credentials in repository secrets and
an always-run destroy step to bound cost.

Covers: `ServerCreate.DigitalOcean`, `ServerCreate.GCP`,
`ServerConnect.DigitalOcean`, `ServerConnect.GCP`,
`ServerDestroy.DigitalOcean`, `ServerDestroy.GCP` (full-stack).

### Layer 5 — Installer & lifecycle checks (scripted, release gate)

PowerShell/bash scripts in a release-gate workflow, run against signed
artifacts (shared with the client's Layer 5 workflow):

- **Signature (P0)**: `Get-AuthenticodeSignature` on `Outline-Manager.exe` —
  exactly one valid signature, issued to "Jigsaw Operations LLC", valid
  dates. macOS: `spctl -a -vvvv -t execute` — accepted, Notarized Developer
  ID.
- **Clean install**: fresh hosted Windows runner as the clean VM; silent
  install, assert exit code, installed files, Start Menu entry.
- **Reinstall/Upgrade/Uninstall**: previous release → current release,
  assert persisted servers (localStorage in the user profile survives);
  uninstall and assert clean removal. Linux: same pattern with the
  `.AppImage`.

Covers: `App.Certificate.Windows.Installer`, `App.Notarization.MacOS`,
`App.Install.Clean`, `App.Install.Reinstall`, `App.Install.Upgrade`,
`App.Uninstall`.

## CI shape

| Trigger | Contents |
| :--- | :--- |
| Per-PR | Layer 1 Playwright UI suite, existing unit tests (`server_manager/test`). Fast and hermetic. |
| Nightly | Layer 2 Shadowbox-container suite, Layer 3 Electron E2E. |
| Release gate (manual dispatch) | Layer 4 cloud canary, Layer 5 installer checks on signed artifacts, full nightly suite pinned to the release build, sign-off sheet generation. |

## Traceability & sign-off generation

Every automated test is tagged with its checklist ID (`ServerCreate.Manual`,
`App.Certificate.Windows.Installer`, …). The release workflow aggregates
results and generates the sign-off sheet: each ID marked pass / fail /
not-automated with a link to the CI run. Items that remain manual are listed
explicitly. Shared with the client plan's Phase 5 tooling.

## What stays manual

- Cloud-provider *console-side* verification (droplet visible in the DO
  dashboard, billing states, GCP project quirks) beyond what the APIs report.
- `Ui.MainIcon` visual judgment (icon *looks* correct in taskbar/dock).
- OAuth against the real DO/GCP consent screens (provider UX changes at
  will; the canary uses pre-issued tokens).
- Visual/UX judgment calls.

## Phasing & status

- [x] **Phase 0 — groundwork**
  - [x] Shadowbox management API fake, mountable as Playwright routes or a
        real local HTTPS server (`server_manager/e2e/tests/fake_shadowbox.ts`)
  - [x] `data-testid` attributes on key components (intro, manual entry,
        server list, access-key table/controls, help bubbles)
  - [x] Shadowbox container harness for Layer 2
        (`server_manager/e2e/test_real.action.sh`)
  - [x] `OUTLINE_MANAGER_USER_DATA_DIR` profile isolation for Electron
        (`server_manager/electron/index.ts`)
- [ ] **Phase 1 — per-PR suite**
  - [x] Playwright Manager UI suite, tagged with checklist IDs
        (`server_manager/e2e`; covers App.Start, ServerCreate.Manual,
        ServerConnect.Manual, ServerDestroy.Manual, Key.Add, Key.Delete,
        Key.Share (UI), Key.UsageData, Ui.I18n, Ui.About,
        Report.UserFeedback (UI))
  - [x] Wire the suite into per-PR CI (`manager_e2e_test` job in
        build_and_test_debug_manager.yml)
  - [x] DigitalOcean flows against an intercepted DO API
        (`fake_digitalocean.ts`; ServerCreate/ServerConnect/ServerDestroy
        .DigitalOcean)
  - [ ] GCP flows against an intercepted GCP API (needs a browser
        `runGcpOauth` stub first; see the Layer 1 section)
- [ ] **Phase 2 — hermetic real server**
  - [x] Real-Shadowbox journey + nightly job
        (`server_manager/e2e/test_real`, `real_shadowbox_e2e` in
        nightly_manager_e2e.yml)
  - [ ] Key.Share connect check via the client Go library
- [ ] **Phase 3 — desktop E2E**
  - [x] Playwright Electron suite (`server_manager/e2e/test_electron`;
        App.Start, App.Terminate, restart persistence) + nightly Linux job
        (`linux_electron_e2e` in nightly_manager_e2e.yml); also runs
        locally on macOS
  - [ ] Windows Electron job
  - [ ] OAuth window smoke, Ui.MainIcon partial
- [ ] **Phase 4 — release gate**
  - [ ] Cloud canary workflow (real DO/GCP, secrets, auto-destroy)
  - [ ] Installer/signature scripts (shared with client Layer 5)
- [ ] **Phase 5 — sign-off automation**
  - [ ] Results aggregation + sign-off sheet generation (shared tooling with
        the client plan)
