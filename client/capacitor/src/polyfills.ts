// Copyright 2026 The Outline Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

/**
 * Polyfills required by the Capacitor web bundle.
 *
 * These are loaded as the first webpack entry point (see webpack.config.js)
 * so they run before any application code.
 *
 * - core-js/stable & regenerator-runtime: ES2015+ built-in and async/await
 *   support for older WebView engines on Android and iOS.
 * - web-animations-js: Web Animations API polyfill used by Lit/Material
 *   component transitions.
 * - @webcomponents/webcomponentsjs: Web Components v1 (Custom Elements,
 *   Shadow DOM) polyfill needed by the legacy Polymer components still used
 *   in the app shell (client/web/ui_components/app-root.js).
 * - setRootPath: tells Polymer where to resolve relative asset URLs from,
 *   required because the app may be served from a sub-path (e.g. Capacitor
 *   file:// origin on iOS/Android).
 */
import 'core-js/stable';
import 'regenerator-runtime/runtime';
import 'web-animations-js/web-animations-next-lite.min.js';
import '@webcomponents/webcomponentsjs/webcomponents-bundle.js';
import {setRootPath} from '@polymer/polymer/lib/utils/settings.js';

setRootPath(
  location.pathname.substring(0, location.pathname.lastIndexOf('/') + 1)
);
