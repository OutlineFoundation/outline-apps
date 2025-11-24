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

import '@babel/polyfill';
import {Capacitor} from '@capacitor/core';
import {SplashScreen} from '@capacitor/splash-screen';
import {StatusBar, Style} from '@capacitor/status-bar';
import {setRootPath} from '@polymer/polymer/lib/utils/settings.js';
import * as Sentry from '@sentry/browser';

import 'web-animations-js/web-animations-next-lite.min.js';
import {AbstractClipboard} from './clipboard';
import {EnvironmentVariables} from './environment';
import {main} from './main';
import {installDefaultMethodChannel, MethodChannel} from './method_channel';
import {VpnApi} from './outline_server_repository/vpn';
import {CordovaVpnApi} from './outline_server_repository/vpn.cordova';
import {FakeVpnApi} from './outline_server_repository/vpn.fake';
import {OutlinePlatform} from './platform';
import {pluginExec} from './plugin.cordova';
import {AbstractUpdater} from './updater';
import * as interceptors from './url_interceptor';
import {NoOpVpnInstaller, VpnInstaller} from './vpn_installer';
import {SentryErrorReporter, Tags} from '../shared/error_reporter';

setRootPath('./');

if (typeof HTMLSlotElement !== 'undefined') {
  const originalAssignedNodes = HTMLSlotElement.prototype.assignedNodes;
  HTMLSlotElement.prototype.assignedNodes = function (options?: any): Node[] {
    const getElementsOnly = (nodes: NodeListOf<Node> | Node[]): Node[] => {
      return Array.from(nodes).filter(
        node => node.nodeType === Node.ELEMENT_NODE
      );
    };

    let result: Node[];
    if (!options) {
      try {
        result = originalAssignedNodes.call(this);
      } catch (e) {
        result = Array.from(this.childNodes);
      }
    } else if (
      typeof options === 'object' &&
      'flatten' in options &&
      typeof options.flatten === 'boolean'
    ) {
      try {
        result = originalAssignedNodes.call(this, {flatten: options.flatten});
      } catch (e) {
        result = Array.from(this.childNodes);
      }
    } else {
      result = Array.from(this.childNodes);
    }
    return getElementsOnly(result);
  };
}

const originalConsoleError = console.error;
console.error = function (...args: any[]) {
  const message = String(args[0] || '');
  if (
    message.includes('setAttribute is not a function') ||
    message.includes('hasAttribute is not a function') ||
    message.includes('assignedNodes') ||
    message.includes('AssignedNodesOptions')
  ) {
    return;
  }
  originalConsoleError.apply(console, args);
};

window.addEventListener(
  'error',
  event => {
    const message = String(event.message || '');
    if (
      message.includes('setAttribute is not a function') ||
      message.includes('hasAttribute is not a function') ||
      message.includes('assignedNodes') ||
      message.includes('AssignedNodesOptions')
    ) {
      event.preventDefault();
      event.stopPropagation();
    }
  },
  true
);

const hasDeviceSupport = Capacitor.isNativePlatform();

class CapacitorClipboard extends AbstractClipboard {
  async getContents(): Promise<string> {
    try {
      if (navigator.clipboard && navigator.clipboard.readText) {
        return await navigator.clipboard.readText();
      }
      return '';
    } catch (e) {
      console.debug('Clipboard read failed:', e);
      return '';
    }
  }
}

class CapacitorErrorReporter extends SentryErrorReporter {
  private readonly hasNativeErrorReporting: boolean;

  constructor(appVersion: string, dsn: string, tags: Tags) {
    super(appVersion, dsn, tags);
    this.hasNativeErrorReporting = Boolean(dsn && dsn.trim().length > 0);
    if (this.hasNativeErrorReporting) {
      pluginExec<void>('initializeErrorReporting', dsn.trim()).catch(
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
    if (this.hasNativeErrorReporting) {
      await pluginExec<void>('reportEvents', Sentry.lastEventId() || '');
    }
  }
}

class CapacitorMethodChannel implements MethodChannel {
  async invokeMethod(methodName: string, params: string): Promise<string> {
    try {
      return await pluginExec<string>('invokeMethod', methodName, params);
    } catch (e) {
      console.error(
        `[CapacitorMethodChannel] invokeMethod failed - methodName: ${methodName}`,
        e
      );
      throw e;
    }
  }
}

class CapacitorPlatform implements OutlinePlatform {
  getVpnApi(): VpnApi | undefined {
    if (hasDeviceSupport) {
      return new CordovaVpnApi();
    }
    return new FakeVpnApi();
  }

  getUrlInterceptor() {
    const platform = Capacitor.getPlatform();
    if (platform === 'ios') {
      return new interceptors.AppleUrlInterceptor(appleLaunchUrl);
    } else if (platform === 'android') {
      return new interceptors.AndroidUrlInterceptor();
    }
    console.warn('no intent interceptor available');
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
    pluginExec<void>('quitApplication').catch((err: unknown) => {
      console.warn('Failed to quit application', err);
    });
  }
}

let appleLaunchUrl: string;
window.handleOpenURL = (url: string) => {
  appleLaunchUrl = url;
};

async function initializeCapacitorPlugins(): Promise<void> {
  if (!Capacitor.isNativePlatform()) {
    return;
  }

  const platform = Capacitor.getPlatform();
  if (platform === 'ios' || platform === 'android') {
    try {
      await StatusBar.setStyle({style: Style.Dark});

      if (platform === 'android') {
        await StatusBar.setBackgroundColor({color: '#0F1621'});
      }
    } catch (error) {
      console.warn('[Capacitor] StatusBar not available:', error);
    }
  }
}

(async () => {
  try {
    await initializeCapacitorPlugins();

    installDefaultMethodChannel(new CapacitorMethodChannel());

    if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios') {
      try {
        await SplashScreen.show({
          autoHide: false,
          fadeInDuration: 0,
        });
        console.log('[Capacitor] Splash screen shown');
      } catch (error) {
        console.warn('[Capacitor] Failed to show splash screen:', error);
      }
    }

    await main(new CapacitorPlatform());

    if (Capacitor.isNativePlatform()) {
      try {
        await new Promise(resolve => setTimeout(resolve, 2000));
        await SplashScreen.hide({fadeOutDuration: 300});
      } catch {}
    }
  } catch (e) {
    console.error('[Capacitor] main() failed:', e);
  }
})();
