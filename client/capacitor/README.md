# Capacitor client (browser)

This directory is the Capacitor-based client shell. **This README documents the browser workflow only** (webpack bundle under `client/capacitor/www/`).

Run all commands from the **repository root** using `npm run action`.

## Requirements (browser)

- [Node.js](https://nodejs.org/) 22 (see root `package.json` `engines`)
- Install dependencies after clone:

  ```sh
  npm ci
  ```

  If you use `nvm`, run `nvm use` in the repo root so the Node version matches.

## Start (development server)

Runs a **browser** build once, then starts the webpack dev server (HMR):

```sh
npm run action client/capacitor/start
```

- **URL:** [http://localhost:8080](http://localhost:8080) (server binds to `0.0.0.0:8080`).
- **Live reload:** edit sources under `client/web/` and other bundled paths; the UI updates as you save.

**Note:** In pure browser mode, Capacitor native plugins are not available. The app uses a browser `MethodChannel` shim for a subset of behavior (for example parsing common static access keys). Use this for UI and web-layer development.

## Build (browser)

The build action accepts **`browser`** (see `build.action.mjs`).

**Debug (default):**

```sh
npm run action client/capacitor/build
```

**Note:** The Capacitor browser build is **debug-only**. Passing `--buildMode=release` is rejected by `build.action.mjs`.

### Output

Artifacts land in **`client/capacitor/www/`**, including for example:

- `index.html`, `bundle.js`
- `environment.json` (version and build numbers)
- Copied assets: `messages/`, `assets/`, etc. (see `webpack.config.js`)
