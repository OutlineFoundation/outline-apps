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
import {Browser} from '@capacitor/browser';
import {Capacitor} from '@capacitor/core';
import type {PluginListenerHandle} from '@capacitor/core';
import * as Sentry from '@sentry/browser';

import {CapacitorBrowserMethodChannel} from './browser_method_channel';
import {AbstractClipboard} from '../../web/app/clipboard';
import type {EnvironmentVariables} from '../../web/app/environment';
import {main} from '../../web/app/main';
import {
  installDefaultMethodChannel,
  type MethodChannel,
} from '../../web/app/method_channel';
import type {
  VpnApi,
  StartRequestJson,
  TunnelStatus,
} from '../../web/app/outline_server_repository/vpn';
import type {OutlinePlatform} from '../../web/app/platform';
import {AbstractUpdater} from '../../web/app/updater';
import * as interceptors from '../../web/app/url_interceptor';
import {NoOpVpnInstaller, type VpnInstaller} from '../../web/app/vpn_installer';
import {SentryErrorReporter, type Tags} from '../../web/shared/error_reporter';
import {CapacitorPluginOutline} from '../plugins/capacitor-plugin-outline/src';

const hasDeviceSupport = Capacitor.isNativePlatform();

class CapacitorClipboard extends AbstractClipboard {
  async getContents(): Promise<string> {
    if (!navigator.clipboard?.readText) {
      return '';
    }
    try {
      return await navigator.clipboard.readText();
    } catch {
      return '';
    }
  }
}

class CapacitorErrorReporter extends SentryErrorReporter {
  constructor(appVersion: string, dsn: string, tags: Tags) {
    super(appVersion, dsn, tags);
    if (dsn) {
      CapacitorPluginOutline.initializeErrorReporting({apiKey: dsn}).catch(
        console.error
      );
    }
  }

  async report(
    userFeedback: string,
    feedbackCategory: string,
    userEmail?: string
  ): Promise<void> {
    await super.report(userFeedback, feedbackCategory, userEmail);
    await CapacitorPluginOutline.reportEvents({
      uuid: Sentry.lastEventId() || '',
    });
  }
}

class CapacitorMethodChannel implements MethodChannel {
  async invokeMethod(methodName: string, params: string): Promise<string> {
    const response = await CapacitorPluginOutline.invokeMethod({
      method: methodName,
      input: params,
    });
    return response.value;
  }
}

class CapacitorVpnApi implements VpnApi {
  private statusListener?: PluginListenerHandle;

  async start(request: StartRequestJson): Promise<void> {
    await CapacitorPluginOutline.start({
      tunnelId: request.id,
      serverName: request.name,
      transportConfig: request.client,
    });
  }

  async stop(id: string): Promise<void> {
    await CapacitorPluginOutline.stop({tunnelId: id});
  }

  async isRunning(id: string): Promise<boolean> {
    const result = await CapacitorPluginOutline.isRunning({tunnelId: id});
    return result.isRunning;
  }

  onStatusChange(listener: (id: string, status: TunnelStatus) => void): void {
    void this.statusListener?.remove();
    void CapacitorPluginOutline.addListener('vpnStatus', data => {
      listener(data.id, data.status as TunnelStatus);
    }).then(handle => {
      this.statusListener = handle;
    });
  }
}

class CapacitorPlatform implements OutlinePlatform {
  getVpnApi(): VpnApi | undefined {
    return hasDeviceSupport ? new CapacitorVpnApi() : undefined;
  }

  getUrlInterceptor() {
    if (Capacitor.getPlatform() === 'android') {
      return new interceptors.AndroidUrlInterceptor();
    }
    return new interceptors.UrlInterceptor();
  }

  getClipboard() {
    return new CapacitorClipboard();
  }

  getErrorReporter(env: EnvironmentVariables) {
    const sharedTags = {'build.number': env.APP_BUILD_NUMBER};
    return hasDeviceSupport
      ? new CapacitorErrorReporter(
          env.APP_VERSION,
          env.SENTRY_DSN || '',
          sharedTags
        )
      : new SentryErrorReporter(
          env.APP_VERSION,
          env.SENTRY_DSN || '',
          sharedTags
        );
  }

  getUpdater() {
    return new AbstractUpdater();
  }

  getVpnServiceInstaller(): VpnInstaller {
    return new NoOpVpnInstaller();
  }

  quitApplication() {
    if (!hasDeviceSupport) {
      return;
    }
    CapacitorPluginOutline.quitApplication().catch((err: unknown) => {
      console.warn('Failed to quit application', err);
    });
  }
}

function wireExternalLinkHandling() {
  const getExternalHttpUrlFromClick = (event: Event): URL | null => {
    const composedPath =
      (event as {composedPath?: () => EventTarget[]}).composedPath?.() || [];
    const pathAnchor = composedPath.find(
      node =>
        node instanceof HTMLAnchorElement && Boolean(node.getAttribute('href'))
    ) as HTMLAnchorElement | undefined;
    const target = event.target as Element | null;
    const targetAnchor = target?.closest?.(
      'a[href]'
    ) as HTMLAnchorElement | null;
    const anchor = pathAnchor || targetAnchor;
    if (!anchor) return null;
    const href = anchor.getAttribute('href') || '';
    if (!href || href.startsWith('#')) return null;
    try {
      const url = new URL(anchor.href, window.location.href);
      if (
        (url.protocol === 'http:' || url.protocol === 'https:') &&
        url.origin !== window.location.origin
      ) {
        return url;
      }
      return null;
    } catch {
      return null;
    }
  };

  document.addEventListener(
    'click',
    event => {
      const url = getExternalHttpUrlFromClick(event);
      if (!url) return;
      event.preventDefault();
      void Browser.open({url: url.toString()});
    },
    true
  );
}

function resolveBody() {
  document.body.removeAttribute('unresolved');
}

async function bootstrapCapacitor() {
  document.addEventListener('app-localize-resources-loaded', resolveBody, {
    once: true,
  });
  window.addEventListener('WebComponentsReady', () => {
    setTimeout(resolveBody, 2000);
  });

  installDefaultMethodChannel(
    hasDeviceSupport
      ? new CapacitorMethodChannel()
      : new CapacitorBrowserMethodChannel()
  );
  wireExternalLinkHandling();

  try {
    await window.customElements.whenDefined('app-root');
    await main(new CapacitorPlatform());
  } catch (e) {
    console.error('main() failed: ', e);
    resolveBody();
  }
}

void bootstrapCapacitor();
