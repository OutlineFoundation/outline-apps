# Shared-UI E2E Suite

This is Layer 1 of the automated QA suite described in
[docs/qa-automation-plan.md](../../docs/qa-automation-plan.md): Playwright
tests that drive the real shared web UI (the Capacitor browser build) against
the browser method channel and the fake VPN API.

Each test title starts with the QA checklist ID it automates (e.g.
`Vpn.AddKey`), so results can be traced back to — and eventually generate —
the release sign-off sheet.

## Running

```sh
npm run action client/e2e/test
```

This builds the Capacitor browser bundle and runs the suite headlessly.
Extra arguments are forwarded to `playwright test`, e.g.:

```sh
npm run action client/e2e/test -- --headed
npm run action client/e2e/test -- --grep "Vpn.AddKey"
```

If the bundle in `client/capacitor/www` is already up to date, you can run
Playwright directly:

```sh
npx playwright test --config client/e2e/playwright.config.ts
```

First-time setup installs the browser binary:

```sh
npx playwright install chromium
```

## Notes

- The app is loaded with `?demoServers=false` to suppress the demo servers
  the browser build normally seeds (see `client/web/app/main.ts`).
- VPN behavior is faked by `FakeVpnApi`
  (`client/web/app/outline_server_repository/vpn.fake.ts`); these tests cover
  UI behavior only. Real tunnel establishment is covered by the desktop and
  mobile E2E layers of the plan.
- Prefer `data-testid` selectors; add new ones to components rather than
  relying on classes or localized text.
