// Copyright 2026 The Outline Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import {App} from '@capacitor/app';
import {Capacitor, type PluginListenerHandle} from '@capacitor/core';
import {UrlInterceptor} from '@web/app/url_interceptor';

export class CapacitorUrlInterceptor extends UrlInterceptor {
  private appUrlOpenHandle?: PluginListenerHandle;
  // On iOS the cold-start URL reaches JS twice: once from App.getLaunchUrl(), and
  // again from appUrlOpen, which the native plugin fires with retainUntilConsumed
  // and replays to the first listener. Hold it here so the replay can be dropped.
  // Android delivers the launch URL only once, so nothing is armed there.
  private duplicateColdStartUrl?: string;
  // Set synchronously by destroy(), so work still in flight can bail out. Without
  // it, a listener that finishes registering after teardown would be orphaned:
  // destroy() has already run and would never see its handle.
  private destroyed = false;

  private readonly handlePageHide = () => {
    void this.destroy();
  };

  constructor() {
    super();
    // Native plugin listeners outlive the WebView's JS context across page
    // reloads, so tear ours down before unload to avoid duplicate dispatches.
    window.addEventListener('pagehide', this.handlePageHide);
    void this.wireAppUrlHandling().catch((err: unknown) => {
      console.warn('Capacitor URL interception setup failed', err);
    });
  }

  async destroy(): Promise<void> {
    // Flip the flag and drop the handle before the first await: pagehide cannot
    // wait for a promise, so the JS context may be torn down mid-removal. Any
    // event delivered in that window is ignored because of this flag.
    this.destroyed = true;
    const handle = this.appUrlOpenHandle;
    this.appUrlOpenHandle = undefined;
    window.removeEventListener('pagehide', this.handlePageHide);
    await handle?.remove();
  }

  private async wireAppUrlHandling(): Promise<void> {
    try {
      const launch = await App.getLaunchUrl();
      if (launch?.url && !this.destroyed) {
        if (Capacitor.getPlatform() === 'ios') {
          this.duplicateColdStartUrl = launch.url;
        }
        this.executeListeners(launch.url);
      }
    } catch {
      // No launch URL (normal when the app is opened from the launcher).
    }
    if (this.destroyed) {
      return;
    }

    // Registering the listener is what triggers the retained replay on iOS, so
    // this must run after the launch URL above has been recorded.
    const handle = await App.addListener('appUrlOpen', ({url}) => {
      // The native listener outlives this JS context, and remove() cannot be
      // awaited from pagehide, so an event can still arrive after teardown.
      if (!url || this.destroyed) {
        return;
      }
      if (this.duplicateColdStartUrl !== undefined) {
        const isReplay = url === this.duplicateColdStartUrl;
        // Only the first event can be the replay; later opens are genuine.
        this.duplicateColdStartUrl = undefined;
        if (isReplay) {
          return;
        }
      }
      this.executeListeners(url);
    });

    if (this.destroyed) {
      // pagehide won the race: destroy() ran before this handle existed, so it
      // saw nothing to remove. Tear it down here or the native listener leaks.
      await handle.remove();
      return;
    }
    this.appUrlOpenHandle = handle;
  }
}
