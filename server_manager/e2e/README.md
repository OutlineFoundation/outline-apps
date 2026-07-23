# Manager UI E2E Suite

This is Layer 1 of the automated QA suite described in
[docs/manager-qa-automation-plan.md](../../docs/manager-qa-automation-plan.md):
Playwright tests that drive the real Manager web UI (the browser build)
against a route-intercepted fake of the Shadowbox management API.

Each test title starts with the QA checklist ID it automates (e.g.
`ServerCreate.Manual`), so results can be traced back to — and eventually
generate — the release sign-off sheet.

## Running

```sh
npm run action server_manager/e2e/test
```

This builds the browser bundle and runs the suite headlessly. Extra
arguments are forwarded to `playwright test`, e.g.:

```sh
npm run action server_manager/e2e/test -- --headed
npm run action server_manager/e2e/test -- --grep "Key.Add"
```

If the bundle in `output/build/server_manager/www/static` is already up to
date, you can run Playwright directly:

```sh
npx playwright test --config server_manager/e2e/playwright.config.ts
```

First-time setup installs the browser binary:

```sh
npx playwright install chromium
```

## Notes

- Manual servers added without a certificate fingerprint use plain
  `window.fetch`, so `FakeShadowbox` (tests/fake_shadowbox.ts) can
  impersonate a complete management API with `page.route()` while the app
  runs real code end to end — repository, `localStorage` persistence and UI.
- Cloud-provider flows (DigitalOcean, GCP) are not covered here yet; see the
  phasing section of the plan.
- Prefer `data-testid` selectors (or existing stable `id`s); add new ones to
  components rather than relying on classes or localized text.
