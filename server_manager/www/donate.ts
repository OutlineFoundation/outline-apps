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

/**
 * The Outline Foundation's donation page. It redirects to the current
 * fundraising campaign and forwards query parameters, so the campaign can
 * change without a Manager release.
 */
export const DONATE_URL =
  'https://donate.outline.org/?utm_source=outline-manager&utm_medium=app';

/** How long a server must have existed before the donate banner is shown. */
export const DONATE_BANNER_MIN_SERVER_AGE_MS = 30 * 24 * 60 * 60 * 1000;

const DONATE_BANNER_DISMISSED_KEY = 'donate-banner-dismissed';

/**
 * Whether the donate banner should be shown given a server created at
 * `serverCreationDate`. The banner is due once a server has existed for
 * DONATE_BANNER_MIN_SERVER_AGE_MS, unless it has been dismissed.
 */
export function shouldShowDonateBanner(
  serverCreationDate: Date,
  dismissed: boolean,
  now = new Date()
): boolean {
  if (dismissed) {
    return false;
  }
  const serverAgeMs = now.getTime() - serverCreationDate.getTime();
  return serverAgeMs >= DONATE_BANNER_MIN_SERVER_AGE_MS;
}

/** Whether the donate banner has been dismissed on this install. */
export function isDonateBannerDismissed(storage: Storage): boolean {
  return storage.getItem(DONATE_BANNER_DISMISSED_KEY) !== null;
}

/** Records that the donate banner has been dismissed on this install. */
export function saveDonateBannerDismissal(storage: Storage): void {
  storage.setItem(DONATE_BANNER_DISMISSED_KEY, 'true');
}
