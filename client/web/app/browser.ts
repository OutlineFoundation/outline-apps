// Copyright 2025 The Outline Authors
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

export interface Browser {
  setup(): void;
}

export class CapacitorInAppBrowser implements Browser {
  private clickHandler: ((event: Event) => Promise<void>) | null = null;

  setup(): void {
    const Browser = (window as any).Capacitor?.Plugins?.Browser;
    if (!Browser || typeof Browser.open !== 'function') {
      console.warn(
        '[Capacitor] Browser plugin not available, external links will open in system browser'
      );
      return;
    }

    this.clickHandler = this.handleClick.bind(this);
    document.addEventListener('click', this.clickHandler, true);
  }

  private async handleClick(event: Event): Promise<void> {
    const anchor = this.findAnchorInPath(event.composedPath());
    if (!anchor) {
      return;
    }

    const href = anchor.getAttribute('href');
    if (!href) {
      return;
    }

    try {
      const url = new URL(href, window.location.href);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        return;
      }

      const isExternal = url.origin !== window.location.origin;
      const isTargetBlank = anchor.getAttribute('target') === '_blank';

      if (isExternal || isTargetBlank) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();

        await this.openInBrowser(url);
      }
    } catch (e) {
      console.debug('[Capacitor] Invalid URL for in-app browser:', href);
    }
  }

  private findAnchorInPath(path: EventTarget[]): HTMLAnchorElement | null {
    for (const element of path) {
      if (element instanceof HTMLElement) {
        if (element.tagName === 'A' || element.tagName === 'a') {
          return element as HTMLAnchorElement;
        }
      }
    }
    return null;
  }

  private async openInBrowser(url: URL): Promise<void> {
    try {
      const Capacitor = (window as any).Capacitor;
      const Browser = (window as any).Capacitor?.Plugins?.Browser;

      if (!Browser || !Capacitor) {
        throw new Error('Capacitor Browser plugin not available');
      }

      const platform = Capacitor.getPlatform();
      const browserOptions: {
        url: string;
        presentationStyle?: 'popover' | 'fullscreen';
        toolbarColor?: string;
      } = {
        url: url.toString(),
      };

      if (platform === 'ios') {
        browserOptions.presentationStyle = 'popover';
      } else if (platform === 'android') {
        browserOptions.toolbarColor = '#0F1621';
      }

      await Browser.open(browserOptions);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error(
        '[Capacitor] Failed to open URL in in-app browser:',
        errorMessage,
        error
      );
    }
  }
}
