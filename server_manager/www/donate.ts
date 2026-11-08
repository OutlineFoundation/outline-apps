/*
  Copyright 2026 The Outline Authors

  Licensed under the Apache License, Version 2.0 (the "License");
  you may not use this file except in compliance with the License.
  You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

  Unless required by applicable law or agreed to in writing, software
  distributed under the License is distributed on an "AS IS" BASIS,
  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
  See the License for the specific language governing permissions and
  limitations under the License.
*/

export const DONATE_URL =
  'https://givebutter.com/outline-lt1azu?utm_source=outline-manager&utm_medium=app';

/** How long a server must have existed before the donate banner is shown. */
export const DONATE_BANNER_MIN_SERVER_AGE_MS = 30 * 24 * 60 * 60 * 1000;

const DONATE_BANNER_DISMISSED_KEY = 'donate-banner-dismissed';

/**
 * Whether the donate banner should be shown for a server created at
 * `serverCreatedDate`. The banner is shown once a server has been around for
 * DONATE_BANNER_MIN_SERVER_AGE_MS, and never again after it has been dismissed.
 */
export function shouldShowDonateBanner(
  serverCreatedDate: Date,
  now: Date = new Date(),
  storage: Storage = window.localStorage
): boolean {
  if (storage.getItem(DONATE_BANNER_DISMISSED_KEY)) {
    return false;
  }
  const serverAgeMs = now.getTime() - serverCreatedDate.getTime();
  return serverAgeMs >= DONATE_BANNER_MIN_SERVER_AGE_MS;
}

/** Permanently hides the donate banner on this install. */
export function dismissDonateBanner(
  storage: Storage = window.localStorage
): void {
  storage.setItem(DONATE_BANNER_DISMISSED_KEY, 'true');
}
