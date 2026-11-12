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

import {
  DONATE_BANNER_MIN_SERVER_AGE_MS,
  isDonateBannerDismissed,
  saveDonateBannerDismissal,
  shouldShowDonateBanner,
} from './donate';

class FakeStorage implements Storage {
  private items = new Map<string, string>();
  get length() {
    return this.items.size;
  }
  clear() {
    this.items.clear();
  }
  getItem(key: string) {
    return this.items.get(key) ?? null;
  }
  key(index: number) {
    return [...this.items.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.items.delete(key);
  }
  setItem(key: string, value: string) {
    this.items.set(key, value);
  }
}

describe('shouldShowDonateBanner', () => {
  const now = new Date('2026-11-08T12:00:00Z');
  const oldEnough = new Date(now.getTime() - DONATE_BANNER_MIN_SERVER_AGE_MS);
  const tooNew = new Date(now.getTime() - DONATE_BANNER_MIN_SERVER_AGE_MS + 1);

  it('is false for a server younger than the minimum age', () => {
    expect(shouldShowDonateBanner(tooNew, false, now)).toBeFalse();
  });

  it('is true once the server reaches the minimum age', () => {
    expect(shouldShowDonateBanner(oldEnough, false, now)).toBeTrue();
  });

  it('is false after the banner has been dismissed', () => {
    expect(shouldShowDonateBanner(oldEnough, true, now)).toBeFalse();
  });
});

describe('donate banner dismissal', () => {
  it('is not dismissed until saved', () => {
    const storage = new FakeStorage();
    expect(isDonateBannerDismissed(storage)).toBeFalse();
    saveDonateBannerDismissal(storage);
    expect(isDonateBannerDismissed(storage)).toBeTrue();
  });
});
