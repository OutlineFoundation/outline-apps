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

import { App } from '@capacitor/app';
import { UrlInterceptor } from '@web/app/url_interceptor';


export class CapacitorAndroidUrlInterceptor extends UrlInterceptor {
  constructor() {
    super();
    void this.wireAppUrlHandling().catch((err: unknown) => {
      console.warn('Capacitor Android URL interception setup failed', err);
    });
  }

  private async wireAppUrlHandling(): Promise<void> {
    try {
      const launch = await App.getLaunchUrl();
      if (launch?.url) {
        this.executeListeners(launch.url);
      }
    } catch {
      // No launch URL (normal when the app is opened from the launcher).
    }

    await App.addListener('appUrlOpen', ({ url }) => {
      if (url) {
        this.executeListeners(url);
      }
    });
  }
}
