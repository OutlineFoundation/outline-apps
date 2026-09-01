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

import {Capacitor} from '@capacitor/core';
import {CapacitorPluginOutline} from '@capacitor-plugin-outline';

// Set once the legacy storage has been read and replayed, so the off-screen
// WebView is only ever spun up on the first launch after the upgrade.
//
// There is deliberately no attempt limit. A failed read leaves the legacy
// file:// data untouched, so the situation is always recoverable — whereas
// giving up would make it permanent, and the thing being lost is the user's
// whole server list. Retrying is close to free: every native failure path
// (no activity, load error, WebView unavailable) returns in milliseconds. Only
// a page that starts loading and never finishes costs the native timeout, and
// that case is rare enough not to be worth trading the data for.
const MIGRATION_COMPLETED_KEY = 'cordova_2026_migration_completed';

/**
 * Replays the localStorage of a Cordova install into the Capacitor origin.
 *
 * The Cordova Android build ran from `file:///android_asset/www/` (config.xml
 * sets `AndroidInsecureFileModeEnabled`) while Capacitor serves
 * `https://localhost`. Chromium partitions storage by origin, so without this an
 * upgrading user launches into an empty app: no servers, no settings.
 *
 * Must be awaited before the app reads storage, otherwise the server repository
 * is built from the empty namespace and the migrated data only appears after a
 * restart.
 *
 * Throws when the legacy origin could not be read, wrapping the native error as
 * the cause. The caller is responsible for catching and logging it, and must
 * still start the app: failing to migrate costs the user their server list, but
 * failing to launch costs them the app entirely.
 */
export async function migrateLegacyCordovaStorageIfNeeded(): Promise<void> {
  // Android is the only platform whose origin changed. iOS keeps the Cordova
  // origin via `server.iosScheme`, and the browser build has nothing to migrate.
  if (Capacitor.getPlatform() !== 'android') {
    return;
  }
  if (window.localStorage.getItem(MIGRATION_COMPLETED_KEY) === 'true') {
    return;
  }

  let legacyStorage: Record<string, string>;
  try {
    legacyStorage = await CapacitorPluginOutline.getLegacyCordovaLocalStorage();
  } catch (e) {
    // A rejection means the legacy origin could not be read at all — no activity,
    // the bridge page failed to load, the dump script threw, or it timed out. It
    // does NOT mean there was nothing to migrate, which resolves as an empty
    // object. Rethrowing leaves the completion marker unset, so the next launch
    // tries again rather than stranding the user's servers. The native error is
    // kept as the cause, so its LEGACY_STORAGE_* code survives for the handler.
    throw new Error('failed to read the legacy Cordova localStorage', {
      cause: e,
    });
  }

  // An empty object is the expected result for a fresh install, or for a
  // Cordova install that never wrote anything. Nothing is copied and the loop
  // simply does not run — that is a successful migration, not a failed one, so
  // it confirms below like any other and never spins up the WebView again.
  for (const [key, value] of Object.entries(legacyStorage)) {
    // Never clobber a key this install has already written: whatever is in the
    // Capacitor origin is newer than the Cordova snapshot.
    if (
      typeof value === 'string' &&
      window.localStorage.getItem(key) === null
    ) {
      window.localStorage.setItem(key, value);
    }
  }

  // Reached only when the legacy origin was read successfully, whether or not
  // it held anything. Every early return above leaves this unset, so the next
  // launch tries again rather than stranding the user's servers.
  window.localStorage.setItem(MIGRATION_COMPLETED_KEY, 'true');
}
