// Copyright 2018 The Outline Authors
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

/// <reference types='../types/webintents.d.ts'/>

type Listener = (url: string) => void;

export class UrlInterceptor {
  protected launchUrl?: string;
  private listeners: Array<Listener> = [];

  registerListener(listener: Listener) {
    this.listeners.push(listener);
    if (this.launchUrl) {
      listener(this.launchUrl);
      this.launchUrl = undefined;
    }
  }

  executeListeners(url: string) {
    if (!url) {
      return;
    }
    if (!this.listeners.length) {
      console.log('no listeners have been added, delaying intent firing');
      this.launchUrl = url;
      return;
    }
    for (const listener of this.listeners) {
      listener(url);
    }
  }
}

export class AndroidUrlInterceptor extends UrlInterceptor {
  constructor() {
    super();
    // Check if webintent (Cordova plugin) is available
    if (typeof window !== 'undefined' && (window as any).webintent) {
      const webintent = (window as any).webintent;
      webintent.getUri((launchUrl: string) => {
        webintent.onNewIntent(this.executeListeners.bind(this));
        this.executeListeners(launchUrl);
      });
    } else {
      // For Capacitor, we'll use the App plugin for URL handling
      // This is a fallback - URL interception will be handled by Capacitor's App plugin
      console.debug(
        '[AndroidUrlInterceptor] webintent not available, using base UrlInterceptor'
      );
    }
  }
}

export class AppleUrlInterceptor extends UrlInterceptor {
  constructor(launchUrl?: string) {
    super();
    // cordova-ios calls a global function with this signature when a URL is intercepted.
    // We define it in |main.cordova|, redefine it to use this interceptor.
    window.handleOpenURL = (url: string) => {
      this.executeListeners(url);
    };
    if (launchUrl) {
      this.executeListeners(launchUrl);
    }
  }
}
